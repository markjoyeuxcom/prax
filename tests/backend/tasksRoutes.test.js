import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_TASK_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_TASK_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_TASK_ID = '44444444-4444-4444-8444-444444444444';
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const MISSING_DOCUMENT_ID = '66666666-6666-4666-8666-666666666666';
const IMPORTED_TASK_IDS = [
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];
const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

function createFakeRepository() {
  const tasks = [
    {
      id: TASK_ID,
      title: 'Back up CloudNativePG',
      description: '',
      priority: 'high',
      status: 'planned',
      projectId: PROJECT_UUID,
      dueDate: '2026-05-12',
      sortOrder: 0,
      createdAt: 'now',
      updatedAt: 'now',
      archivedAt: null,
    },
  ];
  const documents = [
    {
      id: DOCUMENT_ID,
      title: 'CloudNativePG Restore',
      documentType: 'runbook',
      projectId: PROJECT_UUID,
    },
  ];
  const links = [];
  const activity = [];
  let activitySeq = 0;
  return {
    async getTask(id) {
      const task = tasks.find(item => item.id === id);
      return task ? { ...task } : null;
    },
    async recordActivity(taskId, eventType, message) {
      activitySeq += 1;
      const event = {
        id: `activity-${activitySeq}`,
        taskId,
        eventType,
        message,
        createdAt: 'now',
      };
      activity.push(event);
      return event;
    },
    async listTaskActivity(taskId) {
      return activity
        .filter(event => event.taskId === taskId)
        .slice()
        .reverse();
    },
    async listTasks(filters = {}) {
      return tasks.filter((task) => {
        if (filters.projectId && task.projectId !== filters.projectId) return false;
        if (filters.status && task.status !== filters.status) return false;
        if (filters.archived === true || filters.archived === 'true') return Boolean(task.archivedAt);
        if (filters.archived !== 'all') return !task.archivedAt;
        return true;
      });
    },
    async createTask(task) {
      const created = {
        id: CREATED_TASK_ID,
        ...task,
        createdAt: 'now',
        updatedAt: 'now',
        archivedAt: null,
      };
      tasks.push(created);
      return created;
    },
    async importTasks(importedTasks) {
      const created = importedTasks.map((task, index) => ({
        id: IMPORTED_TASK_IDS[index] || CREATED_TASK_ID,
        ...task,
        createdAt: 'now',
        updatedAt: 'now',
      }));
      tasks.push(...created);
      return created;
    },
    async replaceProjectTasks(projectId, importedTasks) {
      for (let index = tasks.length - 1; index >= 0; index -= 1) {
        if (tasks[index].projectId === projectId) tasks.splice(index, 1);
      }
      return this.importTasks(importedTasks);
    },
    async updateTask(id, fields) {
      const task = tasks.find(item => item.id === id);
      if (!task) return null;
      Object.assign(task, fields);
      return task;
    },
    async archiveTask(id) {
      const task = tasks.find(item => item.id === id);
      if (!task) return null;
      task.archivedAt = 'now';
      return task;
    },
    async restoreTask(id) {
      const task = tasks.find(item => item.id === id && item.archivedAt);
      if (!task) return null;
      task.archivedAt = null;
      return task;
    },
    async deleteArchivedTask(id) {
      const index = tasks.findIndex(item => item.id === id && item.archivedAt);
      if (index < 0) return null;
      return tasks.splice(index, 1)[0];
    },
    async reorderTasks(updates) {
      return updates.map((update) => {
        const task = tasks.find(item => item.id === update.id);
        if (!task) return null;
        Object.assign(task, update);
        return task;
      }).filter(Boolean);
    },
    async listTaskDocuments(taskId) {
      return links
        .filter(link => link.taskId === taskId)
        .map(link => documents.find(doc => doc.id === link.documentId))
        .filter(Boolean)
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    async linkTaskDocument(taskId, documentId) {
      const existing = links.find(link => link.taskId === taskId && link.documentId === documentId);
      if (existing) return { linked: true, alreadyLinked: true };
      const taskExists = tasks.some(t => t.id === taskId);
      const docExists = documents.some(d => d.id === documentId);
      if (!taskExists || !docExists) return { linked: false };
      links.push({ taskId, documentId });
      return { linked: true };
    },
    async unlinkTaskDocument(taskId, documentId) {
      const index = links.findIndex(link => link.taskId === taskId && link.documentId === documentId);
      if (index < 0) return false;
      links.splice(index, 1);
      return true;
    },
  };
}

test('GET /api/tasks returns tasks from repository', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [
    {
      id: TASK_ID,
      title: 'Back up CloudNativePG',
      description: '',
      priority: 'high',
      status: 'planned',
      projectId: PROJECT_UUID,
      dueDate: '2026-05-12',
      sortOrder: 0,
      createdAt: 'now',
      updatedAt: 'now',
      archivedAt: null,
    },
  ]);

  await app.close();
});

