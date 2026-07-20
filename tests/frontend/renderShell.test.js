import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTitlebarHtml,
  renderPanelHtml,
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
    panelTab: 'projects',
    panelFilter: '',
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
// Icon rail — primary navigation at every width
// ---------------------------------------------------------------------------

const INBOX = { id: 'inbox-id', name: 'Inbox', slug: 'inbox', status: 'active' };

test('rail renders every top-level nav with tooltips, Settings pinned last', () => {
  const html = renderRailHtml(makeState());
  assert.match(html, /class="rail"/);
  assert.match(html, /title="Today" data-action="nav-today"/);
  assert.match(html, /title="Upcoming" data-action="nav-upcoming"/);
  assert.match(html, /title="Calendar" data-action="nav-calendar"/);
  assert.match(html, /title="All projects" data-action="nav-all"/);
  assert.match(html, /title="Library" data-action="nav-library"/);
  assert.match(html, /title="Filter" data-action="nav-filter"/);
  assert.match(html, /class="rail__spacer"><\/div><button[^>]*title="Settings" data-action="nav-settings"/);
});

test('rail marks active nav; Library stays active in the editor; Settings gets its own state', () => {
  const library = renderRailHtml(makeState({ navType: 'library' }));
  assert.match(library, /class="rail__btn is-active" title="Library"/);
  const editor = renderRailHtml(makeState({ navType: 'editor' }));
  assert.match(editor, /class="rail__btn is-active" title="Library"/);
  const settings = renderRailHtml(makeState({ navType: 'settings' }));
  assert.match(settings, /class="rail__btn is-active" title="Settings" data-action="nav-settings" aria-current="true"/);
});

test('rail badges: Today count and Inbox open count render only when > 0, capped at 99+', () => {
  const state = makeState({ projects: [INBOX] });
  const quiet = renderRailHtml(state, { todayBadge: 0, projectOpen: { 'inbox-id': 0 } });
  assert.doesNotMatch(quiet, /rail__badge/);
  const busy = renderRailHtml(state, { todayBadge: 4, projectOpen: { 'inbox-id': 130 } });
  assert.match(busy, /title="Today"[^>]*>[\s\S]*?class="rail__badge">4</);
  assert.match(busy, /title="Inbox"[^>]*>[\s\S]*?class="rail__badge">99\+</);
});

test('rail includes an Inbox button navigating to the Inbox project', () => {
  const html = renderRailHtml(makeState({ projects: [INBOX, ...PROJECTS] }));
  assert.match(html, /class="rail__btn[^"]*" title="Inbox" data-action="nav-project" data-project-id="inbox-id"/);
});

test('rail project dots render in narrow mode and are suppressed when the panel owns projects', () => {
  const state = makeState({ navType: 'project', navId: 'p2', projects: PROJECTS });
  const narrow = renderRailHtml(state, {}, { showProjects: true });
  assert.match(narrow, /class="rail__divider"/);
  assert.match(narrow, /class="rail__proj is-active" title="Reading Pipeline" data-action="nav-project" data-project-id="p2"/);
  assert.match(narrow, /class="rail__proj" title="Homelab"/);
  const wide = renderRailHtml(state, {}, { showProjects: false });
  assert.doesNotMatch(wide, /rail__proj/);
  assert.doesNotMatch(wide, /rail__divider/);
});

// ---------------------------------------------------------------------------
// Browser panel — Projects tab
// ---------------------------------------------------------------------------

test('panel renders brand, both tab counts, the filter box, and manage-projects on the Projects tab', () => {
  const html = renderPanelHtml(makeState({ projects: PROJECTS }), {});
  assert.match(html, /class="sidebar__wordmark">prax</);
  assert.match(html, /class="sidebar__byline">by moomora</);
  assert.match(html, /data-action="set-panel-tab" data-tab="projects" aria-selected="true">Projects <span class="panel__tabcount">2</);
  assert.match(html, /data-action="set-panel-tab" data-tab="views" aria-selected="false">Views <span class="panel__tabcount">1</); // built-in Stale
  assert.match(html, /data-panel-filter[^>]*placeholder="Filter 2 projects…"/);
  assert.match(html, /data-action="manage-projects"/);
});

