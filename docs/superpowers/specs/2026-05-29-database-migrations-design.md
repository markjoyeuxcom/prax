# Database Migrations & Backup/Restore Design

**Date:** 2026-05-29
**Status:** Approved (brainstorm)
**Builds on:** v0.7.7
**Why:** A v1.0.0 prerequisite — schema must evolve safely across upgrades (today it can't), and backup/restore must be documented.

## Goal

Give Moomora a real schema-evolution mechanism so a deployed database can move from one version to the next without losing data or manual `psql` surgery, and document the backup/restore + upgrade procedure. Two deliverables in one spec:

1. **Migration system** — ordered, forward-only SQL migrations applied automatically by the app on startup (and via an explicit `npm run migrate`), tracked in a `schema_migrations` table, serialized by a Postgres advisory lock. The current `schema.sql` becomes the baseline migration; the app owns schema end-to-end.
2. **Backup/restore + upgrade docs** — a `docs/backup-restore.md` covering app-level export, database-level `pg_dump`/`pg_restore`, the CloudNativePG layer, and the safe upgrade/rollback sequence.

## Current state (context)

- **Schema lives in one file, applied once, never migrated.** `server/schema.sql` is the entire schema, written defensively (`create extension/table/index if not exists`, seed `insert … on conflict do nothing`).
- **The app never touches schema.** `server/index.js` `buildApp()` creates the pool (`server/db.js` → `createDb`), decorates `db`, registers routes, serves static, and listens. `db` exposes `query`, `checkReady` (`select 1`), `close`. There is no migration runner, tracking table, or `server/migrations/` directory.
- **Two apply paths today, neither handles change:**
  - Docker Compose mounts `./server/schema.sql` to `/docker-entrypoint-initdb.d/001-schema.sql` (`compose.yaml:12`) — Postgres runs it only on a **fresh** data volume.
  - Kubernetes/manual is a one-shot `psql "$DATABASE_URL" -f server/schema.sql` (per `docs/deployment.md`).
- **The gotcha:** `create table if not exists` is idempotent only for a fresh DB. Adding a column to `schema.sql` does nothing to an existing table (the whole `CREATE` is skipped), so schema changes to a live database are hand-applied today.
- **`k8s replicas: 1`** (`deploy/k8s/deployment.yaml`), so there is no concurrent-startup race today — but the design stays correct if that changes.
- **The Dockerfile copies the whole `server/` dir**, so `server/migrations/*.sql` ships in the image automatically.
- **The demo server** (`scripts/demo-server.js`) is in-memory (`skipDb: true`), has no schema, and must remain untouched by the runner.

## Decisions (from brainstorm)

- Scope: **migrations + backup/restore docs** (both v1.0 blockers).
- Runner: **hand-rolled** SQL runner, zero new dependencies (fits the plain-`pg`, no-ORM ethos). Forward-only.
- Trigger: **auto on app startup** (when a real DB is present) **plus** an explicit `npm run migrate`.
- `schema.sql`: **becomes the baseline migration** (`0001_init.sql`); the app owns schema; the Docker init-script mount and the manual `psql -f schema.sql` step are removed.

## Non-goals

- No `down`/rollback migrations. Forward-only; rollback = restore a backup (documented).
- No migration library (`node-pg-migrate` etc.) — explicitly hand-rolled.
- No `CREATE INDEX CONCURRENTLY` support in v1 (migrations run inside a transaction). Documented limitation.
- No change to the in-memory demo server or its repositories. (Each *future* migration that changes a table shape still requires the corresponding in-memory-mirror edit — that is a per-migration concern, not part of this mechanism.)
- No automated backup *execution* — backup/restore is documentation + the existing export features, not a new in-app scheduler. (CNPG owns scheduled physical backups.)

---

## 1. Migration runner — `server/migrate.js`

A new module exporting two things:

### `pendingMigrations(allFiles, appliedVersions)` — pure

- Input: an array of filenames (e.g. from `readdirSync`) and an array/Set of already-applied `version` strings.
- Filters to files matching `^\d+_.*\.sql$`, derives `version` = the full filename (e.g. `0001_init.sql`), sorts by the **numeric** ordinal prefix (so `0002` precedes `0010`), and returns the ordered list of `{ version, file }` whose `version` is not in `appliedVersions`.
- No I/O — unit-tested directly.

### `runMigrations(db, options)` — applies pending migrations

- `options`: `{ dir = server/migrations, logger }`.
- **Uses a single dedicated client for the entire run**, obtained via `db.connect()` (see the `db` change below). This is mandatory for correctness: a session-level advisory lock must be acquired and released on the *same* connection, and `begin`/`commit` must run on the same connection — `db.query` (→ `pool.query`) may route each call to a different pooled connection, which would silently break both. The client is `release()`d in a `finally`.
- Steps (all on the one client):
  1. **Advisory lock:** `select pg_advisory_lock($key)` with a hard-coded 64-bit constant (documented in code) so concurrent instances serialize. Matched by `select pg_advisory_unlock($key)` in the `finally`.
  2. **Ensure tracking table:** `create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`.
  3. Read applied versions: `select version from schema_migrations`.
  4. Compute pending via `pendingMigrations`.
  5. For each pending `{ version, file }`, **in its own transaction**: `begin` → execute the file's SQL text (a single multi-statement `client.query(text)` with no params → simple-query protocol, runs all statements in the file) → `insert into schema_migrations(version) values ($1)` → `commit`. On any error: `rollback`, log which migration failed, and rethrow (the run aborts; the failed migration is not recorded).
  6. Log a one-line summary (`applied N migrations` / `schema up to date`).

### `db` change (`server/db.js`)

Add a `connect` method exposing a dedicated pooled client:

```js
connect: () => pool.connect(),   // caller MUST release()
```

`createDb`'s returned object becomes `{ query, connect, checkReady, close }`. The runner uses `connect`; everything else keeps using `query`. Test fakes provide a `connect()` returning a fake client that records issued SQL.

### Migration files — `server/migrations/`

- `server/migrations/0001_init.sql` — the **current `server/schema.sql` content, verbatim**. Because it is already `… if not exists` + `on conflict do nothing`, it is a no-op on an existing database and a full build on a fresh one; either way the runner records `0001_init.sql` as applied. This is the bootstrap for already-deployed instances — no special baseline detection needed.
- Future changes are new files: `0002_<name>.sql`, etc.

---

## 2. Startup integration + manual script

### Auto on startup (`server/index.js`)

In `buildApp()`, after `const db = … createDb(…)` and **before** route registration / returning the app, add:

```js
if (db && !options.skipDb) {
  await runMigrations(db, { logger: app.log });
}
```

- The demo server passes `skipDb: true` (and unit tests inject fakes or `skipDb`), so they never invoke the runner.
- If `runMigrations` throws, `buildApp` rejects and the `import.meta.url` entrypoint never reaches `app.listen()` — the process exits non-zero with the logged error. **Failing loudly beats serving against a half-migrated schema.**

### Manual script (`scripts/migrate.js`)

- A small script that `loadConfig()`, `createDb(config.databaseUrl)`, `await runMigrations(db, { logger: console })`, `await db.close()`, and exits 0 (or non-zero on failure).
- `package.json`: add `"migrate": "node scripts/migrate.js"`.
- For k8s pre-deploy Jobs/initContainers, CI, or explicit local runs.

---

## 3. Baseline reconciliation (schema.sql, Docker, docs)

- **Move** `server/schema.sql` → `server/migrations/0001_init.sql` (verbatim). **Delete** `server/schema.sql`.
- **`compose.yaml`:** remove the line mounting `./server/schema.sql` into `/docker-entrypoint-initdb.d/`. Postgres starts empty; the app migrates on first connect. The existing `depends_on: postgres { condition: service_healthy }` already orders startup.
- **`README.md`:** in "Run With PostgreSQL" and related sections, replace the `psql "$DATABASE_URL" -f server/schema.sql` step with a note that the app applies migrations automatically on startup, and that `npm run migrate` runs them explicitly.
- **`docs/deployment.md`:** replace the "Database Schema" `psql -f server/schema.sql` step with the migration story (auto-on-startup; `npm run migrate` or a k8s Job for explicit control).
- **`npm run check`** (`package.json`) currently syntax-checks specific entry points; add `server/migrate.js` and `scripts/migrate.js` to the `--check` list.

---

## 4. Backup / restore + upgrade documentation — `docs/backup-restore.md`

New doc (linked from README), three layers + procedures:

- **App-level (built-in, portable):** the JSON task export/import (`moomora.tasks`) and the library `.md` ZIP export. State clearly what they cover (active tasks/documents) and what they do **not** (archived rows, task↔document links, checklist/activity history, project metadata). Good for portability/migration between instances, **not** a complete backup.
- **Database-level (authoritative backup):** `pg_dump`/`pg_restore` against `DATABASE_URL`, with concrete commands for both Docker Compose (`docker compose exec postgres pg_dump …`) and a k8s pod reading the `moomora-console-db-app` secret. This is the real backup/restore.
- **CloudNativePG:** note that CNPG provides scheduled physical backups and point-in-time recovery at the cluster level; reference its mechanism rather than duplicating it.
- **Upgrade procedure:** the safe sequence — (1) `pg_dump` backup, (2) deploy the new image, (3) migrations auto-apply on startup, (4) verify `/readyz`. **Rollback:** migrations are forward-only, so rolling back = redeploy the previous image **and** restore the pre-upgrade dump (a migration may have changed schema the old code can't read).

---

## Data flow summary

```text
app start (real DB)
  buildApp() → createDb() → runMigrations(db):
     pg_advisory_lock
     ensure schema_migrations
     pending = files − applied            (pendingMigrations, pure)
     for each pending, in a txn: run SQL → record version
     pg_advisory_unlock
  → register routes → listen()

fresh DB     → 0001_init builds everything, recorded
existing DB  → 0001_init is a no-op (if-not-exists), recorded
upgrade      → only new NNNN files run

npm run migrate → same runMigrations(db), then exit
demo (skipDb)  → runner never invoked
```

---

## Build order

1. **Runner + pure tests:** add `connect()` to `server/db.js`; build `server/migrate.js` (`pendingMigrations` + `runMigrations`) with unit tests for the pure function and fake-`db` (with a fake `connect()` client) integration tests for the apply loop, advisory-lock/tracking-table/transaction behaviour, and idempotency.
2. **Baseline:** move `schema.sql` → `server/migrations/0001_init.sql`, delete `schema.sql`.
3. **Startup wiring:** call `runMigrations` in `buildApp()` guarded by `db && !skipDb`; add `scripts/migrate.js` + `npm run migrate`; extend `npm run check`.
4. **Compose + docs:** remove the init-script mount; update README + `docs/deployment.md`; add `docs/backup-restore.md`.

---

## Testing

### Unit (pure) — `tests/backend/migrate.test.js`

- `pendingMigrations`:
  - returns files in numeric-ordinal order (`0002_…` before `0010_…`, not lexical).
  - excludes already-applied versions.
  - ignores non-matching filenames (no leading ordinal, non-`.sql`).
  - empty inputs → empty result.

### Integration (fake `db`) — same file

- A fake `db` whose `connect()` returns a fake client capturing executed SQL + a `schema_migrations` array:
  - first run creates `schema_migrations` and applies all pending files in order, recording each version.
  - second run is a no-op (`schema up to date`).
  - a migration that throws → run rejects, the failing version is **not** recorded, and no later migration runs (and the txn is `rollback`'d).
  - the advisory lock is acquired before and released after on the same client, and `client.release()` is called even on failure (assert via the fake).

### Baseline safety

- Applying `0001_init.sql` twice (simulating an existing DB) does not error and ends recorded exactly once. (Exercised via the runner against a fake `db`, plus the manual Docker smoke below.)

### No regressions

- Full `npm test` stays green; `npm run check` clean (now including `server/migrate.js`, `scripts/migrate.js`).
- The `skipDb` path (demo, fake-repo route tests) never calls the runner — assert `buildApp({ skipDb: true })` does not require a DB.

### Manual smoke (PR)

1. `docker compose up --build` on a **fresh** volume → app logs migrations applied, `/readyz` ready, UI works.
2. Re-run `docker compose up` (existing volume) → `schema up to date`, no errors.
3. Simulate an **existing pre-migration DB**: create a volume seeded with the old schema (no `schema_migrations` table) → first startup runs `0001_init` as a no-op and records it; `/readyz` ready.
4. `npm run migrate` against a running PG applies pending and exits 0.

---

## Risks / notes

- **Transactional migrations exclude `CREATE INDEX CONCURRENTLY`.** Accepted for v1 at this scale; documented. If ever needed, a future enhancement can flag specific files to run outside a transaction.
- **Auto-run-on-startup + advisory lock** is safe at `replicas: 1` and remains correct if scaled; a slow first migration delays `listen()` (acceptable — readiness should reflect "schema applied").
- **Failure mode is fail-closed:** a broken migration stops the app from serving. This is intentional; the upgrade doc tells operators to back up first and how to roll back.
- **The baseline trick relies on `0001_init.sql` being idempotent**, which the current schema already is. Future migrations are *not* required to be idempotent (they run once, tracked) — only the baseline must be, and it is.
- **Demo/dual-write tax persists:** this mechanism covers the real Postgres path only; schema-shape changes still need the in-memory demo repositories updated alongside each future migration.
