import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';

function createFakeLibraryRepository() {
  const documents = [
    {
      id: DOCUMENT_ID,
      title: 'Restore CloudNativePG',
      body: '# Restore CloudNativePG',
      documentType: 'runbook',
      context: 'homelab',
      tags: ['postgres', 'backup'],
      sourceFilename: 'restore.md',
      archivedAt: null,
      createdAt: 'now',
      updatedAt: 'now',
    },
  ];

  return {
    async listDocuments(filters = {}) {
      return documents.filter((document) => {
        if (filters.context && document.context !== filters.context) return false;
        if (filters.documentType && document.documentType !== filters.documentType) return false;
        if (filters.archived === true || filters.archived === 'true') return Boolean(document.archivedAt);
        if (filters.archived !== 'all') return !document.archivedAt;
        return true;
      });
    },
    async createDocument(input) {
      const document = {
        id: CREATED_DOCUMENT_ID,
        ...input,
        tags: input.tags || [],
        sourceFilename: input.sourceFilename || null,
        archivedAt: null,
        createdAt: 'now',
        updatedAt: 'now',
      };
      documents.push(document);
      return document;
    },
    async updateDocument(id, patch) {
      const document = documents.find(item => item.id === id && !item.archivedAt);
      if (!document) return null;
      Object.assign(document, patch);
      return document;
    },
    async archiveDocument(id) {
      const document = documents.find(item => item.id === id && !item.archivedAt);
      if (!document) return null;
      document.archivedAt = 'now';
      return document;
    },
    async restoreDocument(id) {
      const document = documents.find(item => item.id === id && item.archivedAt);
      if (!document) return null;
      document.archivedAt = null;
      return document;
    },
    async deleteArchivedDocument(id) {
      const index = documents.findIndex(item => item.id === id && item.archivedAt);
      if (index < 0) return null;
      return documents.splice(index, 1)[0];
    },
  };
}

test('GET /api/library/documents returns active Markdown documents', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: createFakeLibraryRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/library/documents?context=homelab',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().length, 1);
  assert.equal(response.json()[0].title, 'Restore CloudNativePG');

  await app.close();
});

test('POST /api/library/documents creates a Markdown document', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: createFakeLibraryRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: {
      title: 'Ingress Notes',
      body: '# Ingress Notes',
      documentType: 'note',
      context: 'homelab',
      tags: ['ingress'],
      sourceFilename: 'ingress.md',
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().id, CREATED_DOCUMENT_ID);
  assert.equal(response.json().documentType, 'note');

  await app.close();
});

test('POST /api/library/documents rejects invalid payloads', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: createFakeLibraryRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: {
      title: '',
      body: '# Missing title',
      documentType: 'manual',
      context: 'homelab',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /title/);

  await app.close();
});

test('PATCH /api/library/documents/:id updates a Markdown document', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: createFakeLibraryRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/library/documents/${DOCUMENT_ID}`,
    payload: { title: 'Updated Runbook', tags: ['restore'] },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().title, 'Updated Runbook');
  assert.deepEqual(response.json().tags, ['restore']);

  await app.close();
});

test('DELETE /api/library/documents/:id archives a Markdown document', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: createFakeLibraryRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/library/documents/${DOCUMENT_ID}`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().archivedAt, 'now');

  await app.close();
});

test('restore and permanent delete require archived Markdown documents', async () => {
  const repository = createFakeLibraryRepository();
  await repository.archiveDocument(DOCUMENT_ID);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repository,
  });

  const restore = await app.inject({
    method: 'PATCH',
    url: `/api/library/documents/${DOCUMENT_ID}/restore`,
  });
  assert.equal(restore.statusCode, 200);
  assert.equal(restore.json().archivedAt, null);

  await repository.archiveDocument(DOCUMENT_ID);
  const remove = await app.inject({
    method: 'DELETE',
    url: `/api/library/documents/${DOCUMENT_ID}/permanent`,
  });
  assert.equal(remove.statusCode, 200);
  assert.equal(remove.json().id, DOCUMENT_ID);
  assert.deepEqual(await repository.listDocuments({ archived: 'all' }), []);

  await app.close();
});

test('library document routes reject malformed ids before repository lookup', async () => {
  let calls = 0;
  const repository = {
    ...createFakeLibraryRepository(),
    async updateDocument() {
      calls += 1;
      return null;
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: repository,
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/library/documents/not-a-uuid',
    payload: { title: 'Nope' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(calls, 0);
  assert.match(response.json().message, /document id/);

  await app.close();
});

test('library document routes return 404 for missing documents', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { listTasks: async () => [] },
    libraryRepository: createFakeLibraryRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/library/documents/${MISSING_DOCUMENT_ID}`,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'document not found');

  await app.close();
});
