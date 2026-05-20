import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkTools } from '../../mcp/tools/links.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

test('exposes the three link tools', () => {
  const names = createLinkTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['link_task_document', 'list_task_documents', 'unlink_task_document']);
});

test('list_task_documents validates the task UUID', async () => {
  let called = false;
  const client = { listTaskDocuments: async () => { called = true; return []; } };
  const tool = byName(createLinkTools(client), 'list_task_documents');
  const res = await tool.handler({ taskId: 'bad' });
  assert.equal(res.isError, true);
  assert.equal(called, false);
});

test('list_task_documents returns the linked docs', async () => {
  const client = { listTaskDocuments: async () => [{ id: DOC_ID, title: 'Runbook' }] };
  const tool = byName(createLinkTools(client), 'list_task_documents');
  const res = await tool.handler({ taskId: TASK_ID });
  assert.deepEqual(JSON.parse(res.content[0].text), [{ id: DOC_ID, title: 'Runbook' }]);
});

test('list_task_documents caps the result at 20', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `doc-${i}`, title: `Doc ${i}` }));
  const client = { listTaskDocuments: async () => many };
  const tool = byName(createLinkTools(client), 'list_task_documents');
  const res = await tool.handler({ taskId: TASK_ID });
  assert.equal(JSON.parse(res.content[0].text).length, 20);
});

test('link_task_document validates both UUIDs then calls the client', async () => {
  let received;
  const client = { linkTaskDocument: async (t, d) => { received = [t, d]; return [{ id: DOC_ID }]; } };
  const tool = byName(createLinkTools(client), 'link_task_document');
  assert.match((await tool.handler({ taskId: 'bad', documentId: DOC_ID })).content[0].text, /valid UUID/);
  assert.match((await tool.handler({ taskId: TASK_ID, documentId: 'bad' })).content[0].text, /valid UUID/);
  await tool.handler({ taskId: TASK_ID, documentId: DOC_ID });
  assert.deepEqual(received, [TASK_ID, DOC_ID]);
});

test('link_task_document returns a stable confirmation shape with the doc list', async () => {
  const client = { linkTaskDocument: async () => [{ id: DOC_ID, title: 'Runbook' }] };
  const tool = byName(createLinkTools(client), 'link_task_document');
  const res = await tool.handler({ taskId: TASK_ID, documentId: DOC_ID });
  assert.deepEqual(JSON.parse(res.content[0].text), {
    linked: true,
    taskId: TASK_ID,
    documentId: DOC_ID,
    documents: [{ id: DOC_ID, title: 'Runbook' }],
  });
});

test('link_task_document tolerates a non-array client result', async () => {
  const client = { linkTaskDocument: async () => null };
  const tool = byName(createLinkTools(client), 'link_task_document');
  const res = await tool.handler({ taskId: TASK_ID, documentId: DOC_ID });
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.linked, true);
  assert.deepEqual(data.documents, []);
});

test('unlink_task_document validates UUIDs and reports success', async () => {
  let received;
  const client = { unlinkTaskDocument: async (t, d) => { received = [t, d]; return null; } };
  const tool = byName(createLinkTools(client), 'unlink_task_document');
  assert.match((await tool.handler({ taskId: 'bad', documentId: DOC_ID })).content[0].text, /valid UUID/);
  const res = await tool.handler({ taskId: TASK_ID, documentId: DOC_ID });
  assert.deepEqual(received, [TASK_ID, DOC_ID]);
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /unlinked|removed|ok/i);
});
