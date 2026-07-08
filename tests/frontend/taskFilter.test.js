import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskFilter, projectResolver } from '../../public/js/taskFilter.js';

const NOW = new Date(2026, 6, 8, 12, 0, 0); // 2026-07-08, a Wednesday (local noon)

const resolveProjectId = projectResolver([
  { id: 'h', slug: 'homelab', name: 'Home Lab' },
  { id: 'w', slug: 'work', name: 'Work' },
]);
const CTX = { now: NOW, resolveProjectId };

const TASKS = [
  { id: 'A', title: 'Rotate cert', status: 'planned', priority: 'high', dueDate: '2026-07-08', labels: ['waiting'], projectId: 'h', deferredUntil: null, recurrence: null },
  { id: 'B', title: 'Old thing', status: 'planned', priority: 'low', dueDate: '2026-07-01', labels: ['pagerduty'], projectId: 'w', deferredUntil: null, recurrence: null },
  { id: 'C', title: 'Done deal', status: 'completed', priority: 'medium', dueDate: '2026-07-05', labels: [], projectId: 'h', deferredUntil: null, recurrence: null },
  { id: 'D', title: 'Future work', status: 'in-progress', priority: 'medium', dueDate: '2026-07-20', labels: ['waiting'], projectId: 'h', deferredUntil: null, recurrence: 'weekly' },
  { id: 'E', title: 'Snoozed item', status: 'planned', priority: 'high', dueDate: null, labels: [], projectId: 'w', deferredUntil: '2026-07-20T00:00:00Z', recurrence: null },
  { id: 'F', title: 'Tomorrow task', status: 'planned', priority: 'medium', dueDate: '2026-07-09', labels: [], projectId: 'h', deferredUntil: null, recurrence: null },
];

// Match ids for an expression (strict parse).
function ids(expr, opts) {
  const { ok, predicate } = parseTaskFilter(expr, opts);
  assert.ok(predicate, `"${expr}" should compile`);
  return { ok, ids: TASKS.filter((t) => predicate(t, CTX)).map((t) => t.id) };
}

test('label, priority, and status atoms', () => {
  assert.deepEqual(ids('@waiting').ids, ['A', 'D']);
  assert.deepEqual(ids('p1').ids, ['A', 'E']);
  assert.deepEqual(ids('priority:high').ids, ['A', 'E']);
  assert.deepEqual(ids('status:in-progress').ids, ['D']);
  assert.deepEqual(ids('done').ids, ['C']);
  assert.deepEqual(ids('open').ids, ['A', 'B', 'D', 'E', 'F']);
});

test('date atoms use the dueFlags buckets', () => {
  assert.deepEqual(ids('overdue').ids, ['B', 'C']);      // date-based, includes the completed one
  assert.deepEqual(ids('due:today').ids, ['A']);
  assert.deepEqual(ids('due:tomorrow').ids, ['F']);
  assert.deepEqual(ids('due:none').ids, ['E']);
  assert.deepEqual(ids('due:week').ids, ['A', 'F']);      // today..+7
  assert.deepEqual(ids('due:2026-07-01').ids, ['B']);
});

test('flag atoms', () => {
  assert.deepEqual(ids('is:snoozed').ids, ['E']);
  assert.deepEqual(ids('is:recurring').ids, ['D']);
});

test('#project resolves by slug and by slugified name; unresolved matches nothing', () => {
  assert.deepEqual(ids('#homelab').ids, ['A', 'C', 'D', 'F']);
  assert.deepEqual(ids('#home-lab').ids, ['A', 'C', 'D', 'F']); // slugified "Home Lab"
  assert.deepEqual(ids('#nope').ids, []);
});

test('bareword is a case-insensitive title substring (preserves q search)', () => {
  assert.deepEqual(ids('rotate').ids, ['A']);
  assert.deepEqual(ids('WORK').ids, ['D']); // "Future work"
});

test('AND (juxtaposition + explicit &), OR, and NOT', () => {
  assert.deepEqual(ids('@waiting & #homelab').ids, ['A', 'D']);
  assert.deepEqual(ids('@waiting #homelab').ids, ['A', 'D']);   // implicit AND
  assert.deepEqual(ids('overdue & -done').ids, ['B']);          // exclude completed
  assert.deepEqual(ids('-@waiting').ids, ['B', 'C', 'E', 'F']);
  assert.deepEqual(ids('done | is:recurring').ids, ['C', 'D']);
});

test('precedence: AND binds tighter than OR; grouping overrides', () => {
  // "@waiting p1 | overdue" == (@waiting & p1) | overdue
  assert.deepEqual(ids('@waiting p1 | overdue').ids, ['A', 'B', 'C']);
  assert.deepEqual(ids('(@pagerduty | @waiting) & -status:completed').ids, ['A', 'B', 'D']);
});

test('empty / whitespace expression matches everything', () => {
  assert.deepEqual(ids('').ids, TASKS.map((t) => t.id));
  assert.deepEqual(ids('   ').ids, TASKS.map((t) => t.id));
});

test('malformed input never throws: strict returns ok:false + null predicate', () => {
  for (const bad of ['(p1', 'p1 &', 'p1 |', ')(', '( )', '|']) {
    const res = parseTaskFilter(bad);
    assert.equal(res.ok, false, `"${bad}" should be ok:false`);
    assert.equal(res.predicate, null);
    assert.equal(typeof res.error, 'string');
  }
});

test('partial mode filters by the longest valid prefix and reports ok:false', () => {
  const res = parseTaskFilter('@waiting (', { partial: true });
  assert.equal(res.ok, false);
  assert.ok(res.predicate, 'partial keeps a usable predicate');
  assert.deepEqual(TASKS.filter((t) => res.predicate(t, CTX)).map((t) => t.id), ['A', 'D']);
});

test('partial mode falls back to match-all when nothing parses', () => {
  const res = parseTaskFilter('(', { partial: true });
  assert.equal(res.ok, false);
  assert.deepEqual(TASKS.filter((t) => res.predicate(t, CTX)).map((t) => t.id), TASKS.map((t) => t.id));
});

test('a hyphen inside a term is literal, not negation', () => {
  // "@cert-rotation" is one label atom, not "@cert" minus "rotation"
  const withLabel = { ...TASKS[0], id: 'X', labels: ['cert-rotation'] };
  const { predicate } = parseTaskFilter('@cert-rotation');
  assert.equal(predicate(withLabel, CTX), true);
  assert.equal(predicate(TASKS[0], CTX), false);
});
