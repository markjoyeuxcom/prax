import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSlug } from '../../server/slug.js';

test('lowercases and hyphenates a name', () => {
  assert.equal(deriveSlug('Home Lab Ops'), 'home-lab-ops');
  assert.equal(deriveSlug('  Work!! '), 'work');
});

test('falls back to "project" for empty/symbol-only names', () => {
  assert.equal(deriveSlug('!!!'), 'project');
  assert.equal(deriveSlug(''), 'project');
});

test('appends a numeric suffix to avoid collisions', () => {
  assert.equal(deriveSlug('Work', ['work']), 'work-2');
  assert.equal(deriveSlug('Work', ['work', 'work-2']), 'work-3');
});
