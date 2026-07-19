import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodayGroups, renderTodayHtml } from '../../public/js/renderToday.js';
import { renderPlanModeHtml } from '../../public/js/renderPlanMode.js';
import { parseTaskFilter } from '../../public/js/taskFilter.js';
import { slippageChips } from '../../public/js/slippageFlags.js';
import { isoDate } from '../../public/js/dateHelpers.js';

const NOW = new Date('2026-07-20T09:00:00'); // local Monday morning
const TODAY = isoDate(NOW);
const YESTERDAY = isoDate(new Date('2026-07-19T09:00:00'));

function task(overrides = {}) {
  return {
    id: overrides.id || `t-${Math.abs(JSON.stringify(overrides).length)}-${overrides.title || 'x'}`,
    title: 'Task', status: 'planned', archivedAt: null, deferredUntil: null,
    dueDate: null, dueTime: null, plannedFor: null, carryCount: 0, deferralCount: 0,
    sortOrder: 0, labels: [], projectId: 'p1',
    ...overrides,
  };
}

const PROJECTS = [{ id: 'p1', name: 'Ops', color: null }];

test('buildTodayGroups: planned leads, due buckets exclude planned, counts are honest', () => {
  const tasks = [
    task({ id: 'a', title: 'Planned+due', plannedFor: TODAY, dueDate: TODAY }),
    task({ id: 'b', title: 'Planned undated', plannedFor: TODAY, sortOrder: -1 }),
    task({ id: 'c', title: 'Just due', dueDate: TODAY }),
    task({ id: 'd', title: 'Done planned', plannedFor: TODAY, status: 'completed' }),
    task({ id: 'e', title: 'Stale plan', plannedFor: YESTERDAY }),
    task({ id: 'f', title: 'Snoozed planned', plannedFor: TODAY, deferredUntil: '2099-01-01T00:00:00Z' }),
  ];
  const built = buildTodayGroups(tasks, PROJECTS, { now: NOW });
  const planned = built.groups.find((group) => group.key === 'planned');
  assert.deepEqual(planned.tasks.map((entry) => entry.id), ['b', 'a'], 'sorted by sortOrder, snoozed excluded');
  const todayGroup = built.groups.find((group) => group.key === 'today');
  assert.deepEqual(todayGroup.tasks.map((entry) => entry.id), ['c'], 'planned tasks are not duplicated into due buckets');
  assert.equal(built.plannedCount, 2);
  assert.equal(built.plannedDone, 1, 'completed-today-planned counts toward the score');
  assert.equal(built.stalePlannedCount, 1);
  assert.equal(built.badge >= 3, true, 'planned tasks count in the sidebar badge');
});

test('renderTodayHtml: plan score, Plan/Shutdown affordances, stale-plan banner', () => {
  const built = buildTodayGroups([
    task({ id: 'a', plannedFor: TODAY }),
    task({ id: 'e', plannedFor: YESTERDAY }),
  ], PROJECTS, { now: NOW });
  const html = renderTodayHtml({ preferences: {} }, built.groups, {
    now: NOW, plannedCount: built.plannedCount, plannedDone: built.plannedDone,
    stalePlannedCount: built.stalePlannedCount,
  });
  assert.match(html, /data-action="open-plan-mode"/);
  assert.match(html, /data-action="open-shutdown"/);
  assert.match(html, /data-plan-score[^>]*>· planned 1 — 0 done/);
  assert.match(html, /data-stale-plan[^>]*>1 item was planned on an earlier day and never shut down/);
  // Without a plan the view keeps its exact old shape: no score, no shutdown.
  const bare = renderTodayHtml({ preferences: {} }, [], { now: NOW });
  assert.doesNotMatch(bare, /data-plan-score/);
  assert.doesNotMatch(bare, /data-action="open-shutdown"/);
  assert.match(bare, /data-action="open-plan-mode"/, 'planning is always offered');
});

test('renderPlanModeHtml: plan card, stale actions, shutdown actions, summary end', () => {
  const tasks = [task({ id: 'a', title: 'Walk me', dueDate: TODAY })];
  const plan = renderPlanModeHtml({
    tasks, projects: PROJECTS,
    planMode: { mode: 'plan', queue: [{ id: 'a', bucket: 'today' }], index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0 },
  });
  assert.match(plan, /Plan today/);
  assert.match(plan, /Walk me/);
  assert.match(plan, /data-action="plan-mode-add"/);
  assert.match(plan, /data-plan-time/);
  assert.match(plan, /1 of 1/);

  const stale = renderPlanModeHtml({
    tasks: [task({ id: 'a', plannedFor: YESTERDAY })], projects: PROJECTS,
    planMode: { mode: 'plan', queue: [{ id: 'a', bucket: 'stale' }], index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0 },
  });
  assert.match(stale, /data-action="plan-mode-today"/);
  assert.match(stale, /data-action="plan-mode-drop"/);
  assert.doesNotMatch(stale, /data-plan-time/);

  const shutdown = renderPlanModeHtml({
    tasks, projects: PROJECTS,
    planMode: { mode: 'shutdown', queue: [{ id: 'a', bucket: 'planned' }], index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0, done: 2 },
  });
  assert.match(shutdown, /Shut down today/);
  assert.match(shutdown, /data-action="shutdown-carry"/);
  assert.match(shutdown, /data-action="shutdown-reschedule"/);
  assert.match(shutdown, /data-shutdown-date/);

  const finished = renderPlanModeHtml({
    tasks, projects: PROJECTS,
    planMode: { mode: 'shutdown', queue: [{ id: 'a', bucket: 'planned' }], index: 1, added: 0, carried: 1, dropped: 0, rescheduled: 0, done: 2 },
  });
  assert.match(finished, /Day closed\./);
  assert.match(finished, /2 done today · 1 carried · 0 rescheduled · 0 dropped/);
});

test('planned: filter atom and the carried chip', () => {
  const ctx = { now: NOW, resolveProjectId: () => null };
  assert.equal(parseTaskFilter('planned:today').predicate(task({ plannedFor: TODAY }), ctx), true);
  assert.equal(parseTaskFilter('planned:today').predicate(task({}), ctx), false);
  assert.equal(parseTaskFilter('planned:none').predicate(task({}), ctx), true);
  assert.equal(parseTaskFilter('planned:any').predicate(task({ plannedFor: YESTERDAY }), ctx), true);
  assert.equal(parseTaskFilter(`planned:${YESTERDAY}`).predicate(task({ plannedFor: YESTERDAY }), ctx), true);
  assert.equal(parseTaskFilter('planned:banana').predicate(task({ plannedFor: TODAY }), ctx), false);

  const carried = slippageChips(task({ carryCount: 3, createdAt: NOW.toISOString() }), { now: NOW });
  assert.deepEqual(carried, [{ label: 'carried 3×', variant: 'slip-deferred' }]);
});
