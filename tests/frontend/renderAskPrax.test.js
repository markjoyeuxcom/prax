import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAskPraxHtml } from '../../public/js/renderAskPrax.js';

test('idle state shows the hint and no copy button', () => {
  const html = renderAskPraxHtml({ askPraxOpen: true, askPraxQuery: '' }, {});
  assert.match(html, /data-overlay="askprax"/);
  assert.match(html, /data-ask-prax-input/);
  assert.match(html, /answers from your library and cites the sources/);
  assert.doesNotMatch(html, /copy-ask-prax/);
});

test('loading and error states', () => {
  assert.match(renderAskPraxHtml({ askPraxOpen: true, askPraxLoading: true }, {}), /writing an answer/);
  assert.match(renderAskPraxHtml({ askPraxOpen: true, askPraxError: true }, {}), /Could not get an answer/);
});

test('a generated answer renders the body, cited sources (verified vs not), model note, and copy', () => {
  const state = { askPraxOpen: true, askPraxResult: {
    answer: 'Promote the standby.', degraded: false, model: 'gemini-1.5-flash',
    sources: [{ title: 'Postgres failover', verified: true }, { title: 'Scratch', verified: false }],
  } };
  const html = renderAskPraxHtml(state, { bodyHtml: '<p>Promote the standby.</p>' });
  assert.match(html, /<p>Promote the standby\.<\/p>/);
  assert.match(html, /Postgres failover/);
  assert.match(html, /is-verified">Postgres failover/);
  assert.match(html, /Scratch · unverified/);
  assert.match(html, /Answered by gemini-1\.5-flash/);
  assert.match(html, /data-action="copy-ask-prax"/);
  assert.doesNotMatch(html, /No AI model is set/);   // not degraded
});

test('a degraded result shows the "no model" notice (or generation-failed) and still lists sources', () => {
  const noModel = renderAskPraxHtml({ askPraxOpen: true, askPraxResult: { answer: null, degraded: true, reason: 'no-chat-model', markdown: '# pack', sources: [{ title: 'Doc', verified: true }] } }, { bodyHtml: '<h1>pack</h1>' });
  assert.match(noModel, /No AI model is set/);
  assert.match(noModel, />Doc</);
  assert.doesNotMatch(noModel, /Answered by/);       // no model note when degraded

  const failed = renderAskPraxHtml({ askPraxOpen: true, askPraxResult: { answer: null, degraded: true, reason: 'generation-failed', markdown: '# pack', sources: [] } }, { bodyHtml: '<h1>pack</h1>' });
  assert.match(failed, /AI model failed to answer/);
});
