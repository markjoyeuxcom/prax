import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { backupConfiguredDatabase, parseBackupArgs } from '../../scripts/backup-database.js';
import {
  createOnlineBackup,
  destroyOwnedDatabase,
  parseBackupRestoreArgs,
  restoreDatabaseFromBackup,
  runBackupRestoreDrill,
  validateSqliteBackup,
} from '../../scripts/verify-backup-restore.js';

function tempDirectory() {
  return mkdtempSync(join(tmpdir(), 'prax-backup-restore-test-'));
}

function createTinyDatabase(path, value = 'preserve me') {
  const db = new DatabaseSync(path);
  db.exec(`
    pragma foreign_keys = on;
    create table sample (id integer primary key, value text not null);
  `);
  db.prepare('insert into sample (value) values (?)').run(value);
  db.close();
}

test('backup/restore CLI parsing keeps scale, history, and artifact retention explicit', () => {
  assert.deepEqual(parseBackupRestoreArgs([
    '--profile', 'ci', '--historical-profile', 'ci', '--skip-historical', '--keep',
  ]), {
    profile: 'ci', historicalProfile: 'ci', includeHistorical: false, keepArtifacts: true,
  });
  assert.throws(() => parseBackupRestoreArgs(['--unknown']), /Unknown backup\/restore option/);
  assert.throws(() => parseBackupRestoreArgs(['--profile']), /requires a value/);
  assert.deepEqual(parseBackupArgs(['--output', '/tmp/prax-backup.db', '--rate', '64']), {
    output: '/tmp/prax-backup.db', rate: 64,
  });
  assert.throws(() => parseBackupArgs(['--output']), /requires a value/);
});

test('online backup and restore are non-overwriting and reject corrupt artifacts', async () => {
  const directory = tempDirectory();
  const source = join(directory, 'source.db');
  const backup = join(directory, 'backup.db');
  const target = join(directory, 'target.db');
  const corrupt = join(directory, 'corrupt.db');
  createTinyDatabase(source);

  const copied = await createOnlineBackup(source, backup, { rate: 1 });
  assert.ok(copied.pagesCopied > 0);
  assert.equal(validateSqliteBackup(backup).integrityCheck, 'ok');
  await assert.rejects(() => createOnlineBackup(source, backup), /Refusing to overwrite/);

  restoreDatabaseFromBackup(backup, target, { ownerDirectory: directory });
  assert.equal(validateSqliteBackup(target).integrityCheck, 'ok');
  const restored = new DatabaseSync(target, { readOnly: true });
  assert.equal(restored.prepare('select value from sample').get().value, 'preserve me');
  restored.close();

  writeFileSync(corrupt, 'not a sqlite database');
  const absentTarget = join(directory, 'absent-target.db');
  assert.throws(
    () => restoreDatabaseFromBackup(corrupt, absentTarget, { ownerDirectory: directory }),
    /Invalid SQLite backup/,
  );
  assert.equal(existsSync(absentTarget), false, 'corruption is rejected before target creation');
  assert.throws(
    () => restoreDatabaseFromBackup(backup, target, { ownerDirectory: directory }),
    /Refusing to overwrite existing SQLite restore target/,
  );
  assert.equal(validateSqliteBackup(target).integrityCheck, 'ok', 'existing target remains intact');
});

