import test from 'node:test';
import assert from 'node:assert/strict';
import { slippageChips, slippageThresholds } from '../../public/js/slippageFlags.js';
import { parseTaskFilter } from '../../public/js/taskFilter.js';
import { BUILT_IN_SMART_VIEWS, findSmartView } from '../../public/js/taskSmartViews.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const TASK = {
  id: 't1', title: 'Subject', status: 'planned', archivedAt: null,
  deferralCount: 0, deferredUntil: null,
  createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-19T00:00:00Z',
};

test('slippage chips appear only past thresholds and never on finished work', () => {
  assert.deepEqual(slippageChips(TASK, { now: NOW }), []);
  const slipped = { ...TASK, deferralCount: 3 };
  assert.deepEqual(slippageChips(slipped, { now: NOW }), [{ label: 'deferred 3×', variant: 'slip-deferred' }]);
  const old = { ...TASK, createdAt: '2026-05-01T00:00:00Z' };
  assert.deepEqual(slippageChips(old, { now: NOW }), [{ label: '80d old', variant: 'slip-age' }]);
  // Completed and archived tasks have nothing to confess.
  assert.deepEqual(slippageChips({ ...slipped, status: 'completed' }, { now: NOW }), []);
  assert.deepEqual(slippageChips({ ...slipped, archivedAt: '2026-07-01T00:00:00Z' }, { now: NOW }), []);
  // The preference switch turns the mirror off entirely.
  assert.deepEqual(slippageChips(slipped, { now: NOW, preferences: { slippageChips: false } }), []);
  // Thresholds come from preferences.
  assert.equal(slippageChips(slipped, { now: NOW, preferences: { slippageDeferrals: 5 } }).length, 0);
  assert.deepEqual(slippageThresholds({}), { enabled: true, deferrals: 3, ageDays: 30 });
});

test('stale: and deferrals: filter atoms behave and compose', () => {
  const ctx = { now: NOW, resolveProjectId: () => null };
  const stale = parseTaskFilter('stale:30');
  assert.equal(stale.ok, true);
  const untouched = { ...TASK, updatedAt: '2026-06-01T00:00:00Z' };
  assert.equal(stale.predicate(untouched, ctx), true);
  assert.equal(stale.predicate(TASK, ctx), false, 'recently touched is not stale');
  assert.equal(stale.predicate({ ...untouched, status: 'completed' }, ctx), false);
  assert.equal(stale.predicate({ ...untouched, deferredUntil: '2026-08-01T00:00:00Z' }, ctx), false, 'snoozed is resting, not stale');

  const deferrals = parseTaskFilter('deferrals:2');
  assert.equal(deferrals.predicate({ ...TASK, deferralCount: 2 }, ctx), true);
  assert.equal(deferrals.predicate(TASK, ctx), false);

  // Garbage arguments match nothing rather than throwing.
  assert.equal(parseTaskFilter('stale:banana').predicate(untouched, ctx), false);
  assert.equal(parseTaskFilter('deferrals:0').predicate(TASK, ctx), false);

  // The built-in Stale view: stale but NOT backlog.
  const builtIn = parseTaskFilter(BUILT_IN_SMART_VIEWS[0].expr);
  assert.equal(builtIn.ok, true);
  assert.equal(builtIn.predicate(untouched, ctx), true);
  assert.equal(builtIn.predicate({ ...untouched, status: 'backlog' }, ctx), false, 'backlog is a parking lot by intent');
});

test('built-in smart views resolve by id and are not user-deletable data', () => {
  assert.equal(findSmartView([], 'builtin-stale').label, 'Stale');
  assert.equal(findSmartView([{ id: 'mine', label: 'Mine', expr: 'open' }], 'mine').label, 'Mine');
  assert.equal(findSmartView([], 'nope'), null);
  assert.equal(BUILT_IN_SMART_VIEWS[0].builtIn, true);
  assert.throws(() => { BUILT_IN_SMART_VIEWS.push({}); }, 'the built-in list is frozen');
});
