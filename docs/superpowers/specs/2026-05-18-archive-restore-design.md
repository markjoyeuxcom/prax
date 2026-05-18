# Archive Restore Design

## Goal

Allow archived tasks to be restored from the Archive view without leaving the current console workflow.

## Scope

This slice adds a restore action for archived tasks. It does not add bulk restore, permanent delete, undo toasts, or activity timeline entries.

## User Experience

When the user opens Archive and selects a task, the detail panel shows a `Restore` action. Edit and Archive remain hidden in read-only Archive mode. Restoring asks for confirmation, calls the API, removes the task from Archive, and reloads the current Archive list. The restored task returns to the active queue with its existing context, status, due date, priority, and sort order.

If restore fails, TaskBoard shows a simple alert and reloads the Archive list so the UI does not drift from backend state.

## API

Add `PATCH /api/tasks/:id/restore`. The route validates UUID ids, calls `repository.restoreTask(id)`, returns the restored task on success, and returns `404` when the task does not exist or is not archived.

## Data Flow

The frontend detail renderer exposes Archive-only restore markup through an option. `main.js` binds `data-action="restore-task"`, calls `restoreTask(id)`, then reloads tasks with Archive mode still active. The repository clears `archived_at`, updates `updated_at`, and returns the restored row.

## Testing

Tests cover repository SQL, route success and validation, frontend API helper behavior, Archive detail rendering, and UI wiring through the existing module boundaries.
