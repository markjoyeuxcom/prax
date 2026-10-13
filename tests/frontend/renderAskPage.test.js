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
  assert.match(html, /<button type="button" class="cite cite--verified" data-action="ask-cite" data-source="1" aria-label="Source 1: Backups go to MinIO, then B2 \(verified\)" title="Backups go to MinIO, then B2 \(verified\)">1<\/button>/);
  assert.match(html, /<button type="button" class="cite cite--unverified"[^>]*>2<\/button>/);
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
  assert.match(html, /class="ask-hist__row is-current"><button type="button" class="ask-hist__item" data-action="ask-history-open" data-index="0"/);
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

test('no sources: the notice says it was a keyword search; no pack debris, no copy button', () => {
  const html = renderAskPageHtml({ askPraxResult: { query: 'how do we fail over postgres', answer: null, degraded: true, reason: 'no-sources', markdown: '# Context: Library\n\n_Query: x_', sources: [], retrieval: { mode: 'keyword' } } });
  assert.match(html, /Nothing in your library matches this question/);
  assert.match(html, /This was a keyword search/);
  assert.doesNotMatch(html, /Context: Library/);
  assert.doesNotMatch(html, /copy-ask-prax/);
  const semantic = renderAskPageHtml({ askPraxResult: { query: 'q', answer: null, degraded: true, reason: 'no-sources', markdown: '', sources: [], retrieval: { mode: 'semantic' } } });
  assert.doesNotMatch(semantic, /This was a keyword search/);
});

test('a failed ask keeps the question and offers a retry; coverage notices are shown', () => {
  const failed = renderAskPageHtml({ askPraxQuery: 'why', askPraxError: true });
  assert.match(failed, /<div class="ask-q">why<\/div>/);
  assert.match(failed, /data-action="ask-retry">Try again</);
  const sources = [{ id: 's1', title: 'A', documentType: 'note', verified: true }];
  const html = renderAskPageHtml({ askPraxResult: { query: 'q', answer: 'See [A].', degraded: false, sources, retrieval: { mode: 'keyword', fallback: true, reason: 'semantic-no-match', hiddenHarvested: 2, hiddenUnverified: 1, trust: 'verified' } } });
  assert.match(html, /2 unreviewed harvested candidates were left out/);
  assert.match(html, /1 unverified document was left out \(Verified only\)/);
  const capped = renderAskPageHtml({ askPraxResult: { query: 'q', answer: 'See [A].', degraded: false, sources, retrieval: { mode: 'semantic', fallback: false, hiddenUnverified: 50, hiddenUnverifiedCapped: true, trust: 'verified' } } });
  assert.match(capped, /At least 50 unverified documents were left out/);
  const unavailable = renderAskPageHtml({ askPraxResult: { query: 'q', answer: 'See [A].', degraded: false, sources, retrieval: { mode: 'semantic', fallback: false, hiddenUnverified: null, trust: 'verified' } } });
  assert.match(unavailable, /may have been left out \(Verified only\): their count was unavailable/);
  const legacy = renderAskPageHtml({ askPraxResult: { query: 'q', answer: 'See [A].', degraded: false, at: '2026-10-01T10:00:00.000Z', sources: [{ ...sources[0], changed: 'unknown' }], retrieval: { mode: 'keyword' } } });
  assert.match(legacy, /edits since this answer unknown/);
  assert.match(legacy, /1 source cannot be checked for edits: this answer predates revision tracking/);
  assert.doesNotMatch(legacy, /has changed since/);
  assert.match(html, /Semantic search found nothing relevant, so this used keyword search/);
});

test('a reopened answer is dated, and a source that changed or vanished since says so', () => {
  const sources = [
    { id: 's1', title: 'Runbook', documentType: 'runbook', verified: false, changed: 'trust' },
    { id: 's2', title: 'Gone', documentType: 'note', verified: true, missing: true },
  ];
  const html = renderAskPageHtml({ askPraxResult: { query: 'q', at: '2026-10-01T10:00:00Z', answer: 'Do [Runbook].', degraded: false, sources, retrieval: { mode: 'keyword' } } });
  assert.match(html, /Answered .* from the library as it was then\. 2 sources have changed since\./);
  assert.match(html, /data-action="ask-retry">Ask again</);
  assert.match(html, /trust changed since this answer/);
  assert.match(html, /no longer in the library/);
  assert.match(html, /data-source-n="2"[^>]*disabled/);
});

