import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySlip } from '../../server/slippage.js';
import { buildApp } from '../../server/index.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const OPEN = { status: 'planned', archivedAt: null, dueDate: '2026-07-21', deferredUntil: null, deferralCount: 0 };

test('classifySlip: the pinned slip semantics, exhaustively', () => {
  const table = [
    // [name, prior, fields, expectedKind]
    ['future snooze is a slip', OPEN, { deferredUntil: '2026-07-25T09:00:00Z' }, 'deferred'],
    ['re-snoozing to a NEW instant is another slip',
      { ...OPEN, deferredUntil: '2026-07-22T09:00:00Z' }, { deferredUntil: '2026-07-29T09:00:00Z' }, 'deferred'],
    ['resending the SAME snooze instant is a no-op, not a slip',
      { ...OPEN, deferredUntil: '2026-07-25T09:00:00.000Z' }, { deferredUntil: '2026-07-25T09:00:00.000Z' }, 'none'],
    ['clearing a snooze is not a slip', { ...OPEN, deferredUntil: '2026-07-25T09:00:00Z' }, { deferredUntil: null }, 'none'],
    ['a snooze into the past (unsnoozing) is not a slip', OPEN, { deferredUntil: '2026-07-01T09:00:00Z' }, 'none'],
    ['moving a due date LATER is a slip', OPEN, { dueDate: '2026-07-28' }, 'rescheduled'],
    ['pulling a due date earlier is not', OPEN, { dueDate: '2026-07-20' }, 'none'],
    ['scheduling an undated task is not', { ...OPEN, dueDate: null }, { dueDate: '2026-08-01' }, 'none'],
    ['clearing a due date is not', OPEN, { dueDate: null }, 'none'],
    ['completing never slips, even with a later date in the same patch',
      OPEN, { status: 'completed', dueDate: '2026-08-01' }, 'none'],
    ['a completed task cannot slip', { ...OPEN, status: 'completed' }, { dueDate: '2026-08-01' }, 'none'],
    ['an archived task cannot slip', { ...OPEN, archivedAt: '2026-07-01T00:00:00Z' }, { dueDate: '2026-08-01' }, 'none'],
    ['no prior (repository without getTask) classifies none', null, { dueDate: '2026-08-01' }, 'none'],
    ['an unrelated patch is none', OPEN, { title: 'Renamed' }, 'none'],
    ['garbage deferredUntil is none', OPEN, { deferredUntil: 'not-a-date' }, 'none'],
  ];
  for (const [name, prior, fields, expected] of table) {
    assert.equal(classifySlip(prior, fields, NOW).kind, expected, name);
  }
  // Messages carry the honest old -> new detail.
  assert.match(classifySlip(OPEN, { dueDate: '2026-07-28' }, NOW).message, /2026-07-21 → 2026-07-28/);
  assert.match(classifySlip(OPEN, { deferredUntil: '2026-07-25T09:00:00Z' }, NOW).message, /Snoozed until 2026-07-25/);
});

// ---- through the production route + repository ----

async function slippageApp() {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  return buildApp({ config });
}

async function createTask(app, payload = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Slippage subject', project: 'inbox', priority: 'medium', status: 'planned', dueDate: '2026-07-21', ...payload },
  });
  assert.equal(response.statusCode, 201);
  return response.json();
}

test('a snooze and a push-later increment deferralCount atomically and chronicle the change', async () => {
  const app = await slippageApp();
  const task = await createTask(app);
  assert.equal(task.deferralCount, 0);

  const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const snoozed = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { deferredUntil: future } });
  assert.equal(snoozed.statusCode, 200);
  assert.equal(snoozed.json().deferralCount, 1);

  const pushed = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { dueDate: '2026-09-01' } });
  assert.equal(pushed.json().deferralCount, 2);

  const activity = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/activity` })).json();
  const kinds = activity.map((event) => event.eventType);
  assert.ok(kinds.includes('deferred'), 'snooze recorded a deferred event');
  assert.ok(kinds.includes('rescheduled'), 'push-later recorded a rescheduled event');
  const rescheduled = activity.find((event) => event.eventType === 'rescheduled');
  assert.match(rescheduled.message, /2026-07-21 → 2026-09-01/);

  // A rejected patch must not increment: invalid dueDate -> 400, count stays.
  const rejected = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { dueDate: 'nope' } });
  assert.equal(rejected.statusCode, 400);
  const after = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })).json();
  assert.equal(after.deferralCount, 2);

  // Completing with a later date in the same patch does not slip.
  const completed = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { status: 'completed', dueDate: '2026-12-01' } });
  assert.equal(completed.json().deferralCount, 2);

  // Clients cannot write the counter directly: unknown field is ignored.
  const forged = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { deferralCount: 99, status: 'planned' } });
  assert.equal(forged.statusCode, 200);
  assert.equal(forged.json().deferralCount, 2, 'client-sent deferralCount is not accepted');

  await app.close();
});

test('deferralCount survives the export -> import round trip', async () => {
  const source = await slippageApp();
  const task = await createTask(source, { title: 'Round-trip slipper' });
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await source.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { deferredUntil: future } });
  const exported = (await source.inject({ method: 'GET', url: '/api/tasks/export' })).json();
  const record = exported.tasks.find((entry) => entry.id === task.id);
  assert.equal(record.deferralCount, 1, 'the export carries the counter');
  await source.close();

  const target = await slippageApp();
  const imported = await target.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'inbox', mode: 'append', tasks: [record] },
  });
  assert.equal(imported.statusCode, 201);
  assert.equal(imported.json().imported, 1);
  const restored = (await target.inject({ method: 'GET', url: '/api/tasks?q=Round-trip slipper' })).json()
    .find((entry) => entry.title === 'Round-trip slipper');
  assert.equal(restored.deferralCount, 1, 'the import restores the counter');
  // A forged negative count is rejected loudly, not clamped silently.
  const forged = await target.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'inbox', mode: 'append', tasks: [{ title: 'Forged', deferralCount: -2 }] },
  });
  assert.equal(forged.statusCode, 400);
  await target.close();
});
