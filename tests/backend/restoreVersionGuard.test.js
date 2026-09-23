import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../../server/db.js';
import { knownMigrations, runMigrations } from '../../server/migrate.js';
import { createOnlineBackup, finalSchemaVersion, restoreDatabaseFromBackup } from '../../server/sqliteBackup.js';
import { assertManifestRestorable, compareVersions, praxVersion } from '../../server/backupManifest.js';
import { restoreWorkspaceDatabase, parseRestoreArgs } from '../../scripts/restore-database.js';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

const SILENT = { info() {}, error() {} };
const CURRENT = praxVersion();
const FINAL = knownMigrations().at(-1);

function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  const result = new Map(); let p = buffer.readUInt32LE(end + 16);
  const limit = p + buffer.readUInt32LE(end + 12);
  while (p < limit) {
    const method = buffer.readUInt16LE(p + 10), size = buffer.readUInt32LE(p + 20), names = buffer.readUInt16LE(p + 28);
    const local = buffer.readUInt32LE(p + 42), start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    result.set(buffer.subarray(p + 46, p + 46 + names).toString(), method === 0 ? data : inflateRawSync(data));
    p += 46 + names + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  return result;
}

// An extracted workspace backup: prax.db (self-contained) and manifest.json.
async function extractedBackup(t, { futureMigration = null, manifest = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'prax-restore-guard-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const live = join(directory, 'live.db');
  const db = createDb(live);
  await runMigrations(db, { logger: SILENT });
  if (futureMigration) await db.query('insert into schema_migrations (version) values ($1)', [futureMigration]);
  await db.close();
  const backupDir = join(directory, 'backup');
  const backup = join(backupDir, 'prax.db');
  const proof = await createOnlineBackup(live, backup);
  const content = {
    format: 'prax.workspace-backup', version: 1, praxVersion: CURRENT, schema: { finalMigration: FINAL },
    createdAt: new Date().toISOString(), database: { file: 'prax.db', sha256: proof.sha256 }, ...manifest,
  };
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(content));
  return { directory, backup, sha256: proof.sha256, manifestPath: join(backupDir, 'manifest.json'), target: join(directory, 'restored', 'prax.db') };
}

test('compareVersions orders releases and prereleases', () => {
  assert.equal(compareVersions('0.38.0', '0.38.0'), 0);
  assert.equal(compareVersions('0.39.0', '0.38.9'), 1);
  assert.equal(compareVersions('0.38.0', '1.0.0'), -1);
  assert.equal(compareVersions('0.39.0-rc.1', '0.39.0'), -1);
  assert.equal(compareVersions('0.39.0', '0.39.0-rc.2'), 1);
  assert.equal(compareVersions('0.39.0-rc.10', '0.39.0-rc.9'), 1);
  assert.equal(compareVersions('v0.38.0', '0.38.0'), 0);
  assert.equal(compareVersions('latest', '0.38.0'), null);
});

test('the manifest guard refuses a newer Prax, an unknown schema, and a foreign or newer manifest', () => {
  const base = { format: 'prax.workspace-backup', version: 1, praxVersion: CURRENT, schema: { finalMigration: FINAL } };
  assert.doesNotThrow(() => assertManifestRestorable(base));
  assert.doesNotThrow(() => assertManifestRestorable({ ...base, praxVersion: '0.1.0', schema: { finalMigration: '0001_init.sql' } }));
  assert.doesNotThrow(() => assertManifestRestorable({ format: 'prax.workspace-backup', version: 1, praxVersion: CURRENT }), 'manifests written before schema was recorded');
  assert.throws(() => assertManifestRestorable({ ...base, praxVersion: '99.0.0' }), /made by Prax 99\.0\.0, which is newer than this Prax/);
  assert.throws(() => assertManifestRestorable({ ...base, praxVersion: 'soon' }), /unreadable praxVersion/);
  assert.throws(() => assertManifestRestorable({ ...base, schema: { finalMigration: '9999_future.sql' } }), (error) => {
    assert.equal(error.code, 'PRAX_SCHEMA_TOO_NEW');
    assert.match(error.message, /This backup was upgraded by a newer version of Prax/);
    return true;
  });
  assert.throws(() => assertManifestRestorable({ ...base, format: 'something-else' }), /not a Prax workspace backup manifest/);
  assert.throws(() => assertManifestRestorable({ ...base, version: 2 }), /manifest version 2 is newer/);
});

test('a workspace backup manifest records the final schema migration', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'prax-manifest-schema-'));
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: join(directory, 'prax.db'), EMBEDDING_BACKEND: 'none' }) });
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const response = await app.inject('/api/workspace/backup');
  assert.equal(response.statusCode, 200, response.body);
  const manifest = JSON.parse(zipEntries(response.rawPayload).get('manifest.json'));
  assert.equal(manifest.praxVersion, CURRENT);
  assert.deepEqual(manifest.schema, { finalMigration: FINAL });
});

