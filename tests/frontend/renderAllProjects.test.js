import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectGroups, renderAllProjectsHtml, areasOf } from '../../public/js/renderAllProjects.js';

const PROJECTS = [
  { id: 'p1', name: 'Homelab', status: 'active', updatedAt: '2026-07-01T10:00:00.000Z' },
  { id: 'p2', name: 'Work', status: 'on-hold', updatedAt: '2026-06-20T08:00:00.000Z' },
  { id: 'p3', name: 'Old Sandbox', status: 'archived' },
];

const TASKS = [
  { id: 't1', projectId: 'p1', status: 'planned', archivedAt: null },
  { id: 't2', projectId: 'p1', status: 'in-progress', archivedAt: null },
  { id: 't3', projectId: 'p1', status: 'completed', archivedAt: null },
  { id: 't4', projectId: 'p1', status: 'completed', archivedAt: '2026-06-01T00:00:00.000Z' }, // archived → excluded
  { id: 't5', projectId: 'p2', status: 'notes', archivedAt: null },
  { id: 't6', projectId: 'other', status: 'planned', archivedAt: null },
];

// ---- buildProjectGroups -----------------------------------------------------

test('groups projects in Active / On hold / Completed / Archived order, dropping empty groups', () => {
  const groups = buildProjectGroups(PROJECTS, TASKS);
  assert.deepEqual(groups.map(g => g.label), ['Active', 'On hold', 'Archived']); // no completed projects
  assert.deepEqual(groups.map(g => g.state), ['active', 'on-hold', 'archived']);
});

test('derives open/done counts and pct, excluding archived tasks entirely', () => {
  const groups = buildProjectGroups(PROJECTS, TASKS);
  const homelab = groups[0].projects[0];
  assert.equal(homelab.open, 2);       // planned + in-progress; archived completed task excluded
  assert.equal(homelab.done, 1);       // one live completed
  assert.equal(homelab.pct, 33);       // round(1/3 * 100)
  const work = groups[1].projects[0];
  assert.equal(work.open, 1);          // backlog ('notes') counts as open
  assert.equal(work.done, 0);
  assert.equal(work.pct, 0);
});

test('pct is 0 (not NaN) for a project with no tasks', () => {
  const groups = buildProjectGroups(PROJECTS, TASKS);
  const sandbox = groups.find(g => g.state === 'archived').projects[0];
  assert.equal(sandbox.open, 0);
  assert.equal(sandbox.done, 0);
  assert.equal(sandbox.pct, 0);
});

test('updated label is the YYYY-MM-DD slice of updatedAt, or empty when missing', () => {
  const groups = buildProjectGroups(PROJECTS, TASKS);
  assert.equal(groups[0].projects[0].updated, '2026-07-01');
  assert.equal(groups.find(g => g.state === 'archived').projects[0].updated, '');
});

test('an unrecognised project status falls back into the Active group', () => {
  const groups = buildProjectGroups([{ id: 'px', name: 'Legacy', status: 'legacy-value' }], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].state, 'active');
  assert.equal(groups[0].projects[0].project.id, 'px');
});

// ---- renderAllProjectsHtml ----------------------------------------------------

function render(projects = PROJECTS, tasks = TASKS) {
  return renderAllProjectsHtml({}, buildProjectGroups(projects, tasks), () => '#3aa17e');
}

test('renders the page head, subtitle, group labels and project cards', () => {
  const html = render();
  assert.match(html, /class="page-head__title">All projects</);
  assert.match(html, /class="page-head__sub"/);
  assert.match(html, /class="group-label">Active</);
  assert.match(html, /class="group-label">On hold</);
  assert.match(html, /class="proj-grid"/);
  assert.match(html, /data-action="open-project" data-project-id="p1"/);
  assert.match(html, /class="proj-card__name">Homelab</);
});

test('renders the state chip, progress bar width and meta counts', () => {
  const html = render();
  assert.match(html, /class="chip chip--state-active">Active</);
  assert.match(html, /class="chip chip--state-on-hold">On hold</);
  assert.match(html, /class="proj-card__bar"><span style="width:33%; --dot:#3aa17e"><\/span>/);
  assert.match(html, /2 open · 1 done/);
  assert.match(html, /2026-07-01/);
});

test('state-change chip buttons cover every state except the current one', () => {
  const html = render([PROJECTS[0]], []);
  assert.match(html, /data-action="set-project-state" data-project-id="p1" data-state="on-hold">Hold</);
  assert.match(html, /data-action="set-project-state" data-project-id="p1" data-state="completed">Done</);
  assert.match(html, /data-action="set-project-state" data-project-id="p1" data-state="archived">Archive</);
  assert.doesNotMatch(html, /data-action="set-project-state" data-project-id="p1" data-state="active"/);
});