test('GET /api/tasks?project=homelab filters by resolved projectId', async () => {
  const calls = [];
  const repository = {
    ...createFakeRepository(),
    async listTasks(filters) {
      calls.push(filters);
      return [];
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks?project=homelab',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].projectId, PROJECT_UUID);

  await app.close();
});

test('GET /api/tasks?project=<unknown> returns 400 (not a cross-project query)', async () => {
  let listed = false;
  const repository = {
    ...createFakeRepository(),
    async listTasks() { listed = true; return []; },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({ method: 'GET', url: '/api/tasks?project=nope' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'project is invalid');
  assert.equal(listed, false);

  await app.close();
});

test('PATCH /api/tasks/:id rejects a raw projectId (must use project slug-or-id)', async () => {
  let updated = false;
  const repository = {
    ...createFakeRepository(),
    async updateTask() { updated = true; return null; },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: { projectId: PROJECT_UUID },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(updated, false);

  await app.close();
});

test('GET /api/tasks/export returns a versioned project export', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks/export?project=homelab',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().format, 'moomora.tasks');
  assert.equal(response.json().version, 1);
  assert.equal(response.json().project, 'homelab');
  assert.match(response.json().exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.json().tasks.length, 1);

  await app.close();
});

test('GET /api/tasks/export returns an all-project backup', async () => {
  const repository = createFakeRepository();
  await repository.importTasks([
    {
      title: 'Personal restore drill',
      description: '',
      priority: 'low',
      status: 'completed',
      projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      dueDate: null,
      sortOrder: 0,
      archivedAt: '2026-05-11T12:00:00.000Z',
    },
  ]);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks/export?project=all',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().format, 'moomora.tasks');
  assert.equal(response.json().version, 1);
  assert.equal(response.json().project, 'all');
  assert.equal(response.json().tasks.length, 2);

  await app.close();
});

test('POST /api/tasks creates a task with project slug resolved to projectId', async () => {
  const calls = [];
  const repository = {
    ...createFakeRepository(),
    async createTask(task) {
      calls.push(task);
      return { id: CREATED_TASK_ID, ...task, createdAt: 'now', updatedAt: 'now', archivedAt: null };
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Back up CloudNativePG',
      description: '',
      priority: 'high',
      status: 'planned',
      project: 'homelab',
      dueDate: '2026-05-12',
      sortOrder: 0,
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().title, 'Back up CloudNativePG');
  assert.equal(response.json().id, CREATED_TASK_ID);
  assert.equal(calls[0].projectId, PROJECT_UUID);

  await app.close();
});

test('POST /api/tasks rejects unknown project with 400', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      project: 'nope',
      dueDate: null,
      sortOrder: 0,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'project is invalid');

  await app.close();
});

test('POST /api/tasks rejects missing project with 400', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      dueDate: null,
      sortOrder: 0,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /project/);

  await app.close();
});

test('POST /api/tasks/import imports sanitized tasks into the requested project', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      tasks: [
        {
          title: '  Imported task  ',
          description: '  From backup  ',
          priority: 'medium',
          status: 'planned',
          dueDate: '2026-05-18',
          sortOrder: 2,
          archivedAt: null,
        },
      ],
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().mode, 'skip');
  assert.equal(response.json().imported, 1);
  assert.equal(response.json().skipped, 0);
  assert.equal(response.json().tasks[0].title, 'Imported task');
  assert.equal(response.json().tasks[0].description, 'From backup');
  assert.equal(response.json().tasks[0].projectId, PROJECT_UUID);

  await app.close();
});

