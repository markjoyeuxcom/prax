import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTodayGroups, renderTodayHtml, weekLoad, recentAgentDocs, onCallProjects, weeklyReviewStatus, nextMondayIso,
  TODAY_OVERDUE_ALL, OVERDUE_PREVIEW, SLIPPED_DEFERRALS,
} from '../../public/js/renderToday.js';

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
  assert.match(renderTodayHtml(baseState(), groups, { now: NOW }), /^\s*<div class="page today">/);
  assert.match(renderTodayHtml(baseState(), [], { now: NOW }), /^\s*<div class="page today">/);
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
  // Overdue rows live in the triage band now, not under a plain group label.
  assert.match(html, /<section class="triage" data-triage aria-label="Overdue triage">/);
  assert.match(html, /class="chip chip--due-overdue">1 overdue</);
  assert.match(html, /<div class="rows" data-group="overdue">/);
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

// ---------------------------------------------------------------------------
// Year-one Today (spec item 8): triage band, ritual tails, side cards
// ---------------------------------------------------------------------------

test('buildTodayGroups orders overdue oldest first and counts the slipping set', () => {
  const tasks = [
    task({ id: 'recent', dueDate: '2026-07-05', deferralCount: SLIPPED_DEFERRALS }),
    task({ id: 'oldest', dueDate: '2026-06-01', deferralCount: 5 }),
    task({ id: 'mid', dueDate: '2026-06-20', deferralCount: 1 }),
    task({ id: 'now', dueDate: '2026-07-06' }),
  ];
  const built = buildTodayGroups(tasks, PROJECTS, { now: NOW });
  assert.deepEqual(built.groups.find((g) => g.key === 'overdue').tasks.map((t) => t.id), ['oldest', 'mid', 'recent']);
  assert.equal(built.overdueCount, 3);
  assert.equal(built.slippedCount, 2);
  assert.equal(built.dueTodayCount, 1);
});

test('the triage band names the set, offers the three bulk decisions, previews the oldest rows, and grows a decision strip under the selected row', () => {
  const tasks = Array.from({ length: OVERDUE_PREVIEW + 3 }, (_, i) => task({ id: `o${i}`, title: `Slipped ${i}`, dueDate: `2026-06-${String(10 + i).padStart(2, '0')}`, deferralCount: 3 }));
  const built = buildTodayGroups(tasks, PROJECTS, { now: NOW });
  // main.js trims the preview; mirror it here.
  const preview = built.groups.map((g) => (g.key === 'overdue' ? { ...g, tasks: g.tasks.slice(0, OVERDUE_PREVIEW), totalCount: g.tasks.length } : g));
  const html = renderTodayHtml(baseState({ selectedTaskId: 'o1' }), preview, { now: NOW, overdueTotal: built.overdueCount, slippedCount: built.slippedCount });
  assert.match(html, /class="chip chip--due-overdue">8 overdue</);
  assert.match(html, /8 of them have slipped at least twice\. Decide once for the set, or one at a time\./);
  assert.match(html, /data-action="triage-all" data-decision="monday"[^>]*>Reschedule all to Monday</);
  assert.match(html, /data-action="triage-all" data-decision="backlog"[^>]*>Send to backlog</);
  assert.match(html, /class="btn-primary" data-action="open-plan-mode"[^>]*>Review one by one</);
  assert.match(html, /Slipped 0/);
  assert.match(html, /Slipped 4/);
  assert.doesNotMatch(html, /Slipped 5/, 'beyond the preview');
  assert.match(html, /class="triage__more" data-action="toggle-section" data-section-key="today:overdue-all" aria-expanded="false">3 more, oldest first</);
  // The decision strip follows the selected row only.
  assert.match(html, /data-task-id="o1"[\s\S]*?<div class="triage__decide" role="group" aria-label="Decide: Slipped 1">[\s\S]*?data-action="triage-task" data-task-id="o1" data-decision="today">Today<[\s\S]*?data-decision="monday">Monday<[\s\S]*?data-decision="backlog">Backlog</);
  assert.equal((html.match(/triage__decide/g) || []).length, 1);
  // Expanded: every row and a "Show fewer".
  const all = renderTodayHtml(baseState(), built.groups, { now: NOW, overdueTotal: built.overdueCount, overdueExpanded: true });
  assert.match(all, /Slipped 7/);
  assert.match(all, /data-section-key="today:overdue-all" aria-expanded="true">Show fewer</);
  assert.equal(TODAY_OVERDUE_ALL, 'today:overdue-all');
});

