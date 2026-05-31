# Document Graph MVP — Design

**Date:** 2026-05-31
**Status:** Approved (design)
**Scope:** Typed, directional document↔document links + backlinks + detail-by-id routes, exposed over the HTTP API and MCP. No provenance/maintenance machinery, no export serialization, no UI.

## Goal

Turn the Markdown library into a navigable knowledge graph an agent can build and traverse:
documents gain **typed, directional links** (`derived-from`, `supersedes`), **backlink retrieval**,
and efficient **fetch-by-id**. All cognition stays client-side (Claude Code via MCP); Moomora
only exposes primitives.

## Decisions (settled in brainstorming)

- **Relations:** `derived-from` (lineage/provenance) and `supersedes` (replacement/versioning).
  `relates-to` is intentionally **not** included — project membership already expresses generic
  relatedness, so an untyped "these relate" edge carries no information a project doesn't.
- **Directed storage:** one row per (source, target, relation). No auto-inverse. Symmetric
  query semantics are provided by a `direction` parameter, not by duplicating rows.
- **Export serialization deferred:** links live in the DB + API + MCP only. Writing links into
  exported `.md` front-matter is a separate fast-follow (documents are UUID-only — no slug — so
  the serialized-identifier choice deserves its own design moment).
- **Agent/API-first:** no frontend UI for doc↔doc links in this MVP.

## Architecture & data flow

```
Claude Code → MCP tool (link_documents / list_document_links / unlink_documents)
            → moomoraClient → HTTP (POST/GET/DELETE /api/library/documents/:id/links)
            → libraryRoutes → documentLinksRepository → document_links table
```
Traversal: `list_document_links(documentId, direction)` joins `document_links` to live
`markdown_documents` and returns the related-document refs with their relation + direction.

## 1. Schema — `server/migrations/0002_add_document_links.sql`

```sql
create table if not exists document_links (
  source_document_id uuid not null references markdown_documents(id) on delete cascade,
  target_document_id uuid not null references markdown_documents(id) on delete cascade,
  relation text not null,
  created_at timestamptz not null default now(),
  primary key (source_document_id, target_document_id, relation),
  check (source_document_id <> target_document_id)
);

create index if not exists idx_document_links_target on document_links (target_document_id, relation);
```

- Mirrors the `task_documents` join (UUID FKs, `on delete cascade`), but **directed** and
  **typed**. Relation is in the PK so a pair may carry more than one relation.
- **No DB `CHECK` on relation values** — relation membership is validated in app code so adding
  a future relation is a one-line change, not a migration (fits the evolving model). The DB
  enforces structure: FKs, no-self-link, and (source, target, relation) uniqueness.
- Index on `(target_document_id, relation)` powers backlink queries.

## 2. Repository — new `server/documentLinksRepository.js`

Follows the established `build*` (pure `{text, values}`) + `createDocumentLinksRepository(db)`
pattern. The valid relations live here as the single source of truth:

```js
export const DOCUMENT_LINK_RELATIONS = ['derived-from', 'supersedes'];
```

**Builders + methods:**

- `linkDocuments(sourceId, targetId, relation)` — existence-guarded insert (mirrors
  `buildLinkTaskDocument`): insert `select $1,$2,$3 where exists(source live) and exists(target
  live) on conflict do nothing returning ...`. Method returns:
  - `{ linked: true }` when a row was inserted,
  - `{ linked: true, alreadyLinked: true }` when the row already existed (probe with a
    `buildLinkExists`-style query),
  - `{ linked: false }` when source or target is missing/archived.
- `unlinkDocuments(sourceId, targetId, relation)` — `delete ... returning` → `boolean`.
- `listDocumentLinks(documentId, direction)` — `direction ∈ {outbound, inbound, both}`. Builds a
  `union all` of:
  - outbound: `where source_document_id = $1`, join target doc, `direction = 'outbound'`;
  - inbound: `where target_document_id = $1`, join source doc, `direction = 'inbound'`;
  filtered to the requested direction(s), each joined to **non-archived** docs. Returns rows
  mapped to: `{ documentId, title, documentType, projectId, relation, direction }` (where
  `documentId` is the *other* document).

## 3. Library repository addition — `server/libraryRepository.js`

Add a fetch-by-id (none exists today):

- `buildGetDocument(id)` → `{ text: 'select * from markdown_documents where id = $1 limit 1', values: [id] }`.
- `getDocument(id)` method → `normalizeDocumentRow(row)` or `null`.

(`tasksRepository.getTask(id)` already exists — reuse it for the task detail route.)

## 4. HTTP routes

