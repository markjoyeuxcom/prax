# Prax Desktop — Engineering Prompt (Tauri + embedded SQLite)

A paste-ready prompt for turning the approved design into a real local desktop app.
Chosen stack: **Tauri** (light webview shell) + **Node/Fastify sidecar** + **embedded
SQLite** (in-process, single file, lowest memory, no separate DB process).

**Sequencing:** run the design brief first, drop the new frontend into `public/`, then
hand this over. This prompt treats the frontend as a static bundle served by Fastify, so
the new design slots in without touching the desktop wrapper.

**Tradeoff accepted:** the wrapper is simple, but the backend data layer needs a real
rewrite because every repository, migration, and the full-text + pgvector search paths
are written in Postgres dialect. The prompt keeps the HTTP API, routes, MCP server, and
CLI stable while swapping the storage engine underneath. The `tests/` suite (especially
`tests/contract/`) is the acceptance gate.

---

You are a senior engineer. Turn an existing web app into a polished, local desktop
application for macOS and Windows using Tauri, backed by an embedded SQLite database.
The goal is a "double-click to run" app with zero external dependencies — no database
install, no Docker, no terminal, no separate DB process.

## Current architecture (what exists today)

- **Backend:** Node.js + Fastify (`server/`). Assembled in `server/index.js` via
  `buildApp()`, heavily dependency-injected. Serves a static frontend from `public/`.
- **Database:** PostgreSQL via the `pg` Pool (`server/db.js`), configured by a
  `DATABASE_URL` env var (`server/config.js`). `db.js` exposes `query(text, params)`
  returning `{ rows }`, plus `connect()`, `checkReady()`, `close()`.
- **Schema:** SQL migrations in `server/migrations/` (0001–0007), run on startup via
  `runMigrations()`. Uses Postgres features: `tsvector`/full-text search, the **pgvector**
  extension for embeddings (`0005_add_embeddings.sql`), likely `RETURNING`, `ILIKE`,
  array/JSON columns, `gen_random_uuid()`/`now()`, `$1` placeholders.
- **Semantic search (optional):** embeddings in Postgres+pgvector, gated by
  `EMBEDDING_BACKEND` (`none`/`ollama`/`openai`/`fake`). Falls back to keyword search when
  `none`.
- **Frontend:** vanilla-JS SPA in `public/` (a new visual design is being produced
  separately and will replace it; assume it stays a static bundle hitting the same API).
- **Other surfaces that must keep working unchanged:** an MCP server (`mcp/`) and a
  `prax` CLI (`cli/`), both talking to the Fastify HTTP API. They don't touch the DB
  directly, so preserving the HTTP API keeps them working.
- **Security:** no auth by design (single-user, localhost only).
- **Tests:** extensive suite under `tests/` (`npm test`), including `tests/contract/`
  that locks export/MCP shapes.

## Target architecture

- Wrap the app as a **Tauri** desktop application. The Tauri window hosts a **webview**
  pointed at the local Fastify server started as a managed **sidecar/child process**. Do
  NOT rewrite the frontend as Tauri-native — keep serving the existing static frontend
  from Fastify so the web app, MCP server, and CLI share one backend.
- Replace PostgreSQL with **embedded SQLite** running IN-PROCESS inside the Node backend
  (no child DB process). SQLite becomes the single database for the whole app — remove the
  Postgres dependency entirely.

## The data-layer rewrite (the main work — keep interfaces stable, swap the engine)

Keep the **route layer and repository public interfaces unchanged**. Rewrite only the
storage internals:

1. **Driver:** use `better-sqlite3` (synchronous, fast, standard for Node desktop). If you
   want to avoid native-module compilation across platforms, evaluate Node's built-in
   `node:sqlite` as an alternative and recommend one. Enable WAL mode and foreign keys.
2. **`server/db.js`:** reimplement the same shape (`query(text, params)` → `{ rows }`,
   `checkReady()`, `close()`) as a thin adapter over the SQLite driver, so repositories and
   `readyz`/`healthz` need minimal changes. Where the pg `{ rows }` contract can't map
   cleanly (e.g. `RETURNING`, multi-statement), adjust the small number of call sites.
3. **Migrations:** rewrite `server/migrations/*.sql` as SQLite-compatible schema (a fresh
   consolidated schema is fine — this is a greenfield local DB, no Postgres data to
   migrate). Keep a simple migration runner for future changes.
