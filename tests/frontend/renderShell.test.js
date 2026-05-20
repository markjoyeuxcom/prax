import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShellHtml } from '../../public/js/renderShell.js';

test('renderShellHtml includes navigation, context filters, status, and metrics', () => {
  const html = renderShellHtml({
    activeView: 'list',
    activeContext: 'homelab',
    metrics: {
      dueToday: 4,
      overdue: 1,
      inProgress: 7,
      completedThisWeek: 18,
    },
  });

  assert.match(html, /Today/);
  assert.match(html, /Moomora Console/);
  assert.match(html, /aria-label="Moomora Console navigation"/);
  assert.match(html, /Board/);
  assert.match(html, /Homelab/);
  assert.match(html, /Library/);
  assert.match(html, /Postgres/);
  assert.match(html, /Due today/);
  assert.match(html, /Completed this week/);
  assert.match(html, />4</);
  assert.match(html, />18</);
  assert.match(html, /aria-pressed="true"/);
});

test('renderShellHtml derives heading from active view', () => {
  const html = renderShellHtml({
    activeView: 'board',
    activeContext: 'work',
    metrics: {},
  });

  assert.match(html, /<h1 id="view-title">Board<\/h1>/);
  assert.match(html, /Track active work by status/);
});

test('renderShellHtml derives Library heading and document action', () => {
  const html = renderShellHtml({
    activeView: 'library',
    activeContext: 'homelab',
    metrics: {},
  });

  assert.match(html, /console-main console-main--library/);
  assert.match(html, /<h1 id="view-title">Library<\/h1>/);
  assert.match(html, /Markdown runbooks and notes/);
  assert.match(html, /data-action="new-document"/);
  assert.match(html, /\[\+\] new doc/);
  assert.doesNotMatch(html, /aria-label="Task metrics"/);
  assert.doesNotMatch(html, /Due today/);
});

test('renderShellHtml defaults missing metric values and reflects API status', () => {
  const html = renderShellHtml({
    apiStatus: 'error',
    metrics: {
      dueToday: 2,
      overdue: Number.NaN,
    },
  });

  assert.match(html, /Offline/);
  assert.match(html, />2</);
  assert.match(html, />0</);
});

test('renderShellHtml includes workflow hooks for search, context, and actions', () => {
  const html = renderShellHtml({
    activeContext: 'work',
    searchQuery: 'backup',
  });

  assert.match(html, /data-context="work"/);
  assert.match(html, /data-action="new-task"/);
  assert.match(html, /data-action="open-settings"/);
  assert.match(html, /data-action="open-admin"/);
  assert.doesNotMatch(html, /data-action="import-document"/);
  assert.doesNotMatch(html, /data-action="export"/);
  assert.match(html, /value="backup"/);
});

test('shell renders a status footer with breadcrumb, sync, and mode tag', () => {
  const html = renderShellHtml({
    activeContext: 'homelab',
    activeView: 'list',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="status-footer"/);
  assert.match(html, /class="status-footer__breadcrumb"/);
  assert.match(html, /moomora.*today.*homelab/i);
  assert.match(html, /class="status-footer__sync"/);
  assert.match(html, /class="status-footer__mode">&lt;TODAY&gt;/);
});

test('shell topbar renders bracket-style Admin and primary action buttons', () => {
  const html = renderShellHtml({
    activeContext: 'homelab',
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
    activeContext: 'homelab',
    activeView: 'library',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /data-action="new-document"[^>]*>\[\+\] new doc/);
});

test('shell renders bottom nav with 5 slots and active state', () => {
  const html = renderShellHtml({
    activeContext: 'homelab', activeView: 'library',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /data-bottom-nav="library"[^>]*class="[^"]*is-active"/);
  assert.match(html, /data-bottom-nav="new"/);
});

test('shell bottom nav new slot dispatches new-document on library and new-task elsewhere', () => {
  const libHtml = renderShellHtml({
    activeContext: 'homelab', activeView: 'library',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(libHtml, /data-bottom-nav="new"[^>]*data-action="new-document"/);

  const todayHtml = renderShellHtml({
    activeContext: 'homelab', activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(todayHtml, /data-bottom-nav="new"[^>]*data-action="new-task"/);
});

test('shell renders hamburger drawer with backlog, admin, contexts', () => {
  const html = renderShellHtml({
    activeContext: 'homelab', activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
    isDrawerOpen: false,
  });
  assert.match(html, /class="hamburger-drawer"/);
  assert.match(html, /data-view="backlog"/);
  assert.match(html, /data-action="open-admin"/);
  assert.match(html, /data-context="personal"/);
});

test('shell drawer is open when isDrawerOpen is true', () => {
  const html = renderShellHtml({
    activeContext: 'homelab', activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
    isDrawerOpen: true,
  });
  assert.match(html, /class="hamburger-drawer is-open"/);
});

test('shell renders hamburger trigger button', () => {
  const html = renderShellHtml({
    activeContext: 'homelab', activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="hamburger-trigger"[^>]*data-action="toggle-drawer"/);
});

test('topbar shows [↑] import only on the library view', () => {
  const lib = renderShellHtml({ activeContext: 'homelab', activeView: 'library', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.match(lib, /data-action="import-document"[^>]*>\[↑\] import/);
  const today = renderShellHtml({ activeContext: 'homelab', activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.doesNotMatch(today, /data-action="import-document"/);
});

test('topbar search placeholder is context-aware', () => {
  const lib = renderShellHtml({ activeContext: 'homelab', activeView: 'library', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.match(lib, /placeholder="Search documents"/);
  assert.match(lib, /Search documents<\/span>/);

  const today = renderShellHtml({ activeContext: 'homelab', activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {} });
  assert.match(today, /placeholder="Search tasks"/);
  assert.match(today, /Search tasks<\/span>/);
});

test('hamburger drawer has inert when closed and not when open', () => {
  const closed = renderShellHtml({ activeContext: 'homelab', activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {}, isDrawerOpen: false });
  assert.match(closed, /aria-hidden="true" inert/);

  const open = renderShellHtml({ activeContext: 'homelab', activeView: 'list', apiStatus: 'connected', searchQuery: '', metrics: {}, isDrawerOpen: true });
  assert.doesNotMatch(open, / inert/);
});
