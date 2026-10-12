import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAskPageHtml, renderCitedAnswer } from '../../public/js/renderAskPage.js';

const sources = [
  { id: 'd1', title: 'Backups go to MinIO, then B2', documentType: 'decision', verified: true },
  { id: 'd2', title: 'B2 auth fails with restricted keys', documentType: 'known-issue', verified: false, updatedBy: 'agent' },
  { id: 'd3', title: 'Uncited runbook', documentType: 'runbook', verified: true },
];

test('[Title] citations become numbered chips that carry trust; unknown brackets stay text', () => {
  const { html, cited } = renderCitedAnswer('Restores still work [backups go to minio, then b2]. The key is scoped [B2 auth fails with restricted keys]. Array [0].', sources);
  assert.deepEqual([...cited].sort(), [1, 2]);
  assert.match(html, /<span class="cite cite--verified" title="Backups go to MinIO, then B2 \(verified\)">1<\/span>/);
  assert.match(html, /<span class="cite cite--unverified"[^>]*>2<\/span>/);
  assert.match(html, /Array \[0\]/);
  assert.doesNotMatch(html, /⟦/);
});

test('the page shows the question, a cited answer, the sources rail and an unverified warning', () => {
  const html = renderAskPageHtml({
    askPraxQuery: 'why is B2 failing',
    askPraxResult: {
      query: 'why is B2 failing', answer: 'Because [B2 auth fails with restricted keys]. Local is fine [Backups go to MinIO, then B2].',
      degraded: false, sources, retrieval: { mode: 'semantic' }, model: 'qwen3:14b',
    },
    askHistory: [{ query: 'why is B2 failing', at: new Date().toISOString(), result: {} }, { query: '<b>older</b>', at: '2026-10-01T00:00:00Z', result: {} }],
  }, { projects: [{ id: 'p1', name: 'Homelab' }] });
  assert.match(html, /class="ask-q">why is B2 failing</);
  assert.match(html, /3 sources<\/span><span aria-hidden="true">·<\/span><span>searched by meaning<\/span><span aria-hidden="true">·<\/span><span>2 cited<\/span><span aria-hidden="true">·<\/span><span>qwen3:14b/);
  assert.match(html, /“B2 auth fails with restricted keys” is unverified memory/);
  assert.match(html, /data-action="open-ask-source" data-document-id="d2"/);
  assert.match(html, /class="ask-src ask-src--agent is-cited"/);
  assert.match(html, /class="ask-src"[^>]*data-document-id="d3"/, 'the uncited source is listed without the cited mark');
  assert.match(html, /1 searched, not cited\./);
  assert.match(html, /data-action="save-ask-note"/);
  assert.match(html, /class="ask-hist__item is-current" data-action="ask-history-open" data-index="0"/);
  assert.match(html, /&lt;b&gt;older&lt;\/b&gt;/);
  assert.match(html, /<option value="p1">Homelab<\/option>/);
  assert.match(html, /data-ask-prax-input/);
});

test('without a model the page shows the retrieved pack and says why; idle shows the intro', () => {
  const degraded = renderAskPageHtml({ askPraxQuery: 'x', askPraxResult: { query: 'x', answer: null, degraded: true, reason: 'no-chat-model', markdown: '# Pack\n\nSome context.', sources, retrieval: { mode: 'keyword' } } });
  assert.match(degraded, /No AI model is set/);
  assert.match(degraded, /Some context\./);
  assert.doesNotMatch(degraded, /save-ask-note/);
  const idle = renderAskPageHtml({});
  assert.match(idle, /<h1 class="ask-intro__title">Ask Prax<\/h1>/);
  assert.match(idle, /data-action="run-ask-prax" disabled/);
});
