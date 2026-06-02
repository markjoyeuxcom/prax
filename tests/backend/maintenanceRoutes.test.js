import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const D = '11111111-1111-4111-8111-111111111111';

function build(overrides = {}) {
  return buildApp({
    skipDb: true,
    libraryRepository: { async getDocument() { return null; } },
    projectsRepository: { async resolveProject(v) { return (v === 'homelab' || v === PROJECT_UUID) ? { id: PROJECT_UUID, slug: 'homelab' } : null; } },
    documentLinksRepository: {
      async listStaleDocuments(projectId) { return [{ documentId: D, title: 'Derived', documentType: 'note', kind: 'source', projectId: projectId || null, updatedBy: 'user', staleSources: [] }]; },
      async listOrphanDocuments() { return [{ documentId: D, title: 'Lonely', documentType: 'note', kind: 'source', projectId: null }]; },
      ...overrides,
    },
  });
}

test('GET /api/library/maintenance/stale returns stale docs', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json()[0].documentId, D);
  assert.equal(res.json()[0].updatedBy, 'user');
  await app.close();
});

test('GET stale resolves project slug to id, rejects unknown project', async () => {
  let seen;
  const app = await build({ async listStaleDocuments(projectId) { seen = projectId; return []; } });
  const ok = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale?project=homelab' });
  assert.equal(ok.statusCode, 200);
  assert.equal(seen, PROJECT_UUID);
  const bad = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale?project=nope' });
  assert.equal(bad.statusCode, 400);
  await app.close();
});

test('GET /api/library/maintenance/orphans returns orphans', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/api/library/maintenance/orphans' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json()[0].title, 'Lonely');
  await app.close();
});
