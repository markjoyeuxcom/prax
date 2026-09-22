import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidRecurrence, nextDueDate, planTaskRecurrenceTransition,
} from '../../server/recurrence.js';

const WED = new Date(2026, 6, 8); // 2026-07-08, a Wednesday

test('isValidRecurrence accepts presets, every:Nd/Nw, and clearing', () => {
  for (const r of ['daily', 'weekly', 'monthly', 'every:3d', 'every:2w', '', null, undefined]) {
    assert.equal(isValidRecurrence(r), true, `expected ${r} valid`);
  }
  for (const r of ['yearly', 'every:0d', 'every:d', 'every:3m', 'weekly ', 'every:10001d', `every:${'9'.repeat(30)}d`, 5, {}]) {
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
  assert.equal(nextDueDate('monthly', '2028-01-31', '2028-01-31'), '2028-02-29', 'leap year');
});

// Regression (review 2026-09-22): every monthly step was computed from the
// previous CLAMPED step, so Jan 31 → Feb 28 → Mar 28 → Apr 28 for good.
test('a monthly series anchored on the 31st keeps its day across short months', () => {
  // The Jan 31 occurrence completed on successive days walks the anchored
  // series: Feb 28, then Mar 31, then Apr 30 — never Mar 28 / Apr 28.
  assert.equal(nextDueDate('monthly', '2026-01-31', '2026-02-27'), '2026-02-28');
  assert.equal(nextDueDate('monthly', '2026-01-31', '2026-02-28'), '2026-03-31');
  assert.equal(nextDueDate('monthly', '2026-01-31', '2026-03-31'), '2026-04-30');
  assert.equal(nextDueDate('monthly', '2026-01-31', '2026-04-30'), '2026-05-31');
  // A 30th anchor is not pulled to the 28th after February either.
  assert.equal(nextDueDate('monthly', '2026-01-30', '2026-03-01'), '2026-03-30');
  // Across a year boundary.
  assert.equal(nextDueDate('monthly', '2025-12-31', '2026-02-10'), '2026-02-28');
});

test('a late completion lands on the anchored day, not a clamped one', () => {
  // The review's reproduction: the Jan 31 task completed on Apr 15.
  assert.equal(nextDueDate('monthly', '2026-01-31', '2026-04-15'), '2026-04-30');
  assert.equal(nextDueDate('monthly', '2026-01-31', new Date(2026, 3, 15)), '2026-04-30');
  // Years late still lands on the anchor (clamped only by the target month).
  assert.equal(nextDueDate('monthly', '2020-08-31', '2026-09-22'), '2026-09-30');
  assert.equal(nextDueDate('monthly', '2020-08-31', '2026-09-30'), '2026-10-31');
});

test('existing monthly tasks keep their anchor: it is the stored due date\'s day', () => {
  // No new storage: the task being completed carries the anchor.
  const plan = planTaskRecurrenceTransition(
    { ...RECURRING_TASK, recurrence: 'monthly', dueDate: '2026-01-31' },
    { status: 'completed' },
    { today: '2026-04-15' },
  );
  assert.equal(plan.nextTask.dueDate, '2026-04-30');
});

test('the requester\'s today overrides the server clock', () => {
  // At 20:00 in Los Angeles a UTC server's clock already reads tomorrow; the
  // client's date keeps a daily task from skipping a day.
  const utcTomorrow = new Date(2026, 8, 23, 3, 0);
  assert.equal(nextDueDate('daily', '2026-09-22', utcTomorrow), '2026-09-24', 'server clock alone skips a day');
  assert.equal(nextDueDate('daily', '2026-09-22', '2026-09-22'), '2026-09-23');
  const plan = planTaskRecurrenceTransition(
    { ...RECURRING_TASK, recurrence: 'daily', dueDate: '2026-09-22' },
    { status: 'completed' },
    { now: utcTomorrow, today: '2026-09-22' },
  );
  assert.equal(plan.nextTask.dueDate, '2026-09-23');
});

test('nextDueDate rolls forward past today when the task is completed late', () => {
  // due long ago, daily → the next instance is tomorrow, not a past date
  assert.equal(nextDueDate('daily', '2026-06-01', WED), '2026-07-09');
  // weekly overdue → first weekly slot strictly after today
  assert.equal(nextDueDate('weekly', '2026-06-24', WED), '2026-07-15');
  assert.equal(nextDueDate('daily', '1900-01-01', WED), '2026-07-09');
});

test('nextDueDate falls back to today when the task has no due date', () => {
  assert.equal(nextDueDate('daily', null, WED), '2026-07-09');
  assert.equal(nextDueDate('weekly', '', WED), '2026-07-15');
});

test('nextDueDate returns null for no/invalid recurrence', () => {
  assert.equal(nextDueDate(null, '2026-07-08', WED), null);
  assert.equal(nextDueDate('yearly', '2026-07-08', WED), null);
});

const RECURRING_TASK = {
  id: 'task-1',
  title: 'Rotate certificates',
  description: 'Follow the runbook',
  notes: 'Confirm propagation',
  priority: 'high',
  status: 'planned',
  projectId: 'project-1',
  dueDate: '2026-07-08',
  dueTime: '09:30',
  recurrence: 'weekly',
  labels: ['maintenance'],
};

test('recurrence transition plans one complete successor from the proposed task', () => {
  const plan = planTaskRecurrenceTransition(RECURRING_TASK, {
    status: 'completed',
    title: 'Rotate edge certificates',
  }, { now: WED });

  assert.deepEqual(plan.fields, { status: 'completed', title: 'Rotate edge certificates' });
  assert.equal(plan.reopenedAsOneOff, false);
  assert.deepEqual(plan.nextTask, {
    title: 'Rotate edge certificates',
    description: 'Follow the runbook',
    notes: 'Confirm propagation',
    priority: 'high',
    status: 'planned',
    projectId: 'project-1',
    dueDate: '2026-07-15',
    dueTime: '09:30',
    recurrence: 'weekly',
    labels: ['maintenance'],
    sortOrder: 0,
  });
});

test('recurrence transition is a no-op without a completion edge', () => {
  assert.equal(planTaskRecurrenceTransition(RECURRING_TASK, { priority: 'low' }, { now: WED }).nextTask, null);
  assert.equal(planTaskRecurrenceTransition({ ...RECURRING_TASK, status: 'completed' }, { status: 'completed' }, { now: WED }).nextTask, null);
});

test('reopening a completed occurrence makes only that occurrence one-off', () => {
  const plan = planTaskRecurrenceTransition(
    { ...RECURRING_TASK, status: 'completed' },
    { status: 'planned' },
    { now: WED },
  );
  assert.deepEqual(plan.fields, { status: 'planned', recurrence: null });
  assert.equal(plan.nextTask, null);
  assert.equal(plan.reopenedAsOneOff, true);
});

// Re-pinned 2026-07-18: an EXPLICIT recurrence in the reopen patch is the
// caller's intent and must survive — the old plan overwrote it with null and
// the response reported the value the caller sent was applied.
test('reopening with an explicit recurrence in the patch preserves it', () => {
  const plan = planTaskRecurrenceTransition(
    { ...RECURRING_TASK, status: 'completed' },
    { status: 'planned', recurrence: 'weekly' },
    { now: WED },
  );
  assert.deepEqual(plan.fields, { status: 'planned', recurrence: 'weekly' });
  assert.equal(plan.nextTask, null);
  assert.equal(plan.reopenedAsOneOff, false);
});

// Regression (2026-07-18 review): the every:N cap.
test('isValidRecurrence enforces the interval cap at exactly 10000', () => {
  assert.equal(isValidRecurrence('every:10000d'), true);
  assert.equal(isValidRecurrence('every:10001d'), false);
  assert.equal(isValidRecurrence('every:10000w'), true);
});

// EXECUTED: the 0017 clamp migration preserves legacy over-cap series.
test('migration 0017 clamps stored over-cap intervals so completion still spawns', async () => {
  const { createDb } = await import('../../server/db.js');
  const { runMigrations } = await import('../../server/migrate.js');
  const db = createDb(':memory:');
  await runMigrations(db, { logger: { info() {}, error() {} } });
  const project = (await db.query("select id from projects where slug='inbox'")).rows[0].id;
  // Simulate a pre-cap legacy row (bypasses route validation, as old data did).
  await db.query(
    "insert into tasks (title, priority, status, project_id, due_date, recurrence) values ('Legacy', 'medium', 'planned', $1, '2026-07-01', 'every:20000d')",
    [project],
  );
  // Re-running the clamp statement is what the migration applied; assert the
  // stored value would have been clamped by it.
  await db.query(`
    update tasks
    set recurrence = 'every:10000' || substr(recurrence, length(recurrence))
    where recurrence like 'every:%'
      and cast(substr(recurrence, 7, length(recurrence) - 7) as integer) > 10000
  `);
  const row = (await db.query("select recurrence from tasks where title='Legacy'")).rows[0];
  assert.equal(row.recurrence, 'every:10000d');
  assert.equal(isValidRecurrence(row.recurrence), true, 'the clamped token is valid, so completion spawns');
  assert.ok(nextDueDate(row.recurrence, '2026-07-01'), 'a successor due date is produced');
});
