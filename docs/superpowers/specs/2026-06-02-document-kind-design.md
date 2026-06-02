# Document `kind` design

**Status:** Approved
**Date:** 2026-06-02
**Target release:** v0.10.0
**Predecessor:** [`2026-05-31-doc-graph-provenance-design.md`](./2026-05-31-doc-graph-provenance-design.md)
**Successor (planned):** Export serialization v2 (front-matter v2 carrying links, provenance, and `kind`)

## Goal

Distinguish a **source** document (hand-authored, imported, or curated by the user) from a
**synthesized** document (agent-generated derivation) with a single explicit column on
`markdown_documents`. Surface it on read paths and accept it on write paths so callers — UI,
HTTP, and MCP — can filter, prioritize stale grooming, and (later) round-trip the distinction
through exports.

## Why a column, not an edge

`kind` is a fact about the document itself; `derived-from` is a fact about a relationship.

- A user can hand-author a document and still add a `derived-from` link to credit the
  origin. The document is still `source`.
- An agent can synthesize a fresh draft with no `derived-from` link (e.g. a generated runbook
  built from external context). The document is `synthesized`.
- Inferring `kind` from edges would conflate two independent dimensions and force callers to
  reason about graph state to answer "did I write this?".

## Non-goals

- **No inference from `x-moomora-origin`.** The MCP client sets that header to mark *edit
  origin*; `kind` is a separate, explicit input. Honor-system stays honor-system at the same
  layer. Keeping the two independent avoids surprising defaults (e.g. an agent fixing a typo
  on a hand-authored doc would not flip its kind).
- **No third value.** Only `source` and `synthesized`. `imported`, `template`, etc. wait
  for concrete evidence.
- **No export front-matter change.** That ships in the next sub-project (export
  serialization v2), which will include `kind` in front-matter v2.
- **No automatic promotion.** Mutating `kind` from `synthesized` to `source` is an explicit
  user action via `update_document`. We do not auto-promote on edit.

## Schema (Migration 0004)

```sql
alter table markdown_documents
  add column if not exists kind text not null default 'source'
  check (kind in ('source', 'synthesized'));
```

- Additive and idempotent, matching the 0003 provenance migration style.
- `not null default 'source'` backfills every existing row. This is correct: any document
  created before this feature existed pre-dated the synthesized path.
- The `check` constraint locks the vocabulary at the database, so an out-of-band write (psql,
  another client) cannot introduce a third value without an explicit migration.
- No backfill script needed beyond the default; the migration itself is sufficient.

## Read surface

### Repository

- `normalizeDocumentRow` exposes `kind: row.kind`. No `?? null` fallback — the column is
  `NOT NULL`.
- `list_stale_documents` row payload gains `kind`. Callers grooming the graph can prioritize
  refreshing stale `synthesized` rows and leave stale `source` rows for human review.
- `list_orphan_documents` row payload also gains `kind` (symmetry; no extra query cost).

### HTTP API

- `GET /api/library/documents/:id` returns `kind`.
- `GET /api/library/documents` (list) returns `kind` on each row.
- `GET /api/library/documents` accepts an optional `kind` query parameter:
  - `?kind=source` — only source documents.
  - `?kind=synthesized` — only synthesized documents.
  - Omitted — both.
  - Any other value — 400 Bad Request (mirrors how existing query params validate).
- `GET /api/library/maintenance/stale` and `/orphans` include `kind` on each row.

### MCP

- `search_documents` gains an optional `kind: z.enum(['source','synthesized'])` input.
- `get_document` output gains `kind`.
- `list_stale_documents` and `list_orphan_documents` output gain `kind`.

## Write surface

### Repository

- `buildCreateDocument` inserts `kind`, defaulting to `'source'` when omitted from the
  payload. Column count goes from 8 → 9.
- `buildUpdateDocument` conditionally appends a `kind` set-clause only when `kind` is
  present in the patch fields (mirrors how `body` triggers `content_hash`).

### HTTP API

- `POST /api/library/documents`: optional `kind` in the request body.
- `PATCH /api/library/documents/:id`: optional `kind` in the request body. Lets a user
  promote a polished synthesized doc to `source`, or demote a source doc to `synthesized`
  if needed.
- Invalid `kind` values return 400 Bad Request before the DB sees them. Validation lives in
  the existing payload-cleaning helper (`cleanDocumentPayload`-style), not Zod — the HTTP
  routes do not use Zod today, only the MCP tool inputs do. The DB `check` constraint is the
  belt-and-braces backstop.

### MCP

- `create_document` Zod input gains `kind: z.enum(['source','synthesized']).optional()`.
- `update_document` Zod input gains the same optional `kind`.

## Demo server (in-memory)

The demo server in `scripts/demo-server.js` mirrors the schema and behavior:

- Every seeded document defaults to `kind: 'source'`.
- Create/update accept `kind`.
- Stale/orphan lists include `kind`.
- Search accepts the `kind` filter.

This keeps the demo path identical to the Postgres path for UI and contract tests.

## Contract / shape locks

- `tests/contract/libraryFormat.test.js`: `FROZEN_DOC_KEYS` gains `kind`.
- `tests/contract/mcpToolContract.test.js`: `search_documents` shape lock gains the optional
  `kind` input; `create_document`/`update_document` shape locks gain optional `kind`.
- `docs/contract.md`:
  - Document-fields table gains a `kind` row: `'source' | 'synthesized'`, default `'source'`.
  - MCP tool table notes the new optional inputs/outputs.
  - Short prose note: "`kind` distinguishes hand-authored documents from agent-synthesized
    derivations. It is set explicitly by callers and is independent of `derived-from` links
    and the `x-moomora-origin` edit-origin header."

## Testing strategy

- **Migration test** — unit test asserting the column exists with the default, the check
  constraint rejects unknown values, and the migration is idempotent (apply twice, no error,
  no duplicate column).
- **Repository tests** —
  - Create with explicit `kind: 'synthesized'` round-trips.
  - Create without `kind` defaults to `'source'`.
  - Update flipping `kind` from `synthesized` to `source` round-trips.
  - Update without `kind` leaves the column untouched (no UPDATE on that column).
  - `list_stale_documents` returns `kind` on each row.
- **Route tests** —
  - `POST` with valid `kind` succeeds.
  - `POST` with invalid `kind` returns 400.
  - `GET /api/library/documents?kind=source` filters correctly.
  - `GET /api/library/documents?kind=bogus` returns 400.
- **Contract tests** —
  - `FROZEN_DOC_KEYS` regression covers the new field.
  - MCP shape locks cover the new optional inputs.
- **E2E smoke against real Postgres** before PR:
  - Apply migration on fresh DB.
  - Apply migration on an existing DB pre-populated with rows: all existing rows show
    `kind: 'source'`.
  - Create one of each kind via HTTP, confirm round-trip.
  - Create via MCP `create_document` with explicit kind, confirm column set.
  - Promote a synthesized doc to source via MCP `update_document`, confirm flip.
  - Filter via `search_documents` with `kind: 'source'`, confirm only sources returned.

## Release

Single PR. Cuts as **v0.10.0** (minor: additive feature, no breaking changes to existing
data shapes since the new field is additive on output).

## Open questions

None.