// Regression (2026-07-18 review): a raw file-copy backup keeps committed
// transactions in its -wal sibling, validateSqliteBackup reads THROUGH that
// WAL, but restore used to copy only the main file — silently discarding
// every WAL-resident transaction while reporting a checksummed success. The
// restore must deliver exactly the state validation saw.
test('restore carries WAL-resident transactions from a raw file-copy backup', () => {
  const directory = tempDirectory();
  const livePath = join(directory, 'live.db');
  const backup = join(directory, 'backup.db');
  const target = join(directory, 'target.db');

  // Rows committed in WAL mode with the connection HELD OPEN, so the WAL is
  // not checkpointed into the main file (closing would fold it in).
  const live = new DatabaseSync(livePath);
  live.exec('pragma journal_mode = wal;');
  live.exec('create table sample (id integer primary key, value text not null);');
  const insert = live.prepare('insert into sample (value) values (?)');
  for (let i = 0; i < 20; i += 1) insert.run(`wal-row-${i}`);

  // Hot copy of db + wal + shm — the raw backup shape docs/backup-restore.md endorses.
  copyFileSync(livePath, backup);
  copyFileSync(`${livePath}-wal`, `${backup}-wal`);
  if (existsSync(`${livePath}-shm`)) copyFileSync(`${livePath}-shm`, `${backup}-shm`);
  live.close();

  const validated = validateSqliteBackup(backup);
  assert.equal(validated.integrityCheck, 'ok');

  restoreDatabaseFromBackup(backup, target, { ownerDirectory: directory });
  // Sidecar checks must precede any open: opening a WAL-mode file (even
  // read-only) creates fresh -wal/-shm companions.
  assert.equal(existsSync(`${target}-wal`), false, 'restored target is self-contained');
  assert.equal(existsSync(`${target}-shm`), false, 'restored target is self-contained');
  const orphans = readdirSync(directory).filter((name) => name.includes('.restore-'));
  assert.deepEqual(orphans, [], 'no staging artifacts left behind');

  const restored = new DatabaseSync(target, { readOnly: true });
  assert.equal(
    restored.prepare('select count(*) as n from sample').get().n,
    20,
    'every WAL-resident committed row survives the restore',
  );
  restored.close();
});

// Regression (2026-07-18 review): validating a WAL-mode backup with a plain
// read-only open created persistent -wal/-shm sidecars next to the artifact,
// so the NEXT backup to the same rotated path refused with "Refusing to
// overwrite existing SQLite backup artifact".
test('validation leaves no sidecars that block the next backup to the same path', async () => {
  const directory = tempDirectory();
  const source = join(directory, 'live.db');
  const backup = join(directory, 'backup.db');
  // WAL-mode source: the online backup copies the WAL journal-mode header, so
  // the backup file itself is the shape whose validation used to shed sidecars.
  const live = new DatabaseSync(source);
  live.exec(`
    pragma journal_mode = wal;
    create table sample (id integer primary key, value text not null);
  `);
  live.prepare('insert into sample (value) values (?)').run('sidecar sentinel');
  live.close();

  await createOnlineBackup(source, backup, { rate: 1 });
  assert.equal(validateSqliteBackup(backup).integrityCheck, 'ok');
  assert.equal(validateSqliteBackup(backup).integrityCheck, 'ok', 'repeat validation stays clean');
  assert.equal(existsSync(`${backup}-wal`), false, 'validation must not leave a -wal sidecar');
  assert.equal(existsSync(`${backup}-shm`), false, 'validation must not leave a -shm sidecar');

  // Operator rotation flow: move/delete the previous artifact, back up to the
  // same path again. Leftover validation sidecars used to make this refuse.
  unlinkSync(backup);
  await createOnlineBackup(source, backup, { rate: 1 });
  assert.equal(validateSqliteBackup(backup).integrityCheck, 'ok');
});

test('online backup fails closed when the destination filesystem is unavailable', async () => {
  const directory = tempDirectory();
  const source = join(directory, 'source.db');
  const blockedParent = join(directory, 'not-a-directory');
  const destination = join(blockedParent, 'backup.db');
  createTinyDatabase(source, 'source remains authoritative');
  writeFileSync(blockedParent, 'this path intentionally blocks directory creation');

  await assert.rejects(() => createOnlineBackup(source, destination), /EEXIST|ENOTDIR/);
  assert.equal(existsSync(destination), false, 'no partial backup artifact is left behind');
  assert.equal(validateSqliteBackup(source).integrityCheck, 'ok', 'the live source remains valid');
  const live = new DatabaseSync(source, { readOnly: true });
  assert.equal(live.prepare('select value from sample').get().value, 'source remains authoritative');
  live.close();
});

