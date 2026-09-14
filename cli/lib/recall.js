// cli/lib/recall.js — the one implementation of "recall": semantic-first (→ keyword
// on a 409 = semantic-disabled), distilled to a compact result, plus a chronological
// --recent mode. Pure of I/O: takes an injected client and returns a structured
// result; formatRecall renders it. Shared by `prax recall` and the prax-recall
// skill wrapper.
//
// Honesty rules (QINV-08/QINV-10): an empty result on an INCOMPLETE index is not
// an honest miss, so index coverage travels with every semantic result and is
// printed; `--recent` is active-only, so a retired memory can never be replayed
// as current; every hit carries its trust label.

import { checkCitation, describeCitationStatus } from './codeRefs.js';

const BODY_CHARS = 800;
const RELATED_MAX = 5;
const RELATED_SNIPPET_CHARS = 90;
const DAY_MS = 86400000;

function trimBody(body) {
  const text = String(body || '').trim();
  return text.length <= BODY_CHARS ? text : `${text.slice(0, BODY_CHARS).trimEnd()}…`;
}

// Coarse age of a memory — the cheapest defence there is against an agent
// acting on something that stopped being true months ago. Deliberately blunt:
// the decision it informs ("is this still likely current?") does not need
// hours. An undated row renders as '' — a missing timestamp must read as
// "unknown", never as "fresh".
export function ageLabel(iso, now = new Date()) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((now.getTime() - then) / DAY_MS);
  if (days <= 0) return 'today'; // also absorbs a clock-skewed future stamp
  if (days < 30) return `${days}d old`;
  if (days < 365) return `${Math.floor(days / 30)}mo old`;
  return `${Math.floor(days / 365)}y old`;
}

// Who wrote the revision being recalled: a human, a named agent CLI, or an
// agent that did not identify itself. A memory written by the agent now
// reading it warrants more suspicion than one a person typed.
export function writerLabel(doc) {
  if (!doc) return '';
  if (doc.updatedBy === 'agent') {
    return doc.updatedByAgent ? `via ${doc.updatedByAgent}` : 'via an unnamed agent';
  }
  return doc.updatedBy ? 'human-written' : '';
}

// The full trust line: verification (and by whom), any non-active lifecycle
// status, age, and writer. Prax stores all of this; before it was rendered
// here, recall disclosed only the first two and the agent had no way to weigh
// a four-month-old synthesized guess against a note a human blessed yesterday.
export function trustLabel(doc, now = new Date()) {
  if (!doc) return '';
  const verification = doc.verified
    ? (doc.verifiedBy ? `verified by ${doc.verifiedBy}` : 'verified')
    : 'unverified';
  const lifecycle = doc.status && doc.status !== 'active'
    ? `${verification}, ${doc.status}`
    : verification;
  // Hybrid retrieval can return a document the vector ranking never found. That
  // is frequently the point (an exact error code, a version token), but it also
  // means the query's MEANING did not match — so say so instead of presenting it
  // with the same confidence as a hit both rankings agreed on.
  const keywordOnly = doc.match && doc.match.semanticRank === null && doc.match.keywordRank
    ? 'keyword-only'
    : '';
  return [lifecycle, ageLabel(doc.updatedAt, now), writerLabel(doc), keywordOnly]
    .filter(Boolean)
    .join(' · ');
}

// Merge only the keys the authoritative fetch actually carried: a full
// document read must never blank a field the search ref had supplied.
function mergeDefined(base, extra, keys) {
  const out = { ...base };
  for (const key of keys) {
    if (extra && extra[key] !== undefined) out[key] = extra[key];
  }
  return out;
}

function snippetOf(doc, chars = RELATED_SNIPPET_CHARS) {
  const text = String(doc?.snippet || doc?.body || '').replace(/\s+/g, ' ').trim();
  return text.length <= chars ? text : `${text.slice(0, chars).trimEnd()}…`;
}

// One line when the server held back matches beyond the requested limit, else ''.
export function boundNote(result) {
  const page = result?.page;
  if (!page || !page.hasMore) return '';
  const total = Number.isInteger(page.total) ? page.total : null;
  return `${page.returned} of ${total ?? 'more'} matches shown — raise --limit for the rest`;
}

// Page the semantic route up to `limit` matches (the server caps one page at
// 50), so a requested bound is honoured rather than silently cut. The last
// page's metadata says whether more remained beyond the bound.
export async function collectSemantic(client, project, query, limit, mode = 'hybrid') {
  const wanted = Math.max(1, Number(limit) || 1);
  let res = await client.semanticSearch(project, query, { limit: wanted, mode });
  if (Array.isArray(res)) return res;
  const items = [...(res.items || [])];
  let page = res.page;
  let guard = 0;
  while (page?.hasMore && items.length < wanted && Number.isInteger(page.nextOffset) && guard < 100) {
    guard += 1;
    const next = await client.semanticSearch(project, query, { limit: wanted - items.length, offset: page.nextOffset, mode });
    if (Array.isArray(next)) break;
    items.push(...(next.items || []));
    page = next.page;
    res = next;
  }
  // `hasMore` is the LAST page's answer: true only when matches remain beyond
  // everything collected up to the requested bound.
  return { ...res, items, page: page ? { ...page, returned: items.length, hasMore: Boolean(page.hasMore) } : page };
}

// One line describing pending vectors, or '' when the index is complete/unknown.
export function coverageNote(result) {
  if (!result) return '';
  if (result.reason === 'coverage-unknown') return 'index coverage unknown: this server predates coverage reporting';
  if (!result.degraded) return '';
  const index = result.index || {};
  const pending = Number(index.pending ?? 0);
  const total = Number(index.total ?? 0);
  const scope = total ? `${pending} of ${total} documents` : `${pending} documents`;
  return `index incomplete: ${scope} have no current embedding`;
}

