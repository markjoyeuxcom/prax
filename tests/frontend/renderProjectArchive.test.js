import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectArchiveHtml } from '../../public/js/renderProjectArchive.js';

const ARCHIVED = [
  { id: 'p1', name: 'Cluster Migration', slug: 'cluster', status: 'archived' },
  { id: 'p2', name: 'Old Sandbox', slug: 'old', status: 'archived' },
];

test('renders the dialog chrome with back and close actions', () => {
  const html = renderProjectArchiveHtml({ projects: ARCHIVED });
  assert.match(html, /class="modal-backdrop" data-project-archive/);
  assert.match(html, /data-action="close-project-archive"/);
  assert.match(html, /data-action="back-to-manager"/);
});

test('renders a row per archived project with restore and delete', () => {
  const html = renderProjectArchiveHtml({ projects: ARCHIVED });
  assert.match(html, /data-archive-row="p1"/);
  assert.match(html, /data-action="archive-restore" data-project-id="p1"/);
  assert.match(html, /data-action="archive-delete" data-project-id="p1"/);
  assert.match(html, /Cluster Migration/);
});

test('escapes project names', () => {
  const html = renderProjectArchiveHtml({ projects: [{ id: 'p1', name: '<script>x</script>', status: 'archived' }] });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('shows an empty state when there are no archived projects', () => {
  const html = renderProjectArchiveHtml({ projects: [] });
  assert.match(html, /project-archive__empty/);
});

test('shows an error banner when error is provided', () => {
  const html = renderProjectArchiveHtml({ projects: ARCHIVED, error: 'Could not delete' });
  assert.match(html, /project-archive__error/);
  assert.match(html, /Could not delete/);
});
