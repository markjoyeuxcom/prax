# Document Graph Phase 2a — Trust + Stale Loop — Design

**Date:** 2026-05-31
**Status:** Approved (design)
**Scope:** Provenance primitives (content-hash, path-stamped edit-origin) + stale/orphan detection over the document graph, exposed via read-only MCP tools. No `kind` column, no export serialization, no UI, no server-enforced skip.

## Goal

Let a client-side agent safely **groom** the document graph: find which synthesized documents
are stale (a source they were derived from has changed since synthesis), find orphans, and know
which documents a human hand-edited so a regeneration pass can **skip** them. Moomora exposes the
data; the groom/compile loop stays in Claude Code.

## Builds on

The shipped document-graph MVP: `document_links` (directed, typed edges `derived-from` /
`supersedes`), `GET /api/library/documents/:id`, the `list_document_links`/`link_documents`/
`unlink_documents` MCP tools. Edge convention (unchanged): `link_documents(sourceId, targetId,
relation)` stores `source_document_id = sourceId`, `target_document_id = targetId`, meaning
"sourceId **is** `relation` targetId". So for **A derived-from B**, A (the derived/synthesized
doc) is the edge **source**, and B (the origin it was distilled from) is the edge **target**.

## 1. Schema — `0003_add_provenance.sql`

- `markdown_documents`: add
  - `content_hash text` — sha-256 hex of the document **body** (null until first write under the
    new code; backfilled on next write).
  - `updated_by text not null default 'user'` — who last wrote the row: `'user'` | `'agent'`.
- `document_links`: add
  - `target_hash text` — for a `derived-from` edge, the **target** document's `content_hash`
    snapshotted at link time (the "synthesis snapshot"). Named `target_hash` because it holds the
    hash of the edge's *target* (= the source-of-derivation, document B above); this avoids
    colliding with the existing `source_document_id`/`target_document_id` column names. Null for
    `supersedes` edges.

All additive `alter table ... add column if not exists`, so the migration is a no-op re-run and
safe on an existing DB (existing rows get `content_hash = null`, `updated_by = 'user'`).

## 2. Content hash

Computed in the repository write path from the document **body** using `node:crypto`
`createHash('sha256').update(body).digest('hex')`:
- **create:** always set `content_hash`.
- **update:** recompute `content_hash` only when `body` is part of the patch (a title/tags-only
  edit does **not** change the hash, so it does not make a derived doc "stale").

Body-only by design: staleness tracks the *content* an agent synthesizes from, not metadata.

## 3. Edit-origin (path-stamped, not model-controllable)

- The document write routes (`POST /api/library/documents`, `PATCH /api/library/documents/:id`)
  read the **`x-moomora-origin`** request header and resolve `updatedBy = (header === 'agent') ?
  'agent' : 'user'`, passed into the repository create/update so it is written to `updated_by`
  on **every** write (create and any update).
- The **MCP client** (`mcp/moomoraClient.js`) sends `x-moomora-origin: agent` on its
  `createDocument`/`updateDocument` calls — set *in the client*, **not** exposed as a tool input,
  so the model cannot forge it. The browser UI sends no such header → `'user'`.
- This is honor-system at the raw HTTP boundary (the app has no auth), but **non-forgeable by the
  model**, which is the only threat that matters for skip-protection.

## 4. Stale snapshot + refresh (re-link upserts)

- Creating a `derived-from` link captures `target_hash` = the target document's current
  `content_hash`.
- **Re-link upserts** (chosen): `link_documents` for a `derived-from` edge becomes
  `... on conflict (source_document_id, target_document_id, relation) do update set target_hash =
  excluded.target_hash`. Re-linking the same pair after re-synthesis refreshes the snapshot —
  "re-link = mark fresh". `supersedes` edges keep the current `do nothing` idempotency and a null
  `target_hash`. (The MVP's idempotency contract test is updated to reflect that derived-from now
  refreshes the snapshot while supersedes stays a no-op.)
