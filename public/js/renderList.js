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

function priorityClass(priority) {
  const normalized = String(priority || 'medium').toLowerCase();
  if (normalized === 'high' || normalized === 'low') return normalized;
  return 'medium';
}

function renderRows(tasks, selectedTaskId, emptyTitle, emptyDescription) {
  if (!tasks.length) {
    return `
        <div class="task-empty" role="status">
          <strong>${escapeHtml(emptyTitle)}</strong>
          <span>${escapeHtml(emptyDescription)}</span>
        </div>`;
  }

  return tasks.map((task) => {
    const isSelected = task.id === selectedTaskId;
    const description = task.description || 'No description';
    const priority = priorityLabel(task.priority);
    const status = labelFromValue(task.status || 'planned') || 'Planned';
    const dueDate = task.dueDate || '-';

    return `
        <button
          class="task-row${isSelected ? ' is-selected' : ''}"
          type="button"
          data-task-id="${escapeHtml(task.id)}"
          ${isSelected ? 'aria-current="true"' : ''}
        >
          <span class="task-name">
            <strong>${escapeHtml(task.title || 'Untitled task')}</strong>
            <small>${escapeHtml(description)}</small>
          </span>
          <span class="priority-badge priority-badge--${priorityClass(task.priority)}">${priority}</span>
          <span class="task-status">${escapeHtml(status)}</span>
          <span class="task-due">${escapeHtml(dueDate)}</span>
        </button>`;
  }).join('');
}

export function renderListHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const title = options.title || 'Task Queue';
  const countLabel = options.countLabel || 'active tasks';
  const emptyTitle = options.emptyTitle || 'No tasks in this queue';
  const emptyDescription = options.emptyDescription || 'New operational work will appear here when it is added.';
  const activeSwitch = options.activeSwitch || 'List';

  return `
    <section class="task-panel" aria-labelledby="task-queue-title">
      <header class="panel-header">
        <div>
          <h2 id="task-queue-title">${escapeHtml(title)}</h2>
          <p>${safeTasks.length} ${escapeHtml(countLabel)}</p>
        </div>
        <div class="view-switch" aria-label="Workspace view">
          <span class="${activeSwitch === 'List' ? 'is-active' : ''}">List</span>
          <span class="${activeSwitch === 'Board' ? 'is-active' : ''}">Board</span>
        </div>
      </header>

      <div class="task-table" role="table" aria-label="Task queue">
        <div class="task-row task-row--header" role="row">
          <span>Task</span>
          <span>Priority</span>
          <span>Status</span>
          <span>Due</span>
        </div>${renderRows(safeTasks, selectedTaskId, emptyTitle, emptyDescription)}
      </div>
    </section>`;
}
