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
