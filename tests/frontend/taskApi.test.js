import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveTask, updateTask } from '../../public/js/taskApi.js';

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

test('updateTask throws when the API rejects the request', async () => {
  globalThis.fetch = async () => jsonResponse({ message: 'bad' }, false);

  await assert.rejects(
    () => updateTask('task-1', { title: 'Updated task' }),
    /Failed to update task/,
  );
});