test('POST /api/tasks/import skips duplicates by default', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      tasks: [
        {
          title: ' back up cloudnativepg ',
          priority: 'medium',
          status: 'planned',
          dueDate: '2026-05-12',
          sortOrder: 2,
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'skip');
  assert.equal(response.json().imported, 0);
  assert.equal(response.json().skipped, 1);
  assert.deepEqual(response.json().tasks, []);

  await app.close();
});

test('POST /api/tasks/import appends duplicates when requested', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      mode: 'append',
      tasks: [
        {
          title: 'Back up CloudNativePG',
          priority: 'medium',
          status: 'planned',
          dueDate: '2026-05-12',
          sortOrder: 2,
        },
      ],
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().mode, 'append');
  assert.equal(response.json().imported, 1);
  assert.equal(response.json().skipped, 0);

  await app.close();
});

test('POST /api/tasks/import replaces the selected project when requested', async () => {
  const repository = createFakeRepository();
  const OTHER_PROJECT_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await repository.importTasks([
    {
      title: 'Personal stays',
      description: '',
      priority: 'low',
      status: 'planned',
      projectId: OTHER_PROJECT_UUID,
      dueDate: null,
      sortOrder: 0,
      archivedAt: null,
    },
  ]);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      mode: 'replace',
      tasks: [
        {
          title: 'Replacement task',
          priority: 'high',
          status: 'planned',
          dueDate: null,
          sortOrder: 0,
        },
      ],
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().mode, 'replace');
  assert.equal(response.json().imported, 1);
  assert.equal(response.json().skipped, 0);
  assert.equal(response.json().tasks[0].title, 'Replacement task');

  const activeTasks = await repository.listTasks({ archived: 'all' });
  assert.deepEqual(activeTasks.map(task => task.title).sort(), ['Personal stays', 'Replacement task']);

  await app.close();
});

test('POST /api/tasks/import rejects invalid import modes', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      mode: 'merge',
      tasks: [{ title: 'Imported task' }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /mode/);

  await app.close();
});

test('POST /api/tasks/import accepts exported envelope payloads', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      format: 'moomora.tasks',
      version: 1,
      tasks: [
        {
          title: 'Envelope task',
          priority: 'low',
          status: 'completed',
          dueDate: null,
          sortOrder: 4,
          archivedAt: '2026-05-11T12:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().tasks[0].archivedAt, '2026-05-11T12:00:00.000Z');

  await app.close();
});

test('POST /api/tasks/import rejects legacy TaskBoard envelope payloads', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      format: 'taskboard.tasks',
      tasks: [
        {
          title: 'Legacy backup task',
          priority: 'medium',
          status: 'planned',
        },
      ],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'format is invalid');

  await app.close();
});

test('POST /api/tasks/import rejects unknown project', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'cluster',
      tasks: [{ title: 'Imported task' }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /project/);

  await app.close();
});

test('POST /api/tasks/import rejects empty tasks', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      tasks: [],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /tasks/);

  await app.close();
});

test('POST /api/tasks/import rejects invalid task payloads', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: {
      project: 'homelab',
      tasks: [{ title: '', priority: 'urgent' }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /title/);

  await app.close();
});

test('POST /api/tasks rejects invalid priority', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'urgent',
      status: 'planned',
      project: 'homelab',
      dueDate: null,
      sortOrder: 0,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /priority/);

  await app.close();
});

