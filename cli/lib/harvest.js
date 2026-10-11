// cli/lib/harvest.js — session harvesting: turn the agent's own explicit
// markers ("Remember: …" lines and ```prax-remember blocks) into unverified
// candidate documents in the Inbox, exactly once per session and candidate.
// The design and each vendor's hook contract are in
// docs/design/session-harvesting.md.
//
// Only text the AGENT wrote is scanned: assistant messages in a transcript and
// the hook's last_assistant_message. User messages, tool calls and tool
// results never are, so a fetched page that says "Remember: …" cannot become a
// candidate unless the agent repeats it in its own reply (prompt-injection
// containment by construction). Extraction is deterministic; no model runs.
import { createHash } from 'node:crypto';
import { isDocumentType } from '../../public/js/documentTypes.js';
import { looksLikeCredential } from '../../server/secretPatterns.js';
import { HARVEST_TAG } from '../../server/harvestedCandidates.js';

export { HARVEST_TAG };
export const INBOX_PROJECT = 'inbox';
export const MAX_CANDIDATES = 20;
export const MAX_TITLE_CHARS = 200;
export const MAX_BODY_CHARS = 8000;
const MIN_MARKER_CHARS = 12;
const MARKER_TITLE_CHARS = 100;
const SIMILAR_LIMIT = 3;
const HOOK_VENDORS = { claude: 'claude', codex: 'codex', copilot: 'copilot' };

export function isHookVendor(value) {
  return Object.prototype.hasOwnProperty.call(HOOK_VENDORS, value);
}

// ---- input: hook JSON and transcripts -------------------------------------

// A hook's stdin, normalised across vendors: Claude Code and Codex send
// snake_case (session_id, transcript_path, last_assistant_message); Copilot
// CLI sends camelCase (sessionId, transcriptPath) and no last message. Returns
// null when the text is not one hook JSON object.
export function parseHookInput(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(trimmed); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pick = (...keys) => {
    for (const key of keys) if (typeof value[key] === 'string' && value[key]) return value[key];
    return null;
  };
  const input = {
    sessionId: pick('session_id', 'sessionId'),
    transcriptPath: pick('transcript_path', 'transcriptPath'),
    cwd: pick('cwd'),
    event: pick('hook_event_name', 'hookEventName') || (value.stopReason ? 'agentStop' : null),
    lastAssistantMessage: pick('last_assistant_message'),
  };
  // A transcript line is also one JSON object; a hook input names a session
  // or a transcript and is not a transcript record.
  if (!input.sessionId && !input.transcriptPath && !input.lastAssistantMessage) return null;
  return input;
}

const MARKER_HINTS = ['Remember:', 'prax-remember'];
const hasMarkerHint = (text) => MARKER_HINTS.some((hint) => text.includes(hint));

function textBlocks(content, types) {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block && types.includes(block.type) && typeof block.text === 'string')
    .map((block) => block.text);
}

