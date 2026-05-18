import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveTask, reorderTasks, restoreTask, updateTask } from '../../public/js/taskApi.js';

function jsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

test('updateTask sends a PATCH request with JSON payload', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'task-1', title: 'Updated task' });
  };

  const task = await updateTask('task-1', { title: 'Updated task' });

  assert.deepEqual(task, { id: 'task-1', title: 'Updated task' });
  assert.equal(calls[0][0], '/api/tasks/task-1');
  assert.equal(calls[0][1].method, 'PATCH');
  assert.deepEqual(calls[0][1].headers, { 'content-type': 'application/json' });
  assert.equal(calls[0][1].body, JSON.stringify({ title: 'Updated task' }));
});

test('archiveTask sends a DELETE request', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'task-1' });
  };

  const task = await archiveTask('task-1');

  assert.deepEqual(task, { id: 'task-1' });
  assert.equal(calls[0][0], '/api/tasks/task-1');
  assert.equal(calls[0][1].method, 'DELETE');
});

test('restoreTask sends a PATCH request to the restore endpoint', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'task-1', archivedAt: null });
  };

  const task = await restoreTask('task-1');

  assert.deepEqual(task, { id: 'task-1', archivedAt: null });
  assert.equal(calls[0][0], '/api/tasks/task-1/restore');
  assert.equal(calls[0][1].method, 'PATCH');
});

test('reorderTasks sends a PATCH request with ordered task updates', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse([{ id: 'task-1', status: 'in-progress', sortOrder: 0 }]);
  };

  const tasks = await reorderTasks([
    { id: 'task-1', status: 'in-progress', sortOrder: 0 },
  ]);

  assert.deepEqual(tasks, [{ id: 'task-1', status: 'in-progress', sortOrder: 0 }]);
  assert.equal(calls[0][0], '/api/tasks/reorder');
  assert.equal(calls[0][1].method, 'PATCH');
  assert.deepEqual(calls[0][1].headers, { 'content-type': 'application/json' });
  assert.equal(calls[0][1].body, JSON.stringify({
    tasks: [{ id: 'task-1', status: 'in-progress', sortOrder: 0 }],
  }));
});

test('updateTask throws when the API rejects the request', async () => {
  globalThis.fetch = async () => jsonResponse({ message: 'bad' }, false);

  await assert.rejects(
    () => updateTask('task-1', { title: 'Updated task' }),
    /Failed to update task/,
  );
});

test('restoreTask throws when the API rejects the request', async () => {
  globalThis.fetch = async () => jsonResponse({ message: 'bad' }, false);

  await assert.rejects(
    () => restoreTask('task-1'),
    /Failed to restore task/,
  );
});
