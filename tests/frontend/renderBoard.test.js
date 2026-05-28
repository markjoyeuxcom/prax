import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBoardFilters,
  renderBoardHtml,
  renderBoardToolbar,
  renderSwimlaneBoardHtml,
} from '../../public/js/renderBoard.js';
import { applyBoardFilters } from '../../public/js/boardFilters.js';

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

test('board cards render a priority dot matching the stripe', () => {
  const tasks = [
    { id: 'h', title: 'High', priority: 'high', status: 'high-priority', sortOrder: 0 },
    { id: 'l', title: 'Low', priority: 'low', status: 'planned', sortOrder: 0 },
  ];
  const html = renderBoardHtml(tasks, null);
  assert.match(html, /board-card__dot board-card__dot--hi/);
  assert.match(html, /board-card__dot board-card__dot--lo/);
});

test('board cards render workflow signals from task extras', () => {
  const tasks = [{
    id: 'a',
    title: 'Patch ingress',
    priority: 'medium',
    status: 'in-progress',
    sortOrder: 0,
    notes: 'Check release notes',
  }];
  const html = renderBoardHtml(tasks, 'a', {
    taskBoardExtras: {
      a: {
        docsCount: 2,
        checklistDone: 1,
        checklistTotal: 3,
        latestActivity: 'Status changed to in progress',
      },
    },
  });

  assert.match(html, /checklist 1\/3/);
  assert.match(html, /docs 2/);
  assert.match(html, /notes/);
  assert.match(html, /Status changed to in progress/);
});

test('board flags overdue and due-soon dates relative to today', () => {
  const tasks = [
    { id: 'o', title: 'Overdue', priority: 'high', status: 'planned', sortOrder: 0, dueDate: '2026-05-18' },
    { id: 's', title: 'Soon', priority: 'medium', status: 'planned', sortOrder: 1, dueDate: '2026-05-22' },
    { id: 'f', title: 'Far', priority: 'low', status: 'planned', sortOrder: 2, dueDate: '2026-06-30' },
  ];
  const html = renderBoardHtml(tasks, null, { today: '2026-05-21' });
  // Card shows the compact MM-DD; the full ISO date is kept as a tooltip.
  assert.match(html, /board-card__due--over[^>]*title="2026-05-18"[^>]*>05-18 ⚠/);
  assert.match(html, /board-card__due--soon[^>]*>05-22/);
  assert.match(html, /board-card__due--ok[^>]*>06-30/);
});

test('board shows a project chip only in the all-projects view', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'medium', status: 'planned', sortOrder: 0, projectId: 'p1' }];
  const projects = [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }];

  const withChips = renderBoardHtml(tasks, null, { showProjectChips: true, projects });
  assert.match(withChips, /class="board-card__chip">Homelab</);

  const withoutChips = renderBoardHtml(tasks, null, { showProjectChips: false, projects });
  assert.doesNotMatch(withoutChips, /board-card__chip/);
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

const SWIM_PROJECTS = [
  { id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' },
  { id: 'p2', name: 'Work', slug: 'work', status: 'active' },
  { id: 'p3', name: 'Empty', slug: 'empty', status: 'active' },
];

test('renderSwimlaneBoardHtml renders a lane only for projects with tasks', () => {
  const tasks = [
    { id: 'a', title: 'Patch ingress', priority: 'medium', status: 'in-progress', projectId: 'p1', sortOrder: 0 },
    { id: 'b', title: 'Q2 pack', priority: 'high', status: 'planned', projectId: 'p2', sortOrder: 0, dueDate: '2026-05-19' },
  ];
  const html = renderSwimlaneBoardHtml(tasks, null, { today: '2026-05-21', projects: SWIM_PROJECTS });
  assert.match(html, /data-board-lane="p1"/);
  assert.match(html, /data-board-lane="p2"/);
  assert.doesNotMatch(html, /data-board-lane="p3"/);
  assert.match(html, /board-lane__name">Homelab</);
  assert.match(html, /data-action="toggle-board-lane"[^>]*data-project-id="p1"/);
  assert.match(html, /board-card__due--over/);
  assert.match(html, /class="board-panel"/);
  assert.doesNotMatch(html, /board-card__chip/);
});

test('renderSwimlaneBoardHtml shows lane health signals', () => {
  const tasks = [
    { id: 'a', title: 'Patch ingress', priority: 'medium', status: 'in-progress', projectId: 'p1', sortOrder: 0 },
    { id: 'b', title: 'Back up CNPG', priority: 'high', status: 'planned', projectId: 'p1', sortOrder: 1, dueDate: '2026-05-18' },
    { id: 'c', title: 'Done', priority: 'low', status: 'completed', projectId: 'p1', sortOrder: 2 },
  ];
  const html = renderSwimlaneBoardHtml(tasks, null, { today: '2026-05-21', projects: SWIM_PROJECTS });

  assert.match(html, /2 active/);
  assert.match(html, /1 overdue/);
  assert.match(html, /1 in progress/);
});

test('renderSwimlaneBoardHtml hides columns for a collapsed lane', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'low', status: 'planned', projectId: 'p1', sortOrder: 0 }];
  const html = renderSwimlaneBoardHtml(tasks, null, {
    today: '2026-05-21', projects: SWIM_PROJECTS, boardLaneCollapsed: { p1: true },
  });
  assert.match(html, /data-board-lane="p1"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /class="board-panel"/);
});

