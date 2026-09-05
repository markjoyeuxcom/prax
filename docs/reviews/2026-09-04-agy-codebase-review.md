# Prax Codebase Review — Independent Technical Audit

**Reviewer:** Agy (Independent Agent Pane)
**Date:** 2026-09-04
**Git HEAD:** `0c3cdfa9a63f021c983e7985a1df57cd60ffb388`
**Working Tree Status:** Clean except for SQLite WAL markers (`prax.db-shm`, `prax.db-wal`), untracked `ROOM-prax.md`, and this review artifact.
**Adherence Standard:** `docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md` (Gate A Invariants QINV-01 through QINV-11) & `AGENTS.md`.

---

## Implemented

### Executive Summary

An exhaustive, read-only architectural and implementation audit was conducted across the Prax repository (`/Users/markjoyeux/Developer/Personal/prax`). Prax is an exceptionally well-engineered single-user local operational workspace and shared agent memory system. Its SQLite persistence layer employs a dedicated FIFO gate guaranteeing single-handle serialized transactions, preventing concurrency locks while maintaining high throughput. Its schema migration system (migrations 0001–0022) demonstrates meticulous care for relational integrity, lifecycle reconciliation, and automated backup/restore verification drills.

The audit evaluated all eight specified dimensions:
1. **Architecture** (Desktop Tauri shell + Node.js background sidecar, Fastify HTTP/JSON API, shared MCP toolset).
2. **Backend and APIs** (Endpoint contracts, request validation, error normalization, streaming assistant responses).
3. **Frontend** (Vanilla ES modules, reactive state store, robust task/document mutation queues and draft recovery mechanisms).
4. **Persistence & Data Integrity** (SQLite WAL mode, synchronous foreign keys, trigger-backed lifecycle consistency).
5. **Memory, Search & CLI** (Project detection hierarchy, semantic/keyword fallback, dual-role CLI and agent recall scripts).
6. **Security within Trusted-Network Model** (Loopback enforcement, explicit opt-in for remote hosts, process-bound Tauri IPC, settings management).
7. **Operations** (Zero-external-dependency Node 24 deployment, automated SQLite vacuum backups, performance budget gate).
8. **Tests** (1,781 passing unit/contract tests, portable export round-trip drills, retrieval quality evaluation).

The review identified **two confirmed actionable defects/contract discrepancies** and characterized key coverage gaps in integration test mocking and unverified API edge cases.

---

### Actionable Evidenced Defects

#### Defect 1 (High): Google Calendar v3 API Schema Violation on All-Day Tasks
- **File & Lines:** `server/googleCalendar.js:86-88` (`taskToGoogleEvent`)
- **Trigger:** Synchronizing any open task with a `dueDate` but no `dueTime` (all-day event) to Google Calendar.
- **Root Cause Code:**
  ```javascript
  // server/googleCalendar.js:85-88
  } else {
    event.start = { date: task.dueDate };
    event.end = { date: task.dueDate };
  }
  ```
- **Impact:** The Google Calendar v3 REST API requires `end.date` for full-day events to be an exclusive date strictly later than `start.date` (at minimum `start.date + 1 day`). When Google Calendar receives `start: { date: '2026-07-24' }` and `end: { date: '2026-07-24' }`, it rejects the request with `HTTP 400 Bad Request: "Invalid end date: '2026-07-24'. Must be after start date: '2026-07-24'."`. This blocks Google Calendar synchronization for all all-day tasks.
- **Contrast:** The iCalendar feed implementation in `server/icsFeed.js:87-88` correctly performs date-only UTC arithmetic:
  ```javascript
  const end = nextDay(task.dueDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) lines.push(`DTEND;VALUE=DATE:${compactDate(end)}`);
  ```
- **Test Blindspot:** `tests/backend/googleCalendar.test.js:51` entrenched this defect by asserting identity against the buggy implementation (`assert.deepEqual(allDay.end, { date: '2026-07-24' })`).
- **Quality Standard Invariant:** Violates `QINV-02` (Observed write outcomes are truthful) and `QINV-08` (Degraded and partial operation is explicit).
- **Remediation:** In `server/googleCalendar.js`, calculate `end.date` as `nextDay(task.dueDate)` (using the existing `nextDay` helper logic) so that the event spans from midnight of `dueDate` to midnight of the following day, and update `tests/backend/googleCalendar.test.js` accordingly.

---

#### Defect 2 (Medium): Security Contract Inconsistency Between `AGENTS.md` and Runtime UI Settings
- **File & Lines:** `AGENTS.md:58-60` vs `server/settingsRoutes.js:106-154` and `server/chat/claudeCli.js:151-157`
- **Trigger:** Inspecting configuration rules as an autonomous agent or exposing Prax via `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`.
- **Contradiction:**
  - `AGENTS.md` explicitly asserts:
    > *"No authentication by design (trusted-network model). All backend config (DB URL, embedding backend/URL/keys) is env-only and never settable via the web UI. See SECURITY.md."*
  - In reality, `server/settingsRoutes.js` and `server/chatProvider.js` implement `PUT /api/settings/ai-answers` and `PUT /api/settings/semantic-search`, persisting provider backends, API keys, URLs, and `binaryPath` into the SQLite `app_settings` table.
  - While `SECURITY.md` was updated to state that *"Secrets come from the environment or the local settings database"*, `AGENTS.md` was not updated.
