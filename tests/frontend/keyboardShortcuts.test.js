import test from 'node:test';
import assert from 'node:assert/strict';
import { isInteractiveShortcutTarget, matchShortcut } from '../../public/js/keyboardShortcuts.js';

// The Prax keymap (docs/desktop/design-handoff.md §Interactions): ⌘K palette,
// ⌘J theme, N capture, E done, ↑↓/↵ list navigation, Esc cascade, '/' palette,
// plus the legacy g-chord view navigation.

test('cmd/ctrl+K opens the palette, ⌘I the assistant, and cmd/ctrl+J toggles the theme', () => {
  assert.equal(matchShortcut({ key: 'k', metaOrCtrl: true }).action, 'palette');
  assert.equal(matchShortcut({ key: 'K', metaOrCtrl: true }).action, 'palette');
  assert.equal(matchShortcut({ key: 'i', metaOrCtrl: true }).action, 'assistant');
  assert.equal(matchShortcut({ key: 'I', metaOrCtrl: true }).action, 'assistant');
  assert.equal(matchShortcut({ key: 'j', metaOrCtrl: true }).action, 'theme');
  assert.equal(matchShortcut({ key: '/', metaOrCtrl: true }).action, 'shortcuts');
});

test('other modified keys never trigger shortcuts', () => {
  assert.equal(matchShortcut({ key: 'n', metaOrCtrl: true }).action, null);
  assert.equal(matchShortcut({ key: 'e', alt: true }).action, null);
  assert.equal(matchShortcut({ key: 'k', alt: true }).action, null);
});

test('plain keys map to the design actions', () => {
  assert.equal(matchShortcut({ key: 'n' }).action, 'capture');
  assert.equal(matchShortcut({ key: 'e' }).action, 'toggle-done');
  assert.equal(matchShortcut({ key: '/' }).action, 'search');
  assert.equal(matchShortcut({ key: 'Escape' }).action, 'escape');
  assert.equal(matchShortcut({ key: 'ArrowDown' }).action, 'nav-down');
  assert.equal(matchShortcut({ key: 'ArrowUp' }).action, 'nav-up');
  assert.equal(matchShortcut({ key: 'Enter' }).action, 'open-selected');
  assert.equal(matchShortcut({ key: 'x' }).action, null);
});

test('g chord navigates views and clears its pending state', () => {
  const first = matchShortcut({ key: 'g' });
  assert.equal(first.pending, 'g');
  assert.equal(first.action, null);

  assert.deepEqual(matchShortcut({ key: 't' }, 'g'), { action: null, view: 'list', pending: '' });
  assert.equal(matchShortcut({ key: 'b' }, 'g').view, 'board');
  assert.equal(matchShortcut({ key: 'k' }, 'g').view, 'backlog');
  assert.equal(matchShortcut({ key: 'a' }, 'g').view, 'archive');
  assert.equal(matchShortcut({ key: 'l' }, 'g').view, 'library');
  assert.deepEqual(matchShortcut({ key: 'z' }, 'g'), { action: null, view: null, pending: '' });
});

test('focused interactive controls retain native unmodified key behavior', () => {
  assert.equal(isInteractiveShortcutTarget({ tagName: 'BUTTON' }), true);
  assert.equal(isInteractiveShortcutTarget({ tagName: 'A', hasAttribute: (name) => name === 'href' }), true);
  assert.equal(isInteractiveShortcutTarget({ tagName: 'DIV', closest: (selector) => (selector.includes('[role="button"]') ? {} : null) }), true);
  assert.equal(isInteractiveShortcutTarget({ tagName: 'DIV', closest: () => null }), false);
});
