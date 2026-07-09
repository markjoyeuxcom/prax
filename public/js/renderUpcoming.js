import { escapeHtml } from './renderHelpers.js';
import { isOpen } from './statusMap.js';
import { dueFlag, dueBucket } from './dueFlags.js';
import { logo } from './icons.js';
import { renderTaskGroupsHtml } from './renderList.js';
import { projectChipHtml, isSnoozed } from './renderToday.js';
import { isoDate, addDays } from './dateHelpers.js';

// Upcoming — a cross-project week ahead, companion to Today. Open, un-snoozed,
// dated tasks: a leading Overdue group, then one group per calendar day for the
// next `days` (including today, Todoist-style). Empty days are dropped; no-date
// and beyond-window tasks are excluded. Pure; rows reuse the list-row markup +
// project chip. badge = tasks due within the window (excludes overdue, which
// Today already surfaces).
export function buildUpcomingGroups(tasks, projects, { now = new Date(), days = 7 } = {}) {
  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const open = (tasks || []).filter((task) => isOpen(task) && !isSnoozed(task, now) && task.dueDate);
  const decorate = (task) => {
    const project = projectById.get(task.projectId);
    return {
      ...task,
      done: false,
      dueInfo: dueFlag(task.dueDate, { dueTime: task.dueTime, now }),
      projName: project ? project.name : 'No project',
      projColor: project ? project.color : null,
    };
  };

  const groups = [];
  const overdue = open.filter((task) => dueBucket(task.dueDate, { now }) === 'overdue').map(decorate);
  if (overdue.length) groups.push({ key: 'overdue', label: 'Overdue', tone: 'hi', tasks: overdue });

  for (let i = 0; i < days; i += 1) {
    const day = addDays(now, i);
    const dayIso = isoDate(day);
    const dayTasks = open.filter((task) => task.dueDate === dayIso).map(decorate);
    if (!dayTasks.length) continue;
    const label = i === 0 ? 'Today'
      : i === 1 ? 'Tomorrow'
        : day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    groups.push({ key: `day-${dayIso}`, label, tone: i === 0 ? 'med' : 'muted', tasks: dayTasks });
  }

  const startIso = isoDate(now);
  const endIso = isoDate(addDays(now, days - 1));
  const badge = open.filter((task) => task.dueDate >= startIso && task.dueDate <= endIso).length;
  return { groups, flatIds: groups.flatMap((g) => g.tasks.map((t) => t.id)), badge };
}

export function renderUpcomingHtml(state, groups, { now = new Date() } = {}) {
  const dateLabel = new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const head = '<header class="page-head"><h1 class="page-head__title">Upcoming</h1></header>'
    + `<p class="page-head__sub">${escapeHtml(dateLabel)} — the next 7 days across your projects.</p>`;
  const body = (!groups || !groups.length)
    ? `<div class="empty">${logo(48)}`
      + '<p class="empty__title">Nothing coming up</p>'
      + '<p class="empty__sub">No dated tasks in the next week. Enjoy the runway.</p>'
      + '</div>'
    : renderTaskGroupsHtml(state, groups, { rowExtra: projectChipHtml });
  return `<div class="page">${head}${body}</div>`;
}
