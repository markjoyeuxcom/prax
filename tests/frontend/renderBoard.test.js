import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardColumns, limitBoardColumns, renderBoardHtml } from '../../public/js/renderBoard.js';
import { DONE_WEEK_MS } from '../../public/js/renderList.js';

// Fixed clock for deterministic due chips: Monday 2026-07-06.
const NOW = new Date('2026-07-06T09:30:00');

function baseState(patch = {}) {
  return {
    dragTaskId: null,
    dragOverColumn: null,
    dragPos: null,
    selectedTaskId: null,
    taskBoardExtras: {},
    ...patch,
  };
}

function renderAll(state, tasks, projectsById = null) {
  return renderBoardHtml(state, buildBoardColumns(state, tasks), projectsById, { now: NOW });
}

// ---- buildBoardColumns ----------------------------------------------------

test('buildBoardColumns puts each API status in its design column', () => {
  const tasks = [
    { id: 'hp', title: 'High prio', status: 'high-priority', priority: 'high' },
    { id: 'ip', title: 'Doing', status: 'in-progress', priority: 'medium' },
    { id: 'pl', title: 'Planned', status: 'planned', priority: 'low' },
    { id: 'co', title: 'Done', status: 'completed', priority: 'medium' },
  ];
  const columns = buildBoardColumns(baseState(), tasks);

  assert.deepEqual(columns.map(c => c.key), ['priority', 'inprogress', 'planned', 'completed']);
  assert.deepEqual(columns.map(c => c.cards.map(t => t.id)), [['hp'], ['ip'], ['pl'], ['co']]);
});

test('buildBoardColumns excludes notes-status (backlog) tasks from every column', () => {
  const tasks = [
    { id: 'parked', title: 'Someday', status: 'notes', priority: 'medium' },
    { id: 'active', title: 'Now', status: 'planned', priority: 'medium' },
  ];
  const columns = buildBoardColumns(baseState(), tasks);
  const boardIds = columns.flatMap(c => c.cards.map(t => t.id));

  assert.deepEqual(boardIds, ['active']);
  assert.ok(!boardIds.includes('parked'));
});

test('buildBoardColumns excludes archived tasks even with a boardable status', () => {
  const tasks = [
    { id: 'gone', title: 'Archived', status: 'in-progress', archivedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'live', title: 'Live', status: 'in-progress' },
  ];
  const columns = buildBoardColumns(baseState(), tasks);

  assert.deepEqual(columns.flatMap(c => c.cards.map(t => t.id)), ['live']);
});

test('buildBoardColumns always returns the four design columns in order', () => {
  const columns = buildBoardColumns(baseState(), []);

  assert.equal(columns.length, 4);
  assert.deepEqual(columns.map(c => c.key), ['priority', 'inprogress', 'planned', 'completed']);
  assert.deepEqual(columns.map(c => c.label), ['Priority', 'In progress', 'Planned', 'Done this week']);
  assert.deepEqual(columns.map(c => c.tone), ['hi', 'accent', 'lo', 'muted']);
  assert.deepEqual(columns.map(c => c.cards), [[], [], [], []]);
});

test('buildBoardColumns sorts by sortOrder then falls back to title', () => {
  const tasks = [
    { id: 'b', title: 'Bravo', status: 'planned', sortOrder: 2 },
    { id: 'a', title: 'Alpha', status: 'planned', sortOrder: 1 },
    { id: 'z', title: 'Zulu', status: 'planned' }, // no sortOrder → 0
    { id: 'y', title: 'Yankee', status: 'planned', sortOrder: 0 },
  ];
  const planned = buildBoardColumns(baseState(), tasks).find(c => c.key === 'planned');

  assert.deepEqual(planned.cards.map(t => t.id), ['y', 'z', 'a', 'b']);
});

