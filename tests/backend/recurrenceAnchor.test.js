import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';

// Regression (review 2026-09-22, e7052140): a monthly series stores its anchor
// day (tasks.recurrence_anchor_day, migration 0037) so it returns to the 31st
// after a clamped month, and the anchor survives export and import.

const SILENT = { info() {}, error() {} };

async function testApp(t) {
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
  t.after(() => app.close());
  return app;
}

async function call(app, method, url, payload, { status, today } = {}) {
  const response = await app.inject({
    method, url, ...(payload ? { payload } : {}),
    headers: today ? { 'x-prax-local-date': today } : {},
  });
  if (status !== undefined) assert.equal(response.statusCode, status, response.body);
  return response.json();
}

async function createMonthly(app, dueDate, extra = {}) {
  return call(app, 'POST', '/api/tasks', {
    title: 'Pay rent', project: 'inbox', priority: 'medium', status: 'planned',
    dueDate, recurrence: 'monthly', ...extra,
  }, { status: 201 });
}

async function complete(app, task, today) {
  const done = await call(app, 'PATCH', `/api/tasks/${task.id}`, { status: 'completed' }, { status: 200, today });
  assert.ok(done.nextOccurrenceTaskId, 'a successor was created');
  return call(app, 'GET', `/api/tasks/${done.nextOccurrenceTaskId}`, null, { status: 200 });
}