// Check the top hit's code citations against the working tree this recall is
// running in. Only the top hit: it is the one whose body is actually rendered,
// and a per-hit round trip for every related title would cost more than it says.
//
// No reader (recalling from outside a checkout) means no claim in EITHER
// direction — silence must not read as "still true", and absence of the file
// must not read as "deleted".
async function checkTopCitations(client, id, readFile) {
  if (typeof readFile !== 'function' || typeof client.listCodeRefs !== 'function') return [];
  const refs = await client.listCodeRefs(id).catch(() => []);
  if (!Array.isArray(refs) || refs.length === 0) return [];
  return refs.map((ref) => {
    let text = null;
    try { text = readFile(ref.path); } catch { text = null; }
    const result = checkCitation(ref, text);
    return { ...result, path: ref.path, note: describeCitationStatus(result, ref) };
  });
}

export async function recall(client, { query, project, limit = 5, recent = false, mode = 'hybrid', readFile } = {}) {
  if (recent) {
    const docs = await client.listDocuments(project || undefined, { status: 'active' });
    const items = (Array.isArray(docs) ? docs : [])
      .filter((d) => (d.status ?? 'active') === 'active')
      .slice()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit)
      .map((d) => ({
        title: d.title || 'Untitled',
        id: d.id,
        verified: Boolean(d.verified),
        status: d.status ?? 'active',
        updatedAt: d.updatedAt ?? null,
        updatedBy: d.updatedBy ?? null,
        updatedByAgent: d.updatedByAgent ?? null,
        snippet: snippetOf(d, 100),
      }));
    return { kind: 'recent', project: project || '', items };
  }

  let res;
  try {
    res = await collectSemantic(client, project || undefined, query, limit, mode);
  } catch (err) {
    if (err && err.status === 409) {
      const docs = await client.keywordSearch(project || undefined, query, {});
      const kept = (Array.isArray(docs) ? docs : []).slice(0, limit);
      if (kept.length === 0) return { kind: 'empty', query, note: 'keyword', degraded: false, reason: null, index: null };
      return {
        kind: 'hit', note: 'semantic search disabled — keyword results', degraded: false, reason: null, index: null,
        top: kept[0], related: kept.slice(1),
      };
    }
    throw err;
  }

  // Three shapes reach here: the paged object (with coverage), the client's
  // normalisation of an old server's bare array (`legacy: true`, reason
  // `coverage-unknown`), and — from an injected client — the bare array itself.
  const legacy = Array.isArray(res) || Boolean(res?.legacy) || res?.reason === 'coverage-unknown';
  const list = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
  const coverage = {
    degraded: !legacy && Boolean(res?.degraded),
    // An old server reports no coverage at all: that is "unknown", not
    // "complete", and the output must not imply otherwise.
    reason: legacy ? 'coverage-unknown' : (res?.reason || null),
    index: legacy ? null : (res?.index || null),
    // What remains beyond the requested bound after paging up to it.
    page: legacy ? null : (res?.page || null),
  };
  if (list.length === 0) return { kind: 'empty', query, note: null, ...coverage };
  const kept = list.slice(0, limit);
  const topDoc = await client.getDocument(kept[0].id).catch(() => null);
  const citations = await checkTopCitations(client, kept[0].id, readFile);
  return {
    kind: 'hit',
    note: null,
    ...coverage,
    top: mergeDefined({ ...kept[0], citations }, topDoc, [
      'body', 'verified', 'verifiedBy', 'status', 'updatedAt', 'updatedBy', 'updatedByAgent',
    ]),
    related: kept.slice(1),
  };
}

export function formatRecall(result, now = new Date()) {
  if (!result) return '';
  if (result.kind === 'empty') {
    const notes = [];
    if (result.note === 'keyword') notes.push('keyword; semantic search is disabled');
    const coverage = coverageNote(result);
    if (coverage) notes.push(`${coverage} — this may not be a true miss`);
    const suffix = notes.length ? ` (${notes.join('; ')})` : '';
    return `No relevant memory found for: "${result.query}"${suffix}`;
  }
  if (result.kind === 'recent') {
    if (!result.items.length) return 'No documents yet.';
    const scope = result.project ? ` in "${result.project}"` : '';
    const head = `Most recent ${result.items.length} active document(s)${scope}:`;
    const lines = result.items.map((d) => {
      const label = trustLabel(d, now);
      return `- ${d.title} — ${d.id}${label ? ` (${label})` : ''}${d.snippet ? ` — ${d.snippet}` : ''}`;
    });
    return [head, ...lines].join('\n');
  }
  // kind: 'hit'
  const lines = [];
  if (result.note) lines.push(`(${result.note})`);
  const coverage = coverageNote(result);
  if (coverage) lines.push(`(${coverage} — results may be missing)`);
  const bound = boundNote(result);
  if (bound) lines.push(`(${bound})`);
  const top = result.top;
  const citationNotes = (top.citations || []).map((c) => c.note).filter(Boolean);
  const trust = [trustLabel(top, now), ...citationNotes].filter(Boolean).join(' · ');
  lines.push(`## ${top.title || 'Untitled'}  (${top.documentType || 'note'} · ${top.id}${trust ? ` · ${trust}` : ''})`);
  lines.push('');
  lines.push(trimBody(top.body));
  const related = (result.related || []).slice(0, RELATED_MAX);
  if (related.length) {
    lines.push('');
    lines.push('Related:');
    for (const r of related) {
      const label = trustLabel(r, now);
      const snippet = snippetOf(r);
      lines.push(`- ${r.title || 'Untitled'} — ${r.id}${label ? ` (${label})` : ''}${snippet ? ` — ${snippet}` : ''}`);
    }
  }
  return lines.join('\n');
}
