function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelFromValue(value) {
  return String(value ?? '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function priorityClass(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'hi';
  if (p === 'low') return 'lo';
  return 'md';
}

function priorityLabel(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'HIGH';
  if (p === 'low') return 'LOW';
  return 'MED';
}

function renderMetaItem(label, value) {
  return `
        <div>
          <dt>${label}</dt>
          <dd>${value}</dd>
        </div>`;
}

function normalizedDetailTab(value) {
  return ['summary', 'work', 'activity'].includes(value) ? value : 'work';
}

function normalizedDetailSection(value) {
  return ['summary', 'docs', 'checklist', 'notes', 'activity'].includes(value) ? value : 'docs';
}

function renderDetailSectionRail(activeSection) {
  const items = [
    ['summary', 'Summary'],
    ['docs', 'Docs'],
    ['checklist', 'Checklist'],
    ['notes', 'Notes'],
    ['activity', 'Activity'],
  ];
  return `
      <nav class="detail-section-rail" aria-label="Task sections">
        ${items.map(([id, label]) => `<button class="detail-section-rail__item" type="button" data-action="set-task-detail-section" data-section="${id}" aria-pressed="${activeSection === id}">${escapeHtml(label)}</button>`).join('')}
      </nav>`;
}

function renderDetailMobileTabs(activeTab) {
  const tabs = [
    ['summary', 'summary'],
    ['work', 'work'],
    ['activity', 'activity'],
  ];
  return `
      <nav class="detail-mobile-tabs" aria-label="Task detail sections">
        ${tabs.map(([tab, label]) => `<button class="detail-mobile-tabs__tab" type="button" data-action="set-task-detail-tab" data-tab="${tab}" aria-pressed="${activeTab === tab}">${label}</button>`).join('')}
      </nav>`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderSummary(task, options = {}) {
  const linkedDocuments = Array.isArray(options.linkedDocuments) ? options.linkedDocuments : [];
  const checklistItems = Array.isArray(options.checklistItems) ? options.checklistItems : [];
  const activityEvents = Array.isArray(options.activityEvents) ? options.activityEvents : [];
  const done = checklistItems.filter(item => item.completed).length;
  const status = labelFromValue(task.status || 'planned') || 'Planned';
  const latestActivity = activityEvents[0]?.message || 'No activity yet.';
  const notesState = (options.taskNotesDraft ?? task.notes ?? '').trim() ? 'notes captured' : 'no notes';

  return `
      <section class="detail-block detail-summary" id="detail-summary-panel" data-detail-section="summary" data-detail-tab="summary">
        <div class="detail-block__head">
          <h3>Summary</h3>
          <span class="detail-block__count">${escapeHtml(status)}</span>
        </div>
        <p class="detail-summary__description">${escapeHtml(task.description || 'No description')}</p>
        <dl class="detail-summary__grid" aria-label="Summary facts">
          <div>
            <dt>Status</dt>
            <dd class="detail-summary__value">${escapeHtml(status)}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd class="detail-summary__value">${escapeHtml(task.dueDate || '-')}</dd>
          </div>
          <div>
            <dt>Checklist</dt>
            <dd class="detail-summary__value">${done}/${checklistItems.length} done</dd>
          </div>
          <div>
            <dt>Docs</dt>
            <dd class="detail-summary__value">${pluralize(linkedDocuments.length, 'linked doc')}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd class="detail-summary__value">${notesState}</dd>
          </div>
          <div>
            <dt>Latest</dt>
            <dd class="detail-summary__value">${escapeHtml(latestActivity)}</dd>
          </div>
        </dl>
      </section>`;
}

function renderLinkedDocs(linkedDocuments = [], options = {}) {
  const readOnly = Boolean(options.readOnly);
  const rows = linkedDocuments.length
    ? linkedDocuments.map(doc => `
        <div class="linked-doc" data-linked-doc-id="${escapeHtml(doc.id)}">
          <button class="linked-doc__open" type="button" data-action="open-linked-doc" data-document-id="${escapeHtml(doc.id)}">
            <strong>${escapeHtml(doc.title || 'Untitled document')}</strong>
            <small>${escapeHtml(labelFromValue(doc.documentType || 'note'))}</small>
          </button>
          ${readOnly ? '' : `<button class="linked-doc__unlink bracket-button bracket-button--quiet" type="button" data-action="unlink-document" data-document-id="${escapeHtml(doc.id)}" aria-label="Unlink ${escapeHtml(doc.title || 'document')}">[x]</button>`}
        </div>`).join('')
    : '<p class="linked-docs__empty">No linked runbooks or notes.</p>';

  return `
      <section class="detail-block" id="detail-docs" data-detail-section="docs" data-detail-tab="work">
        <div class="detail-block__head">
          <h3>Linked docs</h3>
          ${readOnly ? '' : '<button class="bracket-button bracket-button--quiet" type="button" data-action="open-link-picker">[+] link doc</button>'}
        </div>
        <div class="linked-docs">${rows}</div>
      </section>`;
}

function renderChecklist(items = [], options = {}) {
  const readOnly = Boolean(options.readOnly);
  const done = items.filter(i => i.completed).length;
  const rows = items.length
    ? items.map(item => `
        <div class="checklist-item${item.completed ? ' is-done' : ''}" data-checklist-id="${escapeHtml(item.id)}">
          ${readOnly
            ? `<span class="checklist-item__mark">${item.completed ? '[x]' : '[ ]'}</span>`
            : `<button class="checklist-item__toggle bracket-button bracket-button--quiet" type="button" data-action="toggle-checklist-item" data-item-id="${escapeHtml(item.id)}" data-completed="${item.completed ? 'true' : 'false'}" aria-label="${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${escapeHtml(item.label || '')}">${item.completed ? '[x]' : '[ ]'}</button>`}
          <span class="checklist-item__label">${escapeHtml(item.label || '')}</span>
          ${readOnly ? '' : `<button class="checklist-item__delete bracket-button bracket-button--quiet" type="button" data-action="delete-checklist-item" data-item-id="${escapeHtml(item.id)}" aria-label="Delete: ${escapeHtml(item.label || '')}">[del]</button>`}
        </div>`).join('')
    : '<p class="checklist__empty">No checklist items.</p>';
  const adder = readOnly ? '' : `
        <div class="checklist-add">
          <input type="text" class="checklist-add__input" data-checklist-new placeholder="Add a checklist item" autocomplete="off">
          <button class="bracket-button bracket-button--quiet" type="button" data-action="add-checklist-item">[+] add</button>
        </div>`;
  return `
      <section class="detail-block" id="detail-checklist" data-detail-section="checklist" data-detail-tab="work">
        <div class="detail-block__head">
          <h3>Checklist</h3>
          <span class="detail-block__count">${done}/${items.length}</span>
        </div>
        <div class="checklist">${rows}</div>${adder}
      </section>`;
}

function formatActivityTime(createdAt) {
  const value = String(createdAt || '');
  if (value.length >= 16 && value.includes('T')) return value.slice(0, 16).replace('T', ' ');
  return value.slice(0, 10);
}

function renderActivity(events = []) {
  const rows = events.length
    ? events.map(e => `
        <div class="activity-item">
          <span class="activity-item__msg">${escapeHtml(e.message || '')}</span>
          <span class="activity-item__time">${escapeHtml(formatActivityTime(e.createdAt))}</span>
        </div>`).join('')
    : '<p class="activity__empty">No activity yet.</p>';
  return `
      <section class="detail-block" id="detail-activity" data-detail-section="activity" data-detail-tab="activity">
        <h3>Activity</h3>
        <div class="activity">${rows}</div>
      </section>`;
}

function renderNotes(task, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const notes = options.taskNotesDraft ?? task.notes ?? '';
  const isDirty = Boolean(options.isTaskNotesDirty);
  const status = isDirty ? 'dirty · local edit' : (options.taskNotesSaveStatus || 'saved');
  const savedAt = options.taskNotesSavedAt ? `last saved ${escapeHtml(options.taskNotesSavedAt)}` : 'not saved this session';
  if (readOnly) {
    return `
      <section class="detail-block" id="detail-notes" data-detail-section="notes" data-detail-tab="work">
        <h3>Notes</h3>
        <p>${notes ? escapeHtml(notes) : 'No notes.'}</p>
      </section>`;
  }
  return `
      <section class="detail-block" id="detail-notes" data-detail-section="notes" data-detail-tab="work">
        <div class="detail-block__head">
          <h3>Notes</h3>
          <div class="detail-block__actions">
            ${isDirty ? '<button class="bracket-button bracket-button--quiet" type="button" data-action="discard-task-notes">[esc] discard</button>' : ''}
            <button class="bracket-button bracket-button--quiet" type="button" data-action="save-task-notes"${isDirty ? '' : ' disabled'}>[s] save</button>
          </div>
        </div>
        <div class="detail-notes-shell${isDirty ? ' is-dirty' : ''}">
          <textarea class="detail-notes" data-task-notes rows="4" placeholder="Operational notes and handoff context…">${escapeHtml(notes)}</textarea>
          <div class="detail-notes-status">
            <span data-task-notes-status>${escapeHtml(status)}</span>
            <span>${savedAt}</span>
          </div>
        </div>
      </section>`;
}

function actionsFor(options) {
  const readOnly = Boolean(options.readOnly);
  const restoreAction = Boolean(options.restoreAction);
  const deleteAction = Boolean(options.deleteAction);
  if (restoreAction) {
    return `
        <div class="detail-actions">
          <button class="bracket-button bracket-button--quiet" type="button" data-action="restore-task">[r] restore</button>
          ${deleteAction ? '<button class="bracket-button bracket-button--danger" type="button" data-action="delete-archived-task">[!] delete</button>' : ''}
        </div>`;
  }
  if (readOnly) return '';
  return `
        <div class="detail-actions">
          <button class="bracket-button" type="button" data-action="edit-task">[e] edit</button>
          <button class="bracket-button bracket-button--danger" type="button" data-action="archive-task">[d] archive</button>
        </div>`;
}

export function renderTaskDetailHtml(task, options = {}) {
  if (!task) {
    return `
    <aside class="detail-panel detail-panel--empty" aria-label="Task detail">
      <div class="detail-empty">
        <h2>No task selected</h2>
        <p>Select a task from the queue to inspect its operational context.</p>
      </div>
    </aside>`;
  }

  const title = task.title || 'Untitled task';
  const description = task.description || 'No description';
  const pClass = priorityClass(task.priority);
  const pLabel = priorityLabel(task.priority);
  const status = labelFromValue(task.status || 'planned') || 'Planned';
  const dueDate = task.dueDate || '-';
  const activeTab = normalizedDetailTab(options.activeTaskDetailTab);
  const activeSection = normalizedDetailSection(options.activeTaskDetailSection);

  const priorityBadge = `<span class="bracket-badge bracket-badge--${pClass}">[ ${pLabel} ]</span>`;

  return `
    <aside class="detail-panel" aria-labelledby="selected-task-title" data-active-detail-tab="${escapeHtml(activeTab)}" data-active-detail-section="${escapeHtml(activeSection)}">
      <header class="detail-header" id="detail-summary" data-detail-section="summary" data-detail-tab="summary">
        ${options.closeAction ? `<button class="detail-close bracket-button bracket-button--quiet" type="button" data-action="${escapeHtml(options.closeAction)}" aria-label="Close task detail">[x] close</button>` : ''}
        ${options.mobileDetailOpen ? `<button class="detail-back bracket-button bracket-button--quiet" type="button" data-action="close-mobile-detail" aria-label="Back">← back</button>` : ''}
        <span class="detail-kicker">Selected Task</span>
        <h2 id="selected-task-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        ${actionsFor(options)}
      </header>

      <dl class="detail-meta" aria-label="Task metadata">${renderMetaItem('Priority', priorityBadge)}${renderMetaItem('Status', escapeHtml(status))}${renderMetaItem('Due', escapeHtml(dueDate))}
      </dl>

      ${renderDetailSectionRail(activeSection)}
      ${renderDetailMobileTabs(activeTab)}
      <div class="detail-body">${renderSummary(task, options)}${renderLinkedDocs(options.linkedDocuments, options)}${renderChecklist(options.checklistItems, options)}${renderNotes(task, options)}${renderActivity(options.activityEvents)}
      </div>
    </aside>`;
}
