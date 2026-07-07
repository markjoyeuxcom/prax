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
export function buildTodayGroups(tasks, projects, { now = new Date() } = {}) {
  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const open = (tasks || []).filter((task) => isOpen(task)).map((task) => {
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
  return { groups, flatIds: groups.flatMap((group) => group.tasks.map((task) => task.id)), badge };
}

// Project chip tinted with the project color (13% wash bg / full-color text,
// per the prototype); chip--project only carries the weight in prax.css.
function projectChipHtml(task) {
  const color = escapeHtml(task.projColor || 'var(--ink3)');
  return chip(task.projName || 'No project', 'project',
    `style="background:color-mix(in oklab, ${color} 13%, transparent);color:${color}"`);
}

export function renderTodayHtml(state, groups, { now = new Date() } = {}) {
  const dateLabel = new Date(now).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const head = '<header class="page-head"><h1 class="page-head__title">Today</h1></header>'
    + `<p class="page-head__sub">${escapeHtml(dateLabel)} — everything due or slipping across your projects.</p>`;
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
