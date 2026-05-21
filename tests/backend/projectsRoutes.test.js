import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerProjectsRoutes } from '../../server/projectsRoutes.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function fakeRepository(overrides = {}) {
  return {
    async listProjects(status) { return [{ id: PROJECT_ID, name: 'Work', slug: 'work', status: status || 'active', sortOrder: 0 }]; },
    async createProject({ name }) { return { id: PROJECT_ID, name, slug: 'work', status: 'active', sortOrder: 0 }; },
    async updateProject(id, fields) { return id === PROJECT_ID ? { id, name: 'Work', slug: 'work', status: 'active', sortOrder: 0, ...fields } : null; },
    async archiveProject(id) { return id === PROJECT_ID ? { id, name: 'Work', slug: 'work', status: 'archived', sortOrder: 0 } : null; },
    async countProjectDependents() { return 0; },
    async deleteProject(id) { return id === PROJECT_ID ? { id, name: 'Work', slug: 'work', status: 'active', sortOrder: 0 } : null; },
    ...overrides,
  };
}

async function build(overrides) {
  const app = Fastify();
  await registerProjectsRoutes(app, { projectsRepository: fakeRepository(overrides) });
  return app;
}

test('GET /api/projects lists projects', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json()[0].slug, 'work');
});

test('POST /api/projects creates with 201; rejects empty name', async () => {
  const app = await build();
  const ok = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Work' } });
  assert.equal(ok.statusCode, 201);
  const bad = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '  ' } });
  assert.equal(bad.statusCode, 400);
});

test('POST rejects invalid status', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', status: 'bogus' } });
  assert.equal(res.statusCode, 400);
});

test('PATCH updates; 404 for missing; 400 for bad uuid', async () => {
  const app = await build();
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { status: 'on-hold' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/projects/not-a-uuid', payload: { status: 'on-hold' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/projects/22222222-2222-4222-8222-222222222222', payload: { status: 'on-hold' } })).statusCode, 404);
});

test('DELETE archives the project', async () => {
  const app = await build();
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'archived');
});

test('DELETE /permanent succeeds only when empty (409 otherwise)', async () => {
  const empty = await build();
  assert.equal((await empty.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}/permanent` })).statusCode, 200);

  const busy = await build({ async countProjectDependents() { return 3; } });
  assert.equal((await busy.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}/permanent` })).statusCode, 409);
});

test('DELETE /permanent returns 409 if a dependent FK blocks the delete', async () => {
  const app = await build({
    async countProjectDependents() { return 0; },
    async deleteProject() {
      const err = new Error('foreign key violation');
      err.code = '23503';
      throw err;
    },
  });
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}/permanent` });
  assert.equal(res.statusCode, 409);
});
