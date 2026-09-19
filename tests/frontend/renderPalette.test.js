import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaletteGroups, renderPaletteHtml, PALETTE_SCOPES, MAX_SCOPED_ITEMS, cyclePaletteScope, normalizePaletteScope } from '../../public/js/renderPalette.js';

const PROJECTS = [{ id: 'p1', name: 'Homelab' }];
const TASKS = [
  { id: 't1', projectId: 'p1', title: 'Upgrade Postgres', archivedAt: null },
  { id: 't2', projectId: 'p1', title: 'Upgrade firmware', archivedAt: '2026-06-01T00:00:00.000Z' },
];
const DOCS = [
  { id: 'd1', title: 'Upgrade runbook', tags: ['ops'], documentType: 'runbook' },
  { id: 'd2', title: 'Notes', tags: ['upgrade'], documentType: 'note' },
];

const DATA = { tasks: TASKS, documents: DOCS, projects: PROJECTS };

function build(paletteQuery, extra = {}) {
  return buildPaletteGroups({ paletteQuery, paletteSelection: 0, ...extra }, DATA);
}

// ---- buildPaletteGroups -----------------------------------------------------

test('with no query: only the Commands group, every command, in order', () => {
  const { groups, flat } = build('');
  assert.deepEqual(groups.map(g => g.label), ['Commands']);
  assert.deepEqual(flat.map(i => i.action), [
    'new-task', 'new-document', 'toggle-theme', 'go-board',
    'go-library', 'go-all', 'focus-writing', 'go-settings',
    'go-ask-prax', 'go-review-queue', 'go-health', 'go-weekly-review', 'go-import', 'go-export', 'go-shortcuts',
  ]);
  assert.equal(flat.find(i => i.action === 'go-shortcuts').sub, '⌘/');
  assert.equal(flat.find(i => i.action === 'toggle-theme').sub, '⌘J');
});

test('commands filter by case-insensitive substring on title', () => {
  const { groups } = build('DARK');
  const commands = groups.find(g => g.label === 'Commands');
  assert.deepEqual(commands.items.map(i => i.title), ['Toggle dark mode']);
});

test('a query adds search groups in Commands → Projects → Views → Tasks → Documents order', () => {
  const { groups } = build('upgrade');
  assert.deepEqual(groups.map(g => g.label), ['Tasks', 'Documents']); // no command/project/view matches "upgrade"
  // "e" matches commands, the built-in Stale view, tasks, and docs.
  const both = build('e');
  assert.deepEqual(both.groups.map(g => g.label), ['Commands', 'Views', 'Tasks', 'Documents']);
  const labels = [];
  both.groups.forEach(g => g.items.forEach(() => labels.push(g.label)));
  assert.deepEqual(both.flat.length, labels.length);
  assert.ok(labels.indexOf('Views') > labels.lastIndexOf('Commands'));
  assert.ok(labels.indexOf('Tasks') > labels.lastIndexOf('Views'));
  assert.ok(labels.indexOf('Documents') > labels.lastIndexOf('Tasks'));
});

test('projects jump: active/on-hold/inbox match by name; other statuses never appear', () => {
  const projects = [
    { id: 'p1', name: 'Homelab', status: 'active' },
    { id: 'p2', name: 'Home Move', status: 'on-hold' },
    { id: 'p3', name: 'Home Archive', status: 'completed' },
    { id: 'ibx', name: 'Inbox', slug: 'inbox' },
  ];
  const { groups } = buildPaletteGroups({ paletteQuery: 'home' }, { ...DATA, projects });
  const group = groups.find(g => g.label === 'Projects');
  assert.deepEqual(group.items.map(i => i.id), ['p1', 'p2']);
  assert.deepEqual(group.items.map(i => i.action), ['go-project', 'go-project']);
  assert.equal(group.items[1].sub, 'Project · on hold');
  const inbox = buildPaletteGroups({ paletteQuery: 'inbox' }, { ...DATA, projects });
  assert.equal(inbox.groups.find(g => g.label === 'Projects').items[0].id, 'ibx');
});

