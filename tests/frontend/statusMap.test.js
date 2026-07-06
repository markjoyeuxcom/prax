import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGN_STATUSES,
  BOARD_COLUMNS,
  apiStatus,
  designStatus,
  apiPriority,
  designPriority,
  isBoardable,
  isOpen,
} from '../../public/js/statusMap.js';

test('design statuses round-trip through the API enum', () => {
  for (const status of DESIGN_STATUSES) {
    assert.equal(designStatus(apiStatus(status)), status);
  }
});

test('the API enum values map exactly onto the design vocabulary', () => {
  assert.equal(designStatus('high-priority'), 'priority');
  assert.equal(designStatus('in-progress'), 'inprogress');
  assert.equal(designStatus('planned'), 'planned');
  assert.equal(designStatus('completed'), 'completed');
  assert.equal(designStatus('notes'), 'backlog'); // the parking-lane relabel
});

test('unknown statuses fall back to planned on both sides', () => {
  assert.equal(apiStatus('bogus'), 'planned');
  assert.equal(designStatus('bogus'), 'planned');
  assert.equal(designStatus(undefined), 'planned');
});

test('board columns are the four design columns, no backlog', () => {
  assert.deepEqual(BOARD_COLUMNS, ['priority', 'inprogress', 'planned', 'completed']);
});

test('priority maps med↔medium and passes high/low through', () => {
  assert.equal(apiPriority('med'), 'medium');
  assert.equal(designPriority('medium'), 'med');
  assert.equal(apiPriority('high'), 'high');
  assert.equal(designPriority('low'), 'low');
  assert.equal(apiPriority(undefined), 'medium');
  assert.equal(designPriority(undefined), 'med');
});

test('backlog and archived tasks are never boardable', () => {
  assert.equal(isBoardable({ status: 'notes', archivedAt: null }), false);
  assert.equal(isBoardable({ status: 'planned', archivedAt: '2026-07-01T00:00:00Z' }), false);
  assert.equal(isBoardable({ status: 'planned', archivedAt: null }), true);
  assert.equal(isBoardable({ status: 'high-priority', archivedAt: null }), true);
});

test('isOpen excludes completed, backlog, and archived', () => {
  assert.equal(isOpen({ status: 'completed', archivedAt: null }), false);
  assert.equal(isOpen({ status: 'notes', archivedAt: null }), false);
  assert.equal(isOpen({ status: 'in-progress', archivedAt: '2026-07-01T00:00:00Z' }), false);
  assert.equal(isOpen({ status: 'in-progress', archivedAt: null }), true);
});
