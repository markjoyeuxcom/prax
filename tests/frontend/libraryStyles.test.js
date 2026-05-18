import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('Library browser reserves rows for header smart views tags filters and documents', () => {
  assert.match(styles, /\.library-browser\s*\{[\s\S]*grid-template-rows:\s*auto auto auto auto minmax\(0,\s*1fr\);/);
});

test('Library tag chips top-align inside the tag drawer', () => {
  assert.match(styles, /\.tag-filter-list\s*\{[\s\S]*align-items:\s*flex-start;/);
  assert.match(styles, /\.tag-filter-list\s*\{[\s\S]*align-content:\s*flex-start;/);
});

test('Focused document workspace uses the available writing area', () => {
  assert.match(styles, /\.library-detail\.is-focus-mode\s*\{[\s\S]*max-width:\s*none;/);
  assert.match(styles, /\.document-workspace--focused\.document-workspace--split\s*\{[\s\S]*grid-template-columns:\s*minmax\(520px,\s*1fr\)\s+minmax\(520px,\s*1fr\);/);
  assert.match(styles, /\.document-workspace--focused\s+\.code-editor\s*\{[\s\S]*max-width:\s*none;/);
});

test('CodeMirror editor exposes a high contrast caret and selection', () => {
  assert.match(styles, /\.code-editor\s+\.cm-cursor,\s*[\s\S]*\.code-editor\s+\.cm-dropCursor\s*\{[\s\S]*border-left-color:\s*#f8f2c6\s*!important;/);
  assert.match(styles, /\.code-editor\s+\.cm-selectionBackground,\s*[\s\S]*\.code-editor\s+\.cm-content\s+::selection\s*\{[\s\S]*rgba\(91,\s*183,\s*255,\s*0\.38\)/);
});
