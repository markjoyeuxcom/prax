// Prax application shell — titlebar, sidebar, icon rail, statusbar.
// Pure `state → HTML string` renderers (no DOM access, no main.js import);
// events are delegated in main.js via data-action attributes
// (docs/desktop/phase1-actions.md). Classes come from public/prax.css.

import { escapeHtml } from './renderHelpers.js';
import { icon, logo } from './icons.js';
import { BUILT_IN_SMART_VIEWS } from './taskSmartViews.js';
import { isPinned, splitPinned } from './pinned.js';
import { isCollapsed } from './collapsed.js';
import { buildTodayGroups, weeklyReviewStatus } from './renderToday.js';
import { buildCalendarModel, monthKeyOf } from './renderCalendar.js';
import { DOCUMENT_TYPES } from './documentTypes.js';
import { libraryFacetCounts, TRUST_FACETS, TAG_ROW_LIMIT, reviewQueue } from './renderLibrary.js';
import { tagsForDocuments } from './libraryFilters.js';
import { isOpen } from './statusMap.js';

// ---------------------------------------------------------------------------
// Project colors
// ---------------------------------------------------------------------------

// Stable per-project dot color: hash the id onto one of 8 pleasant oklch hues
// so a project keeps its color across sessions/machines with no stored state.
const PROJECT_HUES = [172, 265, 45, 135, 220, 310, 80, 20];

export function projectColor(project) {
  const id = String(project?.id ?? '');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `oklch(0.62 0.11 ${PROJECT_HUES[hash % PROJECT_HUES.length]})`;
}

// ---------------------------------------------------------------------------
// Shared derivations
// ---------------------------------------------------------------------------

// The reserved system project (migration 0002): pinned separately as a
// top-level nav item, so it's excluded from the regular project list.
const INBOX_SLUG = 'inbox';
function inboxProject(state) {
  return (state.projects || []).find((project) => project?.slug === INBOX_SLUG) || null;
}

// Sidebar/rail show only active + on-hold projects (API `status` field),
// excluding the pinned Inbox.
function sidebarProjects(state) {
  return (state.projects || []).filter(
    (project) => project?.slug !== INBOX_SLUG
      && (project?.status === 'active' || project?.status === 'on-hold'),
  );
}

function findProject(state, projectId) {
  return (state.projects || []).find((project) => project?.id === projectId)
    || (state.managedProjects || []).find((project) => project?.id === projectId)
    || null;
}

// Library nav entries stay active while reading a document in the editor.
function isLibraryNav(state) {
  return state.navType === 'library' || state.navType === 'editor';
}

function isCurrentProject(state, projectId) {
  return state.navType === 'project' && state.navId === projectId;
}

// ---------------------------------------------------------------------------
// Titlebar
// ---------------------------------------------------------------------------

const TAB_LABELS = { list: 'List', board: 'Board', backlog: 'Backlog', archive: 'Archive' };
const SETTINGS_LABELS = { appearance: 'Appearance', intelligence: 'Intelligence', integrations: 'Integrations', data: 'Data & admin' };

function documentTitle(state, documentId) {
  return (state.documents || []).find((d) => d?.id === documentId)?.title || 'Untitled document';
}

// The titlebar breadcrumb is a PATH, not a caption (year-one shell spec, item
// 4): every segment before the last one is a place you can go back to, and it
// re-dispatches the same action the rail and panel use for that place.
// Pure: [{ label, action?, data? }], last = current. Area names are context,
// not a destination (there is no area view), so they render as plain text.
export function buildBreadcrumb(state) {
  switch (state.navType) {
    case 'today': return [{ label: 'Today' }];
    case 'calendar': return [{ label: 'Calendar' }];
    case 'all': return [{ label: 'All projects' }];
    case 'filter': {
      const view = [...(state.taskSmartViews || []), ...BUILT_IN_SMART_VIEWS]
        .find((candidate) => candidate?.id === state.activeSmartViewId);
      return view ? [{ label: 'Filter', action: 'nav-filter' }, { label: view.label }] : [{ label: 'Filter' }];
    }
    case 'project': {
      const project = findProject(state, state.navId);
      if (!project) return [{ label: 'Tasks' }];
      const tab = TAB_LABELS[state.tab] ? state.tab : 'list';
      return [
        ...(project.area && project.slug !== INBOX_SLUG ? [{ label: project.area }] : []),
        { label: project.name, action: 'nav-project', data: { 'project-id': project.id } },
        { label: TAB_LABELS[tab] },
      ];
    }
    case 'library':
      if (state.libraryView === 'archive') return [{ label: 'Library', action: 'nav-library' }, { label: 'Archive' }];
      if (state.libraryView === 'review') return [{ label: 'Library', action: 'nav-library' }, { label: 'Review queue' }];
      return [{ label: 'Library' }];
    case 'editor':
      return [{ label: 'Library', action: 'nav-library' }, { label: documentTitle(state, state.editorDocId) }];
    case 'run': {
      const docId = state.runReturnDocId || state.activeRun?.documentId;
      return [
        { label: 'Library', action: 'nav-library' },
        ...(docId ? [{ label: documentTitle(state, docId), action: 'open-linked-doc', data: { 'document-id': docId } }] : []),
        { label: 'Run' },
      ];
    }
    case 'health':
      return [{ label: 'Library', action: 'nav-library' }, { label: 'Health' }];
    case 'settings': {
      const tab = SETTINGS_LABELS[state.settingsTab] ? state.settingsTab : 'appearance';
      return [{ label: 'Settings', action: 'nav-settings' }, { label: SETTINGS_LABELS[tab] }];
    }
    default: return [];
  }
}

