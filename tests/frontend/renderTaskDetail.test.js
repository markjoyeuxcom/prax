import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskDrawerHtml } from '../../public/js/renderTaskDetail.js';

const NOW = new Date('2026-07-06T09:00:00');

function makeState(overrides = {}) {
  return { taskNotesDraftId: null, taskNotesDraft: '', ...overrides };
}

function makeTask(overrides = {}) {
  return {
    id: 't1',
    title: 'Back up CNPG',
    status: 'in-progress',
    priority: 'medium',
    dueDate: null,
    notes: '',
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return { project: null, documents: [], checklist: [], activity: [], readOnly: false, now: NOW, ...overrides };
}

function render({ state = makeState(), task = makeTask(), context = makeContext() } = {}) {
  return renderTaskDrawerHtml(state, task, context);
}

test('drawer renders a scrim and a dialog panel that both close via close-drawer', () => {
  const html = render();
  assert.match(html, /class="scrim" data-action="close-drawer"/);
  assert.match(html, /class="drawer" role="dialog" aria-modal="true"/);
  assert.match(html, /class="drawer__close"[^>]*data-action="close-drawer"/);
});

test('drawer returns an empty string without a task', () => {
  assert.equal(renderTaskDrawerHtml(makeState(), null, makeContext()), '');
});

// ---- head -------------------------------------------------------------------

test('head renders the done toggle with the task id', () => {
  const html = render();
  assert.match(html, /data-action="toggle-task-done" data-task-id="t1"/);
  assert.match(html, /class="task-check" [^>]*aria-pressed="false"/);
  assert.doesNotMatch(html, /class="drawer__title-input is-done"/);
});

test('head marks a completed task done on toggle and title', () => {
  const html = render({ task: makeTask({ status: 'completed' }) });
  assert.match(html, /class="task-check is-done"[^>]*aria-pressed="true"[^>]*>✓</);
  assert.match(html, /class="drawer__title-input is-done"/);
});

test('head renders the title as an editable borderless input', () => {
  const html = render();
  assert.match(html, /<input class="drawer__title-input" type="text" data-task-title value="Back up CNPG"/);
  assert.doesNotMatch(html, /data-task-title[^>]*readonly/);
});

test('there is no separate edit form entry point', () => {
  const html = render();
  assert.doesNotMatch(html, /data-action="edit-task"/);
});

test('head renders a project chip tinted with the project color', () => {
  const html = render({ context: makeContext({ project: { id: 'p1', name: 'Homelab', color: '#7A9E7E' } }) });
  assert.match(html, /class="chip chip--project"[^>]*#7A9E7E[^>]*>Homelab</);
});

test('head renders a due chip from the dueFlags bucket', () => {
  const html = render({ task: makeTask({ dueDate: '2026-07-01' }) });
  assert.match(html, /class="chip chip--due-overdue">Jul 1 · overdue</);
});

test('head due chip renders muted for completed tasks', () => {
  const html = render({ task: makeTask({ status: 'completed', dueDate: '2026-07-01' }) });
  assert.match(html, /class="chip chip--due-done"/);
});

test('head omits chips it has no data for', () => {
  const html = render();
  assert.doesNotMatch(html, /chip--project/);
  assert.doesNotMatch(html, /chip--due-/);
});

// ---- status / priority / due field rows --------------------------------------

test('status row renders five pills carrying API values in data-status', () => {
  const html = render();
  assert.match(html, /data-action="set-task-status" data-status="high-priority"[^>]*>Priority</);
  assert.match(html, /data-action="set-task-status" data-status="in-progress"[^>]*>In progress</);
  assert.match(html, /data-action="set-task-status" data-status="planned"[^>]*>Planned</);
  assert.match(html, /data-action="set-task-status" data-status="completed"[^>]*>Completed</);
  assert.match(html, /data-action="set-task-status" data-status="notes"[^>]*>Backlog</);
  assert.equal((html.match(/data-action="set-task-status"/g) || []).length, 5);
});

test('status row marks only the current design status active', () => {
  const html = render({ task: makeTask({ status: 'in-progress' }) });
  assert.match(html, /class="pill-btn is-active"[^>]*data-status="in-progress"/);
  assert.equal((html.match(/class="pill-btn is-active"/g) || []).length, 1);
});

test('the notes API status maps onto the active Backlog pill', () => {
  const html = render({ task: makeTask({ status: 'notes' }) });
  assert.match(html, /class="pill-btn is-active"[^>]*data-status="notes"/);
});

test('priority row renders three dotted pills carrying API values', () => {
  const html = render();
  assert.match(html, /data-action="set-task-priority" data-priority="high"[^>]*>[^]*?prio-dot--high[^]*?High</);
  assert.match(html, /data-action="set-task-priority" data-priority="medium"[^>]*>[^]*?prio-dot--med[^]*?Medium</);
  assert.match(html, /data-action="set-task-priority" data-priority="low"[^>]*>[^]*?prio-dot--low[^]*?Low</);
  assert.equal((html.match(/data-action="set-task-priority"/g) || []).length, 3);
});

test('priority row outlines only the current priority', () => {
  const html = render({ task: makeTask({ priority: 'medium' }) });
  assert.match(html, /class="pill-btn is-active--outline"[^>]*data-priority="medium"/);
  assert.equal((html.match(/is-active--outline/g) || []).length, 1);
});

test('due row renders a date input with the task due date plus a clear button', () => {
  const html = render({ task: makeTask({ dueDate: '2026-07-10' }) });
  assert.match(html, /<input class="date-input" type="date" data-task-due value="2026-07-10">/);
  assert.match(html, /data-action="clear-task-due"/);
});

// ---- description ---------------------------------------------------------------

test('a legacy description renders as an editable field-row', () => {
  const html = render({ task: makeTask({ description: 'Verify backup schedule' }) });
  assert.match(html, /<span class="field-row__label">Description<\/span>/);
  assert.match(html, /data-task-description[^>]*>Verify backup schedule<\/textarea>/);
});

test('tasks without a description get no description row', () => {
  const html = render({ task: makeTask({ description: '' }) });
  assert.doesNotMatch(html, /data-task-description/);
  assert.doesNotMatch(html, />Description</);
});

// ---- notes -------------------------------------------------------------------

test('notes textarea shows the draft only when the draft belongs to this task', () => {
  const state = makeState({ taskNotesDraftId: 't1', taskNotesDraft: 'draft body' });
  const html = render({ state, task: makeTask({ notes: 'saved body' }) });
  assert.match(html, /data-task-notes[^>]*>draft body<\/textarea>/);
  assert.doesNotMatch(html, /saved body/);
});

test('notes textarea falls back to task notes when the draft is for another task', () => {
  const state = makeState({ taskNotesDraftId: 'other-task', taskNotesDraft: 'draft body' });
  const html = render({ state, task: makeTask({ notes: 'saved body' }) });
  assert.match(html, /data-task-notes[^>]*>saved body<\/textarea>/);
  assert.doesNotMatch(html, /draft body/);
});

test('an empty draft for this task still wins over saved notes', () => {
  const state = makeState({ taskNotesDraftId: 't1', taskNotesDraft: '' });
  const html = render({ state, task: makeTask({ notes: 'saved body' }) });
  assert.match(html, /data-task-notes[^>]*><\/textarea>/);
  assert.doesNotMatch(html, /saved body/);
});

// ---- checklist ---------------------------------------------------------------

test('checklist renders "n of m", a percent progress bar, and toggleable items', () => {
  const html = render({ context: makeContext({ checklist: [
    { id: 'c1', label: 'Step one', completed: true },
    { id: 'c2', label: 'Step two', completed: false },
  ] }) });
  assert.match(html, /<span>1 of 2<\/span>/);
  assert.match(html, /class="progress"><span style="width:50%"/);
  assert.match(html, /class="check-item is-done"[^>]*data-item-id="c1"/);
  assert.match(html, /data-action="toggle-checklist-item" data-item-id="c1" data-completed="true"/);
  assert.match(html, /data-action="toggle-checklist-item" data-item-id="c2" data-completed="false"/);
  assert.match(html, /data-action="delete-checklist-item" data-item-id="c2"/);
  assert.match(html, /Step one/);
});

test('checklist progress rounds the percentage', () => {
  const html = render({ context: makeContext({ checklist: [
    { id: 'c1', label: 'a', completed: true },
    { id: 'c2', label: 'b', completed: false },
    { id: 'c3', label: 'c', completed: false },
  ] }) });
  assert.match(html, /<span>1 of 3<\/span>/);
  assert.match(html, /width:33%/);
});

test('checklist renders an adder for editable tasks even when empty', () => {
  const html = render({ context: makeContext({ checklist: [] }) });
  assert.match(html, /<span>0 of 0<\/span>/);
  assert.match(html, /width:0%/);
  assert.match(html, /data-checklist-new/);
  assert.match(html, /data-action="add-checklist-item"/);
});

// ---- linked documents ---------------------------------------------------------

test('doc rows render open + unlink controls and a document-type chip', () => {
  const html = render({ context: makeContext({ documents: [
    { id: 'doc-1', title: 'Deploy Runbook', documentType: 'runbook' },
    { id: 'doc-2', title: 'Ops Note', documentType: 'note' },
  ] }) });
  assert.match(html, /class="doc-row"[^>]*data-action="open-linked-doc" data-document-id="doc-1"/);
  assert.match(html, /data-action="open-linked-doc" data-document-id="doc-2"/);
  assert.match(html, /data-action="unlink-task-document" data-document-id="doc-1"/);
  assert.match(html, /data-action="unlink-task-document" data-document-id="doc-2"/);
  assert.match(html, /class="chip chip--type-runbook">runbook</);
  assert.match(html, /class="chip chip--type-note">note</);
  assert.match(html, /Deploy Runbook/);
});

test('linked documents shows an empty state and the link-picker opener', () => {
  const html = render();
  assert.match(html, /No linked runbooks or notes\./);
  assert.match(html, /data-action="open-link-picker"[^>]*>＋ Link doc</);
});

// ---- activity ------------------------------------------------------------------

test('activity renders a timeline with YYYY-MM-DD HH:MM timestamps', () => {
  const html = render({ context: makeContext({ activity: [
    { id: 'a2', message: 'Status → in-progress', createdAt: '2026-05-20T10:00:00.000Z' },
    { id: 'a1', message: 'Task created', createdAt: '2026-05-19T09:00:00.000Z' },
  ] }) });
  assert.match(html, /class="timeline"/);
  assert.match(html, /Status → in-progress/);
  assert.match(html, /class="timeline__when">2026-05-20 10:00</);
  assert.match(html, /class="timeline__when">2026-05-19 09:00</);
  assert.match(html, /Task created/);
});

test('activity shows an empty state when there are no events', () => {
  const html = render();
  assert.match(html, /No activity yet\./);
  assert.doesNotMatch(html, /class="timeline"/);
});

// ---- footer + readOnly gating ----------------------------------------------------

test('footer offers archive (danger) for active tasks', () => {
  const html = render();
  assert.match(html, /class="btn-outline btn-outline--danger"[^>]*data-action="archive-task"[^>]*>Archive task</);
  assert.doesNotMatch(html, /data-action="restore-task"/);
  assert.doesNotMatch(html, /data-action="delete-archived-task"/);
});

test('footer offers restore + permanent delete for archived tasks', () => {
  const html = render({ context: makeContext({ readOnly: true }) });
  assert.match(html, /class="btn-outline"[^>]*data-action="restore-task"[^>]*>Restore</);
  assert.match(html, /class="btn-outline btn-outline--danger"[^>]*data-action="delete-archived-task"[^>]*>Delete permanently</);
  assert.doesNotMatch(html, /data-action="archive-task"/);
});

test('readOnly disables the status pills, priority pills, due input, and notes', () => {
  const html = render({ task: makeTask({ description: 'legacy text' }), context: makeContext({ readOnly: true }) });
  assert.equal((html.match(/data-action="set-task-status"[^>]*\sdisabled>/g) || []).length, 5);
  assert.equal((html.match(/data-action="set-task-priority"[^>]*\sdisabled>/g) || []).length, 3);
  assert.match(html, /data-task-due[^>]*\sdisabled>/);
  assert.match(html, /data-action="clear-task-due" disabled>/);
  assert.match(html, /data-task-notes[^>]*\sdisabled>/);
  assert.match(html, /data-action="toggle-task-done"[^>]*\sdisabled>/);
  assert.match(html, /data-task-title[^>]*\sreadonly>/);
  assert.match(html, /data-task-description[^>]*\sreadonly>/);
});

test('readOnly hides the checklist adder, item deletes, unlink, and link picker', () => {
  const html = render({ context: makeContext({
    readOnly: true,
    checklist: [{ id: 'c1', label: 'Done step', completed: true }],
    documents: [{ id: 'doc-1', title: 'Runbook', documentType: 'runbook' }],
  }) });
  assert.doesNotMatch(html, /data-checklist-new/);
  assert.doesNotMatch(html, /data-action="add-checklist-item"/);
  assert.doesNotMatch(html, /data-action="delete-checklist-item"/);
  assert.doesNotMatch(html, /data-action="unlink-task-document"/);
  assert.doesNotMatch(html, /data-action="open-link-picker"/);
  assert.match(html, /data-action="open-linked-doc"/);
  assert.match(html, /Done step/);
  assert.match(html, /data-action="toggle-checklist-item"[^>]*\sdisabled>/);
});

test('readOnly omits the checklist section entirely when there are no items', () => {
  const html = render({ context: makeContext({ readOnly: true, checklist: [] }) });
  assert.doesNotMatch(html, />Checklist</);
  assert.doesNotMatch(html, /class="progress"/);
});

// ---- escaping -----------------------------------------------------------------

test('title, description, notes, checklist, docs, and activity all escape HTML', () => {
  const nasty = '</textarea><script>alert(1)</script>';
  const html = render({
    task: makeTask({ title: nasty, description: nasty, notes: nasty }),
    context: makeContext({
      checklist: [{ id: 'c1', label: nasty, completed: false }],
      documents: [{ id: 'doc-1', title: nasty, documentType: 'note' }],
      activity: [{ id: 'a1', message: nasty, createdAt: '2026-05-19T09:00:00.000Z' }],
    }),
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<\/textarea><script/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