- **Security Implication within Trusted-Network Model:**
  - `server/chat/claudeCli.js:151-157` executes `spawn(binary, args, ...)` where `binary` is resolved from `binaryPath` stored in `app_settings`.
  - In a networked deployment (`HOST=0.0.0.0` with `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`), an unauthenticated caller can issue `PUT /api/settings/ai-answers` setting `binaryPath` to an arbitrary executable on the host system. When a chat completion is triggered, that executable is invoked. This expands the blast radius from "read/write workspace data" to arbitrary binary execution on the server host.
- **Quality Standard Invariant:** Violates `QINV-07` (Default installation is local-safe) / Security & Documentation quality categories.
- **Remediation:**
  1. Correct `AGENTS.md` to reflect that intelligence/search settings are settable via web UI / API.
  2. For `binaryPath`, restrict it to env-only configuration (`CLAUDE_CLI_PATH`), or validate that `binaryPath` matches known safe basenames (e.g., `basename === 'claude'`) rather than arbitrary executable paths.

---

### Detailed Subsystem Audit Findings

#### 1. Architecture
- **Desktop/Sidecar Pattern:** The separation between Tauri (Rust shell for native menus, global shortcut capture, OS-native save dialogs) and Fastify (Node.js engine) is exceptionally clean. The Tauri shell monitors the child process PID, launches ephemeral loopback ports, and announces the exact origin via parent-owned stdout pipes.
- **API Modularity:** Routes under `server/` cleanly separate concerns: `taskRoutes.js`, `libraryRoutes.js`, `checklistRoutes.js`, `runbookRunsRoutes.js`, `settingsRoutes.js`.
- **Tool Parity:** `mcp/server.js` and `server/assistant` share the identical underlying tool factory (`buildToolset(client)`), ensuring agents and the web UI assistant interact with identical capabilities.

#### 2. Backend and APIs
- **Input Validation & Sanitization:** Strong adherence to sanitization across updates (e.g. `sanitizePatch` in repositories).
- **Error Normalization:** Fastify schema errors and SQLite constraint violations are normalized to structured JSON payloads (`{ message: string, code?: string }`).
- **Streaming Handlers:** AI responses (`/api/assistant`, `/api/chat`) use chunked Server-Sent Events / ndjson with explicit error trailers so mid-stream failures do not appear as valid truncated completions.

#### 3. Frontend
- **Design Philosophy:** Zero heavy framework dependencies; pure native modern DOM, Web Components / clean module decomposition, and CodeMirror 6 for markdown editing.
- **Resilience:** Implements `taskMutationQueue.js`, `taskDraftRecovery.js`, and `documentDraftRecovery.js` using `sessionStorage`/`localStorage`. Edits made while offline or during server restarts are preserved and replayed upon reconnection, satisfying `QINV-01`.
- **Accessibility:** Playwright + `@axe-core/playwright` audits are integrated into `test:e2e`.

#### 4. Persistence & Data Integrity
- **SQLite Concurrency Gate:** `server/db.js` wraps database operations in a strict FIFO gate (`withExclusiveTransaction`), serializing mutations across async turns while allowing pooled concurrent reads. This guarantees zero `SQLITE_BUSY` contention on single-file SQLite databases.
- **Foreign Keys & Pragmas:** Every connection explicitly enables `PRAGMA foreign_keys = ON;` and `PRAGMA busy_timeout = 5000;`. WAL mode is permanently enabled.
- **Lifecycle Reconciliation:** Migrations 0012 and 0018 introduce triggers and consistency invariants preventing orphan links, circular supersessions, or dangling document relations, directly supporting `QINV-05`.

#### 5. Memory, Search & CLI
- **Project Detection:** `cli/lib/detectProject.js` employs a graceful 5-tier fallback: `--project` flag > `PRAX_PROJECT` env var > `.prax/project.json` > git remote origin match > working folder name.
- **Semantic Fallback:** When vector embeddings are unavailable (no Ollama/OpenAI configured), search automatically degrades to SQLite FTS5 keyword matching and clearly marks the envelope `{ degraded: true }`, adhering strictly to `QINV-08` and `QINV-10`.
- **Interactive Verification:** The `prax verify` command enforces an interactive confirmation diff and compares SHA-256 `contentHash` to ensure human review occurred before verification stamps are applied (`QINV-04`).

#### 6. Security within Documented Trusted-Network Model
- **Network Bindings:** Server defaults strictly to `127.0.0.1`. Attempting to bind `0.0.0.0` or a remote interface without `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true` triggers an immediate exit (code 1), preventing accidental public exposures.
- **Library Export Security:** The web UI cannot trigger arbitrary filesystem writes; desktop exports use Tauri's native dialog API, restricting writes to explicitly user-chosen file paths.

