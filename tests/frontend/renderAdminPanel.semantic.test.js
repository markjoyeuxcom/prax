import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminPanelHtml } from '../../public/js/renderAdminPanel.js';

test('semantic section shows unavailable status', () => {
  const html = renderAdminPanelHtml({ semanticStatus: { available: false } });
  assert.ok(html.includes('Semantic Search'));
  assert.ok(html.includes('unavailable'));
});

test('semantic section shows backend + counts + toggle + reindex when available', () => {
  const html = renderAdminPanelHtml({
    semanticStatus: { available: true, enabled: true, backend: 'ollama', connected: true, embeddedCount: 9, totalCount: 10 },
  });
  assert.ok(html.includes('ollama'));
  assert.ok(html.includes('9'));
  assert.ok(html.includes('10'));
  assert.ok(html.match(/data-action="toggle-semantic-search"/));
  assert.ok(html.match(/data-action="reindex-embeddings"/));
});