test('POST /api/tasks rejects invalid dueDate', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      project: 'homelab',
      dueDate: 'not-a-date',
      sortOrder: 0,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /dueDate/);

  await app.close();
});

test('POST /api/tasks rejects invalid sortOrder', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      project: 'homelab',
      dueDate: null,
      sortOrder: 'abc',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /sortOrder/);

  await app.close();
});

test('POST /api/tasks rejects fractional sortOrder', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      project: 'homelab',
      dueDate: null,
      sortOrder: 1.5,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /sortOrder/);

  await app.close();
});

test('POST /api/tasks rejects out-of-range sortOrder', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      project: 'homelab',
      dueDate: null,
      sortOrder: 2147483648,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /sortOrder/);

  await app.close();
});

test('PATCH /api/tasks/:id updates task with valid partial payload', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: {
      title: '  Restore drill  ',
      description: '  Verify backups  ',
      status: 'in-progress',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().title, 'Restore drill');
  assert.equal(response.json().description, 'Verify backups');
  assert.equal(response.json().status, 'in-progress');
  assert.equal(response.json().priority, 'high');

  await app.close();
});

test('PATCH /api/tasks/:id updates notes and round-trips the value', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: { notes: 'remember to rotate creds' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().notes, 'remember to rotate creds');

  await app.close();
});

test('POST /api/tasks persists an initial notes value', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'T', project: 'homelab', priority: 'low', status: 'planned', notes: 'kick-off note' },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().notes, 'kick-off note');

  await app.close();
});

test('PATCH /api/tasks/:id with project slug resolves to projectId', async () => {
  const calls = [];
  const repository = {
    ...createFakeRepository(),
    async updateTask(id, fields) {
      calls.push({ id, fields });
      return { id, ...fields, createdAt: 'now', updatedAt: 'now', archivedAt: null };
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: {
      project: 'homelab',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].fields.projectId, PROJECT_UUID);

  await app.close();
});

test('PATCH /api/tasks/:id rejects empty body', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: {},
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /field/i);

  await app.close();
});

test('PATCH /api/tasks/:id rejects invalid priority', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: {
      priority: 'urgent',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /priority/);

  await app.close();
});

test('PATCH /api/tasks/:id rejects invalid dueDate', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: {
      dueDate: '2026-02-30',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /dueDate/);

  await app.close();
});

test('PATCH /api/tasks/:id rejects fractional sortOrder', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: {
      sortOrder: 1.5,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /sortOrder/);

  await app.close();
});

test('PATCH /api/tasks/:id rejects out-of-range sortOrder', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: {
      sortOrder: 2147483648,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /sortOrder/);

  await app.close();
});

test('PATCH /api/tasks/:id rejects malformed task id before repository lookup', async () => {
  let updateCalls = 0;
  const repository = {
    ...createFakeRepository(),
    async updateTask() {
      updateCalls += 1;
      return null;
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/not-a-uuid',
    payload: {
      status: 'completed',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);
  assert.equal(updateCalls, 0);

  await app.close();
});

test('PATCH /api/tasks/:id returns 404 for unknown task', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${MISSING_TASK_ID}`,
    payload: {
      status: 'completed',
    },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'task not found');

  await app.close();
});

test('PATCH /api/tasks/reorder updates status and sort order in batch', async () => {
  const repository = createFakeRepository();
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/reorder',
    payload: {
      tasks: [
        { id: TASK_ID, status: 'in-progress', sortOrder: 0 },
        { id: SECOND_TASK_ID, status: 'planned', sortOrder: 1 },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json()[0].id, TASK_ID);
  assert.equal(response.json()[0].status, 'in-progress');
  assert.equal(response.json()[0].sortOrder, 0);

  await app.close();
});

test('PATCH /api/tasks/reorder rejects invalid payload shape', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/reorder',
    payload: { tasks: [] },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /tasks/);

  await app.close();
});

test('PATCH /api/tasks/reorder rejects invalid task ids', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/reorder',
    payload: {
      tasks: [{ id: 'not-a-uuid', status: 'planned', sortOrder: 0 }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);

  await app.close();
});

test('PATCH /api/tasks/reorder rejects invalid status values', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/reorder',
    payload: {
      tasks: [{ id: TASK_ID, status: 'blocked', sortOrder: 0 }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /status/);

  await app.close();
});

test('PATCH /api/tasks/reorder rejects invalid sort orders', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/reorder',
    payload: {
      tasks: [{ id: TASK_ID, status: 'planned', sortOrder: 1.5 }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /sortOrder/);

  await app.close();
});

test('DELETE /api/tasks/:id archives existing task', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${TASK_ID}`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().archivedAt, 'now');

  await app.close();
});