test('views jump: smart views (incl. built-in Stale) and index-addressed library views', () => {
  const state = {
    paletteQuery: 'notes',
    taskSmartViews: [{ id: 'sv1', label: 'Notes triage', expr: 'status:notes' }],
    librarySavedViews: [
      { label: 'Deploy docs', tags: ['deploy'] },
      { label: 'Retro notes', tags: ['retro'] },
    ],
  };
  const { groups } = buildPaletteGroups(state, DATA);
  const views = groups.find(g => g.label === 'Views');
  assert.deepEqual(views.items.map(i => i.title), ['Notes triage', 'Retro notes']);
  assert.deepEqual(views.items[0], { title: 'Notes triage', sub: 'Smart view', icon: 'filter', action: 'go-smart-view', id: 'sv1' });
  // "Retro notes" is index 1 in the stored list — the jump must carry the
  // UNFILTERED index or it would open the wrong view.
  assert.deepEqual(views.items[1], { title: 'Retro notes', sub: 'Library view', icon: 'tag', action: 'go-library-view', index: 1 });

  const stale = buildPaletteGroups({ paletteQuery: 'stale' }, DATA);
  assert.equal(stale.groups.find(g => g.label === 'Views').items[0].id, 'builtin-stale');
});

test('archived tasks never appear; task items carry project-name sub, open-task action and id', () => {
  const { groups } = build('upgrade');
  const tasks = groups.find(g => g.label === 'Tasks');
  assert.deepEqual(tasks.items.map(i => i.id), ['t1']);
  assert.equal(tasks.items[0].sub, 'Homelab');
  assert.equal(tasks.items[0].action, 'open-task');
});

test('documents match on title or tags; items carry documentType sub, open-doc action and id', () => {
  const { groups } = build('upgrade');
  const docs = groups.find(g => g.label === 'Documents');
  assert.deepEqual(docs.items.map(i => i.id), ['d1', 'd2']); // d2 matches via tag
  assert.equal(docs.items[0].sub, 'runbook');
  assert.deepEqual(docs.items.map(i => i.action), ['open-doc', 'open-doc']);
});

test('documents also match on body text, not just title/tags', () => {
  const data = {
    tasks: [],
    projects: PROJECTS,
    documents: [
      { id: 'd1', title: 'Runbook', tags: [], documentType: 'runbook', body: '# Runbook\n\nRestart the pgbouncer pod when connections saturate.' },
      { id: 'd2', title: 'Notes', tags: [], documentType: 'note', body: 'nothing relevant here' },
    ],
  };
  const { groups } = buildPaletteGroups({ paletteQuery: 'pgbouncer', paletteSelection: 0 }, data);
  const docs = groups.find(g => g.label === 'Documents');
  assert.deepEqual(docs.items.map(i => i.id), ['d1']); // matched only by body
});

const MANY = {
  tasks: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, projectId: 'p1', title: `match ${i}`, archivedAt: null })),
  documents: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, title: `match ${i}`, tags: [], documentType: 'note' })),
  projects: PROJECTS,
};

test('in the All scope, task and document groups show five items plus a "+N more" row that switches scope', () => {
  const { groups, flat, scope, scopes } = buildPaletteGroups({ paletteQuery: 'match' }, MANY);
  assert.equal(scope, 'all');
  const tasks = groups.find(g => g.label === 'Tasks');
  assert.equal(tasks.items.length, 6);
  assert.deepEqual(tasks.items.slice(0, 5).map(i => i.id), ['t0', 't1', 't2', 't3', 't4']);
  assert.deepEqual(tasks.items[5], { title: '4 more in Tasks', sub: '⇥', icon: 'check', action: 'palette-scope', scope: 'tasks', more: true });
  const docs = groups.find(g => g.label === 'Documents');
  assert.equal(docs.items[5].scope, 'docs');
  assert.equal(flat.length, 12, 'the more rows are selectable like any item');
  assert.deepEqual(scopes, [
    { key: 'all', label: 'All', count: 18 }, { key: 'commands', label: 'Commands', count: 0 },
    { key: 'projects', label: 'Projects', count: 0 }, { key: 'views', label: 'Views', count: 0 },
    { key: 'tasks', label: 'Tasks', count: 9 }, { key: 'docs', label: 'Docs', count: 9 },
  ]);
});

