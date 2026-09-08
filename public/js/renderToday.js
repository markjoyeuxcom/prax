import { escapeHtml, chip } from './renderHelpers.js';
import { isOpen } from './statusMap.js';
import { dueFlag, dueBucket } from './dueFlags.js';
import { isoDate, addDays } from './dateHelpers.js';
import { logo } from './icons.js';
import { renderTaskCollectionProgressHtml, renderTaskGroupsHtml } from './renderList.js';

// Today — cross-project Planned / Overdue / Today, then the week ahead as one
// group per calendar day inside a collapsible "Next 7 days" section
// (docs/desktop/design-handoff.md §5). Pure render module: rows reuse the
// list-row markup from renderList.js plus a project chip after the title.
// badge = overdue + today (+ planned) count, consumed by the sidebar Today item;
// the week ahead is informational and never counts toward it.

const DUE_GROUPS = [
  ['overdue', 'Overdue', 'hi'],
  ['today', 'Today', 'med'],
];
// The week ahead covers the WEEK_DAYS calendar days after today. It replaced
// the separate Upcoming view (and Today's 3-day "Due soon" bucket): the same
// dated tasks, one place, grouped by day.
export const WEEK_DAYS = 7;
// collapsedSections key for the week section (public/js/collapsed.js).
export const TODAY_WEEK_SECTION = 'today:week';

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
  const unplanned = open.filter((task) => !plannedIds.has(task.id));
  const groups = DUE_GROUPS
    .map(([key, label, tone]) => ({ key, label, tone, tasks: unplanned.filter((task) => bucketOf(task) === key) }))
    .filter((group) => group.tasks.length);
  if (planned.length) groups.unshift({ key: 'planned', label: 'Planned', tone: 'accent', tasks: planned });
  // The week ahead: tomorrow through +WEEK_DAYS, one group per day that has
  // something due, flagged `week` so the renderer can fold them into one
  // section and the caller can drop them from the collection when collapsed.
  for (let offset = 1; offset <= WEEK_DAYS; offset += 1) {
    const day = addDays(now, offset);
    const dayIso = isoDate(day);
    const tasks = unplanned.filter((task) => task.dueDate === dayIso);
    if (!tasks.length) continue;
    const label = offset === 1 ? 'Tomorrow'
      : day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    groups.push({ key: `day-${dayIso}`, label, tone: 'muted', week: true, tasks });
  }
  const weekCount = groups.filter((group) => group.week).reduce((sum, group) => sum + group.tasks.length, 0);
  const badge = open.filter((task) => bucketOf(task) === 'overdue' || bucketOf(task) === 'today' || plannedIds.has(task.id)).length;
  return {
    groups,
    flatIds: groups.flatMap((group) => group.tasks.map((task) => task.id)),
    badge,
    snoozedCount,
    plannedCount: planned.length,
    plannedDone,
    stalePlannedCount,
    weekCount,
  };
}

// Project color remains a redundant dot/wash; the text uses the accessible
// design-system foreground because arbitrary project colors are not text-safe.
// Exported so the Filter view renders the same cross-project chip.
export function projectChipHtml(task) {
  const color = escapeHtml(task.projColor || 'var(--ink3)');
  return chip(task.projName || 'No project', 'project',
    `style="--project-color:${color};background:color-mix(in oklab, ${color} 13%, transparent)"`);
}

export function renderTodayHtml(state, groups, {
  now = new Date(), snoozedCount = 0, collection = null,
  plannedCount = 0, plannedDone = 0, stalePlannedCount = 0,
  weekCount = 0, weekCollapsed = false,
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
    + `<p class="page-head__sub">${escapeHtml(dateLabel)} — everything due or slipping across your projects, and the week ahead.${planNote}${snoozedNote}</p>`
    + (stalePlannedCount > 0
      ? `<div class="today-staleplan" data-stale-plan role="status">${stalePlannedCount} item${stalePlannedCount === 1 ? ' was' : 's were'} planned on an earlier day and never shut down. `
        + '<button class="settings-link" type="button" data-action="open-plan-mode">Review</button></div>'
      : '');
  // The week ahead folds into one collapsible section below the due groups.
  // Collapsed, only its header and count render; the caller has already
  // dropped the day groups from `groups`, so keyboard navigation and the
  // collection progress never point at hidden rows.
  const dueGroups = (groups || []).filter((group) => !group.week);
  const weekGroups = (groups || []).filter((group) => group.week);
  const weekSection = weekCount > 0
    ? '<section class="today-week" data-today-week>'
      + `<button type="button" class="group-label group-label--toggle" data-action="toggle-section" data-section-key="${TODAY_WEEK_SECTION}" aria-expanded="${!weekCollapsed}">`
      + `<span class="side-section__chevron">${weekCollapsed ? '▸' : '▾'}</span>`
      + `Next ${WEEK_DAYS} days <span class="group-label__count">${weekCount}</span></button>`
      + (weekCollapsed || !weekGroups.length ? '' : `<div class="today-week__days">${renderTaskGroupsHtml(state, weekGroups, { rowExtra: projectChipHtml })}</div>`)
      + '</section>'
    : '';
  // Wrap in .page so the heading and rows share the same inset as every other
  // top-level view (All projects, Library, Settings, project List/Board).
  const body = (!dueGroups.length && weekCount === 0)
    ? `<div class="empty">${logo(48)}`
      + '<p class="empty__title">All clear</p>'
      + `<p class="empty__sub">Nothing overdue, nothing due today or in the next ${WEEK_DAYS} days. Enjoy the quiet.</p>`
      + '</div>'
    : renderTaskGroupsHtml(state, dueGroups, { rowExtra: projectChipHtml })
      + weekSection
      + renderTaskCollectionProgressHtml(collection);
  return `<div class="page">${head}${body}</div>`;
}
