import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { createOpenAiChat } from '../../server/chat/openai.js';
import { buildRunbookMessages, parseGeneratedRunbook, runbookTitleFromDescription } from '../../server/generateRunbook.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

// ---- pure helpers ----
test('buildRunbookMessages encodes the runbook contract + the description', () => {
  const m = buildRunbookMessages('Postgres primary is down, replicas lagging');
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /checkbox/i);
  assert.match(m[0].content, /Rollback/);
  assert.match(m[1].content, /Postgres primary is down/);
});

test('parseGeneratedRunbook takes the first H1 as the title, keeps the body, ignores ## sections', () => {
  const md = '# Postgres failover\n\nPromote the standby.\n\n## Mitigation\n- [ ] Stop writes';
  const r = parseGeneratedRunbook(md, 'anything');
  assert.equal(r.title, 'Postgres failover');
  assert.equal(r.body, md.trim());
});

test('parseGeneratedRunbook falls back to a description-derived title when no H1', () => {
  const r = parseGeneratedRunbook('## Steps\n- [ ] do it', 'Kafka consumer lag is spiking. Investigate.');
  assert.equal(r.title, 'Runbook: Kafka consumer lag is spiking');
  assert.equal(runbookTitleFromDescription(''), 'Generated runbook');
});

// ---- route ----
function makeApp({ chat } = {}) {
  const created = [];
  const documents = new Map();
  const receipts = new Map();
  const toRecord = (d, fallbackId = 'rb1') => {
    const { creationOperation, creationIntentHash, ...publicFields } = d;
    const rec = { id: d.id || fallbackId, ...publicFields, verified: (d.updatedBy || 'user') !== 'agent', status: 'active' };
    documents.set(rec.id, rec);
    if (creationOperation || creationIntentHash) receipts.set(rec.id, { operation: creationOperation, intentHash: creationIntentHash });
    created.push(rec);
    return rec;
  };
  const library = {
    createDocument: async (d) => toRecord(d),
    async createDocumentIdempotent(d) {
      if (documents.has(d.id)) return { document: documents.get(d.id), created: false };
      return { document: toRecord(d), created: true };
    },
    getDocument: async (id) => documents.get(id) || null,
    getDocumentCreationReceipt: async (id) => receipts.get(id) || null,
    listDocuments: async () => [],
  };
  const app = buildApp({
    skipDb: true,
    libraryRepository: library,
    projectsRepository: { resolveProject: async (v) => (v === 'homelab' ? { id: PROJECT_ID, slug: 'homelab' } : null) },
    documentLinksRepository: { listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    chat: chat ?? null,
  });
  return app.then((a) => ({ app: a, created }));
}

test('POST generate creates an agent-written runbook from the model output', async () => {
  let seen;
  const chat = { backend: 'fake', model: 'fake-chat', async complete(m) { seen = m; return { text: '# Postgres failover\n\nPromote the standby.\n\n## Mitigation\n- [ ] Stop writes at PgBouncer\n- [ ] Promote the standby', model: 'fake-chat' }; } };
  const { app } = await makeApp({ chat });
  const res = await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { description: 'Postgres primary down', project: 'homelab' } });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.model, 'fake-chat');
  assert.equal(body.document.documentType, 'runbook');
  assert.equal(body.document.kind, 'synthesized');
  assert.deepEqual(body.document.tags, ['draft']);
  assert.equal(body.document.verified, false);              // agent-written → needs verify
  assert.equal(body.document.title, 'Postgres failover');
  assert.match(body.document.body, /- \[ \] Stop writes at PgBouncer/);
  assert.match(seen[1].content, /Postgres primary down/);   // model saw the description
  await app.close();
});

test('POST generate replays a stable result id without invoking the model twice and rejects changed intent', async () => {
  let calls = 0;
  const chat = { backend: 'fake', model: 'f', async complete() { calls += 1; return { text: '# Stable runbook\n- [ ] Act', model: 'f' }; } };
  const { app } = await makeApp({ chat });
  const id = '11111111-1111-4111-8111-111111111111';
  const payload = { id, description: 'pg down', project: 'homelab' };
  const first = await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().replayed, false);
  const replay = await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replayed, true);
  assert.equal(replay.json().document.id, id);
  assert.equal(calls, 1);
  const conflict = await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { ...payload, description: 'different' } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(calls, 1);
  await app.close();
});

