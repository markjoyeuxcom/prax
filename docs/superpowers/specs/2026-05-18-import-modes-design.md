# Import Modes Design

## Goal

Make JSON import safer and more useful by adding explicit import modes: append, skip duplicates, and replace context.

## Scope

This slice updates the existing JSON import flow. It does not add CSV support, visual import previews, merge conflict editing, or scheduled backups.

## Modes

- `skip`: default. Import only tasks that do not already exist in the selected context.
- `append`: current behavior. Import every task as a new row.
- `replace`: remove every task in the selected context, including archived tasks, then import the file.

Duplicate detection uses normalized `title`, `context`, `status`, and `dueDate`. Description, priority, sort order, and archived state do not affect duplicate matching.

## User Experience

The Import button asks for an import mode before opening the file picker. Cancel stops the import. Blank input defaults to `skip`. Invalid input shows an alert. Replace mode requires typing `REPLACE` before the file picker opens.

On success, TaskBoard reports imported and skipped counts and reloads the current view.

## API

`POST /api/tasks/import` accepts an optional `mode` field:

```json
{
  "context": "homelab",
  "mode": "skip",
  "tasks": []
}
```

Responses include:

```json
{
  "mode": "skip",
  "imported": 1,
  "skipped": 2,
  "tasks": []
}
```

## Data Safety

Replace mode is destructive and must be explicit in the UI. Backend replacement is context-scoped so importing Homelab cannot remove Personal or Work tasks.

## Testing

Tests cover mode normalization, duplicate filtering, append behavior, replace behavior, invalid mode validation, and frontend API payloads.
