import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pairKey, selectContradictionPairs, buildContradictionMessages, parseContradiction, quoteIsGrounded,
  buildGapDigest, buildGapMessages, parseGaps, extractJsonObject, extractJsonArray, clampStr, MAX_PAIRS,
} from '../../server/kbHealthReview.js';

const byId = new Map([
  ['a', { id: 'a', title: 'Alpha', body: 'AAA', documentType: 'runbook', verified: true }],
  ['b', { id: 'b', title: 'Beta', body: 'BBB', documentType: 'note', verified: false }],
  ['c', { id: 'c', title: 'Gamma', body: 'CCC' }],
]);

test('pairKey is order-independent', () => {
  assert.equal(pairKey('b', 'a'), pairKey('a', 'b'));
});

test('selectContradictionPairs dedupes A-B/B-A, applies thresholds, ranks, caps', () => {
  const raw = [
    { aId: 'a', bId: 'b', similarity: 0.9 },
    { aId: 'b', bId: 'a', similarity: 0.85 },   // same undirected pair, lower sim → collapsed to 0.9
    { aId: 'a', bId: 'c', similarity: 0.5 },     // below 0.80 floor → dropped
    { aId: 'b', bId: 'c', similarity: 0.999 },   // above 0.995 ceiling → dropped
    { aId: 'a', bId: 'a', similarity: 0.9 },     // self-pair → dropped
    { aId: 'a', bId: 'zzz', similarity: 0.9 },   // unknown id → dropped
  ];
  const pairs = selectContradictionPairs(raw, byId);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.id, 'a');
  assert.equal(pairs[0].b.id, 'b');
  assert.equal(pairs[0].similarity, 0.9); // kept the max for the deduped key
});

test('selectContradictionPairs sorts by similarity desc and caps at maxPairs', () => {
  const big = new Map();
  for (let i = 0; i < 30; i += 1) big.set(`d${i}`, { id: `d${i}`, title: `D${i}`, body: 'x' });
  const raw = [];
  for (let i = 1; i < 30; i += 1) raw.push({ aId: 'd0', bId: `d${i}`, similarity: 0.80 + i * 0.001 });
  const pairs = selectContradictionPairs(raw, big, { maxPairs: MAX_PAIRS });
  assert.equal(pairs.length, MAX_PAIRS);
  // highest similarity first
  for (let i = 1; i < pairs.length; i += 1) assert.ok(pairs[i - 1].similarity >= pairs[i].similarity);
});

test('buildContradictionMessages: system rules + labelled bodies + clip', () => {
  const [sys, user] = buildContradictionMessages(
    { title: 'A', body: 'a'.repeat(2000), documentType: 'runbook', verified: false },
    { title: 'B', body: 'short', documentType: 'note', verified: true },
  );
  assert.equal(sys.role, 'system');
  assert.match(sys.content, /same subject/i);
  assert.match(sys.content, /answer false/i);
  assert.match(sys.content, /VERBATIM/);
  assert.match(user.content, /DOCUMENT A — "A" \(runbook · UNVERIFIED\)/);
  assert.match(user.content, /DOCUMENT B — "B" \(note · verified\)/);
  assert.match(user.content, /…\(truncated\)/); // the 2000-char body was clipped
});

test('extractJsonObject tolerates fences, prose, nesting; junk → null', () => {
  assert.deepEqual(extractJsonObject('```json\n{"contradicts":true}\n```'), { contradicts: true });
  assert.deepEqual(extractJsonObject('sure: {"a":{"b":1}} done'), { a: { b: 1 } });
  assert.equal(extractJsonObject('not json'), null);
  assert.equal(extractJsonObject(''), null);
  assert.equal(extractJsonObject('{'), null);
});

test('parseContradiction: clean, coerced, clamped, junk', () => {
  const c = parseContradiction('{"contradicts":true,"severity":"high","issue":"i","quoteA":"always X","quoteB":"never X"}');
  assert.deepEqual(c, { contradicts: true, severity: 'high', issue: 'i', quoteA: 'always X', quoteB: 'never X' });
  assert.deepEqual(parseContradiction('{"contradicts":"true","severity":"weird","issue":"i"}'), { contradicts: true, severity: 'low', issue: 'i', quoteA: '', quoteB: '' });
  assert.deepEqual(parseContradiction('{"contradicts":false}'), { contradicts: false });
  assert.equal(parseContradiction('[fake-chat] nope'), null);
  assert.equal(parseContradiction('{"contradicts":true,"issue":"' + 'x'.repeat(300) + '"}').issue.length, 160);
});

