import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_STORAGE_KEY, normalizeLayout, loadLayout, saveLayout } from '../../public/js/libraryLayout.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (key) => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); }, data };
}

test('normalizeLayout accepts cards and table and falls back to cards', () => {
  assert.equal(normalizeLayout('table'), 'table');
  assert.equal(normalizeLayout('cards'), 'cards');
  assert.equal(normalizeLayout('grid'), 'cards');
  assert.equal(normalizeLayout(null), 'cards');
});

test('load/save round-trip and tolerate broken storage', () => {
  const storage = memoryStorage();
  assert.equal(loadLayout(storage), 'cards');
  assert.equal(saveLayout('table', storage), 'table');
  assert.equal(storage.data[LAYOUT_STORAGE_KEY], 'table');
  assert.equal(loadLayout(storage), 'table');
  assert.equal(loadLayout(memoryStorage({ [LAYOUT_STORAGE_KEY]: 'nope' })), 'cards');
  assert.equal(saveLayout('table', { setItem() { throw new Error('quota'); } }), 'table');
  assert.equal(loadLayout(null), 'cards');
});
