import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListGroups, limitTaskGroups, renderListHtml, renderBulkBarHtml,
} from '../../public/js/renderList.js';

// Fixed clock for deterministic due buckets: Monday, July 6 2026.
const NOW = new Date('2026-07-06T09:00:00');

function baseState(overrides = {}) {
  return {
    groupBy: 'due',
    selectedTaskId: null,
    multiSelectIds: [],
    taskBoardExtras: {},
    ...overrides,
  };
}

// API-shaped task (status/priority/dueDate/archivedAt keep API vocabulary).
function task(overrides = {}) {
  return {
    id: 't1',
    title: 'Task',
    status: 'planned',
    priority: 'medium',
    dueDate: null,
    archivedAt: null,
    ...overrides,
  };
}

test('buildListGroups buckets open tasks by due date with Completed last', () => {
  const tasks = [
    task({ id: 'later', dueDate: '2026-07-20' }),
    task({ id: 'over', dueDate: '2026-07-03' }),
    task({ id: 'now', dueDate: '2026-07-06' }),
    task({ id: 'soon', dueDate: '2026-07-08' }),
    task({ id: 'nodate' }),
    task({ id: 'fin', status: 'completed', dueDate: '2026-07-01' }),
  ];
  const { groups, flatIds } = buildListGroups(baseState(), tasks, { now: NOW });
  assert.deepEqual(groups.map((g) => g.key), ['overdue', 'today', 'soon', 'later', 'none', 'completed']);
  assert.deepEqual(groups.map((g) => g.label), ['Overdue', 'Today', 'Due soon', 'Upcoming', 'No date', 'Completed']);
  assert.deepEqual(groups.map((g) => g.tone), ['hi', 'med', 'muted', 'muted', 'muted', 'muted']);
  assert.deepEqual(flatIds, ['over', 'now', 'soon', 'later', 'nodate', 'fin']);
});

test('buildListGroups excludes archived and backlog (notes) tasks', () => {
  const tasks = [
    task({ id: 'keep', dueDate: '2026-07-06' }),
    task({ id: 'parked', status: 'notes', dueDate: '2026-07-06' }),
    task({ id: 'gone', archivedAt: '2026-07-01T00:00:00.000Z', dueDate: '2026-07-06' }),
    task({ id: 'goneDone', status: 'completed', archivedAt: '2026-07-01T00:00:00.000Z' }),
  ];
  const { groups, flatIds } = buildListGroups(baseState(), tasks, { now: NOW });
  assert.deepEqual(flatIds, ['keep']);
  assert.deepEqual(groups.map((g) => g.key), ['today']);
});

test('buildListGroups drops empty groups', () => {
  const { groups } = buildListGroups(baseState(), [task({ id: 'a', dueDate: '2026-07-06' })], { now: NOW });
  assert.deepEqual(groups.map((g) => g.key), ['today']);
});

test('limitTaskGroups bounds the DOM across groups while preserving full counts and visible keyboard order', () => {
  const collection = limitTaskGroups([
    { key: 'first', label: 'First', tasks: [task({ id: 'a' }), task({ id: 'b' })] },
    { key: 'second', label: 'Second', tasks: [task({ id: 'c' }), task({ id: 'd' })] },
  ], 3);

  assert.deepEqual(collection.flatIds, ['a', 'b', 'c']);
  assert.equal(collection.shown, 3);
  assert.equal(collection.total, 4);
  assert.equal(collection.hasMore, true);
  assert.deepEqual(collection.groups.map((group) => [group.key, group.tasks.length, group.totalCount]), [
    ['first', 2, 2],
    ['second', 1, 2],
  ]);
});

test('renderListHtml announces bounded task rendering and keeps the full group count', () => {
  const collection = limitTaskGroups([
    { key: 'open', label: 'Open', tasks: [task({ id: 'a' }), task({ id: 'b' })] },
  ], 1);
  const html = renderListHtml(baseState(), collection.groups, { collection });

  assert.match(html, /Open <span class="group-label__count">2<\/span>/);
  assert.match(html, /Showing 1 of 2 tasks/);
  assert.match(html, /data-action="show-more-tasks"[^>]*>Show 1 more/);
  assert.doesNotMatch(html, /data-task-id="b"/);
});

test('buildListGroups groups by design priority when groupBy=priority', () => {
  const tasks = [
    task({ id: 'lo', priority: 'low' }),
    task({ id: 'hi', priority: 'high' }),
    task({ id: 'md', priority: 'medium' }),
  ];
  const { groups, flatIds } = buildListGroups(baseState({ groupBy: 'priority' }), tasks, { now: NOW });
  assert.deepEqual(
    groups.map((g) => [g.key, g.label, g.tone]),
    [['high', 'High', 'hi'], ['med', 'Medium', 'med'], ['low', 'Low', 'muted']],
  );
  assert.deepEqual(flatIds, ['hi', 'md', 'lo']);
});

test('buildListGroups groups by design status when groupBy=status', () => {
  const tasks = [
    task({ id: 'p', status: 'planned' }),
    task({ id: 'urgent', status: 'high-priority' }),
    task({ id: 'wip', status: 'in-progress' }),
    task({ id: 'fin', status: 'completed' }),
  ];
  const { groups, flatIds } = buildListGroups(baseState({ groupBy: 'status' }), tasks, { now: NOW });
  assert.deepEqual(
    groups.map((g) => [g.key, g.label]),
    [['priority', 'Priority'], ['inprogress', 'In progress'], ['planned', 'Planned'], ['completed', 'Completed']],
  );
  assert.deepEqual(flatIds, ['urgent', 'wip', 'p', 'fin']);
});

