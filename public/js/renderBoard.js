const COLUMNS = [
  { id: 'high-priority', label: 'High Priority' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'planned', label: 'Planned' },
  { id: 'completed', label: 'Completed' },
  { id: 'notes', label: 'Notes' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function priorityLabel(priority) {
  const normalized = String(priority || 'medium').toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'low') return 'Low';
  return 'Medium';
}

function renderCard(task, selectedTaskId) {
  const isSelected = task.id === selectedTaskId;
  const dueDate = task.dueDate || '-';

  return `
        <button class="board-card${isSelected ? ' is-selected' : ''}" type="button" data-task-id="${escapeHtml(task.id)}"${isSelected ? ' aria-current="true"' : ''}>
          <strong>${escapeHtml(task.title || 'Untitled task')}</strong>
          <span>${escapeHtml(task.description || 'No description')}</span>
          <small>${priorityLabel(task.priority)} · ${escapeHtml(dueDate)}</small>
        </button>`;
}

function renderCards(tasks, column, selectedTaskId) {
  const columnTasks = tasks.filter(task => (task.status || task.column || 'planned') === column.id);
  if (!columnTasks.length) {
    return '<div class="board-empty">No tasks</div>';
  }

  return columnTasks.map(task => renderCard(task, selectedTaskId)).join('');
}

export function renderBoardHtml(tasks = [], selectedTaskId = null) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  return `
    <section class="board-panel" aria-label="Task board">
      ${COLUMNS.map(column => `
        <section class="board-column" aria-label="${column.label}">
          <header>
            <h2>${column.label}</h2>
            <span>${safeTasks.filter(task => (task.status || task.column || 'planned') === column.id).length}</span>
          </header>
          <div class="board-cards">${renderCards(safeTasks, column, selectedTaskId)}
          </div>
        </section>`).join('')}
    </section>`;
}
