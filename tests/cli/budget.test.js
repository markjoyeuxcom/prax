import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokens, fillOrder, fillTier, citedAndUnchanged, trustChip, firstLine, compactLine,
  planBudget, omissionLine, budgetLine, FILL_TIERS,
} from '../../cli/lib/budget.js';

const current = { status: 'current', path: 'a.js' };

test('the token estimate is ceil(chars / 4) over the exact text', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('x'.repeat(400)), 100);
  assert.equal(estimateTokens(null), 0);
});

test('fill tiers: verified, then cited-and-unchanged, then everything else', () => {
  assert.equal(fillTier({ verified: true }), 0);
  assert.equal(fillTier({ verified: false, citations: [current], citationCheck: { checked: 1, unchecked: 0, reason: null } }), 1);
  assert.equal(fillTier({ verified: false }), 2);
  // Retired rows are never verified-tier, whatever their old verification.
  assert.equal(fillTier({ verified: true, status: 'superseded' }), 2);
  assert.equal(fillTier({ verified: true, archivedAt: '2026-01-01' }), 2);
});

test('cited-and-unchanged needs every citation checked here and still current', () => {
  const ok = { citations: [current, current], citationCheck: { checked: 2, unchecked: 0, reason: null } };
  assert.equal(citedAndUnchanged(ok), true);
  assert.equal(citedAndUnchanged({ citations: [] }), false, 'no citation, no tier');
  assert.equal(citedAndUnchanged({ citations: [current, { status: 'changed' }] }), false);
  assert.equal(citedAndUnchanged({ citations: [{ status: 'moved' }] }), false, 'a move is not confirmed ground');
  assert.equal(citedAndUnchanged({ citations: [{ status: 'missing' }] }), false);
  // One checked and current, one not checked (another repository): not confirmed.
  assert.equal(citedAndUnchanged({ citations: [current], citationCheck: { checked: 1, unchecked: 1, reason: 'other-repository' } }), false);
  assert.equal(citedAndUnchanged({ citations: [current], citationCheck: { checked: 0, unchecked: null, reason: 'unavailable' } }), false);
});

test('fillOrder keeps retrieval order in tiers 1 and 2 and sorts the rest newest first', () => {
  const items = [
    { id: 'old-unverified', verified: false, updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'undated', verified: false },
    { id: 'verified-b', verified: true, updatedAt: '2025-01-01T00:00:00Z' },
    { id: 'new-unverified', verified: false, updatedAt: '2026-06-01T00:00:00Z' },
    { id: 'cited', verified: false, citations: [current], citationCheck: { checked: 1, unchecked: 0, reason: null }, updatedAt: '2020-01-01T00:00:00Z' },
    { id: 'verified-a', verified: true, updatedAt: '2026-09-01T00:00:00Z' },
  ];
  const ordered = fillOrder(items);
  assert.deepEqual(ordered.map((i) => i.id), ['verified-b', 'verified-a', 'cited', 'new-unverified', 'old-unverified', 'undated']);
  assert.deepEqual(ordered.map((i) => i.tier), ['verified', 'verified', 'cited-unchanged', 'recent', 'recent', 'recent']);
  assert.deepEqual(FILL_TIERS, ['verified', 'cited-unchanged', 'recent']);
  // Deterministic: the same input always gives the same order, and the input is untouched.
  assert.deepEqual(fillOrder(items).map((i) => i.id), ordered.map((i) => i.id));
  assert.equal(items[0].tier, undefined);
});

test('trust chips name verification, or the retirement', () => {
  assert.equal(trustChip({ verified: true }), '[verified]');
  assert.equal(trustChip({ verified: false }), '[unverified]');
  assert.equal(trustChip({ verified: true, status: 'superseded' }), '[superseded]');
  assert.equal(trustChip({ status: 'deprecated' }), '[deprecated]');
  assert.equal(trustChip({ verified: true, archivedAt: '2026-01-01' }), '[archived]');
  assert.equal(trustChip(null), '[trust unknown]');
});

