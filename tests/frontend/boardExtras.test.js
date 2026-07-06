import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_EXTRA_FETCH_BATCH_SIZE,
  batchIds,
  clearTaskBoardExtra,
  pendingExtraIds,
} from '../../public/js/boardExtras.js';

test('pendingExtraIds skips cached, in-flight, duplicate, and falsy ids', () => {
  const extras = { a: { docsCount: 1 } };
  const loading = { b: 'token' };
  assert.deepEqual(pendingExtraIds(['a', 'b', 'c', 'c', null, 'd'], extras, loading), ['c', 'd']);
});

test('pendingExtraIds treats a cached empty extra as cached', () => {
  const extras = { a: { docsCount: 0, checklistTotal: 0 } };
  assert.deepEqual(pendingExtraIds(['a'], extras, {}), []);
});

test('batchIds splits into batches of the fetch size', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `t${i}`);
  const batches = batchIds(ids);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, BOARD_EXTRA_FETCH_BATCH_SIZE);
  assert.equal(batches[2].length, 20);
  assert.deepEqual(batchIds([]), []);
});

test('clearTaskBoardExtra returns a patch without the invalidated task', () => {
  const state = { taskBoardExtras: { a: { docsCount: 1 }, b: { docsCount: 2 } } };
  const patch = clearTaskBoardExtra(state, 'a');
  assert.deepEqual(Object.keys(patch.taskBoardExtras), ['b']);
  // untouched ids: no patch at all
  assert.deepEqual(clearTaskBoardExtra(state, 'zz'), {});
  // original state not mutated
  assert.ok(state.taskBoardExtras.a);
});
