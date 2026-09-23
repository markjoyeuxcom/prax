import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectPageHtml, renderProjectTabsHtml, renderDensityToggle } from '../../public/js/renderProjectPage.js';
import {
  renderAppFrameHtml, renderBootErrorHtml, renderDocumentNotFoundHtml, renderTasksLoadingHtml, renderToastRootHtml,
} from '../../public/js/renderAppFrame.js';

const baseState = { tab: 'list', groupBy: 'due', preferences: {}, collapsedSections: [], revealedOpsFields: [], renamingProjectId: null };

test('the project header escapes the status it puts in a class and the chip', () => {
  const project = { id: 'p1', slug: 'ops', name: 'Ops', status: 'active" onmouseover="alert(1)' };
  const html = renderProjectPageHtml(baseState, project, { bodyHtml: '<ul class="list"></ul>' });
  assert.doesNotMatch(html, /onmouseover="alert/);
  assert.match(html, /chip--state-active&quot; onmouseover=&quot;alert\(1\)/);
  assert.match(html, /<ul class="list"><\/ul>/, 'the tab body is inserted as rendered HTML');
});

test('the project colour dot is escaped in its style attribute', () => {
  const html = renderProjectPageHtml(baseState, { id: 'p1', slug: 'ops', name: 'Ops', status: 'active' });
  assert.match(html, /<span class="page-head__dot" style="--dot:oklch\([^"<>]*\)"><\/span>/);
  const loading = renderProjectPageHtml(baseState, undefined);
  assert.match(loading, /style="--dot:var\(--accent\)"/);
  assert.match(loading, /<h1 class="page-head__title">Tasks<\/h1>/);
});

test('a project name is escaped in the title and the rename field', () => {
  const project = { id: 'p1', slug: 'ops', name: '<b>Ops</b>', status: 'on-hold' };
  assert.match(renderProjectPageHtml(baseState, project), /<h1 class="page-head__title">&lt;b&gt;Ops&lt;\/b&gt;<\/h1>/);
  assert.match(renderProjectPageHtml({ ...baseState, renamingProjectId: 'p1' }, project), /value="&lt;b&gt;Ops&lt;\/b&gt;"/);
  assert.match(renderProjectPageHtml(baseState, project), /chip chip--state-on-hold">on hold</);
});

test('system projects show their purpose and hint and cannot be renamed', () => {
  const html = renderProjectPageHtml(baseState, { id: 'i1', slug: 'inbox', name: 'Inbox', status: 'active' });
  assert.match(html, /chip chip--system">System · capture and review</);
  assert.match(html, /class="view-hint"/);
  assert.doesNotMatch(html, /data-action="rename-project"/);
  assert.match(html, /data-tab="inbox">To process</);
});

test('tabs carry the backlog and archive counts; the list tab adds grouping and density', () => {
  const tabs = renderProjectTabsHtml({ ...baseState, tab: 'list' }, { backlogCount: 3, archiveCount: 2 });
  assert.match(tabs, /data-tab="backlog">Backlog · 3</);
  assert.match(tabs, /data-tab="archive">Archive · 2</);
  assert.match(tabs, /Group: Due date/);
  assert.match(tabs, /data-action="set-list-density"/);
  assert.doesNotMatch(renderProjectTabsHtml({ ...baseState, tab: 'board' }), /cycle-group/);
  assert.match(renderDensityToggle({ preferences: { listDensity: 'compact' } }), /data-density="compact" aria-pressed="true"/);
});

test('the app frame places each region and the overlay root last', () => {
  const html = renderAppFrameHtml({ titlebarHtml: '<header>t</header>', navHtml: '<nav>n</nav>', mainHtml: '<p>m</p>', flatMain: true, statusbarHtml: '<footer>s</footer>', overlaysHtml: '<div>o</div>' });
  assert.match(html, /<header>t<\/header>[\s\S]*<nav>n<\/nav>[\s\S]*main__scroll main__scroll--flat">.*<p>m<\/p>[\s\S]*<footer>s<\/footer>[\s\S]*<div data-overlay-root><div>o<\/div><\/div>$/);
  assert.doesNotMatch(renderAppFrameHtml({ mainHtml: 'x' }), /main__scroll--flat/);
});

test('placeholders keep their markup and the boot error escapes its message', () => {
  assert.match(renderTasksLoadingHtml(), /role="status" aria-live="polite"/);
  assert.match(renderDocumentNotFoundHtml(), /Document not found\./);
  assert.equal(renderToastRootHtml('<div class="toast"></div>'), '<div data-toast-root><div class="toast"></div></div>');
  assert.match(renderBootErrorHtml('<img src=x onerror=alert(1)>'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(renderBootErrorHtml(), /Unknown error/);
});
