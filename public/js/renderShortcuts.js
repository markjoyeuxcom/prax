// Keyboard shortcuts overlay — pure `state → HTML string` (year-one shell
// spec, item 5). The statusbar used to spend its whole width on a fixed set
// of hints; those hints now live here, behind ⌘/ and the statusbar's
// "shortcuts" button, and the list is the real keymap from
// keyboardShortcuts.js rather than a subset.

import { escapeHtml } from './html.js';

export const SHORTCUT_GROUPS = Object.freeze([
  {
    title: 'Everywhere',
    rows: [
      [['⌘K'], 'Search or jump to'],
      [['/'], 'Search: the Library bar there, the palette elsewhere (outside a field)'],
      [['⌘I'], 'Assistant'],
      [['⌘J'], 'Toggle theme'],
      [['⌘/'], 'This list'],
      [['N'], 'New task'],
      [['Esc'], 'Close the topmost panel, then clear the selection'],
    ],
  },
  {
    title: 'Lists and boards',
    rows: [
      [['↑', '↓'], 'Move the selection'],
      [['↵'], 'Open the selected task'],
      [['E'], 'Mark the selected task done'],
    ],
  },
  {
    title: 'Go to',
    rows: [
      [['G', 'T'], 'List'],
      [['G', 'B'], 'Board'],
      [['G', 'K'], 'Backlog'],
      [['G', 'A'], 'Archive'],
      [['G', 'L'], 'Library'],
    ],
  },
  {
    title: 'Quick capture',
    rows: [
      [['#project'], 'File under a project'],
      [['@label'], 'Add a label'],
      [['!high'], 'Set the priority'],
      [['tomorrow'], 'A date word sets the due date'],
      [['⌘↵'], 'Smart add: let the model parse the line'],
    ],
  },
]);

export function renderShortcutsHtml(state = {}) {
  const groups = SHORTCUT_GROUPS.map((group) => {
    const rows = [...group.rows];
    if (group.title === 'Quick capture' && state.desktopShell) {
      rows.unshift([[state.captureShortcut?.shortcut || '⌘⇧Space'], 'Capture from any app']);
    }
    return `<section class="shortcuts__group"><h3 class="shortcuts__title">${escapeHtml(group.title)}</h3>`
      + rows.map(([keys, label]) => (
        `<div class="shortcuts__row"><span class="shortcuts__label">${escapeHtml(label)}</span>`
        + `<span class="shortcuts__keys">${keys.map((key) => `<span class="kbd">${escapeHtml(key)}</span>`).join('')}</span></div>`
      )).join('')
      + '</section>';
  }).join('');
  return `
    <div class="overlay-center" data-overlay="shortcuts" data-action="close-shortcuts">
      <div class="shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div class="shortcuts__head">
          <h2 class="shortcuts__heading">Keyboard shortcuts</h2>
          <button type="button" class="btn-ghost" data-action="close-shortcuts" aria-label="Close">Esc</button>
        </div>
        <div class="shortcuts__grid">${groups}</div>
      </div>
    </div>`;
}
