import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
// Arbitrary fixed 64-bit key so all app instances serialize on the same lock.
const ADVISORY_LOCK_KEY = 4073220011;
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

export async function runMigrations(db, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  const log = options.logger || console;
  const client = await db.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
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
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [version]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        log.error(`migration failed: ${version}: ${err.message}`);
        throw new Error(`migration failed: ${version}: ${err.message}`, { cause: err });
      }
    }
    log.info(`applied ${pending.length} migration(s)`);
    return { applied: pending };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
