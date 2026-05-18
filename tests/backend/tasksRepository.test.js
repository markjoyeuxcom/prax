import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTasksRepository,
  buildImportTasks,
  normalizeTaskRow,
  buildCreateTask,
  buildReorderTasks,
  buildRestoreTask,
  buildUpdateTask,
} from '../../server/tasksRepository.js';

test('normalizeTaskRow maps database fields to API task fields', () => {
  const task = normalizeTaskRow({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Back up CloudNativePG',
    description: 'Verify backup schedule',
    priority: 'high',
    status: 'planned',
    context: 'homelab',
    due_date: '2026-05-11',
    sort_order: 2,
    archived_at: null,
    created_at: '2026-05-10T10:00:00.000Z',
    updated_at: '2026-05-10T10:00:00.000Z',
  });

  assert.deepEqual(task, {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Back up CloudNativePG',
    description: 'Verify backup schedule',
    priority: 'high',
    status: 'planned',
    context: 'homelab',
    dueDate: '2026-05-11',
    sortOrder: 2,
    archivedAt: null,
    createdAt: '2026-05-10T10:00:00.000Z',
    updatedAt: '2026-05-10T10:00:00.000Z',
  });
});

test('buildCreateTask returns parameterized insert query', () => {
  const query = buildCreateTask({
    title: 'Wire API adapter',
    description: '',
    priority: 'high',
    status: 'in-progress',
    context: 'homelab',
    dueDate: '2026-05-12',
    sortOrder: 0,
  });

  assert.match(query.text, /insert into tasks/);
  assert.equal(query.values.length, 7);
  assert.equal(query.values[0], 'Wire API adapter');
});

test('buildUpdateTask rejects empty updates', () => {
  assert.throws(
    () => buildUpdateTask('11111111-1111-4111-8111-111111111111', {}),
    /No task fields provided/
  );
});

test('buildReorderTasks returns a parameterized batch update query', () => {
  const query = buildReorderTasks([
    { id: '11111111-1111-4111-8111-111111111111', status: 'planned', sortOrder: 0 },
    { id: '22222222-2222-4222-8222-222222222222', status: 'in-progress', sortOrder: 1 },
  ]);

  assert.match(query.text, /with updates/);
  assert.match(query.text, /update tasks/);
  assert.match(query.text, /archived_at is null/);
  assert.deepEqual(query.values, [
    '11111111-1111-4111-8111-111111111111',
    'planned',
    0,
    '22222222-2222-4222-8222-222222222222',
    'in-progress',
    1,
  ]);
});

test('buildReorderTasks rejects empty updates', () => {
  assert.throws(
    () => buildReorderTasks([]),
    /No task reorder updates provided/,
  );
});

test('buildRestoreTask returns a parameterized restore query', () => {
  const query = buildRestoreTask('11111111-1111-4111-8111-111111111111');

  assert.match(query.text, /update tasks/);
  assert.match(query.text, /archived_at = null/);
  assert.match(query.text, /updated_at = now\(\)/);
  assert.match(query.text, /where id = \$1 and archived_at is not null/);
  assert.match(query.text, /returning \*/);
  assert.deepEqual(query.values, ['11111111-1111-4111-8111-111111111111']);
});

test('buildImportTasks returns a parameterized batch insert query', () => {
  const query = buildImportTasks([
    {
      title: 'Imported task',
      description: 'From backup',
      priority: 'medium',
      status: 'planned',
      context: 'homelab',
      dueDate: '2026-05-18',
      sortOrder: 2,
      archivedAt: null,
    },
    {
      title: 'Archived task',
      description: '',
      priority: 'low',
      status: 'completed',
      context: 'homelab',
      dueDate: null,
      sortOrder: 3,
      archivedAt: '2026-05-11T12:00:00.000Z',
    },
  ]);

  assert.match(query.text, /insert into tasks/);
  assert.match(query.text, /archived_at/);
  assert.match(query.text, /returning \*/);
  assert.deepEqual(query.values, [
    'Imported task',
    'From backup',
    'medium',
    'planned',
    'homelab',
    '2026-05-18',
    2,
    null,
    'Archived task',
    '',
    'low',
    'completed',
    'homelab',
    null,
    3,
    '2026-05-11T12:00:00.000Z',
  ]);
});

test('buildImportTasks rejects empty imports', () => {
  assert.throws(
    () => buildImportTasks([]),
    /No task import records provided/,
  );
});

test('listTasks filters active tasks by default', async () => {
  const calls = [];
  const repository = createTasksRepository({
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  await repository.listTasks();

  assert.match(calls[0].text, /archived_at is null/);
});

test('listTasks filters active tasks when requested', async () => {
  const calls = [];
  const repository = createTasksRepository({
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  await repository.listTasks({ archived: false });

  assert.match(calls[0].text, /archived_at is null/);
});

test('listTasks filters archived tasks when requested', async () => {
  const calls = [];
  const repository = createTasksRepository({
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  await repository.listTasks({ archived: true });

  assert.match(calls[0].text, /archived_at is not null/);
});

test('listTasks parameterizes context status and search filters', async () => {
  const calls = [];
  const repository = createTasksRepository({
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [] };
    },
  });

  await repository.listTasks({
    context: 'homelab',
    status: 'planned',
    q: 'backup',
  });

  assert.match(calls[0].text, /context = \$1/);
  assert.match(calls[0].text, /status = \$2/);
  assert.match(calls[0].text, /title ilike \$3 or description ilike \$3/);
  assert.deepEqual(calls[0].values, ['homelab', 'planned', '%backup%']);
});