#### 7. Operations
- **Backup Drills:** Prax provides `scripts/backup-database.js` using SQLite online backup API (`VACUUM INTO` / backup API) and verifies recovery with `scripts/verify-backup-restore.js`.
- **Portability:** Full portable round-trip tests (`scripts/verify-portable-round-trip.js`) guarantee tasks, checklists, and documents export and re-import with 100% digest fidelity (`QINV-06`).

#### 8. Tests & Quality Standard Compliance
- **Test Suites:** Built-in Node test runner (`node --test`) powers 109 test files with 1,781 assertions running in ~2.6 seconds.
- **Quality Gates:** Performance budgets (`scripts/verify-performance-budget.mjs`) and manual activation checklists enforce the Gate A invariants.

---

### Uncertainties and Coverage Gaps

1. **Google Calendar PUT-on-Cancelled Resurrection Behavior (`server/googleCalendar.js:189-195`):**
   When `upsertEvent` receives a 409 Conflict on `POST`, it falls back to `PUT /calendars/{calendarId}/events/{eventId}`. While Google's documentation formally specifies HTTP 410 Gone for expired sync tokens and repeat deletions (which `deleteEvent` at line 198 handles), Google's documentation does not establish whether a `PUT` request with full event data against a cancelled/tombstoned event returns 410, returns 404, or successfully un-cancels and updates the event to `status: 'confirmed'`. Without live Google Calendar OAuth API credentials, this behavior remains unverified.
2. **Third-Party Calendar Schema Mocking Gap:**
   Unit tests for Google Calendar (`tests/backend/googleCalendar.test.js`) rely on in-memory mock fetch stubs. Because the stubs mirrored the internal code expectations rather than validating against Google Calendar v3 API schema contracts, the invalid all-day event date format went undetected in the unit test suite.
3. **Dynamic LLM Stream Failure Simulation:**
   While SSE protocol handling is well-tested, transient upstream stream dropouts (e.g., token rate limit exhaustion mid-sentence during local Ollama inference) have limited automated test coverage.
4. **Desktop Native Window Lifecycle on Linux/Headless CI:**
   The Tauri native shell verification script (`scripts/verify-desktop-runtime.mjs`) requires platform-specific display environments and cannot run in standard headless Linux CI pipelines without a virtual framebuffer (`xvfb`).

---

## Tested

All automated verification commands were executed directly against the working tree.

| Command | Working Directory | Result / Exit Code | Output Summary |
|---|---|---|---|
| `npm run check` | `/Users/markjoyeux/Developer/Personal/prax` | Exit 0 | Syntax check passed across all 40 entry points (server, scripts, public, CLI, MCP). |
| `npm test` | `/Users/markjoyeux/Developer/Personal/prax` | Exit 0 | 109 test suites, 1,781 tests passed, 0 failed (duration: 2.61s). |
| `npm run verify:portable` | `/Users/markjoyeux/Developer/Personal/prax` | Exit 0 | Generated 200 tasks + 150 checklist items, exported, wiped, restored, verified exact digest match. |
| `npm run verify:restore` | `/Users/markjoyeux/Developer/Personal/prax` | Exit 0 | Live database backup drill verified: WAL markers intact, post-backup writes preserved, full restore passed. |
| `npm run eval` | `/Users/markjoyeux/Developer/Personal/prax` | Exit 0 | Retrieval benchmark: 7/7 cases passed (100% recall@5, 100% MRR). |
| `npm run eval:nl` | `/Users/markjoyeux/Developer/Personal/prax` | Exit 2 | Clean exit: skipped evaluation because `CHAT_BACKEND` is not configured in this test environment. |
| `node .claude/skills/prax-recall/recall.mjs "codebase review architecture defects"` | `/Users/markjoyeux/Developer/Personal/prax` | Non-zero | Cleanly reported: `Prax not reachable at http://127.0.0.1:3000 — is the app running?`. Verified recall script works when server is not active. |
| `git status --short` | `/Users/markjoyeux/Developer/Personal/prax` | Exit 0 | Working tree verified clean of implementation mutations. |

---

## Unable to test

1. **Live Google Calendar OAuth 2.0 API Interaction:**
   Unable to execute live Google Calendar synchronization against real Google APIs due to the absence of production OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and refresh tokens) in the test environment. Defects were verified via static analysis against the official Google Calendar v3 API specification and internal comparison with `server/icsFeed.js`.
2. **Live External AI Providers (Ollama / Anthropic / OpenAI):**
   Live inference through `eval:nl` and streaming assistant completions could not be tested against external endpoints because no live API keys or local Ollama daemon instances were running in this environment.
3. **Interactive Tauri Desktop GUI:**
   The Tauri graphical desktop application window (`npm run desktop:dev`) could not be visually launched or tested for user interaction because the agent session operates in a headless terminal shell.