test('Planned and Due today carry their ritual tails; the header gains the weekly review with its due chip', () => {
  const tasks = [
    task({ id: 'p', title: 'Planned one', plannedFor: '2026-07-06', sortOrder: 0 }),
    task({ id: 'd', title: 'Due one', dueDate: '2026-07-06' }),
    task({ id: 'd2', title: 'Due two', dueDate: '2026-07-06' }),
  ];
  const built = buildTodayGroups(tasks, PROJECTS, { now: NOW });
  const html = renderTodayHtml(baseState(), built.groups, { now: NOW, plannedCount: 1 });
  assert.match(html, /Planned <span class="group-label__count">1<\/span><button type="button" class="group-label__action" data-action="open-plan-mode">Edit plan</);
  assert.match(html, /Due today <span class="group-label__count">2<\/span><button type="button" class="group-label__action" data-action="plan-add-today"[^>]*>Add all to plan</);
  assert.match(html, /data-action="generate-weekly-review"[^>]*>Weekly review <span class="chip chip--due-today">due</);
  const reviewed = renderTodayHtml(baseState({ documents: [{ id: 'w', title: 'Weekly review — 2026-W27', updatedAt: '2026-07-05T10:00:00.000Z' }] }), built.groups, { now: NOW });
  assert.doesNotMatch(reviewed, /chip--due-today">due/);
});

test('weekLoad counts open tasks per day for seven days starting today', () => {
  const days = weekLoad([
    task({ id: 'a', dueDate: '2026-07-06' }), task({ id: 'b', dueDate: '2026-07-06', status: 'completed' }),
    task({ id: 'c', dueDate: '2026-07-08' }), task({ id: 'd', dueDate: '2026-07-13' }), task({ id: 'e', dueDate: '2026-07-20' }),
  ], { now: NOW });
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.count), [1, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(days.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(days[0].isToday, true);
  assert.equal(days[1].isToday, false);
});

test('recentAgentDocs keeps agent-written documents from the last day, newest first, capped', () => {
  const documents = [
    { id: 'h', title: 'Human', updatedAt: '2026-07-06T08:00:00.000Z' },
    { id: 'old', title: 'Old agent', updatedBy: 'agent', updatedAt: '2026-07-01T08:00:00.000Z' },
    { id: 'a1', title: 'Agent one', updatedBy: 'agent', updatedAt: '2026-07-06T07:00:00.000Z' },
    { id: 'a2', title: 'Agent two', kind: 'synthesized', updatedAt: '2026-07-06T08:30:00.000Z' },
    { id: 'gone', title: 'Archived', updatedBy: 'agent', archivedAt: '2026-07-06T08:00:00.000Z', updatedAt: '2026-07-06T08:00:00.000Z' },
  ];
  assert.deepEqual(recentAgentDocs(documents, { now: NOW }).map((d) => d.id), ['a2', 'a1']);
  assert.deepEqual(recentAgentDocs(documents, { now: NOW, limit: 1 }).map((d) => d.id), ['a2']);
});

test('onCallProjects lists projects carrying on-call or handoff notes, live ones only', () => {
  const projects = [
    { id: 'p1', name: 'Homelab', status: 'active', onCall: 'Mark' },
    { id: 'p2', name: 'Quiet', status: 'active' },
    { id: 'p3', name: 'Done', status: 'completed', onCall: 'Mark' },
    { id: 'p4', name: 'Platform', status: 'on-hold', handoffNotes: 'Window Wed' },
  ];
  assert.deepEqual(onCallProjects(projects).map((p) => p.id), ['p1', 'p4']);
  assert.deepEqual(onCallProjects(projects, { limit: 1 }).map((p) => p.id), ['p1']);
});

test('weeklyReviewStatus is due with no review or one six days old, else reports the age', () => {
  assert.deepEqual(weeklyReviewStatus([], { now: NOW }), { due: true, daysAgo: null });
  assert.deepEqual(weeklyReviewStatus([{ title: 'Weekly review — 2026-W27', updatedAt: '2026-07-05T09:00:00' }], { now: NOW }), { due: false, daysAgo: 1 });
  assert.deepEqual(weeklyReviewStatus([{ title: 'Weekly review — 2026-W26', updatedAt: '2026-06-30T09:00:00' }], { now: NOW }), { due: true, daysAgo: 6 });
  assert.equal(weeklyReviewStatus([{ title: 'Not a review', updatedAt: '2026-07-06T09:00:00' }], { now: NOW }).due, true);
  assert.equal(nextMondayIso(NOW), '2026-07-13', 'a Monday jumps a full week');
});

test('side cards render from loaded state: week strip always, agents and on-call only when there is something', () => {
  const state = baseState({
    tasks: [task({ id: 'a', dueDate: '2026-07-06' }), task({ id: 'b', dueDate: '2026-07-08' })],
    documents: [{ id: 'a1', title: 'Agent memory', updatedBy: 'agent', updatedByAgent: 'claude', updatedAt: '2026-07-06T07:00:00.000Z' }],
    projects: [{ id: 'p1', name: 'Homelab', status: 'active', onCall: 'Mark', handoffNotes: 'Talos window Wed 20:00', color: '#7c9885' }],
  });
  const html = renderTodayHtml(state, [], { now: NOW, queueCount: 3 });
  assert.match(html, /<aside class="today-side" aria-label="Today at a glance">/);
  assert.match(html, /data-week-card>[\s\S]*?This week<span class="today-card__meta">2 due</);
  assert.match(html, /class="week-strip__day is-today" title="Mon: 1 due"><b>1</);
  assert.match(html, /data-today-agents>[\s\S]*?<button type="button" class="settings-link" data-action="open-review-queue">Review queue 3 →</);
  assert.match(html, /class="agent-row" data-action="open-linked-doc" data-document-id="a1"><span class="agent-row__who">claude</);
  assert.match(html, /chip--unverified">UNVERIFIED</);
  assert.match(html, /data-today-oncall>[\s\S]*?On call · Homelab<span class="today-card__meta">Mark</);
  assert.match(html, /Talos window Wed 20:00/);
  assert.match(html, /data-action="nav-project" data-project-id="p1">Open project</);
  const bare = renderTodayHtml(baseState(), [], { now: NOW });
  assert.match(bare, /data-week-card/);
  assert.doesNotMatch(bare, /data-today-agents/);
  assert.doesNotMatch(bare, /data-today-oncall/);
});