test('a Jan 31 series completed on time goes Feb 28, Mar 31, Apr 30, May 31', async (t) => {
  const app = await testApp(t);
  let task = await createMonthly(app, '2026-01-31');
  assert.equal(task.recurrenceAnchorDay, 31);
  const dates = [];
  for (let i = 0; i < 4; i += 1) {
    task = await complete(app, task, task.dueDate);
    assert.equal(task.recurrenceAnchorDay, 31);
    dates.push(task.dueDate);
  }
  assert.deepEqual(dates, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('a leap-year series lands on Feb 29 and returns to the 31st', async (t) => {
  const app = await testApp(t);
  const feb = await complete(app, await createMonthly(app, '2028-01-31'), '2028-01-31');
  assert.equal(feb.dueDate, '2028-02-29');
  assert.equal((await complete(app, feb, '2028-02-29')).dueDate, '2028-03-31');
});

test('late completion lands on the anchored day', async (t) => {
  const app = await testApp(t);
  const feb = await complete(app, await createMonthly(app, '2026-01-31'), '2026-01-31');
  assert.equal(feb.dueDate, '2026-02-28');
  assert.equal((await complete(app, feb, '2026-04-15')).dueDate, '2026-04-30');
});

test('a board move to Completed carries the anchor too', async (t) => {
  const app = await testApp(t);
  const feb = await complete(app, await createMonthly(app, '2026-01-31'), '2026-01-31');
  const moved = await call(app, 'PATCH', '/api/tasks/reorder', {
    tasks: [{ id: feb.id, status: 'completed', sortOrder: 0 }],
  }, { status: 200, today: '2026-02-28' });
  const tasks = await call(app, 'GET', '/api/tasks?project=inbox', null, { status: 200 });
  const march = tasks.find((task) => task.dueDate === '2026-03-31');
  assert.ok(Array.isArray(moved));
  assert.ok(march, 'the successor returned to the 31st');
  assert.equal(march.recurrenceAnchorDay, 31);
});

test('editing a monthly task\'s due date re-anchors it; other edits keep the anchor', async (t) => {
  const app = await testApp(t);
  const feb = await complete(app, await createMonthly(app, '2026-01-31'), '2026-01-31');
  // A full-form save re-sends the unchanged due date with a new title.
  const renamed = await call(app, 'PATCH', `/api/tasks/${feb.id}`, { title: 'Pay the rent', dueDate: '2026-02-28' }, { status: 200 });
  assert.equal(renamed.recurrenceAnchorDay, 31);
  const moved = await call(app, 'PATCH', `/api/tasks/${feb.id}`, { dueDate: '2026-02-15' }, { status: 200 });
  assert.equal(moved.recurrenceAnchorDay, 15);
  const weekly = await call(app, 'PATCH', `/api/tasks/${feb.id}`, { recurrence: 'weekly' }, { status: 200 });
  assert.equal(weekly.recurrenceAnchorDay, null);
  const monthlyAgain = await call(app, 'PATCH', `/api/tasks/${feb.id}`, { recurrence: 'monthly' }, { status: 200 });
  assert.equal(monthlyAgain.recurrenceAnchorDay, 15);
  const weeklyTask = await call(app, 'POST', '/api/tasks', {
    title: 'Standup notes', project: 'inbox', priority: 'low', status: 'planned', dueDate: '2026-01-31', recurrence: 'weekly',
  }, { status: 201 });
  assert.equal(weeklyTask.recurrenceAnchorDay, null);
});

test('export and import keep the anchor, and the imported series returns to the 31st', async (t) => {
  const app = await testApp(t);
  const feb = await complete(app, await createMonthly(app, '2026-01-31'), '2026-01-31');
  await call(app, 'POST', '/api/projects', { name: 'Home' }, { status: 201 });
  const exported = await call(app, 'GET', '/api/tasks/export?project=inbox', null, { status: 200 });
  const exportedFeb = exported.tasks.find((task) => task.id === feb.id);
  assert.equal(exportedFeb.recurrenceAnchorDay, 31);

  const imported = await call(app, 'POST', '/api/tasks/import', {
    ...exported, project: 'home', mode: 'append',
  }, { status: 201 });
  const copy = imported.tasks.find((task) => task.dueDate === '2026-02-28' && task.status === 'planned');
  assert.equal(copy.recurrenceAnchorDay, 31);
  assert.equal((await complete(app, copy, '2026-02-28')).dueDate, '2026-03-31');

  // Staged imports keep it as well.
  const requestId = randomUUID();
  await call(app, 'POST', '/api/tasks/import-sessions', { requestId, project: 'home', mode: 'append' }, { status: 201 });
  await call(app, 'PUT', `/api/tasks/import-sessions/${requestId}/chunks/0`, { tasks: [exportedFeb] }, { status: 201 });
  const staged = await call(app, 'POST', `/api/tasks/import-sessions/${requestId}/commit`, { chunkCount: 1 }, { status: 201 });
  assert.equal(staged.tasks[0].recurrenceAnchorDay, 31);
});

test('import validates the anchor and drops it from a non-monthly task', async (t) => {
  const app = await testApp(t);
  for (const recurrenceAnchorDay of [0, 32, '31', 1.5]) {
    const response = await app.inject({
      method: 'POST', url: '/api/tasks/import',
      payload: { project: 'inbox', tasks: [{ title: 'Bad anchor', recurrence: 'monthly', dueDate: '2026-02-28', recurrenceAnchorDay }] },
    });
    assert.equal(response.statusCode, 400, String(recurrenceAnchorDay));
    assert.equal(response.json().message, 'recurrenceAnchorDay is invalid');
  }
  const result = await call(app, 'POST', '/api/tasks/import', {
    project: 'inbox', mode: 'append',
    tasks: [
      { title: 'Weekly with a stray anchor', recurrence: 'weekly', dueDate: '2026-02-28', recurrenceAnchorDay: 31 },
      { title: 'Old export without the field', recurrence: 'monthly', dueDate: '2026-02-28' },
    ],
  }, { status: 201 });
  assert.deepEqual(result.tasks.map((task) => task.recurrenceAnchorDay), [null, null],
    'an export without an anchor is not given a guessed one');
});

test('0037 leaves existing monthly tasks unanchored; they anchor on their own day at the next completion', async (t) => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT, through: '0036' });
  const inbox = (await db.query("select id from projects where slug = 'inbox'")).rows[0].id;
  await db.query(
    "insert into tasks (id, title, priority, status, project_id, due_date, recurrence) values ('11111111-1111-4111-8111-111111111111', 'Legacy rent', 'medium', 'planned', $1, '2026-02-28', 'monthly')",
    [inbox],
  );
  await runMigrations(db, { logger: SILENT });
  const row = (await db.query('select recurrence_anchor_day from tasks')).rows[0];
  assert.equal(row.recurrence_anchor_day, null, 'a clamped 28th is not widened to a guessed 31st');
  await assert.rejects(
    db.query('update tasks set recurrence_anchor_day = 32'),
    /CHECK constraint failed/,
  );

  const app = await buildApp({ db, config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
  t.after(() => app.close());
  const next = await complete(app, { id: '11111111-1111-4111-8111-111111111111' }, '2026-02-28');
  assert.equal(next.dueDate, '2026-03-28');
  assert.equal(next.recurrenceAnchorDay, 28);
});
