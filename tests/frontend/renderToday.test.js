import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodayGroups, renderTodayHtml } from '../../public/js/renderToday.js';

// Fixed clock for deterministic buckets and the date line: Monday, July 6 2026.
const NOW = new Date('2026-07-06T09:00:00');

const PROJECTS = [
  { id: 'p1', name: 'Homelab', color: '#7c9885' },
  { id: 'p2', name: 'Reading & "Notes"', color: 'oklch(0.62 0.11 45)' },
];

function baseState(overrides = {}) {
  return {
    selectedTaskId: null,
    multiSelectIds: [],
    taskBoardExtras: {},
    ...overrides,
  };
}

// API-shaped task; Today spans all projects, so projectId matters here.
function task(overrides = {}) {
  return {
    id: 't1',
    title: 'Task',
    status: 'planned',
    priority: 'medium',
    projectId: 'p1',
    dueDate: null,
    archivedAt: null,
    ...overrides,
  };
}

test('buildTodayGroups buckets open tasks across projects, adds the week ahead by day, and computes the badge', () => {
  const tasks = [
    task({ id: 'over', dueDate: '2026-07-04' }),
    task({ id: 'now', dueDate: '2026-07-06', projectId: 'p2' }),
    task({ id: 'tomorrow', dueDate: '2026-07-07' }),
    task({ id: 'thursday', dueDate: '2026-07-09' }),
    task({ id: 'thursday-too', dueDate: '2026-07-09', projectId: 'p2' }),
    task({ id: 'seventh', dueDate: '2026-07-13' }),   // +7: the last day of the week ahead
    task({ id: 'eighth', dueDate: '2026-07-14' }),    // +8: beyond the window
    task({ id: 'later', dueDate: '2026-08-01' }),
    task({ id: 'nodate' }),
    task({ id: 'fin', status: 'completed', dueDate: '2026-07-06' }),
    task({ id: 'parked', status: 'notes', dueDate: '2026-07-04' }),
    task({ id: 'gone', archivedAt: '2026-07-01T00:00:00.000Z', dueDate: '2026-07-04' }),
  ];
  const { groups, flatIds, badge, weekCount } = buildTodayGroups(tasks, PROJECTS, { now: NOW });
  assert.deepEqual(
    groups.map((g) => [g.key, g.label, g.tone, Boolean(g.week)]),
    [
      ['overdue', 'Overdue', 'hi', false],
      ['today', 'Today', 'med', false],
      ['day-2026-07-07', 'Tomorrow', 'muted', true],
      ['day-2026-07-09', 'Thu, Jul 9', 'muted', true],
      ['day-2026-07-13', 'Mon, Jul 13', 'muted', true],
    ],
  );
  assert.deepEqual(flatIds, ['over', 'now', 'tomorrow', 'thursday', 'thursday-too', 'seventh']);
  assert.equal(badge, 2, 'the badge stays overdue + today; the week ahead is not an alarm');
  assert.equal(weekCount, 4);
  assert.equal(groups[3].tasks[1].projName, 'Reading & "Notes"', 'week rows carry the project chip fields');
});

test('buildTodayGroups drops empty buckets and zeroes the badge when calm', () => {
  const onlyWeek = buildTodayGroups([task({ id: 'a', dueDate: '2026-07-08' })], PROJECTS, { now: NOW });
  assert.deepEqual(onlyWeek.groups.map((g) => g.key), ['day-2026-07-08']);
  assert.equal(onlyWeek.badge, 0);
  assert.equal(onlyWeek.weekCount, 1);

  const empty = buildTodayGroups([task({ id: 'b' })], PROJECTS, { now: NOW });
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(empty.flatIds, []);
  assert.equal(empty.badge, 0);
});

test('renderTodayHtml renders the page head with the formatted date line', () => {
  const { groups } = buildTodayGroups([task({ id: 'a', dueDate: '2026-07-06' })], PROJECTS, { now: NOW });
  const html = renderTodayHtml(baseState(), groups, { now: NOW });
  assert.match(html, /class="page-head__title">Today</);
  assert.match(html, /class="page-head__sub">Monday, July 6 — everything due or slipping across your projects, and the week ahead\.</);
});

test('renderTodayHtml wraps in .page so it aligns with every other top-level view', () => {
  // Both the populated and empty branches must sit inside the standard .page
  // inset — otherwise the Today heading hangs flush-left of the others.
  const { groups } = buildTodayGroups([task({ id: 'a', dueDate: '2026-07-06' })], PROJECTS, { now: NOW });
  assert.match(renderTodayHtml(baseState(), groups, { now: NOW }), /^\s*<div class="page">/);
  assert.match(renderTodayHtml(baseState(), [], { now: NOW }), /^\s*<div class="page">/);
});

test('renderTodayHtml adds a project chip tinted with the project color after the title', () => {
  const { groups } = buildTodayGroups([
    task({ id: 'a', title: 'Patch node', dueDate: '2026-07-04' }),
    task({ id: 'ghost', dueDate: '2026-07-04', projectId: 'nope' }),
  ], PROJECTS, { now: NOW });
  const html = renderTodayHtml(baseState(), groups, { now: NOW });
  assert.match(html, /Patch node<\/span><span class="chip chip--project" style="--project-color:#7c9885;background:color-mix\(in oklab, #7c9885 13%, transparent\)">Homelab</);
  assert.match(html, /class="chip chip--project"[^>]*>No project</);
});

