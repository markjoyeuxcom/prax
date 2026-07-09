import { escapeHtml, chip } from './renderHelpers.js';
import { isOpen } from './statusMap.js';
import { dueFlag, dueBucket } from './dueFlags.js';
import { logo } from './icons.js';
import { renderTaskGroupsHtml } from './renderList.js';

// Today — cross-project Overdue / Today / Due soon
// (docs/desktop/design-handoff.md §5). Pure render module: rows reuse the
// list-row markup from renderList.js plus a project chip after the title.
// badge = overdue + today count, consumed by the sidebar Today item.

const TODAY_GROUPS = [
  ['overdue', 'Overdue', 'hi'],
  ['today', 'Today', 'med'],
  ['soon', 'Due soon', 'muted'],
];

// Pure. API-shaped tasks across ALL projects → { groups, flatIds, badge }.
// Open tasks only (statusMap.isOpen); empty buckets are dropped.
// A task snoozed until a future moment is hidden from Today (it reappears once
// the moment passes). Counted separately so the view can note how many.
export function isSnoozed(task, now = new Date()) {
  return Boolean(task?.deferredUntil) && new Date(task.deferredUntil) > now;
}

export function buildTodayGroups(tasks, projects, { now = new Date() } = {}) {
  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const snoozedCount = (tasks || []).filter((task) => isOpen(task) && isSnoozed(task, now)).length;
  const open = (tasks || []).filter((task) => isOpen(task) && !isSnoozed(task, now)).map((task) => {
    const project = projectById.get(task.projectId);
    return {
      ...task,
      done: false,
      dueInfo: dueFlag(task.dueDate, { now }),
      projName: project ? project.name : 'No project',
      projColor: project ? project.color : null,
    };
  });
  const bucketOf = (task) => dueBucket(task.dueDate, { now });
  const groups = TODAY_GROUPS
    .map(([key, label, tone]) => ({ key, label, tone, tasks: open.filter((task) => bucketOf(task) === key) }))
    .filter((group) => group.tasks.length);
  const badge = open.filter((task) => bucketOf(task) === 'overdue' || bucketOf(task) === 'today').length;
  return { groups, flatIds: groups.flatMap((group) => group.tasks.map((task) => task.id)), badge, snoozedCount };
}

// Project chip tinted with the project color (13% wash bg / full-color text,
// per the prototype); chip--project only carries the weight in prax.css.
// Exported so the Filter and Upcoming views render the same cross-project chip.
export function projectChipHtml(task) {
  const color = escapeHtml(task.projColor || 'var(--ink3)');
  return chip(task.projName || 'No project', 'project',
    `style="background:color-mix(in oklab, ${color} 13%, transparent);color:${color}"`);
}

export function renderTodayHtml(state, groups, { now = new Date(), snoozedCount = 0 } = {}) {
  const dateLabel = new Date(now).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const snoozedNote = snoozedCount > 0
    ? ` <span class="today-snoozed">· ${snoozedCount} snoozed</span>`
    : '';
  const head = '<header class="page-head"><h1 class="page-head__title">Today</h1>'
    + '<div class="page-head__actions"><button class="btn-ghost" type="button" data-action="open-daily-brief" title="Daily brief / on-call handoff">✦ Brief</button></div></header>'
    + `<p class="page-head__sub">${escapeHtml(dateLabel)} — everything due or slipping across your projects.${snoozedNote}</p>`;
  // Wrap in .page so the heading and rows share the same inset as every other
  // top-level view (All projects, Library, Settings, project List/Board).
  const body = (!groups || !groups.length)
    ? `<div class="empty">${logo(48)}`
      + '<p class="empty__title">All clear</p>'
      + '<p class="empty__sub">Nothing overdue, nothing due today. Enjoy the quiet.</p>'
      + '</div>'
    : renderTaskGroupsHtml(state, groups, { rowExtra: projectChipHtml });
  return `<div class="page">${head}${body}</div>`;
}