function renderBreadcrumbHtml(state) {
  const segments = buildBreadcrumb(state);
  return segments.map((segment, index) => {
    const last = index === segments.length - 1;
    const label = escapeHtml(segment.label);
    let html;
    if (last) {
      html = `<span class="titlebar__crumb-current" aria-current="page">${label}</span>`;
    } else if (segment.action) {
      const data = Object.entries(segment.data || {})
        .map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`).join('');
      // A crumb link re-dispatches the rail/panel action through
      // `breadcrumb` + data-target, so `[data-action="nav-project"]` keeps
      // meaning the rail and panel rows (tests, focus restores) and never the
      // titlebar.
      html = `<button type="button" class="titlebar__crumb-link" data-action="breadcrumb" data-target="${segment.action}"${data}>${label}</button>`;
    } else {
      html = `<span class="titlebar__crumb-text">${label}</span>`;
    }
    return (index ? '<span class="titlebar__crumb-sep" aria-hidden="true">›</span>' : '') + html;
  }).join('');
}

const TRAFFIC_LIGHTS = '<div class="traffic" aria-hidden="true">'
  + '<span class="traffic__close"></span>'
  + '<span class="traffic__min"></span>'
  + '<span class="traffic__max"></span>'
  + '</div>';

const WIN_CONTROLS = '<div class="winctl">'
  + '<button type="button" title="Minimize" aria-label="Minimize">─</button>'
  + '<button type="button" title="Maximize" aria-label="Maximize">▢</button>'
  + '<button type="button" class="winctl__close" title="Close" aria-label="Close">✕</button>'
  + '</div>';

// "New" is one menu button: it opens the three things you create — a task
// (quick capture, still N from anywhere), a document, a project — with the
// task first so Enter gets you the common case. It replaced a split button
// whose two green halves read as a duplicated control.
function renderNewMenuHtml(state) {
  const open = Boolean(state.newMenuOpen);
  return '<div class="menu titlebar__new">'
    + `<button type="button" class="btn-primary" data-action="toggle-new-menu" aria-haspopup="true" aria-expanded="${open}" title="New task, document or project">${icon('plus', 12)}<span>New</span><span class="btn-primary__chevron" aria-hidden="true">▾</span></button>`
    + (open ? '<div class="menu__panel menu__panel--right" role="menu">'
      + '<button role="menuitem" class="menu__item" type="button" data-action="open-capture">New task<span class="menu__item-sub">Quick capture · N</span></button>'
      + '<button role="menuitem" class="menu__item" type="button" data-action="new-document">New document<span class="menu__item-sub">A blank note in the Library</span></button>'
      + '<button role="menuitem" class="menu__item" type="button" data-action="new-project">New project<span class="menu__item-sub">Opens All projects with the name field ready</span></button>'
      + '</div>' : '')
    + '</div>';
}

export function renderTitlebarHtml(state) {
  const isMac = state.preferences?.chromeOS === 'mac';
  // Inside the desktop shell the OS provides the real window chrome — the
  // prototype's fake traffic lights / Windows controls would double it. On
  // macOS the native titlebar is merged into this bar (overlay style), so it
  // renders no left ornament at all: the real traffic lights occupy that
  // space and the bar itself is the drag region.
  const left = state.desktopShell ? '' : (isMac ? TRAFFIC_LIGHTS : logo(15));
  const drag = state.desktopShell ? ' data-tauri-drag-region' : '';

  // In editor focus mode the right-hand chrome (incl. Windows controls,
  // matching the prototype) is hidden; traffic lights / logo + crumb stay.
  const actions = state.editorFocus ? '' : '<div class="titlebar__actions">'
    + `<button type="button" class="searchpill" data-action="open-palette">${icon('search', 13)}<span>Search or jump to…</span><span class="kbd">⌘K</span></button>`
    + `<button type="button" class="btn-icon" data-action="open-assistant" title="Assistant (⌘I)">${icon('chat', 14)}</button>`
    + renderNewMenuHtml(state)
    + '<button type="button" class="btn-icon" data-action="toggle-theme" title="Toggle theme (⌘J)">◐</button>'
    + (isMac || state.desktopShell ? '' : WIN_CONTROLS)
    + '</div>';

  return `<div class="titlebar"${drag}>`
    + left
    + `<div class="titlebar__crumb-wrap"${drag}><nav class="titlebar__crumb" aria-label="Breadcrumb"${drag}>${renderBreadcrumbHtml(state)}</nav></div>`
    + actions
    + '</div>';
}

// ---------------------------------------------------------------------------
// Icon rail — the primary navigation at every width. Wide windows pair it
// with the browser panel below; narrow windows (<940px) show it alone with
// per-project dots, exactly as before the panel existed.
// ---------------------------------------------------------------------------

export const RAIL_PROJECT_LIMIT = 5;

function railProjectsHtml(state) {
  const byId = new Map(sidebarProjects(state).map((project) => [project.id, project]));
  const order = [
    ...(state.navType === 'project' ? [state.navId] : []),
    ...(state.pinned?.projects || []),
    ...(state.recentProjects || []),
  ];
  const picked = [];
  for (const id of order) {
    const project = byId.get(id);
    if (project && !picked.includes(project)) picked.push(project);
    if (picked.length >= RAIL_PROJECT_LIMIT) break;
  }
  if (!picked.length) return '';
  return '<div class="rail__divider"></div>' + picked.map((project) => {
    const active = isCurrentProject(state, project.id);
    const letter = String(project.name || '?').trim().charAt(0).toUpperCase() || '?';
    return `<button type="button" class="rail__proj${active ? ' is-active' : ''}" title="${escapeHtml(project.name)}" data-action="nav-project" data-project-id="${escapeHtml(project.id)}"${active ? ' aria-current="true"' : ''}>`
      + `<span class="rail__proj-letter" style="--dot: ${projectColor(project)}">${escapeHtml(letter)}</span>`
      + '</button>';
  }).join('');
}

function railBadge(count, variant = '') {
  return count > 0 ? `<span class="rail__badge${variant ? ` rail__badge--${variant}` : ''}">${count > 99 ? '99+' : count}</span>` : '';
}

export function renderRailHtml(state, counts = {}, { showProjects = true } = {}) {
  const inbox = inboxProject(state);
  const navs = [
    { title: 'Today', iconName: 'check', action: 'nav-today', active: state.navType === 'today', badge: counts.todayBadge },
    { title: 'Calendar', iconName: 'month', action: 'nav-calendar', active: state.navType === 'calendar' },
    ...(inbox ? [{
      title: 'Inbox', iconName: 'inbox', action: 'nav-project',
      active: isCurrentProject(state, inbox.id), projectId: inbox.id,
      badge: counts?.projectOpen?.[inbox.id] || 0,
    }] : []),
    { title: 'All projects', iconName: 'grid', action: 'nav-all', active: state.navType === 'all' },
    // The Library badge is the review queue (amber, not overdue red): agent
    // memory waiting for a human.
    { title: 'Library', iconName: 'book', action: 'nav-library', active: isLibraryNav(state), badge: counts.reviewQueue, badgeVariant: 'review' },
    { title: 'Filter', iconName: 'filter', action: 'nav-filter', active: state.navType === 'filter' },
  ].map(({ title, iconName, action, active, projectId, badge, badgeVariant }) => (
    `<button type="button" class="rail__btn${active ? ' is-active' : ''}" title="${title}${badge > 0 && badgeVariant === 'review' ? ` · ${badge} to review` : ''}" data-action="${action}"${projectId ? ` data-project-id="${escapeHtml(projectId)}"` : ''}${active ? ' aria-current="true"' : ''}>${icon(iconName, 16)}${railBadge(badge, badgeVariant)}</button>`
  )).join('');

  // Narrow windows (no panel): not every project as an identical dot (spec
  // item 9) but the ones you keep close — pinned, then recent, at most
  // RAIL_PROJECT_LIMIT — as lettered tiles in their colour. The current
  // project always shows so the rail never loses its place.
  const projects = showProjects ? railProjectsHtml(state) : '';

  const settingsActive = state.navType === 'settings';
  const settings = '<div class="rail__spacer"></div>'
    + `<button type="button" class="rail__btn${settingsActive ? ' is-active' : ''}" title="Settings" data-action="nav-settings"${settingsActive ? ' aria-current="true"' : ''}>${icon('sliders', 16)}</button>`;

  return '<aside class="rail" aria-label="Navigation">'
    + (state.desktopShell ? '' : logo(25))
    + navs
    + projects
    + settings
    + '</aside>';
}

// ---------------------------------------------------------------------------
// Browser panel (wide windows) — Projects / Views tabs + type-to-filter.
// Rows keep the classic side-item markup and data-action vocabulary, so every
// existing affordance (dots, counts, hover-× deletes, active states) carries
// over unchanged; only the container changed shape.
// ---------------------------------------------------------------------------

function panelMatches(filter, label) {
  return !filter || String(label || '').toLowerCase().includes(filter);
}

// Every panel row carries a pin star (hover-revealed; always visible once
// pinned). Pinned rows float into a leading "Pinned" section per tab.
function pinButton(kind, key, label, pinned, { solo = true } = {}) {
  const on = isPinned(pinned, kind, key);
  return `<button type="button" class="side-item__pin${solo ? ' side-item__pin--solo' : ''}${on ? ' is-pinned' : ''}" data-action="toggle-pin" data-kind="${kind}" data-key="${escapeHtml(key)}" title="${on ? 'Unpin' : 'Pin'}" aria-label="${on ? 'Unpin' : 'Pin'} ${escapeHtml(label || '')}" aria-pressed="${on}">${on ? '★' : '☆'}</button>`;
}

function pinnedSectionHtml(pinnedRows, restRows) {
  if (!pinnedRows.length) return restRows.join('');
  return '<div class="side-section"><span>Pinned</span></div>'
    + pinnedRows.join('')
    + (restRows.length ? '<div class="panel__rest-gap"></div>' : '')
    + restRows.join('');
}

// Collapsible group header. A typed filter auto-expands every section —
// hiding matches inside a collapsed group would make the filter a liar.
function sectionHeader(sectionKey, label, count, collapsed) {
  return `<button type="button" class="side-section side-section--toggle" data-action="toggle-section" data-section-key="${escapeHtml(sectionKey)}" aria-expanded="${!collapsed}">`
    + `<span class="side-section__chevron">${collapsed ? '▸' : '▾'}</span>`
    + `<span>${escapeHtml(label)}</span>`
    + `<span class="side-section__count">${count}</span>`
    + '</button>';
}

// Group items by their group name (null = ungrouped): named groups sorted
// alphabetically and collapsible, then the ungrouped remainder under
// otherLabel (only labelled when named groups exist — no groups at all
// renders the exact flat list the panel always had).
function groupedRowsHtml(items, { prefix, otherLabel, collapsedSections, filterActive }) {
  const named = new Map();
  const loose = [];
  for (const item of items) {
    if (item.group) {
      if (!named.has(item.group)) named.set(item.group, []);
      named.get(item.group).push(item);
    } else {
      loose.push(item);
    }
  }
  if (!named.size) return items.map((item) => item.row).join('');
  const parts = [];
  for (const group of [...named.keys()].sort((a, b) => a.localeCompare(b))) {
    const rows = named.get(group);
    const key = `${prefix}:${group}`;
    const collapsed = !filterActive && isCollapsed(collapsedSections, key);
    parts.push(sectionHeader(key, group, rows.length, collapsed));
    if (!collapsed) parts.push(...rows.map((item) => item.row));
  }
  if (loose.length) {
    const key = `${prefix}:__other`;
    const collapsed = !filterActive && isCollapsed(collapsedSections, key);
    parts.push(sectionHeader(key, otherLabel, loose.length, collapsed));
    if (!collapsed) parts.push(...loose.map((item) => item.row));
  }
  return parts.join('');
}

// "Recent" shows the last MAX_RECENT projects visited, but only once the
// list is long enough to need a shortcut (below the threshold every project
// is already in view) and never while a typed filter is narrowing the list.
// Rows repeat below in their area: Recent is a jump list, not a partition.
export const RECENT_MIN_PROJECTS = 6;
export const ON_HOLD_SECTION = 'panel:onhold';

function panelRecentRows(state, counts, projects) {
  if (projects.length < RECENT_MIN_PROJECTS) return '';
  const byId = new Map(projects.map((project) => [project.id, project]));
  const recent = (state.recentProjects || []).map((id) => byId.get(id)).filter(Boolean);
  if (!recent.length) return '';
  const rows = recent.map((project) => {
    const active = isCurrentProject(state, project.id);
    const openCount = counts?.projectOpen?.[project.id] || 0;
    return `<button type="button" class="side-item side-item--recent${active ? ' is-active' : ''}" data-action="nav-project" data-project-id="${escapeHtml(project.id)}"${active ? ' aria-current="true"' : ''}>`
      + `<span class="proj-dot${project.status === 'on-hold' ? ' is-onhold' : ''}" style="--dot: ${projectColor(project)}"></span>`
      + `<span class="side-item__label">${escapeHtml(project.name)}</span>`
      + (project.area ? `<span class="side-item__sub">${escapeHtml(project.area)}</span>` : '')
      + `<span class="side-item__count">${openCount || ''}</span>`
      + '</button>';
  }).join('');
  return `<div class="side-section"><span>Recent</span></div>${rows}<div class="panel__rest-gap"></div>`;
}

function panelProjectRows(state, counts, filter) {
  const recent = filter ? '' : panelRecentRows(state, counts, sidebarProjects(state));
  const items = sidebarProjects(state)
    .filter((project) => panelMatches(filter, project.name))
    .map((project) => {
      const active = isCurrentProject(state, project.id);
      const openCount = counts?.projectOpen?.[project.id] || 0;
      const dotClass = `proj-dot${project.status === 'on-hold' ? ' is-onhold' : ''}`;
      const row = '<div class="side-item-row">'
        + `<button type="button" class="side-item side-item--saved${active ? ' is-active' : ''}" data-action="nav-project" data-project-id="${escapeHtml(project.id)}"${active ? ' aria-current="true"' : ''}>`
        + `<span class="${dotClass}" style="--dot: ${projectColor(project)}"></span>`
        + `<span class="side-item__label">${escapeHtml(project.name)}</span>`
        + `<span class="side-item__count">${openCount || ''}</span>`
        + '</button>'
        + pinButton('projects', project.id, project.name, state.pinned)
        + '</div>';
      return { key: project.id, row, group: project.area || null, status: project.status };
    });
  if (!items.length) return '<div class="panel__empty">No matches.</div>';
  const { pinned, rest } = splitPinned(items, state.pinned?.projects);
  // On-hold projects leave the areas for one trailing section that starts
  // folded (year-one shell spec, item 5): paused work should not sit between
  // the projects you are actually in. The stored key means "expanded" here —
  // the opposite of the default, as with the list's done groups. A typed
  // filter and the section holding the CURRENT project always open it.
  const active = rest.filter((item) => item.status !== 'on-hold');
  const onHold = rest.filter((item) => item.status === 'on-hold');
  const grouped = groupedRowsHtml(active, {
    prefix: 'area',
    otherLabel: 'Other',
    collapsedSections: state.collapsedSections,
    filterActive: Boolean(filter),
  });
  let onHoldHtml = '';
  if (onHold.length) {
    const holdsCurrent = onHold.some((item) => isCurrentProject(state, item.key));
    const collapsed = !filter && !holdsCurrent && !isCollapsed(state.collapsedSections, ON_HOLD_SECTION);
    onHoldHtml = sectionHeader(ON_HOLD_SECTION, 'On hold', onHold.length, collapsed)
      + (collapsed ? '' : onHold.map((item) => item.row).join(''));
  }
  const restRows = [...(grouped ? [grouped] : []), ...(onHoldHtml ? [onHoldHtml] : [])];
  return recent + pinnedSectionHtml(pinned.map((item) => item.row), restRows);
}

function panelViewRows(state, filter) {
  const smart = [...(state.taskSmartViews || []), ...BUILT_IN_SMART_VIEWS]
    .filter((view) => panelMatches(filter, view.label))
    .map((view) => {
      const active = state.navType === 'filter' && state.activeSmartViewId === view.id;
      const remove = view.builtIn
        ? ''
        : `<button type="button" class="side-item__del" data-action="delete-smart-view" data-view-id="${escapeHtml(view.id)}" title="Delete smart view" aria-label="Delete smart view ${escapeHtml(view.label || '')}">×</button>`;
      const row = '<div class="side-item-row">'
        + `<button type="button" class="side-item side-item--saved${remove ? ' side-item--twoctl' : ''}${active ? ' is-active' : ''}" data-action="select-smart-view" data-view-id="${escapeHtml(view.id)}"${active ? ' aria-current="true"' : ''}>`
        + icon('filter')
        + `<span class="side-item__label">${escapeHtml(view.label)}</span>`
        + '</button>'
        + pinButton('smartViews', view.id, view.label, state.pinned, { solo: !remove })
        + remove
        + '</div>';
      return { key: `sv:${view.id}`, row, group: view.folder || null };
    });

  const library = (state.librarySavedViews || [])
    .filter((view) => panelMatches(filter, view?.label))
    .map((view) => {
      // delete-library-view is index-addressed against the UNFILTERED list;
      // pins use the label — a library view's only stable identity.
      const realIndex = (state.librarySavedViews || []).indexOf(view);
      const active = state.navType === 'library'
        && (state.activeLibraryTags || []).join() === (view?.tags || []).join();
      const row = '<div class="side-item-row">'
        + `<button type="button" class="side-item side-item--saved side-item--twoctl${active ? ' is-active' : ''}" data-action="select-saved-view" data-view-index="${realIndex}"${active ? ' aria-current="true"' : ''}>`
        + icon('tag')
        + `<span class="side-item__label">${escapeHtml(view?.label)}</span>`
        + '</button>'
        + pinButton('libraryViews', view?.label || '', view?.label, state.pinned)
        + `<button type="button" class="side-item__del" data-action="delete-library-view" data-view-index="${realIndex}" title="Delete saved view" aria-label="Delete saved view ${escapeHtml(view?.label || '')}">×</button>`
        + '</div>';
      return { key: `lv:${view?.label}`, row };
    });

  if (!smart.length && !library.length) return '<div class="panel__empty">No matches.</div>';
  const pinnedKeys = [
    ...(state.pinned?.smartViews || []).map((id) => `sv:${id}`),
    ...(state.pinned?.libraryViews || []).map((label) => `lv:${label}`),
  ];
  const smartSplit = splitPinned(smart, pinnedKeys);
  const librarySplit = splitPinned(library, pinnedKeys);
  const pinnedRows = [...smartSplit.pinned, ...librarySplit.pinned].map((item) => item.row);
  const groupedSmart = groupedRowsHtml(smartSplit.rest, {
    prefix: 'folder',
    otherLabel: 'Views',
    collapsedSections: state.collapsedSections,
    filterActive: Boolean(filter),
  });
  const restRows = [
    ...(groupedSmart ? [groupedSmart] : []),
    ...(librarySplit.rest.length
      ? [`<div class="side-section"><span>Library views</span></div>`, ...librarySplit.rest.map((item) => item.row)]
      : []),
  ];
  return pinnedSectionHtml(pinnedRows, restRows);
}

function panelBrand(state) {
  return '<div class="sidebar__brand">'
    + logo(state.desktopShell ? 20 : 25)
    + '<span class="sidebar__wordmark">prax</span>'
    + '<span class="sidebar__byline">by moomora</span>'
    + '</div>';
}

// The panel is the secondary navigation for the rail's CURRENT context
// (2026-07-21 plan): a plan cockpit on Today, a mini-month on Calendar, a
// document browser in the Library, section nav in Settings — and the classic
// Projects/Views browser everywhere project-shaped. Context panels only
// re-arrange already-loaded state over existing data-actions; they never
// fetch and never invent affordances the main views lack.
export function renderPanelHtml(state, counts = {}) {
  if (state.navType === 'today') return renderTodayPanel(state, counts);
  if (state.navType === 'calendar') return renderCalendarPanel(state);
  if (isLibraryNav(state)) return renderLibraryPanel(state);
  if (state.navType === 'settings') return renderSettingsPanel(state);
  return renderBrowserPanel(state, counts);
}

function renderBrowserPanel(state, counts = {}) {
  const tab = state.panelTab === 'views' ? 'views' : 'projects';
  const filter = String(state.panelFilter || '').trim().toLowerCase();
  const projectCount = sidebarProjects(state).length;
  const viewCount = (state.taskSmartViews || []).length + BUILT_IN_SMART_VIEWS.length
    + (state.librarySavedViews || []).length;

  const brand = panelBrand(state);

  // The ＋ lives BESIDE the tablist, not inside it — role="tablist" allows
  // only tab children (axe: aria-required-children).
  const tabs = '<div class="panel__tabs">'
    + '<div class="panel__tablist" role="tablist">'
    + `<button type="button" role="tab" class="panel__tab${tab === 'projects' ? ' is-active' : ''}" data-action="set-panel-tab" data-tab="projects" aria-selected="${tab === 'projects'}">Projects <span class="panel__tabcount">${projectCount}</span></button>`
    + `<button type="button" role="tab" class="panel__tab${tab === 'views' ? ' is-active' : ''}" data-action="set-panel-tab" data-tab="views" aria-selected="${tab === 'views'}">Views <span class="panel__tabcount">${viewCount}</span></button>`
    + '</div>'
    + (tab === 'projects'
      ? '<button type="button" class="panel__add" data-action="manage-projects" title="Manage projects" aria-label="Manage projects">＋</button>'
      : '')
    + '</div>';

  const filterBox = `<input class="panel__filter" type="text" data-panel-filter placeholder="Filter ${tab === 'projects' ? `${projectCount} project${projectCount === 1 ? '' : 's'}` : `${viewCount} view${viewCount === 1 ? '' : 's'}`}…" value="${escapeHtml(state.panelFilter || '')}" autocomplete="off" aria-label="Filter ${tab}">`;

  const rows = tab === 'projects' ? panelProjectRows(state, counts, filter) : panelViewRows(state, filter);

  return '<aside class="panel" aria-label="Browser">'
    + brand
    + tabs
    + filterBox
    + `<div class="panel__scroll">${rows}</div>`
    + '</aside>';
}

// ---------------------------------------------------------------------------
// Statusbar
// ---------------------------------------------------------------------------

// One line of facts about the workspace and a way to the shortcut list
// (year-one shell spec, item 5). The fixed hints that used to live here were
// learned in week one and then permanent chrome; they are behind ⌘/ now.
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function statusbarFacts(state) {
  const projects = (state.projects || []).filter((project) => project?.status === 'active' || project?.status === 'on-hold').length;
  const openTasks = (state.tasks || []).filter((task) => task && isOpen(task)).length;
  const documents = (state.documents || []).filter((doc) => doc && !doc.archivedAt).length;
  return [plural(projects, 'project'), plural(openTasks, 'open task'), plural(documents, 'document')];
}

export function renderStatusbarHtml(state) {
  return '<footer class="statusbar">'
    + '<span class="statusbar__saved">Saved locally</span>'
    + `<span class="statusbar__facts">${statusbarFacts(state).map((fact) => `<span>${escapeHtml(fact)}</span>`).join('<span class="statusbar__dot" aria-hidden="true">·</span>')}</span>`
    + '<button type="button" class="statusbar__shortcuts" data-action="open-shortcuts" title="Keyboard shortcuts (⌘/)"><span class="kbd">⌘/</span> shortcuts</button>'
    + '</footer>';
}


// ---------------------------------------------------------------------------
// Context panels (2026-07-21 plan)
// ---------------------------------------------------------------------------

function panelTaskRow(task) {
  const time = task.dueTime ? `<span class="side-item__count">${escapeHtml(task.dueTime)}</span>` : '';
  return `<button type="button" class="side-item" data-action="open-task" data-task-id="${escapeHtml(task.id)}">`
    + `<span class="proj-dot" style="--dot: ${task.projColor || 'var(--ink3)'}"></span>`
    + `<span class="side-item__label">${escapeHtml(task.title || 'Untitled task')}</span>`
    + time
    + '</button>';
}

// Today — the plan cockpit: score, ritual actions, honest counts, and the
// working set itself. Counts mirror the Today view exactly (planned rows are
// not double-counted into the due buckets).
function renderTodayPanel(state, counts = {}) {
  void counts;
  const now = new Date();
  const built = buildTodayGroups(state.tasks || [], state.projects || [], { now });
  const overdue = built.groups.find((group) => group.key === 'overdue')?.tasks.length || 0;
  const dueToday = built.groups.find((group) => group.key === 'today')?.tasks.length || 0;
  const planned = built.groups.find((group) => group.key === 'planned')?.tasks || [];
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const score = (built.plannedCount + built.plannedDone) > 0
    ? `<div class="panel__score" data-panel-plan-score>planned ${built.plannedCount + built.plannedDone} — ${built.plannedDone} done</div>`
    : '';
  const actions = '<div class="panel__actions">'
    + '<button type="button" class="panel__action" data-action="open-plan-mode">Plan today</button>'
    + (built.plannedCount > 0 ? '<button type="button" class="panel__action" data-action="open-shutdown">Shut down</button>' : '')
    + '</div>';
  const countRow = (label, count) => (count > 0
    ? `<div class="side-item panel__count-row"><span class="side-item__label">${label}</span><span class="side-item__count">${count}</span></div>`
    : '');
  const stale = built.stalePlannedCount > 0
    ? `<button type="button" class="side-item panel__stale" data-action="open-plan-mode"><span class="side-item__label">Planned earlier — review</span><span class="side-item__count">${built.stalePlannedCount}</span></button>`
    : '';
  const plannedRows = planned.slice(0, 8).map(panelTaskRow).join('')
    + (planned.length > 8 ? `<div class="panel__empty">＋${planned.length - 8} more on Today</div>` : '');

  // The rituals, grouped (spec item 8): the weekly review with its due state,
  // the brief, and library health — each already a data-action elsewhere.
  const weekly = weeklyReviewStatus(state.documents, { now });
  const weeklySub = weekly.due ? 'due' : (weekly.daysAgo === 0 ? 'today' : `${weekly.daysAgo}d ago`);
  const rituals = '<div class="side-section"><span>Rituals</span></div>'
    + `<button type="button" class="side-item" data-action="generate-weekly-review">${icon('month')}<span class="side-item__label">Weekly review</span><span class="side-item__count${weekly.due ? ' is-due' : ''}">${escapeHtml(weeklySub)}</span></button>`
    + `<button type="button" class="side-item" data-action="open-daily-brief">${icon('spark')}<span class="side-item__label">Brief me</span></button>`
    + `<button type="button" class="side-item" data-action="open-health">${icon('book')}<span class="side-item__label">Library health</span></button>`;
  return `<aside class="panel" aria-label="Today">`
    + panelBrand(state)
    + `<div class="side-section"><span>Today · ${escapeHtml(dateLabel)}</span></div>`
    + score
    + actions
    + countRow('Overdue', overdue)
    + countRow('Due today', dueToday)
    + countRow('Next 7 days', built.weekCount)
    + countRow('Snoozed', built.snoozedCount)
    + stale
    + rituals
    + (planned.length ? '<div class="side-section"><span>Planned</span></div>' : '')
    + `<div class="panel__scroll">${plannedRows}</div>`
    + '</aside>';
}

// Calendar — a Monday-start mini month with load dots; the selected (or
// current) day's tasks preview underneath. Day clicks and month arrows are
// the SAME actions the big calendar uses.
function renderCalendarPanel(state) {
  const now = new Date();
  const model = buildCalendarModel(state.tasks || [], state.projects || [], {
    month: state.calendarMonth || monthKeyOf(now),
    now,
  });
  const heads = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    .map((day) => `<span class="panel__mini-hd">${day}</span>`).join('');
  const cells = model.weeks.flat().map((day) => {
    const classes = ['panel__mini-day'];
    if (!day.inMonth) classes.push('is-out');
    if (day.isToday) classes.push('is-today');
    if (state.calendarSelectedDay === day.iso) classes.push('is-selected');
    if (day.tasks.length) classes.push('has-tasks');
    return `<button type="button" class="${classes.join(' ')}" data-action="calendar-select-day" data-day="${day.iso}" aria-label="${day.iso}">${day.dayNum}</button>`;
  }).join('');

  const peekIso = state.calendarSelectedDay || model.todayIso;
  const peekTasks = model.byDate.get(peekIso) || [];
  const peekLabel = new Date(`${peekIso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const peek = `<div class="side-section"><span>${escapeHtml(peekLabel)}</span></div>`
    + (peekTasks.length
      ? peekTasks.slice(0, 8).map(panelTaskRow).join('')
      : '<div class="panel__empty">Nothing due.</div>');

  return `<aside class="panel" aria-label="Calendar">`
    + panelBrand(state)
    + '<div class="panel__month-head">'
    + `<span>${escapeHtml(model.label)}</span>`
    + '<span class="panel__month-nav">'
    + '<button type="button" data-action="calendar-prev" aria-label="Previous month">‹</button>'
    + '<button type="button" data-action="calendar-next" aria-label="Next month">›</button>'
    + '</span></div>'
    + `<div class="panel__mini" data-panel-mini-month>${heads}${cells}</div>`
    + `<div class="panel__scroll">${peek}</div>`
    + '</aside>';
}

// Library — the facet panel (year-one shell spec, item 3): every filter axis
// with live counts — Type, Project, Trust, Tags — plus saved views and the
// most recently touched documents. The actions are the SAME toggle-lib-*
// facets the main view's rows dispatch on narrow windows, so one handler
// serves both surfaces. Facets apply while browsing only; in the archive and
// semantic modes the panel says so instead of showing dead toggles. No
// duplicate search box — the main view owns search; the tag box below is a
// panel-local filter over the tag list, not a document search.
function renderLibraryPanel(state) {
  const documents = (state.documents || []).filter((doc) => !doc.archivedAt);
  // Facets apply while browsing and inside the review queue, not in the
  // archive or a semantic result list.
  const browsing = state.libraryView !== 'archive' && !state.librarySemantic;
  const counts = libraryFacetCounts(documents);
  const facetRow = (action, key, label, count, active, extraClass = '') => (
    `<button type="button" class="side-item${extraClass}${active ? ' is-active' : ''}" data-action="${action}" data-facet="${escapeHtml(key)}" aria-pressed="${active}">`
    + `<span class="side-item__label">${escapeHtml(label)}</span>`
    + `<span class="side-item__count">${count || ''}</span>`
    + '</button>'
  );

  const activeTypes = new Set(state.libraryTypes || []);
  const typeRows = DOCUMENT_TYPES.map((type) => (
    facetRow('toggle-lib-type', type.value, type.label, counts.type[type.value], activeTypes.has(type.value))
  )).join('');

  const activeProjects = new Set(state.libraryProjects || []);
  const projects = [...(state.managedProjects || []), ...(state.projects || [])]
    .filter((project, index, all) => project?.id && all.findIndex((item) => item?.id === project.id) === index)
    .filter((project) => (counts.project[project.id] || 0) > 0 || activeProjects.has(project.id));
  const projectRows = projects.map((project) => (
    facetRow('toggle-lib-project', project.id, project.name, counts.project[project.id], activeProjects.has(project.id))
  )).join('');

  const activeTrust = new Set(state.libraryTrust || []);
  const trustRows = TRUST_FACETS
    .filter(([key]) => (counts.trust[key] || 0) > 0 || activeTrust.has(key))
    .map(([key, label]) => facetRow('toggle-lib-trust', key, label, counts.trust[key], activeTrust.has(key)))
    .join('');

  // Tags: most-used first (tagsForDocuments sorts by count), folded past
  // TAG_ROW_LIMIT unless expanded or narrowed by the panel-local tag box. An
  // active tag always shows — a filter the user cannot see cannot be cleared.
  const activeTags = new Set((state.activeLibraryTags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean));
  const tagFilter = String(state.libraryTagFilter || '').trim().toLowerCase().replace(/^#/, '');
  const allTags = tagsForDocuments(documents);
  const matching = tagFilter ? allTags.filter(({ tag }) => tag.includes(tagFilter)) : allTags;
  const expanded = Boolean(state.libraryTagsExpanded) || Boolean(tagFilter);
  const shownTags = expanded ? matching : matching.filter(({ tag }, index) => index < TAG_ROW_LIMIT || activeTags.has(tag));
  const hiddenTags = matching.length - shownTags.length;
  const tagRows = shownTags.map(({ tag, count }) => (
    `<button type="button" class="side-item side-item--tag${activeTags.has(tag) ? ' is-active' : ''}" data-action="toggle-lib-tag" data-tag="${escapeHtml(tag)}" aria-pressed="${activeTags.has(tag)}">`
    + `<span class="side-item__label">#${escapeHtml(tag)}</span><span class="side-item__count">${count}</span></button>`
  )).join('')
    + (hiddenTags > 0
      ? `<button type="button" class="side-item side-item--more" data-action="toggle-lib-tags" aria-expanded="false"><span class="side-item__label">${hiddenTags} more, by use</span></button>`
      : (state.libraryTagsExpanded && !tagFilter && allTags.length > TAG_ROW_LIMIT
        ? '<button type="button" class="side-item side-item--more" data-action="toggle-lib-tags" aria-expanded="true"><span class="side-item__label">Show fewer</span></button>'
        : ''))
    + (tagFilter && !matching.length ? '<div class="panel__empty">No matching tags.</div>' : '')
    + (activeTags.size ? '<button type="button" class="side-item side-item--more" data-action="save-library-view"><span class="side-item__label">＋ Save view</span></button>' : '');
  const tagBox = allTags.length > TAG_ROW_LIMIT
    ? `<input class="panel__filter" type="text" data-library-tag-filter placeholder="Find a tag…" value="${escapeHtml(state.libraryTagFilter || '')}" autocomplete="off" aria-label="Find a tag">`
    : '';

  // The review queue leads the panel whenever there is one (or while it is
  // open): a destination, not a facet — agent memory waiting for a human.
  const queueCount = reviewQueue(documents).length;
  const reviewActive = state.libraryView === 'review';
  const reviewRow = queueCount || reviewActive
    ? `<button type="button" class="side-item side-item--review${reviewActive ? ' is-active' : ''}" data-action="open-review-queue" aria-pressed="${reviewActive}">`
      + icon('check')
      + `<span class="side-item__label">Review queue</span>`
      + `<span class="side-item__count">${queueCount || ''}</span>`
      + '</button>'
    : '';
  const facets = browsing
    ? '<div class="side-section"><span>Type</span></div>' + typeRows
      + (projectRows ? '<div class="side-section"><span>Project</span></div>' + projectRows : '')
      + (trustRows ? '<div class="side-section"><span>Trust</span></div>' + trustRows : '')
      + (allTags.length ? `<div class="side-section"><span>Tags</span><span class="side-section__count">${allTags.length}</span></div>${tagBox}${tagRows}` : '')
    : `<div class="panel__empty">${state.librarySemantic ? 'Semantic search ranks the whole library; facets apply while browsing.' : 'Facets apply to the browse view.'}</div>`;

  const savedViews = (state.librarySavedViews || []).map((view, index) => {
    const active = state.navType === 'library'
      && (state.activeLibraryTags || []).join() === (view?.tags || []).join();
    return '<div class="side-item-row">'
      + `<button type="button" class="side-item side-item--saved${active ? ' is-active' : ''}" data-action="select-saved-view" data-view-index="${index}"${active ? ' aria-current="true"' : ''}>`
      + icon('tag')
      + `<span class="side-item__label">${escapeHtml(view?.label)}</span>`
      + '</button>'
      + `<button type="button" class="side-item__del" data-action="delete-library-view" data-view-index="${index}" title="Delete saved view" aria-label="Delete saved view ${escapeHtml(view?.label || '')}">×</button>`
      + '</div>';
  }).join('');

  const recent = [...documents]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 5)
    .map((doc) => `<button type="button" class="side-item" data-action="open-linked-doc" data-document-id="${escapeHtml(doc.id)}">`
      + icon('doc')
      + `<span class="side-item__label">${escapeHtml(doc.title || 'Untitled document')}</span>`
      + '</button>').join('');

  return `<aside class="panel" aria-label="Library">`
    + panelBrand(state)
    + '<div class="panel__scroll">'
    + reviewRow
    + facets
    + (savedViews ? `<div class="side-section"><span>Saved views</span></div>${savedViews}` : '')
    + (recent ? `<div class="side-section"><span>Recent</span></div>${recent}` : '')
    + '</div>'
    + '</aside>';
}

// Settings — the four cards as panel rows (the wide-window home of the old
// tab strip) plus a small status block rendered ONLY from loaded state.
function relativeTime(iso, now = new Date()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderSettingsPanel(state) {
  const tabs = [
    ['appearance', 'Appearance', 'sliders'],
    ['intelligence', 'Intelligence', 'spark'],
    ['integrations', 'Integrations', 'grid'],
    ['data', 'Data & admin', 'book'],
  ];
  const current = tabs.some(([key]) => key === state.settingsTab) ? state.settingsTab : 'appearance';
  const rows = tabs.map(([key, label, iconName]) => {
    const active = current === key;
    return `<button type="button" class="side-item${active ? ' is-active' : ''}" data-action="set-settings-tab" data-tab="${key}"${active ? ' aria-current="true"' : ''}>`
      + icon(iconName)
      + `<span class="side-item__label">${label}</span>`
      + '</button>';
  }).join('');

  const status = [];
  const gcal = state.googleCalendarStatus;
  if (gcal && typeof gcal === 'object' && !gcal.loading) {
    if (gcal.connected) {
      const when = gcal.lastPushAt || gcal.lastSyncAt;
      status.push(`<div class="side-item panel__count-row"><span class="side-item__label">Calendar synced</span><span class="side-item__count">${when ? escapeHtml(relativeTime(when)) : ''}</span></div>`);
    } else if (gcal.configured) {
      status.push('<div class="side-item panel__count-row"><span class="side-item__label">Calendar not connected</span></div>');
    }
  }
  if (state.desktopShell && state.captureShortcut) {
    const chord = state.captureShortcut.shortcut;
    status.push(`<div class="side-item panel__count-row"><span class="side-item__label">Capture</span><span class="side-item__count">${chord ? escapeHtml(chord) : 'off'}</span></div>`);
  }

  return `<aside class="panel" aria-label="Settings">`
    + panelBrand(state)
    + '<div class="side-section"><span>Settings</span></div>'
    + rows
    + (status.length ? `<div class="side-section"><span>Status</span></div>${status.join('')}` : '')
    + '<div class="panel__scroll"></div>'
    + '</aside>';
}