test('firstLine skips the title heading and Markdown markers and cuts at 120', () => {
  assert.equal(firstLine('# Restore\n\nStop the app first.', 'Restore'), 'Stop the app first.');
  assert.equal(firstLine('\n\n- [ ] item one\n- two'), 'item one');
  assert.equal(firstLine('> quoted  text'), 'quoted text');
  assert.equal(firstLine('---\n1. step'), 'step');
  assert.equal(firstLine(''), '');
  const long = firstLine('y'.repeat(300));
  assert.equal(long.length, 121);
  assert.ok(long.endsWith('…'));
});

test('a compact entry is exactly one line that starts with its trust chip', () => {
  const line = compactLine({
    id: 'd1', title: 'A\ntitle  with\tbreaks', documentType: 'runbook', verified: false, body: '# A title with breaks\nFirst real line.\nSecond.',
  });
  assert.equal(line, '- [unverified] A title with breaks (runbook · d1) — First real line.');
  assert.ok(!line.includes('\n'));
  assert.equal(compactLine({ id: 'd2', title: 'T', verified: true }, { extra: ['changed: created'] }), '- [verified] T (note · d2 · changed: created)');
});

const entry = (id, fullChars, { unverified = false } = {}) => ({
  id,
  full: `## [${unverified ? 'unverified' : 'verified'}] ${id}\n\n${'x'.repeat(fullChars)}\n`,
  compact: `- [${unverified ? 'unverified' : 'verified'}] ${id} (note · ${id})`,
  unverified,
});

test('planBudget prints everything in full when it fits, and without a budget', () => {
  const entries = [entry('a', 40), entry('b', 40)];
  assert.deepEqual(planBudget(entries, { budget: 1000, fixed: 'head' }).forms, ['full', 'full']);
  const unlimited = planBudget(entries, { budget: Infinity, fixed: 'head' });
  assert.deepEqual(unlimited.forms, ['full', 'full']);
  assert.deepEqual(unlimited.omitted, { total: 0, unverified: 0 });
});

test('planBudget: full while it fits, then compact for the rest, then omitted — in fill order', () => {
  const entries = [entry('a', 100), entry('b', 400), entry('c', 20, { unverified: true }), entry('d', 20, { unverified: true })];
  const plan = planBudget(entries, { budget: 90, fixed: 'head' });
  // b's full form does not fit, so b and everything after it are compact:
  // a lower tier never prints in full after a higher one was compacted.
  assert.equal(plan.forms[0], 'full');
  assert.equal(plan.forms[1], 'compact');
  assert.ok(!plan.forms.slice(2).includes('full'));
  assert.ok(plan.used <= 90, `used ${plan.used}`);

  const tight = planBudget(entries, { budget: 60, fixed: 'head' });
  const firstOmitted = tight.forms.indexOf(null);
  assert.ok(firstOmitted > 0);
  assert.ok(tight.forms.slice(firstOmitted).every((f) => f === null), 'the fill stops at the first entry that does not fit');
  assert.equal(tight.omitted.total, tight.forms.filter((f) => f === null).length);
  assert.ok(tight.used <= 60, `used ${tight.used}`);
});

test('planBudget always keeps the fixed lines and counts what it left out', () => {
  const entries = [entry('a', 10), entry('b', 10, { unverified: true })];
  const plan = planBudget(entries, { budget: 5, fixed: 'x'.repeat(200) });
  assert.deepEqual(plan.forms, [null, null]);
  assert.deepEqual(plan.omitted, { total: 2, unverified: 1 });
  assert.ok(plan.used > 5, 'the fixed lines alone exceed the budget and still count');
});

test('omission and budget lines say what happened', () => {
  assert.equal(omissionLine({ total: 0, unverified: 0 }), '');
  assert.equal(omissionLine({ total: 3, unverified: 2 }), '_3 more left out by the budget (2 unverified) — raise --budget, or prax get <id>._');
  assert.match(budgetLine({ tokens: 100, used: 90, total: 5, shown: 3 }), /^\(budget: ~90 of 100 tokens, chars\/4 · 3 of 5 shown · fill: verified → cited-unchanged → recent\)$/);
  assert.match(budgetLine({ tokens: 10, used: 90, total: 5, shown: 0 }), /exceeded by the disclosure lines/);
});