test('npm run restore refuses a backup whose manifest names a newer Prax, and restores nothing', async (t) => {
  const fixture = await extractedBackup(t, { manifest: { praxVersion: '99.0.0' } });
  assert.throws(
    () => restoreWorkspaceDatabase({ from: fixture.backup, to: fixture.target, sha256: fixture.sha256 }),
    /made by Prax 99\.0\.0, which is newer than this Prax/,
  );
  assert.equal(existsSync(fixture.target), false);
  // Named explicitly as well as discovered beside the database.
  assert.deepEqual(parseRestoreArgs(['--from', 'a', '--to', 'b', '--sha256', 'c', '--manifest', 'm.json']), { from: 'a', to: 'b', sha256: 'c', manifest: 'm.json' });
  assert.throws(
    () => restoreWorkspaceDatabase({ from: fixture.backup, to: fixture.target, sha256: fixture.sha256, manifest: fixture.manifestPath }),
    /newer than this Prax/,
  );
  assert.throws(
    () => restoreWorkspaceDatabase({ from: fixture.backup, to: fixture.target, sha256: fixture.sha256, manifest: join(fixture.directory, 'missing.json') }),
    /Backup manifest does not exist/,
  );
  assert.equal(existsSync(fixture.target), false);
});

test('restore refuses a manifest whose schema is newer, and a checksum that disagrees with the manifest', async (t) => {
  const newer = await extractedBackup(t, { manifest: { schema: { finalMigration: '9999_future.sql' } } });
  assert.throws(() => restoreWorkspaceDatabase({ from: newer.backup, to: newer.target, sha256: newer.sha256 }), /upgraded by a newer version of Prax/);
  assert.equal(existsSync(newer.target), false);

  const mismatch = await extractedBackup(t, { manifest: { database: { file: 'prax.db', sha256: 'a'.repeat(64) } } });
  assert.throws(() => restoreWorkspaceDatabase({ from: mismatch.backup, to: mismatch.target, sha256: mismatch.sha256 }), /does not match the checksum in .*manifest\.json/);
  assert.equal(existsSync(mismatch.target), false);
});

test('restore checks the database schema itself, so a missing or edited manifest cannot bypass the guard', async (t) => {
  const fixture = await extractedBackup(t, { futureMigration: '9999_from_the_future.sql' });
  // The manifest claims this very version; the database says otherwise.
  assert.throws(
    () => restoreWorkspaceDatabase({ from: fixture.backup, to: fixture.target, sha256: fixture.sha256 }),
    (error) => error.code === 'PRAX_SCHEMA_TOO_NEW' && /This backup was upgraded by a newer version of Prax/.test(error.message) && /9999_from_the_future\.sql/.test(error.message),
  );
  rmSync(fixture.manifestPath);
  assert.throws(() => restoreWorkspaceDatabase({ from: fixture.backup, to: fixture.target, sha256: fixture.sha256 }), /newer version of Prax/);
  // The shared primitive (verify:restore, the drill) refuses too.
  assert.throws(() => restoreDatabaseFromBackup(fixture.backup, fixture.target, { ownerDirectory: fixture.directory }), /newer version of Prax/);
  assert.equal(existsSync(fixture.target), false);
  assert.equal(finalSchemaVersion(fixture.backup), '9999_from_the_future.sql');
});

test('a current backup restores with its manifest, and the restore CLI reports a newer backup clearly', async (t) => {
  const fixture = await extractedBackup(t);
  const proof = restoreWorkspaceDatabase({ from: fixture.backup, to: fixture.target, sha256: fixture.sha256 });
  assert.equal(proof.integrityCheck, 'ok');
  const db = new DatabaseSync(fixture.target, { readOnly: true });
  try { assert.ok(db.prepare('select version from schema_migrations where version = ?').get(FINAL)); }
  finally { db.close(); }

  const newer = await extractedBackup(t, { manifest: { praxVersion: '99.0.0' } });
  const script = fileURLToPath(new URL('../../scripts/restore-database.js', import.meta.url));
  let failure;
  try {
    execFileSync(process.execPath, [script, '--from', newer.backup, '--to', newer.target, '--sha256', newer.sha256], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) { failure = error; }
  assert.ok(failure, 'the command fails');
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /made by Prax 99\.0\.0, which is newer than this Prax/);
  assert.equal(existsSync(newer.target), false);
  assert.ok(readFileSync(newer.manifestPath, 'utf8').includes('99.0.0'));
});
