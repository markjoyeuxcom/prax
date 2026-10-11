import { escapeHtml } from './html.js';
import { chip, prioDotClass } from './renderHelpers.js';
import { designPriority, designStatus } from './statusMap.js';
import { dueFlag } from './dueFlags.js';
import { slippageChips } from './slippageFlags.js';
import { icon, logo } from './icons.js';
import { isCollapsed } from './collapsed.js';
import { isoDate, nextWeekday } from './dateHelpers.js';

// Project ▸ List tab — grouped task rows.
// Pure render module: state → HTML string, events are
// delegated in main.js via data-action attributes. Tasks keep API field names
// (status 'high-priority', priority 'medium', dueDate, archivedAt); statusMap/
// dueFlags translate for display.

// Group tones map onto the .group-label --group-fg hook in prax.css.
const TONES = {
  hi: { cls: ' group-label--hi', style: ' style="--group-fg:var(--hi-text)"' },
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

export const TASK_RENDER_BATCH_SIZE = 100;

// Done work splits at seven days (year-one shell spec, item 2): "Done this
// week" stays close at hand, "Done earlier" is the pile that wants archiving.
export const DONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// collapsedSections key for a project list group (public/js/collapsed.js).
export function groupSectionKey(projectId, groupKey) {
  return `list:${projectId}:${groupKey}`;
}

// Collapsed state is a toggle away from the group's default: due/priority/
// status groups start open, the done groups start folded. The stored key
// therefore means "the opposite of the default" — flipping it is still one
// toggle-section action, and a stale key for a group that no longer renders
// is inert.
export function isGroupCollapsed(group, collapsedSections, key) {
  return Boolean(group?.defaultCollapsed) !== isCollapsed(collapsedSections, key);
}

// Annotate groups with their section key and collapsed state; a collapsed
// group keeps its count but sheds its tasks, so limitTaskGroups' flatIds and
// the collection progress never point at rows that are not on screen.
export function applyCollapsedGroups(groups, collapsedSections, projectId) {
  return (groups || []).map((group) => {
    const sectionKey = groupSectionKey(projectId, group.key);
    const collapsed = isGroupCollapsed(group, collapsedSections, sectionKey);
    const tasks = Array.isArray(group.tasks) ? group.tasks : [];
    return collapsed
      ? { ...group, sectionKey, collapsed: true, tasks: [], totalCount: tasks.length }
      : { ...group, sectionKey, collapsed: false, tasks };
  });
}

// Keep the initial DOM bounded without lying about collection size. Groups
// retain their full count while only the first `limit` tasks (in the existing
// group order) are mounted. The returned flatIds exactly match the visible DOM
// so keyboard navigation can never select an off-screen, unrendered task.
export function limitTaskGroups(groups, limit = TASK_RENDER_BATCH_SIZE) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.max(0, Math.floor(Number(limit)))
    : TASK_RENDER_BATCH_SIZE;
  const total = safeGroups.reduce((sum, group) => sum + (Array.isArray(group.tasks) ? group.tasks.length : 0), 0);
  let remaining = normalizedLimit;
  const visibleGroups = [];

  for (const group of safeGroups) {
    const tasks = Array.isArray(group.tasks) ? group.tasks : [];
    const visibleTasks = tasks.slice(0, remaining);
    remaining = Math.max(0, remaining - visibleTasks.length);
    // A collapsed group renders as its header alone, so it stays in place
    // even though it mounts no rows.
    if (visibleTasks.length || group.collapsed) {
      visibleGroups.push({
        ...group,
        tasks: visibleTasks,
        totalCount: Number.isInteger(group.totalCount) ? group.totalCount : tasks.length,
      });
    }
  }

  const flatIds = visibleGroups.flatMap((group) => group.tasks.map((task) => task.id));
  return {
    groups: visibleGroups,
    flatIds,
    shown: flatIds.length,
    total,
    hasMore: flatIds.length < total,
  };
}

export function renderTaskCollectionProgressHtml(collection) {
  if (!collection?.hasMore) return '';
  return `<div class="collection-progress" role="status">`
    + `<span>Showing ${escapeHtml(collection.shown)} of ${escapeHtml(collection.total)} tasks.</span>`
    + `<button class="btn-ghost" type="button" data-action="show-more-tasks">Show ${Math.min(TASK_RENDER_BATCH_SIZE, collection.total - collection.shown)} more</button>`
    + '</div>';
}

// Decorate an API task with the derived bits every row needs; API fields are
// kept untouched (same idiom as the prototype's decor()).
function decorate(task, now) {
  const done = designStatus(task.status) === 'completed';
  return { ...task, done, dueInfo: dueFlag(task.dueDate, { dueTime: task.dueTime, done, now }) };
}

// When a completed task was finished. Tasks carry no completion column; the
// weekly review uses the same fallback (completedAt, else updatedAt), and a
// task with neither is treated as recent because there is nothing to age it by.
export function doneWithinWeek(task, now) {
  const stamp = task.completedAt || task.updatedAt;
  if (!stamp) return true;
  const then = new Date(stamp).getTime();
  if (!Number.isFinite(then)) return true;
  return now.getTime() - then < DONE_WEEK_MS;
}