test('renderSwimlaneBoardHtml groups tasks with no known project into a single "No project" lane', () => {
  const tasks = [
    { id: 'o1', title: 'Orphan one', priority: 'low', status: 'planned', projectId: 'gone', sortOrder: 0 },
    { id: 'o2', title: 'Orphan two', priority: 'low', status: 'planned', projectId: null, sortOrder: 1 },
  ];
  const html = renderSwimlaneBoardHtml(tasks, null, { today: '2026-05-21', projects: SWIM_PROJECTS });
  assert.match(html, /data-board-lane="__none__"/);
  assert.match(html, /board-lane__name">No project</);
  // only one orphan lane even though there are two orphan tasks
  assert.equal((html.match(/data-board-lane="__none__"/g) || []).length, 1);
});

test('renderSwimlaneBoardHtml shows a placeholder when there are no tasks', () => {
  const html = renderSwimlaneBoardHtml([], null, { today: '2026-05-21', projects: SWIM_PROJECTS });
  assert.match(html, /board-swimlanes/);
  assert.match(html, /\[ no tasks \]/);
  assert.doesNotMatch(html, /data-board-lane/);
});

test('renderBoardToolbar marks the active grouping', () => {
  const html = renderBoardToolbar('swimlanes');
  assert.match(html, /data-action="set-board-grouping"[^>]*data-grouping="flat"/);
  assert.match(html, /data-grouping="swimlanes"[^>]*aria-pressed="true"/);
});

test('renderBoardFilters renders active board filter chips', () => {
  const html = renderBoardFilters(['overdue', 'has-docs']);

  assert.match(html, /data-action="toggle-board-filter"[^>]*data-filter="overdue"[^>]*aria-pressed="true"/);
  assert.match(html, /data-action="toggle-board-filter"[^>]*data-filter="high"[^>]*aria-pressed="false"/);
  assert.match(html, /has docs/);
});

test('applyBoardFilters filters by task and task-extra signals', () => {
  const tasks = [
    { id: 'overdue', title: 'Overdue', priority: 'medium', status: 'planned', dueDate: '2026-05-18' },
    { id: 'docs', title: 'With docs', priority: 'medium', status: 'planned', dueDate: '2026-06-01' },
    { id: 'high', title: 'High', priority: 'high', status: 'planned', dueDate: '2026-06-01' },
    { id: 'complete', title: 'Done', priority: 'high', status: 'completed', dueDate: '2026-05-18' },
  ];
  const extras = {
    docs: { docsCount: 2, checklistTotal: 1 },
    high: { docsCount: 0, checklistTotal: 0 },
  };

  assert.deepEqual(applyBoardFilters(tasks, ['overdue'], extras, '2026-05-21').map(t => t.id), ['overdue']);
  assert.deepEqual(applyBoardFilters(tasks, ['has-docs'], extras, '2026-05-21').map(t => t.id), ['docs']);
  assert.deepEqual(applyBoardFilters(tasks, ['high', 'no-checklist'], extras, '2026-05-21').map(t => t.id), ['high']);
});

test('renderBoardHtml does not embed a stacked selected-card inspector', () => {
  const tasks = [{ id: 't1', title: 'Patch ingress', status: 'in-progress', priority: 'medium', projectId: 'p1' }];
  const html = renderBoardHtml(tasks, 't1', { today: '2026-05-28', boardOpenSections: {}, projects: [], taskBoardExtras: {} });
  assert.doesNotMatch(html, /board-inspector/i);
  assert.match(html, /board-column/i);
});
