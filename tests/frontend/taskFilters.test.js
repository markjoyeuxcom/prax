import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks } from '../../public/js/taskFilters.js';

const tasks = [
  {
    id: 'task-1',
    title: 'Back up CNPG',
    description: 'Verify backup schedule',
    priority: 'high',
    status: 'planned',
    context: 'homelab',
    dueDate: '2026-05-17',
  },
  {
    id: 'task-2',
    title: 'Prepare review',
    description: 'Work planning',
    priority: 'medium',
    status: 'in-progress',
    tab: 'work',
    dueDate: null,
  },
];

test('filterTasks returns all tasks for blank search', () => {
  assert.deepEqual(filterTasks(tasks, ''), tasks);
  assert.deepEqual(filterTasks(tasks, '   '), tasks);
});

test('filterTasks matches title and description case-insensitively', () => {
  assert.deepEqual(filterTasks(tasks, 'cnpg').map(task => task.id), ['task-1']);
  assert.deepEqual(filterTasks(tasks, 'WORK PLANNING').map(task => task.id), ['task-2']);
});

test('filterTasks matches metadata fields', () => {
  assert.deepEqual(filterTasks(tasks, 'in progress').map(task => task.id), ['task-2']);
  assert.deepEqual(filterTasks(tasks, 'homelab').map(task => task.id), ['task-1']);
  assert.deepEqual(filterTasks(tasks, '2026-05-17').map(task => task.id), ['task-1']);
});

test('filterTasks returns an empty array when nothing matches', () => {
  assert.deepEqual(filterTasks(tasks, 'does-not-exist'), []);
});
