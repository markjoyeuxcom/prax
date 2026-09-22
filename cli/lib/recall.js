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
import { normalizeRepoUrl } from '../../server/repoUrl.js';

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

// Which project a hit lives in. Recall searches EVERY project, so without
// this an agent cannot tell a homelab runbook from a memory note with the same
// title — and a later remember, defaulting to `memory`, creates a split-brain
// duplicate of a note that already existed elsewhere.
export function projectLabel(doc) {
  return doc?.projectSlug ? `in ${doc.projectSlug}` : '';
}

// Semantic refs carry only projectId; the listing carries projectSlug. One
// projects call per recall fills the gap for every hit at once. Fail-soft: an
// old client or a failed call leaves the label off rather than failing recall.
async function withProjectSlugs(client, docs) {
  const list = Array.isArray(docs) ? docs : [];
  const missing = list.some((d) => d && !d.projectSlug && d.projectId);
  if (!missing || typeof client?.listProjects !== 'function') return list;
  const projects = await client.listProjects().catch(() => null);
  if (!Array.isArray(projects)) return list;
  const slugById = new Map(projects.filter((p) => p && p.id && p.slug).map((p) => [p.id, p.slug]));
  return list.map((d) => (d && !d.projectSlug && slugById.has(d.projectId)
    ? { ...d, projectSlug: slugById.get(d.projectId) }
    : d));
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
  // A keyword fallback is degraded too, but that is said by its own note;
  // there is no semantic index whose coverage could be reported.
  if (!result.degraded || result.reason === 'semantic-not-configured') return '';
  const index = result.index || {};
  const pending = Number(index.pending ?? 0);
  const total = Number(index.total ?? 0);
  const scope = total ? `${pending} of ${total} documents` : `${pending} documents`;
  return `index incomplete: ${scope} have no current embedding`;
}

// Does this checkout hold the repository a citation was taken in? Citations
// are repository-relative and recall is cross-project, so a hit about another
// repository must not have its paths read here: `src/x.js` from repo A would
// be reported "gone" or "changed" from repo B.
//
// The hit's project, when it has a registered repo URL and this checkout has
// an origin, decides. Otherwise the commit the citation was pinned at must
// exist here (a `memory` note has no repo URL; a clone without an origin has
// none either). Neither answer = not checked, never a guess. An injected
// checkout that declares no identity at all (tests, embedders) vouches for
// itself. Returns null when the citation belongs here, else why it is not
// checked.
function repositoryMismatch(checkout, ref, projectRepoUrl) {
  if (checkout.repoUrl === undefined && checkout.hasCommit === undefined) return null;
  const here = normalizeRepoUrl(checkout.repoUrl);
  const there = normalizeRepoUrl(projectRepoUrl);
  if (here && there) return here === there ? null : 'other-repository';
  if (!ref.commitSha) return 'unknown-repository';
  return typeof checkout.hasCommit === 'function' && checkout.hasCommit(ref.commitSha) ? null : 'commit-not-found';
}

async function projectRepoUrl(client, projectId) {
  if (!projectId || typeof client.listProjects !== 'function') return null;
  const projects = await client.listProjects().catch(() => null);
  const project = Array.isArray(projects) ? projects.find((p) => p && p.id === projectId) : null;
  return project?.repoUrl || null;
}

const UNCHECKED_REASONS = {
  'no-checkout': 'not run inside a checkout',
  'other-repository': 'cited in another repository',
  'commit-not-found': 'pinned at a commit this checkout does not have',
  'unknown-repository': 'the cited repository is not recorded',
  unavailable: 'the citations could not be read',
};

// Check the top hit's code citations against the checkout this recall runs
// in. Only the top hit: it is the one whose body is actually rendered, and a
// per-hit round trip for every related title would cost more than it says.
//
// Returns the checked results plus how many citations were NOT checked and
// why: silence must not read as "still true" (outside a checkout, in another
// repository, or when the citations could not be read), and a file absent
// from the wrong checkout must not read as "deleted".
async function checkTopCitations(client, hit, checkout) {
  const none = { citations: [], citationCheck: null };
  if (typeof client.listCodeRefs !== 'function') return none;
  let refs;
  try {
    refs = await client.listCodeRefs(hit.id);
  } catch (err) {
    // A server without citation support (404) has nothing to check; any
    // other failure means there may be citations nobody looked at.
    if (err && err.status === 404) return none;
    return { citations: [], citationCheck: { checked: 0, unchecked: null, reason: 'unavailable' } };
  }
  if (!Array.isArray(refs) || refs.length === 0) return none;
  if (!checkout || typeof checkout.readFile !== 'function') {
    return { citations: [], citationCheck: { checked: 0, unchecked: refs.length, reason: 'no-checkout' } };
  }
  const repoUrl = checkout.repoUrl === undefined && checkout.hasCommit === undefined
    ? null
    : await projectRepoUrl(client, hit.projectId);
  const citations = [];
  const reasons = [];
  for (const ref of refs) {
    const mismatch = repositoryMismatch(checkout, ref, repoUrl);
    if (mismatch) { reasons.push(mismatch); continue; }
    let text = null;
    try { text = checkout.readFile(ref.path); } catch { text = null; }
    const result = checkCitation(ref, text);
    citations.push({ ...result, path: ref.path, note: describeCitationStatus(result, ref) });
  }
  // `reason` names the (first) cause; `reasons` lists every distinct one.
  const distinct = [...new Set(reasons)];
  return {
    citations,
    citationCheck: {
      checked: citations.length, unchecked: reasons.length, reason: distinct[0] ?? null, reasons: distinct,
    },
  };
}

