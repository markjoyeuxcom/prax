import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminPanelHtml } from '../../public/js/renderAdminPanel.js';

test('renderAdminPanelHtml renders backup import and archive sections', () => {
  const html = renderAdminPanelHtml({
    activeContext: 'homelab',
    taskCount: 3,
    importMode: 'skip',
  });

  assert.match(html, /Admin Operations/);
  assert.match(html, /Moomora Console context/);
  assert.match(html, /Backup/);
  assert.match(html, /Restore \/ Import/);
  assert.match(html, /Archive Maintenance/);
  assert.match(html, /data-action="export-context"/);
  assert.match(html, /data-action="export-all"/);
  assert.match(html, /data-admin-import-mode="skip"/);
  assert.match(html, /data-admin-import-mode="append"/);
  assert.match(html, /data-admin-import-mode="replace"/);
  assert.match(html, /data-admin-replace-confirm/);
  assert.match(html, /data-admin-import-file/);
  assert.doesNotMatch(html, /data-admin-markdown-file/);
  assert.match(html, /data-action="open-archive"/);
  assert.match(html, /Homelab/);
  assert.match(html, /3 loaded tasks/);
});

test('renderAdminPanelHtml marks selected import mode', () => {
  const html = renderAdminPanelHtml({
    activeContext: 'work',
    taskCount: 0,
    importMode: 'replace',
  });

  assert.match(html, /value="replace"[^>]*checked/);
  assert.doesNotMatch(html, /value="skip"[^>]*checked/);
});

test('admin radio group uses glyph indicators not visible native radios', () => {
  const html = renderAdminPanelHtml({ activeContext: 'homelab', taskCount: 3, importMode: 'skip' });
  assert.match(html, /data-action="open-archive"[^>]*>\[a\] open archive/i);
  assert.match(html, /class="radio-glyph[^"]*is-active"[^>]*>\(•\)/);
  assert.match(html, /class="radio-glyph"[^>]*>\( \)/);
});

test('admin export buttons use bracket-style for selected context and all-contexts', () => {
  const html = renderAdminPanelHtml({ activeContext: 'homelab', taskCount: 5, importMode: 'skip' });
  assert.match(html, /data-action="export-context"[^>]*>\[x\] export/i);
  assert.match(html, /data-action="export-all"[^>]*>\[X\] export all/i);
});

test('admin panel renders both desktop and mobile modal headers', () => {
  const html = renderAdminPanelHtml({ activeContext: 'homelab', taskCount: 0, importMode: 'skip' });
  assert.match(html, /class="modal-header--desktop"/);
  assert.match(html, /class="modal-header--mobile"/);
});