// Pure. Project-scoped API-shaped tasks → { groups, flatIds }. Excludes
// archived + backlog tasks; groups open tasks by state.groupBy and appends the
// done groups last ("Done this week", then "Done earlier"), both folded by
// default and archivable from their header. Empty groups are dropped. flatIds
// is the visible row order for ↑↓ keyboard navigation.
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
  // Overdue in a project list carries the same set-level decision as Today's
  // triage band (spec item 9), scoped to this project.
  const overdue = groups.find((group) => group.key === 'overdue');
  if (overdue && overdue.tasks.length && state.navId) {
    const monday = new Date(`${isoDate(nextWeekday(now, 1))}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
    overdue.tailHtml = `<button type="button" class="group-label__action" data-action="triage-all" data-decision="monday" data-project-id="${escapeHtml(state.navId)}" title="Move every overdue task in this project to ${escapeHtml(monday)}">Reschedule all to ${escapeHtml(monday)}</button>`;
  }
  const recentDone = done.filter((task) => doneWithinWeek(task, now));
  const olderDone = done.filter((task) => !doneWithinWeek(task, now));
  if (recentDone.length) groups.push({ key: 'completed', label: 'Done this week', tone: 'muted', tasks: recentDone, defaultCollapsed: true, archivable: true });
  if (olderDone.length) groups.push({ key: 'completed-earlier', label: 'Done earlier', tone: 'muted', tasks: olderDone, defaultCollapsed: true, archivable: true });
  const kept = groups.filter((group) => group.tasks.length);
  return { groups: kept, flatIds: kept.flatMap((group) => group.tasks.map((task) => task.id)) };
}

// Shared row markup (also used by renderToday.js). Completion and opening are
// sibling buttons: an ARIA button containing the done button is still nested
// interactive content and loses the inner control in some accessibility trees.
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
  // Slippage honesty chips (thresholds live in preferences; [] when off).
  const slipChips = slippageChips(task, { preferences: state.preferences || {} })
    .map((slip) => chip(slip.label, slip.variant)).join('');

  return `<div class="${classes.join(' ')}" data-task-id="${id}">`
    + `<button class="task-check${done ? ' is-done' : ''}" type="button" data-action="toggle-task-done" data-task-id="${id}" aria-label="${done ? 'Mark not done' : 'Mark done'}">${done ? '✓' : ''}</button>`
    + `<button class="task-row__open" type="button" data-action="open-task" data-task-id="${id}"${selected ? ' aria-current="true"' : ''}>`
    + `<span class="${prioDotClass(task.priority)}" aria-hidden="true"></span>`
    + `<span class="task-row__title">${escapeHtml(task.title)}</span>`
    + afterTitle
    + `<span class="task-row__meta">${signals.join('')}${slipChips}${dueChip}</span>`
    + '</button>'
    + `<button class="task-select${multi ? ' is-selected' : ''}" type="button" data-action="toggle-task-selection" data-task-id="${id}" aria-label="${multi ? 'Deselect' : 'Select'} ${escapeHtml(task.title || 'Untitled task')}" aria-pressed="${multi}">${multi ? '✓' : ''}</button>`
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
    const count = Number.isInteger(group.totalCount) ? group.totalCount : group.tasks.length;
    const countHtml = `<span class="group-label__count">${count}</span>`;
    // Plain header (Today reuses this without section keys); with a section
    // key the label is a collapse toggle, and archivable groups (done work)
    // carry an "Archive all" beside it — a sibling, never nested in the toggle.
    if (!group.sectionKey) {
      // `tailHtml` (Today's ritual buttons) rides along after the count.
      return `<div class="group-label${tone.cls}"${tone.style}>${escapeHtml(group.label)} ${countHtml}${group.tailHtml || ''}</div>`
        + `<div class="rows" data-group="${escapeHtml(group.key)}">${rows}</div>`;
    }
    const collapsed = Boolean(group.collapsed);
    const archive = group.archivable && count > 0
      ? `<button type="button" class="group-label__action" data-action="archive-group" data-group-key="${escapeHtml(group.key)}" aria-label="Archive all ${count} in ${escapeHtml(group.label)}">Archive all</button>`
      : '';
    return `<div class="group-label${tone.cls}${collapsed ? ' is-collapsed' : ''}"${tone.style}>`
      + `<button type="button" class="group-label__toggle" data-action="toggle-section" data-section-key="${escapeHtml(group.sectionKey)}" aria-expanded="${!collapsed}">`
      + `<span class="side-section__chevron" aria-hidden="true">${collapsed ? '▸' : '▾'}</span>${escapeHtml(group.label)} ${countHtml}</button>`
      + archive
      + (group.tailHtml || '')
      + '</div>'
      + (collapsed ? '' : `<div class="rows" data-group="${escapeHtml(group.key)}">${rows}</div>`);
  }).join('');
}

export function renderListHtml(state, groups, { collection = null } = {}) {
  if (!groups || !groups.length) {
    return `<div class="empty">${logo(48)}`
      + '<p class="empty__title">Nothing here yet</p>'
      + '<p class="empty__sub">This project is a clean slate. Capture the first task and it will show up in your list and board.</p>'
      + '<button class="btn-primary" type="button" data-action="open-capture">New task</button>'
      + '<p class="empty__hint">or press <span class="kbd">N</span> anywhere</p>'
      + '</div>';
  }
  return renderTaskGroupsHtml(state, groups) + renderTaskCollectionProgressHtml(collection);
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
