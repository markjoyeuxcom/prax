import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilterGroups, renderFilterHtml } from '../../public/js/renderFilter.js';
import { parseTaskFilter } from '../../public/js/taskFilter.js';

const NOW = new Date(2026, 6, 8, 12, 0, 0);
const PROJECTS = [{ id: 'h', slug: 'homelab', name: 'Homelab', color: '#3aa17e' }];
const TASKS = [
  { id: 'A', title: 'Open one', status: 'planned', priority: 'high', dueDate: '2026-07-08', labels: ['waiting'], projectId: 'h' },
  { id: 'B', title: 'Done one', status: 'completed', priority: 'low', dueDate: '2026-07-01', labels: ['waiting'], projectId: 'h' },
  { id: 'C', title: 'Other', status: 'planned', priority: 'low', dueDate: null, labels: [], projectId: 'h' },
];

function build(expr) {
  const { predicate } = parseTaskFilter(expr);
  return buildFilterGroups(TASKS, PROJECTS, predicate, { now: NOW });
}

test('buildFilterGroups filters by predicate and splits Open / Done', () => {
  const { groups, flatIds, count } = build('@waiting');
  assert.equal(count, 2);
  assert.deepEqual(groups.map(g => g.key), ['open', 'done']);
  assert.deepEqual(groups[0].tasks.map(t => t.id), ['A']);
  assert.deepEqual(groups[1].tasks.map(t => t.id), ['B']);
  assert.deepEqual(flatIds, ['A', 'B']);
  // decorated with project + due info
  assert.equal(groups[0].tasks[0].projName, 'Homelab');
  assert.ok(groups[0].tasks[0].dueInfo);
});

test('buildFilterGroups returns empty groups when nothing matches', () => {
  const { groups, count } = build('@nope');
  assert.equal(count, 0);
  assert.deepEqual(groups, []);
});

function baseState(over = {}) {
  return { activeFilterExpr: '', activeSmartViewId: null, taskSmartViews: [], multiSelectIds: [], ...over };
}

test('renderFilterHtml shows the input, count, and a save button for a valid non-empty filter', () => {
  const model = { ...build('p1'), error: null };
  const html = renderFilterHtml(baseState({ activeFilterExpr: 'p1' }), model);
  assert.match(html, /data-filter-input[^>]*value="p1"/);
  assert.match(html, /1 match</);
  assert.match(html, /data-action="save-smart-view"/);
});

test('renderFilterHtml surfaces a parse error and hides save', () => {
  const html = renderFilterHtml(baseState({ activeFilterExpr: '(p1' }), { groups: [], count: 0, error: 'missing )' });
  assert.match(html, /filter-bar__hint--error/);
  assert.match(html, /missing \)/);
  assert.doesNotMatch(html, /data-action="save-smart-view"/);
});

test('renderFilterHtml titles the page with the active smart view name and escapes it', () => {
  const state = baseState({ activeFilterExpr: '@waiting', activeSmartViewId: 'v1', taskSmartViews: [{ id: 'v1', label: '<x> Waiting', expr: '@waiting' }] });
  const html = renderFilterHtml(state, { ...build('@waiting'), error: null });
  assert.match(html, /page-head__title">&lt;x&gt; Waiting/);
});

test('renderFilterHtml hides save for an empty filter and shows the prompt', () => {
  const html = renderFilterHtml(baseState(), { groups: [], count: 0, error: null });
  assert.doesNotMatch(html, /data-action="save-smart-view"/);
  assert.match(html, /Type a filter/);
});
