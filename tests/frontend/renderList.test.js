import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListGroups, limitTaskGroups, renderListHtml, renderBulkBarHtml,
  applyCollapsedGroups, isGroupCollapsed, groupSectionKey, renderTaskGroupsHtml, DONE_WEEK_MS,
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

test('buildListGroups buckets open tasks by due date with done work last', () => {
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
  assert.deepEqual(groups.map((g) => g.label), ['Overdue', 'Today', 'Due soon', 'Upcoming', 'No date', 'Done this week']);
  assert.equal(groups.at(-1).defaultCollapsed, true);
  assert.equal(groups.at(-1).archivable, true);
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
    [['priority', 'Priority'], ['inprogress', 'In progress'], ['planned', 'Planned'], ['completed', 'Done this week']],
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

// ---------------------------------------------------------------------------
// Year-one shell spec, item 2: done work splits at seven days; groups fold.
// ---------------------------------------------------------------------------

test('buildListGroups splits done work at seven days using completedAt, else updatedAt', () => {
  const tasks = [
    task({ id: 'open' }),
    task({ id: 'fresh', status: 'completed', completedAt: '2026-07-04T10:00:00.000Z' }),
    task({ id: 'edge', status: 'completed', updatedAt: new Date(NOW.getTime() - DONE_WEEK_MS + 60_000).toISOString() }),
    task({ id: 'old', status: 'completed', updatedAt: '2026-06-01T10:00:00.000Z' }),
    task({ id: 'stale', status: 'completed', completedAt: '2026-05-20T10:00:00.000Z', updatedAt: '2026-07-05T10:00:00.000Z' }),
    task({ id: 'unstamped', status: 'completed' }),
  ];
  const { groups, flatIds } = buildListGroups(baseState(), tasks, { now: NOW });
  assert.deepEqual(groups.map((g) => [g.key, g.label]), [['none', 'No date'], ['completed', 'Done this week'], ['completed-earlier', 'Done earlier']]);
  assert.deepEqual(groups[1].tasks.map((t) => t.id), ['fresh', 'edge', 'unstamped']);
  assert.deepEqual(groups[2].tasks.map((t) => t.id), ['old', 'stale'], 'completedAt wins over a later updatedAt');
  assert.deepEqual(flatIds, ['open', 'fresh', 'edge', 'unstamped', 'old', 'stale']);
});

test('isGroupCollapsed treats the stored key as a toggle away from the group default', () => {
  const open = { key: 'overdue' };
  const done = { key: 'completed', defaultCollapsed: true };
  assert.equal(isGroupCollapsed(open, [], 'list:p1:overdue'), false);
  assert.equal(isGroupCollapsed(open, ['list:p1:overdue'], 'list:p1:overdue'), true);
  assert.equal(isGroupCollapsed(done, [], 'list:p1:completed'), true, 'done groups start folded');
  assert.equal(isGroupCollapsed(done, ['list:p1:completed'], 'list:p1:completed'), false);
  assert.equal(groupSectionKey('p1', 'completed'), 'list:p1:completed');
});

test('applyCollapsedGroups + limitTaskGroups keep folded headers but drop their rows from the collection', () => {
  const tasks = [
    task({ id: 'a', dueDate: '2026-07-03' }),
    task({ id: 'b' }),
    task({ id: 'c' }),
    task({ id: 'fin1', status: 'completed' }),
    task({ id: 'fin2', status: 'completed' }),
  ];
  const built = buildListGroups(baseState(), tasks, { now: NOW });
  const folded = applyCollapsedGroups(built.groups, ['list:p1:none'], 'p1');
  assert.deepEqual(folded.map((g) => [g.key, g.collapsed, g.tasks.length, g.totalCount]),
    [['overdue', false, 1, undefined], ['none', true, 0, 2], ['completed', true, 0, 2]]);
  const collection = limitTaskGroups(folded, 100);
  assert.deepEqual(collection.groups.map((g) => [g.key, g.totalCount]), [['overdue', 1], ['none', 2], ['completed', 2]]);
  assert.deepEqual(collection.flatIds, ['a'], 'keyboard navigation never reaches a folded row');
  assert.equal(collection.total, 1);
  assert.equal(collection.hasMore, false);
  // A batch limit still counts only what is expanded: the done group is
  // folded by default, so its two rows are not part of the total.
  const tight = limitTaskGroups(applyCollapsedGroups(built.groups, [], 'p1'), 2);
  assert.deepEqual(tight.flatIds, ['a', 'b']);
  assert.equal(tight.total, 3);
  assert.equal(tight.hasMore, true);
  // Unfold it (stored key flips the default) and the total includes them.
  const unfolded = limitTaskGroups(applyCollapsedGroups(built.groups, ['list:p1:completed'], 'p1'), 100);
  assert.equal(unfolded.total, 5);
  assert.deepEqual(unfolded.flatIds, ['a', 'b', 'c', 'fin1', 'fin2']);
});

test('renderTaskGroupsHtml renders section-keyed groups as toggles, folded ones without rows, done ones with Archive all', () => {
  const state = baseState();
  const built = buildListGroups(state, [
    task({ id: 'a', title: 'Open one', dueDate: '2026-07-03' }),
    task({ id: 'fin', title: 'Shipped', status: 'completed' }),
  ], { now: NOW });
  const html = renderTaskGroupsHtml(state, applyCollapsedGroups(built.groups, [], 'p1'));
  // Expanded due group: toggle open, rows mounted, no archive action.
  assert.match(html, /<button type="button" class="group-label__toggle" data-action="toggle-section" data-section-key="list:p1:overdue" aria-expanded="true">/);
  assert.match(html, /data-group="overdue">[\s\S]*Open one/);
  assert.doesNotMatch(html, /data-section-key="list:p1:overdue"[^>]*>[\s\S]*?archive-group[\s\S]*?data-group="overdue"/);
  // Folded done group: header + count + Archive all, no rows, no task markup.
  assert.match(html, /class="group-label is-collapsed"/);
  assert.match(html, /data-section-key="list:p1:completed" aria-expanded="false">/);
  assert.match(html, /group-label__count">1</);
  assert.match(html, /data-action="archive-group" data-group-key="completed" aria-label="Archive all 1 in Done this week"/);
  assert.doesNotMatch(html, /data-group="completed"/);
  assert.doesNotMatch(html, /Shipped/);
  // Groups without a section key keep the plain header (Today's reuse).
  const plain = renderTaskGroupsHtml(state, built.groups);
  assert.doesNotMatch(plain, /toggle-section/);
  assert.match(plain, /<div class="group-label"[^>]*>Done this week <span class="group-label__count">1<\/span><\/div>/);
});

test('renderTaskGroupsHtml appends a group tailHtml after the count on plain headers', () => {
  const state = baseState();
  const groups = [{ key: 'today', label: 'Due today', tone: 'med', tasks: [task({ id: 'a', title: 'One' })], tailHtml: '<button type="button" data-action="plan-add-today">Add it to plan</button>' }];
  const html = renderTaskGroupsHtml(state, groups);
  assert.match(html, /Due today <span class="group-label__count">1<\/span><button type="button" data-action="plan-add-today">Add it to plan<\/button><\/div>/);
  assert.doesNotMatch(renderTaskGroupsHtml(state, [{ ...groups[0], tailHtml: undefined }]), /plan-add-today/);
});
