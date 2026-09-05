import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticSearchTools } from '../../mcp/tools/semanticSearch.js';

test('search_documents_semantic requires query and exposes optional scope + pagination', () => {
  const tool = createSemanticSearchTools({}).find((t) => t.name === 'search_documents_semantic');
  assert.ok(tool);
  assert.equal(tool.inputSchema.query.safeParse(undefined).success, false);
  assert.equal(tool.inputSchema.project.safeParse(undefined).success, true);
  assert.equal(tool.inputSchema.limit.safeParse(undefined).success, true);
  assert.equal(tool.inputSchema.offset.safeParse(undefined).success, true);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('handler returns refs from the client', async () => {
  const client = { searchDocumentsSemantic: async () => [{ id: 'a', title: 't' }] };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const res = await tool.handler({ query: 'restore' });
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.items[0].title, 't');
  assert.equal(data.page.total, 1);
});

test('handler forwards pagination and preserves the source total', async () => {
  let received;
  const client = {
    searchDocumentsSemantic: async (query, project, page) => {
      received = { query, project, page };
      return { items: [{ id: 'b' }], page: { total: 25 } };
    },
  };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const data = JSON.parse((await tool.handler({ query: 'restore', project: 'ops', limit: 10, offset: 10 })).content[0].text);
  assert.deepEqual(received, { query: 'restore', project: 'ops', page: { limit: 10, offset: 10 } });
  assert.equal(data.page.total, 25);
  assert.equal(data.page.nextOffset, 11);
});

test('handler surfaces the not-enabled message gracefully', async () => {
  const client = { searchDocumentsSemantic: async () => { const e = new Error('semantic search is not enabled'); e.status = 409; throw e; } };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const res = await tool.handler({ query: 'x' });
  assert.match(res.content[0].text, /not enabled/i);
  // The 409 fallback is the whole point of this tool: a friendly result, NOT
  // an error — so the agent transparently falls back to keyword search.
  assert.ok(!res.isError);
});

test('handler propagates a non-409 failure as an error result', async () => {
  const client = { searchDocumentsSemantic: async () => { const e = new Error('semantic search backend is unavailable'); e.status = 503; throw e; } };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const res = await tool.handler({ query: 'x' });
  assert.equal(res.isError, true);
});

// Regression (2026-07-18 review): a bare-array response (pre-envelope server
// that ignored pagination params) must be sliced client-side — the old
// fallback wrapped the FULL array in a "paginated" envelope.
test('bare-array fallback applies limit/offset instead of returning everything', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: `d${i}`, title: `Doc ${i}` }));
  const tools = createSemanticSearchTools({ searchDocumentsSemantic: async () => rows });
  const tool = tools.find((t) => t.name === 'search_documents_semantic');
  const res = JSON.parse((await tool.handler({ query: 'q', limit: 20, offset: 20 })).content[0].text);
  assert.equal(res.items.length, 20, 'sliced to the requested page');
  assert.equal(res.items[0].id, 'd20', 'offset applied');
  assert.equal(res.page.total, 60);
  assert.equal(res.page.nextOffset, 40);
});

// C10 adapter coverage: the server excludes stale/model-mismatched vectors and
// reports how many documents are pending. The tool must carry that through —
// a page that silently omits them is misleading success (QINV-08/QINV-10).
test('handler passes index coverage and degradation through the envelope', async () => {
  const client = {
    searchDocumentsSemantic: async () => ({
      items: [{ id: 'a', title: 'Current' }],
      page: { total: 1 },
      index: { total: 5, embedded: 3, pending: 2 },
      degraded: true,
      reason: 'index-incomplete',
    }),
  };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const data = JSON.parse((await tool.handler({ query: 'restore' })).content[0].text);
  assert.deepEqual(data.index, { total: 5, embedded: 3, pending: 2 });
  assert.equal(data.degraded, true);
  assert.equal(data.reason, 'index-incomplete');
  assert.equal(data.page.total, 1);
});

test('handler reports a complete index as not degraded and omits the keys when the server sends none', async () => {
  const complete = createSemanticSearchTools({
    searchDocumentsSemantic: async () => ({ items: [], page: { total: 0 }, index: { total: 4, embedded: 4, pending: 0 }, degraded: false }),
  }).find((t) => t.name === 'search_documents_semantic');
  const data = JSON.parse((await complete.handler({ query: 'x' })).content[0].text);
  assert.equal(data.degraded, false);
  assert.equal(data.index.pending, 0);
  assert.ok(!('reason' in data));

  const legacy = createSemanticSearchTools({ searchDocumentsSemantic: async () => ({ items: [], page: { total: 0 } }) })
    .find((t) => t.name === 'search_documents_semantic');
  const old = JSON.parse((await legacy.handler({ query: 'x' })).content[0].text);
  assert.ok(!('index' in old) && !('degraded' in old));
});