// One clause for citations that were not checked, or ''.
export function citationCheckNote(check) {
  if (!check || !check.reason) return '';
  const why = (check.reasons?.length ? check.reasons : [check.reason])
    .map((reason) => UNCHECKED_REASONS[reason] || reason).join('; ');
  if (check.unchecked === null || check.unchecked === undefined) return `citations not checked (${why})`;
  if (!check.unchecked) return '';
  return `${check.unchecked} citation${check.unchecked === 1 ? '' : 's'} not checked (${why})`;
}

// Keyword matches arrive in listing order (project, type, date), not by
// relevance. Rank them by how often the query's terms occur, a title match
// weighing more than a body match, so the rendered "top hit" is the best
// keyword match rather than the first row. Ties keep the listing order.
export function rankKeywordMatches(docs, query) {
  const list = Array.isArray(docs) ? docs : [];
  const terms = String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!terms.length) return list.slice();
  const count = (text, term) => {
    let n = 0;
    for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) n += 1;
    return n;
  };
  const score = (doc) => {
    const title = String(doc?.title || '').toLowerCase();
    const body = String(doc?.body || doc?.snippet || '').toLowerCase();
    return terms.reduce((sum, term) => sum + 3 * count(title, term) + Math.min(count(body, term), 20), 0);
  };
  return list
    .map((doc, index) => ({ doc, index, score: score(doc) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.doc);
}

// `checkout` ({ readFile, repoUrl, hasCommit } from repoFiles.createCheckout)
// is where citations are checked; a bare `readFile` is accepted as a checkout
// that vouches for its own identity.
export async function recall(client, {
  query, project, limit = 5, recent = false, mode = 'hybrid', readFile, checkout: givenCheckout,
} = {}) {
  const checkout = givenCheckout ?? (typeof readFile === 'function' ? { readFile } : null);
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
        projectId: d.projectId ?? null,
        projectSlug: d.projectSlug ?? null,
        snippet: snippetOf(d, 100),
      }));
    return { kind: 'recent', project: project || '', items: await withProjectSlugs(client, items) };
  }

  let res;
  try {
    res = await collectSemantic(client, project || undefined, query, limit, mode);
  } catch (err) {
    if (err && err.status === 409) {
      // The same envelope `prax search` gives this state: degraded, with the
      // reason, and a page that says how many matches the bound held back.
      const ranked = rankKeywordMatches(await client.keywordSearch(project || undefined, query, {}), query);
      const kept = await withProjectSlugs(client, ranked.slice(0, limit));
      const fallback = {
        degraded: true,
        reason: 'semantic-not-configured',
        index: null,
        page: { returned: kept.length, total: ranked.length, hasMore: ranked.length > kept.length },
      };
      if (kept.length === 0) return { kind: 'empty', query, note: 'keyword', ...fallback };
      const { citations, citationCheck } = await checkTopCitations(client, kept[0], checkout);
      return {
        kind: 'hit', note: 'semantic search disabled — keyword results', ...fallback,
        top: { ...kept[0], citations, citationCheck }, related: kept.slice(1),
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
  const kept = await withProjectSlugs(client, list.slice(0, limit));
  const topDoc = await client.getDocument(kept[0].id).catch(() => null);
  const { citations, citationCheck } = await checkTopCitations(client, { ...kept[0], projectId: kept[0].projectId ?? topDoc?.projectId }, checkout);
  return {
    kind: 'hit',
    note: null,
    ...coverage,
    top: mergeDefined({ ...kept[0], citations, citationCheck }, topDoc, [
      'body', 'verified', 'verifiedBy', 'status', 'updatedAt', 'updatedBy', 'updatedByAgent', 'projectSlug',
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
      const label = [projectLabel(d), trustLabel(d, now)].filter(Boolean).join(' · ');
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
  const citationNotes = [
    ...(top.citations || []).map((c) => c.note).filter(Boolean),
    citationCheckNote(top.citationCheck),
  ].filter(Boolean);
  // Project first, then trust: "where it lives" is what a re-remember needs to
  // avoid duplicating it, so it must not be buried behind the trust words.
  const trust = [projectLabel(top), trustLabel(top, now), ...citationNotes].filter(Boolean).join(' · ');
  lines.push(`## ${top.title || 'Untitled'}  (${top.documentType || 'note'} · ${top.id}${trust ? ` · ${trust}` : ''})`);
  lines.push('');
  lines.push(trimBody(top.body));
  const related = (result.related || []).slice(0, RELATED_MAX);
  if (related.length) {
    lines.push('');
    lines.push('Related:');
    for (const r of related) {
      const label = [projectLabel(r), trustLabel(r, now)].filter(Boolean).join(' · ');
      const snippet = snippetOf(r);
      lines.push(`- ${r.title || 'Untitled'} — ${r.id}${label ? ` (${label})` : ''}${snippet ? ` — ${snippet}` : ''}`);
    }
  }
  return lines.join('\n');
}
