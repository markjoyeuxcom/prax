import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTag } from '../../server/libraryRoutes.js';

// Tags are normalised at the API boundary so the app, the CLI, the MCP server
// and every agent write one spelling (Console redesign, 2026-10).
test('tags normalise to lowercase, no leading #, hyphenated whitespace', () => {
  assert.equal(normalizeTag('Backup'), 'backup');
  assert.equal(normalizeTag('  #Postgres '), 'postgres');
  assert.equal(normalizeTag('##k8s'), 'k8s');
  assert.equal(normalizeTag('Disaster   Recovery'), 'disaster-recovery');
  assert.equal(normalizeTag('a - - b'), 'a-b');
  // Spelling choices stay human: no plural or alias folding at write time.
  assert.equal(normalizeTag('backups'), 'backups');
  assert.equal(normalizeTag('postgres'), 'postgres');
});
