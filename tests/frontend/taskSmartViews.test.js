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
