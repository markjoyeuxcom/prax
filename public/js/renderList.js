import { escapeHtml, chip, prioDotClass } from './renderHelpers.js';
import { designPriority, designStatus } from './statusMap.js';
import { dueFlag } from './dueFlags.js';
import { icon, logo } from './icons.js';

// Project ▸ List tab — grouped task rows (docs/desktop/design-handoff.md §1).
// Pure render module (phase1-actions.md): state → HTML string, events are
// delegated in main.js via data-action attributes. Tasks keep API field names
// (status 'high-priority', priority 'medium', dueDate, archivedAt); statusMap/
// dueFlags translate for display.

// Group tones map onto the .group-label --group-fg hook in prax.css.
const TONES = {
  hi: { cls: ' group-label--hi', style: ' style="--group-fg:var(--hi)"' },
  med: { cls: ' group-label--med', style: ' style="--group-fg:var(--med)"' },
  muted: { cls: '', style: '' },
};

const DUE_GROUPS = [
  ['overdue', 'Overdue', 'hi'],
  ['today', 'Today', 'med'],
  ['soon', 'Due soon', 'muted'],
  ['later', 'Upcoming', 'muted'],
  ['none', 'No date', 'muted'],
];
const PRIORITY_GROUPS = [
  ['high', 'High', 'hi'],
  ['med', 'Medium', 'med'],
  ['low', 'Low', 'muted'],
];
const STATUS_GROUPS = [
  ['priority', 'Priority', 'hi'],
  ['inprogress', 'In progress', 'med'],
  ['planned', 'Planned', 'muted'],
];

// Decorate an API task with the derived bits every row needs; API fields are
// kept untouched (same idiom as the prototype's decor()).
function decorate(task, now) {
  const done = designStatus(task.status) === 'completed';
  return { ...task, done, dueInfo: dueFlag(task.dueDate, { done, now }) };
}

// Pure. Project-scoped API-shaped tasks → { groups, flatIds }. Excludes
// archived + backlog tasks; groups open tasks by state.groupBy and appends a
// Completed group last. Empty groups are dropped. flatIds is the visible row
// order for ↑↓ keyboard navigation.
export function buildListGroups(state, tasks, { now = new Date() } = {}) {
  const visible = (tasks || [])
    .filter((task) => !task.archivedAt && designStatus(task.status) !== 'backlog')
    .map((task) => decorate(task, now));
  const open = visible.filter((task) => !task.done);
  const done = visible.filter((task) => task.done);

  let defs = DUE_GROUPS;
  let keyOf = (task) => (task.dueInfo ? task.dueInfo.bucket : 'none');
  if (state.groupBy === 'priority') {
    defs = PRIORITY_GROUPS;
    keyOf = (task) => designPriority(task.priority);
  } else if (state.groupBy === 'status') {
    defs = STATUS_GROUPS;
    keyOf = (task) => designStatus(task.status);
  }

  const groups = defs.map(([key, label, tone]) => ({
    key, label, tone, tasks: open.filter((task) => keyOf(task) === key),
  }));
  if (done.length) groups.push({ key: 'completed', label: 'Completed', tone: 'muted', tasks: done });
  const kept = groups.filter((group) => group.tasks.length);
  return { groups: kept, flatIds: kept.flatMap((group) => group.tasks.map((task) => task.id)) };
}

// Shared row markup (also used by renderToday.js). The row is a
// div[role=button] rather than a <button>: it must contain the done-toggle
// button, and button-in-button is invalid HTML that parsers eject.
export function renderTaskRowHtml(state, task, { afterTitle = '' } = {}) {
  const done = !!task.done;
  const selected = state.selectedTaskId === task.id;
  const multi = Array.isArray(state.multiSelectIds) && state.multiSelectIds.includes(task.id);
  const classes = ['task-row'];
  if (done) classes.push('is-done');
  if (selected) classes.push('is-selected');
  if (multi) classes.push('is-multi');

  const id = escapeHtml(task.id);
  const extras = (state.taskBoardExtras || {})[task.id];
  const signals = [];
  if (extras && extras.checklistTotal > 0) {
    signals.push(`<span class="task-row__signal">${icon('check', 12)}${Number(extras.checklistDone) || 0}/${Number(extras.checklistTotal)}</span>`);
  }
  if (extras && extras.docsCount > 0) {
    signals.push(`<span class="task-row__signal">${icon('doc', 12)}${Number(extras.docsCount)}</span>`);
  }
  const dueChip = task.dueInfo ? chip(task.dueInfo.label, `due-${task.dueInfo.bucket}`) : '';

  return `<div class="${classes.join(' ')}" role="button" tabindex="0" data-action="open-task" data-task-id="${id}"${selected ? ' aria-current="true"' : ''}>`
    + `<button class="task-check${done ? ' is-done' : ''}" type="button" data-action="toggle-task-done" data-task-id="${id}" aria-label="${done ? 'Mark not done' : 'Mark done'}">${done ? '✓' : ''}</button>`
    + `<span class="${prioDotClass(task.priority)}"></span>`
    + `<span class="task-row__title">${escapeHtml(task.title)}</span>`
    + afterTitle
    + `<span class="task-row__meta">${signals.join('')}${dueChip}</span>`
    + '</div>';
}

// Group-label headers + .rows containers (shared with renderToday.js).
// rowExtra(task) → HTML injected after the row title (Today's project chip).
export function renderTaskGroupsHtml(state, groups, { rowExtra } = {}) {
  return (groups || []).map((group) => {
    const tone = TONES[group.tone] || TONES.muted;
    const rows = group.tasks
      .map((task) => renderTaskRowHtml(state, task, { afterTitle: rowExtra ? rowExtra(task) : '' }))
      .join('');
    return `<div class="group-label${tone.cls}"${tone.style}>${escapeHtml(group.label)} <span class="group-label__count">${group.tasks.length}</span></div>`
      + `<div class="rows" data-group="${escapeHtml(group.key)}">${rows}</div>`;
  }).join('');
}

export function renderListHtml(state, groups) {
  if (!groups || !groups.length) {
    return `<div class="empty">${logo(48)}`
      + '<p class="empty__title">Nothing here yet</p>'
      + '<p class="empty__sub">This project is a clean slate. Capture the first task and it will show up in your list and board.</p>'
      + '<button class="btn-primary" type="button" data-action="open-capture">New task</button>'
      + '<p class="empty__hint">or press <span class="kbd">N</span> anywhere</p>'
      + '</div>';
  }
  return renderTaskGroupsHtml(state, groups);
}

// Sticky multi-select bulk bar; empty string when there is no multi-selection.
export function renderBulkBarHtml(state) {
  const count = Array.isArray(state.multiSelectIds) ? state.multiSelectIds.length : 0;
  if (!count) return '';
  return '<div class="bulkbar" role="toolbar" aria-label="Bulk actions">'
    + `<span class="bulkbar__count">${count} selected</span>`
    + '<button type="button" data-action="bulk-complete">Complete</button>'
    + '<button type="button" data-action="bulk-backlog">Backlog</button>'
    + '<button type="button" data-action="bulk-archive">Archive</button>'
    + '<button type="button" class="bulkbar__clear" data-action="clear-selection" aria-label="Clear selection">✕</button>'
    + '</div>';
}
