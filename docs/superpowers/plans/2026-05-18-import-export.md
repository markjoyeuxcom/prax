# Import Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add context-level JSON export and append-only JSON import.

**Architecture:** Export reuses repository list filtering with `archived=all`. Import validates at the route boundary and batch-inserts sanitized task fields through the repository. Frontend helpers keep file parsing/download behavior isolated from `main.js`.

**Tech Stack:** Fastify, PostgreSQL, vanilla ES modules, browser FileReader/Blob APIs, Node test runner.

---

### Task 1: Import Export Helpers

**Files:**
- Create: `public/js/importExport.js`
- Test: `tests/frontend/importExport.test.js`

- [ ] Write failing tests for extracting tasks from an exported envelope, extracting tasks from a raw array, and building a stable filename.
- [ ] Run `npm test` and confirm the helper module is missing.
- [ ] Implement `tasksFromImportPayload(payload)` and `exportFilename(context, date)`.
- [ ] Run `npm test` and confirm helper tests pass.

### Task 2: Frontend API Helpers

**Files:**
- Modify: `public/js/taskApi.js`
- Test: `tests/frontend/taskApi.test.js`

- [ ] Write failing tests for `exportTasks({ context })` and `importTasks({ context, tasks })`.
- [ ] Run `npm test` and confirm the helpers are missing.
- [ ] Implement the helpers with existing fetch error style.
- [ ] Run `npm test` and confirm frontend API tests pass.

### Task 3: Backend Repository Import

**Files:**
- Modify: `server/tasksRepository.js`
- Test: `tests/backend/tasksRepository.test.js`

- [ ] Write failing tests for `buildImportTasks(tasks)` SQL and empty import rejection.
- [ ] Run `npm test` and confirm `buildImportTasks` is missing.
- [ ] Implement `buildImportTasks(tasks)` and `repository.importTasks(tasks)`.
- [ ] Run `npm test` and confirm repository tests pass.

### Task 4: Backend Routes

**Files:**
- Modify: `server/tasksRoutes.js`
- Test: `tests/backend/tasksRoutes.test.js`

- [ ] Write failing tests for export shape, import success, invalid context, invalid task payload, and empty tasks.
- [ ] Run `npm test` and confirm routes are missing.
- [ ] Add `GET /api/tasks/export` and `POST /api/tasks/import`.
- [ ] Run `npm test` and confirm route tests pass.

### Task 5: UI Wiring

**Files:**
- Modify: `public/js/main.js`

- [ ] Bind Export to call `exportTasks`, create a JSON blob, and trigger a download.
- [ ] Bind Import to open a JSON file input, parse the selected file, call `importTasks`, then reload tasks.
- [ ] Run `npm test` and `npm run check`.

### Task 6: Browser Smoke

**Files:**
- No source changes expected.

- [ ] Restart the local fixture server with import/export repository methods.
- [ ] Open `http://127.0.0.1:3100/`.
- [ ] Verify export API returns a versioned JSON envelope for Homelab.
- [ ] Import a small JSON task payload and verify the task appears in the active list.
- [ ] Run final verification: `npm test`, `npm run check`, and `npm audit --omit=dev`.
