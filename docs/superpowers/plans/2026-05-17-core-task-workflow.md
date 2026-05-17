# Core Task Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create, edit, archive, search, and context switching to the Balanced Operations Console.

**Architecture:** Keep task persistence behind `taskApi.js`, keep renderer modules pure, and let `main.js` own event wiring and API refreshes. Add a small modal renderer for New/Edit Task and a pure search helper so workflow behavior is testable without browser automation.

**Tech Stack:** Node.js test runner, native browser JavaScript modules, Fastify task API, CSS.

---

## File Map

| Path | Responsibility |
|---|---|
| `public/js/taskApi.js` | API client for list/create/update/archive |
| `public/js/taskFilters.js` | Pure client-side task search filtering |
| `public/js/renderTaskForm.js` | Pure New/Edit Task modal renderer |
| `public/js/renderShell.js` | Add stable action/context/search hooks |
| `public/js/renderTaskDetail.js` | Add Edit and Archive actions |
| `public/js/main.js` | Event wiring, modal lifecycle, API refreshes, derived visible tasks |
| `public/js/state.js` | Add modal/saving/error state fields |
| `public/styles.css` | Modal, form, detail action, and filtered empty-state styles |
| `tests/frontend/taskApi.test.js` | API client method tests |
| `tests/frontend/taskFilters.test.js` | Search helper tests |
| `tests/frontend/renderTaskForm.test.js` | Modal renderer tests |
| `tests/frontend/renderList.test.js` | Detail action regression |

## Task 1: Add API Client Methods

**Files:**
- Modify: `public/js/taskApi.js`
- Create: `tests/frontend/taskApi.test.js`

- [ ] Add `updateTask(id, patch)` that sends `PATCH /api/tasks/:id` with JSON.
- [ ] Add `archiveTask(id)` that sends `DELETE /api/tasks/:id`.
- [ ] Keep `fetchTasks()` and `createTask()` behavior intact.
- [ ] Tests mock `globalThis.fetch` and assert method, URL, body, and thrown errors.
- [ ] Run `npm test -- tests/frontend/taskApi.test.js`.
- [ ] Commit: `feat: add task api workflow methods`.

## Task 2: Add Search Filtering

**Files:**
- Create: `public/js/taskFilters.js`
- Create: `tests/frontend/taskFilters.test.js`

- [ ] Add `filterTasks(tasks, query)` returning all tasks for blank query.
- [ ] Match title, description, priority, status, context/tab, and dueDate case-insensitively.
- [ ] Tests cover blank query, title match, metadata match, and no match.
- [ ] Run `npm test -- tests/frontend/taskFilters.test.js`.
- [ ] Commit: `feat: add task search filtering`.

## Task 3: Add Task Form Renderer

**Files:**
- Create: `public/js/renderTaskForm.js`
- Create: `tests/frontend/renderTaskForm.test.js`

- [ ] Add `renderTaskFormHtml({ task, activeContext, error, isSaving })`.
- [ ] Render a modal with `data-modal="task-form"`, form fields, save/cancel buttons, and escaped values.
- [ ] For create mode, default priority `medium`, status `planned`, context from active context, blank title/description/dueDate.
- [ ] For edit mode, populate values from the task and mark selected options.
- [ ] Show form error and saving state when provided.
- [ ] Tests cover create defaults, edit values, escaping, and selected options.
- [ ] Run `npm test -- tests/frontend/renderTaskForm.test.js`.
- [ ] Commit: `feat: add task form renderer`.

## Task 4: Add UI Hooks And Detail Actions

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `public/js/renderTaskDetail.js`
- Modify: `tests/frontend/renderShell.test.js`
- Modify: `tests/frontend/renderList.test.js`

- [ ] Add `data-action="new-task"` to New Task.
- [ ] Add `data-action="export"` and `data-action="import"` to existing buttons.
- [ ] Add `data-context` to context buttons.
- [ ] Add `value` to search input from `searchQuery`.
- [ ] Add `data-action="edit-task"` and `data-action="archive-task"` to selected task detail actions.
- [ ] Tests assert shell hooks and detail actions exist.
- [ ] Run `npm test -- tests/frontend/renderShell.test.js tests/frontend/renderList.test.js`.
- [ ] Commit: `feat: add workflow action hooks`.

## Task 5: Wire Main Workflow

**Files:**
- Modify: `public/js/main.js`
- Modify: `public/js/state.js`
- Modify: `public/styles.css`

- [ ] Extend state with `isTaskFormOpen`, `editingTaskId`, `formError`, and `isSaving`.
- [ ] Import `updateTask`, `archiveTask`, `filterTasks`, and `renderTaskFormHtml`.
- [ ] Render visible tasks via `filterTasks(state.tasks, state.searchQuery)`.
- [ ] Wire search input to `setState({ searchQuery })` and re-render workspace.
- [ ] Wire context buttons to refetch tasks for the selected context.
- [ ] Wire New Task and Edit Task to open the modal.
- [ ] On form submit, validate title, call create/update API, refresh the active context, close modal, and select saved task.
- [ ] Wire Cancel to close the modal.
- [ ] Wire Archive to browser confirmation, archive API call, refresh, and next selection.
- [ ] Add modal/form/action CSS.
- [ ] Run `npm test`, `npm run check`, `npm audit --omit=dev`.
- [ ] Commit: `feat: wire core task workflow`.

## Task 6: Final Verification

**Files:**
- Modify only files needed to fix verification failures.

- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Run `npm audit --omit=dev`.
- [ ] Run route smoke with Fastify injection for `/healthz` and `/readyz`.
- [ ] If files change, commit: `fix: address core workflow verification issues`.