test('buildBoardColumns raises showInd on the hovered before-card only', () => {
  const state = baseState({
    dragTaskId: 't1',
    dragOverColumn: 'planned',
    dragPos: { col: 'planned', beforeId: 't2' },
  });
  const tasks = [
    { id: 't1', title: 'Dragging', status: 'planned', sortOrder: 0 },
    { id: 't2', title: 'Target', status: 'planned', sortOrder: 1 },
    { id: 't3', title: 'Other column', status: 'in-progress', sortOrder: 0 },
  ];
  const columns = buildBoardColumns(state, tasks);
  const planned = columns.find(c => c.key === 'planned');
  const inprogress = columns.find(c => c.key === 'inprogress');

  assert.equal(planned.cards.find(t => t.id === 't2').showInd, true);
  assert.equal(planned.cards.find(t => t.id === 't1').showInd, false);
  assert.equal(planned.isOver, true);
  assert.equal(planned.endInd, false);
  assert.equal(inprogress.isOver, false);
  assert.equal(inprogress.cards[0].showInd, false);
});

test('buildBoardColumns never shows an indicator before the dragged card itself', () => {
  const state = baseState({
    dragTaskId: 't1',
    dragPos: { col: 'planned', beforeId: 't1' },
  });
  const tasks = [{ id: 't1', title: 'Dragging', status: 'planned' }];
  const planned = buildBoardColumns(state, tasks).find(c => c.key === 'planned');

  assert.equal(planned.cards[0].showInd, false);
});

test('buildBoardColumns flags endInd when hovering the column tail', () => {
  const state = baseState({
    dragTaskId: 't1',
    dragOverColumn: 'completed',
    dragPos: { col: 'completed', beforeId: null },
  });
  const columns = buildBoardColumns(state, [{ id: 't1', title: 'X', status: 'planned' }]);
  const completed = columns.find(c => c.key === 'completed');
  const planned = columns.find(c => c.key === 'planned');

  assert.equal(completed.endInd, true);
  assert.equal(completed.isOver, true);
  assert.equal(planned.endInd, false);
});

test('buildBoardColumns keeps quiet flags when no drag is active', () => {
  const columns = buildBoardColumns(baseState(), [{ id: 'a', title: 'X', status: 'planned' }]);

  for (const column of columns) {
    assert.equal(column.isOver, false);
    assert.equal(column.endInd, false);
    for (const card of column.cards) assert.equal(card.showInd, false);
  }
});

test('limitBoardColumns bounds mounts while preserving every workflow column and full counts', () => {
  const columns = buildBoardColumns(baseState(), [
    ...Array.from({ length: 3 }, (_, index) => ({ id: `p${index}`, title: `Priority ${index}`, status: 'high-priority' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `d${index}`, title: `Doing ${index}`, status: 'in-progress' })),
  ]);
  const collection = limitBoardColumns(columns, 4);

  assert.deepEqual(collection.columns.map((column) => column.key), ['priority', 'inprogress', 'planned', 'completed']);
  assert.deepEqual(collection.columns.map((column) => [column.cards.length, column.totalCount]), [[1, 3], [1, 3], [0, 0], [0, 0]]);
  assert.equal(collection.shown, 2);
  assert.equal(collection.total, 6);
  assert.equal(collection.hasMore, true);
});

// ---- renderBoardHtml ------------------------------------------------------

test('renderBoardHtml renders the board grid with column and card hooks', () => {
  const state = baseState();
  const html = renderAll(state, [
    { id: 'task-1', title: 'Patch ingress', status: 'in-progress', priority: 'medium' },
  ]);

  assert.match(html, /class="board-wrap"/);
  assert.match(html, /class="board"/);
  assert.match(html, /data-board-column="priority"/);
  assert.match(html, /data-board-column="inprogress"/);
  assert.match(html, /data-board-column="planned"/);
  assert.match(html, /data-board-column="completed"/);
  assert.match(html, /draggable="true"/);
  assert.match(html, /data-board-card="true"/);
  assert.match(html, /data-action="open-task"/);
  assert.match(html, /data-task-id="task-1"/);
  assert.match(html, /Patch ingress/);
});