test('quoteIsGrounded: substring, whitespace/case tolerant, min length', () => {
  assert.equal(quoteIsGrounded('You should always restart the node.', 'always restart the node'), true);
  assert.equal(quoteIsGrounded('always   RESTART\n the node', 'Always restart the node'), true);
  assert.equal(quoteIsGrounded('nothing here', 'always restart the node'), false);
  assert.equal(quoteIsGrounded('abcdefgh', 'abcdefgh'), false); // < 12 chars
});

test('buildGapDigest: both sections, dedupe, empty-task marker, budget clip', () => {
  const d = buildGapDigest(
    [{ title: 'Runbook X', documentType: 'runbook', verified: true }],
    [{ title: 'rotate certs' }, { title: 'Rotate Certs' }, { title: 'deploy' }],
  );
  assert.match(d, /EXISTING DOCUMENTS/);
  assert.match(d, /- Runbook X · runbook · verified/);
  assert.match(d, /OPEN-TASK THEMES/);
  assert.match(d, /- rotate certs/);
  assert.ok(!/- Rotate Certs/.test(d)); // case-insensitive dedupe
  assert.match(buildGapDigest([], []), /- \(no open tasks\)/);
  // deterministic
  assert.equal(buildGapDigest([{ title: 'X' }], [{ title: 'y' }]), buildGapDigest([{ title: 'X' }], [{ title: 'y' }]));
});

test('buildGapMessages frames the digest as JSON output', () => {
  const [sys, user] = buildGapMessages('DIGEST');
  assert.match(sys.content, /COVERAGE GAPS/);
  assert.match(user.content, /DIGEST/);
  assert.match(user.content, /JSON/);
});

test('parseGaps: object form, bare array, clamps, caps, junk', () => {
  assert.deepEqual(parseGaps('{"gaps":[{"topic":"Failover drills","rationale":"r","evidence":"e"}]}'), [{ topic: 'Failover drills', rationale: 'r', evidence: 'e' }]);
  assert.deepEqual(parseGaps('[{"topic":"Cache warming"},{"topic":""}]'), [{ topic: 'Cache warming', rationale: '', evidence: '' }]);
  assert.deepEqual(parseGaps('[fake-chat] hi'), []);
  assert.deepEqual(parseGaps('{"nope":1}'), []);
  const many = parseGaps(JSON.stringify({ gaps: Array.from({ length: 9 }, (_, i) => ({ topic: `g${i}` })) }));
  assert.equal(many.length, 5); // capped at GAP_MAX
});

test('extractJsonArray + clampStr basics', () => {
  assert.deepEqual(extractJsonArray('x [1,2,[3]] y'), [1, 2, [3]]);
  assert.equal(extractJsonArray('no array'), null);
  assert.equal(clampStr('  hi  ', 10), 'hi');
  assert.equal(clampStr(42, 10), '');
});

// ---- review-hardening regressions -----------------------------------------

test('extractor is string-aware: a brace/bracket inside a quote does not break parsing', () => {
  // a runbook quote routinely contains braces (kubectl -p '{...}') — must parse
  const t = JSON.stringify({ contradicts: true, severity: 'high', issue: 'i', quoteA: "patch -p '{\"spec\":1}'", quoteB: 'never' });
  const c = parseContradiction(t);
  assert.equal(c.contradicts, true);
  assert.equal(c.quoteA, "patch -p '{\"spec\":1}'");
  // bracket inside a gap rationale string
  assert.deepEqual(parseGaps('[{"topic":"logs","rationale":"ends with ]"}]'), [{ topic: 'logs', rationale: 'ends with ]', evidence: '' }]);
});

test('extractor finds trailing JSON after an unrelated code fence', () => {
  assert.deepEqual(extractJsonObject('see ```yaml\nfoo: 1\n``` then {"contradicts":false}'), { contradicts: false });
});

test('buildGapDigest reserves budget for tasks so a huge doc set cannot starve them', () => {
  const docs = Array.from({ length: 120 }, (_, i) => ({ title: `Document number ${i} with a long descriptive title here`, documentType: 'runbook', verified: true }));
  const d = buildGapDigest(docs, [{ title: 'rotate certs' }, { title: 'failover drill' }]);
  assert.match(d, /rotate certs/);
  assert.match(d, /failover drill/);
});
