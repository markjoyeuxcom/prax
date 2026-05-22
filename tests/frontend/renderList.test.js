import test from 'node:test';
import assert from 'node:assert/strict';
import { renderListHtml, renderSwimlaneListHtml, renderListToolbar } from '../../public/js/renderList.js';
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

const SWIMLANE_PROJECTS = [
  { id: 'p1', name: 'Homelab' },
  { id: 'p2', name: 'Work' },
];

test('renderSwimlaneListHtml groups cards under per-project lane headers', () => {
  const tasks = [
    { id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' },
    { id: 't2', title: 'Beta', priority: 'low', status: 'planned', projectId: 'p2' },
  ];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.match(html, /data-task-lane="p1"/);
  assert.match(html, /data-task-lane="p2"/);
  assert.match(html, /class="task-lane__name">Homelab</);
  assert.match(html, /class="task-lane__name">Work</);
  assert.match(html, /class="task-lane__count">· 1</);
  assert.match(html, /Alpha/);
  assert.match(html, /Beta/);
  assert.match(html, /data-action="toggle-list-lane"[^>]*data-project-id="p1"/);
});

test('renderSwimlaneListHtml only renders lanes for projects with tasks', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.match(html, /data-task-lane="p1"/);
  assert.doesNotMatch(html, /data-task-lane="p2"/);
});

test('renderSwimlaneListHtml puts unknown-project tasks in a No project lane', () => {
  const tasks = [{ id: 't1', title: 'Orphan', priority: 'medium', status: 'planned', projectId: 'ghost' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.match(html, /data-task-lane="__none__"/);
  assert.match(html, /class="task-lane__name">No project</);
});

test('renderSwimlaneListHtml omits the No project lane when every task maps to a known project', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.doesNotMatch(html, /data-task-lane="__none__"/);
});

test('renderSwimlaneListHtml hides cards in a collapsed lane but keeps the header', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS, listLaneCollapsed: { p1: true } });
  assert.match(html, /task-lane--collapsed/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /class="task-lane__name">Homelab</);
  assert.doesNotMatch(html, /data-task-id="t1"/);
});

test('renderSwimlaneListHtml renders the empty state when there are no tasks', () => {
  const html = renderSwimlaneListHtml([], null, { projects: SWIMLANE_PROJECTS, emptyTitle: 'No tasks', emptyDescription: 'Nothing here' });
  assert.match(html, /task-list--empty/);
});

test('renderSwimlaneListHtml marks the selected card inside its lane', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, 't1', { projects: SWIMLANE_PROJECTS });
  assert.match(html, /class="task-card[^"]*is-selected"/);
  assert.match(html, /aria-current="true"/);
});

test('renderListToolbar renders flat and swimlanes options with the active one pressed', () => {
  const html = renderListToolbar('swimlanes');
  assert.match(html, /data-action="set-list-grouping"[^>]*data-grouping="flat"[^>]*aria-pressed="false"/);
  assert.match(html, /data-action="set-list-grouping"[^>]*data-grouping="swimlanes"[^>]*aria-pressed="true"/);
});

test('renderListHtml still renders a flat task list and panel header', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned' }];
  const html = renderListHtml(tasks, 't1', { title: 'Task Queue', countLabel: 'active tasks' });
  assert.match(html, /class="task-panel"/);
  assert.match(html, /id="task-queue-title">Task Queue</);
  assert.match(html, /1 active tasks/);
  assert.match(html, /class="task-list"/);
  assert.match(html, /Alpha/);
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

test('renderSwimlaneListHtml escapes the project name in the lane header', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const projects = [{ id: 'p1', name: '<b>"Home"</b>' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects });
  assert.match(html, /&lt;b&gt;&quot;Home&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>"Home"<\/b>/);
});

test('renderListToolbar marks flat as active by default', () => {
  const html = renderListToolbar();
  assert.match(html, /data-grouping="flat"[^>]*aria-pressed="true"/);
  assert.match(html, /data-grouping="swimlanes"[^>]*aria-pressed="false"/);
});

test('renderListHtml renders a provided toolbar in the panel header', () => {
  const html = renderListHtml([], null, { toolbar: '<div class="list-toolbar">TOGGLE</div>' });
  assert.match(html, /<header class="panel-header">[\s\S]*list-toolbar[\s\S]*<\/header>/);
});
