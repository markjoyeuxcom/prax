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

// The migrations this build ships, in order.
export function knownMigrations(dir = DEFAULT_MIGRATIONS_DIR) {
  return orderedMigrations(readdirSync(dir)).map(({ version }) => version);
}

// Applied migrations this build does not ship: the database was upgraded by a
// newer Prax. Running this build's code on it would be a silent downgrade.
export function unknownMigrations(allFiles, appliedVersions) {
  const known = new Set(orderedMigrations(allFiles).map(({ version }) => version));
  return [...appliedVersions].filter((version) => !known.has(version)).sort();
}

export class SchemaTooNewError extends Error {
  constructor(unknown, { finalKnown = null, subject = 'This database' } = {}) {
    super(`${subject} was upgraded by a newer version of Prax: it has migration(s) this version does not know `
      + `(${unknown.join(', ')}). This version of Prax only knows migrations through ${finalKnown || 'none'}. `
      + 'Refusing to use it, because older code on a newer schema can lose or corrupt data. '
      + 'Install the newer Prax again, or restore a backup made by this version or an older one.');
    this.name = 'SchemaTooNewError';
    this.code = 'PRAX_SCHEMA_TOO_NEW';
    this.unknownMigrations = unknown;
  }
}

export function assertKnownSchema(allFiles, appliedVersions, options = {}) {
  const unknown = unknownMigrations(allFiles, appliedVersions);
  if (unknown.length) {
    throw new SchemaTooNewError(unknown, { finalKnown: orderedMigrations(allFiles).at(-1)?.version, ...options });
  }
}

// The complete trigger set on the two tables whose triggers carry data rules:
// FTS maintenance and supersession lifecycle on markdown_documents, and the
// supersession sync and cycle guard on document_links. It is the one place
// that lists them; a migration that adds, renames or removes one of these
// triggers updates it in the same change.
//
// Why it is checked: SQLite cannot ALTER a CHECK constraint, so a migration
// may rebuild a table (create a copy, drop the old one, rename the copy).
// DROP TABLE silently drops every trigger on the old table, and ALTER TABLE
// RENAME fails while a document_links trigger still names the missing
// markdown_documents. A rebuild therefore drops the document_links triggers
// first and must recreate every trigger here afterwards; forgetting one leaves
// search or lifecycle state quietly wrong. runMigrations verifies the set
// inside the final migration's transaction, so such a migration rolls back.
export const EXPECTED_TRIGGERS = Object.freeze({
  markdown_documents: Object.freeze([
    'markdown_documents_fts_ad',
    'markdown_documents_fts_ai',
    'markdown_documents_fts_au',
    'markdown_documents_superseder_archived',
    'markdown_documents_superseder_restored',
    'markdown_documents_target_restored',
  ]),
  document_links: Object.freeze([
    'document_links_no_supersession_cycle',
    'document_links_supersedes_delete',
    'document_links_supersedes_insert',
  ]),
});

// Differences between the triggers on the guarded tables and `expected`.
export async function triggerSetProblems(q, expected = EXPECTED_TRIGGERS) {
  const tables = Object.keys(expected);
  const rows = (await q.query("select name, tbl_name from sqlite_master where type = 'trigger'")).rows;
  const problems = [];
  for (const table of tables) {
    for (const name of expected[table]) {
      const row = rows.find((candidate) => candidate.name === name);
      if (!row) problems.push(`missing ${name} on ${table}`);
      else if (row.tbl_name !== table) problems.push(`${name} is on ${row.tbl_name}, not ${table}`);
    }
  }
  const listed = new Set(tables.flatMap((table) => expected[table]));
  for (const row of rows) {
    if (tables.includes(row.tbl_name) && !listed.has(row.name)) problems.push(`unexpected ${row.name} on ${row.tbl_name}`);
  }
  return problems;
}

export async function assertTriggerSet(q, expected = EXPECTED_TRIGGERS) {
  const problems = await triggerSetProblems(q, expected);
  if (problems.length) {
    throw Object.assign(new Error(`schema trigger check failed: ${problems.join('; ')}. `
      + 'The expected set is EXPECTED_TRIGGERS in server/migrate.js; a table rebuild must recreate every trigger on the rebuilt table.'),
    { code: 'PRAX_SCHEMA_TRIGGERS', problems });
  }
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
    const files = readdirSync(dir);
    // Downgrade guard: never run this build's code on a schema a newer build
    // has already changed.
    assertKnownSchema(files, applied);
    const pending = pendingMigrations(files, applied, { through: options.through });

    // The trigger set describes the final schema, so it is checked only when
    // this run brings (or finds) the database at this build's last migration.
    const final = orderedMigrations(files).at(-1)?.version;
    const reachesFinal = migrationBoundary(files, options.through)?.version === final;
    const expectedTriggers = options.expectedTriggers === undefined
      ? (dir === DEFAULT_MIGRATIONS_DIR ? EXPECTED_TRIGGERS : null)
      : options.expectedTriggers;
    const checkTriggers = Boolean(expectedTriggers) && reachesFinal;

    if (pending.length === 0) {
      if (checkTriggers && applied.includes(final)) await assertTriggerSet(client, expectedTriggers);
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
        // Inside the final migration's transaction, so a migration that lost
        // a trigger rolls back instead of committing a quietly broken schema.
        if (checkTriggers && version === final) await assertTriggerSet(client, expectedTriggers);
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
