import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentTools } from '../../mcp/tools/documents.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const SAMPLE_DOC = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'k8s upgrade', body: 'long runbook body',
  documentType: 'runbook', context: 'homelab', tags: ['k8s', 'upgrade'],
};

test('exposes the four document tools', () => {
  const names = createDocumentTools({}).map((t) => t.name);
  assert.deepEqual(
    names.sort(),
    ['create_document', 'get_document', 'search_documents', 'update_document'],
  );
});

test('search_documents maps args to listDocuments and returns refs without bodies', async () => {
  let received;
  const client = {
    listDocuments: async (filters) => { received = filters; return [SAMPLE_DOC]; },
  };
  const tool = byName(createDocumentTools(client), 'search_documents');
  const res = await tool.handler({ query: 'upgrade', context: 'homelab' });
  assert.deepEqual(received, { q: 'upgrade', context: 'homelab', documentType: undefined });
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.length, 1);
  assert.equal('body' in data[0], false);
  assert.equal(data[0].snippet, 'long runbook body');
});

test('search_documents allows an omitted query (browse by context/tags)', async () => {
  let received;
  const client = { listDocuments: async (filters) => { received = filters; return [SAMPLE_DOC]; } };
  const tool = byName(createDocumentTools(client), 'search_documents');
  const res = await tool.handler({ context: 'homelab' });
  assert.deepEqual(received, { q: undefined, context: 'homelab', documentType: undefined });
  assert.equal(JSON.parse(res.content[0].text).length, 1);
});

test('search_documents filters by tags client-side', async () => {
  const client = { listDocuments: async () => [SAMPLE_DOC] };
  const tool = byName(createDocumentTools(client), 'search_documents');
  const hit = JSON.parse((await tool.handler({ query: 'x', tags: ['k8s'] })).content[0].text);
  assert.equal(hit.length, 1);
  const miss = JSON.parse((await tool.handler({ query: 'x', tags: ['absent'] })).content[0].text);
  assert.equal(miss.length, 0);
});

test('get_document rejects a bad UUID before calling the client', async () => {
  let called = false;
  const client = { getDocument: async () => { called = true; } };
  const tool = byName(createDocumentTools(client), 'get_document');
  const res = await tool.handler({ id: 'nope' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /valid UUID/);
  assert.equal(called, false);
});

test('get_document returns a friendly message when missing', async () => {
  const client = { getDocument: async () => null };
  const tool = byName(createDocumentTools(client), 'get_document');
  const res = await tool.handler({ id: SAMPLE_DOC.id });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No document with id/);
});

test('get_document returns the full document when found', async () => {
  const client = { getDocument: async () => SAMPLE_DOC };
  const tool = byName(createDocumentTools(client), 'get_document');
  const res = await tool.handler({ id: SAMPLE_DOC.id });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0].text), SAMPLE_DOC);
});

test('create_document forwards args to the client', async () => {
  let received;
  const client = { createDocument: async (p) => { received = p; return { id: 'new', ...p }; } };
  const tool = byName(createDocumentTools(client), 'create_document');
  const payload = { title: 'New', body: 'b', documentType: 'note', context: 'work', tags: ['x'] };
  const res = await tool.handler(payload);
  assert.deepEqual(received, payload);
  assert.equal(JSON.parse(res.content[0].text).id, 'new');
});

test('update_document rejects empty patches and bad UUIDs', async () => {
  const client = { updateDocument: async () => ({}) };
  const tools = createDocumentTools(client);
  const tool = byName(tools, 'update_document');
  assert.match((await tool.handler({ id: 'bad', title: 'x' })).content[0].text, /valid UUID/);
  assert.match((await tool.handler({ id: SAMPLE_DOC.id })).content[0].text, /at least one field/);
});

test('update_document returns missing message on null result', async () => {
  const client = { updateDocument: async () => null };
  const tool = byName(createDocumentTools(client), 'update_document');
  const res = await tool.handler({ id: SAMPLE_DOC.id, title: 'x' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No document with id/);
});
