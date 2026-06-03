import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminPanelHtml } from '../../public/js/renderAdminPanel.js';

test('Maintenance section renders empty states by default', () => {
  const html = renderAdminPanelHtml({});
  assert.ok(html.includes('Library Maintenance'));
  assert.ok(html.includes('No stale documents'));
  assert.ok(html.includes('No orphan documents'));
});

test('Maintenance section renders stale rows', () => {
  const html = renderAdminPanelHtml({
    staleDocs: [
      { documentId: 'd1', title: 'Old summary', documentType: 'note', kind: 'synthesized', updatedBy: 'user', staleSources: [{ title: 'Source' }] },
    ],
  });
  assert.ok(html.includes('Old summary'));
  assert.ok(html.includes('Source'));
  assert.ok(html.match(/data-action="open-library-doc"[^>]*data-library-document-id="d1"/));
});

test('Maintenance section renders orphan rows', () => {
  const html = renderAdminPanelHtml({
    orphanDocs: [
      { documentId: 'd2', title: 'Sprint notes', documentType: 'note', kind: 'source' },
    ],
  });
  assert.ok(html.includes('Sprint notes'));
  assert.ok(html.match(/data-library-document-id="d2"/));
});