// The agent's own messages from a transcript, plus whatever session identity
// the transcript records. Formats: Claude Code JSONL, Codex rollout JSONL,
// Copilot CLI events.jsonl, else plain text (the person chose the file, so
// every line counts as the agent's). Only lines that could hold a marker are
// JSON-parsed after the first, so a long transcript stays cheap to scan.
export function readTranscript(text) {
  const source = String(text || '');
  const lines = source.split('\n');
  const firstLine = lines.find((line) => line.trim());
  let first = null;
  if (firstLine) {
    try { first = JSON.parse(firstLine); } catch { first = null; }
  }
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    return { format: 'text', sessionId: null, cwd: null, messages: source.trim() ? [source] : [] };
  }
  const result = { format: 'jsonl', sessionId: null, cwd: null, messages: [] };
  const identify = (record) => {
    if (record.type === 'session_meta' && record.payload) {
      result.format = 'codex';
      result.sessionId ??= record.payload.id || record.payload.session_id || null;
      result.cwd ??= record.payload.cwd || null;
    } else if (record.type === 'session.start' && record.data) {
      result.format = 'copilot';
      result.sessionId ??= record.data.sessionId || null;
      result.cwd ??= record.data.context?.cwd || null;
    } else if (typeof record.sessionId === 'string') {
      result.format = 'claude';
      result.sessionId ??= record.sessionId;
      result.cwd ??= typeof record.cwd === 'string' ? record.cwd : null;
    }
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    const isFirst = line === firstLine;
    if (!isFirst && !hasMarkerHint(line) && result.sessionId) continue;
    let record;
    try { record = isFirst ? first : JSON.parse(line); } catch { continue; }
    if (!record || typeof record !== 'object') continue;
    identify(record);
    if (!hasMarkerHint(line)) continue;
    // Claude Code: assistant text blocks of the main thread (not sidechains).
    if (record.type === 'assistant' && record.message?.role === 'assistant' && !record.isSidechain) {
      result.messages.push(...textBlocks(record.message.content, ['text']));
    // Codex: the assistant response item, and the agent_message event.
    } else if (record.type === 'response_item' && record.payload?.type === 'message' && record.payload.role === 'assistant') {
      result.messages.push(...textBlocks(record.payload.content, ['output_text', 'text']));
    } else if (record.type === 'event_msg' && record.payload?.type === 'agent_message' && typeof record.payload.message === 'string') {
      result.messages.push(record.payload.message);
    // Copilot CLI: assistant.message events.
    } else if (record.type === 'assistant.message' && typeof record.data?.content === 'string') {
      result.messages.push(record.data.content);
    }
  }
  return result;
}

// ---- extraction -----------------------------------------------------------

// Credential shapes a harvested candidate must never carry (memory never
// persists secrets). A match skips the candidate; it is not redacted, because
// a half-redacted memory is still a leak and still a wrong memory. The shapes
// are shared with recall telemetry's query redaction (server/secretPatterns.js).
export function looksSecret(text) {
  return looksLikeCredential(text);
}

const collapse = (text) => String(text || '').replace(/\s+/g, ' ').trim();
export const normaliseTitle = (title) => collapse(title).toLowerCase();

const MARKER_LINE = /^\s{0,3}(?:[-*+]\s+)?(?:\*\*|__)?Remember:(?:\*\*|__)?\s+(.*\S)\s*$/;
const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADER_LINE = /^(title|type|project|tags)\s*:\s*(.*)$/i;

