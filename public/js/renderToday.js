import { escapeHtml, chip } from './renderHelpers.js';
import { isOpen } from './statusMap.js';
import { dueFlag, dueBucket } from './dueFlags.js';
import { isoDate, addDays, nextWeekday } from './dateHelpers.js';
import { logo, icon } from './icons.js';
import { renderTaskCollectionProgressHtml, renderTaskGroupsHtml, renderTaskRowHtml } from './renderList.js';
import { TRUST_PREDICATES } from './libraryFilters.js';

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
// Year-one Today (spec item 8): overdue work is a SET to decide on, not a
// list to scroll. The triage band previews the oldest OVERDUE_PREVIEW rows;
// the stored key means "show them all" (the opposite of the default).
export const TODAY_OVERDUE_ALL = 'today:overdue-all';
export const OVERDUE_PREVIEW = 5;
// A task that has been deferred this many times is "slipping": the count the
// band names so the set is decided on once.
export const SLIPPED_DEFERRALS = 2;

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
  // Overdue reads oldest first: the longest-slipping task is the one to
  // decide on first, and the band's preview shows the top of this order.
  const overdueGroup = groups.find((group) => group.key === 'overdue');
  if (overdueGroup) overdueGroup.tasks.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const overdueCount = overdueGroup ? overdueGroup.tasks.length : 0;
  const slippedCount = overdueGroup ? overdueGroup.tasks.filter((task) => (Number(task.deferralCount) || 0) >= SLIPPED_DEFERRALS).length : 0;
  const dueTodayCount = groups.find((group) => group.key === 'today')?.tasks.length || 0;
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
    overdueCount,
    slippedCount,
    dueTodayCount,
  };
}

// ---------------------------------------------------------------------------
// Side cards (pure derivations over already-loaded state)
// ---------------------------------------------------------------------------

// Open tasks due on each of the next seven days, today first, for the week
// strip. Planned tasks count on their due day like any other.
export function weekLoad(tasks, { now = new Date() } = {}) {
  const open = (tasks || []).filter((task) => isOpen(task));
  const today = isoDate(now);
  return Array.from({ length: WEEK_DAYS }, (_, offset) => {
    const day = addDays(now, offset);
    const iso = isoDate(day);
    return {
      iso,
      label: day.toLocaleDateString('en-US', { weekday: 'short' }),
      count: open.filter((task) => task.dueDate === iso).length,
      isToday: iso === today,
    };
  });
}

// Agent-written documents touched in the last `hours`, newest first, capped —
// what the shared memory gained since you last looked.
export function recentAgentDocs(documents, { now = new Date(), hours = 24, limit = 4 } = {}) {
  const since = now.getTime() - hours * 60 * 60 * 1000;
  return (documents || [])
    .filter((doc) => doc && !doc.archivedAt && TRUST_PREDICATES.agent(doc))
    .filter((doc) => { const t = new Date(doc.updatedAt || 0).getTime(); return Number.isFinite(t) && t >= since; })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit);
}

// Active projects that carry on-call or handoff notes: the ops surface Today
// should show without a click into each project.
export function onCallProjects(projects, { limit = 2 } = {}) {
  return (projects || [])
    .filter((project) => project && project.status !== 'completed' && project.status !== 'archived'
      && (String(project.onCall || '').trim() || String(project.handoffNotes || '').trim()))
    .slice(0, limit);
}

