import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDueReminders, isOverdue } from '../../public/js/dueReminders.js';

const NOW = new Date(2026, 6, 8, 10, 0, 0); // 2026-07-08 10:00

function task(overrides = {}) {
  return { id: 't', title: 'x', status: 'planned', dueDate: null, deferredUntil: null, archivedAt: null, ...overrides };
}

test('computeDueReminders selects tasks due today or earlier', () => {
  const tasks = [
    task({ id: 'today', dueDate: '2026-07-08' }),
    task({ id: 'overdue', dueDate: '2026-07-01' }),
    task({ id: 'future', dueDate: '2026-07-09' }),
    task({ id: 'nodue', dueDate: null }),
  ];
  assert.deepEqual(computeDueReminders(tasks, { now: NOW }).map((t) => t.id), ['today', 'overdue']);
});

test('computeDueReminders excludes completed, archived, and snoozed tasks', () => {
  const tasks = [
    task({ id: 'done', dueDate: '2026-07-01', status: 'completed' }),
    task({ id: 'archived', dueDate: '2026-07-01', archivedAt: '2026-07-02T00:00:00Z' }),
    task({ id: 'snoozed', dueDate: '2026-07-01', deferredUntil: '2026-07-20T00:00:00Z' }),
    task({ id: 'live', dueDate: '2026-07-01' }),
  ];
  assert.deepEqual(computeDueReminders(tasks, { now: NOW }).map((t) => t.id), ['live']);
});

test('computeDueReminders includes a task whose snooze has already elapsed', () => {
  const tasks = [task({ id: 'unsnoozed', dueDate: '2026-07-08', deferredUntil: '2026-07-07T00:00:00Z' })];
  assert.deepEqual(computeDueReminders(tasks, { now: NOW }).map((t) => t.id), ['unsnoozed']);
});

test('computeDueReminders tolerates empty / missing input', () => {
  assert.deepEqual(computeDueReminders(null, { now: NOW }), []);
  assert.deepEqual(computeDueReminders([], { now: NOW }), []);
});

test('isOverdue distinguishes overdue from due-today', () => {
  assert.equal(isOverdue('2026-07-07', NOW), true);
  assert.equal(isOverdue('2026-07-08', NOW), false); // due today is not overdue
  assert.equal(isOverdue(null, NOW), false);
});

// Time-of-day: a task due TODAY with a dueTime only warrants a reminder once its
// time has arrived; an overdue timed task fires regardless. NOW is 2026-07-08 10:00.
test('a task due today with a later dueTime is not reminded yet', () => {
  const picked = computeDueReminders([task({ dueDate: '2026-07-08', dueTime: '12:00' })], { now: NOW });
  assert.equal(picked.length, 0); // 10:00 < 12:00
});

test('a task due today whose dueTime has passed is reminded', () => {
  const picked = computeDueReminders([task({ dueDate: '2026-07-08', dueTime: '09:00' })], { now: NOW });
  assert.equal(picked.length, 1); // 10:00 >= 09:00
});

test('an overdue task with a dueTime is reminded regardless of the time', () => {
  const picked = computeDueReminders([task({ dueDate: '2026-07-07', dueTime: '23:30' })], { now: NOW });
  assert.equal(picked.length, 1); // date already past
});
