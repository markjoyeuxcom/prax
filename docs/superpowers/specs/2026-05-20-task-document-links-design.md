# Task ↔ Document Links — Design Spec

**Date:** 2026-05-20
**Status:** Approved for implementation

## Goal

Let a task link to one or more Markdown library documents (runbooks / notes), so operational work can point at the runbook that supports it. View, add, and remove links from the task detail panel; jump from a linked doc straight into the Library.

## Scope

This slice covers task→document linking: a "Linked docs" section in the task detail panel, a modal picker to add links, unlink controls, and navigation from a linked doc into the Library.

Out of scope (deferred):
- Doc-side backlinks ("referenced by N tasks") in the Library
- Linking documents to other documents
- Linking across archived items (links target active docs/tasks)

## Data Model

New many-to-many join table:

```sql
create table if not exists task_documents (
  task_id uuid not null references tasks(id) on delete cascade,
  document_id uuid not null references markdown_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, document_id)
);

create index if not exists idx_task_documents_document on task_documents (document_id);
```

- Cascade delete on both sides: deleting a task or permanently deleting a document removes its links automatically.
- The composite primary key prevents duplicate links.
- The secondary index supports future doc→task backlink queries.
- Cross-context links are allowed (the table is context-agnostic).

## API

- `GET /api/tasks/:id/documents` → list the document summaries linked to a task (id, title, documentType, context).
- `POST /api/tasks/:id/documents` `{ documentId }` → 201 when a new link is created, 200 if the link already exists (idempotent), 404 if the task or document is missing or archived.
- `DELETE /api/tasks/:id/documents/:documentId` → remove a link. 204/200 on success, 404 if the link did not exist.

Validation: both ids must be valid UUIDs; the task and document must exist and be non-archived.

## Frontend

### Task detail panel

A new "Linked docs" section (alongside the existing Checklist / Notes / Activity blocks) lists linked documents as rows: title + `runbook`/`note` type. Each row:
- Clicking the row navigates to the Library and selects that document.
- An unlink control (`[x]`) removes the link.

A `[+] link doc` button opens the link picker modal. The section shows an empty hint when no docs are linked. In read-only (archive) mode, the section is display-only (no add/unlink).

### Link picker modal

Matches the existing modal chrome (desktop centered, mobile full-screen). Contents:
- A search input filtering active library documents by title/tag/type.
- A list of results showing title, type, and context label.
- Already-linked docs show a linked state; clicking a row toggles the link (immediate API call).
- A close action.

### State & API client

- `state` gains `taskDocuments` (the linked-doc list for the selected task) and `isLinkPickerOpen`.
- `taskApi.js` gains `fetchTaskDocuments(taskId)`, `linkTaskDocument(taskId, documentId)`, `unlinkTaskDocument(taskId, documentId)`.
- Linked docs are loaded when a task is selected and refreshed after link/unlink.

## Demo server

The in-memory demo repository gains a parallel link store (an array of `{ taskId, documentId }`) and the same three operations, so `npm run demo` exercises the feature without Postgres.

## Testing

- Backend: repository link/unlink/list SQL builders + route validation (valid link, missing task/doc, bad UUID, duplicate, unlink missing).
- Frontend: `taskApi` helpers (method/URL/body), task-detail linked-docs rendering (rows, unlink control, read-only hides controls), link-picker modal rendering.

## Rollout

One slice, but implemented back-to-front: (1) schema + repository + routes + backend tests + demo store, then (2) frontend API client + detail section + picker modal + wiring + tests. Stage-only; commit after both verify green.

## Migration note

Existing databases need the new table: re-run `psql "$DATABASE_URL" -f server/schema.sql` (idempotent `create table if not exists`).