- The insert computes the target hash inline:
  `insert into document_links (source_document_id, target_document_id, relation, target_hash)
  select $1, $2, $3, (select content_hash from markdown_documents where id = $2) where exists(…)
  on conflict … do update set target_hash = excluded.target_hash` — for `derived-from`. For
  `supersedes`, the existing insert (no `target_hash`, `do nothing`) is kept.
- **Stale** = a `derived-from` edge where the target's current `content_hash` differs from the
  edge's snapshot: `target.content_hash is distinct from dl.target_hash` (and `target_hash` is not
  null, and both docs live).

## 5. Queries + read-only MCP tools

Two new query builders + repository methods (in `documentLinksRepository.js`) and two new MCP
tools (in a new `mcp/tools/graphMaintenance.js`):

- **`list_stale_documents`** `{ project?: str }` → the synthesized documents (edge sources of a
  stale `derived-from` edge), each: `{ documentId, title, documentType, projectId, updatedBy,
  staleSources: [{ documentId, title }] }`. The `updatedBy` lets the groom loop **skip**
  `'user'`-edited docs. Optional `project` scopes by slug/id. Read-only, capped at 20.
- **`list_orphan_documents`** `{ project?: str }` → live documents with **no** inbound and **no**
  outbound links: `{ documentId, title, documentType, projectId }`. Read-only, capped at 20.

HTTP routes backing them (internal API, same `{message}`/validation conventions):
`GET /api/library/maintenance/stale?project=` and `GET /api/library/maintenance/orphans?project=`.

## 6. Expose provenance in the document record

`normalizeDocumentRow` gains `contentHash` and `updatedBy`, so `GET /api/library/documents/:id`
and the MCP `get_document` surface them. (Export `.md` front-matter is **unchanged** —
`formatFrontMatter` still emits only title/type/project/tags/created_at/updated_at, so the
library export format is unaffected.)

## 7. Exposed, not enforced

The server never refuses a write to a hand-edited document. It surfaces `updatedBy` (and the
stale list) so the **client-side** groom loop decides what to skip or recompile. Cognition stays
in Claude Code.

## 8. Demo mirror + tests + docs

- `scripts/demo-server.js`: in-memory mirror — compute body hash on create/update, stamp
  `updatedBy` from the header, snapshot/refresh `target_hash` on derived-from links, and serve
  the two maintenance routes.
- Tests: repository builders + methods (hash, upsert-refresh, stale, orphan), route tests
  (origin header → updatedBy; stale/orphan endpoints), MCP tool tests, and updates to the
  existing document-shape and link-idempotency regression tests.
- `docs/contract.md` + `mcp/README.md`: document the two new tools, the new record fields
  (`contentHash`, `updatedBy`), the `x-moomora-origin` write header, and the derived-from
  re-link-refresh behavior. Add the two tools to the contract regression set.
- A real-Postgres E2E smoke: write a source + derived doc, link derived-from, edit the source,
  confirm `list_stale_documents` flags the derived doc with its `updatedBy`; re-link to refresh
  and confirm it clears; confirm an unlinked doc shows as orphan.

## Field/shape summary (the contract this locks)

- Document record gains: `contentHash: string|null`, `updatedBy: "user"|"agent"`.
- New MCP tools: `list_stale_documents { project? }`, `list_orphan_documents { project? }`
  (read-only).
- `link_documents` behavior change: `derived-from` now refreshes `target_hash` on re-link;
  `supersedes` unchanged.
- New write header: `x-moomora-origin: agent|user` (defaulting to `user`).

## Out of scope (deferred)

- `kind` (source | synthesized) column — next cycle.
- Export serialization (links/provenance into `.md` front-matter v2; the slug-vs-UUID identifier
  decision) — separate cycle.
- Any frontend UI.
- Server-enforced skip-protection (the server only exposes `updatedBy`).