test('a single scope lists that group alone and much deeper, and browses without a query', () => {
  const { groups, flat } = buildPaletteGroups({ paletteQuery: 'match', paletteScope: 'tasks' }, MANY);
  assert.deepEqual(groups.map(g => g.label), ['Tasks']);
  assert.equal(groups[0].items.length, 9);
  assert.equal(groups[0].truncated, 0);
  assert.ok(flat.every(i => i.action === 'open-task'));

  const browse = buildPaletteGroups({ paletteQuery: '', paletteScope: 'projects' }, { ...DATA, projects: [{ id: 'p1', name: 'Homelab', status: 'active' }, { id: 'p2', name: 'Work', status: 'active' }] });
  assert.deepEqual(browse.groups.map(g => g.label), ['Projects']);
  assert.deepEqual(browse.flat.map(i => i.title), ['Homelab', 'Work']);
  assert.deepEqual(buildPaletteGroups({ paletteQuery: '', paletteScope: 'all' }, DATA).groups.map(g => g.label), ['Commands'], 'All with no query stays a command list');

  const deep = {
    ...MANY,
    tasks: Array.from({ length: MAX_SCOPED_ITEMS + 3 }, (_, i) => ({ id: `t${i}`, projectId: 'p1', title: `match ${i}`, archivedAt: null })),
  };
  const capped = buildPaletteGroups({ paletteQuery: 'match', paletteScope: 'tasks' }, deep);
  assert.equal(capped.groups[0].items.length, MAX_SCOPED_ITEMS);
  assert.equal(capped.groups[0].truncated, 3);
  assert.equal(capped.scopes.find(s => s.key === 'tasks').count, MAX_SCOPED_ITEMS + 3, 'the count stays honest');
});

test('scope helpers: unknown scopes fall back to All; Tab cycles forward and Shift+Tab back, wrapping', () => {
  assert.equal(normalizePaletteScope('bogus'), 'all');
  assert.equal(normalizePaletteScope('docs'), 'docs');
  const keys = PALETTE_SCOPES.map(([key]) => key);
  assert.equal(cyclePaletteScope('all', 1), keys[1]);
  assert.equal(cyclePaletteScope(keys.at(-1), 1), 'all');
  assert.equal(cyclePaletteScope('all', -1), keys.at(-1));
});

// ---- renderPaletteHtml --------------------------------------------------------

test('renders the input row, group labels and indexed run buttons', () => {
  const state = { paletteQuery: 'upgrade', paletteSelection: 0 };
  const html = renderPaletteHtml(state, buildPaletteGroups(state, DATA));
  assert.match(html, /class="overlay-center"[^>]*data-action="close-palette"/);
  assert.match(html, /data-palette-input[^>]*value="upgrade"/);
  assert.match(html, /class="kbd">esc</);
  assert.match(html, /class="palette__group">Tasks</);
  assert.match(html, /class="palette__group">Documents</);
  assert.match(html, /data-action="palette-run" data-palette-index="0"/);
  assert.match(html, /data-palette-index="1"/);
  assert.match(html, /class="palette__item-sub">Homelab</);
  assert.match(html, /class="palette__brand">.*prax/);
  assert.match(html, /class="kbd">↵</);
});

