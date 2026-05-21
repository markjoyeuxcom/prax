import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchProjects, createProject, updateProject, archiveProject, deleteProjectPermanent,
} from '../../public/js/projectApi.js';

function stubFetch(captured, response = { ok: true, json: async () => ({}) }) {
  globalThis.fetch = async (url, options) => {
    captured.url = url;
    captured.options = options;
    return response;
  };
}

test('fetchProjects throws when the response is not ok', async () => {
  const c = {};
  stubFetch(c, { ok: false, json: async () => ({}) });
  await assert.rejects(() => fetchProjects(), /Failed to load projects/);
});

test('createProject throws when the response is not ok', async () => {
  const c = {};
  stubFetch(c, { ok: false, json: async () => ({}) });
  await assert.rejects(() => createProject('X'), /Failed to create project/);
});

test('fetchProjects requests /api/projects with optional status', async () => {
  const c = {};
  stubFetch(c, { ok: true, json: async () => [{ id: 'p1' }] });
  assert.deepEqual(await fetchProjects(), [{ id: 'p1' }]);
  assert.equal(c.url, '/api/projects');
  await fetchProjects('all');
  assert.equal(c.url, '/api/projects?status=all');
});

test('createProject POSTs the name', async () => {
  const c = {};
  stubFetch(c, { ok: true, json: async () => ({ id: 'p9', name: 'X' }) });
  const project = await createProject('X');
  assert.equal(c.url, '/api/projects');
  assert.equal(c.options.method, 'POST');
  assert.deepEqual(JSON.parse(c.options.body), { name: 'X' });
  assert.equal(project.id, 'p9');
});

test('updateProject PATCHes the patch', async () => {
  const c = {};
  stubFetch(c);
  await updateProject('p1', { status: 'on-hold' });
  assert.equal(c.url, '/api/projects/p1');
  assert.equal(c.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(c.options.body), { status: 'on-hold' });
});

test('archiveProject DELETEs the project', async () => {
  const c = {};
  stubFetch(c);
  await archiveProject('p1');
  assert.equal(c.url, '/api/projects/p1');
  assert.equal(c.options.method, 'DELETE');
});

test('deleteProjectPermanent DELETEs the permanent endpoint', async () => {
  const c = {};
  stubFetch(c);
  await deleteProjectPermanent('p1');
  assert.equal(c.url, '/api/projects/p1/permanent');
  assert.equal(c.options.method, 'DELETE');
});
