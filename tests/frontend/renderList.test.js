import test from 'node:test';
import assert from 'node:assert/strict';
import { renderListHtml } from '../../public/js/renderList.js';
import { renderTaskDetailHtml } from '../../public/js/renderTaskDetail.js';

test('renderListHtml renders task queue rows', () => {
  const html = renderListHtml([
    {
      id: 'task-1',
      title: 'Back up CNPG',
      description: 'Verify backup schedule',
      priority: 'high',
      status: 'planned',
      dueDate: '2026-05-10',
    },
  ]);

  assert.match(html, /Task Queue/);
  assert.match(html, /Back up CNPG/);
  assert.match(html, /High/);
  assert.match(html, /2026-05-10/);
});

test('renderListHtml marks selected rows and escapes task content', () => {
  const html = renderListHtml([
    {
      id: 'task-"1"',
      title: '<script>alert("x")</script>',
      description: '',
      priority: 'medium',
      status: 'in-progress',
      dueDate: null,
    },
  ], 'task-"1"');

  assert.match(html, /aria-current="true"/);
  assert.match(html, /data-task-id="task-&quot;1&quot;"/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /No description/);
  assert.match(html, /In Progress/);
  assert.match(html, />-</);
});

test('renderListHtml renders an empty queue state', () => {
  const html = renderListHtml([]);

  assert.match(html, /No tasks in this queue/);
});

test('renderTaskDetailHtml renders selected task metadata and future sections', () => {
  const html = renderTaskDetailHtml({
    title: 'Rotate <secrets>',
    description: 'Update "cluster" credentials',
    priority: 'high',
    status: '<planned>',
    dueDate: '2026-05-10 & verify',
  });

  assert.match(html, /Rotate &lt;secrets&gt;/);
  assert.match(html, /Update &quot;cluster&quot; credentials/);
  assert.match(html, /Priority/);
  assert.match(html, /High/);
  assert.match(html, /&lt;planned&gt;/);
  assert.match(html, /2026-05-10 &amp; verify/);
  assert.match(html, /Checklist/);
  assert.match(html, /Notes/);
  assert.match(html, /Activity/);
  assert.match(html, /data-action="edit-task"/);
  assert.match(html, /data-action="archive-task"/);
});
