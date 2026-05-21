import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTask, buildMetrics } from '../../public/js/taskModel.js';

test('normalizeTask maps backend fields into UI task shape', () => {
  const task = normalizeTask({
    id: 'task-1',
    title: 'Back up CNPG',
    description: '',
    priority: 'high',
    status: 'planned',
    projectId: 'homelab-id',
    dueDate: '2026-05-10',
    sortOrder: 3,
  });

  assert.equal(task.id, 'task-1');
  assert.equal(task.column, 'planned');
  assert.equal(task.projectId, 'homelab-id');
  assert.equal(task.order, 3);
});

test('normalizeTask maps backend completed timestamp', () => {
  const task = normalizeTask({
    id: 'task-1',
    title: 'Review restore drill',
    completed_at: '2026-05-10T12:00:00Z',
  });

  assert.equal(task.completedAt, '2026-05-10T12:00:00Z');
});

test('buildMetrics returns required counts for the dashboard summary', () => {
  const metrics = buildMetrics([
    { dueDate: '2026-05-10', priority: 'high', status: 'planned', column: 'planned' },
    { dueDate: '2026-05-09', priority: 'medium', status: 'planned', column: 'planned' },
    { dueDate: null, priority: 'high', status: 'in-progress', column: 'in-progress' },
    { dueDate: null, priority: 'low', status: 'completed', column: 'completed', updatedAt: '2026-05-10' },
  ], '2026-05-10');

  assert.equal(metrics.total, 4);
  assert.equal(metrics.dueToday, 1);
  assert.equal(metrics.completedThisWeek, 1);
  assert.equal(metrics.highPriority, 2);
  assert.equal(metrics.overdue, 1);
  assert.equal(metrics.inProgress, 1);
});

test('buildMetrics counts completed tasks updated in the same week as today', () => {
  const metrics = buildMetrics([
    { dueDate: null, status: 'completed', column: 'completed', updatedAt: '2026-05-10' },
  ], '2026-05-10');

  assert.equal(metrics.completedThisWeek, 1);
});

test('buildMetrics prefers completedAt over updatedAt for completed-this-week counts', () => {
  const metrics = buildMetrics([
    {
      dueDate: null,
      status: 'completed',
      column: 'completed',
      completedAt: '2026-04-20',
      updatedAt: '2026-05-10',
    },
  ], '2026-05-10');

  assert.equal(metrics.completedThisWeek, 0);
});

test('buildMetrics ignores completed tasks updated outside the same week as today', () => {
  const metrics = buildMetrics([
    { dueDate: null, status: 'completed', column: 'completed', updatedAt: '2026-04-20' },
  ], '2026-05-10');

  assert.equal(metrics.completedThisWeek, 0);
});

test('buildMetrics ignores completed tasks without completion or update timestamps', () => {
  const metrics = buildMetrics([
    { dueDate: null, status: 'completed', column: 'completed' },
  ], '2026-05-10');

  assert.equal(metrics.completedThisWeek, 0);
});
