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
  {
    id: 'library',
    label: 'Library',
    heading: 'Library',
    description: 'Markdown runbooks and notes for personal, work, and homelab operations.',
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

function modeTagFor(activeView) {
  const tags = {
    list: 'TODAY',
    board: 'BOARD',
    backlog: 'BACKLOG',
    archive: 'ARCHIVE',
    library: 'LIBRARY',
  };
  return tags[activeView] || activeView.toUpperCase();
}

function syncLabelFor(apiStatus) {
  if (apiStatus === 'error') return '<span class="sync-dots sync-dots--off">●○○</span> offline';
  if (apiStatus === 'loading') return '<span class="sync-dots sync-dots--pending">●●○</span> syncing';
  return '<span class="sync-dots sync-dots--ok">●●●</span> ok';
}

function renderHamburgerDrawer({ activeContext, isDrawerOpen, apiStatus }) {
  return `
       <aside class="hamburger-drawer${isDrawerOpen ? ' is-open' : ''}" aria-label="Secondary navigation"${isDrawerOpen ? '' : ' aria-hidden="true" inert'}>
         <header class="hamburger-drawer__header">
           <span class="hamburger-drawer__title">// MENU</span>
           <button class="hamburger-drawer__close" type="button" data-action="toggle-drawer" aria-label="Close menu">×</button>
         </header>
         <div class="hamburger-drawer__group">
           <p class="hamburger-drawer__label">// VIEWS</p>
           <button class="hamburger-drawer__item" type="button" data-view="backlog">backlog</button>
         </div>
         <div class="hamburger-drawer__group">
           <p class="hamburger-drawer__label">// CONTEXTS</p>
           ${['personal', 'work', 'homelab'].map(c => `<button class="hamburger-drawer__item${c === activeContext ? ' is-active' : ''}" type="button" data-context="${c}">${escapeHtml(c)}</button>`).join('')}
         </div>
         <div class="hamburger-drawer__group">
           <p class="hamburger-drawer__label">// ADMIN</p>
           <button class="hamburger-drawer__item" type="button" data-action="open-admin">[a] open admin</button>
           <button class="hamburger-drawer__item" type="button" data-action="open-settings">[~] settings</button>
         </div>
         <div class="hamburger-drawer__group">
           <p class="hamburger-drawer__label">// CLUSTER</p>
           <dl class="hamburger-drawer__status">
             <div><dt>api</dt><dd>${apiStatus === 'connected' ? 'ok' : apiStatus === 'loading' ? 'syncing' : 'offline'}</dd></div>
             <div><dt>db</dt><dd>ok</dd></div>
             <div><dt>backup</dt><dd>ready</dd></div>
           </dl>
         </div>
       </aside>`;
}

function renderBottomNav(activeView) {
  const newAction = activeView === 'library' ? 'new-document' : 'new-task';
  const slots = [
    { key: 'list',    glyph: 'T', label: 'today',   view: 'list',    action: null },
    { key: 'board',   glyph: 'B', label: 'board',   view: 'board',   action: null },
    { key: 'new',     glyph: '+', label: '',        view: null,      action: newAction },
    { key: 'library', glyph: 'L', label: 'library', view: 'library', action: null },
    { key: 'archive', glyph: 'A', label: 'arch',    view: 'archive', action: null },
  ];
  return `
        <nav class="bottom-nav" aria-label="Primary">
          ${slots.map(slot => {
            const isActive = slot.view && slot.view === activeView;
            const attrs = slot.action ? `data-action="${slot.action}"` : `data-view="${slot.view}"`;
            const slotClasses = ['bottom-nav__slot'];
            if (isActive) slotClasses.push('is-active');
            if (slot.key === 'new') slotClasses.push('bottom-nav__slot--add');
            return `<button data-bottom-nav="${slot.key}" class="${slotClasses.join(' ')}" type="button" ${attrs}>
              <span class="bottom-nav__glyph">${slot.glyph}</span>
              <span class="bottom-nav__label">${slot.label}</span>
            </button>`;
          }).join('')}
        </nav>`;
}

function renderViewButtons(activeView) {
  const activeViewConfig = viewFor(activeView);
  const primaryAction = activeViewConfig.id === 'library'
    ? { action: 'new-document', label: 'New Document' }
    : { action: 'new-task', label: 'New Task' };
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
  isDrawerOpen = false,
} = {}) {
  const activeViewConfig = viewFor(activeView);
  const isLibraryView = activeViewConfig.id === 'library';
  const primaryAction = activeViewConfig.id === 'library'
    ? { action: 'new-document', label: 'New Document' }
    : { action: 'new-task', label: 'New Task' };
  const metricsHtml = isLibraryView ? '' : `
        <section class="metrics-row" aria-label="Task metrics">${renderMetricCards(metrics)}
        </section>`;

  return `
    <div class="app-shell">
      ${renderHamburgerDrawer({ activeContext, isDrawerOpen, apiStatus })}
      <aside class="sidebar" aria-label="Moomora Console navigation">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">M</span>
          <span class="brand-name">Moomora Console</span>
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

      <main class="console-main${isLibraryView ? ' console-main--library' : ''}">
        <header class="topbar">
          <button class="hamburger-trigger" type="button" data-action="toggle-drawer" aria-label="Menu">≡</button>
          <label class="search-field">
            <span class="sr-only">${isLibraryView ? 'Search documents' : 'Search tasks'}</span>
            <input type="search" placeholder="${isLibraryView ? 'Search documents' : 'Search tasks'}" autocomplete="off" value="${escapeHtml(searchQuery)}" data-search-input>
          </label>
          <div class="topbar-actions">
            <button type="button" data-action="open-settings" class="bracket-button">[~] settings</button>
            <button type="button" data-action="open-admin" class="bracket-button">[a] admin</button>
            ${isLibraryView ? '<button type="button" data-action="import-document" class="bracket-button">[↑] import</button>' : ''}
            <button type="button" data-action="${primaryAction.action}" class="bracket-button bracket-button--primary">[+] ${primaryAction.label === 'New Document' ? 'new doc' : 'new'}</button>
          </div>
        </header>

        <section class="content-header" aria-labelledby="view-title">
          <div>
            <h1 id="view-title">${activeViewConfig.heading}</h1>
            <p>${activeViewConfig.description}</p>
          </div>
          <span class="sync-pill">Synced</span>
        </section>
        ${metricsHtml}
        <div id="workspace" class="workspace${isLibraryView ? ' workspace--library' : ''}"></div>
        <footer class="status-footer" aria-label="Console status">
          <span class="status-footer__breadcrumb">moomora <span class="status-footer__slash">/</span> ${escapeHtml(activeViewConfig.label)} <span class="status-footer__slash">/</span> <strong>${escapeHtml(activeContext)}</strong></span>
          <span class="status-footer__sync">${syncLabelFor(apiStatus)}</span>
          <span class="status-footer__mode">&lt;${escapeHtml(modeTagFor(activeView))}&gt;</span>
        </footer>
      </main>
      ${renderBottomNav(activeView)}
    </div>`;
}