test('operator backup command snapshots the configured live database and reports validation', async () => {
  const directory = tempDirectory();
  const source = join(directory, 'configured.db');
  const output = join(directory, 'operator-backup.db');
  createTinyDatabase(source, 'operator sentinel');
  const previous = process.env.PRAX_DB_FILE;
  process.env.PRAX_DB_FILE = source;
  try {
    const report = await backupConfiguredDatabase({ output, rate: 1 });
    assert.equal(report.format, 'prax.sqlite-backup');
    assert.equal(report.version, 1);
    assert.equal(report.sourceFile, source);
    assert.equal(report.backupFile, output);
    assert.equal(report.integrityCheck, 'ok');
    assert.equal(report.foreignKeyViolations, 0);
    assert.equal(report.remainingPages, 0);
    assert.match(report.sha256, /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.PRAX_DB_FILE;
    else process.env.PRAX_DB_FILE = previous;
  }
});

test('destruction requires an explicit owner and touches only exact database artifacts', () => {
  const directory = tempDirectory();
  const database = join(directory, 'owned.db');
  createTinyDatabase(database);
  writeFileSync(`${database}-wal`, 'owned wal');
  writeFileSync(`${database}-shm`, 'owned shm');
  const neighbor = join(directory, 'neighbor.db');
  createTinyDatabase(neighbor, 'neighbor');

  assert.throws(() => destroyOwnedDatabase(database), /ownerDirectory is required/);
  assert.throws(
    () => destroyOwnedDatabase(database, join(directory, 'different-owner')),
    /outside owned directory/,
  );
  assert.equal(destroyOwnedDatabase(database, directory).length, 3);
  assert.equal(existsSync(database), false);
  assert.equal(existsSync(neighbor), true);
});

test('current and historical CI workspaces survive authoritative destructive restore', async () => {
  const report = await runBackupRestoreDrill({
    profile: 'ci',
    historicalProfile: 'ci',
    workspaceRoot: tempDirectory(),
  });

  assert.equal(report.format, 'prax.backup-restore-drill');
  assert.equal(report.version, 1);
  assert.equal(report.current.profile, 'ci');
  assert.equal(report.current.taskCount, 200);
  assert.equal(report.current.documentCount, 50);
  assert.ok(report.current.sourceWalBytes > 0);
  assert.ok(report.current.backup.pagesCopied > 0);
  assert.match(report.current.backup.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.current.preDestructionValidation.integrityCheck, 'ok');
  assert.equal(report.current.preDestructionValidation.foreignKeyViolations, 0);
  assert.equal(report.current.sourceDestroyedBeforeRestore, true);
  assert.deepEqual(report.current.migrationsAppliedAfterRestore, []);
  assert.equal(report.current.semanticVerified, true);
  assert.equal(report.current.liveMarkerPreserved, true);
  assert.equal(report.current.productionBootVerified, true);

  assert.equal(report.historical.profile, 'ci');
  assert.equal(report.historical.seededThrough, '0009_add_project_repo_url.sql');
  assert.equal(report.historical.migratedTo, '0026_add_document_updated_by_agent.sql');
  assert.deepEqual(report.historical.migrationsAppliedAfterRestore, [
    '0010_document_type_taxonomy.sql',
    '0011_add_document_external_refs.sql',
    '0012_enforce_supersession_lifecycle.sql',
    '0013_add_durable_run_chronicle.sql',
    '0014_add_task_import_operations.sql',
    '0015_add_document_creation_receipts.sql',
    '0016_add_task_activity_actor.sql',
    '0017_clamp_task_recurrence_intervals.sql',
    '0018_reconcile_restored_supersession.sql',
    '0019_resequence_chronicle_by_time.sql',
    '0020_add_task_deferral_count.sql',
    '0021_add_task_planning.sql',
    '0022_add_project_area.sql',
    '0023_add_document_revision.sql',
    '0024_add_task_import_sessions.sql',
    '0025_assistant_write_receipts.sql',
    '0026_add_document_updated_by_agent.sql',
  ]);
  assert.ok(report.historical.sourceWalBytes > 0);
  assert.equal(report.historical.sourceDestroyedBeforeRestore, true);
  assert.equal(report.historical.semanticVerified, true);
  assert.equal(report.historical.liveMarkerPreserved, true);
  assert.equal(report.historical.productionBootVerified, true);
});
