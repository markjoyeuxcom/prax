import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';

function databaseArtifacts(databaseFile) {
  return [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`];
}

function ensureOwnedPath(candidate, ownerDirectory) {
  if (!ownerDirectory) throw new Error('ownerDirectory is required for destructive database operations');
  const owner = resolve(ownerDirectory);
  const path = resolve(candidate);
  const child = relative(owner, path);
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error(`Refusing destructive database operation outside owned directory: ${path}`);
  }
  return path;
}

function syncFile(path) {
  const descriptor = openSync(path, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function pragmaValues(rows) {
  return rows.map((row) => String(Object.values(row)[0] ?? ''));
}

// SQLite URI filename for an absolute POSIX path: percent-encode each path
// segment (spaces, '%', '?', '#' would otherwise terminate the path or be
// misread as an escape sequence) while keeping '/' as the separator — SQLite
// decodes %XX escapes but takes '/' literally.
function sqliteFileUri(path, query) {
  return `file:${path.split('/').map(encodeURIComponent).join('/')}?${query}`;
}

// Opening a WAL-mode file — even read-only — creates -wal/-shm companions
// that persist after close, and databaseArtifacts() checks make the NEXT
// backup/restore to that destination refuse. immutable=1 skips locking and
// journal handling entirely, so the open leaves no sidecars; it also means
// the WAL is not consulted, which is correct only for validation-style reads
// of a settled artifact, never for a live database.
function openReadOnlyWithoutSidecars(path) {
  try {
    return new DatabaseSync(sqliteFileUri(path, 'immutable=1'), { readOnly: true });
  } catch {
    // Node build without SQLite URI filename support: plain-path open; the
    // caller must clean any sidecars this open itself creates.
    return new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  }
}

export function validateSqliteBackup(databaseFile, { projectId, handoffNotes } = {}) {
  const path = resolve(databaseFile || '');
  if (!databaseFile || !existsSync(path)) {
    throw new Error(`SQLite backup does not exist: ${path}`);
  }

  const [, walPath, shmPath] = databaseArtifacts(path);
  const preExistingSidecars = new Set([walPath, shmPath].filter(existsSync));
  let db;
  try {
    db = openReadOnlyWithoutSidecars(path);
    const integrity = pragmaValues(db.prepare('pragma integrity_check').all());
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${integrity.join('; ') || 'no result'}`);
    }
    const foreignKeys = db.prepare('pragma foreign_key_check').all();
    if (foreignKeys.length > 0) {
      throw new Error(`SQLite foreign_key_check found ${foreignKeys.length} violation(s)`);
    }
    if (projectId !== undefined || handoffNotes !== undefined) {
      if (!projectId || typeof handoffNotes !== 'string') {
        throw new Error('Both projectId and handoffNotes are required for live-marker validation');
      }
      const marker = db.prepare('select handoff_notes as value from projects where id = ?').get(projectId);
      if (marker?.value !== handoffNotes) {
        throw new Error(`SQLite backup live marker mismatch: expected ${handoffNotes}`);
      }
    }
    const pageCount = Number(Object.values(db.prepare('pragma page_count').get())[0]);
    const pageSize = Number(Object.values(db.prepare('pragma page_size').get())[0]);
    return {
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
      liveMarkerPreserved: projectId !== undefined,
      pageCount,
      pageSize,
      bytes: statSync(path).size,
      sha256: fileDigest(path),
    };
  } catch (error) {
    throw new Error(`Invalid SQLite backup ${path}: ${error.message}`, { cause: error });
  } finally {
    if (db) db.close();
    // Defensive sweep for the plain-path fallback: remove only sidecars this
    // validation created — a caller's own -wal/-shm (a raw hot-copy backup)
    // must survive untouched.
    for (const sidecar of [walPath, shmPath]) {
      if (!preExistingSidecars.has(sidecar) && existsSync(sidecar)) unlinkSync(sidecar);
    }
  }
}