test('marks is-selected on the clamped selection index', () => {
  const state = { paletteQuery: 'upgrade', paletteSelection: 99 }; // 3 items → clamps to 2
  const html = renderPaletteHtml(state, buildPaletteGroups(state, DATA));
  assert.match(html, /class="palette__item is-selected"[^>]*data-palette-index="2"/);
  assert.doesNotMatch(html, /is-selected"[^>]*data-palette-index="0"/);
  assert.match(html, /class="palette__row is-selected"/);

  const negative = { paletteQuery: 'upgrade', paletteSelection: -4 }; // clamps to 0
  const htmlNeg = renderPaletteHtml(negative, buildPaletteGroups(negative, DATA));
  assert.match(htmlNeg, /class="palette__item is-selected"[^>]*data-palette-index="0"/);
});

test('renders the empty state when nothing matches', () => {
  const state = { paletteQuery: 'zzz-no-match', paletteSelection: 0 };
  const html = renderPaletteHtml(state, buildPaletteGroups(state, DATA));
  assert.match(html, /class="palette__empty">No matches\.</);
  assert.doesNotMatch(html, /palette__item /);
});

test('escapes task titles and the query value', () => {
  const state = { paletteQuery: '<script>', paletteSelection: 0 };
  const data = {
    tasks: [{ id: 't9', projectId: 'p1', title: '<script>alert("x")</script>', archivedAt: null }],
    documents: [],
    projects: PROJECTS,
  };
  const html = renderPaletteHtml(state, buildPaletteGroups(state, data));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /value="&lt;script&gt;"/);
});

test('renders the scope bar with counts and the active scope, and the footer hints for done and scope', () => {
  const state = { paletteQuery: 'match', paletteSelection: 0, paletteScope: 'docs' };
  const html = renderPaletteHtml(state, buildPaletteGroups(state, MANY));
  assert.match(html, /class="palette__scopes" role="tablist" aria-label="Search scope"/);
  assert.match(html, /class="palette__scope" data-action="palette-scope" data-scope="all" aria-selected="false">All <span class="palette__scope-count">18</);
  assert.match(html, /class="palette__scope is-active" data-action="palette-scope" data-scope="docs" aria-selected="true">Docs <span class="palette__scope-count">9</);
  assert.match(html, /data-scope="commands" aria-selected="false">Commands</);
  assert.doesNotMatch(html, /data-scope="commands"[^>]*>Commands <span/, 'no count badge at zero');
  assert.match(html, /class="kbd">⌘↵<\/span> done/);
  assert.match(html, /class="kbd">⇥<\/span> scope/);
  assert.doesNotMatch(html, /palette__group">Tasks/, 'a single scope hides the other groups');
});

test('the selected task row carries an inline Done button; other rows and non-task rows do not', () => {
  const state = { paletteQuery: 'match', paletteSelection: 1, paletteScope: 'tasks' };
  const html = renderPaletteHtml(state, buildPaletteGroups(state, MANY));
  assert.match(html, /class="palette__row is-selected">[\s\S]*?data-palette-index="1"[\s\S]*?<\/button><button class="palette__action" type="button" data-action="palette-task-done" data-task-id="t1" title="Mark done \(⌘↵\)">Done<\/button>/);
  assert.equal((html.match(/palette-task-done/g) || []).length, 1);
  assert.match(html, /Done<\/button><button class="palette__action palette__action--ghost" type="button" data-action="palette-task-today" data-task-id="t1"[^>]*>Today</);
  assert.equal((html.match(/palette-task-today/g) || []).length, 1);
  const docs = { paletteQuery: 'match', paletteSelection: 0, paletteScope: 'docs' };
  assert.doesNotMatch(renderPaletteHtml(docs, buildPaletteGroups(docs, MANY)), /palette-task-done/);
});

test('the "+N more" row renders as a more-styled item and a truncated scope says so', () => {
  const state = { paletteQuery: 'match', paletteSelection: 0 };
  const html = renderPaletteHtml(state, buildPaletteGroups(state, MANY));
  assert.match(html, /class="palette__item palette__item--more" type="button" data-action="palette-run" data-palette-index="5">[\s\S]*?4 more in Tasks/);
  const deep = { ...MANY, tasks: Array.from({ length: MAX_SCOPED_ITEMS + 2 }, (_, i) => ({ id: `t${i}`, projectId: 'p1', title: `match ${i}`, archivedAt: null })) };
  const scoped = { paletteQuery: 'match', paletteSelection: 0, paletteScope: 'tasks' };
  assert.match(renderPaletteHtml(scoped, buildPaletteGroups(scoped, deep)), /class="palette__truncated">2 more — keep typing to narrow it down\./);
});
