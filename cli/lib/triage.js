// cli/lib/triage.js — `prax triage`: a keyboard pass over the review queue in
// a terminal. One document at a time, one key per decision: verify, edit,
// supersede, archive or skip. The design is in
// docs/superpowers/specs/2026-09-23-triage-tui-design.md.
//
// For people only. The session starts only after assertAttendedHuman (no
// agent CLI environment, an interactive terminal in raw mode), and this module
// is never bundled into the skill scripts (scripts/build-skills.mjs; guarded by
// tests/contract/skillBundlesExcludeTriage.test.js).
//
// Every action reuses an existing route with its existing retry identity, and
// every uncertain outcome is reconciled with one canonical read (the Library's
// documentLifecycleController does the same): nothing here is a new write path.
// All I/O — client, streams, environment, editor, checkout — is injected, so
// the whole flow runs under test with fake streams.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTransport, timeoutFromEnv, DEFAULT_TIMEOUT_MS,
} from '../../server/praxTransport.js';
import {
  groupDocumentsByType, isReviewQueueDoc, sortDocuments,
} from '../../public/js/libraryFilters.js';
import { documentTypeLabel } from '../../public/js/documentTypes.js';
import { assertAttendedHuman } from './verify.js';
import {
  checkTopCitations, citationCheckNote, projectLabel, rankKeywordMatches, trustLabel,
} from './recall.js';
import { trustTag } from './format.js';

export const EXCERPT_LINES = 30;
export const EXCERPT_CHARS = 2400;
const SEARCH_RESULTS_MAX = 9;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64}$/i;

// ---------------------------------------------------------------------------
// Untrusted text. Agents write the title, body and tags; an ANSI or bidi
// control sequence could hide text on screen so that a person verifies
// content they never saw. Controls become visible placeholders instead.
// ---------------------------------------------------------------------------
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function sanitizeTerminalText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_RE, (ch) => {
      const code = ch.codePointAt(0);
      if (code < 0x20) return `^${String.fromCharCode(code + 64)}`;
      if (code === 0x7f) return '^?';
      return `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`;
    });
}

// ---------------------------------------------------------------------------
// The queue, in the Library review walk's order: review-queue documents,
// newest first, grouped by type in registry order (the UI's default sort and
// grouping — public/js/renderLibrary.js buildLibraryModel).
// ---------------------------------------------------------------------------
export function orderReviewQueue(documents) {
  const queue = (Array.isArray(documents) ? documents : []).filter(isReviewQueueDoc);
  return groupDocumentsByType(sortDocuments(queue, 'updated')).flatMap((group) => group.docs);
}

// ---------------------------------------------------------------------------
// A human-origin client over the shared transport: triage's requests carry no
// agent origin (the guard has ruled out an agent shell), so an edit is a human
// edit and clears updatedByAgent, exactly as in the Library.
// ---------------------------------------------------------------------------
export function createTriageClient({
  baseUrl, env = process.env, fetch, timeoutMs = timeoutFromEnv(env) ?? DEFAULT_TIMEOUT_MS,
} = {}) {
  const transport = createTransport({ baseUrl, env, fetch, agent: null, timeoutMs });
  const parse = (res) => ((res.headers.get('content-type') || '').includes('application/json') ? res.json() : res.text());
  const request = (method, path, options = {}) => transport.request(method, path, { ...options, parse });
  const doc = (id) => `/api/library/documents/${encodeURIComponent(id)}`;
  return {
    get base() { return transport.base; },
    listProjects: () => request('GET', '/api/projects'),
    listDocuments: ({ project, q, status } = {}) => request('GET', '/api/library/documents', { query: { project, q, status } }),
    getDocument: (id) => request('GET', doc(id)),
    listCodeRefs: (id) => request('GET', `${doc(id)}/code-refs`),
    similarDocuments: (id) => request('GET', `${doc(id)}/similar`),
    // Revision-bound; a same-state replay is success on the server, so a
    // resend is safe only when no request provably reached it.
    verify: (id, { as, revision, contentHash }) => request('POST', `${doc(id)}/verify`, {
      body: { verified: true, as, revision, ...(contentHash ? { contentHash } : {}) }, retry: 'connect-only',
    }),
    // Receipt-backed (operationId, document-update ledger kind): one resend
    // after a lost response replays exactly. ifRevision refuses to write over
    // a revision the person was not shown.
    updateBody: (id, { body, ifRevision, operationId }) => request('POST', `${doc(id)}/update`, {
      body: { body, ifRevision, operationId }, retry: true,
    }),
    supersede: (id, replacementId) => request('POST', `${doc(id)}/supersede`, {
      body: { supersededBy: replacementId }, retry: 'connect-only',
    }),
    archive: (id) => request('DELETE', doc(id), { retry: 'connect-only' }),
  };
}

