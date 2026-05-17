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

function priorityLabel(priority) {
  const normalized = String(priority || 'medium').toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'low') return 'Low';
  return 'Medium';
}

function renderMetaItem(label, value) {
  return `
        <div>
          <dt>${label}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>`;
}

function renderDetailBlock(title, text) {
  return `
      <section class="detail-block">
        <h3>${title}</h3>
        <p>${text}</p>
      </section>`;
}

export function renderTaskDetailHtml(task) {
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
  const priority = priorityLabel(task.priority);
  const status = labelFromValue(task.status || 'planned') || 'Planned';
  const dueDate = task.dueDate || '-';

  return `
    <aside class="detail-panel" aria-labelledby="selected-task-title">
      <header class="detail-header">
        <span class="detail-kicker">Selected Task</span>
        <h2 id="selected-task-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        <div class="detail-actions">
          <button class="secondary-action" type="button" data-action="edit-task">Edit</button>
          <button class="danger-action" type="button" data-action="archive-task">Archive</button>
        </div>
      </header>

      <dl class="detail-meta" aria-label="Task metadata">${renderMetaItem('Priority', priority)}${renderMetaItem('Status', status)}${renderMetaItem('Due', dueDate)}
      </dl>

      <div class="detail-body">${renderDetailBlock('Checklist', 'Checklist items will be tracked here as execution details are added.')}${renderDetailBlock('Notes', 'Operational notes and handoff context will appear here.')}${renderDetailBlock('Activity', 'Task history will show recent changes when activity tracking is enabled.')}
      </div>
    </aside>`;
}
