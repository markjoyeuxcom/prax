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
  assert.match(html, /<textarea[^>]*data-ask-page-input/);
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

test('the composer is its own draft: asking clears it while the thread keeps the question', () => {
  const html = renderAskPageHtml({ askPraxQuery: 'why is B2 failing', askDraft: '', askPraxLoading: true });
  assert.match(html, /<div class="ask-q">why is B2 failing<\/div>/);
  assert.match(html, /data-ask-page-input[^>]*><\/textarea>/);
  assert.match(html, /data-action="run-ask-prax" disabled/);
  const drafting = renderAskPageHtml({ askDraft: 'line one\nline two' });
  assert.match(drafting, /rows="2"[^>]*>line one\nline two<\/textarea>/);
  assert.doesNotMatch(drafting, /data-action="run-ask-prax" disabled/);
});

test('composer chips: scope with its colour, trust toggle, and the model', () => {
  const html = renderAskPageHtml({ askScope: 'p1', askTrust: 'verified', chatStatus: { available: true, backend: 'ollama', model: 'qwen3:14b' } },
    { projects: [{ id: 'p1', name: 'Homelab', color: '#6CC4E8' }] });
  assert.match(html, /ask-chip__dot" style="background:#6CC4E8"/);
  assert.match(html, /data-action="toggle-ask-trust" aria-pressed="true"[^>]*>✓ Verified only/);
  assert.match(html, /data-action="open-ai-settings"[^>]*>ollama · qwen3:14b/);
  const none = renderAskPageHtml({ chatStatus: { available: false } });
  assert.match(none, /Verified \+ unverified/);
  assert.match(none, />No AI model</);
});

test('suggested tasks render as ticked proposals with one create action', () => {
  const sources = [{ id: 's1', title: 'B2 app key scopes', documentType: 'known-issue', verified: false }];
  const base = {
    askScope: 'p1', chatStatus: { available: true },
    askPraxResult: { query: 'q', answer: 'Recreate it [B2 app key scopes].', degraded: false, sources, retrieval: { mode: 'semantic' } },
  };
  const projects = [{ id: 'p1', name: 'Homelab' }];
  const loading = renderAskPageHtml({ ...base, askSuggest: { loading: true, tasks: [], checked: [] } }, { projects });
  assert.match(loading, /Suggesting follow-up tasks/);
  const tasks = [
    { title: 'Recreate the B2 key', priority: 'high', dueDate: '2026-10-13', sourceTitle: 'B2 app key scopes' },
    { title: 'Snapshot etcd', priority: 'medium', dueDate: null, sourceTitle: 'B2 app key scopes' },
  ];
  const html = renderAskPageHtml({ ...base, askSuggest: { loading: false, tasks, checked: [true, false], created: null } }, { projects, today: '2026-10-13' });
  assert.match(html, /Suggested tasks · Homelab/);
  assert.match(html, /role="checkbox" aria-checked="true"[^>]*>.*Recreate the B2 key.*high · today/s);
  assert.match(html, /ask-task__meta is-hot/);
  assert.match(html, /data-action="ask-create-tasks">Create 1 task</);
  assert.match(html, /Review it now/); // one unverified cited source → straight to it
  const done = renderAskPageHtml({ ...base, askSuggest: { loading: false, tasks, checked: [true, true], created: 2 } }, { projects });
  assert.match(done, /✓ Created 2 tasks in Homelab/);
  assert.doesNotMatch(done, /ask-create-tasks/);
  const offer = renderAskPageHtml({ ...base, askSuggest: null }, { projects });
  assert.match(offer, /data-action="ask-suggest-tasks"/);
});

test('no matching documents says so instead of answering', () => {
  const html = renderAskPageHtml({ askPraxResult: { query: 'hello', answer: null, degraded: true, reason: 'no-sources', markdown: '', sources: [], retrieval: { mode: 'keyword' } } });
  assert.match(html, /Nothing in your library matches this question/);
});
