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

test('POST verify sets verified true with actor, bound to the reviewed revision', async () => {
  const app = await build();
  const revision = 'a'.repeat(64);
  const hash = 'b'.repeat(64);
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: true, as: 'mark', revision: revision.toUpperCase(), contentHash: hash } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().verified, true);
  assert.deepEqual(app._calls.verify[0], { id: ID, payload: { verified: true, verifiedBy: 'mark', revision, contentHash: hash } });
  await app.close();
});

test('POST verify requires the reviewed revision and rejects a malformed one', async () => {
  const app = await build();
  const missing = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: true, as: 'mark', contentHash: 'a'.repeat(64) } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().message, 'revision is required');
  const bad = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: true, revision: 'not-a-token' } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().message, 'revision is invalid');
  assert.deepEqual(app._calls.verify, [], 'nothing reaches the repository without a token');
  await app.close();
});

test('POST verify defaults actor to "user" and supports unverify', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: false } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.verify[0], { id: ID, payload: { verified: false, verifiedBy: null, revision: null, contentHash: null } });
  await app.close();
});

test('POST verify rejects a bad id', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: '/api/library/documents/not-a-uuid/verify', payload: { verified: true } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST supersede delegates one atomic new->old lifecycle link', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: NEW } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.links[0], { s: NEW, t: ID, r: 'supersedes' });
  assert.deepEqual(app._calls.superseded, [], 'the database link trigger owns target status');
  await app.close();
});

test('POST supersede 404s when the link target/source is missing', async () => {
  const app = await build({ links: { async linkDocuments() { return { linked: false }; } } });
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: NEW } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('DELETE supersedes delegates one atomic lifecycle unlink', async () => {
  const app = await build();
  const res = await app.inject({ method: 'DELETE', url: `/api/library/documents/${NEW}/links/${ID}?relation=supersedes` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.reverted, [], 'the database unlink trigger owns target status');
  await app.close();
});

test('POST verify rejects a non-boolean verified', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: 'yes' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST verify rejects a malformed reviewed content hash', async () => {
  const app = await build();
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${ID}/verify`,
    payload: { verified: true, contentHash: 'not-a-sha256' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().message, 'contentHash is invalid');
  await app.close();
});

test('POST verify 404s when the document is missing', async () => {
  const app = await build({ library: { async verifyDocument() { return null; }, async getDocument() { return null; } } });
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: true, revision: 'a'.repeat(64) } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('POST verify rejects a stale reviewed revision and names the current one', async () => {
  const app = await build({ library: {
    async verifyDocument() { return null; },
    async getDocument(id) { return { id, revision: 'b'.repeat(64), contentHash: 'c'.repeat(64) }; },
  } });
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${ID}/verify`,
    payload: { verified: true, as: 'mark', revision: 'a'.repeat(64) },
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().message, /changed since it was reviewed/);
  assert.equal(res.json().reason, 'revision-mismatch');
  assert.equal(res.json().revision, 'b'.repeat(64));

  // A matching revision with a stale optional body hash is still a mismatch.
  const staleHash = await app.inject({
    method: 'POST', url: `/api/library/documents/${ID}/verify`,
    payload: { verified: true, as: 'mark', revision: 'b'.repeat(64), contentHash: 'a'.repeat(64) },
  });
  assert.equal(staleHash.statusCode, 409);
  await app.close();
});

test('POST verify same-state replay returns the first verification without overwriting it', async () => {
  const first = { id: ID, verified: true, verifiedBy: 'mark', verifiedAt: '2026-07-13T10:00:00.000Z', revision: 'a'.repeat(64), contentHash: 'b'.repeat(64) };
  const app = await build({ library: {
    async verifyDocument() { return null; },
    async getDocument() { return first; },
  } });
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${ID}/verify`,
    payload: { verified: true, as: 'mark', revision: first.revision, contentHash: first.contentHash },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), first);
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

function buildPack(overrides = {}) {
  return buildApp({
    skipDb: true,
    libraryRepository: {
      async listDocuments(filters) {
        buildPack._lastFilters = filters;
        return [
          { id: 'm', title: 'Decision', body: 'chose X', documentType: 'note', tags: [], verified: true, status: 'active' },
          { id: 'u', title: 'Agent note', body: 'maybe Y', documentType: 'note', tags: [], verified: false, status: 'active' },
        ];
      },
      ...overrides.library,
    },
    projectsRepository: { async resolveProject(v) { return v === 'demo' ? { id: 'p1', slug: 'demo', name: 'Demo', status: 'active' } : null; } },
    embedder: null,
  });
}

test('GET context-pack returns markdown by default', async () => {
  const app = await buildPack();
  const res = await app.inject({ method: 'GET', url: '/api/projects/demo/context-pack' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
  assert.match(res.body, /# Context: Demo/);
  assert.match(res.body, /## ⚠ Unverified/);
  assert.deepEqual(buildPack._lastFilters, { projectId: 'p1', status: 'active' });
  await app.close();
});

test('GET context-pack returns json when asked', async () => {
  const app = await buildPack();
  const res = await app.inject({ method: 'GET', url: '/api/projects/demo/context-pack?format=json' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().project.slug, 'demo');
  await app.close();
});

test('GET context-pack 404s on unknown project', async () => {
  const app = await buildPack();
  const res = await app.inject({ method: 'GET', url: '/api/projects/nope/context-pack' });
  assert.equal(res.statusCode, 404);
  await app.close();
});
