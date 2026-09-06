// cli/lib/search.js — `prax search`: semantic first, keyword only when the server
// says semantic search is not configured (409). The envelope names the mode and
// every way the result is less than complete: a keyword fallback, an incomplete
// embedding index (`reason: 'index-incomplete'`, with `index` counts), or a page
// bound (`page.hasMore`). A machine consumer never has to guess (QINV-08).
export async function searchLibrary(client, { project, query, all = false } = {}) {
  let items;
  let retrieval = { mode: 'semantic', degraded: false, reason: null, index: null, page: null };
  try {
    const res = await client.semanticSearch(project, query, { all });
    if (Array.isArray(res)) {
      items = res;
    } else {
      items = Array.isArray(res?.items) ? res.items : [];
      retrieval = {
        mode: 'semantic',
        degraded: Boolean(res?.degraded),
        reason: res?.reason || null,
        index: res?.index || null,
        page: res?.page || null,
      };
    }
  } catch (error) {
    if (error?.status !== 409) throw error;
    items = await client.keywordSearch(project, query, { all });
    retrieval = { mode: 'keyword', degraded: true, reason: 'semantic-not-configured', index: null, page: null };
  }
  return { schemaVersion: 1, retrieval, items };
}

// Human-readable caveats for a search envelope, one per line; '' when complete.
export function describeRetrieval(retrieval) {
  if (!retrieval) return '';
  const lines = [];
  if (retrieval.mode === 'keyword') lines.push('Note: semantic search is not configured; showing keyword results.');
  if (retrieval.reason === 'coverage-unknown') {
    lines.push('Note: this server does not report semantic index coverage; a complete result cannot be assumed.');
  }
  if (retrieval.reason === 'index-incomplete') {
    const index = retrieval.index || {};
    const scope = index.total ? `${index.pending} of ${index.total} documents` : `${index.pending ?? 'some'} documents`;
    lines.push(`Note: the semantic index is incomplete (${scope} have no current embedding); results may be missing.`);
  }
  if (retrieval.page?.hasMore) {
    lines.push(`Note: showing the first ${retrieval.page.returned} of ${retrieval.page.total} matches.`);
  }
  return lines.join('\n');
}
