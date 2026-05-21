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

function localToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Classify a due date relative to today so the card can flag overdue/soon work.
// Returns { cls, full, label, flag } — `label` is the compact MM-DD shown on the
// card (narrow columns), `full` is the ISO date kept as a tooltip. cls is one of
// none|over|soon|ok.
function shortDate(dueDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate.slice(5) : dueDate;
}

function dueState(dueDate, today) {
  if (!dueDate) return { cls: 'none', full: '', label: '—', flag: '' };
  const short = shortDate(dueDate);
  const due = new Date(`${dueDate}T00:00:00`);
  const ref = new Date(`${today}T00:00:00`);
  const days = Math.round((due.getTime() - ref.getTime()) / 86400000);
  if (!Number.isFinite(days)) return { cls: 'ok', full: dueDate, label: short, flag: '' };
  if (days < 0) return { cls: 'over', full: dueDate, label: short, flag: ' ⚠' };
  if (days <= 2) return { cls: 'soon', full: dueDate, label: short, flag: '' };
  return { cls: 'ok', full: dueDate, label: short, flag: '' };
}

function renderCard(task, selectedTaskId, ctx) {
  const pClass = priorityClass(task.priority);
  const isSel = task.id === selectedTaskId;
  const due = dueState(task.dueDate, ctx.today);
  const projectName = ctx.showProjectChips ? ctx.projectName(task.projectId) : '';
  const chip = projectName
    ? `<span class="board-card__chip">${escapeHtml(projectName)}</span>`
    : '';
  return `
        <button class="board-card board-card--${pClass}${isSel ? ' is-selected' : ''}" type="button" data-board-card="true" data-task-id="${escapeHtml(task.id)}" draggable="true"${isSel ? ' aria-current="true"' : ''}>
          <span class="board-card__row">
            <span class="board-card__id"><span class="board-card__dot board-card__dot--${pClass}" aria-hidden="true"></span><strong class="board-card__title">${escapeHtml(task.title || 'Untitled task')}</strong></span>
            <span class="board-card__due board-card__due--${due.cls}"${due.full ? ` title="${escapeHtml(due.full)}"` : ''}>${escapeHtml(due.label)}${due.flag}</span>
          </span>${chip}
        </button>`;
}

function renderColumnCards(tasks, columnId, selectedTaskId, ctx) {
  const columnTasks = tasks
    .filter(t => (t.status || t.column || 'planned') === columnId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (!columnTasks.length) return '<div class="board-empty">[ no cards ]</div>';
  return columnTasks.map(t => renderCard(t, selectedTaskId, ctx)).join('');
}

export function renderBoardHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const openSections = options.boardOpenSections || {};
  const projectsById = new Map(
    (Array.isArray(options.projects) ? options.projects : []).map(p => [p.id, p.name]),
  );
  const ctx = {
    today: options.today || localToday(),
    showProjectChips: Boolean(options.showProjectChips),
    projectName: (id) => projectsById.get(id) || '',
  };
  return `
    <section class="board-panel" aria-label="Task board">
      ${COLUMNS.map(col => {
        const isOpen = openSections[col.id] !== false;
        const cards = renderColumnCards(safe, col.id, selectedTaskId, ctx);
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
