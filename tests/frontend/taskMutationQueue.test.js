import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskMutationQueue } from '../../public/js/taskMutationQueue.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('same-task mutations execute serially in submission order', async () => {
  const enqueue = createTaskMutationQueue();
  const gate = deferred();
  const events = [];
  const first = enqueue('task-1', async () => {
    events.push('first:start');
    await gate.promise;
    events.push('first:end');
  });
  const second = enqueue('task-1', async () => { events.push('second'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second']);
});

test('different tasks can mutate independently', async () => {
  const enqueue = createTaskMutationQueue();
  const gate = deferred();
  const events = [];
  const first = enqueue('task-1', async () => { await gate.promise; events.push('task-1'); });
  const second = enqueue('task-2', async () => { events.push('task-2'); });
  await second;
  assert.deepEqual(events, ['task-2']);
  gate.resolve();
  await first;
});

test('a rejected mutation does not poison the task queue', async () => {
  const enqueue = createTaskMutationQueue();
  await assert.rejects(enqueue('task-1', async () => { throw new Error('injected'); }), /injected/);
  assert.equal(await enqueue('task-1', async () => 'recovered'), 'recovered');
});
