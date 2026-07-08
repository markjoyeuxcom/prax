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

// "YYYY-MM-DD HH:MM" from an ISO timestamp; date-only strings stay date-only.
function formatWhen(createdAt) {
  const value = String(createdAt ?? '');
  if (value.length >= 16 && value.includes('T')) return value.slice(0, 16).replace('T', ' ');
  return value.slice(0, 10);
}

function mutedText(text) {
  return `<p style="margin:4px 0 0; font-size:12.5px; color:var(--ink3);">${escapeHtml(text)}</p>`;
}

function renderStatusPills(task, dis) {
  const current = designStatus(task.status);
  return DESIGN_STATUSES.map(key =>
    `<button class="pill-btn${current === key ? ' is-active' : ''}" type="button" data-action="set-task-status" data-status="${apiStatus(key)}"${dis}>${STATUS_LABELS[key]}</button>`,
  ).join('');
}

function renderPriorityPills(task, dis) {
  const current = designPriority(task.priority);
  return PRIORITY_PILLS.map(([key, label]) =>
    `<button class="pill-btn${current === key ? ' is-active--outline' : ''}" type="button" data-action="set-task-priority" data-priority="${apiPriority(key)}"${dis}><span class="${prioDotClass(apiPriority(key))}" aria-hidden="true"></span>${label}</button>`,
  ).join('');
}

// Legacy descriptions stay reachable/editable, but new tasks never grow one:
// the row renders only when the task already carries a non-empty description.
function renderDescriptionRow(task, ro) {
  if (!String(task.description ?? '').trim()) return '';
  return `
      <div class="field-row">
        <span class="field-row__label">Description</span>
        <div class="field-row__value">
          <textarea class="drawer__notes" data-task-description rows="2" style="min-height:44px;"${ro}>${escapeHtml(task.description)}</textarea>
        </div>
      </div>`;
}

function renderFieldRows(task, dis, ro) {
  return `
      <div class="field-row">
        <span class="field-row__label">Status</span>
        <div class="field-row__value">${renderStatusPills(task, dis)}</div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Priority</span>
        <div class="field-row__value">${renderPriorityPills(task, dis)}</div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Due</span>
        <div class="field-row__value">
          <input class="date-input" type="date" data-task-due value="${escapeHtml(task.dueDate || '')}"${dis}>
          <button class="pill-btn" type="button" data-action="clear-task-due"${dis}>Clear</button>
        </div>
      </div>
      <div class="field-row">
        <span class="field-row__label">Snooze</span>
        <div class="field-row__value">${renderSnoozeControls(task, dis)}</div>
      </div>${renderDescriptionRow(task, ro)}`;
}

// Snooze hides a task from Today until a future moment. When snoozed, show the
// target date + Unsnooze; otherwise offer quick presets. Dates are sliced to
// YYYY-MM-DD so the markup is deterministic (regex-over-HTML tests).
function renderSnoozeControls(task, dis) {
  const id = escapeHtml(task.id);
  const snoozed = Boolean(task.deferredUntil) && new Date(task.deferredUntil) > new Date();
  if (snoozed) {
    return `<span class="snooze-until">Until ${escapeHtml(String(task.deferredUntil).slice(0, 10))}</span>`
      + `<button class="pill-btn" type="button" data-action="unsnooze-task" data-task-id="${id}"${dis}>Unsnooze</button>`;
  }
  return `<button class="pill-btn" type="button" data-action="snooze-task" data-snooze="tomorrow" data-task-id="${id}"${dis}>Tomorrow</button>`
    + `<button class="pill-btn" type="button" data-action="snooze-task" data-snooze="week" data-task-id="${id}"${dis}>Next week</button>`;
}

