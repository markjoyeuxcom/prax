import test from 'node:test';
import assert from 'node:assert/strict';
import { matchShortcut } from '../../public/js/keyboardShortcuts.js';

test('plain keys map to actions', () => {
  assert.equal(matchShortcut({ key: '/', hasModifier: false }).action, 'focus-search');
  assert.equal(matchShortcut({ key: 'n', hasModifier: false }).action, 'new');
  assert.equal(matchShortcut({ key: 'e', hasModifier: false }).action, 'edit');
  assert.equal(matchShortcut({ key: 'd', hasModifier: false }).action, 'archive');
  assert.equal(matchShortcut({ key: 'Escape', hasModifier: false }).action, 'escape');
});

test('modifier keys never trigger app shortcuts', () => {
  assert.equal(matchShortcut({ key: 'n', hasModifier: true }).action, null);
});

test('g chord then view letter resolves a view and clears pending', () => {
  const first = matchShortcut({ key: 'g', hasModifier: false }, '');
  assert.equal(first.pending, 'g');
  assert.equal(first.action, null);
  const second = matchShortcut({ key: 't', hasModifier: false }, 'g');
  assert.equal(second.view, 'list');
  assert.equal(second.pending, '');
});

test('g chord with unknown letter yields no view', () => {
  assert.equal(matchShortcut({ key: 'z', hasModifier: false }, 'g').view, null);
});

test('unmapped key yields no action', () => {
  assert.equal(matchShortcut({ key: 'q', hasModifier: false }).action, null);
});
