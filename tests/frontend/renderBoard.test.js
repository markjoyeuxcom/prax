import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardHtml } from '../../public/js/renderBoard.js';

test('renderBoardHtml renders status columns and task cards', () => {
  const html = renderBoardHtml([
    {
      id: 'task-1',
      title: 'Back up CNPG',
      description: 'Verify schedule',
      priority: 'high',
      status: 'planned',
      dueDate: '2026-05-18',
    },
  ]);

  assert.match(html, /\[ HIGH PRIORITY \]/);
  assert.match(html, /\[ IN PROGRESS \]/);
  assert.match(html, /\[ PLANNED \]/);
  assert.match(html, /\[ COMPLETED \]/);
  assert.match(html, /\[ NOTES \]/);
  assert.match(html, /Back up CNPG/);
  assert.match(html, /2026-05-18/);
});

test('renderBoardHtml escapes task fields and marks selected card', () => {
  const html = renderBoardHtml([
    {
      id: 'task-"1"',
      title: 'Fix <cluster>',
      description: 'Check "quoted" value',
      priority: 'medium',
      status: 'in-progress',
      dueDate: null,
    },
  ], 'task-"1"');

  assert.match(html, /data-task-id="task-&quot;1&quot;"/);
  assert.match(html, /aria-current="true"/);
  assert.match(html, /Fix &lt;cluster&gt;/);
});

test('renderBoardHtml includes drag and drop hooks', () => {
  const html = renderBoardHtml([
    {
      id: 'task-1',
      title: 'Patch ingress',
      description: 'Review release notes',
      priority: 'medium',
      status: 'in-progress',
      dueDate: null,
    },
  ]);

  assert.match(html, /data-board-column="in-progress"/);
  assert.match(html, /data-board-card="true"/);
  assert.match(html, /draggable="true"/);
});

test('board column header is bracketed and shows count', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'high', status: 'high-priority', sortOrder: 0 }];
  const html = renderBoardHtml(tasks, 'a');
  assert.match(html, /class="board-column__header"/);
  assert.match(html, /\[ HIGH PRIORITY \]/);
  assert.match(html, /class="board-column__count">1/);
});

test('board card uses bracket card markup with priority stripe', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'high', status: 'in-progress', sortOrder: 0, dueDate: '2026-05-19' }];
  const html = renderBoardHtml(tasks, 'a');
  assert.match(html, /class="board-card board-card--hi is-selected"/);
  assert.match(html, /2026-05-19/);
});

test('board column header includes a collapse toggle', () => {
  const html = renderBoardHtml([], null, { boardOpenSections: { 'high-priority': true } });
  assert.match(html, /data-action="toggle-board-section"[^>]*data-section="high-priority"/);
  assert.match(html, /▾/);
});

test('board column with closed section uses closed glyph and hidden cards', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'low', status: 'planned', sortOrder: 0 }];
  const html = renderBoardHtml(tasks, null, { boardOpenSections: { planned: false } });
  assert.doesNotMatch(html, /data-board-column="planned"[^>]*aria-expanded="false"/);
  assert.match(html, /data-section="planned"[^>]*aria-expanded="false"/);
  assert.match(html, /data-section="planned"[\s\S]*?▸/);
});
