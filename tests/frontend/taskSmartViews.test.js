import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartView, sanitizeSmartViews, smartViewsFromJson } from '../../public/js/taskSmartViews.js';

test('createSmartView slugs the label and keeps the expression', () => {
  assert.deepEqual(createSmartView('Waiting on vendor', '@waiting'), {
    id: 'waiting-on-vendor', label: 'Waiting on vendor', expr: '@waiting',
  });
});

test('createSmartView rejects empties and invalid expressions', () => {
  assert.equal(createSmartView('', '@waiting'), null);
  assert.equal(createSmartView('X', ''), null);
  assert.equal(createSmartView('Bad', '(p1'), null); // must parse strictly
});

test('sanitizeSmartViews drops invalid entries and dedupes by id', () => {
  const views = sanitizeSmartViews([
    { label: 'P1 overdue', expr: 'p1 & overdue' },
    { label: 'P1 overdue', expr: 'p1' },   // same slug id → deduped (first wins)
    { label: 'Broken', expr: '(' },        // invalid expr → dropped
    { nope: true },
  ]);
  assert.deepEqual(views.map(v => v.id), ['p1-overdue']);
  assert.equal(views[0].expr, 'p1 & overdue');
});

test('smartViewsFromJson degrades to [] on bad JSON', () => {
  assert.deepEqual(smartViewsFromJson('{bad'), []);
  assert.deepEqual(smartViewsFromJson(null), []);
  assert.equal(smartViewsFromJson('[{"label":"Due today","expr":"due:today"}]')[0].id, 'due-today');
});

test('Folder/Name at creation files the view; stored slashed labels are never reinterpreted', () => {
  const foldered = createSmartView('Daily/standup', 'open');
  assert.equal(foldered.folder, 'Daily');
  assert.equal(foldered.label, 'standup');
  assert.equal(foldered.id, 'daily-standup');
  const plain = createSmartView('standup', 'open');
  assert.equal(plain.folder, undefined);
  // A leading slash is not a folder; an empty name after the slash is invalid.
  assert.equal(createSmartView('/oops', 'open').label, '/oops');
  assert.equal(createSmartView('Daily/', 'open'), null);
  // Sanitize preserves stored folders and passes old slashed LABELS verbatim.
  const stored = sanitizeSmartViews([
    { id: 'daily-standup', label: 'standup', expr: 'open', folder: 'Daily' },
    { id: 'legacy', label: 'a/b legacy', expr: 'open' },
  ]);
  assert.equal(stored[0].folder, 'Daily');
  assert.equal(stored[1].label, 'a/b legacy');
  assert.equal(stored[1].folder, undefined);
});

// QINV-01 / QINV-11: saving a view must never silently replace a different one.
test('smart view ids never collide: non-Latin, case and punctuation variants each keep their own view', () => {
  let views = [];
  const save = (name, expr = 'open') => {
    const view = createSmartView(name, expr, views);
    views = [...views.filter((v) => v.id !== view.id), view];
    return view;
  };
  const japanese = save('今日のタスク');
  const russian = save('Срочно');
  assert.notEqual(japanese.id, 'view', 'a non-Latin name keeps its own letters');
  assert.notEqual(japanese.id, russian.id);
  const a = save('P1 overdue');
  const b = save('p1-overdue');
  const c = save('P1: overdue!');
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  assert.equal(views.length, 5, 'every save kept every earlier view');
  assert.ok(createSmartView('Builtin stale', 'open', views).id !== 'builtin-stale', 'a built-in id is never taken');
});

test('saving the exact same name (and folder) updates that view in place', () => {
  const first = createSmartView('Daily/standup', 'open', []);
  const again = createSmartView('Daily/standup', 'p1', [first]);
  assert.equal(again.id, first.id);
  assert.equal(again.expr, 'p1');
  const otherFolder = createSmartView('Weekly/standup', 'open', [first]);
  assert.notEqual(otherFolder.id, first.id, 'the same name in another folder is a different view');
});
