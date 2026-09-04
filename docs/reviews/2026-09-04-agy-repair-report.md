# Repair Report: Calendar, Tasks, Import & Reporting (Agy)

Date: 2026-09-04
Pane: Agy (`pane-af6777ce-e666-4b9a-8b5e-90e9ce26dfed`)
Scope: `server/googleCalendar*.js`, `server/tasksRoutes.js`, `server/tasksRepository.js`, `server/weeklyReview.js`, migration `0024_add_task_import_sessions.sql`, and relevant tests.

---

## Implemented

1. **C11: Large Task Portable Import & Staged Chunked Import Sessions**
   - Configured `bodyLimit: 50 * 1024 * 1024` on `POST /api/tasks/import` to permit large batch imports without HTTP 413.
   - Added migration `server/migrations/0024_add_task_import_sessions.sql` creating `task_import_sessions` (with `chunk_count` tracking) and `task_import_session_chunks` (with chunk index, hash, task count, and staging payloads).
   - Implemented staged chunked import endpoints in `server/tasksRoutes.js` and repository methods in `server/tasksRepository.js`:
     - `POST /api/tasks/import-sessions`: initiates a session (`open`) or replays a committed session.
     - `GET /api/tasks/import-sessions/:requestId`: inspects session status, timestamps, and chunk metadata.
     - `PUT /api/tasks/import-sessions/:requestId/chunks/:index`: validates/normalizes task payload, persists staged chunk in SQLite; on retry or committed session replay, returns HTTP 200 if chunk hash matches, or HTTP 409 Conflict if payload changed or chunk index is new.
     - `POST /api/tasks/import-sessions/:requestId/commit`: atomically imports all staged chunks within a single SQLite transaction, records durable receipt in `task_import_operations`, sets session to `committed`, clears heavy staging payloads while keeping compact chunk hash manifest for deterministic replay validation, and validates exact chunk count and contiguous indices (no gaps).
     - `DELETE /api/tasks/import-sessions/:requestId`: cancels open sessions and drops staged chunks; rejects cancellation of already-committed sessions with HTTP 409 Conflict so operation receipts are never erased.
2. **C12: Slow-Push Queue Drain Loop**
   - In `server/googleCalendarSync.js`, wrapped queue draining in a continuous asynchronous loop (`while (pending.size > 0 || bulkRequested)`), ensuring tasks queued while an in-flight push is active are not stranded.
   - Updated `flush()` to wait for active drain cycles and return the cumulative drain summary.
3. **C13: Request-ID Import Notifications**
   - In `server/tasksRoutes.js`, added `notifyCalendarBulk()` to `POST /api/tasks/import` and chunked `commitImportSession` on new commits (`!result.replayed`), while suppressing notifications on idempotent replays.
4. **C14: Google All-Day Event Exclusive End Date**
   - In `server/googleCalendar.js`, updated `taskToGoogleEvent` so date-only tasks emit `end: { date: nextDay(task.dueDate) }` (strictly the next calendar day), conforming to Google Calendar API / RFC 5545 specifications.
   - Added `nextDay` date helper.
5. **C17: OAuth Callback HTML Escaping**
   - In `server/googleCalendarRoutes.js`, added `escapeHtml` utility and sanitized `title` and `detail` parameters in `page(...)` HTML output to prevent raw HTML reflection / XSS.
6. **C18: Historical Completion Reporting**
   - In `server/weeklyReview.js`, updated the shipped calculation in `compileWeeklyReview` to inspect `task_activity` completion events (`Status → completed` or creation-as-completed) occurring strictly within the review week.
   - Preserved fallback for tasks created completed during the week, while preventing task notes or label edits from erroneously pulling historic completed tasks into current review shipped stats.
7. **Claude L1: Literal Task Query Wildcard Handling**
   - In `server/tasksRepository.js`, escaped `%` and `_` characters in `listTasks` query parameters and appended `escape '\\'` to the SQL LIKE clauses.
8. **Claude L2: Strict & Normalized Timestamp Contract**
   - In `server/tasksRoutes.js`, added strict ISO timestamp validation regex and normalization helper (`normalizeIsoTimestamp`), rejecting loose or non-ISO timestamp strings (e.g. `'1'`, `'2024'`) with HTTP 400 in both task imports and task patches.

---

## Tested

- **Automated Regression Suite (`tests/backend/reviewFixesRegression.test.js`)**:
  - `C14: taskToGoogleEvent emits next-day exclusive end date for all-day events` (PASS)
  - `C17: OAuth callback HTML response escapes query/provider parameters` (PASS)
  - `C12: slow push queue drains work queued during an active push` (PASS)
  - `C13: requestId import notifies calendar reconciliation on commit but not replay` (PASS)
  - `C11: large task import payload (> 1MB) does not fail with HTTP 413` (PASS)
  - `C11: staged chunked import sessions (>5000 tasks across chunks, atomic commit, replay verification, hash manifest)` (PASS)
  - `C11: staged import error cases (gap rejection, open conflict, open cancellation)` (PASS)
  - `C18: weekly review shipped ignores notes-edit timestamp of old completed tasks` (PASS)
  - `L1: task search treats % and _ as literal characters` (PASS)
  - `L2: strict and normalized timestamp contract` (PASS)
- **Targeted Unit Suites**:
  - `tests/backend/googleCalendar.test.js` (12 / 12 passed)
  - `tests/backend/tasksRepository.test.js` (39 / 39 passed)
  - `tests/backend/tasksRoutes.test.js` (77 / 77 passed)
  - `tests/backend/weeklyReview.test.js` (4 / 4 passed)
- **Full Project Quality Invariants**:
  - `npm run check`: 0 errors across all codebase entry points.
  - `npm test`: 1822 / 1822 tests passed across the entire project suite.

---

## Unable to test

- **Live Google Calendar API**: Verification was performed against local HTTP stub harnesses and unit contracts; live network interaction with Google OAuth and Calendar endpoints requires external network access and real credentials outside the test environment.
- **Extreme Browser Memory Pressure**: In-flight browser payload boundaries were verified up to multi-megabyte payloads and >5000 staged chunked task imports; multi-gigabyte continuous browser sessions were not simulated.
