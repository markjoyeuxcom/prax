# Archive Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore archived tasks from the Archive detail panel.

**Architecture:** Add a focused restore API endpoint and repository method, then expose the action through the existing task detail renderer. Frontend state stays simple by reloading the Archive task list after restore.

**Tech Stack:** Fastify, PostgreSQL, vanilla ES modules, Node test runner.

---

### Task 1: Repository Restore

**Files:**
- Modify: `server/tasksRepository.js`
- Test: `tests/backend/tasksRepository.test.js`

- [ ] Write a failing test for `buildRestoreTask(id)` returning parameterized SQL that clears `archived_at`, updates `updated_at`, filters by archived rows, and returns the row.
- [ ] Run `npm test` and confirm the test fails because `buildRestoreTask` is not exported.
- [ ] Implement `buildRestoreTask(id)` and `repository.restoreTask(id)`.
- [ ] Run `npm test` and confirm repository tests pass.

### Task 2: Restore Route

**Files:**
- Modify: `server/tasksRoutes.js`
- Test: `tests/backend/tasksRoutes.test.js`

- [ ] Write failing tests for `PATCH /api/tasks/:id/restore` success, malformed UUID rejection, and unknown task `404`.
- [ ] Run `npm test` and confirm the tests fail because the route is missing.
- [ ] Register `PATCH /api/tasks/:id/restore` before `PATCH /api/tasks/:id`.
- [ ] Run `npm test` and confirm route tests pass.

### Task 3: Frontend API Helper

**Files:**
- Modify: `public/js/taskApi.js`
- Test: `tests/frontend/taskApi.test.js`

- [ ] Write a failing test for `restoreTask(id)` sending `PATCH /api/tasks/:id/restore`.
- [ ] Run `npm test` and confirm the test fails because `restoreTask` is missing.
- [ ] Implement `restoreTask(id)` with existing error-handling style.
- [ ] Run `npm test` and confirm API tests pass.

### Task 4: Detail Restore Button

**Files:**
- Modify: `public/js/renderTaskDetail.js`
- Test: `tests/frontend/renderTaskDetail.test.js`

- [ ] Write failing tests that Archive detail can render a Restore button and still hides Edit/Archive.
- [ ] Run `npm test` and confirm the tests fail because the option is not implemented.
- [ ] Add a `restoreAction` option to `renderTaskDetailHtml`.
- [ ] Run `npm test` and confirm detail tests pass.

### Task 5: UI Wiring

**Files:**
- Modify: `public/js/main.js`

- [ ] Import `restoreTask`.
- [ ] Pass `restoreAction: isArchiveView(state.activeView)` to task detail rendering.
- [ ] Bind `data-action="restore-task"` to confirm, call `restoreTask`, and reload Archive tasks.
- [ ] Run `npm test` and `npm run check`.

### Task 6: Browser Smoke

**Files:**
- No source changes expected.

- [ ] Restart or reuse the local fixture server with an archived task.
- [ ] Open `http://127.0.0.1:3100/`, switch to Archive, and confirm Restore appears.
- [ ] Restore the archived task and verify Archive becomes empty for the current context.
- [ ] Verify the task appears in an active view after leaving Archive.
- [ ] Run final verification: `npm test`, `npm run check`, and `npm audit --omit=dev`.
