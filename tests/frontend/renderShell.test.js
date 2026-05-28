import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShellHtml } from '../../public/js/renderShell.js';

// ---------------------------------------------------------------------------
// Project nav — core assertions
// ---------------------------------------------------------------------------

test('renderShellHtml renders All-projects button active when activeProject is "all"', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }],
    activeView: 'list',
    metrics: { dueToday: 4, overdue: 1, inProgress: 7, completedThisWeek: 18 },
  });

  // "All projects" button with active class (class comes before data-project in markup)
  assert.match(html, /class="nav-button is-active"[^>]*data-project="all"/);
  // Project button present
  assert.match(html, /data-project="p1"/);
  assert.match(html, /Homelab/);
  // Action buttons present
  assert.match(html, /data-action="new-project"/);
  assert.match(html, /data-action="open-project-manager"/);
  // Standard shell elements still present
  assert.match(html, /Tasks/);
  assert.match(html, /Moomora Console/);
  assert.match(html, /aria-label="Moomora Console navigation"/);
  assert.match(html, /Board/);
  assert.match(html, /Library/);
  assert.match(html, /Postgres/);
  assert.match(html, /class="metric-strip"/);
  assert.match(html, /due today/i);
  assert.match(html, /4/);
  assert.match(html, /18/);
  assert.match(html, /aria-pressed="true"/);
});

test('renderShellHtml renders project button active when activeProject matches a project id', () => {
  const html = renderShellHtml({
    activeProject: 'p1',
    projects: [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }],
    activeView: 'list',
    metrics: {},
  });

  // p1 button has active class; all-projects does not
  assert.match(html, /class="nav-button is-active"[^>]*data-project="p1"/);
  assert.doesNotMatch(html, /class="nav-button is-active"[^>]*data-project="all"/);
  // Status-footer breadcrumb shows project name
  assert.match(html, /moomora.*homelab/i);
});

test('renderShellHtml status-footer breadcrumb shows "all projects" when activeProject is "all"', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [],
    activeView: 'list',
    metrics: {},
  });
  assert.match(html, /moomora.*all projects/i);
});

test('renderShellHtml includes new-project and open-project-manager controls', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [],
  });
  assert.match(html, /data-action="new-project"/);
  assert.match(html, /data-action="open-project-manager"/);
});

test('renderShellHtml groups manage and archived projects with new-project in the sidebar', () => {
  const html = renderShellHtml({ activeProject: 'all', projects: [] });
  // Manage/archived sit in the sidebar project tools menu, not as primary project rows.
  assert.match(html, /class="project-tools-menu"/);
  assert.match(html, /project-tools-menu[\s\S]*data-action="open-project-manager"/);
  assert.match(html, /project-tools-menu[\s\S]*data-action="open-archived-projects"/);
  // They are not in the topbar action group.
  assert.doesNotMatch(html, /class="topbar-actions">[\s\S]*data-action="open-project-manager"/);
});

// ---------------------------------------------------------------------------
// Existing tests updated to pass activeProject / projects instead of activeContext
// ---------------------------------------------------------------------------

test('renderShellHtml derives heading from active view', () => {
  const html = renderShellHtml({ activeView: 'board', activeProject: 'all', projects: [], metrics: {} });
  assert.match(html, /class="topbar-title"[^>]*>Board</);
  assert.doesNotMatch(html, /class="content-header"/);
  assert.match(html, /id="workspace" class="workspace workspace--board"/);
});

test('renderShellHtml derives Library heading and document action', () => {
  const html = renderShellHtml({ activeView: 'library', activeProject: 'all', projects: [], metrics: {} });
  assert.match(html, /console-main console-main--library/);
  assert.match(html, /class="topbar-title"[^>]*>Library</);
  assert.match(html, /data-action="new-document"/);
  assert.match(html, /\[\+\] new doc/);
  assert.doesNotMatch(html, /class="metric-strip"/);
});

test('renderShellHtml defaults missing metric values and reflects API status', () => {
  const html = renderShellHtml({
    apiStatus: 'error',
    activeProject: 'all',
    projects: [],
    metrics: {
      dueToday: 2,
      overdue: Number.NaN,
    },
  });

  assert.match(html, /Offline/);
  assert.match(html, /class="metric-strip"/);
  assert.match(html, /2/);
});

test('renderShellHtml includes workflow hooks for search and actions', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [],
    searchQuery: 'backup',
  });

  assert.match(html, /data-action="new-task"/);
  assert.match(html, /data-action="open-settings"/);
  assert.match(html, /data-action="open-admin"/);
  assert.doesNotMatch(html, /data-action="import-document"/);
  assert.doesNotMatch(html, /data-action="export"/);
  assert.match(html, /value="backup"/);
});

test('shell renders a status footer with breadcrumb, sync, and mode tag', () => {
  const html = renderShellHtml({
    activeProject: 'p1',
    projects: [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }],
    activeView: 'list',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="status-footer"/);
  assert.match(html, /class="status-footer__breadcrumb"/);
  assert.match(html, /moomora.*tasks.*homelab/i);
  assert.match(html, /class="status-footer__sync"/);
  assert.match(html, /class="status-footer__mode">&lt;TASKS&gt;/);
});

test('shell topbar renders bracket-style Admin and primary action buttons', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [],
    activeView: 'list',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /data-action="open-admin"[^>]*class="bracket-button[^"]*"[^>]*>\[a\] admin/);
  assert.match(html, /data-action="new-task"[^>]*class="bracket-button bracket-button--primary"[^>]*>\[\+\] new/);
});

test('shell topbar primary action becomes new-document on library view', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [],
    activeView: 'library',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /data-action="new-document"[^>]*>\[\+\] new doc/);
});

