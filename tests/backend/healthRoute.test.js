import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const P = '00000000-0000-4000-8000-000000000001';

function makeApp() {
  const active = [
    { id: 'd1', title: 'Good runbook', documentType: 'runbook', projectId: P, verified: true, updatedBy: 'user', body: '# Good\n- [ ] step' },
    { id: 'd2', title: 'AI draft', documentType: 'note', projectId: P, verified: false, updatedBy: 'agent', body: 'drafted by AI' },
    { id: 'd3', title: 'Empty stub', documentType: 'note', projectId: P, verified: true, updatedBy: 'user', body: '   ' },
  ];
  return buildApp({
    skipDb: true,
    libraryRepository: { listDocuments: async () => active },
    documentLinksRepository: {
      // link repo rows use `documentId`, not `id`
      listStaleDocuments: async () => [{ documentId: 'd1', title: 'Good runbook', documentType: 'runbook', projectId: P, updatedBy: 'user' }],
      listOutboundLinksForDocuments: async () => new Map(),
    },
    projectsRepository: { resolveProject: async () => ({ id: P, slug: 'homelab' }) },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
  });
}

test('GET /api/library/health buckets docs and maps documentId → id', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/api/library/health' });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  // needs review = unverified (the agent draft)
  assert.deepEqual(b.needsReview.map((d) => d.id), ['d2']);
  assert.equal(b.needsReview[0].updatedBy, 'agent');
  // empty = whitespace-only body
  assert.deepEqual(b.empty.map((d) => d.id), ['d3']);
  // Stale rows carry `documentId`; health normalizes it to `id`.
  assert.equal(b.stale[0].id, 'd1');
  assert.equal('orphans' in b, false);
  assert.deepEqual(b.counts, { needsReview: 1, stale: 1, empty: 1 });
  await app.close();
});

test('GET /api/library/health rejects an unknown project', async () => {
  const app = await buildApp({
    skipDb: true,
    libraryRepository: { listDocuments: async () => [] },
    documentLinksRepository: { listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
    projectsRepository: { resolveProject: async () => null },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
  });
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/health?project=nope' })).statusCode, 400);
  await app.close();
});
