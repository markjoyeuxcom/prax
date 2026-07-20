// Prax application shell — titlebar, sidebar, icon rail, statusbar.
// Pure `state → HTML string` renderers (no DOM access, no main.js import);
// events are delegated in main.js via data-action attributes
// (docs/desktop/phase1-actions.md). Classes come from public/prax.css.

import { escapeHtml } from './renderHelpers.js';
import { icon, logo } from './icons.js';
import { BUILT_IN_SMART_VIEWS } from './taskSmartViews.js';
import { isPinned, splitPinned } from './pinned.js';
import { isCollapsed } from './collapsed.js';

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

function crumbContext(state) {
  if (state.navType === 'project') return findProject(state, state.navId)?.name || '';
  if (state.navType === 'editor') {
    const doc = (state.documents || []).find((d) => d?.id === state.editorDocId);
    return `Library / ${doc?.title || ''}`;
  }
  const fixed = { today: 'Today', all: 'All projects', library: 'Library', settings: 'Settings' };
  return fixed[state.navType] || '';
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
    + `<button type="button" class="btn-primary" data-action="open-capture" title="Quick capture (N)">${icon('plus', 12)}<span>New task</span></button>`
    + '<button type="button" class="btn-icon" data-action="toggle-theme" title="Toggle theme (⌘J)">◐</button>'
    + (isMac || state.desktopShell ? '' : WIN_CONTROLS)
    + '</div>';

  return `<div class="titlebar"${drag}>`
    + left
    + `<div class="titlebar__crumb-wrap"${drag}><div class="titlebar__crumb"${drag}>prax — ${escapeHtml(crumbContext(state))}</div></div>`
    + actions
    + '</div>';
}

// ---------------------------------------------------------------------------
// Icon rail — the primary navigation at every width. Wide windows pair it
// with the browser panel below; narrow windows (<940px) show it alone with
// per-project dots, exactly as before the panel existed.
// ---------------------------------------------------------------------------

function railBadge(count) {
  return count > 0 ? `<span class="rail__badge">${count > 99 ? '99+' : count}</span>` : '';
}

export function renderRailHtml(state, counts = {}, { showProjects = true } = {}) {
  const inbox = inboxProject(state);
  const navs = [
    { title: 'Today', iconName: 'check', action: 'nav-today', active: state.navType === 'today', badge: counts.todayBadge },
    { title: 'Upcoming', iconName: 'calendar', action: 'nav-upcoming', active: state.navType === 'upcoming' },
    { title: 'Calendar', iconName: 'month', action: 'nav-calendar', active: state.navType === 'calendar' },
    ...(inbox ? [{
      title: 'Inbox', iconName: 'inbox', action: 'nav-project',
      active: isCurrentProject(state, inbox.id), projectId: inbox.id,
      badge: counts?.projectOpen?.[inbox.id] || 0,
    }] : []),
    { title: 'All projects', iconName: 'grid', action: 'nav-all', active: state.navType === 'all' },
    { title: 'Library', iconName: 'book', action: 'nav-library', active: isLibraryNav(state) },
    { title: 'Filter', iconName: 'filter', action: 'nav-filter', active: state.navType === 'filter' },
  ].map(({ title, iconName, action, active, projectId, badge }) => (
    `<button type="button" class="rail__btn${active ? ' is-active' : ''}" title="${title}" data-action="${action}"${projectId ? ` data-project-id="${escapeHtml(projectId)}"` : ''}${active ? ' aria-current="true"' : ''}>${icon(iconName, 16)}${railBadge(badge)}</button>`
  )).join('');

  const projects = showProjects
    ? '<div class="rail__divider"></div>' + sidebarProjects(state).map((project) => {
      const active = isCurrentProject(state, project.id);
      return `<button type="button" class="rail__proj${active ? ' is-active' : ''}" title="${escapeHtml(project.name)}" data-action="nav-project" data-project-id="${escapeHtml(project.id)}"${active ? ' aria-current="true"' : ''}>`
        + `<span style="--dot: ${projectColor(project)}"></span>`
        + '</button>';
    }).join('')
    : '';

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

function panelProjectRows(state, counts, filter) {
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
      return { key: project.id, row, group: project.area || null };
    });
  if (!items.length) return '<div class="panel__empty">No matches.</div>';
  const { pinned, rest } = splitPinned(items, state.pinned?.projects);
  const grouped = groupedRowsHtml(rest, {
    prefix: 'area',
    otherLabel: 'Other',
    collapsedSections: state.collapsedSections,
    filterActive: Boolean(filter),
  });
  return pinnedSectionHtml(pinned.map((item) => item.row), grouped ? [grouped] : []);
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

export function renderPanelHtml(state, counts = {}) {
  const tab = state.panelTab === 'views' ? 'views' : 'projects';
  const filter = String(state.panelFilter || '').trim().toLowerCase();
  const projectCount = sidebarProjects(state).length;
  const viewCount = (state.taskSmartViews || []).length + BUILT_IN_SMART_VIEWS.length
    + (state.librarySavedViews || []).length;

  const brand = '<div class="sidebar__brand">'
    + logo(state.desktopShell ? 20 : 25)
    + '<span class="sidebar__wordmark">prax</span>'
    + '<span class="sidebar__byline">by moomora</span>'
    + '</div>';

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

export function renderStatusbarHtml(state) { // eslint-disable-line no-unused-vars
  return '<footer class="statusbar">'
    + '<span class="statusbar__saved">All changes saved locally</span>'
    + '<span class="statusbar__hints">'
    + '<span><span class="kbd">⌘K</span> command</span>'
    + '<span><span class="kbd">N</span> new task</span>'
    + '<span><span class="kbd">↑↓</span> navigate · <span class="kbd">E</span> done</span>'
    + '<span><span class="kbd">⌘J</span> theme</span>'
    + '</span>'
    + '</footer>';
}
