# Admin Operations Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a professional Admin panel for import, export, and backup operations.

**Architecture:** The shell exposes one Admin action while the modal renderer owns the operational UI. Existing API helpers stay thin, with all-context backup support added to the existing export route. `main.js` wires modal state and keeps destructive import confirmation on the client before calling the existing import endpoint.

**Tech Stack:** Fastify, PostgreSQL repository abstraction, vanilla ES modules, browser file APIs, Node test runner.

---

### Task 1: Shell and Modal Rendering

**Files:**
- Create: `public/js/renderAdminPanel.js`
- Modify: `public/js/renderShell.js`
- Modify: `public/styles.css`
- Test: `tests/frontend/renderAdminPanel.test.js`
- Test: `tests/frontend/renderShell.test.js`

- [ ] Write a failing render test that the shell has `data-action="open-admin"` and no longer has topbar import/export actions.
- [ ] Write a failing render test for Admin panel sections and controls: backup exports, import mode radios, replace confirmation, file input, and archive maintenance.
- [ ] Run `npm test tests/frontend/renderShell.test.js tests/frontend/renderAdminPanel.test.js` and confirm failures.
- [ ] Implement `renderAdminPanelHtml()` and shell action changes.
- [ ] Add modal CSS matching existing task-form modal conventions.
- [ ] Run the focused frontend render tests.

### Task 2: All-Context Export API

**Files:**
- Modify: `server/tasksRoutes.js`
- Test: `tests/backend/tasksRoutes.test.js`

- [ ] Write a failing route test for `GET /api/tasks/export?context=all`.
- [ ] Run `npm test tests/backend/tasksRoutes.test.js` and confirm failure.
- [ ] Update export validation to accept `all`, call `repository.listTasks({ archived: 'all' })`, and return `context: 'all'`.
- [ ] Run the focused backend route test.

### Task 3: Frontend Admin Wiring

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`
- Modify: `public/js/taskApi.js`
- Test: `tests/frontend/taskApi.test.js`

- [ ] Write a focused helper test that `exportTasks({ context: 'all' })` requests `/api/tasks/export?context=all`.
- [ ] Run `npm test tests/frontend/taskApi.test.js` and confirm behavior.
- [ ] Add `isAdminPanelOpen` to state.
- [ ] Render Admin panel from `main.js` when open.
- [ ] Wire export selected context, export all contexts, close Admin, import mode controls, replace confirmation, and JSON file import.
- [ ] Run `npm test` and `npm run check`.

### Task 4: Browser Verification and Commit

**Files:**
- No source changes expected.

- [ ] Restart the fixture server on `127.0.0.1:3100`.
- [ ] Open the app in the in-app browser.
- [ ] Confirm the topbar shows `Admin` and `New Task`.
- [ ] Open Admin and verify Backup, Restore / Import, and Archive Maintenance controls render.
- [ ] Run final verification: `npm test`, `npm run check`, and `npm audit --omit=dev`.
- [ ] Commit the implementation.
