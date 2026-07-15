import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { buildRunSummary, postMortemTitle, fallbackPostMortem, buildPostMortemMessages, elapsed } from '../../server/postMortem.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const RUN = {
  id: RUN_ID, documentId: DOC_ID, documentTitle: 'Postgres failover', projectId: PROJECT_ID,
  title: 'Postgres failover', status: 'completed',
  startedBy: 'user', startedAt: '2026-07-09T10:00:00.000Z',
  finishedAt: '2026-07-09T10:12:00.000Z', finishedBy: 'user',
  steps: [
    { id: 's1', position: 0, text: 'Stop writes at PgBouncer', checkedAt: '2026-07-09T10:04:00.000Z', checkedBy: 'user' },
    { id: 's2', position: 1, text: 'Promote the standby', checkedAt: '2026-07-09T10:05:00.000Z', checkedBy: 'agent' },
    { id: 's3', position: 2, text: 'Verify writes', checkedAt: null, checkedBy: null },
  ],
  events: [
    { sequence: 0, type: 'started', actor: 'user', createdAt: '2026-07-09T10:00:00.000Z' },
    { sequence: 1, type: 'step-checked', stepText: 'Stop writes at PgBouncer', actor: 'user', createdAt: '2026-07-09T10:02:00.000Z' },
    { sequence: 2, type: 'step-unchecked', stepText: 'Stop writes at PgBouncer', actor: 'agent', createdAt: '2026-07-09T10:03:00.000Z' },
    { sequence: 3, type: 'step-checked', stepText: 'Stop writes at PgBouncer', actor: 'user', createdAt: '2026-07-09T10:04:00.000Z' },
    { sequence: 4, type: 'step-checked', stepText: 'Promote the standby', actor: 'agent', createdAt: '2026-07-09T10:05:00.000Z' },
    { sequence: 5, type: 'aborted', actor: 'user', createdAt: '2026-07-09T10:06:00.000Z' },
    { sequence: 6, type: 'resumed', actor: 'user', createdAt: '2026-07-09T10:08:00.000Z' },
    { sequence: 7, type: 'completed', actor: 'user', createdAt: '2026-07-09T10:12:00.000Z' },
  ],
};
const DOC = { id: DOC_ID, title: 'Postgres failover', projectId: PROJECT_ID, body: '# runbook' };

// ---- pure helpers ----
test('elapsed formats minutes / hours', () => {
  assert.equal(elapsed('2026-07-09T10:00:00Z', '2026-07-09T10:12:00Z'), '12m');
  assert.equal(elapsed('2026-07-09T10:00:00Z', '2026-07-09T11:30:00Z'), '1h 30m');
  assert.equal(elapsed('x', 'y'), '');
});

test('buildRunSummary is a factual chronicle: stats, ordered timeline, actors, gaps, undone steps', () => {
  const s = buildRunSummary(RUN, 'Postgres failover');
  assert.match(s, /Status: completed/);
  assert.match(s, /Duration: 12m/);
  assert.match(s, /Steps completed: 2 of 3/);
  assert.match(s, /\[done\] Stop writes at PgBouncer — 2026-07-09T10:02:00.000Z \(by user, \+2m\)/);
  assert.match(s, /\[undone\] Stop writes at PgBouncer .* \(by agent, \+1m\)/);
  assert.match(s, /\[aborted\] Run/);
  assert.match(s, /\[resumed\] Run/);
  assert.match(s, /\[completed\] Run/);
  assert.match(s, /\[not done\] Verify writes/);
});

test('postMortemTitle + fallback + messages', () => {
  assert.equal(postMortemTitle(RUN, 'Postgres failover'), 'Post-mortem: Postgres failover — 2026-07-09');
  const fb = fallbackPostMortem(RUN, buildRunSummary(RUN, 'Postgres failover'), 'Postgres failover');
  for (const h of ['## Summary', '## Timeline', '## What happened', '## Impact', '## Follow-ups']) assert.ok(fb.includes(h));
  assert.match(fb, /No AI model configured/);
  const msgs = buildPostMortemMessages(RUN, 'CHRON', 'Postgres failover');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /post-mortem/i);
  assert.match(msgs[1].content, /CHRON/);
});

