import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
async function setup(t, options = {}) {
  const app = await buildApp({ config, ...options }); t.after(() => app.close());
  const projects = (await app.inject('/api/projects')).json();
  const work = projects.find(p => p.slug === 'work');
  async function call(method, url, payload, status = 200) {
    const r = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    assert.equal(r.statusCode, status, r.body); return r.json();
  }
  async function seed(kind, extra = {}) {
    return kind === 'task' ? call('POST', '/api/tasks', { title: 'Deploy Prax', project: 'inbox', priority: 'medium', status: 'planned', ...extra }, 201)
      : call('POST', '/api/library/documents', { title: 'Deploy Prax', body: 'Release procedure', project: 'inbox', documentType: 'note', ...extra }, 201);
  }
  async function intent(kind, record, action, extra = {}) {
    const source = await call('GET', `/api/inbox/items/${kind}/${record.id}`);
    return { operationId: randomUUID(), fingerprint: source.fingerprint, action, ...(['file','reference'].includes(action) ? { projectId: work.id } : {}), ...extra };
  }
  return { app, call, seed, intent, work };
}

test('Inbox pages and aging include tasks and notes, exclude completed work and saved reviews', async t => {
  const { app, call, seed } = await setup(t);
  await seed('task'); await seed('document'); await seed('task', { status: 'completed' });
  await seed('document', { title: 'Weekly review', tags: ['weekly-review'] });
  await app.db.query("update tasks set created_at = '2020-01-01T00:00:00Z'");
  const page = await call('GET', '/api/inbox?limit=1');
  assert.equal(page.summary.total, 2); assert.equal(page.summary.notes, 1); assert.equal(page.summary.tasks, 1);
  assert.equal(page.summary.olderThanWeek, 1); assert.equal(page.reviewCount, 1);
  assert.equal(page.page.total, 2); assert.equal(page.page.hasMore, true);
  assert.equal((await call('GET', '/api/inbox?limit=1&offset=1')).page.hasMore, false);
  assert.equal((await call('GET', '/api/inbox?view=reviews')).page.total, 1);
});

test('file and plan commit once, preserve later work on replay, and guard undo', async t => {
  const { app, call, seed, intent, work } = await setup(t);
  const task = await seed('task'); const input = await intent('task', task, 'file', { plannedFor: '2030-03-25' });
  const url = `/api/inbox/items/task/${task.id}/actions`;
  const first = await call('POST', url, input);
  assert.equal(first.record.projectId, work.id); assert.equal(first.record.plannedFor, '2030-03-25');
  assert.equal((await call('POST', url, input)).replayed, true);
  assert.equal((await app.db.query('select count(*) as n from inbox_action_receipts')).rows[0].n, 1);
  await call('PATCH', `/api/tasks/${task.id}`, { title: 'Newer title' });
  assert.equal((await call('POST', url, input)).record.title, 'Newer title');
  assert.equal((await call('POST', `/api/inbox/actions/${input.operationId}/undo`, {}, 409)).reason, 'undo-conflict');
  assert.equal((await call('POST', url, { ...input, plannedFor: '2030-03-26' }, 409)).reason, 'intent-mismatch');
});

for (const kind of ['task', 'document']) {
  test(`${kind} archive and undo are retry-safe, and source changes refuse stale decisions`, async t => {
    const { call, seed, intent } = await setup(t);
    const record = await seed(kind); const input = await intent(kind, record, 'archive');
    const url = `/api/inbox/items/${kind}/${record.id}/actions`;
    assert.ok((await call('POST', url, input)).record.archivedAt);
    const undone = await call('POST', `/api/inbox/actions/${input.operationId}/undo`, {});
    assert.equal(undone.undone, true); assert.equal(undone.record.archivedAt, null);
    assert.equal((await call('POST', `/api/inbox/actions/${input.operationId}/undo`, {})).replayed, true);
    assert.equal((await call('POST', url, input)).undone, true, 'replay never reapplies an undone action');
    assert.equal((await call('POST', url, { ...input, operationId: randomUUID() }, 409)).reason, 'item-changed');
  });
}

