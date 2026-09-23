import { escapeHtml, chip, prioDotClass } from './renderHelpers.js';
import {
  DESIGN_STATUSES,
  designStatus,
  apiStatus,
  designPriority,
  apiPriority,
} from './statusMap.js';
import { dueFlag } from './dueFlags.js';
import { icon } from './icons.js';
import { localDateTimeOf } from './dateHelpers.js';

// Task drawer (right-side overlay panel) — pure state → HTML string, no DOM.
// Tasks arrive with API field names (status 'high-priority', priority 'medium',
// dueDate, archivedAt); statusMap translates for display, and every actionable
// control emits API vocabulary in its data-* payload. Events bind in main.js
// via delegated data-action attributes. readOnly = archived task.
//
// The drawer is the only task editor: title ([data-task-title]) and notes
// ([data-task-notes]) autosave on debounced input in main.js, and a legacy
// description renders as an editable field-row only when one already exists.

const STATUS_LABELS = {
  priority: 'Priority',
  inprogress: 'In progress',
  planned: 'Planned',
  completed: 'Completed',
  backlog: 'Backlog',
};

const PRIORITY_PILLS = [
  ['high', 'High'],
  ['med', 'Medium'],
  ['low', 'Low'],
];

// "YYYY-MM-DD HH:MM" in local time from an ISO timestamp (the same clock the
// Snooze row uses); date-only strings stay date-only.
function formatWhen(createdAt) {
  return localDateTimeOf(createdAt);
}

function formatDeferredUntil(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const part = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
}

function mutedText(text) {
  return `<p style="margin:4px 0 0; font-size:12.5px; color:var(--ink3);">${escapeHtml(text)}</p>`;
}

function renderStatusPills(task, dis) {
  const current = designStatus(task.status);
  return DESIGN_STATUSES.map(key =>
    `<button class="pill-btn${current === key ? ' is-active' : ''}" type="button" data-action="set-task-status" data-status="${apiStatus(key)}" aria-pressed="${current === key}"${dis}>${STATUS_LABELS[key]}</button>`,
  ).join('');
}

function renderPriorityPills(task, dis) {
  const current = designPriority(task.priority);
  return PRIORITY_PILLS.map(([key, label]) =>
    `<button class="pill-btn${current === key ? ' is-active--outline' : ''}" type="button" data-action="set-task-priority" data-priority="${apiPriority(key)}" aria-pressed="${current === key}"${dis}><span class="${prioDotClass(apiPriority(key))}" aria-hidden="true"></span>${label}</button>`,
  ).join('');
}

// Legacy descriptions stay reachable/editable, but new tasks never grow one:
// the row renders only when the task already carries a non-empty description.
function taskDraftValue(state, task, field) {
  if (state?.taskNotesDraftId !== task.id) return task[field] ?? '';
  const key = field === 'title' ? 'taskTitleDraft'
    : (field === 'description' ? 'taskDescriptionDraft' : 'taskNotesDraft');
  return state[key] ?? task[field] ?? '';
}

function renderDescriptionRow(state, task, ro) {
  if (!String(task.description ?? '').trim()) return '';
  return `
      <div class="field-row">
        <span class="field-row__label">Description</span>
        <div class="field-row__value">
          <textarea class="drawer__notes" data-task-description rows="2" style="min-height:44px;" aria-label="Task description"${ro}>${escapeHtml(taskDraftValue(state, task, 'description'))}</textarea>
        </div>
      </div>`;
}

function renderProjectControl(task, context, dis) {
  const projects = Array.isArray(context.projects) ? [...context.projects] : [];
  if (context.project && !projects.some(project => project.id === context.project.id)) {
    projects.unshift(context.project);
  }
  const options = projects.map(project =>
    `<option value="${escapeHtml(project.id)}"${project.id === task.projectId ? ' selected' : ''}>${escapeHtml(project.name || 'Untitled project')}</option>`,
  ).join('');
  return `<select class="text-input" data-task-project aria-label="Project"${dis}>${options}</select>`;
}

