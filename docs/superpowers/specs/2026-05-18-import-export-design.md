# Import Export Design

## Goal

Let Moomora Console move task data in and out as JSON so a homelab deployment can be backed up, migrated, or seeded before deeper database operations are added.

## Scope

This slice adds context-level JSON export and append-only JSON import. It does not add destructive replace imports, duplicate detection, CSV support, scheduled backups, or cross-context remapping screens.

## User Experience

`Export` downloads a JSON file for the currently selected context. The file includes active and archived tasks plus metadata: format name, version, export time, and context.

`Import` opens a local file picker for JSON. Moomora Console accepts either the exported envelope or a raw array of task-like objects. Imported tasks are appended into the current context. The current context wins over any context stored in the file so a user can intentionally import a backup into Personal, Work, or Homelab. On success, the app reloads the current view and shows a short alert with the imported count. On failure, it shows a simple alert and leaves existing tasks untouched.

## API

Add `GET /api/tasks/export?context=homelab`, returning:

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "exportedAt": "2026-05-18T18:00:00.000Z",
  "context": "homelab",
  "tasks": []
}
```

Add `POST /api/tasks/import` with:

```json
{
  "context": "homelab",
  "tasks": []
}
```

Import validates title, priority, status, due date, sort order, and archived timestamp. The repository inserts new rows without preserving ids to avoid conflicts.

## Testing

Tests cover export route shape, import validation, repository batch insert SQL, frontend API helpers, and import/export JSON parsing helpers.
