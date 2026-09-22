import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createPraxClient } from '../../mcp/praxClient.js';
import { createDocumentTools } from '../../mcp/tools/documents.js';

// 2026-09-22 review (728fa105): caller-identified creates decided "exact
// retry" by comparing the payload with the CURRENT row. An identical retry
// after an edit got 409, and one after permanent delete recreated the record.
// Durable receipts (migration 0034, and document_upsert_receipts for MCP's
// operationId) now decide the replay and outlive the record.

async function boot(t) {
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
  t.after(() => app.close());
  return app;
}
const send = (app, method, url, payload, headers) => app.inject({ method, url, payload, headers });
const agent = { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' };

test('task create: an identical retry after an edit replays the current task, not 409', async t => {
  const app = await boot(t);
  const payload = { id: randomUUID(), title: 'Rotate keys', priority: 'medium', status: 'planned', project: 'homelab' };
  assert.equal((await send(app, 'POST', '/api/tasks', payload)).statusCode, 201);
  const edited = await send(app, 'PATCH', `/api/tasks/${payload.id}`, { title: 'Rotate keys today', status: 'in-progress' });
  assert.equal(edited.statusCode, 200, edited.body);

  const retry = await send(app, 'POST', '/api/tasks', payload);
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(retry.json().id, payload.id);
  assert.equal(retry.json().title, 'Rotate keys today', 'the retry returns the current record, not the old intent');
  const activity = (await send(app, 'GET', `/api/tasks/${payload.id}/activity`)).json();
  assert.equal(activity.filter((entry) => entry.eventType === 'created').length, 1, 'the replay logs no second creation');

  const reused = await send(app, 'POST', '/api/tasks', { ...payload, title: 'Something else' });
  assert.equal(reused.statusCode, 409, 'a different intent under the same id still conflicts');
  assert.match(reused.json().message, /different content/);
});

test('task create: an identical retry after permanent delete does not recreate the task', async t => {
  const app = await boot(t);
  const payload = { id: randomUUID(), title: 'Short-lived', priority: 'low', status: 'planned', project: 'homelab' };
  assert.equal((await send(app, 'POST', '/api/tasks', payload)).statusCode, 201);
  assert.equal((await send(app, 'DELETE', `/api/tasks/${payload.id}`)).statusCode, 200);
  const archivedRetry = await send(app, 'POST', '/api/tasks', payload);
  assert.equal(archivedRetry.statusCode, 409);
  assert.match(archivedRetry.json().message, /since been archived/);
  assert.equal((await send(app, 'DELETE', `/api/tasks/${payload.id}/permanent`)).statusCode, 200);

  const retry = await send(app, 'POST', '/api/tasks', payload);
  assert.equal(retry.statusCode, 410, retry.body);
  assert.match(retry.json().message, /permanently deleted/);
  assert.equal((await send(app, 'GET', `/api/tasks/${payload.id}`)).statusCode, 404, 'the task stays deleted');
  // The receipt survives: a later retry is refused the same way.
  assert.equal((await send(app, 'POST', '/api/tasks', payload)).statusCode, 410);
});

test('task create: racing identical requests create once', async t => {
  const app = await boot(t);
  const payload = { id: randomUUID(), title: 'Race', priority: 'medium', status: 'planned', project: 'homelab' };
  const results = await Promise.all([1, 2, 3].map(() => send(app, 'POST', '/api/tasks', payload)));
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 200, 201]);
  const rows = await app.db.query('select count(*) as n from tasks where id = $1', [payload.id]);
  assert.equal(Number(rows.rows[0].n), 1);
});

test('task create: a row without a receipt (pre-0034) keeps the content-matching replay', async t => {
  const app = await boot(t);
  const payload = { id: randomUUID(), title: 'Legacy', priority: 'medium', status: 'planned', project: 'homelab' };
  assert.equal((await send(app, 'POST', '/api/tasks', payload)).statusCode, 201);
  await app.db.query("delete from record_creation_receipts where record_kind = 'task'");
  assert.equal((await send(app, 'POST', '/api/tasks', payload)).statusCode, 200);
  assert.equal((await send(app, 'POST', '/api/tasks', { ...payload, title: 'Changed' })).statusCode, 409);
});