test('PATCH /api/tasks/:id/restore restores an archived task', async () => {
  const repository = createFakeRepository();
  await repository.archiveTask(TASK_ID);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}/restore`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, TASK_ID);
  assert.equal(response.json().archivedAt, null);

  await app.close();
});

test('PATCH /api/tasks/:id/restore rejects malformed task id before repository lookup', async () => {
  let restoreCalls = 0;
  const repository = {
    ...createFakeRepository(),
    async restoreTask() {
      restoreCalls += 1;
      return null;
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/not-a-uuid/restore',
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);
  assert.equal(restoreCalls, 0);

  await app.close();
});

test('PATCH /api/tasks/:id/restore returns 404 for unknown or active task', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${MISSING_TASK_ID}/restore`,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'task not found');

  await app.close();
});

test('DELETE /api/tasks/:id/permanent deletes an archived task', async () => {
  const repository = createFakeRepository();
  await repository.archiveTask(TASK_ID);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${TASK_ID}/permanent`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, TASK_ID);
  assert.equal(response.json().archivedAt, 'now');
  assert.deepEqual(await repository.listTasks({ archived: 'all' }), []);

  await app.close();
});

test('DELETE /api/tasks/:id/permanent rejects active tasks', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${TASK_ID}/permanent`,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'task not found');

  await app.close();
});

test('DELETE /api/tasks/:id/permanent rejects malformed task id before repository lookup', async () => {
  let deleteCalls = 0;
  const repository = {
    ...createFakeRepository(),
    async deleteArchivedTask() {
      deleteCalls += 1;
      return null;
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/tasks/not-a-uuid/permanent',
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);
  assert.equal(deleteCalls, 0);

  await app.close();
});

test('DELETE /api/tasks/:id rejects malformed task id before repository lookup', async () => {
  let archiveCalls = 0;
  const repository = {
    ...createFakeRepository(),
    async archiveTask() {
      archiveCalls += 1;
      return null;
    },
  };
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/tasks/not-a-uuid',
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);
  assert.equal(archiveCalls, 0);

  await app.close();
});

test('DELETE /api/tasks/:id returns 404 for unknown task', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${MISSING_TASK_ID}`,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'task not found');

  await app.close();
});

test('GET /api/tasks/:id/documents returns linked document list', async () => {
  const repository = createFakeRepository();
  await repository.linkTaskDocument(TASK_ID, DOCUMENT_ID);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${TASK_ID}/documents`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().length, 1);
  assert.equal(response.json()[0].id, DOCUMENT_ID);
  assert.equal(response.json()[0].title, 'CloudNativePG Restore');

  await app.close();
});

test('GET /api/tasks/:id/documents rejects malformed task id', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks/not-a-uuid/documents',
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);

  await app.close();
});

test('POST /api/tasks/:id/documents links a document and returns 201 with updated list', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: `/api/tasks/${TASK_ID}/documents`,
    payload: { documentId: DOCUMENT_ID },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().length, 1);
  assert.equal(response.json()[0].id, DOCUMENT_ID);

  await app.close();
});