// Notes value: the in-flight draft wins only when it belongs to this task
// (autosave is debounced in main.js; re-renders must not clobber typing).
function notesValue(state, task) {
  if (state && state.taskNotesDraftId === task.id) return state.taskNotesDraft ?? '';
  return task.notes ?? '';
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
    const remove = readOnly
      ? ''
      : `<span data-action="delete-checklist-item" data-item-id="${escapeHtml(item.id)}" title="Delete item">✕</span>`;
    return `
        <button class="check-item${isDone ? ' is-done' : ''}" type="button" data-action="toggle-checklist-item" data-item-id="${escapeHtml(item.id)}" data-completed="${isDone ? 'true' : 'false'}"${dis}>
          <span class="task-check${isDone ? ' is-done' : ''}" aria-hidden="true">${isDone ? '✓' : ''}</span>
          <span class="check-item__label">${escapeHtml(item.label || '')}</span>${remove}
        </button>`;
  }).join('');
  const adder = readOnly ? '' : `
        <div style="display:flex; gap:6px; margin-top:6px;">
          <input class="text-input" type="text" data-checklist-new placeholder="Add checklist item…" autocomplete="off" style="flex:1;">
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

function renderDocsSection(documents, readOnly) {
  const rows = documents.length
    ? documents.map(doc => {
        const type = escapeHtml(doc.documentType || 'note');
        const unlink = readOnly
          ? ''
          : `<span data-action="unlink-task-document" data-document-id="${escapeHtml(doc.id)}" title="Unlink document">✕</span>`;
        return `
        <button class="doc-row" type="button" data-action="open-linked-doc" data-document-id="${escapeHtml(doc.id)}">
          ${icon('doc')}
          <span class="doc-row__title">${escapeHtml(doc.title || 'Untitled document')}</span>
          ${chip(doc.documentType || 'note', `type-${type}`)}${unlink}
        </button>`;
      }).join('')
    : mutedText('No linked runbooks or notes.');
  const linkButton = readOnly
    ? ''
    : '<button class="pill-btn" type="button" data-action="open-link-picker">＋ Link doc</button>';
  return `
      <section class="drawer-section">
        <div class="drawer-section__head"><span>Linked documents</span>${linkButton}</div>${rows}
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

function renderFoot(task, readOnly) {
  const taskId = escapeHtml(task.id);
  const buttons = readOnly
    ? `<button class="btn-outline" type="button" data-action="restore-task" data-task-id="${taskId}">Restore</button>
        <button class="btn-outline btn-outline--danger" type="button" data-action="delete-archived-task" data-task-id="${taskId}">Delete permanently</button>`
    : `<button class="btn-outline btn-outline--danger" type="button" data-action="archive-task" data-task-id="${taskId}">Archive task</button>`;
  return `
      <div class="drawer__foot" style="gap:8px;">
        ${buttons}
      </div>`;
}

function renderHead(task, context, isDone, readOnly) {
  const project = context.project || null;
  const projectColor = escapeHtml((project && project.color) || 'var(--accent)');
  const projectChip = project
    ? chip(project.name || 'Project', 'project',
        `style="background:color-mix(in oklab, ${projectColor} 13%, transparent); color:${projectColor};"`)
    : '';
  const flag = dueFlag(task.dueDate, { done: isDone, now: context.now });
  const dueChip = flag ? chip(flag.label, `due-${flag.bucket}`) : '';
  const chips = `${projectChip}${dueChip}`;
  return `
      <div class="drawer__head">
        <button class="task-check${isDone ? ' is-done' : ''}" type="button" data-action="toggle-task-done" data-task-id="${escapeHtml(task.id)}" aria-pressed="${isDone}" aria-label="Toggle done"${readOnly ? ' disabled' : ''}>${isDone ? '✓' : ''}</button>
        <div style="flex:1; min-width:0;">
          <input class="drawer__title-input${isDone ? ' is-done' : ''}" type="text" data-task-title value="${escapeHtml(task.title || '')}" aria-label="Task title" autocomplete="off" spellcheck="false"${readOnly ? ' readonly' : ''}>
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
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Task detail" data-task-id="${escapeHtml(task.id)}">${renderHead(task, context, isDone, readOnly)}
      <div class="drawer__scroll">${renderFieldRows(task, dis, ro)}${renderNotesSection(state, task, dis)}${renderChecklistSection(checklist, readOnly, dis)}${renderDocsSection(documents, readOnly)}${renderActivitySection(activity)}
      </div>${renderFoot(task, readOnly)}
    </aside>`;
}
