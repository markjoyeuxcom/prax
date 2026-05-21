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

function renderLaneColumns(laneTasks, selectedTaskId, ctx) {
  return COLUMNS.map(col => {
    const cards = renderColumnCards(laneTasks, col.id, selectedTaskId, ctx);
    const count = laneTasks.filter(t => (t.status || t.column || 'planned') === col.id).length;
    return `
        <section class="board-column board-column--open" aria-label="${col.label}" data-board-column="${col.id}">
          <header class="board-column__header">
            <span class="board-column__title">[ ${col.label} ]</span>
            <span class="board-column__count">${count}</span>
          </header>
          <div class="board-cards" data-board-column="${col.id}">${cards}
          </div>
        </section>`;
  }).join('');
}

export function renderSwimlaneBoardHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const projects = Array.isArray(options.projects) ? options.projects : [];
  const collapsed = options.boardLaneCollapsed || {};
  const ctx = {
    today: options.today || localToday(),
    showProjectChips: false,
    projectName: () => '',
  };

  const lanes = projects
    .map(project => ({ project, tasks: safe.filter(t => t.projectId === project.id) }))
    .filter(lane => lane.tasks.length > 0);

  const known = new Set(projects.map(p => p.id));
  const orphans = safe.filter(t => !known.has(t.projectId));
  if (orphans.length) lanes.push({ project: { id: '__none__', name: 'No project' }, tasks: orphans });

  if (!lanes.length) {
    return `<section class="board-swimlanes" aria-label="Task board"><p class="board-empty">[ no tasks ]</p></section>`;
  }

  return `
    <section class="board-swimlanes" aria-label="Task board">
      ${lanes.map(({ project, tasks: laneTasks }) => {
        const isCollapsed = collapsed[project.id] === true;
        return `
        <section class="board-lane${isCollapsed ? ' board-lane--collapsed' : ''}" data-board-lane="${escapeHtml(project.id)}">
          <header class="board-lane__header">
            <button class="board-lane__toggle" type="button" data-action="toggle-board-lane" data-project-id="${escapeHtml(project.id)}" aria-label="Toggle ${escapeHtml(project.name)}" aria-expanded="${!isCollapsed}">
              <span class="board-lane__glyph">${isCollapsed ? '▸' : '▾'}</span>
              <span class="board-lane__name">${escapeHtml(project.name)}</span>
              <span class="board-lane__count">· ${laneTasks.length}</span>
            </button>
          </header>
          ${isCollapsed ? '' : `<div class="board-panel">${renderLaneColumns(laneTasks, selectedTaskId, ctx)}</div>`}
        </section>`;
      }).join('')}
    </section>`;
}

export function renderBoardToolbar(grouping = 'flat') {
  const option = (value, label) =>
    `<button class="board-toolbar__option" type="button" data-action="set-board-grouping" data-grouping="${value}" aria-pressed="${grouping === value}">${label}</button>`;
  return `
    <div class="board-toolbar">
      <span class="board-toolbar__label">Group</span>
      <div class="board-toolbar__group">${option('flat', 'flat')}${option('swimlanes', 'swimlanes')}</div>
    </div>`;
}
