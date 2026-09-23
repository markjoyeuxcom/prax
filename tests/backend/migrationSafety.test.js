import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../../server/db.js';
import {
  DEFAULT_MIGRATIONS_DIR,
  EXPECTED_TRIGGERS,
  knownMigrations,
  runMigrations,
  triggerSetProblems,
  unknownMigrations,
} from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

const SILENT = { info() {}, error() {} };

async function migratedDb(file = ':memory:') {
  const db = createDb(file);
  await runMigrations(db, { logger: SILENT });
  return db;
}

async function triggers(db) {
  return (await db.query("select name, tbl_name from sqlite_master where type = 'trigger' order by name")).rows;
}

async function appliedVersions(db) {
  return (await db.query('select version from schema_migrations order by version')).rows.map((row) => row.version);
}

// Every shipped migration plus one more, in a scratch directory.
function migrationsWith(extraName, extraSql) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-mig-safety-'));
  for (const file of readdirSync(DEFAULT_MIGRATIONS_DIR)) copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
  writeFileSync(join(dir, extraName), extraSql);
  return dir;
}

test('EXPECTED_TRIGGERS is exactly the trigger set a fresh migration creates on the guarded tables', async () => {
  const db = await migratedDb();
  try {
    assert.deepEqual(await triggerSetProblems(db), []);
    const guarded = (await triggers(db)).filter((row) => Object.hasOwn(EXPECTED_TRIGGERS, row.tbl_name));
    const expected = Object.entries(EXPECTED_TRIGGERS).flatMap(([table, names]) => names.map((name) => ({ name, tbl_name: table })));
    assert.deepEqual(
      guarded.map((row) => `${row.tbl_name}.${row.name}`).sort(),
      expected.map((row) => `${row.tbl_name}.${row.name}`).sort(),
    );
    // The FTS, lifecycle and supersession families are all present.
    for (const family of [/_fts_/, /superseder|target_restored/, /document_links_supersedes|supersession_cycle/]) {
      assert.ok(expected.some((row) => family.test(row.name)), `${family} is guarded`);
    }
  } finally { await db.close(); }
});

// A migration that rebuilds markdown_documents the way SQLite's procedure
// requires (a CHECK change cannot be ALTERed): drop the document_links
// triggers that name the table (RENAME fails while they do), copy, drop,
// rename, and recreate those document_links triggers, but forget the
// markdown_documents FTS and lifecycle triggers DROP TABLE removed.
async function rebuildMigrationSql() {
  const db = await migratedDb();
  try {
    const table = (await db.query("select sql from sqlite_master where type = 'table' and name = 'markdown_documents'")).rows[0].sql;
    const linkTriggers = (await db.query("select name, sql from sqlite_master where type = 'trigger' and tbl_name = 'document_links'")).rows;
    return [
      '-- migrate:fk=off',
      ...linkTriggers.map((row) => `drop trigger ${row.name};`),
      `${table.replace(/^CREATE TABLE\s+"?markdown_documents"?/i, 'CREATE TABLE markdown_documents_rebuilt')};`,
      'insert into markdown_documents_rebuilt select * from markdown_documents;',
      'drop table markdown_documents;',
      'alter table markdown_documents_rebuilt rename to markdown_documents;',
      ...linkTriggers.map((row) => `${row.sql};`),
    ].join('\n');
  } finally { await db.close(); }
}

