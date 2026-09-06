import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

// Real Fastify app over a real in-memory SQLite database: the atomic
// "remember" write (create-or-update by exact title within a project) is a
// transaction, and these prove the properties the skills rely on.

const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
const app = await buildApp({ config });
const AGENT = { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' };
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

async function upsert(payload, headers = AGENT) {
  const res = await app.inject({ method: 'POST', url: '/api/library/documents/upsert-by-title', headers, payload });
  return { code: res.statusCode, body: res.json() };
}
async function memoryDocs(status) {
  const res = await app.inject({ method: 'GET', url: `/api/library/documents?project=homelab${status ? `&status=${status}` : ''}` });
  return res.json();
}

test('upsert creates when the title is absent, stamped as an unverified synthesized agent write', async () => {
  const { code, body } = await upsert({ id: uuid(1), title: 'Restore runbook', body: 'v1', project: 'homelab', tags: ['memory'], documentType: 'runbook', kind: 'synthesized' });
  assert.equal(code, 201);
  assert.equal(body.created, true);
  assert.equal(body.document.id, uuid(1));
  assert.equal(body.document.documentType, 'runbook');
  assert.equal(body.document.updatedBy, 'agent');
  assert.equal(body.document.updatedByAgent, 'codex');
  assert.equal(body.document.kind, 'synthesized');
  assert.equal(body.document.verified, false);
  assert.equal(body.document.status, 'active');
});

test('upsert updates in place on the same title, keeps the stored type unless retyped, and replaces body + tags', async () => {
  const kept = await upsert({ id: uuid(2), title: 'Restore runbook', body: 'v2', project: 'homelab', tags: ['memory', 'pg'] });
  assert.equal(kept.code, 200);
  assert.equal(kept.body.created, false);
  assert.equal(kept.body.document.id, uuid(1), 'the existing document is reused, the new id is not');
  assert.equal(kept.body.document.documentType, 'runbook');
  assert.equal(kept.body.document.body, 'v2');
  assert.deepEqual(kept.body.document.tags, ['memory', 'pg']);

  const retyped = await upsert({ title: 'Restore runbook', body: 'v3', project: 'homelab', documentType: 'decision' });
  assert.equal(retyped.body.document.documentType, 'decision');
  assert.equal((await memoryDocs()).filter((d) => d.title === 'Restore runbook').length, 1);
});

test('upsert never revives a superseded title: the memory becomes a new active document', async () => {
  const oldDoc = (await upsert({ id: uuid(3), title: 'Old approach', body: 'old', project: 'homelab' })).body.document;
  const replacement = (await upsert({ id: uuid(4), title: 'New approach', body: 'new', project: 'homelab' })).body.document;
  const sup = await app.inject({ method: 'POST', url: `/api/library/documents/${oldDoc.id}/supersede`, payload: { supersededBy: replacement.id } });
  assert.equal(sup.statusCode, 200);
  assert.equal(sup.json().status, 'superseded');

  const again = await upsert({ id: uuid(5), title: 'Old approach', body: 'fresh memory under a retired title', project: 'homelab' });
  assert.equal(again.code, 201);
  assert.equal(again.body.created, true);
  assert.equal(again.body.document.id, uuid(5));
  const retired = (await app.inject({ method: 'GET', url: `/api/library/documents/${oldDoc.id}` })).json();
  assert.equal(retired.status, 'superseded');
  assert.equal(retired.body, 'old', 'the retired document is left untouched');
});

test('concurrent upserts of one new title from several agents produce exactly one document', async () => {
  const writers = ['claude', 'codex', 'aider', 'claude', 'codex'];
  const results = await Promise.all(writers.map((agent, i) => upsert(
    { id: uuid(10 + i), title: 'Race title', body: `from ${agent} ${i}`, project: 'homelab' },
    { 'x-prax-origin': 'agent', 'x-prax-agent': agent },
  )));
  const created = results.filter((r) => r.body.created).length;
  assert.equal(created, 1);
  assert.equal(results.every((r) => r.code === 200 || r.code === 201), true);
  const docs = (await memoryDocs()).filter((d) => d.title === 'Race title');
  assert.equal(docs.length, 1);
});

test('upsert is retry-safe: replaying the same id returns the created document without a duplicate', async () => {
  const first = await upsert({ id: uuid(20), title: 'Retry me', body: 'once', project: 'homelab' });
  assert.equal(first.code, 201);
  const replay = await upsert({ id: uuid(20), title: 'Retry me', body: 'once', project: 'homelab' });
  assert.equal(replay.code, 200);
  assert.equal(replay.body.document.id, uuid(20));
  assert.equal((await memoryDocs()).filter((d) => d.title === 'Retry me').length, 1);
});

test('upsert validates its payload and project', async () => {
  assert.equal((await upsert({ body: 'no title', project: 'homelab' })).code, 400);
  assert.equal((await upsert({ title: 'T', body: 'b', project: 'homelab', documentType: 'wiki' })).code, 400);
  assert.equal((await upsert({ title: 'T', body: 'b', project: 'nope-such-project' })).code, 400);
  assert.equal((await upsert({ title: 'T', body: 'b', project: 'homelab', kind: 'weird' })).code, 400);
});

test('a human upsert (no origin header) stays user-authored with no agent id', async () => {
  const { body } = await upsert({ title: 'Human note', body: 'typed', project: 'homelab' }, {});
  assert.equal(body.document.updatedBy, 'user');
  assert.equal(body.document.updatedByAgent, null);
  assert.equal(body.document.verified, true);
});

// --- operation receipts (QINV-03): a retry is exact-once for updates too -----------

test('a replayed remember never re-applies its old body over a newer accepted write', async () => {
  const a = await upsert({ id: uuid(30), title: 'Retry review', body: 'A: original', project: 'homelab' });
  assert.equal(a.code, 201);
  const b = await upsert({ id: uuid(31), title: 'Retry review', body: 'B: newer accepted memory', project: 'homelab' });
  assert.equal(b.code, 200);
  assert.equal(b.body.document.id, a.body.document.id);

  const replayA = await upsert({ id: uuid(30), title: 'Retry review', body: 'A: original', project: 'homelab' });
  assert.equal(replayA.code, 200);
  assert.equal(replayA.body.replayed, true);
  assert.equal(replayA.body.document.body, 'B: newer accepted memory', 'the replay reports the current document, it does not revert it');

  const replayB = await upsert({ id: uuid(31), title: 'Retry review', body: 'B: newer accepted memory', project: 'homelab' });
  assert.equal(replayB.code, 200);
  assert.equal(replayB.body.replayed, true);
  const stored = (await app.inject({ method: 'GET', url: `/api/library/documents/${a.body.document.id}` })).json();
  assert.equal(stored.body, 'B: newer accepted memory');
  assert.equal((await memoryDocs()).filter((d) => d.title === 'Retry review').length, 1);
});

test('reusing an operation id with different content is a conflict, for creates and for updates', async () => {
  const created = await upsert({ id: uuid(40), title: 'Intent A', body: 'first', project: 'homelab' });
  assert.equal(created.code, 201);
  const changedCreate = await upsert({ id: uuid(40), title: 'Intent A', body: 'changed intent under the same id', project: 'homelab' });
  assert.equal(changedCreate.code, 409);

  const updated = await upsert({ id: uuid(41), title: 'Intent A', body: 'second', project: 'homelab' });
  assert.equal(updated.code, 200);
  assert.equal(updated.body.created, false);
  const changedUpdate = await upsert({ id: uuid(41), title: 'Intent A', body: 'third, but claiming to be second', project: 'homelab' });
  assert.equal(changedUpdate.code, 409);
  const retitled = await upsert({ id: uuid(41), title: 'Intent A renamed', body: 'second', project: 'homelab' });
  assert.equal(retitled.code, 409, 'a different title under an update id is a different intent');

  const stored = (await app.inject({ method: 'GET', url: `/api/library/documents/${created.body.document.id}` })).json();
  assert.equal(stored.body, 'second');
  assert.equal((await memoryDocs()).filter((d) => d.title.startsWith('Intent A')).length, 1);
});

test('a replay whose document was permanently deleted is 410, never a silent recreate', async () => {
  const created = await upsert({ id: uuid(50), title: 'Deleted later', body: 'gone soon', project: 'homelab' });
  assert.equal(created.code, 201);
  const del = await app.inject({ method: 'DELETE', url: `/api/library/documents/${created.body.document.id}/permanent` });
  assert.equal(del.statusCode, 200);

  const replay = await upsert({ id: uuid(50), title: 'Deleted later', body: 'gone soon', project: 'homelab' });
  assert.equal(replay.code, 410);
  assert.equal((await memoryDocs()).filter((d) => d.title === 'Deleted later').length, 0);

  const fresh = await upsert({ id: uuid(51), title: 'Deleted later', body: 'gone soon', project: 'homelab' });
  assert.equal(fresh.code, 201, 'a new operation id writes the memory again deliberately');
});

test('a replayed update keeps the retype and tags the original operation asked for, and does not bump the revision', async () => {
  const first = await upsert({ id: uuid(60), title: 'Retype me', body: 'v1', project: 'homelab' });
  const retype = await upsert({ id: uuid(61), title: 'Retype me', body: 'v2', project: 'homelab', tags: ['pg'], documentType: 'decision' });
  assert.equal(retype.code, 200);
  const before = (await app.inject({ method: 'GET', url: `/api/library/documents/${first.body.document.id}` })).json();
  const replay = await upsert({ id: uuid(61), title: 'Retype me', body: 'v2', project: 'homelab', tags: ['pg'], documentType: 'decision' });
  assert.equal(replay.code, 200);
  assert.equal(replay.body.replayed, true);
  const after = (await app.inject({ method: 'GET', url: `/api/library/documents/${first.body.document.id}` })).json();
  assert.equal(after.revision, before.revision);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.documentType, 'decision');
  assert.deepEqual(after.tags, ['pg']);
});

test.after(async () => { await app.close(); });