// The title of a one-line marker: its first sentence, capped on a word boundary.
function titleFromText(text) {
  const sentence = /^(.+?[.!?])(?:\s+(?=[A-Z0-9`"'(])|$)/.exec(text);
  let title = (sentence ? sentence[1] : text).replace(/\.$/, '').trim();
  if (title.length > MARKER_TITLE_CHARS) {
    const cut = title.slice(0, MARKER_TITLE_CHARS - 1);
    const space = cut.lastIndexOf(' ');
    title = `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return title;
}

function parseBlock(lines) {
  const header = {};
  let i = 0;
  while (i < lines.length && lines[i].trim()) {
    const match = HEADER_LINE.exec(lines[i].trim());
    if (!match) break;
    header[match[1].toLowerCase()] = match[2].trim();
    i += 1;
  }
  const body = lines.slice(i).join('\n').trim();
  const tags = header.tags
    ? header.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    : [];
  return {
    title: collapse(header.title), body, type: header.type || null,
    project: header.project || null, tags, marker: 'block',
  };
}

// Every marker in one message, in order. Lines inside a code fence other than
// a prax-remember block are ignored, so a quoted example is not a proposal.
function markersIn(message) {
  const found = [];
  const lines = String(message || '').split('\n');
  let fence = null;
  for (const line of lines) {
    if (fence) {
      const trimmed = line.trim();
      if (trimmed.length >= fence.len && trimmed === fence.char.repeat(trimmed.length)) {
        if (fence.info === 'prax-remember') found.push(parseBlock(fence.lines));
        fence = null;
      } else if (fence.info === 'prax-remember') {
        fence.lines.push(line);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1][0], len: open[1].length, info: (open[2] || '').toLowerCase(), lines: [] };
      continue;
    }
    const marker = MARKER_LINE.exec(line);
    if (marker) {
      const text = marker[1].replace(/(?:\*\*|__)$/, '').trim();
      found.push({ title: titleFromText(text), body: text, type: null, project: null, tags: [], marker: 'line', short: text.length < MIN_MARKER_CHARS });
    }
  }
  return found;
}

// Candidates from the agent's messages: validated, screened, de-duplicated by
// content hash and normalised title, capped. `skipped` says why each rejected
// marker was dropped, so a manual run can explain itself.
export function extractCandidates(messages) {
  const candidates = [];
  const skipped = [];
  const seenHashes = new Set();
  const seenTitles = new Set();
  for (const message of messages || []) {
    for (const raw of markersIn(message)) {
      if (raw.short) continue; // "Remember: yes" is not a proposal
      const label = raw.title || '(untitled block)';
      if (!raw.title) { skipped.push({ title: label, reason: 'the prax-remember block has no title: line' }); continue; }
      if (!raw.body) { skipped.push({ title: label, reason: 'the prax-remember block has no body' }); continue; }
      if (raw.body.length > MAX_BODY_CHARS) {
        skipped.push({ title: label, reason: `the body is longer than ${MAX_BODY_CHARS} characters; use prax remember for it` });
        continue;
      }
      if (looksSecret(`${raw.title}\n${raw.body}`)) {
        skipped.push({ title: label, reason: 'it looks like it contains a credential; memory never stores secrets' });
        continue;
      }
      const title = raw.title.length > MAX_TITLE_CHARS ? `${raw.title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : raw.title;
      const hash = candidateHash({ title, body: raw.body });
      const titleKey = normaliseTitle(title);
      if (seenHashes.has(hash) || seenTitles.has(titleKey)) continue;
      if (candidates.length >= MAX_CANDIDATES) {
        skipped.push({ title, reason: `more than ${MAX_CANDIDATES} candidates in one run` });
        continue;
      }
      seenHashes.add(hash);
      seenTitles.add(titleKey);
      const type = raw.type && isDocumentType(raw.type) ? raw.type : null;
      candidates.push({
        title, body: raw.body, hash, marker: raw.marker,
        type, requestedType: raw.type && !type ? raw.type : null,
        project: raw.project, tags: raw.tags,
      });
    }
  }
  return { candidates, skipped };
}

// ---- identity -------------------------------------------------------------

export function candidateHash({ title, body }) {
  return createHash('sha256').update(`${collapse(title)}\n${collapse(body)}`).digest('hex');
}

// A UUID (version-5 layout, so the server's uuid check accepts it) derived
// from a seed: the same session and candidate always give the same ids.
export function derivedUuid(seed) {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function candidateIds(sessionId, candidate) {
  return {
    id: derivedUuid(`prax-harvest:doc:${sessionId}:${candidate.hash}`),
    operationId: derivedUuid(`prax-harvest:op:${sessionId}:${candidate.hash}`),
  };
}

// The session a run belongs to: the hook's own id, else the transcript's, else
// an explicit --session, else the transcript's absolute path.
export function sessionKey({ hookSessionId, transcriptSessionId, flagSession, transcriptPath }) {
  const id = hookSessionId || transcriptSessionId || flagSession;
  if (id) return String(id);
  if (transcriptPath) return `path:${createHash('sha256').update(String(transcriptPath)).digest('hex').slice(0, 32)}`;
  return null;
}

// ---- the candidate document ----------------------------------------------

function similarLine(doc) {
  const where = doc.projectSlug ? `${doc.projectSlug}, ` : '';
  const type = doc.documentType ? `${doc.documentType}, ` : '';
  const trust = doc.verified ? `verified${doc.verifiedBy ? ` by ${doc.verifiedBy}` : ''}` : 'unverified';
  return `- "${collapse(doc.title) || 'Untitled'}" — ${where}${type}${trust} (\`${doc.id}\`)`;
}

// The proposal first (the Inbox preview shows the first 240 characters), then
// what a reviewer needs to decide: where it came from, where it might belong,
// and what the library already holds that is close to it.
export function buildCandidateBody(candidate, { source = {}, suggestedProject, similar } = {}) {
  const lines = [candidate.body.trim(), '', '---', '', '## Harvest details', ''];
  lines.push(`Proposed by ${source.agent || 'an agent'} and filed automatically; unverified until a person reviews it. File it with its owning project, or archive it.`);
  lines.push('');
  if (suggestedProject?.slug) lines.push(`- Suggested project: \`${suggestedProject.slug}\` (${suggestedProject.from})`);
  lines.push(`- Suggested type: ${candidate.type || 'note'}${candidate.requestedType ? ` (the marker asked for "${candidate.requestedType}", which is not a document type)` : ''}`);
  if (candidate.tags?.length) lines.push(`- Suggested tags: ${candidate.tags.join(', ')}`);
  const session = [
    source.vendor ? `${source.vendor} session` : 'session',
    source.sessionId ? `\`${source.sessionId}\`` : null,
    source.event ? `(${source.event})` : null,
  ].filter(Boolean).join(' ');
  lines.push(`- Source: ${session}${candidate.marker === 'block' ? ', a prax-remember block' : ', a Remember: line'}`);
  if (source.transcriptPath) lines.push(`- Transcript: \`${source.transcriptPath}\``);
  lines.push('', '## Similar active memories', '');
  if (similar?.error) lines.push(`Not checked: ${similar.error}`);
  else if (!similar?.items?.length) lines.push('None found.');
  else lines.push(...similar.items.map(similarLine));
  if (similar?.note) lines.push('', similar.note);
  return lines.join('\n');
}

// ---- the run --------------------------------------------------------------

async function findSimilar(client, candidate, { exclude, slugById }) {
  const query = `${candidate.title}\n${candidate.body.slice(0, 500)}`;
  try {
    let items;
    let note = null;
    try {
      // Other unreviewed candidates count as similar here: the person triaging
      // this one should see a near-duplicate proposal too.
      const res = await client.semanticSearch(undefined, query, {
        limit: SIMILAR_LIMIT + 1, mode: 'hybrid', includeHarvested: true,
      });
      items = Array.isArray(res) ? res : (res?.items || []);
      if (res?.reason === 'index-incomplete') note = 'The semantic index was incomplete when this was checked; similar memories may be missing.';
    } catch (error) {
      if (error?.status !== 409) throw error;
      items = await client.keywordSearch(undefined, candidate.title, { includeHarvested: true });
      note = 'Checked by keyword: semantic search is not configured.';
    }
    const list = (Array.isArray(items) ? items : [])
      .filter((doc) => doc && doc.id !== exclude && (doc.status ?? 'active') === 'active')
      .slice(0, SIMILAR_LIMIT)
      .map((doc) => ({ ...doc, projectSlug: doc.projectSlug || slugById.get(doc.projectId) || null }));
    return { items: list, note };
  } catch (error) {
    return { items: [], error: error?.message || 'recall failed' };
  }
}

// Propose each candidate once. `results` is filled as the run goes, so a
// caller whose time budget expires can still say what already happened.
//   proposed          created in the Inbox now
//   already-proposed  this session proposed it before (document id or receipt)
//   skipped           an active document with the same title exists
export async function harvest(client, { candidates, source, suggestedProject, results = [] }) {
  let titles = null;
  let slugById = new Map();
  const loadTitles = async () => {
    const docs = await client.listDocuments(undefined, { status: 'active' });
    titles = new Map();
    for (const doc of Array.isArray(docs) ? docs : []) {
      if (!doc?.title) continue;
      if (doc.projectId && doc.projectSlug) slugById.set(doc.projectId, doc.projectSlug);
      const key = normaliseTitle(doc.title);
      if (!titles.has(key)) titles.set(key, doc);
    }
  };
  for (const candidate of candidates) {
    const { id, operationId } = candidateIds(source.sessionId, candidate);
    // 1. Already proposed by this session? One read, no write, no recall.
    try {
      const existing = await client.getDocument(id);
      if (existing) {
        results.push({ status: 'already-proposed', title: candidate.title, id });
        continue;
      }
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    // 2. Never shadow or overwrite a memory that already has this title.
    if (!titles) await loadTitles();
    const same = titles.get(normaliseTitle(candidate.title));
    if (same) {
      results.push({
        status: 'skipped', title: candidate.title, id: same.id, project: same.projectSlug || null,
        reason: `an active document with this title exists${same.projectSlug ? ` in ${same.projectSlug}` : ''}`,
      });
      continue;
    }
    // 3. What is close to it, then the exactly-once create.
    const similar = await findSimilar(client, candidate, { exclude: id, slugById });
    const project = candidate.project
      ? { slug: candidate.project, from: 'named in the marker' }
      : suggestedProject;
    const body = buildCandidateBody(candidate, { source, suggestedProject: project, similar });
    try {
      const doc = await client.createMemory({
        id, operationId, title: candidate.title, body, project: INBOX_PROJECT,
        documentType: candidate.type || 'note',
        tags: Array.from(new Set([HARVEST_TAG, ...(candidate.tags || [])])),
        kind: 'synthesized',
      });
      results.push({ status: doc?.replayed ? 'already-proposed' : 'proposed', title: candidate.title, id: doc?.id || id });
      titles.set(normaliseTitle(candidate.title), { id, title: candidate.title, projectSlug: INBOX_PROJECT });
    } catch (error) {
      // 409: the receipt holds this operation with a different body (similar
      // memories changed between runs); 410: it was created and a person
      // deleted it since. Either way it was proposed once — never again.
      if (error?.status === 409 || error?.status === 410) {
        results.push({
          status: 'already-proposed', title: candidate.title, id,
          reason: error.status === 410 ? 'proposed earlier and since deleted' : 'proposed earlier',
        });
        continue;
      }
      throw error;
    }
  }
  return results;
}

const STATUS_WORDS = { proposed: 'proposed', 'already-proposed': 'already ', skipped: 'skipped ' };

export function formatHarvest({ results, skipped = [], source = {}, base, incomplete }) {
  const lines = [];
  const who = [source.vendor, source.sessionId ? `session ${source.sessionId}` : null].filter(Boolean).join(' ');
  lines.push(`Harvest${who ? ` of ${who}` : ''}${base ? ` at ${base}` : ''}:`);
  for (const r of results) {
    const word = STATUS_WORDS[r.status] || r.status;
    if (r.status === 'proposed') lines.push(`  ${word}  "${r.title}" → ${r.id} in ${INBOX_PROJECT} (unverified)`);
    else if (r.status === 'already-proposed') lines.push(`  ${word}  "${r.title}" (${r.id})${r.reason ? ` — ${r.reason}` : ''}`);
    else lines.push(`  ${word}  "${r.title}": ${r.reason} (${r.id})`);
  }
  for (const s of skipped) lines.push(`  skipped   "${s.title}": ${s.reason}`);
  if (incomplete) lines.push(`  stopped: ${incomplete}`);
  return lines.join('\n');
}

export const NO_MARKERS = 'No harvest markers found. The agent proposes a memory with a line starting "Remember:" or a ```prax-remember block in its own reply.';