// ---------------------------------------------------------------------------
// Terminal: a raw-mode key decoder and a line editor on top of it. Bytes are
// decoded directly rather than through readline.emitKeypressEvents, whose
// lone-Escape timer makes key handling timing-dependent.
// ---------------------------------------------------------------------------
export function decodeKeys(text) {
  const chars = Array.from(String(text));
  const keys = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === '\x1b') {
      if (chars[i + 1] === '[') {
        let j = i + 2;
        while (j < chars.length && !/[@-~]/.test(chars[j])) j += 1;
        keys.push({ name: 'sequence' });
        i = j;
        continue;
      }
      if (chars[i + 1] === 'O' && i + 2 < chars.length) { keys.push({ name: 'sequence' }); i += 2; continue; }
      keys.push({ name: 'escape' });
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      keys.push({ name: 'enter' });
      if (ch === '\r' && chars[i + 1] === '\n') i += 1;
      continue;
    }
    if (ch === '\x7f' || ch === '\b') { keys.push({ name: 'backspace' }); continue; }
    if (ch === '\x03') { keys.push({ name: 'ctrl-c' }); continue; }
    if (ch === '\x04') { keys.push({ name: 'ctrl-d' }); continue; }
    if (ch < ' ') { keys.push({ name: 'control' }); continue; }
    keys.push({ name: 'char', char: ch });
  }
  return keys;
}

export function createTerminal({ input, output }) {
  const queue = [];
  let waiter = null;
  let ended = false;
  let raw = false;
  const setRaw = (on) => {
    if (raw === on || typeof input.setRawMode !== 'function') return;
    try { input.setRawMode(on); raw = on; } catch { /* a closed terminal */ }
  };
  const flush = () => {
    if (!waiter || (!queue.length && !ended)) return;
    const resolve = waiter;
    waiter = null;
    resolve(queue.length ? queue.shift() : { name: 'eof' });
  };
  const onData = (chunk) => { queue.push(...decodeKeys(chunk)); flush(); };
  const onEnd = () => { ended = true; flush(); };
  if (typeof input.setEncoding === 'function') input.setEncoding('utf8');
  input.on('data', onData);
  input.on('end', onEnd);
  setRaw(true);
  input.resume?.();

  const write = (text) => { output.write(text); };
  const nextKey = () => new Promise((resolve) => { waiter = resolve; flush(); });

  // A one-line prompt: printable keys echo, Backspace deletes, Enter answers,
  // Escape / Ctrl-C / Ctrl-D cancel (null). Ctrl-C cancels the prompt only.
  async function readLine(prompt) {
    write(prompt);
    let value = '';
    for (;;) {
      const key = await nextKey();
      if (key.name === 'enter') { write('\n'); return value; }
      if (['escape', 'ctrl-c', 'ctrl-d', 'eof'].includes(key.name)) { write(' (cancelled)\n'); return null; }
      if (key.name === 'backspace') {
        if (value) { value = Array.from(value).slice(0, -1).join(''); write('\b \b'); }
        continue;
      }
      if (key.name === 'char') { value += key.char; write(sanitizeTerminalText(key.char)); }
    }
  }

  // y confirms; any other key declines.
  async function confirm(question) {
    write(`${question} [y/N] `);
    const key = await nextKey();
    const yes = key.name === 'char' && (key.char === 'y' || key.char === 'Y');
    write(yes ? 'y\n' : 'n\n');
    return yes;
  }

  // Hand the terminal to a child (the editor): cooked mode, no reading here.
  async function suspend(fn) {
    setRaw(false);
    input.pause?.();
    try {
      return await fn();
    } finally {
      setRaw(true);
      input.resume?.();
    }
  }

  function close() {
    input.off?.('data', onData);
    input.off?.('end', onEnd);
    setRaw(false);
    input.pause?.();
  }

  return {
    write, nextKey, readLine, confirm, suspend, close, get columns() { return output.columns || 80; },
  };
}

