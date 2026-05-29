# Database Migrations & Backup/Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Moomora a hand-rolled, forward-only SQL migration system that the app applies automatically on startup (and via `npm run migrate`), with the current schema as the baseline migration, plus a documented backup/restore + upgrade procedure.

**Architecture:** A new `server/migrate.js` reads ordered `server/migrations/NNNN_*.sql` files, tracks applied versions in a `schema_migrations` table, and applies pending ones on a single dedicated `pg` client (advisory-lock-serialized, each migration in its own transaction). `buildApp()` runs it when a real DB is present; `scripts/migrate.js` runs it standalone. `schema.sql` becomes `0001_init.sql` (a no-op on existing DBs because it's `create … if not exists`), the Docker init-script mount is removed, and docs are updated.

**Tech Stack:** Node + `pg` (no new deps), Node built-in test runner.

**Spec:** [docs/superpowers/specs/2026-05-29-database-migrations-design.md](../specs/2026-05-29-database-migrations-design.md)

**File map:**
- Create: `server/migrate.js` (runner), `server/migrations/0001_init.sql` (baseline, moved from schema.sql), `scripts/migrate.js` (CLI), `tests/backend/migrate.test.js`, `docs/backup-restore.md`
- Modify: `server/db.js` (+`connect`), `server/index.js` (run on startup), `package.json` (`migrate` script + `check`), `compose.yaml` (drop init mount), `README.md`, `docs/deployment.md`
- Delete: `server/schema.sql` (moved to `0001_init.sql`)

---

## Task 1: Migration runner + `db.connect()` + tests

**Files:**
- Modify: `server/db.js`
- Create: `server/migrate.js`, `tests/backend/migrate.test.js`

- [ ] **Step 1: Add `connect()` to `server/db.js`**

The runner needs one dedicated client (advisory lock + transactions must stay on the same connection). Change `createDb` to expose it:

```js
import pg from 'pg';

const { Pool } = pg;

export function createDb(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    query: (text, params = []) => pool.query(text, params),
    connect: () => pool.connect(), // dedicated client; caller MUST release()
    async checkReady() {
      await pool.query('select 1');
      return true;
    },
    close: () => pool.end(),
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/backend/migrate.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/backend/migrate.test.js`
Expected: FAIL — `Cannot find module '../../server/migrate.js'`.

- [ ] **Step 4: Implement `server/migrate.js`**

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/backend/migrate.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/migrate.js tests/backend/migrate.test.js
git commit -m "feat: add forward-only SQL migration runner"
```

---

## Task 2: Baseline migration (move schema.sql → 0001_init.sql)

**Files:**
- Move: `server/schema.sql` → `server/migrations/0001_init.sql`
- Delete: `server/schema.sql`

- [ ] **Step 1: Move the file verbatim**

Run:
```bash
mkdir -p server/migrations
git mv server/schema.sql server/migrations/0001_init.sql
```

- [ ] **Step 2: Verify the content is unchanged and transaction-safe**

Run: `git show HEAD:server/schema.sql | diff - server/migrations/0001_init.sql && echo IDENTICAL`
Expected: `IDENTICAL` (the move did not alter content).

Confirm by reading `server/migrations/0001_init.sql` that every statement is `create extension/table/index if not exists` or `insert … on conflict do nothing` — i.e. idempotent and contains no `CREATE INDEX CONCURRENTLY` (which can't run inside the runner's transaction). It does today; no edits needed.

- [ ] **Step 3: Commit**

```bash
git add -A server/schema.sql server/migrations/0001_init.sql
git commit -m "refactor: make current schema the 0001 baseline migration"
```

---

## Task 3: Run on startup + manual script + check

**Files:**
- Modify: `server/index.js`, `package.json`
- Create: `scripts/migrate.js`

- [ ] **Step 1: Run migrations in `buildApp()`**

In `server/index.js`, add the import near the other server imports:

```js
import { runMigrations } from './migrate.js';
```

Then, in `buildApp()`, immediately after the `const db = …` line and before `app.decorate('db', db);`, add:

```js
  if (db && !options.skipDb) {
    await runMigrations(db, { logger: app.log });
  }
```

(The guard means the in-memory demo and `skipDb: true` route tests never invoke the runner — confirmed: those tests pass `skipDb: true`, so `db` is null.)

- [ ] **Step 2: Add the standalone migrate script**

Create `scripts/migrate.js`:

```js
import { loadConfig } from '../server/config.js';
import { createDb } from '../server/db.js';
import { runMigrations } from '../server/migrate.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const db = createDb(config.databaseUrl);
try {
  await runMigrations(db, { logger: { info: (m) => console.log(m), error: (m) => console.error(m) } });
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
```

- [ ] **Step 3: Add the `migrate` script and extend `check`**

In `package.json` `scripts`, add `migrate` and extend `check` to syntax-check the two new files:

```json
    "start": "node server/index.js",
    "migrate": "node scripts/migrate.js",
    "test": "node scripts/run-tests.js",
    "check": "node --check server/index.js && node --check scripts/demo-server.js && node --check public/js/main.js && node --check mcp/server.js && node --check server/migrate.js && node --check scripts/migrate.js"
```

- [ ] **Step 4: Run tests + check**

Run: `npm test`
Expected: full suite green (the new migrate tests included; no route/demo regressions — the `skipDb` path never calls the runner).

Run: `npm run check`
Expected: clean (now covers `server/migrate.js` and `scripts/migrate.js`).

- [ ] **Step 5: Commit**

```bash
git add server/index.js scripts/migrate.js package.json
git commit -m "feat: run migrations on startup and via npm run migrate"
```

---

## Task 4: Compose + docs

**Files:**
- Modify: `compose.yaml`, `README.md`, `docs/deployment.md`
- Create: `docs/backup-restore.md`

- [ ] **Step 1: Remove the Docker init-script mount**

In `compose.yaml`, the `postgres` service `volumes:` currently is:

```yaml
    volumes:
      - postgres-data:/var/lib/postgresql
      - ./server/schema.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro
```

Remove the schema-mount line so it reads:

```yaml
    volumes:
      - postgres-data:/var/lib/postgresql
```

(Postgres now starts empty; the app applies migrations on first connect. `depends_on: postgres { condition: service_healthy }` already orders startup.)

- [ ] **Step 2: Update README**

In `README.md`, the "Local Persistent Install" section currently states the first DB startup applies `server/schema.sql` through Postgres init scripts. Replace that sentence:

Old:
```
The first database startup applies `server/schema.sql` automatically through Postgres init scripts. To reset local data:
```
New:
```
The app applies database migrations automatically on startup, so a fresh Postgres volume is initialised on first run. To reset local data:
```

And in the "Run With PostgreSQL" section, the schema-apply step currently is:

```
Apply the schema to a PostgreSQL database:

```bash
psql "$DATABASE_URL" -f server/schema.sql
```
```

Replace it with:

```
The app applies migrations automatically on startup. To apply them explicitly (e.g. before first boot or from CI):

```bash
DATABASE_URL="postgresql://user:password@host:5432/database" npm run migrate
```
```

Also add `npm run migrate` to the "Scripts" list with the line: `- `npm run migrate` applies pending database migrations.`

- [ ] **Step 3: Update `docs/deployment.md`**

The "Database Schema" section currently tells the operator to apply `server/schema.sql` with `psql`. Replace its body with:

```
The app applies database migrations automatically on startup, so deploying the container is sufficient to initialise or upgrade the schema. To apply migrations explicitly — for example from a pre-deploy Job — run the bundled script against the database:

```bash
DATABASE_URL=$(kubectl get secret moomora-console-db-app -o jsonpath='{.data.uri}' | base64 -d)
DATABASE_URL="$DATABASE_URL" npm run migrate
```

Migrations are forward-only and tracked in a `schema_migrations` table; re-running is safe (already-applied migrations are skipped).
```

- [ ] **Step 4: Create `docs/backup-restore.md`**

Create the file with this content:

```markdown
# Moomora Console Backup & Restore

Moomora Console stores all data in PostgreSQL. There are three layers to know about.

## 1. App-level export (portable, not a full backup)

The Admin panel exports:

- **Tasks** as a `moomora.tasks` JSON envelope (per-project or all projects).
- **Library** documents as a ZIP of `.md` files (per-project or all projects).

These are good for moving content between instances or keeping human-readable copies. They do **not** capture: archived tasks/documents, task↔document links, checklist or activity history, or project metadata. Treat them as portability/export, not as a complete backup.

## 2. Database backup (authoritative)

A full backup is a PostgreSQL dump of the database behind `DATABASE_URL`.

**Docker Compose:**

```bash
docker compose exec -T postgres pg_dump -U moomora -d moomora_console > moomora-backup.sql
# restore (into an empty database):
docker compose exec -T postgres psql -U moomora -d moomora_console < moomora-backup.sql
```

**Kubernetes (run from a pod with `psql`/`pg_dump` and the app secret):**

```bash
DATABASE_URL=$(kubectl get secret moomora-console-db-app -o jsonpath='{.data.uri}' | base64 -d)
pg_dump "$DATABASE_URL" > moomora-backup.sql
psql "$DATABASE_URL" < moomora-backup.sql   # restore into an empty database
```

This dump includes the `schema_migrations` table, so a restored database is recognised as already-migrated.

## 3. CloudNativePG (cluster-level)

When running on Kubernetes with CloudNativePG, prefer CNPG's built-in scheduled backups and point-in-time recovery for the database cluster — see the CloudNativePG documentation. The `pg_dump` flow above remains useful for portable, logical snapshots.

## Upgrading safely

1. **Back up** with `pg_dump` (section 2).
2. **Deploy** the new image.
3. Migrations **apply automatically on startup** (or run `npm run migrate` explicitly).
4. **Verify** `GET /readyz` returns ready.

**Rollback:** migrations are forward-only. To roll back, redeploy the previous image **and** restore the pre-upgrade dump — a migration may have changed the schema in a way the old code cannot read.
```

Then link it from `README.md` (e.g. under "Import And Export" or a new "Backup & Restore" line): `See [docs/backup-restore.md](docs/backup-restore.md) for backup, restore, and upgrade procedures.`

- [ ] **Step 5: Run check + commit**

Run: `npm run check`
Expected: clean.

```bash
git add compose.yaml README.md docs/deployment.md docs/backup-restore.md
git commit -m "docs: app-owned schema migrations; add backup/restore + upgrade guide"
```

---

## Task 5: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full suite + check**

Run: `npm test` → all pass. Run: `npm run check` → clean.

- [ ] **Step 2: Fresh-volume Docker smoke**

```bash
docker compose down -v          # ensure an empty volume
docker compose up --build -d
```
Then wait for readiness and confirm the app migrated from empty:
```bash
until curl -sf http://127.0.0.1:3100/healthz >/dev/null; do sleep 1; done
curl -s http://127.0.0.1:3100/readyz            # expect {"status":"ready"}
docker compose logs app | grep -i "applied .* migration"   # expect the applied-migrations log line
docker compose exec -T postgres psql -U moomora -d moomora_console -c "select version from schema_migrations;"  # expect 0001_init.sql
```
Confirm the UI loads at http://127.0.0.1:3100/ and tasks/library work.

- [ ] **Step 3: Existing-database smoke (baseline is a no-op)**

Simulate a database created from the OLD schema before the migration system existed:
```bash
docker compose down                              # keep the volume from Step 2
# Drop the tracking table to simulate a pre-migration DB, keep the data tables:
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U moomora -d moomora_console >/dev/null 2>&1; do sleep 1; done
docker compose exec -T postgres psql -U moomora -d moomora_console -c "drop table if exists schema_migrations;"
docker compose up -d app
until curl -sf http://127.0.0.1:3100/readyz >/dev/null; do sleep 1; done
docker compose exec -T postgres psql -U moomora -d moomora_console -c "select version from schema_migrations;"  # 0001_init.sql recorded again, no error
```
Expect: app starts cleanly (0001 ran as a no-op against existing tables and was recorded), `/readyz` ready, no errors in `docker compose logs app`.

- [ ] **Step 4: Manual `npm run migrate`**

Against the running Compose database:
```bash
DATABASE_URL="postgresql://moomora:moomora_local_dev@127.0.0.1:54320/moomora_console" npm run migrate
```
Expect: prints `schema up to date`, exits 0.

- [ ] **Step 5: Tear down**

```bash
docker compose down
```

- [ ] **Step 6: Fix-and-recommit if any step failed.** Otherwise no commit.

---

## Self-review checklist

- [x] **Spec coverage:** runner with `pendingMigrations` + `runMigrations` on a dedicated client (Task 1), `db.connect()` (Task 1 §1), advisory lock + tracking table + per-file transaction + fail-and-rethrow (Task 1 §4 + tests), baseline `0001_init.sql` no-op on existing DBs (Task 2 + Task 5 §3), startup auto-run guarded by `db && !skipDb` (Task 3 §1), `npm run migrate` (Task 3 §2-3), `check` extended (Task 3 §3), compose mount removed + README/deployment updated + `docs/backup-restore.md` (Task 4), forward-only/rollback-via-backup documented (Task 4 §4), all spec tests (Task 1 §2) + manual smokes including fresh/existing/explicit (Task 5).
- [x] **No placeholder steps:** every code step shows full code; every command step states expected output; the doc deliverable (`backup-restore.md`) is written out in full.
- [x] **Type/name consistency:** `runMigrations(db, { dir, logger })` and `pendingMigrations(allFiles, appliedVersions)` are defined in Task 1 and called identically in Task 3 (`buildApp`, `scripts/migrate.js`) and the tests. `db.connect()` added in Task 1 §1 is used by `runMigrations` in §4 and faked in §2. `schema_migrations` and the `0001_init.sql` version string are consistent across runner, tests, and smokes. The startup guard `db && !options.skipDb` matches the test harness's `skipDb: true` usage.