export async function createOnlineBackup(sourceFile, destinationFile, { rate = 128 } = {}) {
  const source = resolve(sourceFile || '');
  const destination = resolve(destinationFile || '');
  if (!sourceFile || sourceFile === ':memory:' || !existsSync(source)) {
    throw new Error(`SQLite backup source does not exist: ${source}`);
  }
  if (!destinationFile || source === destination) throw new Error('SQLite backup source and destination must differ');
  const occupied = databaseArtifacts(destination).find(existsSync);
  if (occupied) throw new Error(`Refusing to overwrite existing SQLite backup artifact: ${occupied}`);
  if (!Number.isInteger(rate) || rate < 1) throw new Error('SQLite backup rate must be a positive integer');

  mkdirSync(dirname(destination), { recursive: true });
  let sourceDb;
  let progress = null;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
    const pagesCopied = await sqliteBackup(sourceDb, destination, {
      rate,
      progress: (value) => { progress = value; },
    });
    syncFile(destination);
    return {
      pagesCopied: Number(pagesCopied),
      totalPages: Number(progress?.totalPages ?? pagesCopied),
      // The promise resolves only after the final batch; the last callback may
      // have described the state immediately before that batch.
      remainingPages: 0,
      bytes: statSync(destination).size,
      sha256: fileDigest(destination),
    };
  } catch (error) {
    for (const path of databaseArtifacts(destination)) {
      if (existsSync(path)) unlinkSync(path);
    }
    throw error;
  } finally {
    if (sourceDb) sourceDb.close();
  }
}

export function destroyOwnedDatabase(databaseFile, ownerDirectory) {
  const path = ensureOwnedPath(databaseFile, ownerDirectory);
  const removed = [];
  for (const artifact of databaseArtifacts(path)) {
    if (!existsSync(artifact)) continue;
    unlinkSync(artifact);
    removed.push(artifact);
  }
  return removed;
}

export function restoreDatabaseFromBackup(backupFile, targetFile, { ownerDirectory, marker } = {}) {
  const source = resolve(backupFile || '');
  const target = ensureOwnedPath(targetFile, ownerDirectory);
  if (!backupFile || source === target) throw new Error('SQLite restore source and target must differ');
  const occupied = databaseArtifacts(target).find(existsSync);
  if (occupied) throw new Error(`Refusing to overwrite existing SQLite restore target: ${occupied}`);

  validateSqliteBackup(source, marker);
  mkdirSync(dirname(target), { recursive: true });
  const staging = join(dirname(target), `.${basename(target)}.restore-${process.pid}-${Date.now()}.tmp`);
  if (databaseArtifacts(staging).some(existsSync)) {
    throw new Error(`SQLite restore staging file already exists: ${staging}`);
  }
  try {
    // A raw file-copy backup (docs/backup-restore.md endorses keeping the -wal
    // and -shm siblings) holds committed transactions in the WAL. Copy every
    // artifact, then checkpoint the staging copy so the restored file is
    // self-contained; the post-checkpoint validation below is the one that
    // must see exactly the restored bytes. Copying only the main file
    // silently discarded everything in the WAL while reporting a checksummed
    // success.
    const [sourceDb, sourceWal, sourceShm] = databaseArtifacts(source);
    const [stagingDb, stagingWal, stagingShm] = databaseArtifacts(staging);
    copyFileSync(sourceDb, stagingDb);
    if (existsSync(sourceWal)) copyFileSync(sourceWal, stagingWal);
    if (existsSync(sourceShm)) copyFileSync(sourceShm, stagingShm);
    const checkpointDb = new DatabaseSync(staging, { timeout: 5000 });
    try {
      checkpointDb.exec('pragma wal_checkpoint(TRUNCATE)');
    } finally {
      checkpointDb.close();
    }
    syncFile(staging);
    validateSqliteBackup(staging, marker);
    // The read-write checkpoint open creates fresh 0-byte -wal / -shm
    // companions on a WAL-mode file. Drop them after the LAST open so the
    // rename leaves no orphaned staging sidecars behind.
    for (const sidecar of [stagingWal, stagingShm]) {
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    renameSync(staging, target);
    return { targetFile: target, bytes: statSync(target).size, sha256: fileDigest(target) };
  } catch (error) {
    for (const artifact of databaseArtifacts(staging)) {
      if (existsSync(artifact)) unlinkSync(artifact);
    }
    throw error;
  }
}
