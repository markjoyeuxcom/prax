import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalendarModel, renderCalendarHtml, monthKeyOf, shiftMonthKey,
} from '../../public/js/renderCalendar.js';

// Fixed clock: Friday 2026-07-10.
const NOW = new Date(2026, 6, 10, 9, 0, 0);

const PROJECTS = [{ id: 'p1', name: 'Homelab', color: '#3aa981' }];

function task(overrides = {}) {
  return {
    id: overrides.id || 't1',
    title: 'Rotate the TLS certs',
    priority: 'high',
    status: 'planned',
    projectId: 'p1',
    dueDate: '2026-07-17',
    dueTime: null,
    archivedAt: null,
    deferredUntil: null,
    ...overrides,
  };
}

test('monthKeyOf and shiftMonthKey handle year boundaries', () => {
  assert.equal(monthKeyOf(NOW), '2026-07');
  assert.equal(shiftMonthKey('2026-07', 1), '2026-08');
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
});

test('an out-of-range or garbage month key falls back to the current month', () => {
  for (const bad of ['2026-13', '2026-00', 'garbage', null]) {
    const model = buildCalendarModel([], PROJECTS, { month: bad, now: NOW });
    assert.equal(model.monthKey, '2026-07', `"${bad}" falls back`);
  }
});

test('the grid is Monday-start and covers July 2026 (Wed 1st → offset 2, 5 weeks)', () => {
  const model = buildCalendarModel([], PROJECTS, { now: NOW });
  assert.equal(model.monthKey, '2026-07');
  assert.equal(model.label, 'July 2026');
  assert.equal(model.weeks.length, 5);
  // July 1, 2026 is a Wednesday → the first week starts Mon Jun 29.
  assert.equal(model.weeks[0][0].iso, '2026-06-29');
  assert.equal(model.weeks[0][0].inMonth, false);
  assert.equal(model.weeks[0][2].iso, '2026-07-01');
  assert.equal(model.weeks[0][2].inMonth, true);
  assert.equal(model.weeks[4][6].iso, '2026-08-02');
  const todayCell = model.weeks.flat().find((c) => c.isToday);
  assert.equal(todayCell.iso, '2026-07-10');
});

test('open dated tasks land on their day; completed/archived/snoozed/undated excluded', () => {
  const tasks = [
    task(),
    task({ id: 't2', status: 'completed' }),
    task({ id: 't3', archivedAt: '2026-07-01T00:00:00Z' }),
    task({ id: 't4', deferredUntil: '2099-01-01T00:00:00Z' }),
    task({ id: 't5', dueDate: null }),
    task({ id: 't6', dueDate: '2026-08-01' }), // next month — not counted in July
  ];
  const model = buildCalendarModel(tasks, PROJECTS, { now: NOW });
  assert.equal(model.monthTaskCount, 1);
  assert.deepEqual(model.byDate.get('2026-07-17').map((t) => t.id), ['t1']);
  assert.equal(model.byDate.get('2026-07-17')[0].projName, 'Homelab');
});

test('a day sorts timed tasks first by time, then by priority', () => {
  const tasks = [
    task({ id: 'low', priority: 'low', title: 'zzz' }),
    task({ id: 'timed', dueTime: '09:00' }),
    task({ id: 'high', priority: 'high', title: 'aaa' }),
    task({ id: 'late', dueTime: '17:30' }),
  ];
  const model = buildCalendarModel(tasks, PROJECTS, { now: NOW });
  assert.deepEqual(model.byDate.get('2026-07-17').map((t) => t.id), ['timed', 'late', 'high', 'low']);
});

test('renderCalendarHtml shows chips, overflow, today ring, and the feed row', () => {
  const tasks = [1, 2, 3, 4, 5].map((n) => task({ id: `t${n}`, title: `Task ${n}` }));
  const model = buildCalendarModel(tasks, PROJECTS, { now: NOW });
  const html = renderCalendarHtml({ calendarSelectedDay: null }, model, { feedUrl: 'http://127.0.0.1:3000/api/calendar.ics' });
  assert.ok(html.includes('page--calendar'));
  assert.ok(html.includes('July 2026'));
  assert.ok(html.includes('data-action="open-task" data-task-id="t1"'));
  assert.ok(html.includes('+2 more'), 'five tasks on one day → 3 chips + overflow');
  assert.ok(html.includes('data-action="calendar-select-day" data-day="2026-07-17"'));
  assert.ok(html.includes('is-today'));
  assert.ok(html.includes('data-action="copy-ics-url"'));
  assert.ok(html.includes('http://127.0.0.1:3000/api/calendar.ics'));
});

test('selecting a day renders the detail strip with full task rows', () => {
  const model = buildCalendarModel([task()], PROJECTS, { now: NOW });
  const state = { calendarSelectedDay: '2026-07-17', selectedTaskId: null, multiSelectIds: [], taskBoardExtras: {} };
  const html = renderCalendarHtml(state, model, {});
  assert.ok(html.includes('cal-detail'));
  assert.ok(html.includes('Friday, July 17'));
  assert.ok(html.includes('task-row__title'));

  const emptyDay = renderCalendarHtml({ ...state, calendarSelectedDay: '2026-07-20' }, model, {});
  assert.ok(emptyDay.includes('No tasks due this day.'));
});

test('an empty feedUrl renders no subscribe row (desktop shell hides it)', () => {
  const model = buildCalendarModel([], PROJECTS, { now: NOW });
  const html = renderCalendarHtml({ calendarSelectedDay: null }, model, { feedUrl: '' });
  assert.equal(html.includes('cal-feed'), false);
  assert.equal(html.includes('copy-ics-url'), false);
});

test('day cells are not focusable buttons (keyboard goes through the real chip buttons)', () => {
  const model = buildCalendarModel([task()], PROJECTS, { now: NOW });
  const html = renderCalendarHtml({ calendarSelectedDay: null }, model, {});
  assert.equal(/cal-cell[^>]*role="button"/.test(html), false);
  assert.equal(/cal-cell[^>]*tabindex/.test(html), false);
  assert.ok(html.includes('<button type="button" class="cal-chip"'));
});

test('task titles are HTML-escaped in chips', () => {
  const model = buildCalendarModel([task({ title: '<img src=x onerror=alert(1)>' })], PROJECTS, { now: NOW });
  const html = renderCalendarHtml({ calendarSelectedDay: null }, model, {});
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});
