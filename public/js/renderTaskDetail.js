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

function renderDetailBlock(title, text) {
  return `
      <section class="detail-block">
        <h3>${title}</h3>
        <p>${text}</p>
      </section>`;
}

function renderLinkedDocs(linkedDocuments = [], options = {}) {
  const readOnly = Boolean(options.readOnly);
  const rows = linkedDocuments.length
    ? linkedDocuments.map(doc => `
        <div class="linked-doc" data-linked-doc-id="${escapeHtml(doc.id)}">
          <button class="linked-doc__open" type="button" data-action="open-linked-doc" data-document-id="${escapeHtml(doc.id)}" data-document-context="${escapeHtml(doc.context)}">
            <strong>${escapeHtml(doc.title || 'Untitled document')}</strong>
            <small>${escapeHtml(labelFromValue(doc.documentType || 'note'))}</small>
          </button>
          ${readOnly ? '' : `<button class="linked-doc__unlink bracket-button bracket-button--quiet" type="button" data-action="unlink-document" data-document-id="${escapeHtml(doc.id)}" aria-label="Unlink ${escapeHtml(doc.title || 'document')}">[x]</button>`}
        </div>`).join('')
    : '<p class="linked-docs__empty">No linked runbooks or notes.</p>';

  return `
      <section class="detail-block">
        <div class="detail-block__head">
          <h3>Linked docs</h3>
          ${readOnly ? '' : '<button class="bracket-button bracket-button--quiet" type="button" data-action="open-link-picker">[+] link doc</button>'}
        </div>
        <div class="linked-docs">${rows}</div>
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

  const priorityBadge = `<span class="bracket-badge bracket-badge--${pClass}">[ ${pLabel} ]</span>`;

  return `
    <aside class="detail-panel" aria-labelledby="selected-task-title">
      <header class="detail-header">
        ${options.mobileDetailOpen ? `<button class="detail-back bracket-button bracket-button--quiet" type="button" data-action="close-mobile-detail" aria-label="Back">← back</button>` : ''}
        <span class="detail-kicker">Selected Task</span>
        <h2 id="selected-task-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        ${actionsFor(options)}
      </header>

      <dl class="detail-meta" aria-label="Task metadata">${renderMetaItem('Priority', priorityBadge)}${renderMetaItem('Status', escapeHtml(status))}${renderMetaItem('Due', escapeHtml(dueDate))}
      </dl>

      <div class="detail-body">${renderLinkedDocs(options.linkedDocuments, options)}${renderDetailBlock('Checklist', 'Checklist items will be tracked here as execution details are added.')}${renderDetailBlock('Notes', 'Operational notes and handoff context will appear here.')}${renderDetailBlock('Activity', 'Task history will show recent changes when activity tracking is enabled.')}
      </div>
    </aside>`;
}
