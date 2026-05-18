import test from 'node:test';
import assert from 'node:assert/strict';
import { isArchiveView, tasksForView } from '../../public/js/taskViews.js';

const tasks = [
  { id: 'task-1', status: 'planned', dueDate: null },
  { id: 'task-2', status: 'planned', dueDate: '2026-05-18' },
  { id: 'task-3', status: 'in-progress', dueDate: null },
];

test('tasksForView returns active task set for Today and Board', () => {
  assert.deepEqual(tasksForView(tasks, 'list'), tasks);
  assert.deepEqual(tasksForView(tasks, 'board'), tasks);
});

test('tasksForView returns planned tasks without due dates for Backlog', () => {
  assert.deepEqual(tasksForView(tasks, 'backlog').map(task => task.id), ['task-1']);
});

test('tasksForView returns loaded archived tasks for Archive', () => {
  assert.deepEqual(tasksForView(tasks, 'archive'), tasks);
});

test('isArchiveView only matches archive view', () => {
  assert.equal(isArchiveView('archive'), true);
  assert.equal(isArchiveView('list'), false);
  assert.equal(isArchiveView('board'), false);
});
