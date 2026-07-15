// Prax board view (design-handoff §Screen 2) — four fixed kanban columns with
// drag-position indicators. Pure render module: `buildBoardColumns` derives the
// column model from state + tasks, `renderBoardHtml` turns it into an HTML
// string. Drag & drop is bound in main.js on [data-board-card] /
// [data-board-column]; persistence goes through boardWorkflow.moveTaskOnBoard.
// Tasks keep API field names (status/priority/dueDate/archivedAt) — the
// design↔API translation happens via statusMap/dueFlags at render time.

import { BOARD_COLUMNS, designStatus, isBoardable } from './statusMap.js';
import { chip, escapeHtml, prioDotClass } from './renderHelpers.js';
import { dueFlag } from './dueFlags.js';
import { icon } from './icons.js';
import { TASK_RENDER_BATCH_SIZE } from './renderList.js';

// Column labels + dot tones in design vocabulary (Prax.dc.html colDefs).
const COLUMN_META = {
  priority: { label: 'Priority', tone: 'hi' },
  inprogress: { label: 'In progress', tone: 'accent' },
  planned: { label: 'Planned', tone: 'lo' },
  completed: { label: 'Completed', tone: 'muted' },
};

const TONE_VARS = {
  hi: 'var(--hi)',
  accent: 'var(--accent)',
  lo: 'var(--lo)',
  muted: 'var(--ink3)',
};

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const orderDelta = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (orderDelta !== 0) return orderDelta;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

// Pure column model: membership by designStatus, board order by sortOrder,
// drop-indicator flags derived from the drag state (state.dragPos = the
// { col, beforeId } slot the pointer hovers; beforeId null = end of column).
export function buildBoardColumns(state = {}, tasks = []) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const boardable = safeTasks.filter(task => isBoardable(task));
  const dragPos = state.dragPos || null;

  return BOARD_COLUMNS.map((key) => {
    const meta = COLUMN_META[key];
    const cards = sortCards(boardable.filter(task => designStatus(task.status) === key))
      .map(task => ({
        ...task,
        showInd: !!(dragPos && dragPos.col === key
          && dragPos.beforeId === task.id
          && dragPos.beforeId !== state.dragTaskId),
      }));

    return {
      key,
      label: meta.label,
      tone: meta.tone,
      cards,
      isOver: state.dragOverColumn === key,
      endInd: !!(dragPos && dragPos.col === key && dragPos.beforeId === null),
    };
  });
}

// A board keeps every workflow column present while bounding card mounts. The
// budget is divided evenly so one busy column cannot hide every later column;
// full column counts remain visible in the headers.
export function limitBoardColumns(columns = [], limit = TASK_RENDER_BATCH_SIZE) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.max(0, Math.floor(Number(limit)))
    : TASK_RENDER_BATCH_SIZE;
  const perColumn = safeColumns.length ? Math.ceil(normalizedLimit / safeColumns.length) : 0;
  const visibleColumns = safeColumns.map((column) => ({
    ...column,
    totalCount: Array.isArray(column.cards) ? column.cards.length : 0,
    cards: (Array.isArray(column.cards) ? column.cards : []).slice(0, perColumn),
  }));
  const total = visibleColumns.reduce((sum, column) => sum + column.totalCount, 0);
  const shown = visibleColumns.reduce((sum, column) => sum + column.cards.length, 0);
  return { columns: visibleColumns, total, shown, hasMore: shown < total };
}

// projectsById may be a plain object or a Map keyed by project id.
function lookupProject(projectsById, projectId) {
  if (!projectsById || !projectId) return null;
  if (typeof projectsById.get === 'function') return projectsById.get(projectId) || null;
  return projectsById[projectId] || null;
}

function signalSpan(iconName, text) {
  return `<span style="display:inline-flex; align-items:center; gap:3px;">${icon(iconName, 11)}${escapeHtml(text)}</span>`;
}

