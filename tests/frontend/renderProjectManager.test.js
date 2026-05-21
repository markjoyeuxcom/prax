import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectManagerHtml } from '../../public/js/renderProjectManager.js';

const PROJECTS = [
  { id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active', sortOrder: 0 },
  { id: 'p2', name: 'Work', slug: 'work', status: 'on-hold', sortOrder: 1 },
];

test('renders the modal chrome with a close action', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /class="modal-backdrop" data-project-manager/);
  assert.match(html, /data-action="close-project-manager"/);
});

test('renders a row per project with name input and status select preselected', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /data-project-row="p1"/);
  assert.match(html, /data-project-name="p1"[^>]*value="Homelab"/);
  assert.match(html, /data-project-row="p2"/);
  assert.match(html, /data-project-status="p2"[\s\S]*?<option value="on-hold" selected>/);
  assert.match(html, /data-action="manager-save" data-project-id="p1"/);
  assert.match(html, /data-action="manager-delete" data-project-id="p1"/);
  assert.match(html, /data-action="manager-move-up" data-project-id="p1"/);
  assert.match(html, /data-action="manager-move-down" data-project-id="p1"/);
});

test('renders the create row', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /data-project-new-name/);
  assert.match(html, /data-action="manager-create"/);
});

test('renders live projects under status group headings', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /Active/);
  assert.match(html, /On hold/);
});

test('status select offers only live status options (no archived)', () => {
  const html = renderProjectManagerHtml({ projects: [PROJECTS[0]] });
  assert.match(html, /<option value="active"/);
  assert.match(html, /<option value="on-hold"/);
  assert.match(html, /<option value="completed"/);
  assert.doesNotMatch(html, /<option value="archived"/);
});

test('per-row archive action is rendered', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /data-action="manager-archive" data-project-id="p1"/);
});

test('archive entry button with count is rendered', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS, archivedCount: 2 });
  assert.match(html, /data-action="open-project-archive"/);
  assert.match(html, /archived projects · 2/);
});

test('archive entry button shows 0 when archivedCount is omitted', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /data-action="open-project-archive"/);
  assert.match(html, /archived projects · 0/);
});

test('escapes project names', () => {
  const html = renderProjectManagerHtml({ projects: [{ id: 'p1', name: '<script>x</script>', slug: 'x', status: 'active', sortOrder: 0 }] });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('shows an error banner when error is provided', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS, error: 'Could not delete' });
  assert.match(html, /project-manager__error/);
  assert.match(html, /Could not delete/);
});

test('renders an empty state when there are no live projects', () => {
  const html = renderProjectManagerHtml({ projects: [] });
  assert.match(html, /project-manager__empty/);
});

test('defaults the status select to the first option for an unrecognised status', () => {
  const html = renderProjectManagerHtml({ projects: [{ id: 'p1', name: 'X', slug: 'x', status: 'legacy-value', sortOrder: 0 }] });
  assert.match(html, /<option value="active" selected>/);
  assert.doesNotMatch(html, /<option value="legacy-value"/);
});
