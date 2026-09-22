// "Today" belongs to the person, not the server clock (review 2026-09-22): a
// Compose / Kubernetes install runs on UTC, so at 20:00 in Los Angeles the
// server already says tomorrow — completing a daily task skipped a day and the
// assistant was told the wrong weekday. The browser now sends its local date
// and IANA zone (x-prax-local-date / x-prax-time-zone).
//
// This file plays the UTC server. node --test runs each file in its own
// process, and Node re-reads process.env.TZ on assignment, so the host-zone
// loops below switch zones in-process and restore UTC afterwards.
process.env.TZ = 'UTC';

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const {
  dateInTimeZone, isIsoDate, localToday, requestToday, resolveToday, weekdayOf,
} = await import('../../server/localDay.js');
const { nextDueDate, planTaskRecurrenceTransition } = await import('../../server/recurrence.js');
const { currentDateContext } = await import('../../server/assistant/agent.js');
const { buildWorkspaceSnapshot } = await import('../../server/assistant/snapshot.js');
const { createDb } = await import('../../server/db.js');
const { runMigrations } = await import('../../server/migrate.js');
const { buildApp } = await import('../../server/index.js');

const ZONES = ['America/Los_Angeles', 'Australia/Lord_Howe'];
// 20:00 in Los Angeles on Tue 2026-09-22 = 03:00 UTC on Wed 2026-09-23.
const LA_EVENING = new Date('2026-09-23T03:00:00.000Z');

function inZone(zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { return fn(); } finally { process.env.TZ = previous; }
}

test('the calendar date follows an explicit IANA zone, including half-hour offsets', () => {
  assert.equal(dateInTimeZone(LA_EVENING, 'America/Los_Angeles'), '2026-09-22');
  assert.equal(dateInTimeZone(LA_EVENING, 'UTC'), '2026-09-23');
  // Lord Howe is UTC+10:30 in September: 23:50 on the 22nd, then 00:01 on the 23rd.
  assert.equal(dateInTimeZone(new Date('2026-09-22T13:20:00.000Z'), 'Australia/Lord_Howe'), '2026-09-22');
  assert.equal(dateInTimeZone(new Date('2026-09-22T13:31:00.000Z'), 'Australia/Lord_Howe'), '2026-09-23');
  assert.equal(dateInTimeZone(LA_EVENING, 'Mars/Olympus_Mons'), null);
  assert.equal(dateInTimeZone(LA_EVENING, ''), null);
});

test('resolveToday prefers the client date, then its zone, then the server clock', () => {
  assert.equal(resolveToday({ date: '2026-09-22', timeZone: 'Pacific/Kiritimati' }, LA_EVENING), '2026-09-22');
  assert.equal(resolveToday({ timeZone: 'America/Los_Angeles' }, LA_EVENING), '2026-09-22');
  assert.equal(resolveToday({ date: '2026-02-30', timeZone: 'America/Los_Angeles' }, LA_EVENING), '2026-09-22', 'an impossible date is ignored');
  assert.equal(resolveToday({ date: 'yesterday', timeZone: 'nope' }, LA_EVENING), '2026-09-23', 'server clock (UTC here)');
  assert.equal(resolveToday({}, LA_EVENING), localToday(LA_EVENING));
  assert.equal(requestToday({ headers: { 'x-prax-time-zone': 'America/Los_Angeles' } }, LA_EVENING), '2026-09-22');
  assert.equal(requestToday({ headers: { 'x-prax-local-date': '2026-09-22' } }, LA_EVENING), '2026-09-22');
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(weekdayOf('2026-09-22'), 'Tuesday');
});

test('on a UTC server at 20:00 in Los Angeles, completing a daily task does not skip a day', () => {
  const task = { title: 'Standup notes', status: 'planned', priority: 'medium', projectId: 'p', recurrence: 'daily', dueDate: '2026-09-22' };
  const serverOnly = planTaskRecurrenceTransition(task, { status: 'completed' }, { now: LA_EVENING });
  assert.equal(serverOnly.nextTask.dueDate, '2026-09-24', 'the bug, for callers that send no day');
  const today = requestToday({ headers: { 'x-prax-local-date': '2026-09-22', 'x-prax-time-zone': 'America/Los_Angeles' } }, LA_EVENING);
  const fixed = planTaskRecurrenceTransition(task, { status: 'completed' }, { now: LA_EVENING, today });
  assert.equal(fixed.nextTask.dueDate, '2026-09-23');
});

test('recurrence from a client date is identical under every host zone, across DST changes', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      // Lord Howe moves by 30 minutes on 2026-10-04; Los Angeles by an hour on 2026-11-01.
      assert.equal(nextDueDate('daily', '2026-10-03', '2026-10-03'), '2026-10-04', zone);
      assert.equal(nextDueDate('daily', '2026-10-31', '2026-11-01'), '2026-11-02', zone);
      assert.equal(nextDueDate('weekly', '2026-09-29', '2026-10-05'), '2026-10-06', zone);
      assert.equal(nextDueDate('every:3d', '2026-10-01', '2026-10-04'), '2026-10-07', zone);
      // The anchored monthly series.
      assert.equal(nextDueDate('monthly', '2026-01-31', '2026-02-28'), '2026-03-31', zone);
      assert.equal(nextDueDate('monthly', '2026-01-31', '2026-04-15'), '2026-04-30', zone);
      assert.equal(nextDueDate('monthly', '2026-08-31', '2026-10-04'), '2026-10-31', zone);
      assert.equal(dateInTimeZone(LA_EVENING, 'America/Los_Angeles'), '2026-09-22', zone);
    });
  }
});

