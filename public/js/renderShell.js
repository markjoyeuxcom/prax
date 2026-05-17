const viewButtons = [
  {
    id: 'list',
    label: 'Today',
    heading: 'Today',
    description: 'Coordinate urgent work, homelab maintenance, and operational follow-through from one calm queue.',
  },
  {
    id: 'board',
    label: 'Board',
    heading: 'Board',
    description: 'Track active work by status when a column view gives the clearest picture.',
  },
  {
    id: 'backlog',
    label: 'Backlog',
    heading: 'Backlog',
    description: 'Review planned work that is not demanding immediate operational attention.',
  },
  {
    id: 'archive',
    label: 'Archive',
    heading: 'Archive',
    description: 'Inspect completed or archived work without cluttering the active queue.',
  },
];

const contextButtons = [
  { id: 'personal', label: 'Personal' },
  { id: 'work', label: 'Work' },
  { id: 'homelab', label: 'Homelab' },
];

const metricCards = [
  { key: 'dueToday', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'completedThisWeek', label: 'Completed this week' },
];

function metricValue(metrics, key) {
  const value = Number(metrics?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function viewFor(activeView) {
  return viewButtons.find((view) => view.id === activeView) || viewButtons[0];
}

function renderViewButtons(activeView) {
  const activeViewConfig = viewFor(activeView);
  return viewButtons.map((view) => {
    const isActive = activeViewConfig.id === view.id;
    return `
          <button class="nav-button${isActive ? ' is-active' : ''}" type="button" aria-pressed="${isActive}" data-view="${view.id}">
            <span>${view.label}</span>
          </button>`;
  }).join('');
}

function renderContextButtons(activeContext) {
  return contextButtons.map((context) => {
    const isActive = activeContext === context.id;
    return `
          <button class="nav-button${isActive ? ' is-active' : ''}" type="button" aria-pressed="${isActive}" data-context="${context.id}">
            <span>${context.label}</span>
          </button>`;
  }).join('');
}

function renderMetricCards(metrics) {
  return metricCards.map((metric) => `
          <article class="metric-card">
            <span class="metric-label">${metric.label}</span>
            <strong>${metricValue(metrics, metric.key)}</strong>
          </article>`).join('');
}

function apiStatusLabel(apiStatus) {
  if (apiStatus === 'error') return 'Offline';
  if (apiStatus === 'loading') return 'Checking';
  return 'Online';
}

export function renderShellHtml({
  activeContext = 'homelab',
  activeView = 'list',
  apiStatus = 'connected',
  searchQuery = '',
  metrics = {},
} = {}) {
  const activeViewConfig = viewFor(activeView);

  return `
    <div class="app-shell">
      <aside class="sidebar" aria-label="TaskBoard navigation">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">T</span>
          <span class="brand-name">TaskBoard</span>
        </div>

        <nav class="side-nav" aria-label="Views">
          <p class="nav-label">Views</p>${renderViewButtons(activeView)}
        </nav>

        <nav class="side-nav" aria-label="Contexts">
          <p class="nav-label">Contexts</p>${renderContextButtons(activeContext)}
        </nav>

        <section class="cluster-card" aria-label="Cluster status">
          <div class="cluster-card__header">
            <span>Cluster</span>
            <span class="status-dot" aria-hidden="true"></span>
          </div>
          <dl class="status-list">
            <div>
              <dt>API</dt>
              <dd>${apiStatusLabel(apiStatus)}</dd>
            </div>
            <div>
              <dt>Postgres</dt>
              <dd>Synced</dd>
            </div>
            <div>
              <dt>Backup</dt>
              <dd>Ready</dd>
            </div>
          </dl>
        </section>
      </aside>

      <main class="console-main">
        <header class="topbar">
          <label class="search-field">
            <span class="sr-only">Search tasks</span>
            <input type="search" placeholder="Search tasks" autocomplete="off" value="${escapeHtml(searchQuery)}" data-search-input>
          </label>
          <div class="topbar-actions">
            <button class="secondary-action" type="button" data-action="export">Export</button>
            <button class="secondary-action" type="button" data-action="import">Import</button>
            <button class="primary-action" type="button" data-action="new-task">New Task</button>
          </div>
        </header>

        <section class="content-header" aria-labelledby="view-title">
          <div>
            <h1 id="view-title">${activeViewConfig.heading}</h1>
            <p>${activeViewConfig.description}</p>
          </div>
          <span class="sync-pill">Synced</span>
        </section>

        <section class="metrics-row" aria-label="Task metrics">${renderMetricCards(metrics)}
        </section>

        <div id="workspace" class="workspace"></div>
      </main>
    </div>`;
}