4. **Port the SQL dialect** in each repository. Known gotchas to handle explicitly:
   - `$1, $2` placeholders → `?` (or named params).
   - `RETURNING` — supported in modern SQLite (3.35+); verify the bundled version.
   - `ILIKE` → `LIKE` (SQLite LIKE is case-insensitive for ASCII by default; use `COLLATE
     NOCASE` where needed).
   - `gen_random_uuid()` / `now()` → generate UUIDs and timestamps in JS, or SQLite
     equivalents (`CURRENT_TIMESTAMP`).
   - Postgres array/JSON columns (e.g. tags) → store as JSON text and use SQLite JSON1
     functions, or a join table — pick one and be consistent.
   - Boolean/date types → SQLite has no native ones; normalize at the repository boundary
     so route/JSON output shapes stay identical.
5. **Full-text search:** replace Postgres `tsvector` full-text search with **SQLite FTS5**
   (virtual table + triggers to keep it in sync). Preserve the existing search API shape.

## Semantic search (phased)

- **Phase 1 (launch):** Ship with `EMBEDDING_BACKEND=none` and full keyword/FTS5 search
  working. Semantic search shows as unavailable; nothing crashes when embeddings aren't
  configured.
- **Phase 2 (optional):** Add vector search via the **`sqlite-vec`** loadable extension
  (bundle the platform-specific extension, load it via the driver's `loadExtension`).
  Reimplement the embedding storage/query paths against `sqlite-vec` and re-enable the
  feature when a local embedding backend (e.g. Ollama) is configured. Treat as follow-up,
  not a launch blocker.

## Runtime lifecycle (simpler than a DB server)

On launch:
1. Resolve a data dir: macOS `~/Library/Application Support/Prax/`, Windows
   `%APPDATA%\Prax\`. Store `prax.db` (+ `-wal`/`-shm`) and logs there.
2. Start the Fastify server as a sidecar bound to `127.0.0.1` on a free port, pointed at
   that SQLite file. Run migrations on boot (existing behavior).
3. Point the Tauri webview at the app URL once `/readyz` is ready (poll it).

On quit: gracefully stop the sidecar; ensure SQLite checkpoints/closes cleanly (WAL).
Handle single-instance locking so two windows don't open the same DB file unsafely.

## Packaging & distribution

- Tauri bundler → `.dmg`/`.app` (macOS) and `.msi`/`.exe` (Windows).
- Bundle the Node runtime (or a compiled server binary), the Fastify server + static
  frontend, and — if using `better-sqlite3` — the correct **prebuilt native binary per
  platform** (resolve via Tauri resource paths, not dev paths). Note native-module
  rebuild/prebuild steps in CI.
- App metadata (name "Prax", icon, version from `package.json`), code
  signing/notarization hooks (macOS + Windows), optional Tauri auto-updater.

## Constraints & things not to break

- Do NOT change the HTTP API shapes, the export/import formats (`moomora.tasks` JSON,
  library `.md` front-matter), or the MCP tool surface — they're the durable integration
  points, and the MCP server + CLI depend on them.
- Server binds to localhost only; no auth needed.
- Update the test suite to run against SQLite and keep `npm test` + `tests/contract/`
  green. This is the acceptance bar for the data-layer rewrite: same tests, new engine.
- Keep a plain web-server dev workflow working (the desktop wrapper is additive).

## Deliverables

1. Backend migrated to embedded SQLite: new `db.js` adapter, SQLite migrations, ported
   repository SQL, FTS5 search — with the full existing test suite passing.
2. A working Tauri app that boots the SQLite-backed Fastify sidecar and shows the app in a
   native window on macOS and Windows, with clean lifecycle + logs under the data dir.
3. Graceful semantic-search degradation without `sqlite-vec` (Phase 1), plus a documented
   Phase 2 plan for `sqlite-vec`.
4. Installers for both platforms + a BUILD/RELEASE doc: how to build/sign/release, where
   user data lives, and backup/restore (copy `prax.db` or use the existing JSON/.md
   export).
5. A short architecture note on the SQLite migration decisions (driver, JSON-vs-join for
   arrays, FTS5 design, timestamp/boolean normalization).

Prioritize behavioral parity (same API, same test results) and a reliable "it just
launches" experience. Ask me before changing any HTTP API or data format.
