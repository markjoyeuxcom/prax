import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBriefHtml } from '../../public/js/renderBrief.js';

test('brief overlay shows the prompt hint before a query runs', () => {
  const html = renderBriefHtml({ briefOpen: true, briefQuery: '', briefMarkdown: null });
  assert.match(html, /data-overlay="brief"[^>]*data-action="close-brief"/);
  assert.match(html, /data-brief-input/);
  assert.match(html, /data-action="run-brief"/);
  assert.match(html, /Ask about a system/);
  assert.doesNotMatch(html, /data-action="copy-brief"/); // nothing to copy yet
});

test('brief overlay shows a loading state and no copy button while gathering', () => {
  const html = renderBriefHtml({ briefOpen: true, briefQuery: 'postgres failover', briefLoading: true });
  assert.match(html, /Gathering the most relevant/);
  assert.doesNotMatch(html, /data-action="copy-brief"/);
});

test('brief overlay renders the returned markdown body and a copy button', () => {
  const html = renderBriefHtml(
    { briefOpen: true, briefQuery: 'failover', briefMarkdown: '# Brief' },
    { bodyHtml: '<h1>Brief</h1>' },
  );
  assert.match(html, /class="brief__result"/);
  assert.match(html, /<h1>Brief<\/h1>/);
  assert.match(html, /data-action="copy-brief"/);
});

test('brief overlay surfaces an error state', () => {
  const html = renderBriefHtml({ briefOpen: true, briefQuery: 'x', briefError: true });
  assert.match(html, /Could not build a brief/);
  assert.doesNotMatch(html, /data-action="copy-brief"/);
});

test('brief input keeps the query value and escapes it', () => {
  const html = renderBriefHtml({ briefOpen: true, briefQuery: '<script>', briefMarkdown: null });
  assert.match(html, /value="&lt;script&gt;"/);
  assert.doesNotMatch(html, /value="<script>"/);
});
