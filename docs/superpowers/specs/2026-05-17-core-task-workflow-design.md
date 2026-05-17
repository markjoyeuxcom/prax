# Core Task Workflow Design

**Date:** 2026-05-17  
**Status:** Approved for planning  

## Overview

This slice turns the Balanced Operations Console from a read-oriented task dashboard into a usable task workflow. Users should be able to create, edit, archive, search, and filter tasks without leaving the main console.

The scope stays deliberately focused. Board rendering, drag/drop ordering, import/export, auth, and advanced checklist editing remain outside this slice.

## Goals

- Add a compact New/Edit Task modal.
- Allow the selected task to be edited or archived from the detail panel.
- Wire the existing search input to filter visible tasks.
- Wire Personal, Work, and Homelab context buttons to refetch and re-render tasks.
- Keep all task writes behind the existing `/api/tasks` boundary.
- Preserve the current professional operations-console layout.

## Non-Goals

- Kanban board implementation.
- Drag/drop reorder.
- Import/export endpoint implementation.
- Checklist, notes, or activity persistence.
- Authentication or multi-user collaboration.
- Optimistic offline queueing.

## User Experience

### Create Task

Clicking **New Task** opens a modal with:

- Title
- Description
- Priority: High, Medium, Low
- Status: High Priority, In Progress, Planned, Completed, Notes
- Context: Personal, Work, Homelab
- Due date

The default context is the active context. Priority defaults to Medium, status defaults to Planned, and due date is optional.

Saving sends `POST /api/tasks`, closes the modal on success, refreshes the current task list, and selects the new task.

### Edit Task

The selected task detail panel includes an **Edit** action. Editing opens the same modal populated with the task's current values.

Saving sends `PATCH /api/tasks/:id`, closes the modal on success, refreshes the current task list, and keeps the edited task selected.

### Archive Task

The selected task detail panel includes an **Archive** action. Clicking it asks for browser confirmation, sends `DELETE /api/tasks/:id`, refreshes the current list, and selects the next available task.

### Search

Typing in the top-bar search input filters the already-loaded task list client-side. Search matches title, description, status, priority, context, and due date. The backend already supports search, but this slice keeps search instant and local to the active context.

### Context Switching

Clicking a context button updates the active context, clears the current selection, fetches tasks for that context from `/api/tasks?context=...`, and re-renders the console.

## Architecture

### Frontend Modules

- `public/js/taskApi.js`: add `updateTask(id, patch)` and `archiveTask(id)`.
- `public/js/renderTaskForm.js`: pure renderer for the New/Edit Task modal and form values.
- `public/js/taskFilters.js`: pure helper for client-side search filtering.
- `public/js/renderShell.js`: add stable `data-action`, `data-context`, and search value hooks.
- `public/js/renderTaskDetail.js`: add Edit and Archive actions.
- `public/js/main.js`: wire events, API writes, modal lifecycle, context fetches, search, and re-rendering.
- `public/styles.css`: modal, form, detail actions, and filtered empty-state styling.

### State

Extend frontend state with:

- `searchQuery`
- `isTaskFormOpen`
- `editingTaskId`
- `formError`
- `isSaving`

The source of truth for tasks remains `state.tasks`, populated from the API for the active context. Visible tasks are derived via `filterTasks(state.tasks, state.searchQuery)`.

### API Contract

Use the existing backend task contract:

- Create requires `title`, `priority`, `status`, `context`, `dueDate`, and `sortOrder`.
- Update accepts partial fields: `title`, `description`, `priority`, `status`, `context`, `dueDate`, `sortOrder`.
- Delete archives the task rather than hard-deleting it.

The frontend must send empty due dates as `null` or `''` according to route expectations. The backend already normalizes empty patch due dates to `null`.

## Error Handling

- Form validation prevents empty titles before making an API request.
- API write failures keep the modal open and show a concise error message.
- Context fetch failures render the existing page-level error state.
- Archive failures show an alert with a concise message and keep the current UI state.

## Testing

Add focused module tests:

- `taskApi` request methods and URLs with mocked `fetch`.
- `renderTaskFormHtml` create/edit defaults, escaping, and selected options.
- `filterTasks` search behavior.
- `renderTaskDetailHtml` includes edit/archive controls for selected tasks.

Run the full suite after implementation:

- `npm test`
- `npm run check`
- `npm audit --omit=dev`

## Acceptance Criteria

- New Task opens a modal and creates a task through the API.
- Editing a selected task updates it through the API.
- Archiving a selected task calls the archive endpoint and removes it from the current list after refresh.
- Search filters the task queue without a page reload.
- Context buttons refetch tasks for the selected context.
- Existing backend/API tests continue passing.
- Frontend renderers escape user-provided task fields.
