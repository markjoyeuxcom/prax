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

  assert.match(html, /High Priority/);
  assert.match(html, /In Progress/);
  assert.match(html, /Planned/);
  assert.match(html, /Completed/);
  assert.match(html, /Notes/);
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
  assert.match(html, /Check &quot;quoted&quot; value/);
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
