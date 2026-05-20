function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function renderCard(task, selectedTaskId) {
  const isSelected = task.id === selectedTaskId;
  const pClass = priorityClass(task.priority);
  const pLabel = priorityLabel(task.priority);
  const desc = task.description || '';
  const due = task.dueDate ? `due <strong>${escapeHtml(task.dueDate)}</strong>` : 'no due';
  const status = String(task.status || 'planned').replace(/-/g, ' ');
  const tags = (task.tags || []).filter(Boolean);
  const tagLine = tags.length
    ? `<div class="task-card__tags">${tags.map(t => `#${escapeHtml(t)}`).join(' ')}</div>`
    : '';

  return `
    <button class="task-card task-card--${pClass}${isSelected ? ' is-selected' : ''}" type="button" data-task-id="${escapeHtml(task.id)}"${isSelected ? ' aria-current="true"' : ''}>
      <div class="task-card__line1">
        <strong class="task-card__title">${escapeHtml(task.title || 'Untitled task')}</strong>
        <span class="bracket-badge bracket-badge--${pClass}">[ ${pLabel} ]</span>
      </div>
      <div class="task-card__line2">${escapeHtml(status)} · ${due}${desc ? ` · ${escapeHtml(desc)}` : ''}</div>
      ${tagLine}
    </button>`;
}

function renderCards(tasks, selectedTaskId, emptyTitle, emptyDescription) {
  if (!tasks.length) {
    return `
      <div class="task-list--empty" role="status">
        <strong>[ ${escapeHtml(emptyTitle || 'no tasks').toLowerCase()} ]</strong>
        <span>${escapeHtml(emptyDescription || '')}</span>
      </div>`;
  }
  return tasks.map(t => renderCard(t, selectedTaskId)).join('');
}

export function renderListHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const title = options.title || 'Task Queue';
  const countLabel = options.countLabel || 'active tasks';

  return `
    <section class="task-panel" aria-labelledby="task-queue-title">
      <header class="panel-header">
        <div>
          <h2 id="task-queue-title">${escapeHtml(title)}</h2>
          <p>${safeTasks.length} ${escapeHtml(countLabel)}</p>
        </div>
      </header>
      <div class="task-list">${renderCards(safeTasks, selectedTaskId, options.emptyTitle, options.emptyDescription)}
      </div>
    </section>`;
}