test('panel project rows keep dots, counts, active state, and exclude the pinned Inbox', () => {
  const html = renderPanelHtml(
    makeState({ navType: 'project', navId: 'p1', projects: [INBOX, ...PROJECTS] }),
    { projectOpen: { p1: 4, 'inbox-id': 3 } },
  );
  assert.match(html, /class="side-item side-item--saved is-active" data-action="nav-project" data-project-id="p1" aria-current="true"/);
  assert.match(html, /class="side-item__count">4</);
  assert.match(html, /data-project-id="p2"[^>]*><span class="proj-dot is-onhold" style="--dot: oklch\(/);
  assert.doesNotMatch(html, /data-project-id="inbox-id"/, 'Inbox lives in the rail, not the panel');
});

test('panel hides projects that are not active or on-hold', () => {
  const html = renderPanelHtml(makeState({
    projects: [...PROJECTS, { id: 'p3', name: 'Done thing', status: 'completed' }],
  }), {});
  assert.doesNotMatch(html, /data-project-id="p3"/);
});

test('panel filter narrows projects case-insensitively and reports no matches honestly', () => {
  const state = makeState({ projects: PROJECTS, panelFilter: 'home' });
  const html = renderPanelHtml(state, {});
  assert.match(html, /data-project-id="p1"/);
  assert.doesNotMatch(html, /data-project-id="p2"/);
  assert.match(html, /data-panel-filter[^>]*value="home"/, 'the typed filter survives re-renders');
  const none = renderPanelHtml(makeState({ projects: PROJECTS, panelFilter: 'zzz' }), {});
  assert.match(none, /class="panel__empty">No matches\.</);
});

// ---------------------------------------------------------------------------
// Browser panel — Views tab
// ---------------------------------------------------------------------------

test('panel Views tab renders smart views (built-in Stale without delete) and library views with delete', () => {
  const html = renderPanelHtml(makeState({
    panelTab: 'views',
    taskSmartViews: [{ id: 'p1-overdue', label: 'P1 overdue', expr: 'p1 & overdue' }],
    librarySavedViews: [{ label: 'Deploy notes', tags: ['deploy'] }],
  }), {});
  assert.match(html, /data-action="select-smart-view" data-view-id="p1-overdue"/);
  assert.match(html, /data-action="delete-smart-view" data-view-id="p1-overdue"/);
  assert.match(html, /data-action="select-smart-view" data-view-id="builtin-stale"/);
  assert.doesNotMatch(html, /data-action="delete-smart-view" data-view-id="builtin-stale"/);
  assert.match(html, /<span>Library views<\/span>/);
  assert.match(html, /data-action="select-saved-view" data-view-index="0"/);
  assert.match(html, /data-action="delete-library-view" data-view-index="0"/);
  assert.doesNotMatch(html, /data-action="manage-projects"/, 'the ＋ belongs to the Projects tab');
});

test('panel Views tab marks the active smart view', () => {
  const html = renderPanelHtml(makeState({
    panelTab: 'views',
    navType: 'filter',
    activeSmartViewId: 'p1-overdue',
    taskSmartViews: [{ id: 'p1-overdue', label: 'P1 overdue', expr: 'p1 & overdue' }],
  }), {});
  assert.match(html, /class="side-item side-item--saved side-item--twoctl is-active"[^>]*data-view-id="p1-overdue" aria-current="true"/);
});

test('panel Views filter narrows by label and keeps library-view delete indices UNFILTERED', () => {
  const html = renderPanelHtml(makeState({
    panelTab: 'views',
    panelFilter: 'retro',
    taskSmartViews: [{ id: 'v1', label: 'P1 overdue', expr: 'p1' }],
    librarySavedViews: [
      { label: 'Deploy notes', tags: ['deploy'] },
      { label: 'Retro notes', tags: ['retro'] },
    ],
  }), {});
  assert.doesNotMatch(html, /data-view-id="v1"/);
  assert.doesNotMatch(html, /Deploy notes/);
  // "Retro notes" is index 1 in the stored list — the delete action must
  // address the unfiltered index or it would delete the wrong view.
  assert.match(html, /data-action="select-saved-view" data-view-index="1"/);
  assert.match(html, /data-action="delete-library-view" data-view-index="1"/);
});

test('panel escapes hostile project and view names', () => {
  const state = makeState({
    navType: 'project',
    navId: 'px',
    projects: [{ id: 'px', name: '<script>alert(1)</script>', status: 'active' }],
  });
  const panel = renderPanelHtml(state, {});
  assert.doesNotMatch(panel, /<script>alert\(1\)<\/script>/);
  assert.match(panel, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const views = renderPanelHtml(makeState({
    panelTab: 'views',
    librarySavedViews: [{ label: '<script>x</script>', tags: ['x'] }],
  }), {});
  assert.doesNotMatch(views, /<script>x<\/script>/);

  const titlebar = renderTitlebarHtml(state);
  assert.doesNotMatch(titlebar, /<script>alert\(1\)<\/script>/);
  assert.match(titlebar, /prax — &lt;script&gt;/);
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

test('desktop shell suppresses the fake window chrome (the OS provides it)', () => {
  const desktopMac = renderTitlebarHtml(makeState({ desktopShell: true, preferences: { chromeOS: 'mac' } }));
  assert.doesNotMatch(desktopMac, /class="traffic"/);
  const desktopWin = renderTitlebarHtml(makeState({ desktopShell: true, preferences: { chromeOS: 'win' } }));
  assert.doesNotMatch(desktopWin, /class="winctl"/);
  // the app toolbar itself stays
  assert.match(desktopMac, /data-action="open-palette"/);
  assert.match(desktopMac, /data-action="open-capture"/);
});

test('desktop shell keeps the panel mark inline with the wordmark, smaller than in the browser', () => {
  const panel = renderPanelHtml(makeState({ desktopShell: true }), {});
  assert.match(panel, /sidebar__brand"><svg width="20"/);
  assert.match(panel, /sidebar__wordmark">prax</);
  // the rail hides its logo in the shell (an icon under the lights reads as a button)
  const rail = renderRailHtml(makeState({ desktopShell: true }));
  assert.doesNotMatch(rail, /aria-label="Navigation"><svg/);
  // browser mode keeps the full-size logo
  const webPanel = renderPanelHtml(makeState(), {});
  assert.match(webPanel, /sidebar__brand"><svg width="25"/);
});

test('desktop shell titlebar is the drag region with no left ornament', () => {
  const html = renderTitlebarHtml(makeState({ desktopShell: true }));
  assert.match(html, /<div class="titlebar" data-tauri-drag-region>/);
  assert.match(html, /titlebar__crumb" data-tauri-drag-region/);
  assert.doesNotMatch(html, /titlebar" data-tauri-drag-region><svg/);
  const web = renderTitlebarHtml(makeState());
  assert.doesNotMatch(web, /data-tauri-drag-region/);
});

// ---------------------------------------------------------------------------
// Pinned favorites
// ---------------------------------------------------------------------------

test('pinned projects float into a leading Pinned section in list order; stars reflect state', () => {
  const state = makeState({
    projects: PROJECTS,
    pinned: { projects: ['p2'], smartViews: [], libraryViews: [] },
  });
  const html = renderPanelHtml(state, {});
  assert.match(html, /<span>Pinned<\/span>/);
  const pinnedPos = html.indexOf('data-project-id="p2"');
  const restPos = html.indexOf('data-project-id="p1"');
  assert.ok(pinnedPos !== -1 && pinnedPos < restPos, 'the pinned project renders first');
  assert.match(html, /data-action="toggle-pin" data-kind="projects" data-key="p2"[^>]*aria-pressed="true"[^>]*>★/);
  assert.match(html, /data-action="toggle-pin" data-kind="projects" data-key="p1"[^>]*aria-pressed="false"[^>]*>☆/);
});

test('a stale pin for a deleted project renders no Pinned section', () => {
  const html = renderPanelHtml(makeState({
    projects: PROJECTS,
    pinned: { projects: ['ghost'], smartViews: [], libraryViews: [] },
  }), {});
  assert.doesNotMatch(html, /<span>Pinned<\/span>/);
});

test('Views tab: pinned smart and library views share the Pinned section; library keys are labels', () => {
  const html = renderPanelHtml(makeState({
    panelTab: 'views',
    taskSmartViews: [{ id: 'sv1', label: 'Waiting on', expr: '@waiting' }],
    librarySavedViews: [{ label: 'Deploy docs', tags: ['deploy'] }],
    pinned: { projects: [], smartViews: ['builtin-stale'], libraryViews: ['Deploy docs'] },
  }), {});
  assert.match(html, /<span>Pinned<\/span>/);
  const pinnedHeader = html.indexOf('Pinned');
  const stale = html.indexOf('data-view-id="builtin-stale"');
  const deploy = html.indexOf('data-action="select-saved-view"');
  const waiting = html.indexOf('data-view-id="sv1"');
  assert.ok(stale > pinnedHeader && deploy > pinnedHeader, 'both pinned kinds lead');
  assert.ok(waiting > stale, 'unpinned smart view renders after the pinned block');
  assert.match(html, /data-action="toggle-pin" data-kind="libraryViews" data-key="Deploy docs"/);
});
