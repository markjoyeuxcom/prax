import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTitlebarHtml,
  renderPanelHtml,
  renderRailHtml,
  renderStatusbarHtml,
  projectColor,
  buildBreadcrumb,
  RECENT_MIN_PROJECTS,
  ON_HOLD_SECTION,
  statusbarFacts,
  RAIL_PROJECT_LIMIT,
} from '../../public/js/renderShell.js';

function makeState(overrides = {}) {
  return {
    // 'all' keeps the default panel in BROWSER context: the panel is now
    // context-aware (Today renders the plan cockpit), and these tests are
    // about the browser. Context panels get their own suite below.
    navType: 'all',
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

const CURRENT = (label) => new RegExp(`<span class="titlebar__crumb-current" aria-current="page">${label}</span>`);

test('titlebar breadcrumb reflects each fixed navType as a single current segment', () => {
  for (const [navType, label] of [['today', 'Today'], ['calendar', 'Calendar'], ['all', 'All projects'], ['library', 'Library'], ['filter', 'Filter']]) {
    const html = renderTitlebarHtml(makeState({ navType }));
    assert.match(html, /<nav class="titlebar__crumb" aria-label="Breadcrumb">/);
    assert.match(html, CURRENT(label));
    assert.doesNotMatch(html, /titlebar__crumb-link/, `${navType} has nothing to go back to`);
    assert.doesNotMatch(html, /data-action="nav-/, 'crumb links never carry the rail actions directly');
  }
  assert.doesNotMatch(renderTitlebarHtml(makeState({ navType: 'today' })), /prax — /);
});

test('titlebar breadcrumb for a project is Area › Project › Tab, with the project a link when off the list tab', () => {
  const projects = [{ id: 'p1', name: 'Homelab', status: 'active', area: 'Labs' }];
  const list = renderTitlebarHtml(makeState({ navType: 'project', navId: 'p1', tab: 'list', projects }));
  assert.match(list, /<span class="titlebar__crumb-text">Labs<\/span><span class="titlebar__crumb-sep" aria-hidden="true">›<\/span><button type="button" class="titlebar__crumb-link" data-action="breadcrumb" data-target="nav-project" data-project-id="p1">Homelab<\/button>/);
  assert.match(list, CURRENT('List'));
  const board = renderTitlebarHtml(makeState({ navType: 'project', navId: 'p1', tab: 'board', projects: PROJECTS }));
  assert.doesNotMatch(board, /crumb-text/, 'no area, no area segment');
  assert.match(board, /data-action="breadcrumb" data-target="nav-project" data-project-id="p1">Homelab</);
  assert.match(board, CURRENT('Board'));
  assert.deepEqual(buildBreadcrumb(makeState({ navType: 'project', navId: 'missing' })), [{ label: 'Tasks' }]);
});

test('titlebar breadcrumb: Library › doc in the editor, Library › doc › Run in a run, Library › Archive', () => {
  const documents = [{ id: 'd1', title: 'Backup runbook' }];
  const editor = renderTitlebarHtml(makeState({ navType: 'editor', editorDocId: 'd1', documents }));
  assert.match(editor, /<button type="button" class="titlebar__crumb-link" data-action="breadcrumb" data-target="nav-library">Library<\/button>/);
  assert.match(editor, CURRENT('Backup runbook'));
  const run = renderTitlebarHtml(makeState({ navType: 'run', runReturnDocId: 'd1', documents }));
  assert.match(run, /data-target="nav-library">Library</);
  assert.match(run, /class="titlebar__crumb-link" data-action="breadcrumb" data-target="open-linked-doc" data-document-id="d1">Backup runbook</);
  assert.match(run, CURRENT('Run'));
  const archive = renderTitlebarHtml(makeState({ navType: 'library', libraryView: 'archive' }));
  assert.match(archive, /data-target="nav-library">Library</);
  assert.match(archive, CURRENT('Archive'));
  const health = renderTitlebarHtml(makeState({ navType: 'health' }));
  assert.match(health, /data-target="nav-library">Library</);
  assert.match(health, CURRENT('Health'));
  const settings = renderTitlebarHtml(makeState({ navType: 'settings', settingsTab: 'data' }));
  assert.match(settings, /data-target="nav-settings">Settings</);
  assert.match(settings, CURRENT('Data &amp; admin'));
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
  // New is one menu button: task (quick capture), document, project.
  assert.match(html, /class="btn-primary" data-action="toggle-new-menu" aria-haspopup="true" aria-expanded="false"[^>]*>[\s\S]*?<span>New<\/span><span class="btn-primary__chevron" aria-hidden="true">▾/);
  assert.doesNotMatch(html, /data-action="open-capture"/, 'capture lives in the menu, not the bar');
  assert.doesNotMatch(html, /data-action="new-project"/);
  const open = renderTitlebarHtml(makeState({ newMenuOpen: true }));
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /class="menu__item" type="button" data-action="open-capture">New task<span class="menu__item-sub">Quick capture · N/);
  assert.match(open, /class="menu__item" type="button" data-action="new-document">New document/);
  assert.match(open, /class="menu__item" type="button" data-action="new-project">New project/);
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
  assert.doesNotMatch(html, /nav-upcoming/, 'Upcoming folded into Today as the week ahead');
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

test('rail project tiles in narrow mode: current, pinned and recent only, lettered, capped; none when the panel owns projects', () => {
  const state = makeState({ navType: 'project', navId: 'p2', projects: PROJECTS, pinned: { projects: ['p1'], smartViews: [], libraryViews: [] } });
  const narrow = renderRailHtml(state, {}, { showProjects: true });
  assert.match(narrow, /class="rail__divider"/);
  assert.match(narrow, /class="rail__proj is-active" title="Reading Pipeline" data-action="nav-project" data-project-id="p2"[^>]*><span class="rail__proj-letter" style="--dot: oklch\([^"]+\)">R</);
  assert.match(narrow, /class="rail__proj" title="Homelab"[^>]*><span class="rail__proj-letter"[^>]*>H</);
  assert.ok(narrow.indexOf('data-project-id="p2"') < narrow.indexOf('data-project-id="p1"'), 'the current project leads');
  // Neither pinned nor recent nor current: no tiles at all, no divider.
  const bare = renderRailHtml(makeState({ navType: 'today', projects: PROJECTS }), {}, { showProjects: true });
  assert.doesNotMatch(bare, /rail__proj/);
  assert.doesNotMatch(bare, /rail__divider/);
  // Capped at RAIL_PROJECT_LIMIT, recents after pins, no duplicates.
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, status: 'active' }));
  const capped = renderRailHtml(makeState({ navType: 'today', projects: many, pinned: { projects: ['q1', 'q2'], smartViews: [], libraryViews: [] }, recentProjects: ['q2', 'q5', 'q6', 'q7'] }), {}, { showProjects: true });
  assert.equal((capped.match(/class="rail__proj"/g) || []).length, RAIL_PROJECT_LIMIT);
  assert.deepEqual([...capped.matchAll(/data-project-id="(q\d)"/g)].map((m) => m[1]), ['q1', 'q2', 'q5', 'q6', 'q7']);
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
  // On-hold projects live in a folded section; open it to see the hollow dot.
  const opened = renderPanelHtml(makeState({ projects: PROJECTS, collapsedSections: [ON_HOLD_SECTION] }), {});
  assert.match(opened, /data-project-id="p2"[^>]*><span class="proj-dot is-onhold" style="--dot: oklch\(/);
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
  assert.match(titlebar, /titlebar__crumb-link[^>]*>&lt;script&gt;/);
});

// ---------------------------------------------------------------------------
// Statusbar
// ---------------------------------------------------------------------------

test('statusbar shows the saved indicator, one line of workspace facts, and a way to the shortcut list', () => {
  const html = renderStatusbarHtml(makeState({
    projects: [...PROJECTS, { id: 'p3', name: 'Done', status: 'completed' }],
    tasks: [{ id: 't1', status: 'planned' }, { id: 't2', status: 'completed' }, { id: 't3', status: 'in-progress', archivedAt: '2026-07-01' }],
    documents: [{ id: 'd1' }, { id: 'd2', archivedAt: '2026-07-01' }],
  }));
  assert.match(html, /class="statusbar"/);
  assert.match(html, /class="statusbar__saved">Saved locally</);
  assert.match(html, /class="statusbar__facts"><span>2 projects<\/span><span class="statusbar__dot" aria-hidden="true">·<\/span><span>1 open task<\/span><span class="statusbar__dot" aria-hidden="true">·<\/span><span>1 document<\/span><\/span>/);
  assert.match(html, /class="statusbar__shortcuts" data-action="open-shortcuts"[^>]*><span class="kbd">⌘\/<\/span> shortcuts</);
  assert.doesNotMatch(html, /statusbar__hints/, 'the fixed hint strip is gone');
  assert.deepEqual(statusbarFacts(makeState()), ['0 projects', '0 open tasks', '0 documents']);
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
  assert.match(desktopMac, /data-action="toggle-new-menu"/);
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
  assert.match(html, /class="titlebar__crumb" aria-label="Breadcrumb" data-tauri-drag-region/);
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

test('Recent projects lead the panel once the list is long enough; stale ids skip; a typed filter hides it', () => {
  const projects = Array.from({ length: RECENT_MIN_PROJECTS }, (_, index) => ({
    id: `r${index}`, name: `Project ${index}`, status: 'active', area: index % 2 ? 'Work' : null,
  }));
  const state = makeState({ navType: 'project', navId: 'r1', projects, recentProjects: ['r1', 'ghost', 'r4'] });
  const html = renderPanelHtml(state, { projectOpen: { r4: 7 } });
  assert.match(html, /<span>Recent<\/span>/);
  const recentBlock = html.slice(html.indexOf('<span>Recent</span>'), html.indexOf('panel__rest-gap'));
  assert.match(recentBlock, /class="side-item side-item--recent is-active" data-action="nav-project" data-project-id="r1" aria-current="true">[\s\S]*?Project 1<\/span><span class="side-item__sub">Work</);
  assert.match(recentBlock, /data-project-id="r4"[^>]*>[\s\S]*?side-item__count">7/);
  assert.doesNotMatch(recentBlock, /ghost/);
  assert.ok(recentBlock.indexOf('data-project-id="r1"') < recentBlock.indexOf('data-project-id="r4"'), 'most recent first');
  assert.doesNotMatch(recentBlock, /toggle-pin/, 'recent rows carry no star; the area row below does');
  assert.ok(html.indexOf('<span>Recent</span>') < html.indexOf('data-project-id="r0"'), 'Recent leads the areas');
  assert.equal((html.match(/data-project-id="r1"/g) || []).length, 2, 'the project still lists in its area');

  assert.doesNotMatch(renderPanelHtml({ ...state, panelFilter: 'pro' }, {}), /<span>Recent<\/span>/);
  assert.doesNotMatch(renderPanelHtml({ ...state, projects: projects.slice(0, RECENT_MIN_PROJECTS - 1) }, {}), /<span>Recent<\/span>/);
  assert.doesNotMatch(renderPanelHtml({ ...state, recentProjects: ['ghost'] }, {}), /<span>Recent<\/span>/);
});

test('on-hold projects fold into a trailing On hold section: closed by default, open with the stored key, a filter, or when current', () => {
  const projects = [
    { id: 'a1', name: 'Alpha', status: 'active', area: 'Work' },
    { id: 'h1', name: 'Paused one', status: 'on-hold', area: 'Work' },
    { id: 'h2', name: 'Paused two', status: 'on-hold' },
  ];
  const closed = renderPanelHtml(makeState({ projects }), {});
  assert.match(closed, /data-action="toggle-section" data-section-key="panel:onhold" aria-expanded="false"[^>]*>[\s\S]*?<span>On hold<\/span><span class="side-section__count">2</);
  assert.doesNotMatch(closed, /data-project-id="h1"/);
  assert.doesNotMatch(closed, /data-project-id="h2"/);
  assert.match(closed, /data-section-key="area:Work"[^>]*>[\s\S]*?side-section__count">1/, 'the area counts active projects only');
  assert.ok(closed.indexOf('data-section-key="area:Work"') < closed.indexOf('data-section-key="panel:onhold"'), 'On hold trails the areas');

  const opened = renderPanelHtml(makeState({ projects, collapsedSections: [ON_HOLD_SECTION] }), {});
  assert.match(opened, /data-section-key="panel:onhold" aria-expanded="true"/);
  assert.match(opened, /data-project-id="h1"/);
  assert.match(opened, /data-project-id="h2"/);

  const filtered = renderPanelHtml(makeState({ projects, panelFilter: 'paused' }), {});
  assert.match(filtered, /data-project-id="h1"/);
  assert.doesNotMatch(filtered, /data-project-id="a1"/);

  const current = renderPanelHtml(makeState({ navType: 'project', navId: 'h2', projects }), {});
  assert.match(current, /data-section-key="panel:onhold" aria-expanded="true"/);
  assert.match(current, /class="side-item side-item--saved is-active" data-action="nav-project" data-project-id="h2"/);

  const pinnedHold = renderPanelHtml(makeState({ projects, pinned: { projects: ['h1'], smartViews: [], libraryViews: [] } }), {});
  assert.match(pinnedHold, /<span>Pinned<\/span>[\s\S]*?data-project-id="h1"/, 'a pinned on-hold project floats to Pinned');
  assert.match(pinnedHold, /side-section__count">1<\/span>[\s\S]*$/, 'and leaves the On hold count');
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

// ---------------------------------------------------------------------------
// Areas and folders
// ---------------------------------------------------------------------------

const AREA_PROJECTS = [
  { id: 'w1', name: 'K8s upgrade', status: 'active', area: 'Work' },
  { id: 'h1', name: 'House move', status: 'active', area: 'Home' },
  { id: 'n1', name: 'Loose end', status: 'active' },
];

test('projects group under alphabetical area sections with counts; unassigned under Other', () => {
  const html = renderPanelHtml(makeState({ projects: AREA_PROJECTS, collapsedSections: [] }), {});
  const home = html.indexOf('data-section-key="area:Home"');
  const work = html.indexOf('data-section-key="area:Work"');
  const other = html.indexOf('data-section-key="area:__other"');
  assert.ok(home !== -1 && work !== -1 && other !== -1);
  assert.ok(home < work && work < other, 'areas alphabetical, Other last');
  assert.match(html, /data-section-key="area:Work"[^>]*aria-expanded="true"/);
  assert.match(html, /<span>Other<\/span><span class="side-section__count">1</);
  // No areas anywhere -> no area sections (the on-hold project in PROJECTS
  // still gets its own folded On hold section).
  const flat = renderPanelHtml(makeState({ projects: PROJECTS, collapsedSections: [] }), {});
  assert.doesNotMatch(flat, /data-section-key="area:/);
  assert.match(flat, /data-section-key="panel:onhold"/);
});

test('a collapsed area hides its rows and flips the chevron; the filter auto-expands', () => {
  const collapsed = renderPanelHtml(makeState({
    projects: AREA_PROJECTS, collapsedSections: ['area:Work'],
  }), {});
  assert.match(collapsed, /data-section-key="area:Work"[^>]*aria-expanded="false"/);
  assert.match(collapsed, /class="side-section__chevron">▸/);
  assert.doesNotMatch(collapsed, /data-project-id="w1"/, 'collapsed rows do not render');
  assert.match(collapsed, /data-project-id="h1"/, 'other sections unaffected');

  const filtered = renderPanelHtml(makeState({
    projects: AREA_PROJECTS, collapsedSections: ['area:Work'], panelFilter: 'k8s',
  }), {});
  assert.match(filtered, /data-project-id="w1"/, 'a typed filter must never hide matches in a collapsed section');
});

test('pinned projects stay above area grouping', () => {
  const html = renderPanelHtml(makeState({
    projects: AREA_PROJECTS,
    collapsedSections: [],
    pinned: { projects: ['h1'], smartViews: [], libraryViews: [] },
  }), {});
  const pinnedPos = html.indexOf('<span>Pinned</span>');
  const firstArea = html.indexOf('data-section-key=');
  assert.ok(pinnedPos !== -1 && pinnedPos < firstArea, 'Pinned leads, groups follow');
});

test('foldered smart views group on the Views tab; loose views (incl. Stale) stay flat first', () => {
  const html = renderPanelHtml(makeState({
    panelTab: 'views',
    collapsedSections: [],
    taskSmartViews: [
      { id: 'daily-standup', label: 'standup', expr: 'open', folder: 'Daily' },
      { id: 'loose', label: 'loose one', expr: 'open' },
    ],
  }), {});
  assert.match(html, /data-section-key="folder:Daily"/);
  const loosePos = html.indexOf('data-view-id="loose"');
  const folderPos = html.indexOf('data-section-key="folder:Daily"');
  const otherPos = html.indexOf('data-section-key="folder:__other"');
  assert.ok(otherPos !== -1 && loosePos > otherPos, 'loose views sit under the Views header');
  assert.ok(folderPos < otherPos, 'named folders come before the loose remainder');
});

// ---------------------------------------------------------------------------
// Context panels
// ---------------------------------------------------------------------------

test('the panel dispatches on navType: cockpit, calendar, library, settings, browser', () => {
  const base = { projects: PROJECTS, tasks: [], documents: [] };
  assert.match(renderPanelHtml(makeState({ ...base, navType: 'today' }), {}), /aria-label="Today"/);
  assert.match(renderPanelHtml(makeState({ ...base, navType: 'calendar' }), {}), /aria-label="Calendar"/);
  assert.match(renderPanelHtml(makeState({ ...base, navType: 'library' }), {}), /aria-label="Library"/);
  assert.match(renderPanelHtml(makeState({ ...base, navType: 'editor' }), {}), /aria-label="Library"/);
  assert.match(renderPanelHtml(makeState({ ...base, navType: 'settings', settingsTab: 'appearance' }), {}), /aria-label="Settings"/);
  for (const nav of ['all', 'project', 'filter']) {
    assert.match(renderPanelHtml(makeState({ ...base, navType: nav }), {}), /aria-label="Browser"/, nav);
  }
});

test('Today cockpit: score, ritual buttons, honest counts, planned rows via open-task', () => {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const tasks = [
    { id: 'a', title: 'Planned one', status: 'planned', projectId: 'p1', plannedFor: iso, sortOrder: 0, labels: [] },
    { id: 'b', title: 'Done one', status: 'completed', projectId: 'p1', plannedFor: iso, labels: [] },
    { id: 'c', title: 'Overdue one', status: 'planned', projectId: 'p1', dueDate: '2020-01-01', labels: [] },
    { id: 'd', title: 'Snoozed one', status: 'planned', projectId: 'p1', deferredUntil: '2099-01-01T00:00:00Z', labels: [] },
    { id: 'e', title: 'Tomorrow one', status: 'planned', projectId: 'p1', dueDate: tomorrowIso, labels: [] },
  ];
  const html = renderPanelHtml(makeState({ navType: 'today', tasks, projects: PROJECTS }), {});
  assert.match(html, /data-panel-plan-score[^>]*>planned 2 — 1 done/);
  assert.match(html, /data-action="open-plan-mode"[^>]*>Plan today/);
  assert.match(html, /data-action="open-shutdown"/);
  assert.match(html, /Overdue<\/span><span class="side-item__count">1/);
  assert.match(html, /Next 7 days<\/span><span class="side-item__count">1/);
  assert.match(html, /Snoozed<\/span><span class="side-item__count">1/);
  assert.match(html, /data-action="open-task" data-task-id="a"/);
  // Rituals: weekly review with its due state, brief, library health.
  assert.match(html, /<span>Rituals<\/span>/);
  assert.match(html, /data-action="generate-weekly-review">[\s\S]*?Weekly review<\/span><span class="side-item__count is-due">due</);
  assert.match(html, /data-action="open-daily-brief">[\s\S]*?Brief me/);
  assert.match(html, /data-action="open-health">[\s\S]*?Library health/);
  const reviewed = renderPanelHtml(makeState({ navType: 'today', tasks, projects: PROJECTS, documents: [{ id: 'w', title: 'Weekly review — 2026-W40', updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }] }), {});
  assert.match(reviewed, /Weekly review<\/span><span class="side-item__count">2d ago</);
  // Without a plan: no score, no shutdown, planning still offered.
  const bare = renderPanelHtml(makeState({ navType: 'today', tasks: [], projects: [] }), {});
  assert.doesNotMatch(bare, /data-panel-plan-score/);
  assert.doesNotMatch(bare, /data-action="open-shutdown"/);
  assert.match(bare, /data-action="open-plan-mode"/);
});

test('Calendar panel: mini grid with load dot, today mark, selection, month nav, day peek', () => {
  const tasks = [{ id: 't1', title: 'On the fifteenth', status: 'planned', projectId: 'p1', dueDate: '2026-03-15', labels: [] }];
  const html = renderPanelHtml(makeState({
    navType: 'calendar', tasks, projects: PROJECTS,
    calendarMonth: '2026-03', calendarSelectedDay: '2026-03-15',
  }), {});
  assert.match(html, /March 2026/);
  assert.match(html, /data-action="calendar-prev"/);
  assert.match(html, /data-action="calendar-next"/);
  assert.match(html, /data-action="calendar-select-day" data-day="2026-03-15"[^>]*>15/);
  assert.match(html, /panel__mini-day is-selected has-tasks|has-tasks[^"]*is-selected/);
  // The selected day's tasks preview underneath.
  assert.match(html, /data-action="open-task" data-task-id="t1"/);
  // A day without tasks peeks honestly.
  const empty = renderPanelHtml(makeState({
    navType: 'calendar', tasks: [], projects: [], calendarMonth: '2026-03', calendarSelectedDay: '2026-03-02',
  }), {});
  assert.match(empty, /Nothing due\./);
});

test('Library panel: type counts as toggle-lib-type facets, saved views, recent by updatedAt', () => {
  const documents = [
    { id: 'd1', title: 'Older note', documentType: 'note', updatedAt: '2026-07-01T00:00:00Z' },
    { id: 'd2', title: 'Newer runbook', documentType: 'runbook', updatedAt: '2026-07-19T00:00:00Z' },
    { id: 'd3', title: 'Archived', documentType: 'note', updatedAt: '2026-07-20T00:00:00Z', archivedAt: '2026-07-20T01:00:00Z' },
  ];
  const html = renderPanelHtml(makeState({
    navType: 'library', documents, libraryTypes: ['runbook'],
    librarySavedViews: [{ label: 'Deploy notes', tags: ['deploy'] }],
  }), {});
  assert.match(html, /data-action="toggle-lib-type" data-facet="note"[^>]*>[\s\S]*?side-item__count">1/);
  assert.match(html, /class="side-item is-active" data-action="toggle-lib-type" data-facet="runbook"/);
  assert.match(html, /data-action="select-saved-view" data-view-index="0"/);
  assert.match(html, /data-action="delete-library-view" data-view-index="0"/);
  const newer = html.indexOf('data-document-id="d2"');
  const older = html.indexOf('data-document-id="d1"');
  assert.ok(newer !== -1 && newer < older, 'recent list is updatedAt-descending');
  assert.doesNotMatch(html, /data-document-id="d3"/, 'archived docs are not recent');
});

test('Library panel: Project and Trust facets with counts, only where they have documents or are active', () => {
  const documents = [
    { id: 'd1', title: 'A', documentType: 'note', projectId: 'p1', verified: true },
    { id: 'd2', title: 'B', documentType: 'runbook', projectId: 'p1', stale: true },
    { id: 'd3', title: 'C', documentType: 'note', projectId: 'p2' },
  ];
  const html = renderPanelHtml(makeState({
    navType: 'library', documents, libraryTrust: ['superseded'], libraryProjects: ['p2'],
    projects: [{ id: 'p1', name: 'Homelab', status: 'active' }, { id: 'p2', name: 'Work', status: 'active' }, { id: 'p3', name: 'Empty', status: 'active' }],
  }), {});
  assert.match(html, /<span>Project<\/span>/);
  assert.match(html, /data-action="toggle-lib-project" data-facet="p1" aria-pressed="false">[\s\S]*?Homelab[\s\S]*?side-item__count">2/);
  assert.match(html, /class="side-item is-active" data-action="toggle-lib-project" data-facet="p2" aria-pressed="true"/);
  assert.doesNotMatch(html, /data-facet="p3"/, 'a project with no documents is not a facet');
  assert.match(html, /<span>Trust<\/span>/);
  assert.match(html, /data-action="toggle-lib-trust" data-facet="verified"[^>]*>[\s\S]*?side-item__count">1/);
  assert.match(html, /data-action="toggle-lib-trust" data-facet="stale"/);
  assert.match(html, /class="side-item is-active" data-action="toggle-lib-trust" data-facet="superseded" aria-pressed="true"/, 'an active facet with no documents stays visible so it can be cleared');
  assert.doesNotMatch(html, /data-facet="agent"/);
});

test('Library panel: tags by use with a fold, a tag box past the limit, active tags always shown, Save view when active', () => {
  const documents = Array.from({ length: 14 }, (_, index) => ({
    id: `d${index}`, title: `Doc ${index}`, documentType: 'note',
    // tag0 is on every doc, tag1 on all but one, … so counts descend by index.
    tags: Array.from({ length: 14 - index }, (_, tagIndex) => `tag${tagIndex}`),
  }));
  const html = renderPanelHtml(makeState({ navType: 'library', documents, activeLibraryTags: ['tag13'] }), {});
  assert.match(html, /<span>Tags<\/span><span class="side-section__count">14</);
  assert.match(html, /data-library-tag-filter[^>]*placeholder="Find a tag…"/);
  assert.match(html, /class="side-item side-item--tag" data-action="toggle-lib-tag" data-tag="tag0" aria-pressed="false">[\s\S]*?#tag0[\s\S]*?side-item__count">14/);
  assert.match(html, /class="side-item side-item--tag is-active" data-action="toggle-lib-tag" data-tag="tag13" aria-pressed="true"/, 'the active tag ranks last but is shown');
  assert.doesNotMatch(html, /data-tag="tag11"/, 'past the fold');
  assert.match(html, /data-action="toggle-lib-tags" aria-expanded="false"[^>]*>[\s\S]*?3 more, by use/);
  assert.match(html, /data-action="save-library-view"/);

  const expanded = renderPanelHtml(makeState({ navType: 'library', documents, libraryTagsExpanded: true }), {});
  assert.match(expanded, /data-tag="tag11"/);
  assert.match(expanded, /data-action="toggle-lib-tags" aria-expanded="true"[^>]*>[\s\S]*?Show fewer/);

  const narrowed = renderPanelHtml(makeState({ navType: 'library', documents, libraryTagFilter: '#TAG1' }), {});
  assert.match(narrowed, /data-tag="tag1"/);
  assert.match(narrowed, /data-tag="tag13"/, 'a narrowed list ignores the fold');
  assert.doesNotMatch(narrowed, /data-tag="tag0"/);
  assert.doesNotMatch(narrowed, /toggle-lib-tags/);
  assert.match(renderPanelHtml(makeState({ navType: 'library', documents, libraryTagFilter: 'zzz' }), {}), /No matching tags\./);

  const few = renderPanelHtml(makeState({ navType: 'library', documents: documents.slice(12) }), {});
  assert.doesNotMatch(few, /data-library-tag-filter/, 'no tag box under the limit');
});

test('Library panel: the review queue leads the panel when agent memory waits, and marks active in the review view', () => {
  const documents = [
    { id: 'd1', title: 'Human note', documentType: 'note' },
    { id: 'd2', title: 'Agent memory', documentType: 'note', updatedBy: 'agent', verified: false },
    { id: 'd3', title: 'Verified agent memory', documentType: 'note', updatedBy: 'agent', verified: true },
  ];
  const html = renderPanelHtml(makeState({ navType: 'library', documents }), {});
  assert.match(html, /class="side-item side-item--review" data-action="open-review-queue" aria-pressed="false">[\s\S]*?Review queue<\/span><span class="side-item__count">1</);
  assert.ok(html.indexOf('open-review-queue') < html.indexOf('<span>Type</span>'), 'queue before the facets');
  const active = renderPanelHtml(makeState({ navType: 'library', documents, libraryView: 'review' }), {});
  assert.match(active, /class="side-item side-item--review is-active" data-action="open-review-queue" aria-pressed="true"/);
  assert.match(active, /toggle-lib-type/, 'facets still apply inside the queue');
  assert.doesNotMatch(renderPanelHtml(makeState({ navType: 'library', documents: [documents[0]] }), {}), /open-review-queue/, 'no row when nothing waits');
});

test('rail: the Library button carries an amber review badge and names the count', () => {
  const html = renderRailHtml(makeState(), { reviewQueue: 7 });
  assert.match(html, /title="Library · 7 to review" data-action="nav-library"[^>]*>[\s\S]*?<span class="rail__badge rail__badge--review">7</);
  assert.doesNotMatch(renderRailHtml(makeState(), { reviewQueue: 0 }), /rail__badge--review/);
});

test('titlebar breadcrumb: Library › Review queue', () => {
  const html = renderTitlebarHtml(makeState({ navType: 'library', libraryView: 'review' }));
  assert.match(html, /data-target="nav-library">Library</);
  assert.match(html, CURRENT('Review queue'));
});

test('Library panel: facets step aside in archive and semantic modes; saved views and recent stay', () => {
  const documents = [{ id: 'd1', title: 'Only', documentType: 'note', tags: ['x'], updatedAt: '2026-07-01T00:00:00Z' }];
  const archive = renderPanelHtml(makeState({ navType: 'library', documents, libraryView: 'archive', librarySavedViews: [{ label: 'Saved', tags: ['x'] }] }), {});
  assert.doesNotMatch(archive, /toggle-lib-type/);
  assert.match(archive, /Facets apply to the browse view\./);
  assert.match(archive, /data-action="select-saved-view"/);
  assert.match(archive, /data-document-id="d1"/);
  const semantic = renderPanelHtml(makeState({ navType: 'library', documents, librarySemantic: true }), {});
  assert.doesNotMatch(semantic, /toggle-lib-tag/);
  assert.match(semantic, /facets apply while browsing/);
});

test('Settings panel: section rows with active state; status renders only from loaded state', () => {
  const html = renderPanelHtml(makeState({ navType: 'settings', settingsTab: 'integrations' }), {});
  assert.match(html, /class="side-item is-active" data-action="set-settings-tab" data-tab="integrations" aria-current="true"/);
  assert.match(html, /data-tab="appearance"/);
  assert.match(html, /data-tab="data"/);
  assert.doesNotMatch(html, /Status/, 'nothing loaded, no status block');

  const withStatus = renderPanelHtml(makeState({
    navType: 'settings', settingsTab: 'appearance', desktopShell: true,
    googleCalendarStatus: { connected: true, configured: true, lastPushAt: new Date(Date.now() - 5 * 60_000).toISOString() },
    captureShortcut: { shortcut: 'Alt+Space', default: 'CmdOrCtrl+Shift+Space' },
  }), {});
  assert.match(withStatus, /Calendar synced<\/span><span class="side-item__count">5m ago/);
  assert.match(withStatus, /Capture<\/span><span class="side-item__count">Alt\+Space/);
});
