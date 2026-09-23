import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_RE = /^(\d+)_.*\.sql$/;

export function orderedMigrations(allFiles) {
  return allFiles
    .filter((name) => MIGRATION_RE.test(name))
    .map((name) => ({ version: name, ordinal: Number(name.match(MIGRATION_RE)[1]) }))
    .sort((a, b) => a.ordinal - b.ordinal || a.version.localeCompare(b.version));
}

export function migrationBoundary(allFiles, through = 'current') {
  const ordered = orderedMigrations(allFiles);
  if (ordered.length === 0) {
    if (through === undefined || through === null || through === 'current') return null;
    throw new Error(`Unknown migration boundary: ${through}`);
  }
  if (through === undefined || through === null || through === 'current') return ordered.at(-1);

  const value = String(through).trim();
  const exact = ordered.find(({ version }) => version === value);
  if (exact) return exact;
  if (/^\d+$/.test(value)) {
    const ordinal = Number(value);
    const byOrdinal = ordered.find((migration) => migration.ordinal === ordinal);
    if (byOrdinal) return byOrdinal;
  }
  throw new Error(`Unknown migration boundary: ${through}`);
}

export function pendingMigrations(allFiles, appliedVersions, { through = 'current' } = {}) {
  const applied = new Set(appliedVersions);
  const boundary = migrationBoundary(allFiles, through);
  return orderedMigrations(allFiles)
    .filter(({ ordinal }) => boundary === null || ordinal <= boundary.ordinal)
    .filter(({ version }) => !applied.has(version))
    .map(({ version }) => version);
}

// Runs pending .sql files in ordinal order, one transaction each, recording
// them in schema_migrations. The database is embedded, so cross-process
// serialization comes from SQLite's own write locking (BEGIN IMMEDIATE takes
// the write lock up front; busy_timeout in db.js makes contenders wait) —
// the old Postgres advisory lock has no equivalent and no longer applies.
export async function runMigrations(db, options = {}) {
  const dir = options.dir || DEFAULT_MIGRATIONS_DIR;
  const log = options.logger || console;
  const client = await db.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `);
    const appliedRes = await client.query('select version from schema_migrations');
    const applied = appliedRes.rows.map((row) => row.version);
    const pending = pendingMigrations(readdirSync(dir), applied, { through: options.through });

    if (pending.length === 0) {
      log.info('schema up to date');
      return { applied: [] };
    }

    // `onProgress` hears about each migration before it starts and once they
    // are all done, so a supervisor with a startup budget (the desktop shell)
    // can tell a long upgrade from a hung start. It is awaited: the desktop
    // passes one that yields to the event loop, which lets a quit request or
    // signal arrive between migrations. `signal` then stops the run at that
    // boundary; every migration is its own transaction, so nothing is half done.
    const onProgress = options.onProgress || null;
    const done = [];
    for (const [index, version] of pending.entries()) {
      if (onProgress) await onProgress({ phase: 'migrating', version, index: index + 1, total: pending.length });
      if (options.signal?.aborted) {
        log.info(`migrations stopped before ${version}: shutdown requested`);
        return { applied: done, stopped: true };
      }
      const sql = readFileSync(join(dir, version), 'utf8');
      // Table-rebuild migrations (SQLite can't ALTER a CHECK constraint) carry
      // a `-- migrate:fk=off` marker: with foreign_keys ON, DROP TABLE runs an
      // implicit DELETE that CASCADEs child rows away (document_links, runs).
      // Per SQLite's documented rebuild procedure the pragma must be toggled
      // OUTSIDE the transaction (it is a no-op inside one), and
      // foreign_key_check before commit keeps the safety the pragma gave up.
      // Tolerant of case + spacing around the colon/equals so a reformatted or
      // hand-typed marker can't silently leave FKs on (which would let the
      // rebuild's DROP cascade child rows away — permanent, unnoticed loss).
      const fkOff = /^\s*--\s*migrate:\s*fk\s*=\s*off\s*$/im.test(sql) && Boolean(db.exec);
      try {
        if (fkOff) db.exec('PRAGMA foreign_keys = OFF');
        await client.query('begin immediate');
        if (db.exec) {
          // Migration files are multi-statement; run them on the raw handle.
          db.exec(sql);
        } else {
          await client.query(sql);
        }
        if (fkOff) {
          const violations = await client.query('PRAGMA foreign_key_check');
          if (violations.rows.length > 0) {
            throw new Error(`foreign_key_check found ${violations.rows.length} violation(s) after rebuild`);
          }
        }
        await client.query('insert into schema_migrations (version) values ($1)', [version]);
        await client.query('commit');
        done.push(version);
      } catch (err) {
        await client.query('rollback').catch(() => {});
        log.error(`migration failed: ${version}: ${err.message}`);
        throw new Error(`migration failed: ${version}: ${err.message}`, { cause: err });
      } finally {
        if (fkOff) db.exec('PRAGMA foreign_keys = ON');
      }
    }
    log.info(`applied ${pending.length} migration(s)`);
    if (onProgress) await onProgress({ phase: 'migrated', total: pending.length });
    return { applied: pending };
  } finally {
    client.release();
  }
}
