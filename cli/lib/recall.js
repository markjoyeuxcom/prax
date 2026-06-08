// cli/lib/recall.js — the one implementation of "recall": semantic-first (→ keyword
// on a 409 = semantic-disabled), distilled to a compact result, plus a chronological
// --recent mode. Pure of I/O: takes an injected client and returns a structured
// result; formatRecall renders it. Shared by `moomora recall` and the moomora-recall
// skill wrapper.

const BODY_CHARS = 800;
const RELATED_MAX = 5;

function trimBody(body) {
  const text = String(body || '').trim();
  return text.length <= BODY_CHARS ? text : `${text.slice(0, BODY_CHARS).trimEnd()}…`;
}

export async function recall(client, { query, project, limit = 5, recent = false } = {}) {
  if (recent) {
    const docs = await client.listDocuments(project || undefined);
    const items = (Array.isArray(docs) ? docs : [])
      .slice()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit)
      .map((d) => ({
        title: d.title || 'Untitled',
        id: d.id,
        snippet: String(d.body || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      }));
    return { kind: 'recent', project: project || '', items };
  }

  let refs;
  try {
    refs = await client.semanticSearch(project || undefined, query, {});
  } catch (err) {
    if (err && err.status === 409) {
      const docs = await client.keywordSearch(project || undefined, query, {});
      const kept = (Array.isArray(docs) ? docs : []).slice(0, limit);
      if (kept.length === 0) return { kind: 'empty', query, note: 'keyword' };
      return { kind: 'hit', note: 'semantic search disabled — keyword results', top: kept[0], related: kept.slice(1) };
    }
    throw err;
  }

  const list = Array.isArray(refs) ? refs : [];
  if (list.length === 0) return { kind: 'empty', query, note: null };
  const kept = list.slice(0, limit);
  const topDoc = await client.getDocument(kept[0].id).catch(() => null);
  return {
    kind: 'hit',
    note: null,
    top: { ...kept[0], body: topDoc ? topDoc.body : kept[0].body },
    related: kept.slice(1),
  };
}

export function formatRecall(result) {
  if (!result) return '';
  if (result.kind === 'empty') {
    const suffix = result.note === 'keyword' ? ' (keyword; semantic search is disabled)' : '';
    return `No relevant memory found for: "${result.query}"${suffix}`;
  }
  if (result.kind === 'recent') {
    if (!result.items.length) return 'No documents yet.';
    const scope = result.project ? ` in "${result.project}"` : '';
    const head = `Most recent ${result.items.length} document(s)${scope}:`;
    const lines = result.items.map((d) => `- ${d.title} — ${d.id}${d.snippet ? ` — ${d.snippet}` : ''}`);
    return [head, ...lines].join('\n');
  }
  // kind: 'hit'
  const lines = [];
  if (result.note) lines.push(`(${result.note})`);
  const top = result.top;
  lines.push(`## ${top.title || 'Untitled'}  (${top.documentType || 'note'} · ${top.id})`);
  lines.push('');
  lines.push(trimBody(top.body));
  const related = (result.related || []).slice(0, RELATED_MAX);
  if (related.length) {
    lines.push('');
    lines.push('Related:');
    for (const r of related) lines.push(`- ${r.title || 'Untitled'} — ${r.id}`);
  }
  return lines.join('\n');
}