test('suggestions: the destination is the answer\'s scope, failure is not "no tasks", created rows stay visible', () => {
  const projects = [{ id: 'p1', name: 'Homelab' }, { id: 'p2', name: 'Work' }];
  const base = { askScope: 'p2', chatStatus: { available: true }, askPraxResult: { query: 'q', scope: 'p1', answer: 'A [S].', degraded: false, sources: [{ id: 's', title: 'S', verified: true }], retrieval: { mode: 'keyword' } } };
  const tasks = [{ title: 'One', priority: 'medium', sourceTitle: 'S' }, { title: 'Two', priority: 'low', sourceTitle: 'S' }];
  const unticked = renderAskPageHtml({ ...base, askSuggest: { loading: false, tasks, checked: [false, false], done: [false, false], created: null } }, { projects });
  assert.match(unticked, /Suggested tasks · Homelab/, 'the answer was asked under Homelab, whatever the composer shows now');
  assert.match(unticked, /class="btn-ghost ask-tasks__create" data-action="ask-create-tasks" disabled>Create tasks</);
  assert.match(unticked, /nothing is created until you choose/);
  const degraded = renderAskPageHtml({ ...base, askSuggest: { loading: false, tasks: [], checked: [], created: null, degraded: true, reason: 'generation-failed', error: 'The model could not suggest tasks.' } }, { projects });
  assert.match(degraded, /The model could not suggest tasks\./);
  assert.match(degraded, /data-action="ask-suggest-tasks">Try again</);
  assert.doesNotMatch(degraded, /Nothing in this answer calls for a task/);
  const partial = renderAskPageHtml({ ...base, askSuggest: { loading: false, tasks, checked: [true, false], done: [true, false], created: null, createdIn: 'Homelab' } }, { projects });
  assert.match(partial, /✓ created in Homelab/);
  assert.match(partial, /data-index="0"[^>]*disabled/);
  assert.match(partial, /data-action="ask-create-tasks" disabled>Create tasks</, 'the created row no longer counts; nothing else is ticked');
});

test('history rows carry the scope and trust an answer was asked under, and flag empty answers', () => {
  const projects = [{ id: 'p1', name: 'Homelab' }];
  const html = renderAskPageHtml({ askHistory: [
    { query: 'a', at: '2026-10-01T10:00:00Z', scope: 'p1', trust: 'verified', result: { degraded: false } },
    { query: 'b', at: '2026-10-01T10:00:00Z', scope: 'all', result: { degraded: true, reason: 'no-sources' } },
  ] }, { projects });
  assert.match(html, /Homelab · verified only/);
  assert.match(html, /ask-hist__item--empty[^>]*>.*?b.*?no answer/s);
});

test('the assistant link names the hand-off once there is an answer to act on', () => {
  const idle = renderAskPageHtml({});
  assert.match(idle, /data-action="open-assistant"[^>]*>Use the assistant</);
  const answered = renderAskPageHtml({ askPraxResult: { query: 'q', answer: 'A [S].', degraded: false, sources: [{ id: 's', title: 'S', verified: true }], retrieval: { mode: 'keyword' } } });
  assert.match(answered, /data-action="ask-to-assistant"[^>]*title="Give the assistant this question and its sources to act on[^"]*"[^>]*>Act on this with the assistant</);
  assert.doesNotMatch(answered, /data-action="open-assistant"/);
});

test('earlier questions are compact: the recent few, grouped by day, each forgettable, with Show all and Clear', () => {
  const now = new Date('2026-10-13T12:00:00');
  const entry = (n, at) => ({ query: `question ${n} ${'x'.repeat(120)}`, at, scope: 'all', result: { degraded: false } });
  const history = [entry(1, '2026-10-13T10:00:00'), entry(2, '2026-10-12T10:00:00'), ...Array.from({ length: 8 }, (_, i) => entry(3 + i, '2026-10-01T10:00:00'))];
  const html = renderAskPageHtml({ askHistory: history, askHistoryOpen: true }, { now });
  assert.match(html, /data-action="ask-history-toggle" aria-expanded="true"/);
  assert.match(html, /ask-hist__count">10</);
  assert.equal((html.match(/data-action="ask-history-open"/g) || []).length, 6, 'only the recent few show');
  assert.match(html, /ask-hist__group[^>]*>Today<.*ask-hist__group[^>]*>Yesterday<.*ask-hist__group[^>]*>Earlier</s);
  assert.match(html, /data-action="ask-history-remove" data-index="0" aria-label="Forget “question 1/);
  assert.match(html, /data-action="ask-history-show-all">Show all 10</);
  assert.match(html, /data-action="ask-history-clear">Clear history</);
  const all = renderAskPageHtml({ askHistory: history, askHistoryOpen: true, askHistoryShowAll: true }, { now });
  assert.equal((all.match(/data-action="ask-history-open"/g) || []).length, 10);
  assert.match(all, /data-action="ask-history-show-recent">Show recent</);
  const closed = renderAskPageHtml({ askHistory: history, askHistoryOpen: false }, { now });
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /data-action="ask-history-open"/);
  assert.match(renderAskPageHtml({ askHistory: [] }), /ask-hist__empty/);
});
