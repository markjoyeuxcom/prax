import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticSearchTools } from '../../mcp/tools/semanticSearch.js';

test('search_documents_semantic requires query, optional project', () => {
  const tool = createSemanticSearchTools({}).find((t) => t.name === 'search_documents_semantic');
  assert.ok(tool);
  assert.equal(tool.inputSchema.query.safeParse(undefined).success, false);
  assert.equal(tool.inputSchema.project.safeParse(undefined).success, true);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('handler returns refs from the client', async () => {
  const client = { searchDocumentsSemantic: async () => [{ id: 'a', title: 't' }] };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const res = await tool.handler({ query: 'restore' });
  assert.match(res.content[0].text, /"title": ?"t"/);
});

test('handler surfaces the not-enabled message gracefully', async () => {
  const client = { searchDocumentsSemantic: async () => { const e = new Error('semantic search is not enabled'); e.status = 409; throw e; } };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const res = await tool.handler({ query: 'x' });
  assert.match(res.content[0].text, /not enabled/i);
});
