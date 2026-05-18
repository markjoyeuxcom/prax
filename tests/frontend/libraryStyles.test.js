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
