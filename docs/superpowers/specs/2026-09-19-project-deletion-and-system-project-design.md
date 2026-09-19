# Project deletion and the single system project — design

**Date:** 2026-09-19 · **Status:** implemented

## Problem

Permanent project deletion existed in the API and the All projects screen, but it refused any
project that still held a task or a document. Since nearly every real project holds something,
projects were effectively undeletable. Separately, the only reserved project was **Inbox**
(migration 0002), while the project that actually needs protecting — **`memory`**, the shared
long-term memory every agent CLI writes to — was an ordinary project created on demand by the CLI
and deletable by anyone.

## Decision

1. **Every project can be permanently deleted except the one system project.**
   `DELETE /api/projects/:id/permanent` removes the project and everything filed under it in one
   `begin immediate … commit` transaction:
   - tasks (`task_checklist_items`, `task_activity`, `task_documents` follow by FK cascade);
   - documents (`document_links`, `document_external_refs`, `document_code_refs`, `runbook_runs`
     cascade; the FTS index follows its trigger; a supersedes edge that disappears reactivates its
     target only when no other live replacement remains, per the existing trigger);
   - staged and replayable import records (`task_import_sessions`, its chunks,
     `task_import_operations`), which have no meaning without the project;
   - run chronicles keep their rows with `project_id` set null (existing FK behaviour).
   Write receipts (`assistant_write_receipts`, `document_upsert_receipts`) are kept, exactly as a
   single-document permanent delete keeps them, so a delayed replay still answers `410`.
   The response is the deleted project plus `deleted: { tasks, documents }`.
2. **`memory` is the only system project.** Migration 0030 seeds it with a fixed id and
   `insert or ignore` on the unique slug, so a `memory` project the CLI created earlier is adopted
   (its id and contents untouched) rather than duplicated. The server refuses rename, status
   change, archive and delete with `403`; the All projects card shows a System chip instead of
   state chips and Delete.
3. **Inbox is an ordinary project.** It stays the default capture target while it exists (every
   fallback already tolerated its absence), but it can be renamed and deleted.

## Human surface

The confirmation names the project and states that every task and document filed under it is
deleted with it and that this cannot be undone. The success toast reports the counts. A refusal
shows the server's reason.

## Evidence

- `tests/backend/projectsRoutes.test.js` — cascade through the real app (task + checklist item +
  document), Inbox rename/delete allowed, Memory seeded and refused.
- `tests/backend/migrate.test.js` — 0030 adopts an existing `memory` row without duplicating it.
- `tests/frontend/renderAllProjects.test.js`, `tests/frontend/projectApi.test.js` — the System
  card and the surfaced refusal reason.
