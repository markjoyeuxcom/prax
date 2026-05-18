# Import Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add append, skip duplicates, and replace context modes to JSON import.

**Architecture:** Mode validation happens at the API boundary. Duplicate filtering happens in the route using existing repository reads, while destructive context replacement is handled by a repository method. Frontend mode prompting stays isolated in `main.js`, with normalization helpers in `importExport.js`.

**Tech Stack:** Fastify, PostgreSQL, vanilla ES modules, browser file APIs, Node test runner.

---

### Task 1: Frontend Import Mode Helpers

**Files:**
- Modify: `public/js/importExport.js`
- Test: `tests/frontend/importExport.test.js`

- [ ] Write failing tests for `normalizeImportMode()` accepting skip/append/replace and rejecting invalid input.
- [ ] Write a failing test for `duplicateKeyForTask()` normalizing title, context, status, and due date.
- [ ] Run `npm test` and confirm failures.
- [ ] Implement the helpers.
- [ ] Run `npm test`.

### Task 2: API Helper Mode Payload

**Files:**
- Modify: `public/js/taskApi.js`
- Test: `tests/frontend/taskApi.test.js`

- [ ] Write a failing test that `importTasks()` posts the selected mode.
- [ ] Run `npm test` and confirm failure.
- [ ] Include `mode` in the request body, defaulting to `skip`.
- [ ] Run `npm test`.

### Task 3: Repository Replace Context

**Files:**
- Modify: `server/tasksRepository.js`
- Test: `tests/backend/tasksRepository.test.js`

- [ ] Write a failing test for `buildReplaceContextTasks(context, tasks)` deleting only the selected context and inserting the provided tasks.
- [ ] Run `npm test` and confirm failure.
- [ ] Implement `buildReplaceContextTasks()` and `repository.replaceContextTasks()`.
- [ ] Run `npm test`.

### Task 4: Route Mode Behavior

**Files:**
- Modify: `server/tasksRoutes.js`
- Test: `tests/backend/tasksRoutes.test.js`

- [ ] Write failing tests for default skip mode skipping duplicates, append importing duplicates, replace removing existing context tasks, and invalid mode rejection.
- [ ] Run `npm test` and confirm failures.
- [ ] Add mode validation, duplicate filtering, and replace handling.
- [ ] Run `npm test`.

### Task 5: UI Wiring

**Files:**
- Modify: `public/js/main.js`

- [ ] Prompt for import mode before opening the file picker.
- [ ] Require `REPLACE` confirmation for replace mode.
- [ ] Pass mode into `importTasks()` and alert imported/skipped counts.
- [ ] Run `npm test` and `npm run check`.

### Task 6: Browser Smoke

**Files:**
- No source changes expected.

- [ ] Restart the fixture server with mode-aware import methods.
- [ ] Verify duplicate import in skip mode imports 0 and skips 1.
- [ ] Verify append mode imports a duplicate.
- [ ] Verify replace mode leaves only imported context tasks.
- [ ] Run final verification: `npm test`, `npm run check`, and `npm audit --omit=dev`.