test('shell renders bottom nav with 5 slots and active state', () => {
  const html = renderShellHtml({
    activeProject: 'all', activeView: 'library',
    projects: [],
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /data-bottom-nav="library"[^>]*class="[^"]*is-active"/);
  assert.match(html, /data-bottom-nav="new"/);
});

test('shell bottom nav new slot dispatches new-document on library and new-task elsewhere', () => {
  const libHtml = renderShellHtml({
    activeProject: 'all', activeView: 'library',
    projects: [],
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(libHtml, /data-bottom-nav="new"[^>]*data-action="new-document"/);

  const todayHtml = renderShellHtml({
    activeProject: 'all', activeView: 'list',
    projects: [],
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(todayHtml, /data-bottom-nav="new"[^>]*data-action="new-task"/);
});

test('shell renders hamburger drawer with backlog, admin, and projects', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }],
    activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
    isDrawerOpen: false,
  });
  assert.match(html, /class="hamburger-drawer"/);
  assert.match(html, /data-view="backlog"/);
  assert.match(html, /data-action="open-admin"/);
  // Drawer shows projects section
  assert.match(html, /data-project="all"/);
  assert.match(html, /data-project="p1"/);
  // Drawer active state follows activeProject ('all' here)
  assert.match(html, /class="hamburger-drawer__item is-active"[^>]*data-project="all"/);
  assert.doesNotMatch(html, /class="hamburger-drawer__item is-active"[^>]*data-project="p1"/);
});

test('project name with HTML characters is escaped in the nav and breadcrumb', () => {
  const html = renderShellHtml({
    activeProject: 'p1',
    projects: [{ id: 'p1', name: '<script>alert(1)</script>', slug: 'x', status: 'active' }],
    activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('shell drawer is open when isDrawerOpen is true', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [],
    activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
    isDrawerOpen: true,
  });
  assert.match(html, /class="hamburger-drawer is-open"/);
});

test('shell renders hamburger trigger button', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [],
    activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="hamburger-trigger"[^>]*data-action="toggle-drawer"/);
});

test('topbar shows [↑] import only on the library view', () => {
  const lib = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'library', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.match(lib, /data-action="import-document"[^>]*>\[↑\] import/);
  const today = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.doesNotMatch(today, /data-action="import-document"/);
});

test('topbar search placeholder is context-aware', () => {
  const lib = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'library', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.match(lib, /placeholder="Search documents"/);
  assert.match(lib, /Search documents<\/span>/);

  const today = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.match(today, /placeholder="Search tasks"/);
  assert.match(today, /Search tasks<\/span>/);
});

test('hamburger drawer has inert when closed and not when open', () => {
  const closed = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {}, isDrawerOpen: false });
  assert.match(closed, /aria-hidden="true" inert/);

  const open = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {}, isDrawerOpen: true });
  assert.doesNotMatch(open, / inert/);
});

// ---------------------------------------------------------------------------
// Task 1: Views topbar tab strip + slim sidebar
// ---------------------------------------------------------------------------

test('topbar no longer contains view-switch tabs', () => {
  const html = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'board', metrics: {} });
  assert.doesNotMatch(html, /class="topbar-tabs"/);
  // No data-view buttons inside the topbar element
  const topbar = html.slice(html.indexOf('<header class="topbar"'), html.indexOf('</header>'));
  assert.doesNotMatch(topbar, /data-view=/);
});

test('topbar shows a compact view title', () => {
  const html = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'board', metrics: {} });
  assert.match(html, /class="topbar-title"[^>]*>Board</);
});

test('left rail groups WORK and VIEWS with all five views', () => {
  const html = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', metrics: {} });
  assert.match(html, /nav-label">Work/i);
  assert.match(html, /nav-label">Views/i);
  assert.match(html, /aria-label="Work"[\s\S]*data-view="list"/);
  assert.match(html, /aria-label="Work"[\s\S]*data-view="board"/);
  assert.match(html, /aria-label="Work"[\s\S]*data-view="library"/);
  assert.match(html, /aria-label="Views"[\s\S]*data-view="backlog"/);
  assert.match(html, /aria-label="Views"[\s\S]*data-view="archive"/);
});

test('metric strip is hidden on board and library, shown on list', () => {
  const list = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', metrics: { dueToday: 1 } });
  assert.match(list, /class="metric-strip"/);
  const board = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'board', metrics: { dueToday: 1 } });
  assert.doesNotMatch(board, /class="metric-strip"/);
  const lib = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'library', metrics: { dueToday: 1 } });
  assert.doesNotMatch(lib, /class="metric-strip"/);
});

test('sidebar still has projects nav with expected controls', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }],
    activeView: 'list',
    metrics: {},
  });
  assert.match(html, /data-project="all"/);
  assert.match(html, /class="project-tools-menu"/);
  assert.match(html, /data-action="new-project"/);
  assert.match(html, /data-action="open-project-manager"/);
});

test('sidebar project tools are behind a Projects menu', () => {
  const html = renderShellHtml({
    activeProject: 'all',
    projects: [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }],
    activeView: 'board',
    metrics: {},
  });

  assert.match(html, /<summary[^>]*class="project-tools-menu__summary"[^>]*>\[\.\.\.\]<\/summary>/);
  assert.match(html, /class="project-tools-menu__items"[\s\S]*data-action="new-project"/);
  assert.match(html, /class="project-tools-menu__items"[\s\S]*data-action="open-project-manager"/);
  assert.match(html, /class="project-tools-menu__items"[\s\S]*data-action="open-archived-projects"/);
  assert.match(html, /class="nav-button is-active"[^>]*data-project="all"/);
  assert.match(html, /data-project="p1"/);
});
