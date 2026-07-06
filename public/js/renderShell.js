// Prax application shell — titlebar, sidebar, icon rail, statusbar.
// Pure `state → HTML string` renderers (no DOM access, no main.js import);
// events are delegated in main.js via data-action attributes
// (docs/desktop/phase1-actions.md). Classes come from public/prax.css.

import { escapeHtml } from './renderHelpers.js';
import { icon, logo } from './icons.js';

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

// Sidebar/rail show only active + on-hold projects (API `status` field).
function sidebarProjects(state) {
  return (state.projects || []).filter(
    (project) => project?.status === 'active' || project?.status === 'on-hold',
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
  const left = isMac ? TRAFFIC_LIGHTS : logo(15);

  // In editor focus mode the right-hand chrome (incl. Windows controls,
  // matching the prototype) is hidden; traffic lights / logo + crumb stay.
  const actions = state.editorFocus ? '' : '<div class="titlebar__actions">'
    + `<button type="button" class="searchpill" data-action="open-palette">${icon('search', 13)}<span>Search or jump to…</span><span class="kbd">⌘K</span></button>`
    + `<button type="button" class="btn-primary" data-action="open-capture" title="Quick capture (N)">${icon('plus', 12)}<span>New task</span></button>`
    + '<button type="button" class="btn-icon" data-action="toggle-theme" title="Toggle theme (⌘J)">◐</button>'
    + (isMac ? '' : WIN_CONTROLS)
    + '</div>';

  return '<div class="titlebar">'
    + left
    + `<div class="titlebar__crumb-wrap"><div class="titlebar__crumb">prax — ${escapeHtml(crumbContext(state))}</div></div>`
    + actions
    + '</div>';
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function sideNavItem({ label, iconName, action, active, badge = 0 }) {
  const classes = `side-item${active ? ' is-active is-active--nav' : ''}`;
  return `<button type="button" class="${classes}" data-action="${action}"${active ? ' aria-current="true"' : ''}>`
    + icon(iconName)
    + `<span class="side-item__label">${escapeHtml(label)}</span>`
    + (badge > 0 ? `<span class="badge">${badge}</span>` : '')
    + '</button>';
}

function sidebarProjectItem(state, project, counts) {
  const active = isCurrentProject(state, project.id);
  const openCount = counts?.projectOpen?.[project.id] || 0;
  const dotClass = `proj-dot${project.status === 'on-hold' ? ' is-onhold' : ''}`;
  return `<button type="button" class="side-item${active ? ' is-active' : ''}" data-action="nav-project" data-project-id="${escapeHtml(project.id)}"${active ? ' aria-current="true"' : ''}>`
    + `<span class="${dotClass}" style="--dot: ${projectColor(project)}"></span>`
    + `<span class="side-item__label">${escapeHtml(project.name)}</span>`
    + `<span class="side-item__count">${openCount || ''}</span>`
    + '</button>';
}

function sidebarSavedViews(state) {
  const views = state.librarySavedViews || [];
  if (!views.length) return '';
  const items = views.map((view, index) => {
    const active = state.navType === 'library'
      && (state.activeLibraryTags || []).join() === (view?.tags || []).join();
    return `<button type="button" class="side-item${active ? ' is-active' : ''}" data-action="select-saved-view" data-view-index="${index}"${active ? ' aria-current="true"' : ''}>`
      + icon('tag')
      + `<span class="side-item__label">${escapeHtml(view?.label)}</span>`
      + '</button>';
  }).join('');
  return `<div class="side-section"><span>Saved views</span></div>${items}`;
}

export function renderSidebarHtml(state, counts = {}) {
  const brand = '<div class="sidebar__brand">'
    + logo(25)
    + '<span class="sidebar__wordmark">prax</span>'
    + '<span class="sidebar__byline">by moomora</span>'
    + '</div>';

  const nav = [
    sideNavItem({ label: 'Today', iconName: 'check', action: 'nav-today', active: state.navType === 'today', badge: counts.todayBadge }),
    sideNavItem({ label: 'All projects', iconName: 'grid', action: 'nav-all', active: state.navType === 'all' }),
    sideNavItem({ label: 'Library', iconName: 'book', action: 'nav-library', active: isLibraryNav(state) }),
  ].join('');

  const projectsSection = '<div class="side-section">'
    + '<span>Projects</span>'
    + '<button type="button" data-action="manage-projects" title="Manage projects" aria-label="Manage projects">＋</button>'
    + '</div>'
    + sidebarProjects(state).map((project) => sidebarProjectItem(state, project, counts)).join('');

  const settingsActive = state.navType === 'settings';
  const settings = '<div class="sidebar__settings">'
    + `<button type="button" class="side-item${settingsActive ? ' is-active' : ''}" data-action="nav-settings"${settingsActive ? ' aria-current="true"' : ''}>`
    + icon('sliders')
    + '<span class="side-item__label">Settings</span>'
    + '</button>'
    + '</div>';

  return '<aside class="sidebar" aria-label="Navigation">'
    + brand
    + `<div class="sidebar__scroll">${nav}${projectsSection}${sidebarSavedViews(state)}</div>`
    + settings
    + '</aside>';
}

// ---------------------------------------------------------------------------
// Icon rail (narrow windows, < 940px)
// ---------------------------------------------------------------------------

export function renderRailHtml(state) {
  const navs = [
    { title: 'Today', iconName: 'check', action: 'nav-today', active: state.navType === 'today' },
    { title: 'All projects', iconName: 'grid', action: 'nav-all', active: state.navType === 'all' },
    { title: 'Library', iconName: 'book', action: 'nav-library', active: isLibraryNav(state) },
    { title: 'Settings', iconName: 'sliders', action: 'nav-settings', active: state.navType === 'settings' },
  ].map(({ title, iconName, action, active }) => (
    `<button type="button" class="rail__btn${active ? ' is-active' : ''}" title="${title}" data-action="${action}"${active ? ' aria-current="true"' : ''}>${icon(iconName, 16)}</button>`
  )).join('');

  const projects = sidebarProjects(state).map((project) => {
    const active = isCurrentProject(state, project.id);
    return `<button type="button" class="rail__proj${active ? ' is-active' : ''}" title="${escapeHtml(project.name)}" data-action="nav-project" data-project-id="${escapeHtml(project.id)}"${active ? ' aria-current="true"' : ''}>`
      + `<span style="--dot: ${projectColor(project)}"></span>`
      + '</button>';
  }).join('');

  return '<aside class="rail" aria-label="Navigation">'
    + logo(25)
    + navs
    + '<div class="rail__divider"></div>'
    + projects
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
