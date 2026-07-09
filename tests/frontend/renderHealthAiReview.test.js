import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHealthHtml } from '../../public/js/renderHealth.js';

const baseHealth = { needsReview: [], empty: [], stale: [], orphans: [], counts: {} };
const base = (over = {}) => ({
  healthData: baseHealth, healthLinkSuggestions: [], healthLoading: false,
  chatStatus: { available: true }, healthAiReview: null, healthAiReviewLoading: false, healthAiReviewError: null,
  ...over,
});

test('AI review: idle shows the advisory intro + an enabled Scan button', () => {
  const html = renderHealthHtml(base());
  assert.match(html, /data-action="run-ai-review"/);
  assert.ok(!/data-action="run-ai-review"[^>]*disabled/.test(html)); // enabled when a model is available
  assert.match(html, /Advisory only/);
});

test('AI review: no model disables the Scan button and shows a Settings hint', () => {
  const html = renderHealthHtml(base({ chatStatus: { available: false } }));
  assert.match(html, /data-action="run-ai-review"[^>]*disabled/);
  assert.match(html, /No AI model configured/);
});

test('AI review: loading state', () => {
  const html = renderHealthHtml(base({ healthAiReviewLoading: true }));
  assert.match(html, /Reading the library for conflicts/);
  assert.match(html, /Scanning…/);
});

test('AI review: a result renders contradictions (both docs + quotes) and gaps', () => {
  const html = renderHealthHtml(base({
    healthAiReview: {
      model: 'claude-x', degraded: false,
      contradictions: [{
        severity: 'high', issue: 'restart vs never',
        a: { id: 'a', title: 'Runbook A', quote: 'Always restart the node.' },
        b: { id: 'b', title: 'Runbook B', quote: 'Never restart the node.' },
      }],
      gaps: [{ topic: 'Failover drills', rationale: 'implied by tasks', evidence: 'open work' }],
      contradictionScan: { ran: true, reason: null }, gapScan: { ran: true, reason: null },
    },
  }));
  assert.match(html, /Agent-generated · advisory · claude-x/);
  assert.match(html, /restart vs never/);
  assert.match(html, /Runbook A/);
  assert.match(html, /Runbook B/);
  assert.match(html, /Always restart the node\./);
  assert.match(html, /data-action="open-health-doc" data-doc-id="a"/);
  assert.match(html, /Failover drills/);
  assert.match(html, /implied by tasks/);
});

test('AI review: no-embedder result shows the gaps-only note', () => {
  const html = renderHealthHtml(base({
    healthAiReview: {
      model: 'm', degraded: true, contradictions: [], gaps: [],
      contradictionScan: { ran: false, reason: 'no-embedder' }, gapScan: { ran: true, reason: null },
    },
  }));
  assert.match(html, /needs semantic search/);
  assert.match(html, /No obvious coverage gaps/);
});

test('AI review: model output is HTML-escaped', () => {
  const html = renderHealthHtml(base({
    healthAiReview: {
      model: 'm', degraded: false,
      contradictions: [{ severity: 'low', issue: '<script>x</script>', a: { id: 'a', title: 'A', quote: '<b>q</b>' }, b: { id: 'b', title: 'B', quote: 'q2' } }],
      gaps: [], contradictionScan: { ran: true, reason: null }, gapScan: { ran: true, reason: null },
    },
  }));
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;q&lt;\/b&gt;/);
});

test('AI review: a crashed scan renders an error, NOT a green all-clear', () => {
  const html = renderHealthHtml(base({
    healthAiReview: {
      model: null, degraded: true, reason: 'ai-review-failed', contradictions: [], gaps: [],
      contradictionScan: { ran: false, degraded: true, reason: null }, gapScan: { ran: false, reason: null },
    },
  }));
  assert.match(html, /could not complete/i);
  assert.ok(!/No contradictions found/.test(html)); // must not read as "all clear"
  assert.ok(!/No obvious coverage gaps/.test(html));
});

test('AI review: an empty library says so, not a false all-clear', () => {
  const html = renderHealthHtml(base({
    healthAiReview: {
      model: 'm', degraded: false, reason: null, contradictions: [], gaps: [],
      contradictionScan: { ran: false, degraded: false, reason: 'empty' }, gapScan: { ran: false, reason: 'empty' },
    },
  }));
  assert.match(html, /No documents to scan yet/);
  assert.ok(!/No contradictions found/.test(html));
});