// ---------------------------------------------------------------------------
// The editor: the body in a 0600 file inside a private temporary directory,
// opened with $VISUAL, then $EDITOR, then vi. The file is removed only once the
// edit is settled, so a conflict or an unknown outcome never loses typing.
// ---------------------------------------------------------------------------
export function editInEditor(text, { env = process.env, spawn = spawnSync, platform = process.platform } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-triage-'));
  const file = join(dir, 'document.md');
  writeFileSync(file, String(text ?? ''), { mode: 0o600 });
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  const editor = String(env.VISUAL || env.EDITOR || 'vi').trim() || 'vi';
  // Ctrl-C belongs to the editor while it runs.
  const ignore = () => {};
  process.on('SIGINT', ignore);
  let result;
  try {
    result = platform === 'win32'
      ? spawn(`${editor} "${file}"`, { stdio: 'inherit', shell: true })
      : spawn('/bin/sh', ['-c', `${editor} "$1"`, 'prax-triage-editor', file], { stdio: 'inherit' });
  } finally {
    process.off('SIGINT', ignore);
  }
  if (result?.error) { cleanup(); return { cancelled: `could not start ${editor} (${result.error.message})` }; }
  if (result?.status !== 0) { cleanup(); return { cancelled: `${editor} exited with status ${result?.status ?? 'unknown'}` }; }
  return { text: readFileSync(file, 'utf8'), file, cleanup };
}

// ---------------------------------------------------------------------------
// Rendering one document.
// ---------------------------------------------------------------------------
export function bodyExcerpt(body, { lines = EXCERPT_LINES, chars = EXCERPT_CHARS } = {}) {
  const text = String(body ?? '').replace(/\s+$/, '');
  const all = text.split('\n');
  let shown = all.slice(0, lines).join('\n');
  if (shown.length > chars) shown = shown.slice(0, chars).replace(/\s+\S*$/, '');
  const truncated = shown.length < text.length;
  const remaining = truncated ? all.length - shown.split('\n').length : 0;
  return { text: shown, truncated, remainingLines: remaining };
}

const SIMILAR_REASONS = {
  'semantic-off': 'semantic search is off',
  'not-indexed': 'this document is not indexed yet',
  unavailable: 'unavailable',
};

function localDate(iso) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return '';
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function citationLines(context) {
  const check = context.citations;
  if (!check) return [];
  const items = (check.citations || []).map((c) => {
    const lines = c.startLine ? `:${c.startLine}${c.endLine && c.endLine !== c.startLine ? `-${c.endLine}` : ''}` : '';
    return c.status === 'current' ? `${c.path}${lines} current` : (c.note || `${c.path} ${c.status}`);
  });
  const unchecked = citationCheckNote(check.citationCheck);
  if (unchecked) items.push(unchecked);
  if (!items.length) return [];
  return items.map((item, i) => `${i === 0 ? 'Citations: ' : '           '}${sanitizeTerminalText(item)}`);
}

function similarLines(context, slugOf) {
  const similar = context.similar;
  if (!similar) return [];
  if (similar.degraded && !(similar.items || []).length) {
    return [`Similar: ${SIMILAR_REASONS[similar.reason] || similar.reason || 'unavailable'}`];
  }
  const items = similar.items || [];
  if (!items.length) return ['Similar: none'];
  return ['Similar:', ...items.map((ref, i) => {
    const score = typeof ref.similarity === 'number' ? ` ${ref.similarity.toFixed(2)}` : '';
    const slug = slugOf(ref.projectId);
    return `  ${i + 1}. ${sanitizeTerminalText(ref.title || 'Untitled')} ${trustTag(ref)}${score}${slug ? ` · in ${slug}` : ''} · ${String(ref.id).slice(0, 8)}`;
  })];
}

