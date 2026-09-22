import test from 'node:test';
import assert from 'node:assert/strict';

import { taskMatchesPatch } from '../../public/js/taskPatchOutcome.js';

test('task patch acknowledgement requires every exact observable field', () => {
  const task = { status: 'completed', priority: 'high', dueDate: '2026-07-14' };
  assert.equal(taskMatchesPatch(task, { status: 'completed', priority: 'high' }), true);
  assert.equal(taskMatchesPatch(task, { status: 'planned' }), false);
  assert.equal(taskMatchesPatch(task, {}), false);
  assert.equal(taskMatchesPatch(task, { project: 'homelab' }), false);
});

test('nullable scheduling fields acknowledge equivalent clearing', () => {
  const task = { dueDate: null, dueTime: null, deferredUntil: null, recurrence: null };
  assert.equal(taskMatchesPatch(task, { dueDate: null, dueTime: '', recurrence: '' }), true);
});

test('labels require the exact normalized ordered array', () => {
  const task = { labels: ['waiting', 'maintenance'] };
  assert.equal(taskMatchesPatch(task, { labels: ['waiting', 'maintenance'] }), true);
  assert.equal(taskMatchesPatch(task, { labels: ['maintenance', 'waiting'] }), false);
});

test('a plan-add readback confirms plannedFor after a lost response', () => {
  assert.equal(taskMatchesPatch({ plannedFor: '2026-09-22' }, { plannedFor: '2026-09-22' }), true);
  assert.equal(taskMatchesPatch({ plannedFor: null }, { plannedFor: '2026-09-22' }), false);
  assert.equal(taskMatchesPatch({ plannedFor: null }, { plannedFor: null }), true, 'dropping from the plan clears it');
});

test('project reassignment reconciles through the returned projectId', () => {
  assert.equal(taskMatchesPatch({ projectId: 'project-2' }, { project: 'project-2' }), true);
  assert.equal(taskMatchesPatch({ projectId: 'project-1' }, { project: 'project-2' }), false);
});
