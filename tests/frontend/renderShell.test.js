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
  assert.match(html, /Board/);
  assert.match(html, /Homelab/);
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
  assert.match(html, /data-action="import"/);
  assert.match(html, /data-action="export"/);
  assert.match(html, /value="backup"/);
});