export function renderCard(doc, context = {}, {
  position, total, now = new Date(), full = false, columns = 80, slugOf = () => null,
} = {}) {
  const withSlug = doc.projectSlug ? doc : { ...doc, projectSlug: slugOf(doc.projectId) };
  const head = `── ${position} of ${total} ── ${sanitizeTerminalText(documentTypeLabel(doc.documentType || 'note')).toLowerCase()} `;
  const rule = head + '─'.repeat(Math.max(3, Math.min(columns, 100) - head.length));
  const trust = [projectLabel(withSlug), trustLabel(withSlug, now), doc.createdAt ? `created ${localDate(doc.createdAt)}` : '']
    .filter(Boolean).join(' · ');
  const tags = Array.isArray(doc.tags) && doc.tags.length ? ` · tags ${doc.tags.join(', ')}` : '';
  const excerpt = full ? { text: String(doc.body ?? '').replace(/\s+$/, ''), truncated: false, remainingLines: 0 } : bodyExcerpt(doc.body);
  const lines = [
    '',
    rule,
    sanitizeTerminalText(doc.title || 'Untitled'),
    sanitizeTerminalText(trust),
    `id ${doc.id}${sanitizeTerminalText(tags)}`,
    ...citationLines(context),
    '',
    excerpt.text ? sanitizeTerminalText(excerpt.text) : '(empty body)',
  ];
  if (excerpt.truncated) {
    lines.push(`… ${excerpt.remainingLines > 0 ? `${excerpt.remainingLines} more line${excerpt.remainingLines === 1 ? '' : 's'}` : 'more'} — f shows the full body`);
  }
  const similar = similarLines(context, slugOf);
  if (similar.length) lines.push('', ...similar);
  return { text: `${lines.join('\n')}\n`, truncated: excerpt.truncated };
}

export function keyLine(name) {
  return `v verify${name ? ` as ${sanitizeTerminalText(name)}` : ''} · e edit · s supersede · r archive · n skip · f full · ? help · q quit\n`;
}

const HELP = [
  'v  verify the revision shown (the full body must have been shown)',
  'e  edit the body in $VISUAL / $EDITOR, then review the saved revision',
  's  supersede: retire this document in favour of a replacement',
  'r  reject: archive this document (restore it from Library → Archive)',
  'n  skip to the next document (it stays in the queue)',
  'f  show the full body',
  'q  quit (also Ctrl-C, Ctrl-D)',
].join('\n');