// ---- route ----
function makeApp({ chat, run = RUN, doc = DOC } = {}) {
  const created = [];
  const documents = new Map(doc ? [[DOC_ID, doc]] : []);
  const receipts = new Map();
  const toRecord = (d, fallbackId = 'pm1') => {
    const { creationOperation, creationIntentHash, ...publicFields } = d;
    const rec = { id: d.id || fallbackId, ...publicFields, verified: (d.updatedBy || 'user') !== 'agent', status: 'active' };
    documents.set(rec.id, rec);
    if (creationOperation || creationIntentHash) receipts.set(rec.id, { operation: creationOperation, intentHash: creationIntentHash });
    created.push(rec);
    return rec;
  };
  const library = {
    getDocument: async (id) => documents.get(id) || null,
    createDocument: async (d) => toRecord(d),
    async createDocumentIdempotent(d) {
      if (documents.has(d.id)) return { document: documents.get(d.id), created: false };
      return { document: toRecord(d), created: true };
    },
    getDocumentCreationReceipt: async (id) => receipts.get(id) || null,
    listDocuments: async () => [],
  };
  const app = buildApp({
    skipDb: true,
    libraryRepository: library,
    runbookRunsRepository: { getRun: async (id) => (id === RUN_ID ? run : null) },
    projectsRepository: { resolveProject: async () => ({ id: PROJECT_ID, slug: 'homelab' }) },
    documentLinksRepository: { listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    chat: chat ?? null,
  });
  return app.then((a) => ({ app: a, created }));
}

test('POST post-mortem generates via the chat model and creates an agent-written doc', async () => {
  let seen;
  const chat = { backend: 'fake', model: 'fake-chat', async complete(m) { seen = m; return { text: '## Summary\nFailover completed in 12m.', model: 'fake-chat' }; } };
  const { app } = await makeApp({ chat });
  const res = await app.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.generated, true);
  assert.equal(body.model, 'fake-chat');
  assert.equal(body.document.documentType, 'post-mortem'); // first-class type since migration 0010
  assert.equal(body.document.kind, 'synthesized');
  assert.deepEqual(body.document.tags, ['post-mortem']);
  assert.equal(body.document.verified, false);                 // agent-written → needs human verify
  assert.equal(body.document.projectId, PROJECT_ID);
  assert.match(body.document.title, /^Post-mortem: Postgres failover/);
  assert.match(body.document.body, /Failover completed in 12m/);
  assert.match(seen[1].content, /Stop writes at PgBouncer/);   // the model saw the chronicle
  await app.close();
});

test('POST post-mortem replays a stable result id without narrating twice', async () => {
  let calls = 0;
  const chat = { backend: 'fake', model: 'f', async complete() { calls += 1; return { text: '## Summary\nDone', model: 'f' }; } };
  const { app } = await makeApp({ chat });
  const id = '33333333-3333-4333-8333-333333333333';
  const first = await app.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem`, payload: { id } });
  assert.equal(first.statusCode, 201);
  const replay = await app.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem`, payload: { id } });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replayed, true);
  assert.equal(replay.json().document.id, id);
  assert.equal(calls, 1);
  await app.close();
});

test('POST post-mortem falls back to a deterministic draft when no chat model / on failure', async () => {
  const { app } = await makeApp({ chat: null });
  const noModel = await app.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` });
  assert.equal(noModel.statusCode, 201);
  assert.equal(noModel.json().generated, false);
  assert.match(noModel.json().document.body, /## Follow-ups/);
  await app.close();

  const boom = { backend: 'fake', model: 'boom', async complete() { throw new Error('provider 500'); } };
  const { app: app2 } = await makeApp({ chat: boom });
  const failed = await app2.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` });
  assert.equal(failed.statusCode, 201);                        // never 500s on the AI path
  assert.equal(failed.json().generated, false);
  assert.match(failed.json().document.body, /## Follow-ups/);
  await app2.close();
});

test('POST post-mortem: 404 on unknown run, source-independent creation, 409 without a project, 400 on bad id', async () => {
  const { app } = await makeApp({ chat: null, run: null });
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` })).statusCode, 404);
  await app.close();

  const { app: app2 } = await makeApp({ chat: null, doc: null });
  const sourceGone = await app2.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` });
  assert.equal(sourceGone.statusCode, 201);
  assert.match(sourceGone.json().document.title, /Postgres failover/);
  await app2.close();

  const { app: app3 } = await makeApp({ chat: null, doc: null, run: { ...RUN, projectId: null } });
  assert.equal((await app3.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` })).statusCode, 409);
  await app3.close();

  const { app: app4 } = await makeApp({ chat: null });
  assert.equal((await app4.inject({ method: 'POST', url: '/api/library/runs/not-a-uuid/post-mortem' })).statusCode, 400);
  await app4.close();
});
