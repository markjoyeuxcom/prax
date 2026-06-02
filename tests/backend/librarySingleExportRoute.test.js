import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const DOC_A = { id: '11111111-1111-4111-8111-111111111111', title: 'Cloudflare plan', body: '# A\n', documentType: 'note', projectId: PROJECT_ID, projectSlug: 'homelab', tags: [], sourceFilename: null, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', kind: 'source', contentHash: 'a'.repeat(64), updatedBy: 'user' };
const DOC_B = { id: '22222222-2222-4222-8222-222222222222', title: 'Postgres restore', body: '# B\n', documentType: 'runbook', projectId: PROJECT_ID, projectSlug: 'homelab', tags: [], sourceFilename: null, archivedAt: null, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z', kind: 'synthesized', contentHash: 'b'.repeat(64), updatedBy: 'agent' };

function fakeLibrary() {
  return {
    listDocuments: async () => [],
    getDocument: async (id) => (id === DOC_A.id ? DOC_A : id === DOC_B.id ? DOC_B : null),
    createDocument: async () => null,
    updateDocument: async () => null,
    archiveDocument: async () => null,
    restoreDocument: async () => null,
    deleteArchivedDocument: async () => null,
    listActiveDocumentsForExport: async () => [],
  };
}

function fakeProjects() {
  return { resolveProject: async () => ({ id: PROJECT_ID, slug: 'homelab' }) };
}

function fakeLinks() {
  return {
    listDocumentLinks: async () => [],
    linkDocuments: async () => ({ linked: true }),
    unlinkDocuments: async () => true,
    listStaleDocuments: async () => [],
    listOrphanDocuments: async () => [],
    listOutboundLinksForDocuments: async (ids) => {
      const m = new Map();
      if (ids.includes(DOC_B.id)) {
        m.set(DOC_B.id, {
          'derived-from': [{ targetId: DOC_A.id, targetProjectSlug: 'homelab', targetSourceFilename: null, targetTitle: 'Cloudflare plan' }],
          supersedes: [],
        });
      }
      return m;
    },
  };
}

async function makeApp() {
  return buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [], getTask: async () => null, createTask: async () => null, updateTask: async () => null, archiveTask: async () => null, restoreTask: async () => null, deleteArchivedTask: async () => null, reorderTasks: async () => [], recordActivity: async () => null, listTaskActivity: async () => [], importTasks: async () => [], replaceProjectTasks: async () => [] },
    libraryRepository: fakeLibrary(),
    projectsRepository: fakeProjects(),
    documentLinksRepository: fakeLinks(),
  });
}

test('GET /api/library/documents/:id/export returns rendered v2 markdown', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_B.id}/export` });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/markdown/);
  assert.match(res.headers['content-disposition'], /attachment; filename="postgres-restore\.md"/);
  assert.match(res.body, /title: Postgres restore/);
  assert.match(res.body, /kind: synthesized/);
  assert.match(res.body, new RegExp(`content_hash: ${'b'.repeat(64)}`));
  assert.match(res.body, /updated_by: agent/);
  assert.match(res.body, new RegExp(`- id: ${DOC_A.id}\\n      ref: cloudflare-plan.md`));
  assert.ok(res.body.endsWith('# B\n'));
  await app.close();
});

test('GET /api/library/documents/:id/export rejects an invalid UUID with 400', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/not-a-uuid/export' });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('GET /api/library/documents/:id/export returns 404 for a missing doc', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: `/api/library/documents/${'9'.repeat(8)}-9999-4999-8999-999999999999/export` });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('GET /api/library/documents/:id/export returns 404 for an archived doc', async () => {
  const ARCHIVED_DOC_ID = '33333333-3333-4333-8333-333333333333';
  const archivedDoc = { id: ARCHIVED_DOC_ID, title: 'Old note', body: '# Old\n', documentType: 'note', projectId: PROJECT_ID, projectSlug: 'homelab', tags: [], sourceFilename: null, archivedAt: '2026-05-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', kind: 'source', contentHash: 'c'.repeat(64), updatedBy: 'user' };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [], getTask: async () => null, createTask: async () => null, updateTask: async () => null, archiveTask: async () => null, restoreTask: async () => null, deleteArchivedTask: async () => null, reorderTasks: async () => [], recordActivity: async () => null, listTaskActivity: async () => [], importTasks: async () => [], replaceProjectTasks: async () => [] },
    libraryRepository: { ...fakeLibrary(), getDocument: async (id) => (id === ARCHIVED_DOC_ID ? archivedDoc : null) },
    projectsRepository: fakeProjects(),
    documentLinksRepository: fakeLinks(),
  });
  const res = await app.inject({ method: 'GET', url: `/api/library/documents/${ARCHIVED_DOC_ID}/export` });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('GET /api/library/documents/:id/export resolves projectSlug via projectsRepository when absent', async () => {
  const NO_SLUG_DOC_ID = '44444444-4444-4444-8444-444444444444';
  const docWithoutSlug = { id: NO_SLUG_DOC_ID, title: 'No slug doc', body: '# NS\n', documentType: 'note', projectId: PROJECT_ID, tags: [], sourceFilename: null, archivedAt: null, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z', kind: 'source', contentHash: 'd'.repeat(64), updatedBy: 'user' };
  // Note: no projectSlug field — simulates getDocument not joining projects
  const resolveProjectCalls = [];
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [], getTask: async () => null, createTask: async () => null, updateTask: async () => null, archiveTask: async () => null, restoreTask: async () => null, deleteArchivedTask: async () => null, reorderTasks: async () => [], recordActivity: async () => null, listTaskActivity: async () => [], importTasks: async () => [], replaceProjectTasks: async () => [] },
    libraryRepository: { ...fakeLibrary(), getDocument: async (id) => (id === NO_SLUG_DOC_ID ? docWithoutSlug : null) },
    projectsRepository: {
      resolveProject: async (value) => {
        resolveProjectCalls.push(value);
        return { id: PROJECT_ID, slug: 'homelab' };
      },
    },
    documentLinksRepository: fakeLinks(),
  });
  const res = await app.inject({ method: 'GET', url: `/api/library/documents/${NO_SLUG_DOC_ID}/export` });
  assert.equal(res.statusCode, 200);
  assert.ok(resolveProjectCalls.includes(PROJECT_ID), 'resolveProject was called with projectId');
  assert.match(res.body, /project: homelab/);
  await app.close();
});
