import test from 'node:test';
import assert from 'node:assert/strict';
import { loadActiveProject, persistActiveProject, state, setState } from '../../public/js/state.js';

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test('loadActiveProject keeps the pre-rename storage key and defaults to all', () => {
  assert.equal(loadActiveProject(storageWith()), 'all');
  assert.equal(loadActiveProject(storageWith({ 'moomora.activeProject.v1': 'proj-1' })), 'proj-1');
});

test('persistActiveProject round-trips through the same key', () => {
  const storage = storageWith();
  persistActiveProject('proj-9', storage);
  assert.equal(storage.getItem('moomora.activeProject.v1'), 'proj-9');
  assert.equal(loadActiveProject(storage), 'proj-9');
});

test('storage failures fall back silently', () => {
  const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
  assert.equal(loadActiveProject(broken), 'all');
  assert.doesNotThrow(() => persistActiveProject('x', broken));
});

test('setState patches the shared state object', () => {
  const before = state.groupBy;
  setState({ groupBy: 'priority' });
  assert.equal(state.groupBy, 'priority');
  setState({ groupBy: before });
});