test('a replay that arrives while the generation is still running waits for it instead of generating again', async () => {
  // An agent whose client timed out retries with the same id while the model
  // is still writing: there is no durable receipt yet, only the in-flight one.
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chat = { backend: 'fake', model: 'f', async complete() { calls += 1; await gate; return { text: '# Slow runbook\n- [ ] Act', model: 'f' }; } };
  const { app, created } = await makeApp({ chat });
  const id = '22222222-2222-4222-8222-222222222222';
  const payload = { id, description: 'pg down', project: 'homelab' };
  const first = app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload });
  while (calls === 0) await new Promise((resolve) => setImmediate(resolve)); // the model is writing
  const replay = app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload });
  const changed = await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { ...payload, description: 'other' } });
  assert.equal(changed.statusCode, 409); // a different intent under an in-flight id
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  const [a, b] = await Promise.all([first, replay]);
  assert.equal(a.statusCode, 201);
  assert.equal(b.statusCode, 200);
  assert.equal(b.json().replayed, true);
  assert.equal(b.json().document.id, id);
  assert.equal(calls, 1);
  assert.equal(created.length, 1);
  await app.close();
});

test('a replay waiting on a failed generation gets the failure, and a later retry may generate', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chat = {
    backend: 'fake', model: 'f',
    async complete() { calls += 1; if (calls === 1) { await gate; throw new Error('provider 500'); } return { text: '# Second try', model: 'f' }; },
  };
  const { app } = await makeApp({ chat });
  const payload = { id: '33333333-3333-4333-8333-333333333333', description: 'pg down', project: 'homelab' };
  const first = app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload });
  while (calls === 0) await new Promise((resolve) => setImmediate(resolve)); // the model is writing
  const replay = app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload });
  // Let the replay reach the in-flight claim before the generation fails.
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  const [a, b] = await Promise.all([first, replay]);
  assert.equal(a.statusCode, 502);
  assert.equal(b.statusCode, 502);
  const retry = await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload });
  assert.equal(retry.statusCode, 201);
  assert.equal(calls, 2);
  await app.close();
});

test('POST generate requires a chat model (409) and surfaces a generation failure (502)', async () => {
  const { app } = await makeApp({ chat: null });
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { description: 'x', project: 'homelab' } })).statusCode, 409);
  await app.close();

  const boom = { backend: 'fake', model: 'boom', async complete() { throw new Error('provider 500'); } };
  const { app: app2 } = await makeApp({ chat: boom });
  const res = await app2.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { description: 'x', project: 'homelab' } });
  assert.equal(res.statusCode, 502);
  assert.match(res.json().message, /generation failed/);
  await app2.close();
});

test('POST generate validates description + project', async () => {
  const chat = { backend: 'fake', model: 'f', async complete() { return { text: '# T', model: 'f' }; } };
  const { app } = await makeApp({ chat });
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { project: 'homelab' } })).statusCode, 400); // no description
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { description: 'x' } })).statusCode, 400); // no project
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { description: 'x', project: 'nope' } })).statusCode, 400); // bad project
  await app.close();
});

// Regression (2026-09-22 review, bbaf70f1): a runbook cut off by the token
// limit was committed (201) mid-command. A truncated generation is refused.
test('POST generate refuses a generation cut off by the token limit and saves nothing', async () => {
  const fetch = async () => ({ ok: true, json: async () => ({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'message', content: [{ type: 'output_text', text: '# Postgres failover\n\n- [ ] Run `pg_ctl promote -D /var/lib/postgr' }] }],
  }) });
  const { app, created } = await makeApp({ chat: createOpenAiChat({ apiKey: 'k', model: 'gpt-x', fetch }) });
  const res = await app.inject({ method: 'POST', url: '/api/library/runbooks/generate', payload: { description: 'pg down', project: 'homelab' } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().reason, 'truncated');
  assert.match(res.json().message, /cut off/);
  assert.equal(created.length, 0, 'no document is committed');
  await app.close();
});