// The weekly review ritual: due once the latest "Weekly review — YYYY-Www"
// document is older than six days (the nudge's own rule), else how long ago.
export function weeklyReviewStatus(documents, { now = new Date() } = {}) {
  const reviews = (documents || []).filter((doc) => doc && !doc.archivedAt && /^Weekly review — \d{4}-W\d{2}$/.test(doc.title || ''));
  const latest = reviews.map((doc) => new Date(doc.updatedAt || 0).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (!latest) return { due: true, daysAgo: null };
  const daysAgo = Math.max(0, Math.floor((now.getTime() - latest) / 86_400_000));
  return { due: daysAgo >= 6, daysAgo };
}

// Next Monday's ISO date — the triage band's "reschedule all" target.
export function nextMondayIso(now = new Date()) {
  return isoDate(nextWeekday(now, 1));
}

// Project color remains a redundant dot/wash; the text uses the accessible
// design-system foreground because arbitrary project colors are not text-safe.
// Exported so the Filter view renders the same cross-project chip.
export function projectChipHtml(task) {
  const color = escapeHtml(task.projColor || 'var(--ink3)');
  return chip(task.projName || 'No project', 'project',
    `style="--project-color:${color};background:color-mix(in oklab, ${color} 13%, transparent)"`);
}

function renderTriageBand(state, group, { overdueTotal, overdueExpanded, slippedCount, now }) {
  if (!group) return '';
  const shown = group.tasks.length;
  const hidden = Math.max(0, overdueTotal - shown);
  const slipped = slippedCount > 0
    ? `${slippedCount} of them ${slippedCount === 1 ? 'has' : 'have'} slipped at least twice. `
    : '';
  const rows = group.tasks.map((task) => {
    const row = renderTaskRowHtml(state, task, { afterTitle: projectChipHtml(task) });
    // The selected row grows a decision strip — a SIBLING of the row, since
    // the row already holds buttons.
    const decide = state.selectedTaskId === task.id
      ? `<div class="triage__decide" role="group" aria-label="Decide: ${escapeHtml(task.title || 'task')}">`
        + `<button type="button" class="btn-outline" data-action="triage-task" data-task-id="${escapeHtml(task.id)}" data-decision="today">Today</button>`
        + `<button type="button" class="btn-outline" data-action="triage-task" data-task-id="${escapeHtml(task.id)}" data-decision="monday">Monday</button>`
        + `<button type="button" class="btn-outline" data-action="triage-task" data-task-id="${escapeHtml(task.id)}" data-decision="backlog">Backlog</button>`
        + '</div>'
      : '';
    return row + decide;
  }).join('');
  const more = hidden > 0
    ? `<button type="button" class="triage__more" data-action="toggle-section" data-section-key="${TODAY_OVERDUE_ALL}" aria-expanded="false">${hidden} more, oldest first</button>`
    : (overdueExpanded && overdueTotal > OVERDUE_PREVIEW
      ? `<button type="button" class="triage__more" data-action="toggle-section" data-section-key="${TODAY_OVERDUE_ALL}" aria-expanded="true">Show fewer</button>`
      : '');
  const monday = new Date(`${nextMondayIso(now)}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  return `<section class="triage" data-triage aria-label="Overdue triage">
    <div class="triage__head">
      ${chip(`${overdueTotal} overdue`, 'due-overdue')}
      <span class="triage__text">${slipped}Decide once for the set, or one at a time.</span>
      <span class="triage__actions">
        <button type="button" class="btn-outline" data-action="triage-all" data-decision="monday" title="Move every overdue task's due date to ${escapeHtml(monday)}">Reschedule all to ${escapeHtml(monday)}</button>
        <button type="button" class="btn-outline" data-action="triage-all" data-decision="backlog" title="Move every overdue task to the backlog">Send to backlog</button>
        <button type="button" class="btn-primary" data-action="open-plan-mode" title="Walk overdue / due / inbox / upcoming one by one">Review one by one</button>
      </span>
    </div>
    <div class="rows" data-group="overdue">${rows}</div>
    ${more}
  </section>`;
}

function renderWeekCard(tasks, now) {
  const days = weekLoad(tasks, { now });
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const max = Math.max(1, ...days.map((day) => day.count));
  const bars = days.map((day) => (
    `<div class="week-strip__day${day.isToday ? ' is-today' : ''}" title="${escapeHtml(day.label)}: ${day.count} due">`
    + `<b>${day.count || ''}</b><i style="height:${Math.round((day.count / max) * 44) + 4}px"></i><small>${escapeHtml(day.label)}</small></div>`
  )).join('');
  return `<section class="today-card" data-week-card>
    <h3 class="today-card__title">This week<span class="today-card__meta">${total} due</span></h3>
    <div class="week-strip">${bars}</div>
  </section>`;
}

function renderAgentsCard(documents, queueCount, now) {
  const recent = recentAgentDocs(documents, { now });
  if (!recent.length && !queueCount) return '';
  const rows = recent.map((doc) => (
    `<button type="button" class="agent-row" data-action="open-linked-doc" data-document-id="${escapeHtml(doc.id)}">`
    + `<span class="agent-row__who">${escapeHtml(doc.updatedByAgent || 'agent')}</span>`
    + `<span class="agent-row__title">${escapeHtml(doc.title || 'Untitled document')}</span>`
    + `${doc.verified === true ? chip('VERIFIED', 'verified') : chip('UNVERIFIED', 'unverified')}`
    + '</button>'
  )).join('');
  const queue = queueCount > 0
    ? `<button type="button" class="settings-link" data-action="open-review-queue">Review queue ${queueCount} →</button>`
    : '';
  return `<section class="today-card" data-today-agents>
    <h3 class="today-card__title">Agents since yesterday${queue ? `<span class="today-card__meta">${queue}</span>` : ''}</h3>
    ${rows || '<p class="today-card__text">No agent writes in the last day.</p>'}
    ${recent.length ? `<p class="today-card__text">${recent.length} ${recent.length === 1 ? 'memory' : 'memories'} written. Agents recall only what you verify.</p>` : ''}
  </section>`;
}

function renderOnCallCard(projects) {
  const list = onCallProjects(projects);
  if (!list.length) return '';
  return list.map((project) => {
    const color = escapeHtml(project.color || 'var(--ink3)');
    return `<section class="today-card" data-today-oncall>
    <h3 class="today-card__title"><span class="proj-dot" style="--dot:${color}"></span>On call · ${escapeHtml(project.name)}${project.onCall ? `<span class="today-card__meta">${escapeHtml(project.onCall)}</span>` : ''}</h3>
    ${project.handoffNotes ? `<p class="today-card__text">${escapeHtml(project.handoffNotes)}</p>` : '<p class="today-card__text">No handoff note.</p>'}
    <button type="button" class="settings-link" data-action="nav-project" data-project-id="${escapeHtml(project.id)}">Open project</button>
  </section>`;
  }).join('');
}

export function renderTodayHtml(state, groups, {
  now = new Date(), snoozedCount = 0, collection = null,
  plannedCount = 0, plannedDone = 0, stalePlannedCount = 0,
  weekCount = 0, weekCollapsed = false,
  overdueTotal = null, overdueExpanded = false, slippedCount = 0, queueCount = 0,
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
  const weekly = weeklyReviewStatus(state.documents, { now });
  const weeklyBtn = `<button class="btn-ghost" type="button" data-action="generate-weekly-review" title="Compile last week into a Library doc (idempotent per week)">Weekly review${weekly.due ? ' <span class="chip chip--due-today">due</span>' : ''}</button>`;
  const head = '<header class="page-head"><h1 class="page-head__title">Today</h1>'
    + '<div class="page-head__actions">'
    + '<button class="btn-ghost" type="button" data-action="open-plan-mode" title="Walk overdue / due / inbox / upcoming and pull today\'s working set">Plan today</button>'
    + shutdownBtn
    + '<button class="btn-ghost" type="button" data-action="open-daily-brief" title="Daily brief / on-call handoff">✦ Brief</button>'
    + weeklyBtn
    + '</div></header>'
    + `<p class="page-head__sub">${escapeHtml(dateLabel)} — everything due or slipping across your projects, and the week ahead.${planNote}${snoozedNote}</p>`
    + (stalePlannedCount > 0
      ? `<div class="today-staleplan" data-stale-plan role="status">${stalePlannedCount} item${stalePlannedCount === 1 ? ' was' : 's were'} planned on an earlier day and never shut down. `
        + '<button class="settings-link" type="button" data-action="open-plan-mode">Review</button></div>'
      : '');
  // The week ahead folds into one collapsible section below the due groups.
  // Collapsed, only its header and count render; the caller has already
  // dropped the day groups from `groups`, so keyboard navigation and the
  // collection progress never point at hidden rows.
  // Overdue leaves the plain groups for the triage band; Planned and Due
  // today keep their headers with a ritual tail each.
  const overdueGroup = (groups || []).find((group) => group.key === 'overdue') || null;
  const total = Number.isInteger(overdueTotal) ? overdueTotal : (overdueGroup ? overdueGroup.tasks.length : 0);
  const dueGroups = (groups || []).filter((group) => !group.week && group.key !== 'overdue').map((group) => {
    if (group.key === 'planned') {
      return { ...group, tailHtml: '<button type="button" class="group-label__action" data-action="open-plan-mode">Edit plan</button>' };
    }
    if (group.key === 'today') {
      return { ...group, label: 'Due today', tailHtml: `<button type="button" class="group-label__action" data-action="plan-add-today" title="Pull every task due today into today's plan">Add ${group.tasks.length === 1 ? 'it' : 'all'} to plan</button>` };
    }
    return group;
  });
  const weekGroups = (groups || []).filter((group) => group.week);
  const triage = renderTriageBand(state, overdueGroup, { overdueTotal: total, overdueExpanded, slippedCount, now });
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
  const body = (!dueGroups.length && !overdueGroup && weekCount === 0)
    ? `<div class="empty">${logo(48)}`
      + '<p class="empty__title">All clear</p>'
      + `<p class="empty__sub">Nothing overdue, nothing due today or in the next ${WEEK_DAYS} days. Enjoy the quiet.</p>`
      + '</div>'
    : triage
      + renderTaskGroupsHtml(state, dueGroups, { rowExtra: projectChipHtml })
      + weekSection
      + renderTaskCollectionProgressHtml(collection);
  // Side cards derive from already-loaded state only; an empty card is no card.
  const side = renderWeekCard(state.tasks, now)
    + renderAgentsCard(state.documents, queueCount, now)
    + renderOnCallCard(state.projects);
  return `<div class="page today">${head}<div class="today-layout"><div class="today-main">${body}</div><aside class="today-side" aria-label="Today at a glance">${side}</aside></div></div>`;
}
