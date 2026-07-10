import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_RE = /^(\d+)_.*\.sql$/;

export function pendingMigrations(allFiles, appliedVersions) {
  const applied = new Set(appliedVersions);
  return allFiles
    .filter((name) => MIGRATION_RE.test(name))
    .map((name) => ({ version: name, ordinal: Number(name.match(MIGRATION_RE)[1]) }))
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter(({ version }) => !applied.has(version))
    .map(({ version }) => version);
}

// Runs pending .sql files in ordinal order, one transaction each, recording
// them in schema_migrations. The database is embedded, so cross-process
// serialization comes from SQLite's own write locking (BEGIN IMMEDIATE takes
// the write lock up front; busy_timeout in db.js makes contenders wait) —
// the old Postgres advisory lock has no equivalent and no longer applies.
export async function runMigrations(db, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
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
    const pending = pendingMigrations(readdirSync(dir), applied);

    if (pending.length === 0) {
      log.info('schema up to date');
      return { applied: [] };
    }

    for (const version of pending) {
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
      } catch (err) {
        await client.query('rollback').catch(() => {});
        log.error(`migration failed: ${version}: ${err.message}`);
        throw new Error(`migration failed: ${version}: ${err.message}`, { cause: err });
      } finally {
        if (fkOff) db.exec('PRAGMA foreign_keys = ON');
      }
    }
    log.info(`applied ${pending.length} migration(s)`);
    return { applied: pending };
  } finally {
    client.release();
  }
}
