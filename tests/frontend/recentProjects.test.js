import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT_STORAGE_KEY, MAX_RECENT, normalizeRecent, loadRecent, saveRecent, pushRecent,
  RECENT_DOCS_STORAGE_KEY, MAX_RECENT_DOCS, loadRecentDocuments, saveRecentDocuments, pushRecentDocument,
} from '../../public/js/recentProjects.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    data,
  };
}

test('pushRecent moves a project to the front, dedupes, and caps at MAX_RECENT', () => {
  assert.deepEqual(pushRecent([], 'a'), ['a']);
  assert.deepEqual(pushRecent(['a'], 'b'), ['b', 'a']);
  assert.deepEqual(pushRecent(['b', 'a'], 'a'), ['a', 'b']);
  assert.deepEqual(pushRecent(['c', 'b', 'a'], 'd'), ['d', 'c', 'b']);
  assert.equal(MAX_RECENT, 3);
  assert.deepEqual(pushRecent(['a'], ''), ['a']);
  assert.deepEqual(pushRecent(['a'], null), ['a']);
});

test('normalizeRecent drops junk and duplicates', () => {
  assert.deepEqual(normalizeRecent(['a', 3, '', 'a', 'b', null, 'c', 'd']), ['a', 'b', 'c']);
  assert.deepEqual(normalizeRecent('nope'), []);
});

test('load/save round-trip through storage and tolerate broken storage', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadRecent(storage), []);
  assert.deepEqual(saveRecent(['x', 'y'], storage), ['x', 'y']);
  assert.equal(storage.data[RECENT_STORAGE_KEY], '["x","y"]');
  assert.deepEqual(loadRecent(storage), ['x', 'y']);
  assert.deepEqual(loadRecent(memoryStorage({ [RECENT_STORAGE_KEY]: '{not json' })), []);
  assert.deepEqual(saveRecent(['z'], { setItem() { throw new Error('quota'); } }), ['z']);
  assert.deepEqual(loadRecent(null), []);
});

test('recent documents: their own key, cap of five, same push and storage rules', () => {
  assert.equal(MAX_RECENT_DOCS, 5);
  assert.deepEqual(pushRecentDocument([], 'd1'), ['d1']);
  assert.deepEqual(pushRecentDocument(['d1', 'd2'], 'd2'), ['d2', 'd1']);
  assert.deepEqual(pushRecentDocument(['a', 'b', 'c', 'd', 'e'], 'f'), ['f', 'a', 'b', 'c', 'd']);
  const storage = memoryStorage();
  saveRecentDocuments(['x'], storage);
  assert.equal(storage.data[RECENT_DOCS_STORAGE_KEY], '["x"]');
  assert.deepEqual(loadRecentDocuments(storage), ['x']);
  assert.deepEqual(loadRecentDocuments(memoryStorage({ [RECENT_DOCS_STORAGE_KEY]: 'nope' })), []);
});
