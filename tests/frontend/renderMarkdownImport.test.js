import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownImportHtml } from '../../public/js/renderMarkdownImport.js';

const PROJECTS = [
  { id: 'p1', name: 'Inbox' },
  { id: 'p2', name: 'Work & Ops' },
];

function render(overrides = {}, projects = PROJECTS) {
  return renderMarkdownImportHtml({
    markdownImportOpen: true,
    markdownImportProjectId: 'p2',
    markdownImportFiles: [],
    markdownImportPending: false,
    markdownImportError: '',
    markdownImportNotice: '',
    ...overrides,
  }, projects);
}

test('closed Markdown intake renders no dialog', () => {
  assert.equal(render({ markdownImportOpen: false }), '');
});

test('dialog makes destination, file choice, and limited plain-intake semantics explicit', () => {
  const html = render();
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="markdown-import-title"/);
  assert.match(html, /<h2 id="markdown-import-title">Import Markdown<\/h2>/);
  assert.match(html, /data-markdown-import-project/);
  assert.match(html, /value="p1">Inbox<\/option>/);
  assert.match(html, /value="p2" selected>Work &amp; Ops<\/option>/);
  assert.match(html, /data-markdown-import-files[^>]*multiple/);
  assert.match(html, /does not restore Prax export metadata, document type, provenance, trust, or graph links/);
  assert.match(html, /data-action="submit-markdown-import" disabled>Import<\/button>/);
});

test('selected files survive rendering with their filenames and derived titles', () => {
  const html = render({
    markdownImportFiles: [
      { id: 'one', name: 'restore.md', title: 'Restore database', body: '# Restore database' },
      { id: 'two', name: 'notes.markdown', title: 'Notes', body: 'Notes' },
    ],
  });
  assert.match(html, /2 files ready/);
  assert.match(html, /restore\.md[\s\S]*Restore database/);
  assert.match(html, /notes\.markdown[\s\S]*Notes/);
  assert.match(html, /data-action="submit-markdown-import"[^>]*>Import 2<\/button>/);
});

test('pending import locks destination, file, close, cancel, and submit controls', () => {
  const html = render({
    markdownImportPending: true,
    markdownImportFiles: [{ id: 'one', name: 'one.md', title: 'One', body: '# One' }],
  });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-markdown-import-project disabled/);
  assert.match(html, /data-markdown-import-files[^>]*disabled/);
  assert.match(html, /aria-label="Close Markdown import" disabled/);
  assert.match(html, /data-action="close-markdown-import" disabled>Cancel/);
  assert.match(html, /data-action="submit-markdown-import" disabled>Importing…/);
});

test('partial outcome retains failed files and offers an exact retry', () => {
  const html = render({
    markdownImportFiles: [{ id: 'failed', name: 'failed.md', title: 'Failed', body: '# Failed' }],
    markdownImportNotice: 'Imported 1 note into Work. 1 file remains; retry is exact-once safe.',
  });
  assert.match(html, /role="status">Imported 1 note into Work/);
  assert.match(html, /failed\.md/);
  assert.match(html, /data-markdown-import-project disabled/);
  assert.match(html, /data-markdown-import-files[^>]*disabled/);
  assert.match(html, /data-action="submit-markdown-import"[^>]*>Retry failed<\/button>/);
});

test('dialog escapes project, file, title, and error content', () => {
  const html = render({
    markdownImportProjectId: '<bad>',
    markdownImportFiles: [{ id: 'x', name: '<file>.md', title: '<script>x</script>', body: '' }],
    markdownImportError: '<strong>failed</strong>',
  }, [{ id: '<bad>', name: '<Project>' }]);
  assert.doesNotMatch(html, /<script>|<strong>failed<\/strong>|<Project>/);
  assert.match(html, /value="&lt;bad&gt;" selected>&lt;Project&gt;/);
  assert.match(html, /&lt;file&gt;\.md/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /role="alert">&lt;strong&gt;failed&lt;\/strong&gt;/);
});
