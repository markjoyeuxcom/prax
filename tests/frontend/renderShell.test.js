import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTitlebarHtml,
  renderSidebarHtml,
  renderRailHtml,
  renderStatusbarHtml,
  projectColor,
} from '../../public/js/renderShell.js';

function makeState(overrides = {}) {
  return {
    navType: 'today',
    navId: null,
    projects: [],
    managedProjects: [],
    documents: [],
    librarySavedViews: [],
    activeLibraryTags: [],
    editorDocId: null,
    editorFocus: false,
    preferences: { theme: 'light', accent: 'fern', chromeOS: 'mac', readingScale: 1 },
    ...overrides,
  };
}

const PROJECTS = [
  { id: 'p1', name: 'Homelab', status: 'active' },
  { id: 'p2', name: 'Reading Pipeline', status: 'on-hold' },
];

// ---------------------------------------------------------------------------
// Titlebar — breadcrumb
// ---------------------------------------------------------------------------

test('titlebar breadcrumb reflects each fixed navType', () => {
  assert.match(renderTitlebarHtml(makeState({ navType: 'today' })), /prax — Today</);
  assert.match(renderTitlebarHtml(makeState({ navType: 'all' })), /prax — All projects</);
  assert.match(renderTitlebarHtml(makeState({ navType: 'library' })), /prax — Library</);
  assert.match(renderTitlebarHtml(makeState({ navType: 'settings' })), /prax — Settings</);
});

test('titlebar breadcrumb shows the project name for project nav', () => {
  const html = renderTitlebarHtml(makeState({ navType: 'project', navId: 'p1', projects: PROJECTS }));
  assert.match(html, /class="titlebar__crumb">prax — Homelab</);
});

test('titlebar breadcrumb shows Library / doc title in the editor', () => {
  const html = renderTitlebarHtml(makeState({
    navType: 'editor',
    editorDocId: 'd1',
    documents: [{ id: 'd1', title: 'Backup runbook' }],
  }));
  assert.match(html, /prax — Library \/ Backup runbook</);
});

// ---------------------------------------------------------------------------
// Titlebar — chrome per chromeOS
// ---------------------------------------------------------------------------

test('titlebar shows mac traffic lights and no win controls when chromeOS is mac', () => {
  const html = renderTitlebarHtml(makeState());
  assert.match(html, /class="traffic"/);
  assert.match(html, /traffic__close/);
  assert.match(html, /traffic__min/);
  assert.match(html, /traffic__max/);
  assert.doesNotMatch(html, /winctl/);
});

test('titlebar shows small logo + windows controls when chromeOS is win', () => {
  const html = renderTitlebarHtml(makeState({ preferences: { chromeOS: 'win' } }));
  assert.doesNotMatch(html, /class="traffic"/);
  assert.match(html, /<svg width="15" height="15" viewBox="0 0 28 28"/); // logo(15)
  assert.match(html, /class="winctl"/);
  assert.match(html, /class="winctl__close"[^>]*>✕|class="winctl__close"[^>]*title="Close"/);
  assert.match(html, /─/);
  assert.match(html, /▢/);
  assert.match(html, /✕/);
});

// ---------------------------------------------------------------------------
// Titlebar — actions
// ---------------------------------------------------------------------------

test('titlebar renders search pill, new task, and theme toggle actions', () => {
  const html = renderTitlebarHtml(makeState());
  assert.match(html, /class="searchpill" data-action="open-palette"/);
  assert.match(html, /Search or jump to…/);
  assert.match(html, /class="kbd">⌘K</);
  assert.match(html, /class="btn-primary" data-action="open-capture"/);
  assert.match(html, /New task/);
  assert.match(html, /class="btn-icon" data-action="toggle-theme"[^>]*>◐/);
});

