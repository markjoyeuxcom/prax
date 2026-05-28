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

test('detail renders an optional close action for board detail mode', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'low', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, { closeAction: 'close-board-task-detail' });
  assert.match(html, /data-action="close-board-task-detail"[^>]*>\[x\] close/);
});

test('renderTaskDetailHtml renders a close control when closeAction is provided', () => {
  const task = { id: 't1', title: 'Back up CNPG', status: 'planned', priority: 'high', projectId: 'p1' };
  const html = renderTaskDetailHtml(task, { closeAction: 'close-task-detail' });
  assert.match(html, /data-action="close-task-detail"/);
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

test('renderTaskDetailHtml renders an editable notes textarea with the task notes', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low', notes: 'paused on step 3' },
    {},
  );
  assert.match(html, /<textarea[^>]*data-task-notes[^>]*>paused on step 3<\/textarea>/);
  assert.match(html, /data-action="save-task-notes"/);
});

test('renderTaskDetailHtml renders detail section rail and mobile tab controls', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low', notes: '' },
    { activeTaskDetailTab: 'work', activeTaskDetailSection: 'docs' },
  );
  assert.match(html, /data-active-detail-section="docs"/);
  assert.match(html, /class="detail-section-rail"/);
  assert.match(html, /data-action="set-task-detail-section"[^>]*data-section="summary"/);
  assert.match(html, /data-action="set-task-detail-section"[^>]*data-section="docs"[^>]*aria-pressed="true"/);
  assert.match(html, /data-action="set-task-detail-section"[^>]*data-section="checklist"/);
  assert.match(html, /data-action="set-task-detail-section"[^>]*data-section="notes"/);
  assert.match(html, /data-action="set-task-detail-section"[^>]*data-section="activity"/);
  assert.match(html, /class="detail-mobile-tabs"/);
  assert.match(html, /data-action="set-task-detail-tab"[^>]*data-tab="summary"/);
  assert.match(html, /data-action="set-task-detail-tab"[^>]*data-tab="work"[^>]*aria-pressed="true"/);
  assert.match(html, /data-action="set-task-detail-tab"[^>]*data-tab="activity"/);
});

test('renderTaskDetailHtml renders a real summary section below the rail', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'Back up CNPG', description: 'Verify backup schedule', status: 'planned', priority: 'high', dueDate: '2026-05-18', notes: 'Restore drill pending' },
    {
      activeTaskDetailSection: 'summary',
      linkedDocuments: [{ id: 'd1', title: 'Restore runbook', documentType: 'runbook' }],
      checklistItems: [
        { id: 'c1', label: 'Verify backup CR', completed: true },
        { id: 'c2', label: 'Confirm object-store creds', completed: false },
      ],
      activityEvents: [{ id: 'a1', message: 'Task created', createdAt: '2026-05-22T01:17:00.000Z' }],
    },
  );
  assert.match(html, /id="detail-summary-panel"/);
  assert.match(html, /data-detail-section="summary"/);
  assert.match(html, /Back up CNPG/);
  assert.match(html, /Verify backup schedule/);
  assert.match(html, /class="detail-summary__value">Planned/);
  assert.match(html, /class="detail-summary__value">2026-05-18/);
  assert.match(html, /1\/2 done/);
  assert.match(html, /1 linked doc/);
  assert.match(html, /notes captured/);
  assert.match(html, /Task created/);
});

test('renderTaskDetailHtml exposes notes dirty state and saved timestamp controls', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low', notes: 'draft text' },
    { isTaskNotesDirty: true, taskNotesDraft: 'unsaved draft', taskNotesSavedAt: '09:38' },
  );
  assert.match(html, /class="detail-notes-shell is-dirty"/);
  assert.match(html, /data-task-notes-status[^>]*>dirty · local edit/);
  assert.match(html, /last saved 09:38/);
  assert.match(html, /data-action="discard-task-notes"/);
  assert.match(html, /unsaved draft/);
});

test('renderTaskDetailHtml renders notes read-only when readOnly', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'completed', priority: 'low', notes: 'archived note' },
    { readOnly: true },
  );
  assert.doesNotMatch(html, /data-action="save-task-notes"/);
  assert.match(html, /archived note/);
});

test('renderNotes escapes HTML-special characters in notes', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low', notes: '</textarea><script>alert(1)</script>' },
    {},
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;\/textarea&gt;/);
});

test('renderTaskDetailHtml renders checklist items with a done count and controls', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low' },
    { checklistItems: [
      { id: 'c1', label: 'Step one', completed: true },
      { id: 'c2', label: 'Step two', completed: false },
    ] },
  );
  assert.match(html, /Checklist/);
  assert.match(html, /1\/2/);
  assert.match(html, /data-action="toggle-checklist-item"[^>]*data-item-id="c1"/);
  assert.match(html, /data-action="delete-checklist-item"[^>]*data-item-id="c2"/);
  assert.match(html, /data-action="delete-checklist-item"[^>]*>\[del\]/);
  assert.match(html, /data-action="add-checklist-item"/);
  assert.match(html, /Step one/);
});

test('renderTaskDetailHtml checklist is read-only with no controls when readOnly', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'completed', priority: 'low' },
    { readOnly: true, checklistItems: [{ id: 'c1', label: 'Done step', completed: true }] },
  );
  assert.match(html, /Done step/);
  assert.doesNotMatch(html, /data-action="toggle-checklist-item"/);
  assert.doesNotMatch(html, /data-action="add-checklist-item"/);
});

test('renderTaskDetailHtml renders an activity feed newest-first', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low' },
    { activityEvents: [
      { id: 'a2', message: 'Status → in-progress', createdAt: '2026-05-20T10:00:00.000Z' },
      { id: 'a1', message: 'Task created', createdAt: '2026-05-19T09:00:00.000Z' },
    ] },
  );
  assert.match(html, /Activity/);
  assert.match(html, /Status → in-progress/);
  assert.match(html, /2026-05-20 10:00/);
  assert.match(html, /Task created/);
});

test('renderTaskDetailHtml shows an empty activity state', () => {
  const html = renderTaskDetailHtml({ id: 't1', title: 'X', status: 'planned', priority: 'low' }, { activityEvents: [] });
  assert.match(html, /No activity yet\./);
});
