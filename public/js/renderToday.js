import { escapeHtml, chip } from './renderHelpers.js';
import { isOpen } from './statusMap.js';
import { dueFlag, dueBucket } from './dueFlags.js';
import { isoDate } from './dateHelpers.js';
import { logo } from './icons.js';
import { renderTaskCollectionProgressHtml, renderTaskGroupsHtml } from './renderList.js';

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
  const today = isoDate(now);
  const snoozedCount = (tasks || []).filter((task) => isOpen(task) && isSnoozed(task, now)).length;
  const open = (tasks || []).filter((task) => isOpen(task) && !isSnoozed(task, now)).map((task) => {
    const project = projectById.get(task.projectId);
    return {
      ...task,
      done: false,
      dueInfo: dueFlag(task.dueDate, { dueTime: task.dueTime, now }),
      projName: project ? project.name : 'No project',
      projColor: project ? project.color : null,
    };
  });
  // The working set (Today plan): tasks consciously pulled into THIS day.
  // They render as their own leading group; the due buckets below exclude
  // them so nothing appears twice. Completed-today-planned counts feed the
  // honest "planned N · M done" score without rendering rows.
  const planned = open.filter((task) => task.plannedFor === today)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const plannedIds = new Set(planned.map((task) => task.id));
  const plannedDone = (tasks || []).filter((task) => task.plannedFor === today && task.status === 'completed' && !task.archivedAt).length;
  // Planned on an earlier day and still open: the shutdown that never
  // happened. Surfaced as a banner, walked first by the next planning pass.
  const stalePlannedCount = open.filter((task) => task.plannedFor && task.plannedFor < today).length;

  const bucketOf = (task) => dueBucket(task.dueDate, { now });
  const groups = TODAY_GROUPS
    .map(([key, label, tone]) => ({
      key, label, tone,
      tasks: open.filter((task) => bucketOf(task) === key && !plannedIds.has(task.id)),
    }))
    .filter((group) => group.tasks.length);
  if (planned.length) groups.unshift({ key: 'planned', label: 'Planned', tone: 'accent', tasks: planned });
  const badge = open.filter((task) => bucketOf(task) === 'overdue' || bucketOf(task) === 'today' || plannedIds.has(task.id)).length;
  return {
    groups,
    flatIds: groups.flatMap((group) => group.tasks.map((task) => task.id)),
    badge,
    snoozedCount,
    plannedCount: planned.length,
    plannedDone,
    stalePlannedCount,
  };
}

// Project color remains a redundant dot/wash; the text uses the accessible
// design-system foreground because arbitrary project colors are not text-safe.
// Exported so the Filter and Upcoming views render the same cross-project chip.
export function projectChipHtml(task) {
  const color = escapeHtml(task.projColor || 'var(--ink3)');
  return chip(task.projName || 'No project', 'project',
    `style="--project-color:${color};background:color-mix(in oklab, ${color} 13%, transparent)"`);
}

export function renderTodayHtml(state, groups, {
  now = new Date(), snoozedCount = 0, collection = null,
  plannedCount = 0, plannedDone = 0, stalePlannedCount = 0,
} = {}) {
  const dateLabel = new Date(now).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const snoozedNote = snoozedCount > 0
    ? ` <span class="today-snoozed">· ${snoozedCount} snoozed</span>`
    : '';
  // The honest plan score: computed from data, no streaks, no gamification.
  const planNote = (plannedCount + plannedDone) > 0
    ? ` <span class="today-planscore" data-plan-score>· planned ${plannedCount + plannedDone} — ${plannedDone} done</span>`
    : '';
  const shutdownBtn = plannedCount > 0
    ? '<button class="btn-ghost" type="button" data-action="open-shutdown" title="Walk every unfinished planned item: carry, reschedule, or drop">Shut down</button>'
    : '';
  const head = '<header class="page-head"><h1 class="page-head__title">Today</h1>'
    + '<div class="page-head__actions">'
    + '<button class="btn-ghost" type="button" data-action="open-plan-mode" title="Walk overdue / due / inbox / upcoming and pull today\'s working set">Plan today</button>'
    + shutdownBtn
    + '<button class="btn-ghost" type="button" data-action="open-daily-brief" title="Daily brief / on-call handoff">✦ Brief</button></div></header>'
    + `<p class="page-head__sub">${escapeHtml(dateLabel)} — everything due or slipping across your projects.${planNote}${snoozedNote}</p>`
    + (stalePlannedCount > 0
      ? `<div class="today-staleplan" data-stale-plan role="status">${stalePlannedCount} item${stalePlannedCount === 1 ? ' was' : 's were'} planned on an earlier day and never shut down. `
        + '<button class="settings-link" type="button" data-action="open-plan-mode">Review</button></div>'
      : '');
  // Wrap in .page so the heading and rows share the same inset as every other
  // top-level view (All projects, Library, Settings, project List/Board).
  const body = (!groups || !groups.length)
    ? `<div class="empty">${logo(48)}`
      + '<p class="empty__title">All clear</p>'
      + '<p class="empty__sub">Nothing overdue, nothing due today. Enjoy the quiet.</p>'
      + '</div>'
    : renderTaskGroupsHtml(state, groups, { rowExtra: projectChipHtml })
      + renderTaskCollectionProgressHtml(collection);
  return `<div class="page">${head}${body}</div>`;
}
