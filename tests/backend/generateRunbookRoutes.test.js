import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
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
  const library = {
    createDocument: async (d) => { const rec = { id: 'rb1', ...d, verified: (d.updatedBy || 'user') !== 'agent', status: 'active' }; created.push(rec); return rec; },
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
