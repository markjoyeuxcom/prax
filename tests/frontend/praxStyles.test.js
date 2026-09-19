import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Structural invariants of the Prax stylesheet — the CSS-facing contracts the
// JS relies on (theme hook, tokens, CodeMirror aliases, reading scale, the
// 940px rail breakpoint, and reduced-motion support).
const css = await readFile(new URL('../../public/prax.css', import.meta.url), 'utf8');

test('both themes are first-class: root tokens plus a data-theme dark override', () => {
  assert.match(css, /:root\s*\{[^}]*--accent:/s);
  assert.match(css, /body\[data-theme="dark"\]\s*\{[^}]*--accent:/s);
  // core tokens exist in the light block
  for (const token of ['--bg', '--surface', '--card', '--ink', '--line', '--hi', '--med', '--lo']) {
    assert.match(css, new RegExp(`:root\\s*\\{[^}]*${token}:`, 's'), `${token} missing from :root`);
  }
});

test('the CodeMirror bundle aliases resolve to Prax tokens', () => {
  for (const alias of ['--caret', '--bg-deep', '--border', '--text-body', '--text-dimmer', '--accent-amber', '--accent-cyan']) {
    assert.match(css, new RegExp(`${alias}:\\s*var\\(`), `${alias} alias missing`);
  }
});

test('reading scale drives editor and prose sizing', () => {
  assert.match(css, /--reading-scale:\s*1/);
  assert.match(css, /\.editor-ta\s*\{[^}]*calc\(15px \* var\(--reading-scale\)\)/s);
  assert.match(css, /\.prose\s*\{[^}]*calc\(15px \* var\(--reading-scale\)\)/s);
});

test('the page sheet is a centered 740px card', () => {
  assert.match(css, /\.sheet\s*\{[^}]*max-width:\s*740px/s);
});

test('focus-visible outlines exist for keyboard users', () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s);
});

test('the 940px breakpoint reshapes the window and drawer', () => {
  assert.match(css, /@media \(max-width: 940px\)/);
});

test('reduced motion is respected', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('drawer geometry uses the inset/width custom properties', () => {
  assert.match(css, /\.drawer\s*\{[^}]*var\(--drawer-inset, 34px\)/s);
  assert.match(css, /width:\s*var\(--drawer-w, 410px\)/);
});

test('desktop shell mode removes the desk inset and window frame', () => {
  assert.match(css, /body\.is-desktop \.desk\s*\{[^}]*padding:\s*0/s);
  assert.match(css, /body\.is-desktop \.window\s*\{[^}]*border-radius:\s*0/s);
});

test('macOS overlay titlebar insets content to clear the traffic lights', () => {
  assert.match(css, /body\.is-desktop-mac \.titlebar\s*\{[^}]*padding-left:\s*84px/s);
});

test('provider grid lays cards out responsively', () => {
  assert.match(css, /\.provider-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(170px, 1fr\)\)/s);
});

test('the project title owns the header row and the ops row wraps beneath it', () => {
  assert.match(css, /\.page-head__title\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.page-head__title\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(css, /\.proj-ops\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.doesNotMatch(css, /\.proj-ops\s*\{[^}]*margin-left:\s*auto/s, 'the ops row no longer competes with the title');
  assert.match(css, /\.proj-ops__add\s*\{/);
  assert.match(css, /\.page-head__ops-toggle\s*\{/);
});

test('panel section labels are structural (stronger ink, more air); the split-button styles are gone', () => {
  assert.match(css, /\.side-section\s*\{[^}]*color:\s*var\(--ink2\)/s);
  assert.match(css, /\.side-section\s*\{[^}]*padding:\s*20px 8px 6px/s);
  assert.doesNotMatch(css, /btn-primary--split|btn-primary--chev/);
  assert.match(css, /\.btn-primary__chevron\s*\{/);
});