// ---------------------------------------------------------------------------
// The session.
// ---------------------------------------------------------------------------
function summaryLine(counts, notReached) {
  const parts = [
    ['verified', counts.verified], ['edited', counts.edited], ['superseded', counts.superseded],
    ['archived', counts.archived], ['skipped', counts.skipped], ['already handled', counts.handled],
  ].filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`);
  const done = parts.length ? parts.join(', ') : 'nothing changed';
  const rest = notReached > 0 ? ` ${notReached} left undecided.` : '';
  const stays = counts.skipped > 0 || notReached > 0 ? ' Skipped and undecided documents stay in the review queue.' : '';
  return `Triage finished: ${done}.${rest}${stays}\n`;
}

export async function runTriageSession({
  client, terminal, as, project, checkout = null, edit = editInEditor, now = () => new Date(),
}) {
  const { write } = terminal;
  const counts = { verified: 0, edited: 0, superseded: 0, archived: 0, skipped: 0, handled: 0 };
  let name = typeof as === 'string' && as.trim() ? as.trim() : null;

  const projects = await client.listProjects().catch(() => []);
  const slugById = new Map((Array.isArray(projects) ? projects : []).filter((p) => p?.id).map((p) => [p.id, p.slug]));
  const slugOf = (id) => slugById.get(id) || null;

  const listing = await client.listDocuments({ project });
  const ids = orderReviewQueue(listing).map((doc) => doc.id);
  if (!ids.length) {
    write(`The review queue is empty${project ? ` in ${project}` : ''}: nothing to triage.\n`);
    return { counts, total: 0, notReached: 0, quit: false };
  }
  write(`Review queue: ${ids.length} document${ids.length === 1 ? '' : 's'}${project ? ` in ${project}` : ' across all projects'}, at ${client.base}. Press ? for keys.\n`);

  // Re-read before showing: the queue is a snapshot, and a document verified,
  // superseded, archived or deleted meanwhile has been dealt with.
  async function loadQueued(id) {
    try {
      const doc = await client.getDocument(id);
      return isReviewQueueDoc(doc) ? doc : null;
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  async function reread(id) {
    try { return await client.getDocument(id); } catch { return null; }
  }

  async function gatherContext(doc) {
    const [citations, similar] = await Promise.all([
      checkTopCitations(client, doc, checkout)
        .catch(() => ({ citations: [], citationCheck: { checked: 0, unchecked: null, reason: 'unavailable' } })),
      client.similarDocuments(doc.id)
        .then((res) => (Array.isArray(res) ? { items: res, degraded: false } : res))
        .catch(() => ({ items: [], degraded: true, reason: 'unavailable' })),
    ]);
    return { citations, similar: { ...similar, items: (similar.items || []).filter((ref) => ref.id !== doc.id) } };
  }

  async function doVerify(doc) {
    if (!TOKEN_RE.test(doc.revision || '')) {
      write('This document has no valid revision token, so it cannot be verified safely.\n');
      return { stay: true };
    }
    const contentHash = TOKEN_RE.test(doc.contentHash || '') ? doc.contentHash : undefined;
    try {
      await client.verify(doc.id, { as: name, revision: doc.revision, contentHash });
      write(`Verified as ${sanitizeTerminalText(name)}.\n`);
      return { done: 'verified' };
    } catch (err) {
      if (err?.status === 409) {
        write('Not verified: the document changed since it was shown. Showing the current revision.\n');
        return { reload: await reread(doc.id) };
      }
      if (err?.status === 404) { write('The document no longer exists.\n'); return { done: 'handled' }; }
      if (!err?.status) {
        const current = await reread(doc.id);
        if (current?.verified && current.revision === doc.revision) {
          write(`Verified as ${sanitizeTerminalText(name)} (confirmed by re-reading the document).\n`);
          return { done: 'verified' };
        }
        write(`Verification outcome unknown; check the document before retrying. ${err?.message || ''}\n`);
        return { stay: true };
      }
      write(`Not verified: ${err.message}\n`);
      return { stay: true };
    }
  }

  async function doEdit(doc) {
    const draft = await terminal.suspend(() => edit(doc.body ?? '', { doc }));
    if (!draft || draft.cancelled) { write(`Edit discarded: ${draft?.cancelled || 'no result'}.\n`); return null; }
    const settle = () => { try { draft.cleanup?.(); } catch { /* best effort */ } };
    if (draft.text === (doc.body ?? '')) { settle(); write('No changes.\n'); return null; }
    if (!draft.text.trim()) {
      settle();
      write('An empty body is not saved. Use r to archive the document instead.\n');
      return null;
    }
    const operationId = randomUUID();
    const kept = draft.file ? ` Your draft is kept at ${draft.file}.` : '';
    try {
      const saved = await client.updateBody(doc.id, { body: draft.text, ifRevision: doc.revision, operationId });
      settle();
      write('Saved. Review the saved revision; v verifies it.\n');
      return { doc: (await reread(doc.id)) || saved, edited: true };
    } catch (err) {
      if (err?.status === 409) {
        write(`Not saved: the document changed since it was shown.${kept} Showing the current revision.\n`);
        return { doc: await reread(doc.id) };
      }
      if (err?.status === 404) { write(`The document no longer exists.${kept}\n`); return { gone: true }; }
      if (!err?.status) {
        const current = await reread(doc.id);
        if (current && current.body === draft.text) {
          settle();
          write('Saved (confirmed by re-reading the document). Review the saved revision; v verifies it.\n');
          return { doc: current, edited: true };
        }
        write(`Edit outcome unknown (operation ${operationId}).${kept} Check the document before retrying.\n`);
        return { doc: current };
      }
      write(`Not saved: ${err.message}.${kept}\n`);
      return null;
    }
  }

  async function pickReplacement(doc, context) {
    const similar = context.similar?.items || [];
    const answer = await terminal.readLine(`Replacement: ${similar.length ? `a similar number (1-${similar.length}), ` : ''}a document id, or search words (Enter cancels): `);
    const text = (answer ?? '').trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      const pick = similar[Number(text) - 1];
      if (!pick) { write(`There is no similar document numbered ${text}.\n`); return null; }
      return pick;
    }
    if (UUID_RE.test(text)) {
      try {
        const found = await client.getDocument(text);
        if (found?.archivedAt) { write('That document is archived; restore it before using it as a replacement.\n'); return null; }
        return found;
      } catch (err) {
        write(err?.status === 404 ? 'No document has that id.\n' : `Could not read that document: ${err?.message}\n`);
        return null;
      }
    }
    let results;
    try {
      results = await client.listDocuments({ q: text, status: 'active' });
    } catch (err) {
      write(`Search failed: ${err?.message}\n`);
      return null;
    }
    const ranked = rankKeywordMatches((Array.isArray(results) ? results : []).filter((d) => d.id !== doc.id && !d.archivedAt), text)
      .slice(0, SEARCH_RESULTS_MAX);
    if (!ranked.length) { write(`No active document matches "${sanitizeTerminalText(text)}".\n`); return null; }
    write(`${ranked.map((d, i) => `  ${i + 1}. ${sanitizeTerminalText(d.title || 'Untitled')} ${trustTag(d)}${slugOf(d.projectId) ? ` · in ${slugOf(d.projectId)}` : ''} · ${String(d.id).slice(0, 8)}`).join('\n')}\n`);
    const choice = (await terminal.readLine(`Number (1-${ranked.length}; Enter cancels): `) ?? '').trim();
    if (!choice) return null;
    const pick = /^\d+$/.test(choice) ? ranked[Number(choice) - 1] : null;
    if (!pick) { write(`There is no result numbered ${sanitizeTerminalText(choice)}.\n`); return null; }
    return pick;
  }

  async function doSupersede(doc, context) {
    const replacement = await pickReplacement(doc, context);
    if (!replacement) { write('Supersede cancelled.\n'); return { stay: true }; }
    if (replacement.id === doc.id) { write('A document cannot supersede itself.\n'); return { stay: true }; }
    const ok = await terminal.confirm(`Retire "${sanitizeTerminalText(doc.title)}" in favour of "${sanitizeTerminalText(replacement.title)}" ${trustTag(replacement)}?`);
    if (!ok) { write('Supersede cancelled.\n'); return { stay: true }; }
    try {
      await client.supersede(doc.id, replacement.id);
      write('Superseded. Undo from the replacement\'s links in the Library if needed.\n');
      return { done: 'superseded' };
    } catch (err) {
      if (err?.status === 409) { write(`Not superseded: ${err.message}.\n`); return { stay: true }; }
      if (err?.status === 404) { write('Not superseded: one of the documents no longer exists.\n'); return { stay: true }; }
      if (!err?.status) {
        const current = await reread(doc.id);
        if (current?.status === 'superseded') { write('Superseded (confirmed by re-reading the document).\n'); return { done: 'superseded' }; }
        write(`Supersede outcome unknown; check the document before retrying. ${err?.message || ''}\n`);
        return { stay: true };
      }
      write(`Not superseded: ${err.message}\n`);
      return { stay: true };
    }
  }

  async function doArchive(doc) {
    const ok = await terminal.confirm(`Archive "${sanitizeTerminalText(doc.title)}"? It can be restored from Library → Archive.`);
    if (!ok) { write('Archive cancelled.\n'); return { stay: true }; }
    try {
      await client.archive(doc.id);
      write('Archived.\n');
      return { done: 'archived' };
    } catch (err) {
      if (err?.status === 404) { write('The document no longer exists.\n'); return { done: 'handled' }; }
      if (!err?.status) {
        const current = await reread(doc.id);
        if (current?.archivedAt) { write('Archived (confirmed by re-reading the document).\n'); return { done: 'archived' }; }
        write(`Archive outcome unknown; check the document before retrying. ${err?.message || ''}\n`);
        return { stay: true };
      }
      write(`Not archived: ${err.message}\n`);
      return { stay: true };
    }
  }

  // One document: show it, then read keys until a decision moves on.
  async function review(initial, position) {
    let doc = initial;
    let context = await gatherContext(doc);
    let fullShown = false;
    let edited = false;
    const show = (full = false) => {
      const card = renderCard(doc, context, {
        position, total: ids.length, now: now(), full, columns: terminal.columns, slugOf,
      });
      if (full || !card.truncated) fullShown = true;
      write(card.text);
      write(keyLine(name));
    };
    show();
    for (;;) {
      const key = await terminal.nextKey();
      if (['ctrl-c', 'ctrl-d', 'eof'].includes(key.name)) return 'quit';
      const ch = key.name === 'char' ? key.char.toLowerCase() : '';
      if (ch === 'q') return 'quit';
      if (ch === 'n') { if (!edited) counts.skipped += 1; return 'next'; }
      if (ch === 'f') { show(true); continue; }
      if (ch === '?') { write(`${HELP}\n`); continue; }
      if (ch === 'v') {
        if (!fullShown) {
          show(true);
          write('The full body is shown above. Press v again to verify this revision.\n');
          continue;
        }
        if (!name) {
          const given = await terminal.readLine('Verify as (your name): ');
          if (!given || !given.trim()) { write('No name given; not verified.\n'); continue; }
          name = given.trim();
        }
        const result = await doVerify(doc);
        if (result.done) { counts[result.done] += 1; return 'next'; }
        if (result.reload) {
          doc = result.reload;
          fullShown = false;
          context = await gatherContext(doc);
          show();
        }
        continue;
      }
      if (ch === 'e') {
        const result = await doEdit(doc);
        if (result?.gone) { counts.handled += 1; return 'next'; }
        if (result?.doc) {
          if (result.edited) { counts.edited += 1; edited = true; }
          doc = result.doc;
          fullShown = false;
          context = await gatherContext(doc);
          show();
        }
        continue;
      }
      if (ch === 's') {
        const result = await doSupersede(doc, context);
        if (result.done) { counts[result.done] += 1; return 'next'; }
        continue;
      }
      if (ch === 'r') {
        const result = await doArchive(doc);
        if (result.done) { counts[result.done] += 1; return 'next'; }
        continue;
      }
      write(keyLine(name));
    }
  }

  let reached = 0;
  let quit = false;
  for (let i = 0; i < ids.length; i += 1) {
    const doc = await loadQueued(ids[i]);
    reached = i + 1;
    if (!doc) { counts.handled += 1; continue; }
    if (await review(doc, i + 1) === 'quit') { reached = i; quit = true; break; }
  }
  const notReached = ids.length - reached;
  write(summaryLine(counts, notReached));
  return { counts, total: ids.length, notReached, quit };
}

// The command: the guard first (before any request), then the session on a
// raw-mode terminal that is always restored.
export async function triage({
  input = process.stdin, output = process.stdout, env = process.env, client, as, project,
  checkout = null, edit, now,
}) {
  assertAttendedHuman({ input, output, env, command: 'triage', raw: true });
  if (as !== undefined && !String(as).trim()) throw new Error('--as needs a non-empty name.');
  const terminal = createTerminal({ input, output });
  const restore = () => terminal.close();
  process.once('exit', restore);
  try {
    return await runTriageSession({
      client, terminal, as, project, checkout, ...(edit ? { edit } : {}), ...(now ? { now } : {}),
    });
  } finally {
    process.off('exit', restore);
    terminal.close();
  }
}
