export async function searchLibrary(client, { project, query, all = false } = {}) {
  let items;
  let retrieval = { mode: 'semantic', degraded: false, reason: null };
  try {
    items = await client.semanticSearch(project, query, { all });
  } catch (error) {
    if (error?.status !== 409) throw error;
    items = await client.keywordSearch(project, query, { all });
    retrieval = { mode: 'keyword', degraded: true, reason: 'semantic-not-configured' };
  }
  return { schemaVersion: 1, retrieval, items };
}
