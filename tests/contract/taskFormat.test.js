import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { normalizeTaskRow } from '../../server/tasksRepository.js';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEED_TASK_ID = '11111111-1111-4111-8111-111111111111';

// The frozen 1.0 task field set (order-independent).
const FROZEN_TASK_KEYS = [
  'archivedAt', 'createdAt', 'description', 'dueDate', 'id', 'notes',
  'priority', 'projectId', 'sortOrder', 'status', 'title', 'updatedAt',
].sort();

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

function createFakeTasksRepository() {
  const tasks = [{
    id: SEED_TASK_ID,
    title: 'Back up CloudNativePG',
    description: '',
    notes: '',
    priority: 'high',
    status: 'planned',
    projectId: PROJECT_UUID,
    dueDate: '2026-05-12',
    sortOrder: 0,
    createdAt: 'now',
    updatedAt: 'now',
    archivedAt: null,
  }];
  let seq = 0;
  return {
    async listTasks(filters = {}) {
      return tasks.filter((task) => {
        if (filters.projectId && task.projectId !== filters.projectId) return false;
        if (filters.status && task.status !== filters.status) return false;
        if (filters.archived === true || filters.archived === 'true') return Boolean(task.archivedAt);
        if (filters.archived !== 'all') return !task.archivedAt;
        return true;
      });
    },
    async importTasks(imported) {
      const created = imported.map((task) => {
        seq += 1;
        return { id: `imported-${seq}`, ...task, createdAt: 'now', updatedAt: 'now', archivedAt: task.archivedAt ?? null };
      });
      tasks.push(...created);
      return created;
    },
    async replaceProjectTasks(projectId, imported) {
      for (let i = tasks.length - 1; i >= 0; i -= 1) {
        if (tasks[i].projectId === projectId) tasks.splice(i, 1);
      }
      return this.importTasks(imported);
    },
    async getTask(id) {
      const found = tasks.find((task) => task.id === id);
      return found ? { ...found } : null;
    },
    async recordActivity() { return null; },
    async listTaskActivity() { return []; },
  };
}

function buildContractApp(tasksRepository = createFakeTasksRepository()) {
  return buildApp({
    skipDb: true,
    tasksRepository,
    projectsRepository: createFakeProjectsRepository(),
  });
}

test('CONTRACT: normalizeTaskRow produces exactly the frozen task field set', () => {
  const row = {
    id: 'id', title: 't', description: 'd', notes: 'n',
    priority: 'high', status: 'planned', project_id: 'pid',
    due_date: null, sort_order: 3, archived_at: null,
    created_at: 'c', updated_at: 'u',
  };
  assert.deepEqual(Object.keys(normalizeTaskRow(row)).sort(), FROZEN_TASK_KEYS);
});

test('CONTRACT: GET /api/tasks/export envelope shape is frozen', async () => {
  const app = await buildContractApp();
  const res = await app.inject({ method: 'GET', url: '/api/tasks/export?project=homelab' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), ['exportedAt', 'format', 'project', 'tasks', 'version'].sort());
  assert.equal(body.format, 'moomora.tasks');
  assert.equal(body.version, 1);
  assert.equal(body.project, 'homelab');
  await app.close();
});

test('CONTRACT: import applies documented defaults (priority=medium, status=planned, mode=skip)', async () => {
  const app = await buildContractApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'Fresh task' }] },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.mode, 'skip');
  assert.equal(body.tasks[0].priority, 'medium');
  assert.equal(body.tasks[0].status, 'planned');
  await app.close();
});

test('CONTRACT: skip mode dedups on [title(lowercased), projectId, status, dueDate]', async () => {
  const app = await buildContractApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: '  back up cloudnativepg  ', status: 'planned', dueDate: '2026-05-12' }] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().skipped, 1);
  assert.equal(res.json().imported, 0);
  await app.close();
});

test('CONTRACT: append mode inserts duplicates as new', async () => {
  const app = await buildContractApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', mode: 'append', tasks: [{ title: 'Back up CloudNativePG', status: 'planned', dueDate: '2026-05-12' }] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().mode, 'append');
  assert.equal(res.json().imported, 1);
  await app.close();
});

test('CONTRACT: replace mode clears the project then inserts', async () => {
  const repo = createFakeTasksRepository();
  const app = await buildContractApp(repo);
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', mode: 'replace', tasks: [{ title: 'Only task' }] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().mode, 'replace');
  const remaining = await repo.listTasks({ archived: 'all' });
  assert.deepEqual(remaining.map((t) => t.title), ['Only task']);
  await app.close();
});

test('CONTRACT: import rejects more than 500 tasks', async () => {
  const app = await buildContractApp();
  const tasks = Array.from({ length: 501 }, (_, i) => ({ title: `Task ${i}` }));
  const res = await app.inject({ method: 'POST', url: '/api/tasks/import', payload: { project: 'homelab', tasks } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /cannot exceed 500/);
  await app.close();
});

test('CONTRACT: priority/status enums are frozen (import rejects out-of-enum)', async () => {
  const app = await buildContractApp();
  const badPriority = await app.inject({
    method: 'POST', url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'X', priority: 'urgent' }] },
  });
  assert.equal(badPriority.statusCode, 400);
  assert.match(badPriority.json().message, /priority/);

  const badStatus = await app.inject({
    method: 'POST', url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'X', status: 'blocked' }] },
  });
  assert.equal(badStatus.statusCode, 400);
  assert.match(badStatus.json().message, /status/);
  await app.close();
});
