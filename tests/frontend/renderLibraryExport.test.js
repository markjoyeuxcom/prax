import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLibraryExportHtml } from '../../public/js/renderLibraryExport.js';

const PROJECTS = [
  { id: 'p1', slug: 'homelab', name: 'Homelab' },
  { id: 'p2', slug: 'work', name: 'Work & Ops' },
];

function render(overrides = {}, mode = 'browser-picker') {
  return renderLibraryExportHtml({
    libraryExportOpen: true,
    libraryExportScope: 'work',
    libraryExportFilename: 'prax-library-work-2026-07-13.zip',
    libraryExportPending: false,
    libraryExportError: '',
    ...overrides,
  }, PROJECTS, mode);
}

test('closed export dialog renders nothing', () => {
  assert.equal(renderLibraryExportHtml({ libraryExportOpen: false }, PROJECTS), '');
});

test('dialog exposes all and project scopes with a stable filename preview', () => {
  const html = render();
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="library-export-title"/);
  assert.match(html, /<h2 id="library-export-title">Export Library<\/h2>/);
  assert.match(html, /<option value="all">Entire library<\/option>/);
  assert.match(html, /<option value="work" selected>Work &amp; Ops<\/option>/);
  assert.match(html, /data-library-export-filename>prax-library-work-2026-07-13\.zip<\/code>/);
  assert.match(html, /active documents only/);
  assert.match(html, /not a full database backup/);
});

test('real picker modes promise a location chooser', () => {
  const browser = render({}, 'browser-picker');
  assert.match(browser, /Browser Save dialog/);
  assert.match(browser, /Choose any permitted folder/);
  assert.match(browser, /data-action="submit-library-export"[^>]*>Choose location &amp; export<\/button>/);

  const desktop = render({}, 'desktop');
  assert.match(desktop, /Operating-system Save dialog/);
  assert.match(desktop, /Choose any folder/);
  assert.match(desktop, /Choose location &amp; export/);
});

test('unsupported browsers get honest Downloads behavior and action text', () => {
  const html = render({}, 'download');
  assert.match(html, /Browser Downloads location/);
  assert.match(html, /cannot choose folders from Prax/);
  assert.match(html, /Ask where to save/);
  assert.match(html, /data-action="submit-library-export"[^>]*>Download ZIP<\/button>/);
});

test('pending state is announced and locks every dismissal and mutation control', () => {
  const html = render({ libraryExportPending: true });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-library-export-scope disabled/);
  assert.match(html, /aria-label="Close Library export" disabled/);
  assert.match(html, /data-action="close-library-export" disabled>Cancel/);
  assert.match(html, /data-action="submit-library-export" disabled>Exporting…/);
  assert.match(html, /role="status">Preparing and writing the archive/);
});

test('error is escaped and announced without hiding retry controls', () => {
  const html = render({ libraryExportError: '<script>disk full</script>' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /role="alert">&lt;script&gt;disk full&lt;\/script&gt;/);
  assert.doesNotMatch(html, /submit-library-export" disabled/);
});

test('invalid retained project scope falls back visibly to all', () => {
  const html = render({ libraryExportScope: 'removed' });
  assert.match(html, /<option value="all" selected>Entire library<\/option>/);
  assert.doesNotMatch(html, /value="work" selected/);
});
