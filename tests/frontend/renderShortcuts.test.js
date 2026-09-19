import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShortcutsHtml, SHORTCUT_GROUPS } from '../../public/js/renderShortcuts.js';
import { matchShortcut } from '../../public/js/keyboardShortcuts.js';

test('the overlay is a modal dialog with a close action on the scrim and a close button', () => {
  const html = renderShortcutsHtml({});
  assert.match(html, /class="overlay-center" data-overlay="shortcuts" data-action="close-shortcuts"/);
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"/);
  assert.match(html, /class="btn-ghost" data-action="close-shortcuts" aria-label="Close"/);
});

test('every group and row of the keymap renders, with each key as a kbd', () => {
  const html = renderShortcutsHtml({});
  for (const group of SHORTCUT_GROUPS) {
    assert.match(html, new RegExp(`<h3 class="shortcuts__title">${group.title}</h3>`));
    for (const [keys, label] of group.rows) {
      assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      for (const key of keys) assert.match(html, new RegExp(`<span class="kbd">${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`));
    }
  }
});

test('the listed keys agree with the keymap: ⌘/ opens this list, ⌘K the palette, E marks done', () => {
  assert.equal(matchShortcut({ key: '/', metaOrCtrl: true }).action, 'shortcuts');
  assert.equal(matchShortcut({ key: 'k', metaOrCtrl: true }).action, 'palette');
  assert.equal(matchShortcut({ key: 'e' }).action, 'toggle-done');
  assert.equal(matchShortcut({ key: 'l' }, 'g').view, 'library');
});

test('the desktop shell adds the global capture chord, using the configured one when known', () => {
  assert.doesNotMatch(renderShortcutsHtml({}), /Capture from any app/);
  const fallback = renderShortcutsHtml({ desktopShell: true });
  assert.match(fallback, /<span class="kbd">⌘⇧Space<\/span>/);
  assert.match(fallback, /Capture from any app/);
  const configured = renderShortcutsHtml({ desktopShell: true, captureShortcut: { shortcut: 'Alt+Space' } });
  assert.match(configured, /<span class="kbd">Alt\+Space<\/span>/);
  assert.doesNotMatch(configured, /⌘⇧Space/);
});
