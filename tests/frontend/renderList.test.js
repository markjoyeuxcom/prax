import test from 'node:test';
import assert from 'node:assert/strict';
import { renderListHtml } from '../../public/js/renderList.js';
import { renderTaskDetailHtml } from '../../public/js/renderTaskDetail.js';

test('list renders a task card with priority stripe and bracket badge', () => {
  const tasks = [{
    id: 'aaa', title: 'Back up CNPG',
    description: 'Verify backup schedule',
    priority: 'high', status: 'planned', context: 'homelab',
    dueDate: '2026-05-19', sortOrder: 0,
  }];
  const html = renderListHtml(tasks, 'aaa', {
    title: 'Today', countLabel: 'active tasks',
    emptyTitle: '', emptyDescription: '',
  });
  assert.match(html, /class="task-card[^"]*task-card--hi[^"]*"/);
  assert.match(html, /class="task-card[^"]*is-selected"/);
  assert.match(html, /class="bracket-badge bracket-badge--hi">\[ HIGH \]/);
  assert.match(html, /Back up CNPG/);
  assert.match(html, /due <strong>2026-05-19<\/strong>/);
});

test('list renders empty state in bracketed form', () => {
  const html = renderListHtml([], null, {
    title: 'Today', countLabel: 'active',
    emptyTitle: 'No tasks',
    emptyDescription: 'Add work to see it here.',
  });
  assert.match(html, /class="task-list--empty"/);
  assert.match(html, /\[ no tasks \]/i);
});

test('renderListHtml renders task title and count label', () => {
  const html = renderListHtml([
    {
      id: 'task-1',
      title: 'Back up CNPG',
      description: 'Verify backup schedule',
      priority: 'high',
      status: 'planned',
      dueDate: '2026-05-10',
    },
  ], null, { title: 'Task Queue', countLabel: 'active tasks' });

  assert.match(html, /Task Queue/);
  assert.match(html, /Back up CNPG/);
  assert.match(html, /1 active tasks/);
  assert.match(html, /2026-05-10/);
});

test('renderListHtml marks selected cards and escapes task content', () => {
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
  assert.match(html, /is-selected/);
  assert.match(html, /in progress/);
  assert.match(html, /no due/);
});

test('renderListHtml supports view-specific titles and empty states', () => {
  const html = renderListHtml([], null, {
    title: 'Archived Tasks',
    countLabel: 'archived tasks',
    emptyTitle: 'No archived tasks',
    emptyDescription: 'Archived work will appear here.',
  });

  assert.match(html, /Archived Tasks/);
  assert.match(html, /0 archived tasks/);
  assert.match(html, /\[ no archived tasks \]/i);
  assert.match(html, /Archived work will appear here\./);
});

test('renderListHtml renders low priority badge correctly', () => {
  const html = renderListHtml([
    { id: 't1', title: 'Low task', priority: 'low', status: 'planned', dueDate: null },
  ]);
  assert.match(html, /task-card--lo/);
  assert.match(html, /bracket-badge--lo/);
  assert.match(html, /\[ LOW \]/);
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
  assert.match(html, /bracket-badge--hi.*\[ HIGH \]|class="bracket-badge bracket-badge--hi">\[ HIGH \]/);
  assert.match(html, /&lt;planned&gt;/);
  assert.match(html, /2026-05-10 &amp; verify/);
  assert.match(html, /Checklist/);
  assert.match(html, /Notes/);
  assert.match(html, /Activity/);
  assert.match(html, /data-action="edit-task"/);
  assert.match(html, /data-action="archive-task"/);
});

test('renderTaskDetailHtml hides actions when read-only', () => {
  const html = renderTaskDetailHtml({
    title: 'Archived task',
    description: '',
    priority: 'low',
    status: 'completed',
    dueDate: null,
  }, { readOnly: true });

  assert.doesNotMatch(html, /data-action="edit-task"/);
  assert.doesNotMatch(html, /data-action="archive-task"/);
});

test('renderTaskDetailHtml shows restore action for archived tasks', () => {
  const html = renderTaskDetailHtml({
    title: 'Archived task',
    description: '',
    priority: 'low',
    status: 'completed',
    dueDate: null,
  }, { readOnly: true, restoreAction: true, deleteAction: true });

  assert.match(html, /data-action="restore-task"/);
  assert.match(html, /data-action="delete-archived-task"/);
  assert.match(html, /data-action="restore-task"[^>]*>\[r\] restore/);
  assert.match(html, /data-action="delete-archived-task"[^>]*>\[!\] delete/);
  assert.doesNotMatch(html, /data-action="edit-task"/);
  assert.doesNotMatch(html, /data-action="archive-task"/);
});
