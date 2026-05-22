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

function renderListPanel(bodyHtml, options = {}) {
  const title = options.title || 'Task Queue';
  const countLabel = options.countLabel || 'active tasks';
  const count = Number.isFinite(options.count) ? options.count : 0;
  const toolbar = options.toolbar || '';

  return `
    <section class="task-panel" aria-labelledby="task-queue-title">
      <header class="panel-header">
        <div>
          <h2 id="task-queue-title">${escapeHtml(title)}</h2>
          <p>${count} ${escapeHtml(countLabel)}</p>
        </div>
        ${toolbar}
      </header>
      ${bodyHtml}
    </section>`;
}

export function renderListHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const body = `<div class="task-list">${renderCards(safeTasks, selectedTaskId, options.emptyTitle, options.emptyDescription)}
      </div>`;
  return renderListPanel(body, { ...options, count: safeTasks.length });
}

function buildProjectLanes(tasks, projects) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeProjects = Array.isArray(projects) ? projects : [];
  const lanes = safeProjects
    .map(project => ({ project, tasks: safeTasks.filter(t => t.projectId === project.id) }))
    .filter(lane => lane.tasks.length > 0);
  const known = new Set(safeProjects.map(p => p.id));
  const orphans = safeTasks.filter(t => !known.has(t.projectId));
  if (orphans.length) lanes.push({ project: { id: '__none__', name: 'No project' }, tasks: orphans });
  return lanes;
}

export function renderSwimlaneListHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const projects = Array.isArray(options.projects) ? options.projects : [];
  const collapsed = options.listLaneCollapsed || {};
  const lanes = buildProjectLanes(safeTasks, projects);

  const body = lanes.length
    ? `<div class="task-lanes">${lanes.map(({ project, tasks: laneTasks }) => {
        const isCollapsed = collapsed[project.id] === true;
        return `
        <section class="task-lane${isCollapsed ? ' task-lane--collapsed' : ''}" data-task-lane="${escapeHtml(project.id)}">
          <header class="task-lane__header">
            <button class="task-lane__toggle" type="button" data-action="toggle-list-lane" data-project-id="${escapeHtml(project.id)}" aria-label="Toggle ${escapeHtml(project.name)}" aria-expanded="${!isCollapsed}">
              <span class="task-lane__glyph">${isCollapsed ? '▸' : '▾'}</span>
              <span class="task-lane__name">${escapeHtml(project.name)}</span>
              <span class="task-lane__count">· ${laneTasks.length}</span>
            </button>
          </header>
          ${isCollapsed ? '' : `<div class="task-lane__cards">${renderCards(laneTasks, selectedTaskId, options.emptyTitle, options.emptyDescription)}</div>`}
        </section>`;
      }).join('')}</div>`
    : `<div class="task-list">${renderCards(safeTasks, selectedTaskId, options.emptyTitle, options.emptyDescription)}</div>`;

  return renderListPanel(body, { ...options, count: safeTasks.length });
}

export function renderListToolbar(grouping = 'flat') {
  const option = (value, label) =>
    `<button class="list-toolbar__option" type="button" data-action="set-list-grouping" data-grouping="${value}" aria-pressed="${grouping === value}">${label}</button>`;
  return `
    <div class="list-toolbar">
      <span class="list-toolbar__label">Group</span>
      <div class="list-toolbar__group">${option('flat', 'flat')}${option('swimlanes', 'swimlanes')}</div>
    </div>`;
}