**Detail-by-id (the scaling fix — replaces MCP's list-and-filter):**
- `GET /api/library/documents/:id` (in `libraryRoutes.js`) → 200 full document | 404
  `{message:'document not found'}` | 400 `{message:'document id is invalid'}`.
- `GET /api/tasks/:id` (in `tasksRoutes.js`, using existing `getTask`) → 200 full task | 404
  `{message:'task not found'}` | 400 `{message:'task id is invalid'}`.

**Links (in `libraryRoutes.js`):**
- `GET /api/library/documents/:id/links?direction=outbound|inbound|both` (default `both`) →
  200 array of link records | 400 invalid id/direction. (`direction` invalid →
  `{message:'direction is invalid'}`.)
- `POST /api/library/documents/:id/links` body `{ targetId, relation }`:
  - 400 if `:id`/`targetId` not a UUID, `relation` not in `DOCUMENT_LINK_RELATIONS`, or
    `id === targetId` (`{message:'a document cannot link to itself'}`).
  - 201 when newly linked; 200 when already linked; 404 `{message:'document not found'}` when
    source or target is missing/archived.
  - Response body: the **updated outbound links list** for `:id` (mirrors how the task link
    route returns the updated document list).
- `DELETE /api/library/documents/:id/links/:targetId?relation=<rel>`:
  - 400 invalid id/targetId/relation. 200 (returns updated outbound links list) when removed;
    404 `{message:'link not found'}` when no matching edge.

All routes follow the existing `isValidUuid` + `{ message }` conventions. `registerLibraryRoutes`
gains `options.documentLinksRepository` (default `createDocumentLinksRepository(app.db)`), wired
in `server/index.js` alongside the other repositories.

## 5. MCP — new `mcp/tools/documentLinks.js`

Three tools, registered in `mcp/server.js`:

| Tool | Inputs | Read-only | Output |
|------|--------|-----------|--------|
| `list_document_links` | `documentId:str`, `direction?: enum(outbound,inbound,both)` | yes | capped (20) array of `{documentId, title, documentType, projectId, relation, direction}` |
| `link_documents` | `sourceId:str`, `targetId:str`, `relation: enum(derived-from,supersedes)` | — | `{ linked:true, sourceId, targetId, relation, links: [...] }` |
| `unlink_documents` | `sourceId:str`, `targetId:str`, `relation: enum(...)` | — | `{ unlinked:true, sourceId, targetId, relation }` |

- UUID validation via `isValidUuid`; `withErrorHandling`; `okResult`/`errorResult`; `capResults`.
- **Safety-by-omission preserved:** `unlink_documents` is reversible; **no** hard-delete tool.

**Client (`mcp/moomoraClient.js`):**
- Add a `getOrNull(path)` helper mirroring `patchOrNull` (returns `null` on 404).
- Switch `getDocument(id)` → `getOrNull('/api/library/documents/' + id)` and `getTask(id)` →
  `getOrNull('/api/tasks/' + id)` (replaces the list-and-filter; the real efficiency win).
- Add `linkDocuments(sourceId, targetId, relation)` → POST `.../:sourceId/links` body
  `{targetId, relation}`; `unlinkDocuments(...)` → DELETE `.../:sourceId/links/:targetId` query
  `{relation}`; `listDocumentLinks(documentId, direction)` → GET `.../:documentId/links` query
  `{direction}`.

## 6. Demo server — `scripts/demo-server.js`

The dual-write mirror: add a module-level `documentLinks = []`, an in-memory
`documentLinksRepository` (link/unlink/list with the same return shapes), a `getDocument(id)` on
the in-memory library repo, and pass `documentLinksRepository` into `buildApp` so the new routes
serve under `npm run demo`.

## 7. Reference + regression docs

- `docs/contract.md` — add the three new MCP tools and the new endpoints to the reference.
- `mcp/README.md` — list the new tools.
- `tests/contract/mcpToolContract.test.js` — add the three tools to the regression set
  (names + input fields + relation/direction enums).

## 8. Testing

- `tests/backend/documentLinksRepository.test.js` — build* query text/values; method return
  shapes against an in-memory `db` stub.
- `tests/backend/documentLinksRoutes.test.js` — link (201/200), self-link (400), missing doc
  (404), unlink (200/404), list by each direction, bad uuid/relation/direction (400), via
  `buildApp({skipDb, ...fakes})`.
- `tests/backend/detailRoutes.test.js` — `GET /api/library/documents/:id` and `GET /api/tasks/:id`
  (200/404/400).
- `tests/mcp/documentLinksTools.test.js` — the three tools with a stub client (arg mapping,
  output shapes, uuid/enum validation).
- Demo parity — a check that `npm run demo`'s app serves the new routes (extend an existing
  demo/route test or add one).

## File structure

- Create: `server/migrations/0002_add_document_links.sql`, `server/documentLinksRepository.js`,
  `mcp/tools/documentLinks.js`, and the test files above.
- Modify: `server/libraryRepository.js` (getDocument), `server/libraryRoutes.js` (detail + links
  routes + repo wiring), `server/tasksRoutes.js` (task detail route), `server/index.js`
  (wire documentLinksRepository), `mcp/server.js` (register tools), `mcp/moomoraClient.js`
  (getOrNull + new methods), `scripts/demo-server.js` (mirror), `docs/contract.md`,
  `mcp/README.md`, `tests/contract/mcpToolContract.test.js`.

## Archive semantics (made explicit)

- **Linking** requires both endpoints to be **live** (non-archived) — the insert's existence
  guard checks `archived_at is null` on both, mirroring the task-link behavior.
- **`list_document_links`** joins only to **non-archived** documents, so an edge whose other end
  was archived after linking is hidden from traversal (archived = soft-deleted, out of the
  active graph).
- **Detail-by-id** (`GET /api/library/documents/:id`, `GET /api/tasks/:id`) returns the record
  **regardless of archive state** — any record is addressable by id. This is a deliberate, minor
  improvement to the MCP `get_document`/`get_task` tools, which previously returned `null` for
  archived records (they filtered the active list); via the new `/:id` endpoints they now resolve
  archived records too.

## Out of scope (deferred — phase 2 "maintenance loop")

- Export serialization / front-matter v2 (link portability in exported `.md`).
- Content hash + edit-origin (path-stamped) + `kind` (source/synthesized).
- Maintenance queries: orphan detection, stale detection.
- Any frontend UI for doc↔doc links.
