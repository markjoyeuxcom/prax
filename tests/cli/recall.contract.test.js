// The recall CONTRACT: what a hit must tell the agent beyond its text.
//
// Prax stores a rich trust model (verified, lifecycle, human-vs-agent origin,
// which agent, when). Before this, formatRecall() surfaced only
// verified/unverified plus a non-active status — so an agent could not tell a
// four-month-old synthesized guess from a note a human blessed yesterday. The
// judgment was recorded and then withheld from the only reader that acts on it.
// These tests pin the fuller contract: trust, AGE and WRITER on every hit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRecall, trustLabel, ageLabel, writerLabel } from '../../cli/lib/recall.js';

const NOW = new Date('2026-09-11T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

// --- age --------------------------------------------------------------------

test('ageLabel renders a coarse, honest age and says nothing when undated', () => {
  assert.equal(ageLabel(daysAgo(0), NOW), 'today');
  assert.equal(ageLabel(daysAgo(1), NOW), '1d old');
  assert.equal(ageLabel(daysAgo(29), NOW), '29d old');
  assert.equal(ageLabel(daysAgo(45), NOW), '1mo old');
  assert.equal(ageLabel(daysAgo(400), NOW), '1y old');
  assert.equal(ageLabel(null, NOW), '');
  assert.equal(ageLabel('not-a-date', NOW), '');
});

test('ageLabel never reports a negative age from a clock-skewed future stamp', () => {
  const future = new Date(NOW.getTime() + 86400000).toISOString();
  assert.equal(ageLabel(future, NOW), 'today');
});

// --- writer -----------------------------------------------------------------

test('writerLabel distinguishes a human, a named agent and an anonymous agent', () => {
  assert.equal(writerLabel({ updatedBy: 'user' }), 'human-written');
  assert.equal(writerLabel({ updatedBy: 'agent', updatedByAgent: 'codex' }), 'via codex');
  assert.equal(writerLabel({ updatedBy: 'agent', updatedByAgent: null }), 'via an unnamed agent');
  assert.equal(writerLabel({}), '');
});

// --- the composed label -----------------------------------------------------

test('trustLabel carries verification, age and writer together', () => {
  const label = trustLabel(
    { verified: false, status: 'active', updatedAt: daysAgo(5), updatedBy: 'agent', updatedByAgent: 'codex' },
    NOW,
  );
  assert.equal(label, 'unverified · 5d old · via codex');
});

test('trustLabel names who verified a memory, so the blessing is attributable', () => {
  const label = trustLabel(
    { verified: true, verifiedBy: 'mark', status: 'active', updatedAt: daysAgo(2), updatedBy: 'user' },
    NOW,
  );
  assert.equal(label, 'verified by mark · 2d old · human-written');
});

test('trustLabel still leads with a non-active lifecycle status', () => {
  const label = trustLabel({ verified: false, status: 'superseded', updatedAt: daysAgo(3) }, NOW);
  assert.match(label, /^unverified, superseded · 3d old$/);
});

// --- the rendered block -----------------------------------------------------

test('formatRecall puts age and writer in the hit header', () => {
  const out = formatRecall({
    kind: 'hit',
    note: null,
    top: {
      id: 't', title: 'Standalone documents are valid', documentType: 'decision',
      body: 'b', verified: false, status: 'active',
      updatedAt: daysAgo(9), updatedBy: 'agent', updatedByAgent: 'codex',
    },
    related: [],
  }, NOW);
  assert.match(out, /## Standalone documents are valid {2}\(decision · t · unverified · 9d old · via codex\)/);
});

test('related hits carry their own trust and a snippet, not just a title and id', () => {
  const out = formatRecall({
    kind: 'hit',
    note: null,
    top: { id: 't', title: 'Top', documentType: 'note', body: 'b', verified: true, verifiedBy: 'mark', updatedAt: daysAgo(1), updatedBy: 'user' },
    related: [{
      id: 'r1', title: 'R1', verified: false, updatedAt: daysAgo(120),
      updatedBy: 'agent', updatedByAgent: 'claude',
      snippet: 'The homelab Postgres runs CloudNativePG with a two-node cluster',
    }],
  }, NOW);
  assert.match(out, /- R1 — r1 \(unverified · 4mo old · via claude\) — The homelab Postgres runs CloudNativePG/);
});

// --- fusion provenance ---------------------------------------------------------
//
// A hit that only the keyword ranking found has no semantic support: the query's
// meaning did not match it, its words did. That is often right (an error code, a
// version token) and sometimes noise. Recall says which, rather than presenting
// both with equal confidence — the same honesty the index-coverage note applies
// to a miss.

test('a keyword-only hit is labelled as such', () => {
  const label = trustLabel({
    verified: false, updatedAt: daysAgo(2), updatedBy: 'agent', updatedByAgent: 'codex',
    match: { semanticRank: null, keywordRank: 1 },
  }, NOW);
  assert.equal(label, 'unverified · 2d old · via codex · keyword-only');
});

test('a hit both rankings found carries no keyword-only caveat', () => {
  const label = trustLabel({
    verified: false, updatedAt: daysAgo(2), match: { semanticRank: 1, keywordRank: 1 },
  }, NOW);
  assert.equal(label, 'unverified · 2d old');
});

test('a hit from the pure-cosine path is unaffected', () => {
  assert.equal(trustLabel({ verified: false, updatedAt: daysAgo(2) }, NOW), 'unverified · 2d old');
});
