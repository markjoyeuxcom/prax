import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBoardGrouping, persistBoardGrouping, loadListGrouping, persistListGrouping } from '../../public/js/state.js';

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    values,
  };
}

test('loadBoardGrouping defaults to flat when unset or unknown', () => {
  assert.equal(loadBoardGrouping(storageWith()), 'flat');
  assert.equal(loadBoardGrouping(storageWith({ 'moomora.boardGrouping.v1': 'weird' })), 'flat');
});

test('loadBoardGrouping returns swimlanes when stored', () => {
  assert.equal(loadBoardGrouping(storageWith({ 'moomora.boardGrouping.v1': 'swimlanes' })), 'swimlanes');
});

test('persistBoardGrouping stores a normalized value', () => {
  const storage = storageWith();
  persistBoardGrouping('swimlanes', storage);
  assert.equal(storage.getItem('moomora.boardGrouping.v1'), 'swimlanes');
  persistBoardGrouping('nonsense', storage);
  assert.equal(storage.getItem('moomora.boardGrouping.v1'), 'flat');
});

test('loadListGrouping defaults to flat when unset or unknown', () => {
  assert.equal(loadListGrouping(storageWith()), 'flat');
  assert.equal(loadListGrouping(storageWith({ 'moomora.listGrouping.v1': 'weird' })), 'flat');
});

test('loadListGrouping returns swimlanes when stored', () => {
  assert.equal(loadListGrouping(storageWith({ 'moomora.listGrouping.v1': 'swimlanes' })), 'swimlanes');
});

test('persistListGrouping stores a normalized value', () => {
  const storage = storageWith();
  persistListGrouping('swimlanes', storage);
  assert.equal(storage.getItem('moomora.listGrouping.v1'), 'swimlanes');
  persistListGrouping('nonsense', storage);
  assert.equal(storage.getItem('moomora.listGrouping.v1'), 'flat');
});