test('renderTodayHtml rows keep the list-row affordances', () => {
  const state = baseState({ selectedTaskId: 'a', multiSelectIds: ['b'] });
  const { groups } = buildTodayGroups([
    task({ id: 'a', dueDate: '2026-07-04' }),
    task({ id: 'b', dueDate: '2026-07-06' }),
  ], PROJECTS, { now: NOW });
  const html = renderTodayHtml(state, groups, { now: NOW });
  assert.match(html, /class="task-row is-selected"[^>]*data-task-id="a"[^>]*>[\s\S]*data-action="open-task" data-task-id="a" aria-current="true"/);
  assert.match(html, /class="task-row is-multi"[^>]*data-task-id="b"/);
  assert.match(html, /data-action="toggle-task-done" data-task-id="a"/);
  assert.match(html, /class="chip chip--due-overdue">Jul 4 · overdue</);
  assert.match(html, /class="group-label group-label--hi"/);
});

test('renderTodayHtml renders the all-clear empty state under the head', () => {
  const html = renderTodayHtml(baseState(), [], { now: NOW });
  assert.match(html, /Monday, July 6/);
  assert.match(html, /class="empty"/);
  assert.match(html, /<svg[^>]*viewBox="0 0 28 28"/);
  assert.match(html, /class="empty__title">All clear</);
  assert.match(html, /Nothing overdue, nothing due today or in the next 7 days\./);
});

test('renderTodayHtml escapes task titles and project names', () => {
  const { groups } = buildTodayGroups([
    task({ id: 'x', title: '<script>alert("x")</script>', dueDate: '2026-07-06', projectId: 'p2' }),
  ], PROJECTS, { now: NOW });
  const html = renderTodayHtml(baseState(), groups, { now: NOW });
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /Reading &amp; &quot;Notes&quot;/);
  assert.doesNotMatch(html, /<script>/);
});

test('buildTodayGroups hides snoozed (future deferral) tasks, counts them, and shows elapsed ones', () => {
  const tasks = [
    task({ id: 'over', dueDate: '2026-07-04' }),
    task({ id: 'snoozed', dueDate: '2026-07-04', deferredUntil: '2026-07-08T09:00:00Z' }),
    task({ id: 'woke', dueDate: '2026-07-04', deferredUntil: '2026-07-05T09:00:00Z' }),
  ];
  const { flatIds, snoozedCount } = buildTodayGroups(tasks, PROJECTS, { now: NOW });
  assert.ok(flatIds.includes('over'));
  assert.ok(!flatIds.includes('snoozed'), 'a task deferred into the future is hidden from Today');
  assert.ok(flatIds.includes('woke'), 'an elapsed snooze reappears');
  assert.equal(snoozedCount, 1);
});

test('renderTodayHtml notes the snoozed count in the subheading', () => {
  const html = renderTodayHtml(baseState(), [], { now: NOW, snoozedCount: 3 });
  assert.match(html, /3 snoozed/);
  const none = renderTodayHtml(baseState(), [], { now: NOW, snoozedCount: 0 });
  assert.doesNotMatch(none, /snoozed/);
});

test('renderTodayHtml: the week ahead is a collapsible "Next 7 days" section with a count', () => {
  const tasks = [
    task({ id: 'now', dueDate: '2026-07-06' }),
    task({ id: 'tomorrow', title: 'Rotate certs', dueDate: '2026-07-07' }),
    task({ id: 'thursday', title: 'Patch hosts', dueDate: '2026-07-09' }),
  ];
  const built = buildTodayGroups(tasks, PROJECTS, { now: NOW });
  const open = renderTodayHtml(baseState(), built.groups, { now: NOW, weekCount: built.weekCount, weekCollapsed: false });
  assert.match(open, /data-action="toggle-section" data-section-key="today:week" aria-expanded="true"/);
  assert.match(open, /Next 7 days <span class="group-label__count">2<\/span>/);
  assert.match(open, /data-group="day-2026-07-07"/);
  assert.match(open, /Rotate certs/);
  assert.match(open, /Patch hosts/);
  assert.ok(open.indexOf('data-group="today"') < open.indexOf('data-today-week'), 'the week ahead sits below Overdue and Today');

  // Collapsed: the header and count stay, the rows go (the caller also drops them from the collection).
  const collapsed = renderTodayHtml(baseState(), built.groups.filter((g) => !g.week), { now: NOW, weekCount: built.weekCount, weekCollapsed: true });
  assert.match(collapsed, /data-section-key="today:week" aria-expanded="false"/);
  assert.match(collapsed, /Next 7 days <span class="group-label__count">2<\/span>/);
  assert.doesNotMatch(collapsed, /Rotate certs/);

  // Only the week ahead: no false "All clear".
  const weekOnly = buildTodayGroups([task({ id: 'tomorrow', title: 'Rotate certs', dueDate: '2026-07-07' })], PROJECTS, { now: NOW });
  const html = renderTodayHtml(baseState(), weekOnly.groups, { now: NOW, weekCount: weekOnly.weekCount });
  assert.doesNotMatch(html, /All clear/);
  assert.match(html, /Rotate certs/);

  // Nothing at all: the empty state names the whole horizon.
  const empty = renderTodayHtml(baseState(), [], { now: NOW, weekCount: 0 });
  assert.match(empty, /All clear/);
  assert.match(empty, /next 7 days/);
  assert.doesNotMatch(empty, /data-today-week/);
});
