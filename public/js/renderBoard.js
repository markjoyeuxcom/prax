function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COLUMNS = [
  { id: 'high-priority', label: 'HIGH PRIORITY' },
  { id: 'in-progress',   label: 'IN PROGRESS' },
  { id: 'planned',       label: 'PLANNED' },
  { id: 'completed',     label: 'COMPLETED' },
  { id: 'notes',         label: 'NOTES' },
];

function priorityClass(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'hi';
  if (p === 'low') return 'lo';
  return 'md';
}

function renderCard(task, selectedTaskId) {
  const pClass = priorityClass(task.priority);
  const isSel = task.id === selectedTaskId;
  return `
        <button class="board-card board-card--${pClass}${isSel ? ' is-selected' : ''}" type="button" data-board-card="true" data-task-id="${escapeHtml(task.id)}" draggable="true"${isSel ? ' aria-current="true"' : ''}>
          <strong class="board-card__title">${escapeHtml(task.title || 'Untitled task')}</strong>
          <span class="board-card__meta">${escapeHtml(String(task.priority || 'medium'))} · ${escapeHtml(task.dueDate || '—')}</span>
        </button>`;
}

function renderColumnCards(tasks, columnId, selectedTaskId) {
  const columnTasks = tasks
    .filter(t => (t.status || t.column || 'planned') === columnId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (!columnTasks.length) return '<div class="board-empty">[ no cards ]</div>';
  return columnTasks.map(t => renderCard(t, selectedTaskId)).join('');
}

export function renderBoardHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const openSections = options.boardOpenSections || {};
  return `
    <section class="board-panel" aria-label="Task board">
      ${COLUMNS.map(col => {
        const isOpen = openSections[col.id] !== false;
        const cards = renderColumnCards(safe, col.id, selectedTaskId);
        const count = safe.filter(t => (t.status || t.column || 'planned') === col.id).length;
        return `
        <section class="board-column board-column--${isOpen ? 'open' : 'closed'}" aria-label="${col.label}" data-board-column="${col.id}">
          <header class="board-column__header">
            <button class="board-column__toggle" type="button" data-action="toggle-board-section" data-section="${col.id}" aria-label="Toggle ${col.label}" aria-expanded="${isOpen}" aria-controls="board-cards-${col.id}">
              <span class="board-column__glyph">${isOpen ? '▾' : '▸'}</span>
              <span class="board-column__title">[ ${col.label} ]</span>
              <span class="board-column__count">${count}</span>
            </button>
          </header>
          <div class="board-cards" id="board-cards-${col.id}" data-board-column="${col.id}"${isOpen ? '' : ' hidden'}>${cards}
          </div>
        </section>`;
      }).join('')}
    </section>`;
}
