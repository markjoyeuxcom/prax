import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingMigrations, runMigrations } from '../../server/migrate.js';

const SILENT = { info() {}, error() {} };

function tmpMigrations(files) {
  const dir = mkdtempSync(join(tmpdir(), 'moomora-mig-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

// A fake db whose connect() returns a fake client recording SQL and simulating
// the schema_migrations table. `failSql` makes any query whose text includes it throw.
function makeFakeDb({ failSql = null } = {}) {
  const appliedVersions = [];
  const calls = [];
  const state = { released: false, locked: 0 };
  const client = {
    async query(text, params = []) {
      const head = text.trim().split('\n')[0].trim();
      calls.push({ head, text, params });
      if (/pg_advisory_lock/.test(text)) { state.locked += 1; return { rows: [] }; }
      if (/pg_advisory_unlock/.test(text)) { state.locked -= 1; return { rows: [] }; }
      if (/^select version from schema_migrations/i.test(head)) {
        return { rows: appliedVersions.map(v => ({ version: v })) };
      }
      if (/^insert into schema_migrations/i.test(head)) {
        appliedVersions.push(params[0]);
        return { rows: [] };
      }
      if (failSql && text.includes(failSql)) throw new Error('boom');
      return { rows: [] };
    },
    release() { state.released = true; },
  };
  return { connect: async () => client, _appliedVersions: appliedVersions, _calls: calls, _state: state };
}

test('pendingMigrations sorts by numeric ordinal and excludes applied + non-matching files', () => {
  const files = ['0010_late.sql', '0002_b.sql', '0001_init.sql', 'README.md', 'notes.txt'];
  assert.deepEqual(pendingMigrations(files, []), ['0001_init.sql', '0002_b.sql', '0010_late.sql']);
  assert.deepEqual(pendingMigrations(files, ['0001_init.sql']), ['0002_b.sql', '0010_late.sql']);
  assert.deepEqual(pendingMigrations([], []), []);
});

test('runMigrations applies pending files in order, records each, locks/unlocks/releases', async () => {
  const dir = tmpMigrations({ '0001_init.sql': 'create table a();', '0002_more.sql': 'create table b();' });
  const db = makeFakeDb();
  const result = await runMigrations(db, { dir, logger: SILENT });
  assert.deepEqual(result.applied, ['0001_init.sql', '0002_more.sql']);
  assert.deepEqual(db._appliedVersions, ['0001_init.sql', '0002_more.sql']);
  // begin/commit issued per migration
  assert.equal(db._calls.filter(c => c.head === 'begin').length, 2);
  assert.equal(db._calls.filter(c => c.head === 'commit').length, 2);
  // lock balanced + client released
  assert.equal(db._state.locked, 0);
  assert.equal(db._state.released, true);
});

test('runMigrations is a no-op when everything is already applied', async () => {
  const dir = tmpMigrations({ '0001_init.sql': 'create table a();' });
  const db = makeFakeDb();
  db._appliedVersions.push('0001_init.sql');
  const result = await runMigrations(db, { dir, logger: SILENT });
  assert.deepEqual(result.applied, []);
  assert.equal(db._calls.filter(c => c.head === 'begin').length, 0);
  assert.equal(db._state.released, true);
});

test('runMigrations aborts on a failing migration: rolls back, does not record it or run later ones', async () => {
  const dir = tmpMigrations({
    '0001_init.sql': 'create table a();',
    '0002_boom.sql': 'SELECT boom_marker;',
    '0003_after.sql': 'create table c();',
  });
  const db = makeFakeDb({ failSql: 'boom_marker' });
  await assert.rejects(() => runMigrations(db, { dir, logger: SILENT }), /0002_boom\.sql/);
  assert.deepEqual(db._appliedVersions, ['0001_init.sql']); // 0002 not recorded, 0003 never ran
  assert.equal(db._calls.filter(c => c.head === 'rollback').length, 1);
  assert.equal(db._state.released, true); // released even on failure
});
