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

test.after(async () => { await app.close(); });
