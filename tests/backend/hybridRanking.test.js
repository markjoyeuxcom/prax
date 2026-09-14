// Hybrid ranking: fuse the vector ranking with the FTS ranking, then weight by
// trust. Pure functions — no database, no embedder.
//
// Two defects in pure-cosine ranking motivate this:
//   1. A document whose vector is missing or stale is INVISIBLE to semantic
//      search. Recall discloses that honestly ("index incomplete: N of M"), but
//      an honest miss is still a miss. Keyword rank re-admits those documents.
//   2. Cosine alone ranks a stale unverified guess exactly like a memory a
//      human blessed yesterday. Trust is recorded and then ignored by ranking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseHybrid, trustWeight, RRF_K, VERIFIED_BOOST, DECAY_FLOOR } from '../../server/hybridRanking.js';

const NOW = new Date('2026-09-11T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const doc = (id, extra = {}) => ({ id, title: id, updatedAt: daysAgo(1), verified: false, ...extra });

// --- trust weight -------------------------------------------------------------

test('verification boosts a document and arrests its decay', () => {
  const fresh = trustWeight(doc('a', { verified: true, updatedAt: daysAgo(1) }), { now: NOW });
  const ancient = trustWeight(doc('b', { verified: true, updatedAt: daysAgo(3000) }), { now: NOW });
  assert.ok(fresh > 1, 'a verified memory outranks an equally-similar unverified one');
  assert.equal(fresh, ancient, 'a human blessing does not expire on a timer');
});

test('an unverified memory decays halfway to the floor over the configured half-life, never below it', () => {
  const now0 = trustWeight(doc('a', { updatedAt: daysAgo(0) }), { now: NOW, unverifiedHalfLifeDays: 100 });
  const half = trustWeight(doc('b', { updatedAt: daysAgo(100) }), { now: NOW, unverifiedHalfLifeDays: 100 });
  const ancient = trustWeight(doc('c', { updatedAt: daysAgo(100000) }), { now: NOW, unverifiedHalfLifeDays: 100 });
  assert.ok(Math.abs(now0 - 1) < 1e-9);
  assert.ok(Math.abs(half - (DECAY_FLOOR + (1 - DECAY_FLOOR) / 2)) < 1e-9);
  assert.ok(ancient >= DECAY_FLOOR && ancient < half, 'decay is bounded: age alone cannot bury a memory');
});

// The weights are sized against RRF's narrow score band. These pin the
// magnitude, because the equal-rank tests above would pass for ANY boost.
test('trust re-orders near-ties only: a year-old unverified top hit stays near the top', () => {
  const semantic = [doc('old-top', { updatedAt: daysAgo(365) })];
  for (let i = 2; i <= 60; i += 1) semantic.push(doc(`fresh-${i}`, { updatedAt: daysAgo(0) }));
  const fused = fuseHybrid({ semantic }, { now: NOW });
  const position = fused.findIndex((d) => d.id === 'old-top') + 1;
  assert.ok(position <= 6, `a year-old cosine-rank-1 hit fused to position ${position}; it must not sink out of sight`);
  assert.ok(position > 1, 'age still costs something, or the decay is inert');
});

test('a verified memory cannot leapfrog a much better unverified match', () => {
  const semantic = [];
  for (let i = 1; i <= 20; i += 1) semantic.push(doc(`u-${i}`, { updatedAt: daysAgo(0) }));
  semantic[15] = doc('verified-16', { verified: true });
  const fused = fuseHybrid({ semantic }, { now: NOW });
  const position = fused.findIndex((d) => d.id === 'verified-16') + 1;
  assert.equal(fused[0].id, 'u-1', 'the best cosine match keeps first place');
  assert.ok(position >= 12 && position <= 15, `verification moved rank 16 to ${position}: a few places, not to the top`);
  assert.ok(VERIFIED_BOOST > 1 && VERIFIED_BOOST <= 1.1, 'the boost is a nudge');
});

test('an undated document is neither boosted nor decayed', () => {
  assert.equal(trustWeight({ id: 'x', updatedAt: null, verified: false }, { now: NOW }), 1);
});

// --- fusion -------------------------------------------------------------------

test('a document found by BOTH rankings outranks one found by either alone', () => {
  const both = doc('both');
  const vecOnly = doc('vec');
  const kwOnly = doc('kw');
  const fused = fuseHybrid(
    { semantic: [vecOnly, both], keyword: [kwOnly, both] },
    { now: NOW },
  );
  assert.equal(fused[0].id, 'both');
});

test('a document with NO usable vector is still retrievable by keyword rank', () => {
  // The exact case recall currently discloses and cannot serve: pending vector.
  const unembedded = doc('pending');
  const fused = fuseHybrid({ semantic: [], keyword: [unembedded] }, { now: NOW });
  assert.deepEqual(fused.map((d) => d.id), ['pending']);
  assert.equal(fused[0].match.semanticRank, null);
  assert.equal(fused[0].match.keywordRank, 1);
});

test('at equal rank, a verified memory beats an unverified one', () => {
  const unver = doc('unverified-doc');
  const ver = doc('verified-doc', { verified: true });
  const fused = fuseHybrid({ semantic: [unver, ver], keyword: [] }, { now: NOW });
  assert.equal(fused[0].id, 'verified-doc', 'the trust weight overturns a one-place cosine lead');
});

test('at equal rank, a fresh unverified memory beats a year-old one', () => {
  const old = doc('old', { updatedAt: daysAgo(700) });
  const fresh = doc('fresh', { updatedAt: daysAgo(1) });
  const fused = fuseHybrid({ semantic: [old, fresh], keyword: [] }, { now: NOW });
  assert.equal(fused[0].id, 'fresh');
});

test('fusion explains itself: every hit reports both ranks and its final score', () => {
  const d = doc('a', { similarity: 0.83 });
  const [hit] = fuseHybrid({ semantic: [d], keyword: [d] }, { now: NOW });
  assert.equal(hit.match.semanticRank, 1);
  assert.equal(hit.match.keywordRank, 1);
  assert.ok(Math.abs(hit.match.rrf - 2 / (RRF_K + 1)) < 1e-12);
  assert.ok(hit.match.score > 0);
  assert.equal(hit.similarity, 0.83, 'cosine is preserved for display');
});

test('fusion is deterministic when scores tie', () => {
  const a = doc('a');
  const b = doc('b');
  const once = fuseHybrid({ semantic: [a, b], keyword: [b, a] }, { now: NOW }).map((d) => d.id);
  const twice = fuseHybrid({ semantic: [a, b], keyword: [b, a] }, { now: NOW }).map((d) => d.id);
  assert.deepEqual(once, twice);
});

test('a document appearing twice in one ranking keeps its best rank only', () => {
  const a = doc('a');
  const fused = fuseHybrid({ semantic: [a, a], keyword: [] }, { now: NOW });
  assert.equal(fused.length, 1);
  assert.equal(fused[0].match.semanticRank, 1);
});

test('trust weighting can be turned off for a caller that wants raw fusion', () => {
  const old = doc('old', { updatedAt: daysAgo(700) });
  const fresh = doc('fresh', { updatedAt: daysAgo(1) });
  const fused = fuseHybrid({ semantic: [old, fresh], keyword: [] }, { now: NOW, trust: false });
  assert.equal(fused[0].id, 'old', 'without trust weighting, cosine order stands');
});
