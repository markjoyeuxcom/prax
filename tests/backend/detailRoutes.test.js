import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const ID = '11111111-1111-4111-8111-111111111111';
const MISSING = '22222222-2222-4222-8222-222222222222';

test('GET /api/library/documents/:id returns the document or 404/400', async () => {
  const app = await buildApp({
    skipDb: true,
    libraryRepository: { async getDocument(id) { return id === ID ? { id, title: 'Doc' } : null; } },
    projectsRepository: { async resolveProject() { return null; } },
    documentLinksRepository: { async listDocumentLinks() { return []; } },
  });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${ID}` })).json().title, 'Doc');
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${MISSING}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents/not-a-uuid' })).statusCode, 400);
  await app.close();
});

test('GET /api/tasks/:id returns the task or 404/400', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { async getTask(id) { return id === ID ? { id, title: 'Task' } : null; } },
    projectsRepository: { async resolveProject() { return null; } },
  });
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${ID}` })).json().title, 'Task');
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${MISSING}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/tasks/not-a-uuid' })).statusCode, 400);
  await app.close();
});
