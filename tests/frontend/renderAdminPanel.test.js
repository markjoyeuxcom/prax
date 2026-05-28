import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminPanelHtml } from '../../public/js/renderAdminPanel.js';

const TEST_PROJECTS = [
  { id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' },
  { id: 'p2', name: 'Work', slug: 'work', status: 'active' },
];

test('renderAdminPanelHtml renders backup import and archive sections', () => {
  const html = renderAdminPanelHtml({
    activeProject: 'p1',
    projects: TEST_PROJECTS,
    taskCount: 3,
    importMode: 'skip',
  });

  assert.match(html, /Admin Operations/);
  assert.match(html, /Backup/);
  assert.match(html, /Restore \/ Import/);
  assert.match(html, /Archive Maintenance/);
  assert.match(html, /data-action="export-project"/);
  assert.match(html, /data-action="export-all"/);
  assert.doesNotMatch(html, /data-action="export-context"/);
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
    activeProject: 'p2',
    projects: TEST_PROJECTS,
    taskCount: 0,
    importMode: 'replace',
  });

  assert.match(html, /value="replace"[^>]*checked/);
  assert.doesNotMatch(html, /value="skip"[^>]*checked/);
});

test('admin radio group uses glyph indicators not visible native radios', () => {
  const html = renderAdminPanelHtml({ activeProject: 'p1', projects: TEST_PROJECTS, taskCount: 3, importMode: 'skip' });
  assert.match(html, /data-action="open-archive"[^>]*>\[a\] open archive/i);
  assert.match(html, /class="radio-glyph[^"]*is-active"[^>]*>\(•\)/);
  assert.match(html, /class="radio-glyph"[^>]*>\( \)/);
});

test('admin export buttons use bracket-style for selected project and all-projects', () => {
  const html = renderAdminPanelHtml({ activeProject: 'p1', projects: TEST_PROJECTS, taskCount: 5, importMode: 'skip' });
  assert.match(html, /data-action="export-project"[^>]*>\[x\] export/i);
  assert.match(html, /data-action="export-all"[^>]*>\[X\] export all/i);
});

test('admin panel uses active project name in labels', () => {
  const html = renderAdminPanelHtml({ activeProject: 'p1', projects: TEST_PROJECTS, taskCount: 2, importMode: 'skip' });
  assert.match(html, /Homelab/);
});

test('admin panel shows all projects label when activeProject is all', () => {
  const html = renderAdminPanelHtml({ activeProject: 'all', projects: TEST_PROJECTS, taskCount: 0, importMode: 'skip' });
  assert.match(html, /all projects/i);
});

test('admin panel renders both desktop and mobile modal headers', () => {
  const html = renderAdminPanelHtml({ activeProject: 'p1', projects: TEST_PROJECTS, taskCount: 0, importMode: 'skip' });
  assert.match(html, /class="modal-header--desktop"/);
  assert.match(html, /class="modal-header--mobile"/);
});

test('admin panel renders a Library section with per-project and all-projects export buttons', () => {
  const html = renderAdminPanelHtml({
    activeProject: 'p1',
    projects: TEST_PROJECTS,
    taskCount: 0,
    documentCount: 4,
    importMode: 'skip',
  });
  assert.match(html, /Library/);
  assert.match(html, /4 documents/);
  assert.match(html, /data-action="export-library-project"[^>]*>\[x\] export Homelab/);
  assert.match(html, /data-action="export-library-all"[^>]*>\[X\] export all/);
});

test('admin panel Library section uses "all projects" label when activeProject is all', () => {
  const html = renderAdminPanelHtml({
    activeProject: 'all',
    projects: TEST_PROJECTS,
    taskCount: 0,
    documentCount: 0,
    importMode: 'skip',
  });
  assert.match(html, /data-action="export-library-project"[^>]*>\[x\] export all projects/);
});