test('renderListHtml renders toned group headers with counts and due chips', () => {
  const state = baseState();
  const { groups } = buildListGroups(state, [
    task({ id: 'over', title: 'Slipping', dueDate: '2026-07-03', priority: 'high' }),
    task({ id: 'now', title: 'Due now', dueDate: '2026-07-06' }),
  ], { now: NOW });
  const html = renderListHtml(state, groups);
  assert.match(html, /class="group-label group-label--hi" style="--group-fg:var\(--hi\)">Overdue <span class="group-label__count">1<\/span>/);
  assert.match(html, /class="group-label group-label--med" style="--group-fg:var\(--med\)">Today <span class="group-label__count">1<\/span>/);
  assert.match(html, /class="rows" data-group="overdue"/);
  assert.match(html, /data-action="open-task" data-task-id="over"/);
  assert.match(html, /prio-dot prio-dot--high/);
  assert.match(html, /class="chip chip--due-overdue">Jul 3 · overdue</);
  assert.match(html, /class="chip chip--due-today">Today</);
});

test('renderListHtml marks the keyboard selection and multi-selection', () => {
  const state = baseState({ selectedTaskId: 'a', multiSelectIds: ['b'] });
  const { groups } = buildListGroups(state, [task({ id: 'a' }), task({ id: 'b' })], { now: NOW });
  const html = renderListHtml(state, groups);
  assert.match(html, /class="task-row is-selected"[^>]*data-task-id="a"[^>]*>[\s\S]*data-action="open-task" data-task-id="a" aria-current="true"/);
  assert.match(html, /class="task-row is-multi"[^>]*data-task-id="b"/);
  assert.doesNotMatch(html, /data-action="open-task" data-task-id="b"[^>]*aria-current/);
});

test('renderListHtml exposes an explicit pressed-state selection control for every task', () => {
  const state = baseState({ multiSelectIds: ['b'] });
  const { groups } = buildListGroups(state, [
    task({ id: 'a', title: 'Alpha task' }),
    task({ id: 'b', title: 'Beta task' }),
  ], { now: NOW });
  const html = renderListHtml(state, groups);

  assert.match(html, /class="task-select"[^>]*data-action="toggle-task-selection"[^>]*data-task-id="a"[^>]*aria-label="Select Alpha task"[^>]*aria-pressed="false"/);
  assert.match(html, /class="task-select is-selected"[^>]*data-action="toggle-task-selection"[^>]*data-task-id="b"[^>]*aria-label="Deselect Beta task"[^>]*aria-pressed="true"/);
});

test('renderListHtml styles completed rows as done with a filled check', () => {
  const state = baseState();
  const { groups } = buildListGroups(state, [
    task({ id: 'fin', title: 'Shipped', status: 'completed', dueDate: '2026-07-05' }),
  ], { now: NOW });
  const html = renderListHtml(state, groups);
  assert.match(html, /class="task-row is-done"/);
  assert.match(html, /class="task-check is-done"[^>]*data-action="toggle-task-done"[^>]*data-task-id="fin"[^>]*>✓</);
  assert.match(html, /chip--due-done/);
});

test('renderListHtml shows checklist and doc signals from board extras', () => {
  const state = baseState({
    taskBoardExtras: { a: { checklistDone: 2, checklistTotal: 4, docsCount: 3 } },
  });
  const { groups } = buildListGroups(state, [task({ id: 'a' }), task({ id: 'b' })], { now: NOW });
  const html = renderListHtml(state, groups);
  assert.match(html, /<span class="task-row__signal"><svg width="12"[\s\S]*?<\/svg>2\/4<\/span>/);
  assert.match(html, /<span class="task-row__signal"><svg width="12"[\s\S]*?<\/svg>3<\/span>/);
  assert.equal((html.match(/task-row__signal/g) || []).length, 2);
});

test('renderListHtml escapes task titles and ids', () => {
  const state = baseState();
  const { groups } = buildListGroups(state, [
    task({ id: 't"1', title: '<script>alert("x")</script>' }),
  ], { now: NOW });
  const html = renderListHtml(state, groups);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /data-task-id="t&quot;1"/);
  assert.doesNotMatch(html, /<script>/);
});

test('renderListHtml renders the empty state with capture affordances', () => {
  const html = renderListHtml(baseState(), []);
  assert.match(html, /class="empty"/);
  assert.match(html, /<svg[^>]*viewBox="0 0 28 28"/);
  assert.match(html, /class="empty__title">Nothing here yet</);
  assert.match(html, /class="btn-primary"[^>]*data-action="open-capture"[^>]*>New task</);
  assert.match(html, /or press <span class="kbd">N<\/span> anywhere/);
});

test('renderBulkBarHtml is empty without a multi-selection', () => {
  assert.equal(renderBulkBarHtml(baseState()), '');
  assert.equal(renderBulkBarHtml(baseState({ multiSelectIds: [] })), '');
});

test('renderBulkBarHtml renders the count and bulk actions', () => {
  const html = renderBulkBarHtml(baseState({ multiSelectIds: ['a', 'b', 'c'] }));
  assert.match(html, /class="bulkbar"/);
  assert.match(html, /3 selected/);
  assert.match(html, /data-action="bulk-complete"[^>]*>Complete</);
  assert.match(html, /data-action="bulk-backlog"[^>]*>Backlog</);
  assert.match(html, /data-action="bulk-archive"[^>]*>Archive</);
  assert.match(html, /class="bulkbar__clear" data-action="clear-selection"[^>]*>✕</);
});
