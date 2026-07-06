# Moomora Desktop — Phased Task Checklist

Execution plan for shipping Moomora as a local desktop app (Tauri + embedded SQLite).
Work top to bottom; each phase has a clear exit gate. See [`README.md`](README.md) for the
decisions behind this and the two prompts (`design-brief.md`, `engineering-prompt.md`).

---

## Phase 0 — Design (do first)

- [ ] Run `design-brief.md` through the design tool; get mockups + design system.
- [ ] Review the direction; pick the theme/personality.
- [ ] Confirm the new design keeps every screen the current app has (tasks list/board,
      task detail drawer, library browser, editor split-mode, semantic search, settings).

**Exit gate:** an approved visual design covering all core screens (light + dark).

## Phase 1 — Frontend implementation

- [ ] Implement the approved design in `public/` (keep it a static bundle hitting the
      same HTTP API — no API shape changes).
- [ ] Preserve keyboard shortcuts + add a command palette if the design calls for one.
- [ ] Verify against the running web server (`npm run demo` / `npm start`) before touching
      the backend.

**Exit gate:** the redesigned UI runs against the existing Postgres backend with no API
changes; existing frontend tests pass.

## Phase 2 — Data-layer rewrite (Postgres → embedded SQLite)

The heaviest phase. Keep route + repository public interfaces stable; swap internals.

- [ ] Pick the driver: `better-sqlite3` vs built-in `node:sqlite` (decide + document why).
- [ ] Reimplement `server/db.js` as a SQLite adapter matching the current shape
      (`query(text, params)` → `{ rows }`, `checkReady()`, `close()`); enable WAL + FKs.
- [ ] Rewrite `server/migrations/*.sql` (0001–0007) as a SQLite-compatible schema
      (fresh consolidated schema is fine — greenfield local DB).
- [ ] Port SQL dialect in every repository:
  - [ ] `$1` placeholders → `?`
  - [ ] `RETURNING` (verify SQLite ≥ 3.35)
  - [ ] `ILIKE` → `LIKE` / `COLLATE NOCASE`
  - [ ] `gen_random_uuid()` / `now()` → JS-generated or SQLite equivalents
  - [ ] array/JSON columns (tags) → JSON text (JSON1) or join table (pick one)
  - [ ] boolean/date normalization at the repository boundary (keep JSON output identical)
- [ ] Replace `tsvector` full-text search with **FTS5** (virtual table + sync triggers);
      preserve the search API shape.
- [ ] Remove the `pg` dependency and Postgres-only config.
- [ ] Point the whole test suite at SQLite.

**Exit gate:** `npm test` and `tests/contract/` are green against SQLite; HTTP API and
export/import formats byte-for-byte unchanged. MCP server + CLI still work against the API.

## Phase 3 — Tauri desktop wrapper

- [ ] Scaffold the Tauri project (Rust shell, `tauri.conf.json`).
- [ ] Bundle the Fastify server (Node runtime or compiled binary) + `public/` as resources.
- [ ] Start the server as a managed sidecar on `127.0.0.1` + free port; resolve the
      SQLite file under the OS app-data dir (macOS `~/Library/Application Support/Moomora/`,
      Windows `%APPDATA%\Moomora\`).
- [ ] Point the webview at the app URL once `/readyz` is ready (poll it).
- [ ] Lifecycle: graceful shutdown (checkpoint/close WAL), single-instance lock, stale-lock
      recovery, port-in-use handling; write logs under the data dir.

**Exit gate:** double-click launch on macOS and Windows opens a native window showing the
app, data persists across restarts, clean start/stop.

## Phase 4 — Packaging & distribution

- [ ] Tauri bundler → `.dmg`/`.app` (macOS), `.msi`/`.exe` (Windows).
- [ ] If `better-sqlite3`: bundle the correct prebuilt native binary per platform;
      document the CI rebuild/prebuild step.
- [ ] App metadata: name "Moomora", icon, version synced from `package.json`.
- [ ] Code signing + notarization (macOS) and signing (Windows) — unsigned dev builds OK
      to start.
- [ ] (Optional) Tauri auto-updater.
- [ ] BUILD/RELEASE doc: build/sign/release steps, where user data lives, backup/restore
      (copy `moomora.db` or use JSON/`.md` export).

**Exit gate:** installers build for both platforms; a fresh install runs with no external
dependencies.

## Phase 5 — Semantic search (optional follow-up)

- [ ] Phase 1 default: `EMBEDDING_BACKEND=none`; semantic search shows unavailable, no
      crashes without the vector extension.
- [ ] Add the **`sqlite-vec`** loadable extension (bundle per platform; load via the
      driver's `loadExtension`).
- [ ] Reimplement embedding storage/query against `sqlite-vec`; re-enable when a local
      embedding backend (e.g. Ollama) is configured.
- [ ] Add/port the semantic-search tests.

**Exit gate:** semantic search works end-to-end in a packaged build with a local embedding
backend, and degrades cleanly without one.

---

## Cross-cutting guardrails (every phase)

- Never change HTTP API shapes, `moomora.tasks` JSON, or library `.md` front-matter — the
  MCP server and CLI depend on them.
- Server binds to localhost only; no auth.
- Keep the plain web-server dev workflow working (the desktop wrapper is additive).
- `tests/contract/` is the regression net for the rewrite — keep it green.