test('the assistant is told the requester\'s date and weekday, not the server\'s', () => {
  assert.match(currentDateContext('2026-09-22'), /The current date is Tuesday, 2026-09-22 /);
  for (const zone of ZONES) {
    inZone(zone, () => {
      assert.match(currentDateContext('2026-09-22'), /Tuesday, 2026-09-22/, zone);
      // A Date still reads through local getters (the no-header fallback).
      assert.match(currentDateContext(new Date(2026, 8, 22, 23, 59)), /Tuesday, 2026-09-22/, zone);
    });
  }
});

test('the snapshot counts a snooze by instant: one that ended earlier today is not snoozed', () => {
  const now = new Date('2026-09-22T18:00:00.000Z');
  const tasks = [
    { id: 'a', title: 'Woke up this morning', status: 'planned', deferredUntil: '2026-09-22T09:00:00.000Z' },
    { id: 'b', title: 'Still asleep', status: 'planned', deferredUntil: '2026-09-22T21:00:00.000Z' },
  ];
  const text = buildWorkspaceSnapshot({ tasks, today: '2026-09-22', now });
  assert.match(text, /· 1 snoozed/);
  assert.match(text, /Live workspace snapshot — 2026-09-22/);
});

// ---- through the real routes ---------------------------------------------------

const SILENT = { info() {}, error() {} };

async function makeApp(options = {}) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  return buildApp({ db, ...options });
}

async function createRecurring(app, title, dueDate) {
  const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title, project: 'inbox', priority: 'medium', status: 'planned', dueDate, recurrence: 'daily' } });
  assert.equal(res.statusCode, 201);
  return res.json();
}

async function successorDue(app, title) {
  const tasks = (await app.inject({ method: 'GET', url: '/api/tasks' })).json();
  return tasks.filter((t) => t.title === title && t.status !== 'completed').map((t) => t.dueDate);
}

test('PATCH completion schedules the successor from the x-prax-local-date header', async () => {
  const app = await makeApp();
  // Due long ago: the successor is "tomorrow" — whose tomorrow is the question.
  const task = await createRecurring(app, 'Water plants', '2020-01-01');
  const res = await app.inject({
    method: 'PATCH', url: `/api/tasks/${task.id}`,
    headers: { 'x-prax-local-date': '2020-03-10', 'x-prax-time-zone': 'America/Los_Angeles' },
    payload: { status: 'completed' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(await successorDue(app, 'Water plants'), ['2020-03-11']);
  await app.close();
});

test('board reorder into Completed uses the same header', async () => {
  const app = await makeApp();
  const task = await createRecurring(app, 'Feed cat', '2020-01-01');
  const res = await app.inject({
    method: 'PATCH', url: '/api/tasks/reorder',
    headers: { 'x-prax-local-date': '2020-03-10' },
    payload: { tasks: [{ id: task.id, status: 'completed', sortOrder: 0 }] },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(await successorDue(app, 'Feed cat'), ['2020-03-11']);
  await app.close();
});

test('Inbox "complete" uses the header too, and a retry with another day replays the receipt', async () => {
  const app = await makeApp();
  const task = await createRecurring(app, 'Empty dehumidifier', '2020-01-01');
  const url = `/api/inbox/items/task/${task.id}/actions`;
  const { fingerprint } = (await app.inject({ method: 'GET', url: `/api/inbox/items/task/${task.id}` })).json();
  const input = { operationId: '6a0f3f7e-2c4b-4c1e-9d55-0b6f2f1f7a10', fingerprint, action: 'complete' };
  const first = await app.inject({ method: 'POST', url, headers: { 'x-prax-local-date': '2020-03-10' }, payload: input });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().created[0].record.dueDate, '2020-03-11');
  // The day is not part of the decision's identity: the retry is the same receipt.
  const retry = await app.inject({ method: 'POST', url, headers: { 'x-prax-local-date': '2020-03-11' }, payload: input });
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(retry.json().created[0].id, first.json().created[0].id);
  await app.close();
});

test('an approved assistant completion inherits the requester\'s day, and the prompt carries it', async () => {
  const seen = [];
  let proposed = false;
  let taskId = null;
  const chat = {
    backend: 'fake', model: 'fake', supportsTools: true,
    async complete(messages) {
      seen.push(messages[0]?.role === 'system' ? messages[0].content : '');
      if (!proposed) {
        proposed = true;
        return { text: '', model: 'fake', toolCalls: [{ id: 'w1', name: 'update_task', input: { id: taskId, status: 'completed' } }] };
      }
      return { text: 'Done.', model: 'fake' };
    },
  };
  const app = await makeApp({ chat });
  taskId = (await createRecurring(app, 'Rotate logs', '2020-01-01')).id;
  const headers = { 'x-prax-local-date': '2020-03-10', 'x-prax-time-zone': 'Australia/Lord_Howe' };
  const first = (await app.inject({ method: 'POST', url: '/api/assistant/chat', headers, payload: { messages: [{ role: 'user', content: 'complete it' }] } })).json();
  assert.equal(first.status, 'awaiting_confirmation');
  const second = (await app.inject({ method: 'POST', url: '/api/assistant/chat', headers, payload: { messages: first.messages, decisions: { w1: 'approve' } } })).json();
  assert.equal(second.status, 'done');
  assert.deepEqual(await successorDue(app, 'Rotate logs'), ['2020-03-11']);
  assert.ok(seen.every((system) => /The current date is Tuesday, 2020-03-10 /.test(system)), 'every model call saw the client date');
  await app.close();
});