function renderCard(state, task, projectsById, now) {
  const isDone = designStatus(task.status) === 'completed';
  const isDragging = task.id === state.dragTaskId;
  const isSelected = task.id === state.selectedTaskId;
  const extras = (state.taskBoardExtras || {})[task.id] || null;

  const chips = [];
  const project = lookupProject(projectsById, task.projectId);
  if (project && project.name) {
    const color = escapeHtml(project.color || 'var(--accent)');
    chips.push(chip(
      project.name,
      'project',
      `style="--project-color:${color};background:color-mix(in oklab, ${color} 13%, transparent)"`,
    ));
  }
  const due = dueFlag(task.dueDate, { dueTime: task.dueTime, done: isDone, now });
  if (due) chips.push(chip(due.label, `due-${due.bucket}`));

  const signals = [];
  if (extras && extras.checklistTotal > 0) {
    signals.push(signalSpan('check', `${extras.checklistDone ?? 0}/${extras.checklistTotal}`));
  }
  if (extras && extras.docsCount > 0) {
    signals.push(signalSpan('doc', `${extras.docsCount}`));
  }

  const metaParts = [...chips];
  if (signals.length) metaParts.push('<span style="flex:1;"></span>', ...signals);
  const meta = metaParts.length
    ? `<div class="board-card__meta">${metaParts.join('')}</div>`
    : '';

  const activity = extras && extras.latestActivity
    ? `<div class="board-card__activity">${escapeHtml(extras.latestActivity)}</div>`
    : '';

  const classes = ['board-card'];
  if (isDone) classes.push('is-done');
  if (isDragging) classes.push('is-dragging');

  return `${task.showInd ? '<div class="drop-ind"></div>' : ''}`
    + `<div class="${classes.join(' ')}" draggable="true" data-board-card="true"`
    + ` data-action="open-task" data-task-id="${escapeHtml(task.id)}"`
    + `${isSelected ? ' aria-current="true"' : ''}>`
    + '<div class="board-card__title">'
    + `<span class="${prioDotClass(task.priority)}"></span>`
    + `<span>${escapeHtml(task.title || 'Untitled task')}</span>`
    + '</div>'
    + meta
    + activity
    + '</div>';
}

function renderColumn(state, column, projectsById, now) {
  const dot = TONE_VARS[column.tone] || TONE_VARS.muted;
  const head = '<div class="board-col__head">'
    + `<span class="board-col__dot" style="--dot: ${dot};"></span>`
    + `<span>${escapeHtml(column.label)}</span>`
    + `<span class="board-col__count">${Number.isInteger(column.totalCount) ? column.totalCount : column.cards.length}</span>`
    + '</div>';

  const cards = column.cards.map(task => renderCard(state, task, projectsById, now)).join('');
  const endInd = column.endInd ? '<div class="drop-ind"></div>' : '';
  const emptySlot = (Number.isInteger(column.totalCount) ? column.totalCount : column.cards.length) === 0
    ? '<div class="empty-slot">Drop cards here</div>'
    : '';

  return `<div class="board-col${column.isOver ? ' is-over' : ''}" data-board-column="${escapeHtml(column.key)}">`
    + head + cards + endInd + emptySlot
    + '</div>';
}

// `now` is injectable (options bag) so due chips are deterministic in tests.
export function renderBoardHtml(state = {}, columns = [], projectsById = null, { now = new Date(), collection = null } = {}) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const cols = safeColumns.map(column => renderColumn(state, column, projectsById, now)).join('');
  const progress = collection?.hasMore
    ? `<div class="collection-progress" role="status"><span>Showing ${collection.shown} of ${collection.total} task cards.</span>`
      + '<button class="btn-ghost" type="button" data-action="show-more-tasks">Show more cards</button></div>'
    : '';
  return `<div class="board-wrap"><div class="board">${cols}</div>${progress}</div>`;
}
