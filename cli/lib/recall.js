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

// One line describing pending vectors, or '' when the index is complete/unknown.
export function coverageNote(result) {
  if (!result || !result.degraded) return '';
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
    res = await client.semanticSearch(project || undefined, query, { limit });
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
  const list = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
  const coverage = {
    degraded: !Array.isArray(res) && Boolean(res?.degraded),
    reason: !Array.isArray(res) ? (res?.reason || null) : null,
    index: !Array.isArray(res) ? (res?.index || null) : null,
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
