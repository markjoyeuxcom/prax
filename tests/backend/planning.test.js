import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlanChange } from '../../server/planning.js';
import { buildApp } from '../../server/index.js';

const OPEN = { status: 'planned', archivedAt: null, plannedFor: null, carryCount: 0 };

test('classifyPlanChange: pinned plan semantics', () => {
  const table = [
    ['entering the working set is planned', OPEN, { plannedFor: '2026-07-20' }, 'planned'],
    ['rolling a plan LATER is carried', { ...OPEN, plannedFor: '2026-07-20' }, { plannedFor: '2026-07-21' }, 'carried'],
    ['a stale plan pulled forward to today is carried (the day still moved)',
      { ...OPEN, plannedFor: '2026-07-19' }, { plannedFor: '2026-07-20' }, 'carried'],
    ['re-planning EARLIER is planned, not carried', { ...OPEN, plannedFor: '2026-07-25' }, { plannedFor: '2026-07-21' }, 'planned'],
    ['dropping from the plan records nothing', { ...OPEN, plannedFor: '2026-07-20' }, { plannedFor: null }, 'none'],
    ['resending the same plan is a no-op', { ...OPEN, plannedFor: '2026-07-20' }, { plannedFor: '2026-07-20' }, 'none'],
    ['an unrelated patch is none', { ...OPEN, plannedFor: '2026-07-20' }, { title: 'Renamed' }, 'none'],
    ['completed tasks plan nothing', { ...OPEN, status: 'completed' }, { plannedFor: '2026-07-20' }, 'none'],
    ['archived tasks plan nothing', { ...OPEN, archivedAt: '2026-07-01T00:00:00Z' }, { plannedFor: '2026-07-20' }, 'none'],
    ['no prior is none', null, { plannedFor: '2026-07-20' }, 'none'],
  ];
  for (const [name, prior, fields, expected] of table) {
    assert.equal(classifyPlanChange(prior, fields).kind, expected, name);
  }
  assert.match(classifyPlanChange({ ...OPEN, plannedFor: '2026-07-20' }, { plannedFor: '2026-07-21' }).message, /2026-07-20 → 2026-07-21/);
});

async function planningApp() {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  return buildApp({ config });
}

test('plan -> carry -> drop through the production route: events, carry_count, honest payloads', async () => {
  const app = await planningApp();
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Plan subject', project: 'inbox', priority: 'medium', status: 'planned', plannedFor: '2026-07-20' },
  });
  assert.equal(created.statusCode, 201);
  const task = created.json();
  assert.equal(task.plannedFor, '2026-07-20', 'create accepts plannedFor (capture-from-plan)');
  assert.equal(task.carryCount, 0);

  // Carry: shutdown rolls it to tomorrow — carryCount++ and a chronicle event.
  const carried = (await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { plannedFor: '2026-07-21' } })).json();
  assert.equal(carried.carryCount, 1);
  assert.equal(carried.plannedFor, '2026-07-21');

  // Clients cannot forge the carry counter.
  const forged = (await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { carryCount: 50, title: 'Still honest' } })).json();
  assert.equal(forged.carryCount, 1);

  // Drop from plan: plannedFor null, nothing counted, task untouched.
  const dropped = (await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { plannedFor: '' } })).json();
  assert.equal(dropped.plannedFor, null);
  assert.equal(dropped.carryCount, 1);

  const activity = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/activity` })).json();
  const kinds = activity.map((event) => event.eventType);
  assert.ok(kinds.includes('carried'), 'the carry was chronicled');
  assert.equal(kinds.filter((kind) => kind === 'carried').length, 1, 'drop and forgery recorded nothing');

  // Validation: a malformed plannedFor is rejected loudly.
  const bad = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, payload: { plannedFor: 'next tuesday' } });
  assert.equal(bad.statusCode, 400);

  await app.close();
});

test('plannedFor and carryCount survive the export -> import round trip', async () => {
  const source = await planningApp();
  const created = (await app_create(source)).json();
  await source.inject({ method: 'PATCH', url: `/api/tasks/${created.id}`, payload: { plannedFor: '2026-07-22' } });
  const record = (await source.inject({ method: 'GET', url: '/api/tasks/export' })).json()
    .tasks.find((entry) => entry.id === created.id);
  assert.equal(record.plannedFor, '2026-07-22', 'export carries the plan date');
  assert.equal(record.carryCount, 1, 'export carries the carry count');
  await source.close();

  const target = await planningApp();
  const imported = await target.inject({
    method: 'POST', url: '/api/tasks/import',
    payload: { project: 'inbox', mode: 'append', tasks: [record] },
  });
  assert.equal(imported.statusCode, 201);
  const restored = (await target.inject({ method: 'GET', url: '/api/tasks?q=Round-trip planner' })).json()
    .find((entry) => entry.title === 'Round-trip planner');
  assert.equal(restored.plannedFor, '2026-07-22');
  assert.equal(restored.carryCount, 1);
  const forged = await target.inject({
    method: 'POST', url: '/api/tasks/import',
    payload: { project: 'inbox', mode: 'append', tasks: [{ title: 'Forged', carryCount: -1 }] },
  });
  assert.equal(forged.statusCode, 400);
  await target.close();
});

function app_create(app) {
  return app.inject({
    method: 'POST', url: '/api/tasks',
    payload: { title: 'Round-trip planner', project: 'inbox', priority: 'medium', status: 'planned', plannedFor: '2026-07-21' },
  });
}
