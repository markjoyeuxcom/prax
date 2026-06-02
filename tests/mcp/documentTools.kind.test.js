import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentTools } from '../../mcp/tools/documents.js';

function tool(name) {
  return createDocumentTools({}).find(t => t.name === name);
}

test('search_documents accepts optional kind', () => {
  const s = tool('search_documents').inputSchema.kind;
  assert.equal(s.safeParse('source').success, true);
  assert.equal(s.safeParse('synthesized').success, true);
  assert.equal(s.safeParse('bogus').success, false);
  assert.equal(s.safeParse(undefined).success, true);
});

test('create_document accepts optional kind', () => {
  const s = tool('create_document').inputSchema.kind;
  assert.equal(s.safeParse('source').success, true);
  assert.equal(s.safeParse(undefined).success, true);
  assert.equal(s.safeParse('bogus').success, false);
});

test('update_document accepts optional kind', () => {
  const s = tool('update_document').inputSchema.kind;
  assert.equal(s.safeParse('source').success, true);
  assert.equal(s.safeParse(undefined).success, true);
  assert.equal(s.safeParse('bogus').success, false);
});
