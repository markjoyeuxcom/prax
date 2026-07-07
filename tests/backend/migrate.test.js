import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingMigrations, runMigrations } from '../../server/migrate.js';

const SILENT = { info() {}, error() {} };

function tmpMigrations(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-mig-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

// A fake db whose connect() returns a fake client recording SQL and simulating
// the schema_migrations table. Migration bodies run through db.exec (the raw
// multi-statement handle, matching the SQLite adapter); `failSql` makes any
// exec'd body containing it throw.
function makeFakeDb({ failSql = null } = {}) {
  const appliedVersions = [];
  const calls = [];
  const executed = [];
  const state = { released: false };
  const client = {
    async query(text, params = []) {
      const head = text.trim().split('\n')[0].trim();
      calls.push({ head, text, params });
      if (/^select version from schema_migrations/i.test(head)) {
        return { rows: appliedVersions.map(v => ({ version: v })) };
      }
      if (/^insert into schema_migrations/i.test(head)) {
        appliedVersions.push(params[0]);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { state.released = true; },
  };
  return {
    connect: async () => client,
    exec(sql) {
      executed.push(sql);
      if (failSql && sql.includes(failSql)) throw new Error('boom');
    },
    _appliedVersions: appliedVersions,
    _calls: calls,
    _executed: executed,
    _state: state,
  };
}

test('pendingMigrations sorts by numeric ordinal and excludes applied + non-matching files', () => {
  const files = ['0010_late.sql', '0002_b.sql', '0001_init.sql', 'README.md', 'notes.txt'];
  assert.deepEqual(pendingMigrations(files, []), ['0001_init.sql', '0002_b.sql', '0010_late.sql']);
  assert.deepEqual(pendingMigrations(files, ['0001_init.sql']), ['0002_b.sql', '0010_late.sql']);
  assert.deepEqual(pendingMigrations([], []), []);
});

test('runMigrations applies pending files in order, records each, releases the session', async () => {
  const dir = tmpMigrations({ '0001_init.sql': 'create table a(x);', '0002_more.sql': 'create table b(x);' });
  const db = makeFakeDb();
  const result = await runMigrations(db, { dir, logger: SILENT });
  assert.deepEqual(result.applied, ['0001_init.sql', '0002_more.sql']);
  assert.deepEqual(db._appliedVersions, ['0001_init.sql', '0002_more.sql']);
  // one write-locking transaction per migration, bodies run via exec
  assert.equal(db._calls.filter(c => c.head === 'begin immediate').length, 2);
  assert.equal(db._calls.filter(c => c.head === 'commit').length, 2);
  assert.equal(db._executed.length, 2);
  assert.equal(db._state.released, true);
});

test('runMigrations is a no-op when everything is already applied', async () => {
  const dir = tmpMigrations({ '0001_init.sql': 'create table a(x);' });
  const db = makeFakeDb();
  db._appliedVersions.push('0001_init.sql');
  const result = await runMigrations(db, { dir, logger: SILENT });
  assert.deepEqual(result.applied, []);
  assert.equal(db._calls.filter(c => c.head === 'begin immediate').length, 0);
  assert.equal(db._state.released, true);
});

test('runMigrations aborts on a failing migration: rolls back, does not record it or run later ones', async () => {
  const dir = tmpMigrations({
    '0001_init.sql': 'create table a(x);',
    '0002_boom.sql': 'SELECT boom_marker;',
    '0003_after.sql': 'create table c(x);',
  });
  const db = makeFakeDb({ failSql: 'boom_marker' });
  await assert.rejects(() => runMigrations(db, { dir, logger: SILENT }), /0002_boom\.sql/);
  assert.deepEqual(db._appliedVersions, ['0001_init.sql']); // 0002 not recorded, 0003 never ran
  assert.equal(db._calls.filter(c => c.head === 'rollback').length, 1);
  assert.equal(db._state.released, true); // released even on failure
});

test('runMigrations applies the real consolidated schema against real SQLite', async () => {
  const { createDb } = await import('../../server/db.js');
  const db = createDb(':memory:');
  const result = await runMigrations(db, { logger: SILENT });
  assert.deepEqual(result.applied, ['0001_init.sql', '0002_add_inbox_project.sql']);
  const { rows } = await db.query('select slug from projects order by sort_order');
  assert.deepEqual(rows.map(r => r.slug), ['inbox', 'personal', 'work', 'homelab']);
  // idempotent second run
  const again = await runMigrations(db, { logger: SILENT });
  assert.deepEqual(again.applied, []);
  await db.close();
});