function renderFieldRows(state, task, context, dis, ro) {
  return `
      <div class="field-row">
        <span class="field-row__label">Project</span>
        <div class="field-row__value">${renderProjectControl(task, context, dis)}</div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Status</span>
        <div class="field-row__value" role="group" aria-label="Status">${renderStatusPills(task, dis)}</div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Priority</span>
        <div class="field-row__value" role="group" aria-label="Priority">${renderPriorityPills(task, dis)}</div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Due</span>
        <div class="field-row__value" role="group" aria-label="Schedule">
          <input class="date-input" type="date" data-task-due value="${escapeHtml(task.dueDate || '')}" aria-label="Due date"${dis}>
          <input class="time-input" type="time" data-task-due-time value="${escapeHtml(task.dueTime || '')}" title="Time of day (optional)" aria-label="Due time"${task.dueDate ? '' : ' disabled'}${dis}>
          <button class="pill-btn" type="button" data-action="clear-task-due"${dis}>Clear</button>
        </div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Repeat</span>
        <div class="field-row__value" role="group" aria-label="Repeat">${renderRecurrenceControls(task, dis)}</div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Snooze</span>
        <div class="field-row__value" role="group" aria-label="Snooze">${renderSnoozeControls(task, dis)}</div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Labels</span>
        <div class="field-row__value" role="group" aria-label="Labels">${renderLabelControls(state, task, dis)}</div>
      </div>${renderDescriptionRow(state, task, ro)}`;
}

// Cross-cutting labels (@waiting, @pagerduty). Chips with a × to remove; an
// input adds one on Enter (handled in main.js). Stored lowercase; shown with a
// leading @ to read like the filter grammar.
function renderLabelControls(state, task, dis) {
  const labels = Array.isArray(task.labels) ? task.labels : [];
  const chips = labels.map((label) =>
    `<span class="task-label">@${escapeHtml(label)}<button type="button" class="task-label__x" data-action="remove-task-label" data-label="${escapeHtml(label)}"${dis} aria-label="Remove label ${escapeHtml(label)}">×</button></span>`,
  ).join('');
  const draft = state?.taskLabelDraftId === task.id ? state.taskLabelDraft || '' : '';
  const input = dis ? '' : `<input class="task-label-input" type="text" data-task-label-input aria-label="Add label" placeholder="add label…" value="${escapeHtml(draft)}" autocomplete="off" spellcheck="false">`;
  return `<div class="task-labels">${chips}${input}</div>`;
}

