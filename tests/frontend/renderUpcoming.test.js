import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpcomingGroups, renderUpcomingHtml } from '../../public/js/renderUpcoming.js';

const NOW = new Date(2026, 6, 8, 12, 0, 0); // Wed 2026-07-08
const PROJECTS = [{ id: 'h', slug: 'homelab', name: 'Homelab', color: '#3aa17e' }];
const t = (id, over) => ({ id, title: id, status: 'planned', priority: 'medium', projectId: 'h', dueDate: null, deferredUntil: null, ...over });

const TASKS = [
  t('overdue', { dueDate: '2026-07-01' }),
  t('today', { dueDate: '2026-07-08' }),
  t('tomorrow', { dueDate: '2026-07-09' }),
  t('friday', { dueDate: '2026-07-10' }),
  t('beyond', { dueDate: '2026-07-20' }),        // outside the 7-day window
  t('nodate', {}),                                // no due date → excluded
  t('snoozed', { dueDate: '2026-07-08', deferredUntil: '2026-07-30T00:00:00Z' }),
  t('done', { dueDate: '2026-07-08', status: 'completed' }),
];

test('buildUpcomingGroups: Overdue group + one per day, excludes no-date/beyond/snoozed/done', () => {
  const { groups, flatIds, badge } = buildUpcomingGroups(TASKS, PROJECTS, { now: NOW });
  assert.deepEqual(groups.map((g) => g.label), ['Overdue', 'Today', 'Tomorrow', 'Fri, Jul 10']);
  assert.deepEqual(groups.map((g) => g.tasks.map((x) => x.id)), [['overdue'], ['today'], ['tomorrow'], ['friday']]);
  assert.deepEqual(flatIds, ['overdue', 'today', 'tomorrow', 'friday']);
  // badge counts the in-window tasks (today..+6), excluding overdue
  assert.equal(badge, 3);
  // decorated with project chip fields
  assert.equal(groups[1].tasks[0].projName, 'Homelab');
});

test('buildUpcomingGroups drops empty days', () => {
  const { groups } = buildUpcomingGroups([t('today', { dueDate: '2026-07-08' })], PROJECTS, { now: NOW });
  assert.deepEqual(groups.map((g) => g.label), ['Today']);
});

test('renderUpcomingHtml renders the groups and an empty state', () => {
  const { groups } = buildUpcomingGroups(TASKS, PROJECTS, { now: NOW });
  const html = renderUpcomingHtml({}, groups, { now: NOW });
  assert.match(html, /page-head__title">Upcoming/);
  assert.match(html, /Overdue/);
  assert.match(html, /Fri, Jul 10/);

  const empty = renderUpcomingHtml({}, [], { now: NOW });
  assert.match(empty, /Nothing coming up/);
});