test('POST /api/tasks/:id/documents returns 200 when link already exists (idempotent)', async () => {
  const repository = createFakeRepository();
  await repository.linkTaskDocument(TASK_ID, DOCUMENT_ID);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: `/api/tasks/${TASK_ID}/documents`,
    payload: { documentId: DOCUMENT_ID },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().length, 1);
  assert.equal(response.json()[0].id, DOCUMENT_ID);

  await app.close();
});

test('POST /api/tasks/:id/documents rejects malformed task id', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks/not-a-uuid/documents',
    payload: { documentId: DOCUMENT_ID },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);

  await app.close();
});

test('POST /api/tasks/:id/documents rejects malformed documentId', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: `/api/tasks/${TASK_ID}/documents`,
    payload: { documentId: 'not-a-uuid' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'documentId is invalid');

  await app.close();
});

test('POST /api/tasks/:id/documents returns 404 when task or document missing', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: `/api/tasks/${TASK_ID}/documents`,
    payload: { documentId: MISSING_DOCUMENT_ID },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'task or document not found');

  await app.close();
});

test('DELETE /api/tasks/:id/documents/:documentId removes link and returns updated list', async () => {
  const repository = createFakeRepository();
  await repository.linkTaskDocument(TASK_ID, DOCUMENT_ID);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${TASK_ID}/documents/${DOCUMENT_ID}`,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), []);

  await app.close();
});

test('DELETE /api/tasks/:id/documents/:documentId returns 404 for missing link', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${TASK_ID}/documents/${DOCUMENT_ID}`,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'link not found');

  await app.close();
});

test('DELETE /api/tasks/:id/documents/:documentId rejects malformed task id', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/not-a-uuid/documents/${DOCUMENT_ID}`,
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);

  await app.close();
});

test('DELETE /api/tasks/:id/documents/:documentId rejects malformed documentId', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${TASK_ID}/documents/not-a-uuid`,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'documentId is invalid');

  await app.close();
});

test('GET /api/tasks/:id/activity logs a created event after POST /api/tasks', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Back up CloudNativePG',
      description: '',
      priority: 'high',
      status: 'planned',
      project: 'homelab',
      dueDate: '2026-05-12',
      sortOrder: 0,
    },
  });
  assert.equal(created.statusCode, 201);
  const taskId = created.json().id;

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${taskId}/activity`,
  });

  assert.equal(response.statusCode, 200);
  const events = response.json();
  assert.ok(events.some(event => event.eventType === 'created'));

  await app.close();
});

test('GET /api/tasks/:id/activity records a status event after a status change', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const patch = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}`,
    payload: { status: 'in-progress' },
  });
  assert.equal(patch.statusCode, 200);

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${TASK_ID}/activity`,
  });

  assert.equal(response.statusCode, 200);
  const events = response.json();
  const statusEvent = events.find(event => event.eventType === 'status');
  assert.ok(statusEvent);
  assert.equal(statusEvent.message, 'Status → in-progress');

  await app.close();
});

test('GET /api/tasks/:id/activity records an archived event after DELETE', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const archived = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${TASK_ID}`,
  });
  assert.equal(archived.statusCode, 200);

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${TASK_ID}/activity`,
  });

  assert.equal(response.statusCode, 200);
  const events = response.json();
  assert.ok(events.some(event => event.eventType === 'archived'));

  await app.close();
});

test('GET /api/tasks/:id/activity records a restored event after restore', async () => {
  const repository = createFakeRepository();
  await repository.archiveTask(TASK_ID);
  const app = await buildApp({
    skipDb: true,
    tasksRepository: repository,
    projectsRepository: createFakeProjectsRepository(),
  });

  const restored = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${TASK_ID}/restore`,
  });
  assert.equal(restored.statusCode, 200);

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${TASK_ID}/activity`,
  });

  assert.equal(response.statusCode, 200);
  const events = response.json();
  assert.ok(events.some(event => event.eventType === 'restored'));

  await app.close();
});

test('GET /api/tasks/:id/activity rejects malformed task id', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
    projectsRepository: createFakeProjectsRepository(),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks/not-a-uuid/activity',
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /task id/);

  await app.close();
});
