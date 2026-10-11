import test from 'node:test';
import assert from 'node:assert/strict';
import { installKeyboardShortcuts, isImeComposing, isInteractiveShortcutTarget, matchShortcut } from '../../public/js/keyboardShortcuts.js';

// The Prax keymap: ⌘K palette,
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

function installWithSpies({ modalOpen = () => false } = {}) {
  const previous = globalThis.document;
  let listener = null;
  globalThis.document = { addEventListener: (type, fn) => { if (type === 'keydown') listener = fn; } };
  const calls = [];
  const spy = (name) => (...args) => calls.push([name, ...args]);
  try {
    installKeyboardShortcuts({ handlers: {
      switchView: spy('switchView'), openPalette: spy('openPalette'), toggleTheme: spy('toggleTheme'),
      openCapture: spy('openCapture'), toggleDoneSelected: spy('toggleDoneSelected'), navigate: spy('navigate'),
      openSelected: spy('openSelected'), escape: spy('escape'), modalOpen,
    } });
  } finally {
    globalThis.document = previous;
  }
  const body = { tagName: 'BODY', closest: () => null };
  const press = (key, extra = {}) => listener({ key, target: body, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {}, ...extra });
  return { calls, press };
}

test('IME: Escape and Enter that belong to a composition never reach the app shortcuts', () => {
  assert.equal(isImeComposing({ isComposing: true }), true);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 229 }), true, 'WebKit commit Enter');
  assert.equal(isImeComposing({ isComposing: false, keyCode: 13 }), false);
  const { calls, press } = installWithSpies();
  press('Escape', { isComposing: true });
  press('Enter', { keyCode: 229 });
  press('n', { isComposing: true });
  assert.deepEqual(calls, []);
  press('Escape');
  assert.deepEqual(calls, [['escape']]);
});

test('an open modal owns one-key shortcuts; Escape, ⌘ commands and N (a new layer) still work', () => {
  const { calls, press } = installWithSpies({ modalOpen: () => true });
  press('e'); press('Enter'); press('ArrowDown'); press('/'); press('g'); press('t');
  assert.deepEqual(calls, [], 'nothing acts on the workspace behind the modal');
  press('Escape');
  press('k', { metaKey: true });
  press('n');
  assert.deepEqual(calls, [['escape'], ['openPalette'], ['openCapture']]);
});