test('checklist item create: replays after completion, and is not recreated after delete', async t => {
  const app = await boot(t);
  const task = (await send(app, 'POST', '/api/tasks', { title: 'Owner', priority: 'medium', status: 'planned', project: 'homelab' })).json();
  const url = `/api/tasks/${task.id}/checklist`;
  const itemId = randomUUID();
  assert.equal((await send(app, 'POST', url, { id: itemId, label: 'Step one' })).statusCode, 201);
  assert.equal((await send(app, 'PATCH', `${url}/${itemId}`, { completed: true })).statusCode, 200);

  const retry = await send(app, 'POST', url, { id: itemId, label: 'Step one' });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().completed, true, 'the replay returns the current item');

  assert.equal((await send(app, 'DELETE', `${url}/${itemId}`)).statusCode, 204);
  const afterDelete = await send(app, 'POST', url, { id: itemId, label: 'Step one' });
  assert.equal(afterDelete.statusCode, 410, afterDelete.body);
  assert.deepEqual((await send(app, 'GET', url)).json(), [], 'the deleted item stays deleted');
  const reused = await send(app, 'POST', url, { id: itemId, label: 'Other step' });
  assert.equal(reused.statusCode, 409, 'a different intent under the same id conflicts');
});

test('document create by id: an identical retry after an edit replays; after delete it is refused', async t => {
  const app = await boot(t);
  const payload = { id: randomUUID(), title: 'Agent note', body: 'first body', documentType: 'note', project: 'homelab' };
  assert.equal((await send(app, 'POST', '/api/library/documents', payload, agent)).statusCode, 201);
  const edited = await send(app, 'PATCH', `/api/library/documents/${payload.id}`, { body: 'human edit' });
  assert.equal(edited.statusCode, 200, edited.body);

  const retry = await send(app, 'POST', '/api/library/documents', payload, agent);
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(retry.json().body, 'human edit', 'the human edit is kept, not reported as a conflict');

  assert.equal((await send(app, 'DELETE', `/api/library/documents/${payload.id}/permanent`)).statusCode, 200);
  const afterDelete = await send(app, 'POST', '/api/library/documents', payload, agent);
  assert.equal(afterDelete.statusCode, 410, afterDelete.body);
  assert.equal((await send(app, 'GET', `/api/library/documents/${payload.id}`)).statusCode, 404, 'the old agent body is not recreated');
});

test('MCP create_document sends operationId and uses the durable receipt path', async t => {
  const app = await boot(t);
  const bodies = [];
  const fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (options.method === 'POST' && u.pathname === '/api/library/documents') bodies.push(JSON.parse(options.body));
    const res = await app.inject({ method: options.method || 'GET', url: u.pathname + u.search, headers: options.headers, payload: options.body });
    return new Response(res.body, { status: res.statusCode, headers: res.headers });
  };
  const tool = createDocumentTools(createPraxClient({ baseUrl: 'http://fixture.invalid', fetch }))
    .find((candidate) => candidate.name === 'create_document');
  const args = { id: randomUUID(), title: 'MCP note', body: 'agent body', documentType: 'note', project: 'homelab' };

  const first = await tool.handler(args);
  assert.ok(!first.isError, first.content[0].text);
  assert.equal(bodies[0].operationId, args.id, 'create_document sends an operationId');
  assert.equal((await send(app, 'PATCH', `/api/library/documents/${args.id}`, { body: 'human edit' })).statusCode, 200);

  const retry = await tool.handler(args);
  assert.ok(!retry.isError, retry.content[0].text);
  assert.equal(JSON.parse(retry.content[0].text).body, 'human edit');
  assert.equal(JSON.parse(retry.content[0].text).replayed, true);

  assert.equal((await send(app, 'DELETE', `/api/library/documents/${args.id}/permanent`)).statusCode, 200);
  const afterDelete = await tool.handler(args);
  assert.equal(afterDelete.isError, true);
  assert.match(afterDelete.content[0].text, /permanently deleted/);
  assert.equal((await send(app, 'GET', `/api/library/documents/${args.id}`)).statusCode, 404);
});