test('renderBoardHtml shows column heads with dot tone, label, and count', () => {
  const html = renderAll(baseState(), [
    { id: 'a', title: 'One', status: 'high-priority', priority: 'high' },
    { id: 'b', title: 'Two', status: 'high-priority', priority: 'medium' },
  ]);

  assert.match(html, /board-col__dot" style="--dot: var\(--hi\);"/);
  assert.match(html, /board-col__dot" style="--dot: var\(--accent\);"/);
  assert.match(html, /board-col__dot" style="--dot: var\(--lo\);"/);
  assert.match(html, /board-col__dot" style="--dot: var\(--ink3\);"/);
  assert.match(html, /<span>Priority<\/span><span class="board-col__count">2<\/span>/);
  assert.match(html, /<span>Planned<\/span><span class="board-col__count">0<\/span>/);
});

test('renderBoardHtml marks the dragged card and the hovered column', () => {
  const state = baseState({ dragTaskId: 'a', dragOverColumn: 'planned' });
  const html = renderAll(state, [{ id: 'a', title: 'X', status: 'planned' }]);

  assert.match(html, /class="board-card is-dragging"/);
  assert.match(html, /class="board-col is-over" data-board-column="planned"/);
  assert.doesNotMatch(html, /class="board-col is-over" data-board-column="priority"/);
});

test('renderBoardHtml renders the drop indicator before the hovered card', () => {
  const state = baseState({ dragTaskId: 'a', dragPos: { col: 'planned', beforeId: 'b' } });
  const html = renderAll(state, [
    { id: 'a', title: 'Alpha', status: 'planned', sortOrder: 0 },
    { id: 'b', title: 'Bravo', status: 'planned', sortOrder: 1 },
  ]);

  assert.match(html, /<div class="drop-ind"><\/div><div class="board-card"[^>]*data-task-id="b"/);
  assert.equal((html.match(/drop-ind/g) || []).length, 1);
});

test('renderBoardHtml renders the end-of-column indicator from endInd', () => {
  const state = baseState({ dragTaskId: 'a', dragPos: { col: 'completed', beforeId: null } });
  const html = renderAll(state, [{ id: 'a', title: 'X', status: 'planned' }]);

  assert.match(html, /data-board-column="completed">[\s\S]*?<div class="drop-ind"><\/div>/);
  assert.equal((html.match(/drop-ind/g) || []).length, 1);
});

test('renderBoardHtml marks the selected card with aria-current', () => {
  const state = baseState({ selectedTaskId: 'a' });
  const html = renderAll(state, [
    { id: 'a', title: 'Picked', status: 'planned' },
    { id: 'b', title: 'Other', status: 'planned' },
  ]);

  assert.match(html, /data-task-id="a" aria-current="true"/);
  assert.doesNotMatch(html, /data-task-id="b" aria-current/);
});

test('renderBoardHtml strikes through completed cards and mutes their due chip', () => {
  const html = renderAll(baseState(), [
    { id: 'a', title: 'Done thing', status: 'completed', priority: 'low', dueDate: '2026-07-01' },
  ]);

  assert.match(html, /class="board-card is-done"/);
  assert.match(html, /chip chip--due-done/);
});

test('renderBoardHtml renders due chips from the shared due buckets', () => {
  const html = renderAll(baseState(), [
    { id: 'o', title: 'Late', status: 'planned', dueDate: '2026-07-04' },
    { id: 't', title: 'Now', status: 'planned', dueDate: '2026-07-06' },
    { id: 's', title: 'Soon', status: 'planned', dueDate: '2026-07-08' },
    { id: 'l', title: 'Later', status: 'planned', dueDate: '2026-07-20' },
    { id: 'n', title: 'No date', status: 'planned' },
  ]);

  assert.match(html, /chip chip--due-overdue">Jul 4 · overdue</);
  assert.match(html, /chip chip--due-today">Today</);
  assert.match(html, /chip chip--due-soon">Jul 8</);
  assert.match(html, /chip chip--due-later">Jul 20</);
  assert.equal((html.match(/chip--due-/g) || []).length, 4);
});

test('renderBoardHtml renders a project-color wash without using an arbitrary color for text', () => {
  const projectsById = { p1: { id: 'p1', name: 'Homelab', color: '#7c9c8e' } };
  const html = renderAll(baseState(), [
    { id: 'a', title: 'X', status: 'planned', projectId: 'p1' },
    { id: 'b', title: 'Orphan', status: 'planned', projectId: 'missing' },
  ], projectsById);

  assert.match(html, /chip chip--project" style="--project-color:#7c9c8e;background:color-mix\(in oklab, #7c9c8e 13%, transparent\)">Homelab</);
  assert.doesNotMatch(html, /color: #7c9c8e/);
  assert.equal((html.match(/chip--project/g) || []).length, 1);
});

test('renderBoardHtml renders checklist, docs, and activity signals from extras', () => {
  const state = baseState({
    taskBoardExtras: {
      a: {
        docsCount: 7,
        checklistDone: 1,
        checklistTotal: 3,
        latestActivity: 'Status changed to in progress',
      },
    },
  });
  const html = renderAll(state, [
    { id: 'a', title: 'Patch ingress', status: 'in-progress' },
    { id: 'b', title: 'No extras', status: 'in-progress' },
  ]);

  assert.match(html, /1\/3</);
  assert.match(html, /<\/svg>7</);
  assert.match(html, /class="board-card__activity">Status changed to in progress</);
  assert.equal((html.match(/board-card__activity/g) || []).length, 1);
});

test('renderBoardHtml escapes task fields everywhere they land', () => {
  const state = baseState({
    selectedTaskId: 'task-"1"',
    taskBoardExtras: { 'task-"1"': { latestActivity: '<img onerror=x>' } },
  });
  const html = renderAll(state, [
    { id: 'task-"1"', title: '<script>alert(1)</script>', status: 'in-progress' },
  ], { p1: { id: 'p1', name: 'safe', color: '#123456' } });

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /data-task-id="task-&quot;1&quot;" aria-current="true"/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

test('renderBoardHtml shows a drop slot in every empty column', () => {
  const html = renderAll(baseState(), [{ id: 'a', title: 'X', status: 'planned' }]);

  assert.equal((html.match(/class="empty-slot">Drop cards here</g) || []).length, 3);
  assert.doesNotMatch(html, /data-board-column="planned">[\s\S]*?Drop cards here[\s\S]*?data-board-column="completed"/);
});

// ---- year one: the Completed column is this week's, and creation is not activity ----

test('buildBoardColumns keeps only this week\'s done work in Completed and counts the older cards', () => {
  const now = new Date('2026-07-06T09:00:00');
  const columns = buildBoardColumns(baseState(), [
    { id: 'fresh', title: 'Fresh', status: 'completed', completedAt: '2026-07-05T10:00:00.000Z' },
    { id: 'edge', title: 'Edge', status: 'completed', updatedAt: new Date(now.getTime() - DONE_WEEK_MS + 60_000).toISOString() },
    { id: 'old', title: 'Old', status: 'completed', updatedAt: '2026-05-01T10:00:00.000Z' },
    { id: 'older', title: 'Older', status: 'completed', completedAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-07-05T10:00:00.000Z' },
    { id: 'unstamped', title: 'Unstamped', status: 'completed' },
    { id: 'open', title: 'Open', status: 'planned' },
  ], { now });
  const completed = columns.find((c) => c.key === 'completed');
  assert.equal(completed.label, 'Done this week');
  assert.deepEqual(completed.cards.map((c) => c.id).sort(), ['edge', 'fresh', 'unstamped']);
  assert.equal(completed.olderCount, 2, 'completedAt wins over a later updatedAt');
  assert.equal(columns.find((c) => c.key === 'planned').olderCount, 0);
  const html = renderBoardHtml(baseState(), columns, null, { now });
  assert.match(html, /class="board-col__older" data-action="set-tab" data-tab="list"[^>]*>2 older, in the list</);
  assert.match(html, /<span>Done this week<\/span><span class="board-col__count">3</);
  assert.equal((html.match(/board-col__older/g) || []).length, 1);
});

test('renderBoardHtml hides the activity line when the only event is creation', () => {
  const state = baseState({
    taskBoardExtras: {
      a: { latestActivity: 'Task created', latestActivityKind: 'created' },
      b: { latestActivity: 'Task created' },
      c: { latestActivity: 'Status → in-progress', latestActivityKind: 'status' },
    },
  });
  const html = renderAll(state, [
    { id: 'a', title: 'Fresh with kind', status: 'planned' },
    { id: 'b', title: 'Fresh without kind', status: 'planned' },
    { id: 'c', title: 'Moved', status: 'in-progress' },
  ]);
  assert.equal((html.match(/board-card__activity/g) || []).length, 1);
  assert.match(html, /class="board-card__activity">Status → in-progress</);
  assert.doesNotMatch(html, /Task created/);
});
