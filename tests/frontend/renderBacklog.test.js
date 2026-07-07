import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBacklogHtml, renderArchiveHtml } from '../../public/js/renderBacklog.js';

const STATE = {};

// ---- Backlog ----------------------------------------------------------------

test('renderBacklogHtml renders hint, rows, and promote actions', () => {
  const html = renderBacklogHtml(STATE, [
    { id: 'b1', title: 'Read the CNPG docs', priority: 'low' },
    { id: 'b2', title: 'Try Talos', priority: 'high' },
  ]);

  assert.match(html, /class="view-hint">Someday \/ maybe — no dates, no pressure\.</);
  assert.match(html, /class="rows"/);
  assert.match(html, /class="plain-row" data-action="open-task" data-task-id="b1"/);
  assert.match(html, /class="prio-dot prio-dot--low"/);
  assert.match(html, /class="prio-dot prio-dot--high"/);
  assert.match(html, /class="plain-row__title">Read the CNPG docs</);
  assert.match(html, /data-action="promote-task" data-task-id="b2"[^>]*>Promote to board</);
  assert.equal((html.match(/data-action="promote-task"/g) || []).length, 2);
  assert.match(html, /class="btn-outline" data-action="promote-task"/);
});

test('renderBacklogHtml shows a friendly empty slot when the backlog is clear', () => {
  const html = renderBacklogHtml(STATE, []);

  assert.match(html, /class="view-hint"/);
  assert.match(html, /class="empty-slot">The backlog is empty — enjoy it while it lasts\.</);
  assert.doesNotMatch(html, /plain-row/);
});

test('renderBacklogHtml escapes task titles and ids', () => {
  const html = renderBacklogHtml(STATE, [
    { id: 'b"1"', title: '<script>alert(1)</script>', priority: 'medium' },
  ]);

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /data-task-id="b&quot;1&quot;"/);
});

// ---- Archive ----------------------------------------------------------------

test('renderArchiveHtml renders dim rows with restore and delete actions', () => {
  const html = renderArchiveHtml(STATE, [
    { id: 'a1', title: 'Old migration task', archivedAt: '2026-06-01T00:00:00.000Z' },
  ]);

  assert.match(html, /class="plain-row is-dim" data-task-id="a1"/);
  assert.match(html, /class="plain-row__title">Old migration task</);
  assert.match(html, /class="btn-outline" data-action="restore-task" data-task-id="a1"[^>]*>Restore</);
  assert.match(html, /class="btn-outline btn-outline--danger" data-action="delete-archived-task" data-task-id="a1"[^>]*>Delete</);
});

test('renderArchiveHtml archive rows do not open the drawer on row click', () => {
  const html = renderArchiveHtml(STATE, [
    { id: 'a1', title: 'Old migration task' },
  ]);

  assert.doesNotMatch(html, /data-action="open-task"/);
});

test('renderArchiveHtml shows an empty slot when nothing is archived', () => {
  const html = renderArchiveHtml(STATE, []);

  assert.match(html, /class="empty-slot">Nothing archived in this project\.</);
  assert.doesNotMatch(html, /plain-row/);
});

test('renderArchiveHtml escapes archived task fields', () => {
  const html = renderArchiveHtml(STATE, [
    { id: 'a"1"', title: '<img src=x onerror=alert(1)>' },
  ]);

  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-task-id="a&quot;1&quot;"/);
});
