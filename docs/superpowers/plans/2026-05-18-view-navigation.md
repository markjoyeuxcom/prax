# View Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Today, Board, Backlog, and Archive views functional in the Balanced Operations Console.

**Architecture:** Add pure task view helpers and a board renderer, then wire the existing shell buttons in `main.js`. Keep API behavior simple: active views fetch active tasks, Archive fetches archived tasks.

**Tech Stack:** Native JavaScript modules, Node test runner, Fastify task API, CSS.

---

## Task 1: Add View Helpers

**Files:**
- Create: `public/js/taskViews.js`
- Create: `tests/frontend/taskViews.test.js`

- [ ] Add `tasksForView(tasks, activeView)` for Today/Board passthrough, Backlog planned/no due date, Archive passthrough.
- [ ] Add `isArchiveView(activeView)`.
- [ ] Add tests for all view cases.
- [ ] Run `npm test -- tests/frontend/taskViews.test.js`.
- [ ] Commit `feat: add task view helpers`.

## Task 2: Add Board Renderer

**Files:**
- Create: `public/js/renderBoard.js`
- Create: `tests/frontend/renderBoard.test.js`

- [ ] Render High Priority, In Progress, Planned, Completed, Notes columns.
- [ ] Render task cards with `data-task-id`, title, priority, due date, and selected state.
- [ ] Escape task-provided fields.
- [ ] Run `npm test -- tests/frontend/renderBoard.test.js`.
- [ ] Commit `feat: add board renderer`.

## Task 3: Extend Existing Renderers

**Files:**
- Modify: `public/js/renderList.js`
- Modify: `public/js/renderTaskDetail.js`
- Modify: `tests/frontend/renderList.test.js`

- [ ] Let `renderListHtml` accept title/count/empty/view labels.
- [ ] Let `renderTaskDetailHtml(task, { readOnly })` hide Edit/Archive in Archive.
- [ ] Add tests for custom list title and read-only detail.
- [ ] Run `npm test -- tests/frontend/renderList.test.js`.
- [ ] Commit `feat: support view-specific list and detail rendering`.

## Task 4: Wire View Navigation

**Files:**
- Modify: `public/js/main.js`
- Modify: `public/styles.css`

- [ ] Import board renderer and view helpers.
- [ ] Wire `[data-view]` buttons to update `state.activeView`.
- [ ] Fetch `archived=true` only for Archive.
- [ ] Render Board with board renderer, other views with list renderer.
- [ ] Keep task selection, search, context switching, create/edit/archive behavior working.
- [ ] Add board CSS and responsive behavior.
- [ ] Run `npm test`, `npm run check`, and `npm audit --omit=dev`.
- [ ] Commit `feat: wire task views`.

## Task 5: Browser Smoke And Final Verification

**Files:**
- Modify only files needed for verification fixes.

- [ ] Start local in-memory API smoke server.
- [ ] Verify Today, Board, Backlog, Archive, search, context switching in browser.
- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Run `npm audit --omit=dev`.
- [ ] Commit fixes if needed.
