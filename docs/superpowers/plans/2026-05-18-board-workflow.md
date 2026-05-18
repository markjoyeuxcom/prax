# Board Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag/drop board movement with persisted task status and ordering.

**Architecture:** Keep drag/drop calculation in a pure frontend helper, render board markup with stable data hooks, and persist moves through a small batch reorder API. The backend validates payloads at the route boundary and delegates SQL generation to the repository.

**Tech Stack:** Fastify, PostgreSQL, vanilla ES modules, native HTML drag/drop, Node test runner.

---

### Task 1: Board Move Helper

**Files:**
- Create: `public/js/boardWorkflow.js`
- Test: `tests/frontend/boardWorkflow.test.js`

- [ ] Write failing tests for moving a task between columns, inserting before another task, and returning no updates for missing task ids.
- [ ] Run `npm test` and confirm the new tests fail because `boardWorkflow.js` does not exist.
- [ ] Implement `moveTaskOnBoard(tasks, move)` to return `{ tasks, updates }` with contiguous `sortOrder` values per status column.
- [ ] Run `npm test` and confirm the helper tests pass.

### Task 2: Board Markup Hooks

**Files:**
- Modify: `public/js/renderBoard.js`
- Test: `tests/frontend/renderBoard.test.js`

- [ ] Write a failing test that board cards render `draggable="true"` plus `data-board-card`, and each card lane renders `data-board-column`.
- [ ] Run `npm test` and confirm the test fails on missing attributes.
- [ ] Add the drag/drop data hooks without changing the visual layout.
- [ ] Run `npm test` and confirm the render tests pass.

### Task 3: Reorder API Helper

**Files:**
- Modify: `public/js/taskApi.js`
- Test: `tests/frontend/taskApi.test.js`

- [ ] Write a failing test for `reorderTasks([{ id, status, sortOrder }])` sending `PATCH /api/tasks/reorder`.
- [ ] Run `npm test` and confirm the test fails because `reorderTasks` is missing.
- [ ] Implement the helper with JSON headers and error handling.
- [ ] Run `npm test` and confirm the API helper tests pass.

### Task 4: Backend Batch Reorder

**Files:**
- Modify: `server/tasksRepository.js`
- Modify: `server/tasksRoutes.js`
- Test: `tests/backend/tasksRepository.test.js`
- Test: `tests/backend/tasksRoutes.test.js`

- [ ] Write failing tests for the repository reorder query and the route accepting valid reorder payloads.
- [ ] Write failing tests for invalid payload shape, invalid ids, invalid status, and invalid sort order.
- [ ] Run `npm test` and confirm the new tests fail because reorder support is missing.
- [ ] Add `buildReorderTasks(updates)` and `repository.reorderTasks(updates)`.
- [ ] Register `PATCH /api/tasks/reorder` before `PATCH /api/tasks/:id`.
- [ ] Run `npm test` and confirm backend tests pass.

### Task 5: UI Drag/Drop Wiring

**Files:**
- Modify: `public/js/main.js`
- Modify: `public/styles.css`

- [ ] Add `bindBoardEvents()` in `main.js` for dragstart, dragend, dragover, dragleave, and drop.
- [ ] On drop, call `moveTaskOnBoard`, optimistically update state, call `reorderTasks`, and reload tasks.
- [ ] Add drop target and dragging styles in `public/styles.css`.
- [ ] Run `npm test` and `npm run check`.

### Task 6: Browser Smoke

**Files:**
- No source changes expected.

- [ ] Restart the local fixture server with UUID task ids.
- [ ] Open `http://127.0.0.1:3100/`.
- [ ] Move a board card into another column.
- [ ] Confirm the card appears in the new column, remains selected, and the API server accepts the reorder call.
- [ ] Run final verification: `npm test`, `npm run check`, and `npm audit --omit=dev`.
