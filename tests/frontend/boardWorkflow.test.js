import test from 'node:test';
import assert from 'node:assert/strict';
import { moveTaskOnBoard } from '../../public/js/boardWorkflow.js';

const TASKS = [
  { id: 'task-1', title: 'Patch ingress', status: 'planned', sortOrder: 0 },
  { id: 'task-2', title: 'Backup CNPG', status: 'planned', sortOrder: 1 },
  { id: 'task-3', title: 'Restore drill', status: 'in-progress', sortOrder: 0 },
];

test('moveTaskOnBoard moves a task into another status column', () => {
  const result = moveTaskOnBoard(TASKS, {
    taskId: 'task-2',
    targetStatus: 'in-progress',
  });

  assert.deepEqual(
    result.tasks.map(task => ({ id: task.id, status: task.status, sortOrder: task.sortOrder })),
    [
      { id: 'task-3', status: 'in-progress', sortOrder: 0 },
      { id: 'task-2', status: 'in-progress', sortOrder: 1 },
      { id: 'task-1', status: 'planned', sortOrder: 0 },
    ],
  );
  assert.deepEqual(result.updates, [
    { id: 'task-2', status: 'in-progress', sortOrder: 1 },
  ]);
});

test('moveTaskOnBoard inserts a moved task before a target card', () => {
  const result = moveTaskOnBoard(TASKS, {
    taskId: 'task-2',
    targetStatus: 'in-progress',
    beforeTaskId: 'task-3',
  });

  assert.deepEqual(
    result.tasks.filter(task => task.status === 'in-progress').map(task => task.id),
    ['task-2', 'task-3'],
  );
  assert.deepEqual(result.updates, [
    { id: 'task-2', status: 'in-progress', sortOrder: 0 },
    { id: 'task-3', status: 'in-progress', sortOrder: 1 },
  ]);
});

test('moveTaskOnBoard returns no updates for a missing task', () => {
  const result = moveTaskOnBoard(TASKS, {
    taskId: 'missing-task',
    targetStatus: 'completed',
  });

  assert.deepEqual(result.tasks, TASKS);
  assert.deepEqual(result.updates, []);
});
