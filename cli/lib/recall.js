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

const BODY_CHARS = 800;
const RELATED_MAX = 5;

function trimBody(body) {
  const text = String(body || '').trim();
  return text.length <= BODY_CHARS ? text : `${text.slice(0, BODY_CHARS).trimEnd()}…`;
}

// "verified" / "unverified", plus the lifecycle status when it is not active.
export function trustLabel(doc) {
  if (!doc) return '';
  const parts = [doc.verified ? 'verified' : 'unverified'];
  if (doc.status && doc.status !== 'active') parts.push(doc.status);
  return parts.join(', ');
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
export async function collectSemantic(client, project, query, limit) {
  const wanted = Math.max(1, Number(limit) || 1);
  let res = await client.semanticSearch(project, query, { limit: wanted });
  if (Array.isArray(res)) return res;
  const items = [...(res.items || [])];
  let page = res.page;
  let guard = 0;
  while (page?.hasMore && items.length < wanted && Number.isInteger(page.nextOffset) && guard < 100) {
    guard += 1;
    const next = await client.semanticSearch(project, query, { limit: wanted - items.length, offset: page.nextOffset });
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

export async function recall(client, { query, project, limit = 5, recent = false } = {}) {
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
        trust: trustLabel(d),
        snippet: String(d.body || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      }));
    return { kind: 'recent', project: project || '', items };
  }

  let res;
  try {
    res = await collectSemantic(client, project || undefined, query, limit);
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

  // Both shapes: the paged object (with coverage) and the legacy bare array.
  const legacy = Array.isArray(res);
  const list = legacy ? res : (Array.isArray(res?.items) ? res.items : []);
  const coverage = {
    degraded: !legacy && Boolean(res?.degraded),
    // An old server answers with a bare array and no coverage at all: that is
    // "unknown", not "complete", and the output must not imply otherwise.
    reason: legacy ? 'coverage-unknown' : (res?.reason || null),
    index: legacy ? null : (res?.index || null),
    // What remains beyond the requested bound after paging up to it.
    page: legacy ? null : (res?.page || null),
  };
  if (list.length === 0) return { kind: 'empty', query, note: null, ...coverage };
  const kept = list.slice(0, limit);
  const topDoc = await client.getDocument(kept[0].id).catch(() => null);
  return {
    kind: 'hit',
    note: null,
    ...coverage,
    top: { ...kept[0], ...(topDoc ? { body: topDoc.body, verified: topDoc.verified, status: topDoc.status } : {}) },
    related: kept.slice(1),
  };
}

export function formatRecall(result) {
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
    const lines = result.items.map((d) => `- ${d.title} — ${d.id}${d.trust ? ` (${d.trust})` : ''}${d.snippet ? ` — ${d.snippet}` : ''}`);
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
  const trust = trustLabel(top);
  lines.push(`## ${top.title || 'Untitled'}  (${top.documentType || 'note'} · ${top.id}${trust ? ` · ${trust}` : ''})`);
  lines.push('');
  lines.push(trimBody(top.body));
  const related = (result.related || []).slice(0, RELATED_MAX);
  if (related.length) {
    lines.push('');
    lines.push('Related:');
    for (const r of related) {
      const label = trustLabel(r);
      lines.push(`- ${r.title || 'Untitled'} — ${r.id}${label ? ` (${label})` : ''}`);
    }
  }
  return lines.join('\n');
}
