import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskDetailHtml } from '../../public/js/renderTaskDetail.js';

test('detail renders bracketed action buttons for an active task', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'medium', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, {});
  assert.match(html, /data-action="edit-task"[^>]*>\[e\] edit/);
  assert.match(html, /data-action="archive-task"[^>]*>\[d\] archive/);
});

test('detail renders restore and delete for archived tasks', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'low', status: 'planned', dueDate: null, archivedAt: '2026-05-01' };
  const html = renderTaskDetailHtml(task, { readOnly: true, restoreAction: true, deleteAction: true });
  assert.match(html, /data-action="restore-task"[^>]*>\[r\] restore/);
  assert.match(html, /data-action="delete-archived-task"[^>]*>\[!\] delete/);
});

test('detail renders a mobile back button when mobileDetailOpen is true', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'low', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, { mobileDetailOpen: true });
  assert.match(html, /data-action="close-mobile-detail"[^>]*aria-label="Back"/);
});

test('detail omits back button when mobileDetailOpen is false', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'low', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, { mobileDetailOpen: false });
  assert.doesNotMatch(html, /data-action="close-mobile-detail"/);
});

test('linked docs renders rows with open and unlink controls', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'medium', status: 'planned', dueDate: null };
  const linkedDocuments = [
    { id: 'doc-1', title: 'Deploy Runbook', documentType: 'runbook', context: 'homelab' },
    { id: 'doc-2', title: 'Ops Note', documentType: 'note', context: 'work' },
  ];
  const html = renderTaskDetailHtml(task, { linkedDocuments });
  assert.match(html, /data-action="open-linked-doc"[^>]*data-document-id="doc-1"/);
  assert.match(html, /data-action="open-linked-doc"[^>]*data-document-id="doc-2"/);
  assert.match(html, /data-action="unlink-document"[^>]*data-document-id="doc-1"/);
  assert.match(html, /data-action="unlink-document"[^>]*data-document-id="doc-2"/);
  assert.match(html, /Deploy Runbook/);
  assert.match(html, /Ops Note/);
});

test('linked docs shows empty state when no documents are linked', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'medium', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, { linkedDocuments: [] });
  assert.match(html, /linked-docs__empty/);
  assert.match(html, /No linked runbooks or notes/);
});

test('linked docs in read-only mode hides link and unlink controls', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'medium', status: 'planned', dueDate: null };
  const linkedDocuments = [{ id: 'doc-1', title: 'Runbook', documentType: 'runbook', context: 'homelab' }];
  const html = renderTaskDetailHtml(task, { readOnly: true, linkedDocuments });
  assert.doesNotMatch(html, /data-action="open-link-picker"/);
  assert.doesNotMatch(html, /data-action="unlink-document"/);
  assert.match(html, /data-action="open-linked-doc"/);
});

test('linked docs shows the link picker button when not read-only', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'medium', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, { linkedDocuments: [] });
  assert.match(html, /data-action="open-link-picker"/);
  assert.match(html, /\[\+\] link doc/);
});