test('task reference retains checklist, links, unverified provenance, and archives the copy on undo', async t => {
  const { app, call, seed, intent, work } = await setup(t);
  const task = await seed('task', { notes: 'Preserve these notes', labels: ['release'] });
  await call('POST', `/api/tasks/${task.id}/checklist`, { label: 'Verify downloads' }, 201);
  const input = await intent('task', task, 'reference');
  const result = await call('POST', `/api/inbox/items/task/${task.id}/actions`, input);
  const doc = result.created[0].record;
  assert.ok(result.record.archivedAt); assert.equal(doc.documentType, 'reference'); assert.equal(doc.projectId, work.id);
  assert.equal(doc.verified, false); assert.equal(doc.updatedBy, 'agent'); assert.match(doc.body, /Preserve these notes/); assert.match(doc.body, /Verify downloads/);
  assert.equal((await app.db.query('select count(*) as n from task_documents where task_id = $1', [task.id])).rows[0].n, 1);
  const undone = await call('POST', `/api/inbox/actions/${input.operationId}/undo`, {});
  assert.equal(undone.record.archivedAt, null); assert.ok(undone.created[0].record.archivedAt);
});

test('recurring completion creates one successor and undo retains it in Archive', async t => {
  const { call, seed, intent } = await setup(t);
  const task = await seed('task', { recurrence: 'daily', dueDate: '2030-01-01' });
  const input = await intent('task', task, 'complete'); const url = `/api/inbox/items/task/${task.id}/actions`;
  const result = await call('POST', url, input);
  assert.equal(result.record.status, 'completed'); assert.equal(result.created.length, 1); assert.equal(result.created[0].record.dueDate, '2030-01-02');
  assert.equal((await call('POST', url, input)).created[0].id, result.created[0].id);
  const undone = await call('POST', `/api/inbox/actions/${input.operationId}/undo`, {});
  assert.equal(undone.record.status, 'planned'); assert.equal(undone.record.recurrence, 'daily'); assert.ok(undone.created[0].record.archivedAt);
});

test('metadata filing preserves document authorship and verification; deleted receipts never recreate', async t => {
  const { app, call, seed, intent, work } = await setup(t);
  const doc = await seed('document'); const input = await intent('document', doc, 'file', { documentType: 'decision' });
  const url = `/api/inbox/items/document/${doc.id}/actions`;
  const result = await call('POST', url, input);
  assert.equal(result.record.verified, doc.verified); assert.equal(result.record.updatedBy, doc.updatedBy);
  assert.equal(result.record.documentType, 'decision'); assert.equal(result.record.projectId, work.id);
  await app.db.query('delete from markdown_documents where id = $1', [doc.id]);
  const replay = await call('POST', url, input, 410); assert.equal(replay.committed, true);
});

test('concurrent decisions have one winner; checklist edits invalidate a prepared decision', async t => {
  const { app, call, seed, intent } = await setup(t);
  const task = await seed('task'); const input = await intent('task', task, 'archive');
  await call('POST', `/api/tasks/${task.id}/checklist`, { label: 'Added later' }, 201);
  const url = `/api/inbox/items/task/${task.id}/actions`;
  await call('POST', url, input, 409);
  const fresh = await intent('task', task, 'archive');
  const replies = await Promise.all([fresh, { ...fresh, operationId: randomUUID() }].map(payload => app.inject({ method: 'POST', url, payload })));
  assert.deepEqual(replies.map(r => r.statusCode).sort(), [200, 409]);
});

test('reference creation rolls back source, generated document, link and receipt together on failure', async t => {
  const { app, call, seed, intent } = await setup(t);
  const task = await seed('task'); const input = await intent('task', task, 'reference');
  await app.db.query("create trigger fail_inbox_link before insert on task_documents begin select raise(abort, 'injected link failure'); end");
  const before = (await app.db.query('select count(*) as n from markdown_documents')).rows[0].n;
  await call('POST', `/api/inbox/items/task/${task.id}/actions`, input, 500);
  assert.equal((await call('GET', `/api/tasks/${task.id}`)).archivedAt, null);
  assert.equal((await app.db.query('select count(*) as n from markdown_documents')).rows[0].n, before);
  assert.equal((await app.db.query('select count(*) as n from inbox_action_receipts')).rows[0].n, 0);
  await app.db.query('drop trigger fail_inbox_link');
  assert.equal((await call('POST', `/api/inbox/items/task/${task.id}/actions`, input)).created.length, 1);
});

