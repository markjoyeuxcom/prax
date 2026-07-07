import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaletteGroups, renderPaletteHtml } from '../../public/js/renderPalette.js';

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

test('with no query: only the Commands group, all eight commands, in order', () => {
  const { groups, flat } = build('');
  assert.deepEqual(groups.map(g => g.label), ['Commands']);
  assert.deepEqual(flat.map(i => i.action), [
    'new-task', 'new-document', 'toggle-theme', 'go-board',
    'go-library', 'go-all', 'focus-writing', 'go-settings',
  ]);
  assert.equal(flat.find(i => i.action === 'toggle-theme').sub, '⌘J');
});

test('commands filter by case-insensitive substring on title', () => {
  const { groups } = build('DARK');
  const commands = groups.find(g => g.label === 'Commands');
  assert.deepEqual(commands.items.map(i => i.title), ['Toggle dark mode']);
});

test('a query adds Tasks and Documents groups, in Commands → Tasks → Documents flat order', () => {
  const { groups, flat } = build('upgrade');
  assert.deepEqual(groups.map(g => g.label), ['Tasks', 'Documents']); // no command matches "upgrade"
  const both = build('e'); // matches commands, tasks and docs
  assert.deepEqual(both.groups.map(g => g.label), ['Commands', 'Tasks', 'Documents']);
  const labels = [];
  both.groups.forEach(g => g.items.forEach(() => labels.push(g.label)));
  assert.deepEqual(both.flat.length, labels.length);
  assert.ok(labels.indexOf('Tasks') > labels.lastIndexOf('Commands'));
  assert.ok(labels.indexOf('Documents') > labels.lastIndexOf('Tasks'));
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

test('task and document groups cap at five items', () => {
  const many = {
    tasks: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, projectId: 'p1', title: `match ${i}`, archivedAt: null })),
    documents: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, title: `match ${i}`, tags: [], documentType: 'note' })),
    projects: PROJECTS,
  };
  const { groups } = buildPaletteGroups({ paletteQuery: 'match' }, many);
  assert.equal(groups.find(g => g.label === 'Tasks').items.length, 5);
  assert.equal(groups.find(g => g.label === 'Documents').items.length, 5);
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