test('titlebar hides right actions (incl. win controls) in editor focus mode', () => {
  const html = renderTitlebarHtml(makeState({
    editorFocus: true,
    preferences: { chromeOS: 'win' },
  }));
  assert.doesNotMatch(html, /data-action="open-palette"/);
  assert.doesNotMatch(html, /data-action="open-capture"/);
  assert.doesNotMatch(html, /data-action="toggle-theme"/);
  assert.doesNotMatch(html, /class="winctl"/);
  assert.match(html, /class="titlebar__crumb"/); // crumb survives focus
});

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

test('sidebar renders brand, the three nav items, and the projects header', () => {
  const html = renderSidebarHtml(makeState(), { todayBadge: 0, projectOpen: {} });
  assert.match(html, /class="sidebar__wordmark">prax</);
  assert.match(html, /class="sidebar__byline">by moomora</);
  assert.match(html, /data-action="nav-today"/);
  assert.match(html, /data-action="nav-all"/);
  assert.match(html, /data-action="nav-library"/);
  assert.match(html, /<span>Projects<\/span>/);
  assert.match(html, /data-action="manage-projects"/);
});

test('sidebar Today badge renders only when the count is > 0', () => {
  const withBadge = renderSidebarHtml(makeState(), { todayBadge: 3, projectOpen: {} });
  assert.match(withBadge, /class="badge">3</);
  const withoutBadge = renderSidebarHtml(makeState(), { todayBadge: 0, projectOpen: {} });
  assert.doesNotMatch(withoutBadge, /class="badge"/);
});

