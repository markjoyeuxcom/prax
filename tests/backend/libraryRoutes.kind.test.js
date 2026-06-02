import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerLibraryRoutes } from '../../server/libraryRoutes.js';

function makeRepoStub() {
  const calls = { create: [], update: [], list: [] };
  const repo = {
    listDocuments: async (filters) => { calls.list.push(filters); return []; },
    createDocument: async (doc) => { calls.create.push(doc); return { id: 'new', ...doc, kind: doc.kind || 'source' }; },
    updateDocument: async (id, fields) => { calls.update.push({ id, fields }); return { id, ...fields }; },
    getDocument: async () => null,
    archiveDocument: async () => null,
    restoreDocument: async () => null,
    deleteArchivedDocument: async () => null,
    listActiveDocumentsForExport: async () => [],
  };
  return { repo, calls };
}

const projectsStub = {
  resolveProject: async (value) =>
    value === 'homelab' ? { id: '00000000-0000-4000-8000-000000000001', slug: 'homelab' } : null,
};
const linksStub = {
  listDocumentLinks: async () => [],
  linkDocuments: async () => ({ linked: true }),
  unlinkDocuments: async () => true,
  listStaleDocuments: async () => [],
  listOrphanDocuments: async () => [],
};

async function buildApp(libraryRepo) {
  const app = Fastify({ logger: false });
  await registerLibraryRoutes(app, {
    libraryRepository: libraryRepo,
    projectsRepository: projectsStub,
    documentLinksRepository: linksStub,
  });
  return app;
}

test('POST /api/library/documents accepts valid kind', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab', kind: 'synthesized' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(calls.create[0].kind, 'synthesized');
});

test('POST /api/library/documents rejects invalid kind', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp(repo);
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab', kind: 'bogus' },
  });
  assert.equal(res.statusCode, 400);
});

test('POST /api/library/documents defaults kind when omitted', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(calls.create[0].kind, undefined, 'route forwards undefined; repo applies default');
});

test('PATCH /api/library/documents/:id accepts kind', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await app.inject({
    method: 'PATCH', url: `/api/library/documents/${id}`,
    payload: { kind: 'source' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.update[0].fields.kind, 'source');
});

test('PATCH /api/library/documents/:id rejects invalid kind', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp(repo);
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await app.inject({
    method: 'PATCH', url: `/api/library/documents/${id}`,
    payload: { kind: 'bogus' },
  });
  assert.equal(res.statusCode, 400);
});

test('GET /api/library/documents passes kind filter', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  await app.inject({ method: 'GET', url: '/api/library/documents?kind=source' });
  assert.equal(calls.list[0].kind, 'source');
});

test('GET /api/library/documents rejects invalid kind filter', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp(repo);
  const res = await app.inject({ method: 'GET', url: '/api/library/documents?kind=bogus' });
  assert.equal(res.statusCode, 400);
});
