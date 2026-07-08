import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidRecurrence, nextDueDate } from '../../server/recurrence.js';

const WED = new Date(2026, 6, 8); // 2026-07-08, a Wednesday

test('isValidRecurrence accepts presets, every:Nd/Nw, and clearing', () => {
  for (const r of ['daily', 'weekly', 'monthly', 'every:3d', 'every:2w', '', null, undefined]) {
    assert.equal(isValidRecurrence(r), true, `expected ${r} valid`);
  }
  for (const r of ['yearly', 'every:0d', 'every:d', 'every:3m', 'weekly ', 5, {}]) {
    assert.equal(isValidRecurrence(r), false, `expected ${r} invalid`);
  }
});

test('nextDueDate advances one interval from the due date', () => {
  assert.equal(nextDueDate('daily', '2026-07-08', WED), '2026-07-09');
  assert.equal(nextDueDate('weekly', '2026-07-08', WED), '2026-07-15');
  assert.equal(nextDueDate('monthly', '2026-07-08', WED), '2026-08-08');
  assert.equal(nextDueDate('every:3d', '2026-07-08', WED), '2026-07-11');
  assert.equal(nextDueDate('every:2w', '2026-07-08', WED), '2026-07-22');
});

test('nextDueDate clamps a monthly on the 31st to the short month', () => {
  // Jan 31 + 1 month → Feb 28 (2026 is not a leap year)
  assert.equal(nextDueDate('monthly', '2026-01-31', new Date(2026, 0, 31)), '2026-02-28');
});

test('nextDueDate rolls forward past today when the task is completed late', () => {
  // due long ago, daily → the next instance is tomorrow, not a past date
  assert.equal(nextDueDate('daily', '2026-06-01', WED), '2026-07-09');
  // weekly overdue → first weekly slot strictly after today
  assert.equal(nextDueDate('weekly', '2026-06-24', WED), '2026-07-15');
});

test('nextDueDate falls back to today when the task has no due date', () => {
  assert.equal(nextDueDate('daily', null, WED), '2026-07-09');
  assert.equal(nextDueDate('weekly', '', WED), '2026-07-15');
});

test('nextDueDate returns null for no/invalid recurrence', () => {
  assert.equal(nextDueDate(null, '2026-07-08', WED), null);
  assert.equal(nextDueDate('yearly', '2026-07-08', WED), null);
});