test('a table rebuild that drops the lifecycle and FTS triggers fails loudly and rolls back', async () => {
  const dir = migrationsWith('9000_rebuild_markdown_documents.sql', await rebuildMigrationSql());
  const db = await migratedDb();
  try {
    const before = await triggers(db);
    await assert.rejects(
      () => runMigrations(db, { dir, logger: SILENT, expectedTriggers: EXPECTED_TRIGGERS }),
      (error) => {
        assert.match(error.message, /migration failed: 9000_rebuild_markdown_documents\.sql/);
        assert.match(error.message, /schema trigger check failed/);
        for (const name of EXPECTED_TRIGGERS.markdown_documents) assert.match(error.message, new RegExp(`missing ${name} on markdown_documents`));
        assert.doesNotMatch(error.message, /document_links_/, 'the recreated document_links triggers are accounted for');
        return true;
      },
    );
    // The rebuild was the final migration and ran in one transaction with
    // the check: nothing of it committed.
    assert.deepEqual(await triggers(db), before);
    assert.equal((await appliedVersions(db)).includes('9000_rebuild_markdown_documents.sql'), false);
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an up-to-date database missing a guarded trigger refuses to start; an extra one is reported too', async () => {
  const db = await migratedDb();
  try {
    await db.query('drop trigger markdown_documents_fts_au');
    await assert.rejects(() => runMigrations(db, { logger: SILENT }), /missing markdown_documents_fts_au on markdown_documents/);
  } finally { await db.close(); }

  const extra = await migratedDb();
  try {
    await extra.query("create trigger document_links_surprise after insert on document_links begin select 1; end");
    await assert.rejects(() => runMigrations(extra, { logger: SILENT }), /unexpected document_links_surprise on document_links/);
  } finally { await extra.close(); }
});

test('a historical boundary does not demand the final trigger set', async () => {
  const db = createDb(':memory:');
  try {
    await runMigrations(db, { logger: SILENT, through: '0009' });
    assert.ok((await appliedVersions(db)).length > 0);
    await runMigrations(db, { logger: SILENT });
    assert.deepEqual(await triggerSetProblems(db), []);
  } finally { await db.close(); }
});

test('downgrade guard: a database with migrations this build does not know is refused, before any work', async () => {
  const known = knownMigrations();
  assert.deepEqual(unknownMigrations(known, [...known]), []);
  assert.deepEqual(unknownMigrations(known, [...known, '9999_from_the_future.sql']), ['9999_from_the_future.sql']);

  const directory = mkdtempSync(join(tmpdir(), 'prax-downgrade-'));
  const file = join(directory, 'prax.db');
  try {
    const db = await migratedDb(file);
    await db.query("insert into schema_migrations (version) values ('9999_from_the_future.sql')");
    await assert.rejects(() => runMigrations(db, { logger: SILENT }), (error) => {
      assert.equal(error.code, 'PRAX_SCHEMA_TOO_NEW');
      assert.match(error.message, /upgraded by a newer version of Prax/);
      assert.match(error.message, /9999_from_the_future\.sql/);
      assert.match(error.message, new RegExp(`only knows migrations through ${known.at(-1).replace('.', '\\.')}`));
      return true;
    });
    await db.close();

    // Startup refuses the same database rather than serving it.
    await assert.rejects(
      () => buildApp({ config: loadConfig({ PRAX_DB_FILE: file, EMBEDDING_BACKEND: 'none' }) }),
      /upgraded by a newer version of Prax/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('downgrade guard runs before pending migrations on a partly migrated newer database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-downgrade-fake-'));
  writeFileSync(join(dir, '0001_init.sql'), 'create table a(x);');
  writeFileSync(join(dir, '0002_more.sql'), 'create table b(x);');
  const calls = [];
  const executed = [];
  const client = {
    async query(text) {
      calls.push(text.trim().split('\n')[0]);
      if (/^select version from schema_migrations/i.test(text.trim())) return { rows: [{ version: '0001_init.sql' }, { version: '0003_newer.sql' }] };
      return { rows: [] };
    },
    release() {},
  };
  const db = { connect: async () => client, exec(sql) { executed.push(sql); } };
  try {
    await assert.rejects(() => runMigrations(db, { dir, logger: SILENT }), /0003_newer\.sql/);
    assert.deepEqual(executed, [], 'no migration ran');
    assert.equal(calls.some((sql) => /^begin/i.test(sql)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