test('undo refuses edits to a generated reference without changing the original task', async t => {
  const { app, call, seed, intent } = await setup(t);
  const task = await seed('task'); const input = await intent('task', task, 'reference');
  const result = await call('POST', `/api/inbox/items/task/${task.id}/actions`, input);
  await app.db.query('update markdown_documents set body = $2 where id = $1', [result.created[0].id, 'Later human edit']);
  await call('POST', `/api/inbox/actions/${input.operationId}/undo`, {}, 409);
  assert.ok((await call('GET', `/api/tasks/${task.id}`)).archivedAt);
  assert.equal((await call('GET', `/api/library/documents/${result.created[0].id}`)).body, 'Later human edit');
});

test('AI suggestions disclose bounds, validate IDs, and leave all records and receipts unchanged', async t => {
  let respond, prompt;
  const chat = { async complete(messages) { prompt = JSON.parse(messages[1].content); return { text: await respond() }; } };
  const { app, call, seed, intent, work } = await setup(t, { chat });
  const task = await seed('task', { notes: 'x'.repeat(9000) });
  const duplicate = await seed('document', { title: 'Deploy Prax existing guide', project: 'work' });
  const input = await intent('task', task, 'archive');
  const url = `/api/inbox/items/task/${task.id}/suggest`;
  respond = () => JSON.stringify({ projectId: work.id, documentType: 'reference', reason: 'Related release guidance', duplicates: [{ kind: 'document', id: duplicate.id, title: '<script>invented</script>', reason: 'May cover this procedure' }] });
  const suggestion = await call('POST', url, { fingerprint: input.fingerprint });
  assert.equal(suggestion.advisory, true); assert.equal(suggestion.duplicates[0].title, duplicate.title);
  assert.equal(suggestion.coverage.sourceTruncated, true); assert.equal(prompt.item.text.length, 8000);
  assert.deepEqual(prompt.documentTypes, ['reference']);
  assert.equal((await call('GET', `/api/inbox/items/task/${task.id}`)).fingerprint, input.fingerprint);
  assert.equal((await app.db.query('select count(*) as n from inbox_action_receipts')).rows[0].n, 0);
  for (const output of ['not json', JSON.stringify({ projectId: randomUUID(), reason: 'Guess', duplicates: [] }),
    JSON.stringify({ projectId: work.id, documentType: 'decision', reason: 'Unsupported conversion', duplicates: [] }),
    JSON.stringify({ reason: 'Unknown match', duplicates: [{ kind: 'task', id: randomUUID(), reason: '?' }] })]) {
    respond = () => output;
    assert.equal((await call('POST', url, { fingerprint: input.fingerprint }, 502)).reason, 'invalid-suggestion');
  }
  respond = async () => { await app.db.query('update tasks set title = $2 where id = $1', [task.id, 'Changed during AI request']); return JSON.stringify({ reason: 'Old suggestion', duplicates: [] }); };
  assert.equal((await call('POST', url, { fingerprint: input.fingerprint }, 409)).reason, 'item-changed');
});

test('unavailable AI and provider failures stay explicit and do not expose provider diagnostics', async t => {
  for (const chat of [null, { async complete() { throw new Error('private-provider-secret'); } }]) {
    const { call, seed, intent } = await setup(t, { chat, chatProvider: { getChat: async () => chat } });
    const task = await seed('task'); const input = await intent('task', task, 'archive');
    const result = await call('POST', `/api/inbox/items/task/${task.id}/suggest`, { fingerprint: input.fingerprint }, 503);
    assert.match(result.message, /manually|Manual processing/); assert.doesNotMatch(result.message, /private-provider/);
  }
});

test('a committed receipt survives a server restart and remains undoable', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'prax-inbox-restart-'));
  const diskConfig = loadConfig({ PRAX_DB_FILE: join(directory, 'library.sqlite'), EMBEDDING_BACKEND: 'none' });
  let app = await buildApp({ config: diskConfig });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const task = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Restart receipt', project: 'inbox', priority: 'medium', status: 'planned' } })).json();
  const source = (await app.inject(`/api/inbox/items/task/${task.id}`)).json();
  const payload = { operationId: randomUUID(), fingerprint: source.fingerprint, action: 'archive' };
  const url = `/api/inbox/items/task/${task.id}/actions`;
  assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 200);
  await app.close(); app = await buildApp({ config: diskConfig });
  const replay = await app.inject({ method: 'POST', url, payload }); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true);
  const undo = await app.inject({ method: 'POST', url: `/api/inbox/actions/${payload.operationId}/undo`, payload: {} });
  assert.equal(undo.statusCode, 200); assert.equal(undo.json().record.archivedAt, null);
});
