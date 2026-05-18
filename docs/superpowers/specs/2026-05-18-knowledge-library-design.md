# Knowledge Library Design

## Goal

Add a Markdown-backed Knowledge Library for both operational runbooks and general notes.

## Scope

This first slice adds database-backed Markdown documents, a Library view, single-file `.md` import from Admin, and create/edit/view/archive/delete workflows. It does not add folder import, zip import, full-text search indexes, task-document linking, AI generation, or collaborative editing.

## Document Model

Documents are stored in a new `markdown_documents` table:

- `id`
- `title`
- `body`
- `document_type`: `runbook` or `note`
- `context`: `personal`, `work`, or `homelab`
- `tags`: text array
- `source_filename`
- `archived_at`
- `created_at`
- `updated_at`

Runbooks and notes share the same storage and UI. Type is metadata used for filtering and display.

## User Experience

The left navigation gains `Library`.

The Library workspace uses the same operations-console layout:

- Left side: searchable Markdown document list.
- Right side: selected document detail with metadata, Markdown preview, raw source toggle, and actions.
- Actions: create new document, edit selected document, archive selected document, permanently delete archived document.

The Admin panel gains `Import Markdown`, accepting one `.md` file into the selected context. Imported title defaults to the first Markdown heading, then filename, then `Untitled document`.

## API

Add `/api/library/documents` endpoints:

- `GET /api/library/documents?context=homelab`
- `POST /api/library/documents`
- `PATCH /api/library/documents/:id`
- `DELETE /api/library/documents/:id`
- `PATCH /api/library/documents/:id/restore`
- `DELETE /api/library/documents/:id/permanent`

Active documents are returned by default. `archived=true` returns archived documents. `archived=all` returns both.

## Data Safety

Markdown preview escapes HTML before rendering. Permanent delete only works for archived documents. Imported Markdown is stored as text; no scripts or raw HTML execute in preview.

## Testing

Tests cover SQL builders, route validation, API helpers, Markdown preview escaping, Library rendering, Admin Markdown import controls, and shell navigation.
