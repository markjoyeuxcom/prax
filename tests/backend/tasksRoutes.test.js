import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_TASK_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_TASK_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_TASK_ID = '44444444-4444-4444-8444-444444444444';

function createFakeRepository() {
  const tasks = [
    {
      id: TASK_ID,
      title: 'Back up CloudNativePG',
      description: '',
      priority: 'high',
      status: 'planned',
      context: 'homelab',
      dueDate: '2026-05-12',
      sortOrder: 0,
      createdAt: 'now',
      updatedAt: 'now',
      archivedAt: null,
    },
  ];
  return {
    async listTasks() {
      return tasks;
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
    async reorderTasks(updates) {
      return updates.map((update) => {
        const task = tasks.find(item => item.id === update.id);
        if (!task) return null;
        Object.assign(task, update);
        return task;
      }).filter(Boolean);
    },
  };
}

test('GET /api/tasks returns tasks from repository', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
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
      context: 'homelab',
      dueDate: '2026-05-12',
      sortOrder: 0,
      createdAt: 'now',
      updatedAt: 'now',
      archivedAt: null,
    },
  ]);

  await app.close();
});

test('POST /api/tasks creates a task', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Back up CloudNativePG',
      description: '',
      priority: 'high',
      status: 'planned',
      context: 'homelab',
      dueDate: '2026-05-12',
      sortOrder: 0,
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().title, 'Back up CloudNativePG');
  assert.equal(response.json().id, CREATED_TASK_ID);

  await app.close();
});

test('POST /api/tasks rejects invalid priority', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'urgent',
      status: 'planned',
      context: 'homelab',
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
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      context: 'homelab',
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
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      context: 'homelab',
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
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      context: 'homelab',
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
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Bad task',
      description: '',
      priority: 'high',
      status: 'planned',
      context: 'homelab',
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

test('PATCH /api/tasks/:id rejects empty body', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: createFakeRepository(),
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
  });

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${MISSING_TASK_ID}/restore`,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'task not found');

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
  });

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/tasks/${MISSING_TASK_ID}`,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().message, 'task not found');

  await app.close();
});
