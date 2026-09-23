// Month calendar over the task set — pure state → HTML string, like every
// view module. The grid places OPEN tasks (same inclusion rule as Today's week ahead:
// not completed/backlog/archived, not snoozed past now, has a dueDate) on
// their due day; clicking a day opens a detail strip below the grid that
// reuses the standard task-row rendering, so the drawer/multi-select/done
// affordances all behave identically to the list views.
import { escapeHtml } from './html.js';
import { isOpen } from './statusMap.js';
import { projectChipHtml, isSnoozed } from './renderToday.js';
import { dueFlag } from './dueFlags.js';
import { renderTaskGroupsHtml } from './renderList.js';
import { icon } from './icons.js';
import { isoDate } from './dateHelpers.js';

const MAX_CHIPS_PER_DAY = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// 'YYYY-MM' for the month a Date falls in (local).
export function monthKeyOf(date) {
  return isoDate(date).slice(0, 7);
}

// Shift a 'YYYY-MM' key by n months (n may be negative).
export function shiftMonthKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKeyOf(d);
}

// Build the month model: a Monday-start grid of weeks covering the month
// (the app's week convention — taskModel's completed-this-week metric is
// Monday-based), each cell carrying that day's open tasks sorted by time
// then priority. month: 'YYYY-MM' or null for the current month.
export function buildCalendarModel(tasks, projects, { month, now = new Date() } = {}) {
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') ? month : monthKeyOf(now);
  const [year, monthIndex] = monthKey.split('-').map(Number);
  const todayIso = isoDate(now);

  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const byDate = new Map();
  const open = (tasks || []).filter((task) => isOpen(task) && !isSnoozed(task, now) && task.dueDate);
  for (const task of open) {
    const decorated = {
      ...task,
      done: false,
      dueInfo: dueFlag(task.dueDate, { dueTime: task.dueTime, now }),
      projName: projectById.get(task.projectId)?.name || 'No project',
      projColor: projectById.get(task.projectId)?.color || null,
    };
    if (!byDate.has(task.dueDate)) byDate.set(task.dueDate, []);
    byDate.get(task.dueDate).push(decorated);
  }
  const prioRank = { high: 0, medium: 1, low: 2 };
  for (const list of byDate.values()) {
    list.sort((a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99')
      || (prioRank[a.priority] ?? 1) - (prioRank[b.priority] ?? 1)
      || String(a.title).localeCompare(String(b.title)));
  }

  // Grid arithmetic runs on a UTC clock, NOT local Dates: local-midnight
  // construction breaks in timezones that skipped a whole calendar day
  // (Pacific/Apia has no Dec 30, 2011 — a local-Date grid renders Dec 31
  // twice and Dec 30 never). UTC calendar days always exist, and only the
  // Y-M-D components are read, so the grid is host-timezone-independent;
  // "today" still compares against the user's LOCAL date.
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday-start
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const weekCount = Math.ceil((startOffset + daysInMonth) / 7);

  const weeks = [];
  let monthTaskCount = 0;
  for (let w = 0; w < weekCount; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(Date.UTC(year, monthIndex - 1, 1 - startOffset + w * 7 + d));
      const iso = date.toISOString().slice(0, 10);
      const inMonth = iso.slice(0, 7) === monthKey;
      const dayTasks = byDate.get(iso) || [];
      if (inMonth) monthTaskCount += dayTasks.length;
      week.push({ iso, dayNum: date.getUTCDate(), inMonth, isToday: iso === todayIso, tasks: dayTasks });
    }
    weeks.push(week);
  }

  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { monthKey, label, weeks, byDate, monthTaskCount, todayIso };
}

function chipHtml(task) {
  const time = task.dueTime ? `<span class="cal-chip__time">${escapeHtml(task.dueTime)}</span>` : '';
  return `<button type="button" class="cal-chip" data-action="open-task" data-task-id="${escapeHtml(task.id)}" title="${escapeHtml(task.title)}">`
    + `<span class="prio-dot prio-dot--${task.priority === 'medium' ? 'med' : escapeHtml(task.priority || 'med')}"></span>`
    + time
    + `<span class="cal-chip__title">${escapeHtml(task.title)}</span>`
    + '</button>';
}

