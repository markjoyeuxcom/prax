import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTasksRepository,
  buildDeleteArchivedTask,
  buildImportTasks,
  buildReplaceContextTasks,
  normalizeTaskRow,
  buildCreateTask,
  buildReorderTasks,
  buildRestoreTask,
  buildUpdateTask,
  buildListTaskDocuments,
  buildLinkTaskDocument,
  buildUnlinkTaskDocument,
  buildLinkExists,
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

test('buildDeleteArchivedTask permanently deletes only archived tasks', () => {
  const query = buildDeleteArchivedTask('11111111-1111-4111-8111-111111111111');

  assert.match(query.text, /delete from tasks/);
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

test('buildReplaceContextTasks deletes one context and inserts imported tasks', () => {
  const query = buildReplaceContextTasks('homelab', [
    {
      title: 'Imported task',
      description: '',
      priority: 'medium',
      status: 'planned',
      context: 'homelab',
      dueDate: null,
      sortOrder: 0,
      archivedAt: null,
    },
  ]);

  assert.match(query.text, /delete from tasks/);
  assert.match(query.text, /where context = \$1/);
  assert.match(query.text, /insert into tasks/);
  assert.match(query.text, /returning \*/);
  assert.deepEqual(query.values, [
    'homelab',
    'Imported task',
    '',
    'medium',
    'planned',
    'homelab',
    null,
    0,
    null,
  ]);
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

test('buildListTaskDocuments returns join query with task_id param', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const query = buildListTaskDocuments(taskId);

  assert.match(query.text, /select d\.id, d\.title, d\.document_type, d\.context/);
  assert.match(query.text, /from task_documents td/);
  assert.match(query.text, /join markdown_documents d on d\.id = td\.document_id/);
  assert.match(query.text, /where td\.task_id = \$1 and d\.archived_at is null/);
  assert.match(query.text, /order by d\.title/);
  assert.deepEqual(query.values, [taskId]);
});

test('buildLinkTaskDocument returns guarded insert with on conflict do nothing', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';
  const query = buildLinkTaskDocument(taskId, documentId);

  assert.match(query.text, /insert into task_documents/);
  assert.match(query.text, /select \$1, \$2/);
  assert.match(query.text, /where exists.*tasks.*archived_at is null/s);
  assert.match(query.text, /where exists.*markdown_documents.*archived_at is null/s);
  assert.match(query.text, /on conflict \(task_id, document_id\) do nothing/);
  assert.match(query.text, /returning task_id, document_id/);
  assert.deepEqual(query.values, [taskId, documentId]);
});

test('buildUnlinkTaskDocument returns delete with both ids', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';
  const query = buildUnlinkTaskDocument(taskId, documentId);

  assert.match(query.text, /delete from task_documents/);
  assert.match(query.text, /where task_id = \$1 and document_id = \$2/);
  assert.match(query.text, /returning task_id, document_id/);
  assert.deepEqual(query.values, [taskId, documentId]);
});

test('buildLinkExists returns select with both ids joining non-archived tasks and docs', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';
  const query = buildLinkExists(taskId, documentId);

  assert.match(query.text, /select 1/);
  assert.match(query.text, /from task_documents td/);
  assert.match(query.text, /join tasks t on t\.id = td\.task_id and t\.archived_at is null/);
  assert.match(query.text, /join markdown_documents d on d\.id = td\.document_id and d\.archived_at is null/);
  assert.match(query.text, /where td\.task_id = \$1 and td\.document_id = \$2/);
  assert.deepEqual(query.values, [taskId, documentId]);
});

test('linkTaskDocument returns {linked:true} when db inserts a row', async () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';
  const repository = createTasksRepository({
    async query() {
      return { rows: [{ task_id: taskId, document_id: documentId }] };
    },
  });

  const result = await repository.linkTaskDocument(taskId, documentId);
  assert.deepEqual(result, { linked: true });
});

test('linkTaskDocument returns {linked:true,alreadyLinked:true} when insert is no-op but link exists', async () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';
  let callCount = 0;
  const repository = createTasksRepository({
    async query() {
      callCount += 1;
      if (callCount === 1) return { rows: [] }; // insert returned nothing (conflict)
      return { rows: [{ 1: 1 }] }; // exists check finds it
    },
  });

  const result = await repository.linkTaskDocument(taskId, documentId);
  assert.deepEqual(result, { linked: true, alreadyLinked: true });
});

test('linkTaskDocument returns {linked:false} when task or doc is missing/archived', async () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';
  const repository = createTasksRepository({
    async query() {
      return { rows: [] }; // both insert and exists return nothing
    },
  });

  const result = await repository.linkTaskDocument(taskId, documentId);
  assert.deepEqual(result, { linked: false });
});

test('unlinkTaskDocument returns true when a row is deleted', async () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';
  const repository = createTasksRepository({
    async query() {
      return { rows: [{ task_id: taskId, document_id: documentId }] };
    },
  });

  const result = await repository.unlinkTaskDocument(taskId, documentId);
  assert.equal(result, true);
});

test('unlinkTaskDocument returns false when link does not exist', async () => {
  const repository = createTasksRepository({
    async query() {
      return { rows: [] };
    },
  });

  const result = await repository.unlinkTaskDocument(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  );
  assert.equal(result, false);
});
