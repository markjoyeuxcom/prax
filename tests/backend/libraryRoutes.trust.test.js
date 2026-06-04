import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const ID = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

async function build(overrides = {}) {
  const calls = { verify: [], superseded: [], reverted: [], links: [], unlinks: [] };
  const app = await buildApp({
    skipDb: true,
    libraryRepository: {
      async verifyDocument(id, payload) { calls.verify.push({ id, payload }); return { id, verified: payload.verified, verifiedBy: payload.verifiedBy ?? null, status: 'active' }; },
      async markDocumentSuperseded(id) { calls.superseded.push(id); return { id, status: 'superseded' }; },
      async revertSupersededIfOrphan(id) { calls.reverted.push(id); return { id, status: 'active' }; },
      async getDocument(id) { return { id, title: 't', status: 'active' }; },
      ...overrides.library,
    },
    documentLinksRepository: {
      async linkDocuments(s, t, r) { calls.links.push({ s, t, r }); return { linked: true }; },
      async unlinkDocuments(s, t, r) { calls.unlinks.push({ s, t, r }); return true; },
      async listDocumentLinks() { return []; },
      ...overrides.links,
    },
    projectsRepository: { async resolveProject() { return null; } },
  });
  app._calls = calls;
  return app;
}

test('POST verify sets verified true with actor', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: true, as: 'mark' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().verified, true);
  assert.deepEqual(app._calls.verify[0], { id: ID, payload: { verified: true, verifiedBy: 'mark' } });
  await app.close();
});

test('POST verify defaults actor to "user" and supports unverify', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: false } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.verify[0], { id: ID, payload: { verified: false, verifiedBy: null } });
  await app.close();
});

test('POST verify rejects a bad id', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: '/api/library/documents/not-a-uuid/verify', payload: { verified: true } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST supersede links new->old and marks old superseded', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: NEW } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.links[0], { s: NEW, t: ID, r: 'supersedes' });
  assert.deepEqual(app._calls.superseded, [ID]);
  await app.close();
});

test('POST supersede 404s when the link target/source is missing', async () => {
  const app = await build({ links: { async linkDocuments() { return { linked: false }; } } });
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: NEW } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('DELETE supersedes link reverts the target status', async () => {
  const app = await build();
  const res = await app.inject({ method: 'DELETE', url: `/api/library/documents/${NEW}/links/${ID}?relation=supersedes` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.reverted, [ID]);
  await app.close();
});

test('POST verify rejects a non-boolean verified', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: 'yes' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST verify 404s when the document is missing', async () => {
  const app = await build({ library: { async verifyDocument() { return null; } } });
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: true } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('POST supersede rejects an invalid supersededBy', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: 'not-a-uuid' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST supersede rejects superseding itself', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: ID } });
  assert.equal(res.statusCode, 400);
  await app.close();
});