// Recurrence presets. On completion the server spawns the next instance with an
// advanced due date (server/recurrence.js). A custom `every:Nd` value set by an
// agent shows no active preset but is preserved until a pill is chosen.
const RECURRENCE_OPTIONS = [['', 'None'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];

export function recurrenceLabel(recurrence) {
  if (!recurrence) return '';
  const preset = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[recurrence];
  if (preset) return preset;
  const m = /^every:(\d+)([dw])$/.exec(recurrence);
  if (m) return `Every ${m[1]} ${m[2] === 'w' ? 'week' : 'day'}${Number(m[1]) > 1 ? 's' : ''}`;
  return recurrence;
}

function renderRecurrenceControls(task, dis) {
  const current = task.recurrence || '';
  return RECURRENCE_OPTIONS.map(([value, label]) =>
    `<button class="pill-btn${current === value ? ' is-active' : ''}" type="button" data-action="set-task-recurrence" data-recurrence="${value}" aria-pressed="${current === value}"${dis}>${label}</button>`,
  ).join('');
}

// Snooze hides a task from Today until a future moment. When snoozed, show the
// target date + Unsnooze; otherwise offer quick presets. Dates are sliced to
// YYYY-MM-DD so the markup is deterministic (regex-over-HTML tests).
function renderSnoozeControls(task, dis) {
  const id = escapeHtml(task.id);
  const snoozed = Boolean(task.deferredUntil) && new Date(task.deferredUntil) > new Date();
  // The drawer states the exact slippage count (chips elsewhere only appear
  // past the preference thresholds) — the mirror, not the nag.
  const deferrals = Number(task.deferralCount) || 0;
  const slipNote = deferrals > 0 && task.status !== 'completed'
    ? `<span class="snooze-until" data-slippage-count title="Times this task was snoozed or its due date pushed later">deferred ${deferrals}×</span>`
    : '';
  if (snoozed) {
    return `<span class="snooze-until">Until ${escapeHtml(formatDeferredUntil(task.deferredUntil))}</span>`
      + `<button class="pill-btn" type="button" data-action="unsnooze-task" data-task-id="${id}"${dis}>Unsnooze</button>`
      + slipNote;
  }
  return `<button class="pill-btn" type="button" data-action="snooze-task" data-snooze="tomorrow" data-task-id="${id}"${dis}>Tomorrow</button>`
    + `<button class="pill-btn" type="button" data-action="snooze-task" data-snooze="week" data-task-id="${id}"${dis}>Next week</button>`
    + slipNote;
}

// Notes value: the in-flight draft wins only when it belongs to this task
// (autosave is debounced in main.js; re-renders must not clobber typing).
function notesValue(state, task) {
  return taskDraftValue(state, task, 'notes');
}

function renderNotesSection(state, task, dis) {
  return `
      <section class="drawer-section">
        <div class="drawer-section__head"><span>Notes</span></div>
        <textarea class="drawer__notes" data-task-notes placeholder="Add notes…"${dis}>${escapeHtml(notesValue(state, task))}</textarea>
      </section>`;
}

function renderChecklistSection(checklist, readOnly, dis) {
  if (!checklist.length && readOnly) return '';
  const done = checklist.filter(item => item.completed).length;
  const pct = checklist.length ? Math.round((done / checklist.length) * 100) : 0;
  const items = checklist.map(item => {
    const isDone = Boolean(item.completed);
    // Delete is a sibling of the toggle: a control inside a <button> is
    // neither focusable nor announced.
    const remove = readOnly
      ? ''
      : `<button class="check-item__delete" type="button" data-action="delete-checklist-item" data-item-id="${escapeHtml(item.id)}" title="Delete item" aria-label="Delete ${escapeHtml(item.label || 'item')}">✕</button>`;
    return `
        <div class="check-item-group">
        <button class="check-item${isDone ? ' is-done' : ''}" type="button" data-action="toggle-checklist-item" data-item-id="${escapeHtml(item.id)}" data-completed="${isDone ? 'true' : 'false'}"${dis}>
          <span class="task-check${isDone ? ' is-done' : ''}" aria-hidden="true">${isDone ? '✓' : ''}</span>
          <span class="check-item__label">${escapeHtml(item.label || '')}</span>
        </button>${remove}
        </div>`;
  }).join('');
  const adder = readOnly ? '' : `
        <div style="display:flex; gap:6px; margin-top:6px;">
          <input class="text-input" type="text" data-checklist-new placeholder="Add checklist item…" aria-label="New checklist item" autocomplete="off" style="flex:1;">
          <button class="pill-btn" type="button" data-action="add-checklist-item">Add</button>
        </div>`;
  return `
      <section class="drawer-section">
        <div class="drawer-section__head">
          <span>Checklist</span>
          <span>${done} of ${checklist.length}</span>
          <div class="progress"><span style="width:${pct}%"></span></div>
        </div>${items}${adder}
      </section>`;
}

// A document row: the open button plus its secondary controls as SIBLING
// buttons. A control nested inside the open <button> is neither focusable nor
// announced (interactive content is not allowed inside a button).
function docRowHtml(doc, openAction, actionsHtml) {
  const id = escapeHtml(doc.id);
  const type = escapeHtml(doc.documentType || 'note');
  return `
        <div class="doc-row-group">
          <button class="doc-row" type="button" data-action="${openAction}" data-document-id="${id}">
            ${icon('doc')}
            <span class="doc-row__title">${escapeHtml(doc.title || 'Untitled document')}</span>
            ${chip(doc.documentType || 'note', `type-${type}`)}
          </button>${actionsHtml ? `<span class="doc-row__actions">${actionsHtml}</span>` : ''}
        </div>`;
}

function renderDocsSection(documents, readOnly) {
  const rows = documents.length
    ? documents.map(doc => {
        const title = escapeHtml(doc.title || 'Untitled document');
        const unlink = readOnly
          ? ''
          : `<button class="doc-row__dismiss" type="button" data-action="unlink-task-document" data-document-id="${escapeHtml(doc.id)}" title="Unlink document" aria-label="Unlink ${title}">✕</button>`;
        return docRowHtml(doc, 'open-linked-doc', unlink);
      }).join('')
    : mutedText('No linked runbooks or notes.');
  const linkButton = readOnly
    ? ''
    : '<button class="pill-btn" type="button" data-action="open-link-picker">＋ Link doc</button>'
      + '<button class="pill-btn" type="button" data-action="start-working-note" title="Create a note pre-linked to this task and open it">＋ Working note</button>';
  return `
      <section class="drawer-section">
        <div class="drawer-section__head"><span>Linked documents</span>${linkButton}</div>${rows}
      </section>`;
}

// Related knowledge (context surface): semantic suggestions filled AFTER the
// drawer renders. Advisory — a quiet labelled line for loading/off/failed
// states, never an error; renders nothing at all until the fill starts.
function renderRelatedSection(state, task, readOnly) {
  const related = state.taskRelatedDocs;
  if (!related || related.taskId !== task.id) return '';
  let body;
  if (related.loading) {
    body = mutedText('Looking for related notes…');
  } else if (related.degraded) {
    body = related.reason === 'semantic-off'
      ? mutedText('Semantic search is off — related notes need an embedding model (Settings ▸ Intelligence).')
      : mutedText('Related notes are unavailable right now.');
  } else if (!related.suggestions.length) {
    body = mutedText('No related notes found.');
  } else {
    body = related.suggestions.map((doc) => {
      const id = escapeHtml(doc.id);
      const title = escapeHtml(doc.title || 'Untitled document');
      const actions = readOnly ? '' : `<button class="doc-row__link" type="button" data-action="link-related-doc" data-document-id="${id}" title="Link to this task" aria-label="Link ${title} to this task">＋ Link</button>`
        + `<button class="doc-row__dismiss" type="button" data-action="dismiss-related-doc" data-document-id="${id}" title="Not relevant (this session)" aria-label="Not relevant: ${title}">✕</button>`;
      return docRowHtml(doc, 'open-linked-doc', actions);
    }).join('');
  }
  return `
      <section class="drawer-section" data-related-knowledge>
        <div class="drawer-section__head"><span>Related knowledge</span></div>${body}
      </section>`;
}

function renderActivitySection(activity) {
  const items = activity.length
    ? `<div class="timeline">${activity.map(event => `
          <div class="timeline__item">${escapeHtml(event.message || '')}<div class="timeline__when">${escapeHtml(formatWhen(event.createdAt))}</div></div>`).join('')}
        </div>`
    : mutedText('No activity yet.');
  return `
      <section class="drawer-section">
        <div class="drawer-section__head"><span>Activity</span></div>${items}
      </section>`;
}

function renderFoot(state, task, readOnly) {
  const taskId = escapeHtml(task.id);
  const buttons = readOnly
    ? `<button class="btn-outline" type="button" data-action="restore-task" data-task-id="${taskId}">Restore</button>
        <button class="btn-outline btn-outline--danger" type="button" data-action="delete-archived-task" data-task-id="${taskId}">Delete permanently</button>`
    : `<button class="btn-outline btn-outline--danger" type="button" data-action="archive-task" data-task-id="${taskId}">Archive task</button>`;
  return `
      <div class="drawer__foot" style="gap:8px;">
        ${readOnly ? '' : `<div class="task-draft-save">
          <span role="status" data-task-draft-save-status>${escapeHtml(state.taskDraftSaveStatus || 'Saved')}</span>
          <button type="button" class="task-draft-save__action" data-action="retry-task-draft-save" data-task-draft-save-action${['failed', 'recovered', 'conflict'].includes(state.taskDraftRecoveryReason) ? '' : ' hidden'}>${state.taskDraftRecoveryReason === 'conflict' ? 'Review and save' : (state.taskDraftRecoveryReason === 'recovered' ? 'Save recovered draft' : 'Retry')}</button>
          <button type="button" class="task-draft-save__action" data-action="discard-task-draft"${['failed', 'recovered', 'conflict'].includes(state.taskDraftRecoveryReason) ? '' : ' hidden'}>Discard draft</button>
        </div>`}
        ${buttons}
      </div>`;
}

function renderHead(state, task, context, isDone, readOnly) {
  const project = context.project || null;
  const projectColor = escapeHtml((project && project.color) || 'var(--accent)');
  const projectChip = project
    ? chip(project.name || 'Project', 'project',
        `style="--project-color:${projectColor}; background:color-mix(in oklab, ${projectColor} 13%, transparent);"`)
    : '';
  const flag = dueFlag(task.dueDate, { dueTime: task.dueTime, done: isDone, now: context.now });
  const dueChip = flag ? chip(flag.label, `due-${flag.bucket}`) : '';
  const recurChip = task.recurrence ? chip(`↻ ${recurrenceLabel(task.recurrence)}`, 'recur') : '';
  const chips = `${projectChip}${dueChip}${recurChip}`;
  return `
      <div class="drawer__head">
        <button class="task-check${isDone ? ' is-done' : ''}" type="button" data-action="toggle-task-done" data-task-id="${escapeHtml(task.id)}" aria-pressed="${isDone}" aria-label="Toggle done"${readOnly ? ' disabled' : ''}>${isDone ? '✓' : ''}</button>
        <div style="flex:1; min-width:0;">
          <input class="drawer__title-input${isDone ? ' is-done' : ''}" type="text" data-task-title value="${escapeHtml(taskDraftValue(state, task, 'title'))}" aria-label="Task title" autocomplete="off" spellcheck="false"${readOnly ? ' readonly' : ''}>
          ${chips ? `<div class="drawer__chips">${chips}</div>` : ''}
        </div>
        <button class="drawer__close" type="button" data-action="close-drawer" aria-label="Close drawer">✕</button>
      </div>`;
}

export function renderTaskDrawerHtml(state, task, context = {}) {
  if (!task) return '';
  const readOnly = Boolean(context.readOnly);
  const dis = readOnly ? ' disabled' : '';
  const ro = readOnly ? ' readonly' : '';
  const isDone = designStatus(task.status) === 'completed';
  const documents = Array.isArray(context.documents) ? context.documents : [];
  const checklist = Array.isArray(context.checklist) ? context.checklist : [];
  const activity = Array.isArray(context.activity) ? context.activity : [];

  return `
    <div class="scrim" data-action="close-drawer"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Task detail" data-task-id="${escapeHtml(task.id)}">${renderHead(state, task, context, isDone, readOnly)}
      <div class="drawer__scroll">${renderFieldRows(state, task, context, dis, ro)}${renderNotesSection(state, task, dis)}${renderChecklistSection(checklist, readOnly, dis)}${renderDocsSection(documents, readOnly)}${renderRelatedSection(state, task, readOnly)}${renderActivitySection(activity)}
      </div>${renderFoot(state, task, readOnly)}
    </aside>`;
}

// Fallback drawer for a task that vanished out from under an open drawer
// (archived or deleted externally). Rendering NOTHING while the draft state
// persisted made an invisible dirty draft veto every close and navigation —
// this panel names the situation and offers the two honest exits.
export function renderMissingTaskDrawerHtml(state) {
  const dirty = Boolean(state.isTaskNotesDirty || state.taskDraftRecoveryReason);
  return `
    <div class="scrim"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Task unavailable">
      <div class="drawer__head"><h2 class="drawer__title">Task unavailable</h2></div>
      <div class="drawer-section">
        <p class="view-hint">This task was archived or deleted elsewhere while its drawer was open.</p>
        ${dirty
    ? `<p class="view-hint">Your unsaved draft is kept on this device.</p>
        <div style="display:flex; gap:8px;">
          <button class="btn-outline" type="button" data-action="keep-task-draft-close">Keep draft &amp; close</button>
          <button class="btn-outline btn-outline--danger" type="button" data-action="discard-task-draft">Discard draft</button>
        </div>`
    : '<button class="btn-outline" type="button" data-action="keep-task-draft-close">Close</button>'}
      </div>
    </aside>`;
}
