import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { buildRunSummary, postMortemTitle, fallbackPostMortem, buildPostMortemMessages, elapsed } from '../../server/postMortem.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const RUN = {
  id: RUN_ID, documentId: DOC_ID, title: 'Postgres failover', status: 'completed',
  startedBy: 'user', startedAt: '2026-07-09T10:00:00.000Z', finishedAt: '2026-07-09T10:12:00.000Z',
  steps: [
    { id: 's1', position: 0, text: 'Stop writes at PgBouncer', checkedAt: '2026-07-09T10:02:00.000Z', checkedBy: 'user' },
    { id: 's2', position: 1, text: 'Promote the standby', checkedAt: '2026-07-09T10:05:00.000Z', checkedBy: 'agent' },
    { id: 's3', position: 2, text: 'Verify writes', checkedAt: null, checkedBy: null },
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
  assert.match(s, /\[done\] Promote the standby .* \(by agent, \+3m\)/); // gap from previous check
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
  const library = {
    getDocument: async (id) => (id === DOC_ID ? doc : null),
    createDocument: async (d) => { const rec = { id: 'pm1', ...d, verified: (d.updatedBy || 'user') !== 'agent', status: 'active' }; created.push(rec); return rec; },
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
  assert.equal(body.document.documentType, 'note');
  assert.equal(body.document.kind, 'synthesized');
  assert.deepEqual(body.document.tags, ['post-mortem']);
  assert.equal(body.document.verified, false);                 // agent-written → needs human verify
  assert.equal(body.document.projectId, PROJECT_ID);
  assert.match(body.document.title, /^Post-mortem: Postgres failover/);
  assert.match(body.document.body, /Failover completed in 12m/);
  assert.match(seen[1].content, /Stop writes at PgBouncer/);   // the model saw the chronicle
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

test('POST post-mortem: 404 on unknown run, 409 when the runbook is gone, 400 on bad id', async () => {
  const { app } = await makeApp({ chat: null, run: null });
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` })).statusCode, 404);
  await app.close();

  const { app: app2 } = await makeApp({ chat: null, doc: null });
  assert.equal((await app2.inject({ method: 'POST', url: `/api/library/runs/${RUN_ID}/post-mortem` })).statusCode, 409);
  await app2.close();

  const { app: app3 } = await makeApp({ chat: null });
  assert.equal((await app3.inject({ method: 'POST', url: '/api/library/runs/not-a-uuid/post-mortem' })).statusCode, 400);
  await app3.close();
});