function cellHtml(cell, selectedDay) {
  const classes = ['cal-cell'];
  if (!cell.inMonth) classes.push('is-outside');
  if (cell.isToday) classes.push('is-today');
  if (cell.iso === selectedDay) classes.push('is-selected');
  const chips = cell.tasks.slice(0, MAX_CHIPS_PER_DAY).map(chipHtml).join('');
  const overflow = cell.tasks.length > MAX_CHIPS_PER_DAY
    ? `<div class="cal-cell__more">+${cell.tasks.length - MAX_CHIPS_PER_DAY} more</div>`
    : '';
  // Deliberately NOT role="button"/tabindex: no keydown path dispatches
  // data-actions, and a focusable cell would route Enter to the global
  // open-selected shortcut (reopening an unrelated task). The task chips
  // inside are real <button>s, so the tasks stay keyboard-reachable.
  return `<div class="${classes.join(' ')}" data-action="calendar-select-day" data-day="${escapeHtml(cell.iso)}">`
    + `<div class="cal-cell__num">${escapeHtml(cell.dayNum)}</div>`
    + chips
    + overflow
    + '</div>';
}

function dayDetailHtml(state, model) {
  const iso = state.calendarSelectedDay;
  if (!iso) return '';
  const tasks = model.byDate.get(iso) || [];
  const date = new Date(`${iso}T12:00:00`);
  const label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (!tasks.length) {
    return `<div class="cal-detail"><div class="group-label">${escapeHtml(label)}</div>`
      + '<p class="view-hint">No tasks due this day.</p></div>';
  }
  const group = { key: `cal-${iso}`, label, tasks, tone: iso === model.todayIso ? 'med' : 'muted' };
  return `<div class="cal-detail">${renderTaskGroupsHtml(state, [group], { rowExtra: projectChipHtml })}</div>`;
}

export function renderCalendarHtml(state, model, { feedUrl = '' } = {}) {
  const head = '<header class="page-head">'
    + '<h1 class="page-head__title">Calendar</h1>'
    + '<div class="cal-nav">'
    + '<button type="button" class="btn-ghost cal-nav__btn" data-action="calendar-prev" aria-label="Previous month">‹</button>'
    + '<button type="button" class="btn-ghost" data-action="calendar-today">Today</button>'
    + '<button type="button" class="btn-ghost cal-nav__btn" data-action="calendar-next" aria-label="Next month">›</button>'
    + '</div>'
    + '</header>'
    + `<p class="page-head__sub">${escapeHtml(model.label)} — ${model.monthTaskCount === 0 ? 'no dated tasks this month' : `${escapeHtml(model.monthTaskCount)} dated task${model.monthTaskCount === 1 ? '' : 's'}`}.</p>`;

  const headRow = `<div class="cal-weekdays">${WEEKDAYS.map((d) => `<div class="cal-weekdays__day">${d}</div>`).join('')}</div>`;
  const grid = `<div class="cal-grid" role="grid" aria-label="${escapeHtml(model.label)}">`
    + model.weeks.map((week) => week.map((cell) => cellHtml(cell, state.calendarSelectedDay)).join('')).join('')
    + '</div>';

  const feed = feedUrl
    ? '<div class="cal-feed">'
      + `${icon('calendar', 13)}<span class="cal-feed__label">Subscribe from your calendar app:</span>`
      + `<code class="cal-feed__url">${escapeHtml(feedUrl)}</code>`
      + `<button type="button" class="btn-ghost" data-action="copy-ics-url" data-url="${escapeHtml(feedUrl)}">Copy</button>`
      + '</div>'
    : '';

  return `<div class="page page--calendar">${head}${headRow}${grid}${dayDetailHtml(state, model)}${feed}</div>`;
}
