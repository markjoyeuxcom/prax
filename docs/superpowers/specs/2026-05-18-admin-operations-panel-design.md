# Admin Operations Panel Design

## Goal

Move import, export, and backup actions out of the main task toolbar into a focused Admin panel so operational actions feel deliberate and safer.

## Scope

This slice adds one Admin modal, moves current import/export workflows into it, and adds an all-context backup export. It does not add scheduled backups, database restore jobs, Kubernetes manifests, user accounts, or bulk archive deletion.

## User Experience

The topbar keeps `New Task` visible and replaces `Import` and `Export` with a single `Admin` button.

The Admin panel has three sections:

- Backup: export the selected context or export all contexts as one TaskBoard backup file.
- Restore / Import: pick an import mode with radio controls, optionally type `REPLACE`, then choose a JSON file.
- Archive Maintenance: show the archive entry point and remind the user that permanent delete is handled per archived task.

Import mode selection uses visible controls instead of prompt text. Replace mode remains protected by requiring the exact text `REPLACE` before the file is accepted.

## API

`GET /api/tasks/export?context=all` returns a TaskBoard export envelope containing every task across contexts, including archived tasks.

Context-specific exports keep their existing response shape and safety checks.

## Data Safety

All-context export is read-only. Import still targets the currently selected context, and replace mode remains context-scoped.

## Testing

Tests cover Admin modal rendering, topbar action changes, all-context export, frontend export helper behavior, and the modal import controls.