test('sidebar marks the current nav item active with nav accent + aria-current', () => {
  const html = renderSidebarHtml(makeState({ navType: 'today' }), { todayBadge: 0, projectOpen: {} });
  assert.match(html, /class="side-item is-active is-active--nav" data-action="nav-today" aria-current="true"/);
  assert.doesNotMatch(html, /is-active[^"]*" data-action="nav-all"/);
});

test('sidebar Library nav item stays active while in the editor', () => {
  const html = renderSidebarHtml(makeState({ navType: 'editor' }), { todayBadge: 0, projectOpen: {} });
  assert.match(html, /class="side-item is-active is-active--nav" data-action="nav-library" aria-current="true"/);
});

test('sidebar marks the current project active with aria-current', () => {
  const html = renderSidebarHtml(
    makeState({ navType: 'project', navId: 'p1', projects: PROJECTS }),
    { todayBadge: 0, projectOpen: { p1: 4 } },
  );
  assert.match(html, /class="side-item is-active" data-action="nav-project" data-project-id="p1" aria-current="true"/);
  assert.match(html, /class="side-item__count">4</);
  // the other project is present but not active
  assert.match(html, /class="side-item" data-action="nav-project" data-project-id="p2"/);
});

test('sidebar on-hold project renders the is-onhold ring dot; active projects do not', () => {
  const html = renderSidebarHtml(makeState({ projects: PROJECTS }), { todayBadge: 0, projectOpen: {} });
  assert.match(html, /data-project-id="p2"[^>]*><span class="proj-dot is-onhold" style="--dot: oklch\(/);
  assert.match(html, /data-project-id="p1"[^>]*><span class="proj-dot" style="--dot: oklch\(/);
});

test('sidebar renders an empty open count when a project has no open tasks', () => {
  const html = renderSidebarHtml(makeState({ projects: PROJECTS }), { todayBadge: 0, projectOpen: { p1: 0 } });
  assert.match(html, /class="side-item__count"><\/span>/);
});

test('sidebar hides projects that are not active or on-hold', () => {
  const html = renderSidebarHtml(makeState({
    projects: [...PROJECTS, { id: 'p3', name: 'Done thing', status: 'completed' }],
  }), { todayBadge: 0, projectOpen: {} });
  assert.doesNotMatch(html, /data-project-id="p3"/);
});

test('sidebar saved views render only when present', () => {
  const none = renderSidebarHtml(makeState(), { todayBadge: 0, projectOpen: {} });
  assert.doesNotMatch(none, /Saved views/);
  assert.doesNotMatch(none, /data-action="select-saved-view"/);

  const withViews = renderSidebarHtml(makeState({
    librarySavedViews: [{ label: 'Deploy notes', tags: ['deploy'] }],
  }), { todayBadge: 0, projectOpen: {} });
  assert.match(withViews, /<span>Saved views<\/span>/);
  assert.match(withViews, /data-action="select-saved-view" data-view-index="0"/);
  assert.match(withViews, /Deploy notes/);
});

test('sidebar settings item is pinned and active on the settings view', () => {
  const html = renderSidebarHtml(makeState({ navType: 'settings' }), { todayBadge: 0, projectOpen: {} });
  assert.match(html, /class="sidebar__settings"/);
  assert.match(html, /class="side-item is-active" data-action="nav-settings" aria-current="true"/);

  const idle = renderSidebarHtml(makeState({ navType: 'today' }), { todayBadge: 0, projectOpen: {} });
  assert.match(idle, /class="side-item" data-action="nav-settings"/);
});

test('sidebar and titlebar escape hostile project names', () => {
  const state = makeState({
    navType: 'project',
    navId: 'px',
    projects: [{ id: 'px', name: '<script>alert(1)</script>', status: 'active' }],
  });
  const sidebar = renderSidebarHtml(state, { todayBadge: 0, projectOpen: {} });
  assert.doesNotMatch(sidebar, /<script>alert\(1\)<\/script>/);
  assert.match(sidebar, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const titlebar = renderTitlebarHtml(state);
  assert.doesNotMatch(titlebar, /<script>alert\(1\)<\/script>/);
  assert.match(titlebar, /prax — &lt;script&gt;/);
});

// ---------------------------------------------------------------------------
// Icon rail
// ---------------------------------------------------------------------------

test('rail renders four nav buttons with tooltips and a divider', () => {
  const html = renderRailHtml(makeState());
  assert.match(html, /class="rail"/);
  assert.match(html, /title="Today" data-action="nav-today"/);
  assert.match(html, /title="All projects" data-action="nav-all"/);
  assert.match(html, /title="Library" data-action="nav-library"/);
  assert.match(html, /title="Settings" data-action="nav-settings"/);
  assert.match(html, /class="rail__divider"/);
});

test('rail marks the active nav button and the current project dot', () => {
  const html = renderRailHtml(makeState({ navType: 'project', navId: 'p2', projects: PROJECTS }));
  assert.match(html, /class="rail__proj is-active" title="Reading Pipeline" data-action="nav-project" data-project-id="p2"/);
  assert.match(html, /class="rail__proj" title="Homelab"/);
  assert.doesNotMatch(html, /class="rail__btn is-active"/);

  const library = renderRailHtml(makeState({ navType: 'library' }));
  assert.match(library, /class="rail__btn is-active" title="Library"/);

  const editor = renderRailHtml(makeState({ navType: 'editor' }));
  assert.match(editor, /class="rail__btn is-active" title="Library"/);
});

// ---------------------------------------------------------------------------
// Statusbar
// ---------------------------------------------------------------------------

test('statusbar shows the saved indicator and all keyboard hints', () => {
  const html = renderStatusbarHtml(makeState());
  assert.match(html, /class="statusbar"/);
  assert.match(html, /class="statusbar__saved">All changes saved locally</);
  assert.match(html, /class="statusbar__hints"/);
  assert.match(html, /class="kbd">⌘K<\/span> command/);
  assert.match(html, /class="kbd">N<\/span> new task/);
  assert.match(html, /class="kbd">↑↓<\/span> navigate/);
  assert.match(html, /class="kbd">E<\/span> done/);
  assert.match(html, /class="kbd">⌘J<\/span> theme/);
});

// ---------------------------------------------------------------------------
// projectColor
// ---------------------------------------------------------------------------

test('projectColor is deterministic per id and varies across ids', () => {
  assert.equal(projectColor({ id: 'abc-123' }), projectColor({ id: 'abc-123' }));
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const colors = ids.map((id) => projectColor({ id }));
  for (const color of colors) assert.match(color, /^oklch\(/);
  assert.ok(new Set(colors).size > 1, 'different ids should not all share one color');
});