test('archived projects can be restored via a state-change chip (ported archive-restore intent)', () => {
  const html = render([PROJECTS[2]], []);
  assert.match(html, /data-action="set-project-state" data-project-id="p3" data-state="active">Active</);
  assert.doesNotMatch(html, /data-state="archived"/);
});

test('every card renders a Delete chip last in the actions row', () => {
  const html = render([PROJECTS[0]], TASKS);
  assert.match(html, /data-action="delete-project" data-project-id="p1">Delete</);
  const actions = html.slice(html.indexOf('proj-card__actions'));
  assert.ok(actions.lastIndexOf('data-action="set-project-state"') < actions.indexOf('data-action="delete-project"'));
});

test('renders the create row (name input + primary button)', () => {
  const html = render([], []);
  assert.match(html, /class="text-input"[^>]*data-new-project-name/);
  assert.match(html, /class="btn-primary"[^>]*data-action="create-project"[^>]*>＋ New project</);
});

test('archived group cards are dimmed', () => {
  const html = render();
  assert.match(html, /class="proj-card is-dim" data-action="open-project" data-project-id="p3"/);
  assert.doesNotMatch(html, /class="proj-card is-dim" data-action="open-project" data-project-id="p1"/);
});

test('renders an overall empty state when there are no projects', () => {
  const html = render([], []);
  assert.match(html, /class="empty"/);
  assert.match(html, /No projects yet/);
  assert.doesNotMatch(html, /proj-grid/);
});

test('escapes project names', () => {
  const html = render([{ id: 'p1', name: '<script>alert("x")</script>', status: 'active' }], []);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});

test('the Memory system project shows a System chip instead of state chips and Delete', () => {
  const projects = [{ id: 'mem', name: 'Memory', slug: 'memory', status: 'active' }, PROJECTS[0]];
  const html = renderAllProjectsHtml({}, buildProjectGroups(projects, []));
  const memoryCard = html.slice(html.indexOf('data-project-id="mem"'), html.indexOf('data-project-id="p1"'));
  assert.match(memoryCard, /chip--system/);
  assert.doesNotMatch(memoryCard, /data-action="delete-project"/);
  assert.doesNotMatch(memoryCard, /data-action="set-project-state"/);
  assert.match(html, /data-action="delete-project" data-project-id="p1"/, 'ordinary projects keep Delete');
});

// ---- areas within a state group (spec item 15) --------------------------------

test('areasOf partitions entries by area alphabetically with Other last, or one unlabelled run when no area exists', () => {
  const entry = (id, area) => ({ project: { id, name: id, area } });
  assert.deepEqual(areasOf([entry('a', 'Work'), entry('b', null), entry('c', 'Labs'), entry('d', 'Work'), entry('e', '  ')]).map((area) => [area.label, area.projects.map((e) => e.project.id)]),
    [['Labs', ['c']], ['Work', ['a', 'd']], ['Other', ['b', 'e']]]);
  assert.deepEqual(areasOf([entry('a'), entry('b')]).map((area) => [area.label, area.projects.length]), [[null, 2]]);
  assert.deepEqual(areasOf([]), [{ label: null, projects: [] }]);
});

test('buildProjectGroups carries areas, and the page renders area headings only where areas exist', () => {
  const projects = [
    { id: 'p1', name: 'Homelab', status: 'active', area: 'Labs' },
    { id: 'p2', name: 'Platform', status: 'active', area: 'Work' },
    { id: 'p3', name: 'Loose', status: 'active' },
    { id: 'p4', name: 'Paused', status: 'on-hold' },
  ];
  const groups = buildProjectGroups(projects, []);
  assert.deepEqual(groups[0].areas.map((area) => area.label), ['Labs', 'Work', 'Other']);
  assert.deepEqual(groups[1].areas.map((area) => area.label), [null]);
  const html = renderAllProjectsHtml({}, groups, () => '#abc');
  assert.match(html, /<h3 class="all-projects__area">Labs <span class="all-projects__area-count">1<\/span><\/h3>/);
  assert.match(html, /all-projects__area">Other /);
  assert.equal((html.match(/all-projects__area"/g) || []).length, 3, 'the on-hold group has no area heading');
  assert.equal((html.match(/class="proj-grid"/g) || []).length, 4);
  const plain = renderAllProjectsHtml({}, buildProjectGroups(PROJECTS, TASKS), () => '#abc');
  assert.doesNotMatch(plain, /all-projects__area/, 'no areas anywhere, no headings');
});
