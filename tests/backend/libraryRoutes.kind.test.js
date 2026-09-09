import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_UUID = '00000000-0000-4000-8000-000000000001';

function createFakeProjectsRepository() {
  return {
    async resolveProject(value) {
      if (value === 'homelab' || value === PROJECT_UUID) {
        return { id: PROJECT_UUID, slug: 'homelab', status: 'active' };
      }
      return null;
    },
  };
}

function makeRepoStub() {
  const calls = { create: [], update: [], list: [] };
  const repo = {
    listDocuments: async (filters) => { calls.list.push(filters); return []; },
    createDocument: async (doc) => { calls.create.push(doc); return { id: 'new', ...doc, kind: doc.kind || 'source' }; },
    updateDocument: async (id, fields) => { calls.update.push({ id, fields }); return { id, ...fields }; },
    getDocument: async () => null,
    archiveDocument: async () => null,
    restoreDocument: async () => null,
    deleteDocument: async () => null,
    listActiveDocumentsForExport: async () => [],
  };
  return { repo, calls };
}

const documentLinksRepository = {
  listDocumentLinks: async () => [],
  linkDocuments: async () => ({ linked: true }),
  unlinkDocuments: async () => true,
  listStaleDocuments: async () => [],
};

test('POST /api/library/documents accepts valid kind', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repo,
    projectsRepository: createFakeProjectsRepository(),
    documentLinksRepository,
  });
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab', kind: 'synthesized' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(calls.create[0].kind, 'synthesized');
  await app.close();
});

test('POST /api/library/documents rejects invalid kind', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repo,
    projectsRepository: createFakeProjectsRepository(),
    documentLinksRepository,
  });
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab', kind: 'bogus' },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /api/library/documents defaults kind when omitted', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repo,
    projectsRepository: createFakeProjectsRepository(),
    documentLinksRepository,
  });
  await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(calls.create[0].kind, undefined, 'route forwards undefined; repo applies default');
  await app.close();
});

test('PATCH /api/library/documents/:id accepts kind', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repo,
    projectsRepository: createFakeProjectsRepository(),
    documentLinksRepository,
  });
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await app.inject({
    method: 'PATCH', url: `/api/library/documents/${id}`,
    payload: { kind: 'source' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.update[0].fields.kind, 'source');
  await app.close();
});

test('PATCH /api/library/documents/:id rejects invalid kind', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repo,
    projectsRepository: createFakeProjectsRepository(),
    documentLinksRepository,
  });
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await app.inject({
    method: 'PATCH', url: `/api/library/documents/${id}`,
    payload: { kind: 'bogus' },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('GET /api/library/documents passes kind filter', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repo,
    projectsRepository: createFakeProjectsRepository(),
    documentLinksRepository,
  });
  await app.inject({ method: 'GET', url: '/api/library/documents?kind=source' });
  assert.equal(calls.list[0].kind, 'source');
  await app.close();
});

test('GET /api/library/documents rejects invalid kind filter', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repo,
    projectsRepository: createFakeProjectsRepository(),
    documentLinksRepository,
  });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents?kind=bogus' });
  assert.equal(res.statusCode, 400);
  await app.close();
});
