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
    async deleteProject(id) {
      return id === PROJECT_ID
        ? { project: { id, name: 'Work', slug: 'work', status: 'active', sortOrder: 0 }, deleted: { tasks: 2, documents: 1 } }
        : null;
    },
    async resolveProject(id) { return id === PROJECT_ID ? { id, name: 'Work', slug: 'work', status: 'active', sortOrder: 0 } : null; },
    ...overrides,
  };
}

const MEMORY_ID = '4d454d4f-5259-4000-8000-000000000001';
// Reports every id as the reserved Memory project, and blows up if any
// mutation slips past the guard.
function memoryOverrides() {
  return {
    async resolveProject() { return { id: MEMORY_ID, name: 'Memory', slug: 'memory', status: 'active', sortOrder: 3 }; },
    async updateProject() { throw new Error('guard failed: reached updateProject for Memory'); },
    async archiveProject() { throw new Error('guard failed: reached archiveProject for Memory'); },
    async deleteProject() { throw new Error('guard failed: reached deleteProject for Memory'); },
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

test('PATCH accepts onCall + handoffNotes (trimmed), clears on empty, rejects non-string', async () => {
  const app = await build();
  const ok = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { onCall: 'Ada', handoffNotes: '  watch the DB  ' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().onCall, 'Ada');
  assert.equal(ok.json().handoffNotes, 'watch the DB');

  const cleared = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { onCall: '' } });
  assert.equal(cleared.json().onCall, null);

  const bad = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { onCall: 123 } });
  assert.equal(bad.statusCode, 400);
});

test('PATCH accepts repoUrl as entered (trimmed), clears on empty, rejects non-string', async () => {
  const app = await build();
  const ok = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { repoUrl: '  git@github.com:Org/Repo.git  ' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().repoUrl, 'git@github.com:Org/Repo.git'); // stored as entered — matching normalizes later

  const cleared = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { repoUrl: '' } });
  assert.equal(cleared.json().repoUrl, null);

  const bad = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { repoUrl: 42 } });
  assert.equal(bad.statusCode, 400);
});

test('area round-trips through the real repository and rides every project payload', async () => {
  const { buildApp } = await import('../../server/index.js');
  const { loadConfig } = await import('../../server/config.js');
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
  const created = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Area subject' } })).json();
  await app.inject({ method: 'PATCH', url: `/api/projects/${created.id}`, payload: { area: 'Labs' } });
  const listed = (await app.inject({ method: 'GET', url: '/api/projects' })).json()
    .find((project) => project.id === created.id);
  assert.equal(listed.area, 'Labs', 'area persists and rides list payloads');
  await app.close();
});

test('PATCH accepts area (trimmed, bounded at 60), clears on empty, rejects abuse', async () => {
  const app = await build();
  const ok = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { area: '  Work  ' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().area, 'Work');

  const cleared = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { area: '' } });
  assert.equal(cleared.json().area, null);

  const tooLong = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { area: 'x'.repeat(61) } });
  assert.equal(tooLong.statusCode, 400, 'a section header cannot be a paragraph');
  const nonString = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { area: 7 } });
  assert.equal(nonString.statusCode, 400);
});

test('DELETE archives the project', async () => {
  const app = await build();
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'archived');
});

test('DELETE /permanent deletes a non-empty project and reports what went with it', async () => {
  const app = await build();
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}/permanent` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, PROJECT_ID);
  assert.deepEqual(res.json().deleted, { tasks: 2, documents: 1 });
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/22222222-2222-4222-8222-222222222222/permanent` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/projects/not-a-uuid/permanent' })).statusCode, 400);
});

test('DELETE /permanent removes an ordinary project with its tasks and documents in one go', async () => {
  const { buildApp } = await import('../../server/index.js');
  const { loadConfig } = await import('../../server/config.js');
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Doomed' } })).json();
  const task = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Goes too', project: 'doomed', priority: 'medium', status: 'planned' } })).json();
  const doc = (await app.inject({ method: 'POST', url: '/api/library/documents', payload: { title: 'Also goes', body: 'body', documentType: 'note', project: 'doomed' } })).json();
  await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/checklist`, payload: { label: 'cascades' } });

  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}/permanent` });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().deleted, { tasks: 1, documents: 1 });
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })).statusCode, 404, 'task is gone');
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}` })).statusCode, 404, 'document is gone');
  const remaining = (await app.inject({ method: 'GET', url: '/api/projects?status=all' })).json().map((p) => p.slug);
  assert.ok(!remaining.includes('doomed'), 'project is gone');
  const { rows } = await app.db.query('select count(*) as n from task_checklist_items');
  assert.equal(Number(rows[0].n), 0, 'checklist items cascade with their task');

  // Both system projects survive ordinary project deletion.
  const inbox = (await app.inject({ method: 'GET', url: '/api/projects' })).json().find((p) => p.slug === 'inbox');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${inbox.id}`, payload: { name: 'Triage' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${inbox.id}/permanent` })).statusCode, 403);

  // Memory keeps its existing protection.
  const memory = (await app.inject({ method: 'GET', url: '/api/projects' })).json().find((p) => p.slug === 'memory');
  assert.ok(memory, 'memory project is seeded');
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${memory.id}/permanent` })).statusCode, 403);
  await app.close();
});

test('PATCH /api/projects/:id renames a non-reserved project (slug stays stable)', async () => {
  let received;
  const app = await build({
    async updateProject(id, fields) { received = fields; return { id, name: fields.name, slug: 'work', status: 'active', sortOrder: 0 }; },
  });
  const res = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { name: '  Terraform Labs  ' } });
  assert.equal(res.statusCode, 200);
  assert.equal(received.name, 'Terraform Labs'); // trimmed
  assert.equal(res.json().name, 'Terraform Labs');
  assert.equal(res.json().slug, 'work'); // slug is not re-derived on rename
});

test('PATCH /api/projects/:id rejects a blank rename', async () => {
  const app = await build();
  const res = await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { name: '   ' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /name is invalid/);
});

test('the reserved Memory project is protected from rename, status change, archive, and delete', async () => {
  const app = await build(memoryOverrides());
  const patch = await app.inject({ method: 'PATCH', url: `/api/projects/${MEMORY_ID}`, payload: { name: 'Renamed' } });
  assert.equal(patch.statusCode, 403);
  assert.match(patch.json().message, /Memory/);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${MEMORY_ID}`, payload: { status: 'archived' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${MEMORY_ID}` })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${MEMORY_ID}/permanent` })).statusCode, 403);
});
