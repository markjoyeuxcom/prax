# Prax — Data Formats & Shapes

This document describes the **current** shapes of Prax's externally-consumed data:
the export/import formats (`moomora.tasks` task backups, library `.md` front-matter) and the
MCP tool surface. It's a reference for anyone writing backups, integrations, or MCP clients.

**These shapes are not frozen.** Prax is pre-1.0 and the data model is still evolving
(for example, planned document links and provenance). The regression tests under
`tests/contract/` lock the *current* shapes so that changes are caught and made deliberately
rather than by accident — they are a safety net, **not a stability promise**.

## Scope

- **Externally consumed** — the export/import formats and the MCP tool surface. These are the
  surfaces worth keeping stable where practical, because backup files and MCP clients live
  outside the app. When the project reaches 1.0 these are expected to stabilise and future
  breaking changes will be versioned (an export envelope `version` bump, MCP changes called out
  in release notes). Until then, treat them as evolving.
- **Internal** — the HTTP API (`/api/…`). Consumed only by the co-shipped frontend and the
  local MCP server (released together as one image); it may change between any release. For
  durable integration prefer the export formats or the MCP server.

### Forward-compatibility tip for consumers

Importers and MCP clients should **ignore unknown fields** rather than hard-fail — the server
may add fields over time.

## Format 1 — Task export/import (`moomora.tasks`)

### Export envelope (`GET /api/tasks/export`)

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "requestId": "11111111-1111-4111-8111-111111111111",
  "exportedAt": "2026-05-29T12:00:00.000Z",
  "project": "homelab",
  "tasks": []
}
```

- `format` is the exact, case-sensitive string `"moomora.tasks"`.
- `version` is the integer `1`.
- `project` is the project slug, or `"all"` for a cross-project backup.

### Task object

| Field | Type |
|-------|------|
| `id` | UUID |
| `title` | string (required) |
| `description` | string (`""` if unset) |
| `notes` | string (`""` if unset) |
| `priority` | `"high"` \| `"medium"` \| `"low"` |
| `status` | `"high-priority"` \| `"in-progress"` \| `"planned"` \| `"completed"` \| `"notes"` |
| `projectId` | UUID |
| `dueDate` | `"YYYY-MM-DD"` \| `null` |
| `dueTime` | `"HH:MM"` \| `null` |
| `deferredUntil` | ISO-8601 timestamp \| `null` (snooze target; hidden from Today until it passes) |
| `recurrence` | `daily` \| `weekly` \| `monthly` \| `every:Nd` \| `every:Nw` \| `null` |
| `labels` | string array |
| `checklist` | checklist item array (`label`, `completed`, plus runtime metadata) |
| `sortOrder` | 32-bit signed integer |
| `plannedFor` | `"YYYY-MM-DD"` \| `null` — the day this task was consciously pulled into (the Today plan working set). Client-writable; orthogonal to due dates and status. |
| `carryCount` | non-negative integer — times an unfinished planned item was consciously rolled to a later day (the shutdown ritual's Carry, or a stale plan pulled forward). Server-computed on PATCH; never accepted from patch payloads; round-trips through export/import. |
| `deferralCount` | non-negative integer — times the task was consciously pushed (snoozed into the future, or due date moved later while open). Server-computed on PATCH; never accepted from patch payloads; round-trips through export/import. Counting began at migration `0020` — earlier history was never recorded, so older tasks honestly start at 0. |
| `createdAt` | ISO-8601 timestamp |
| `updatedAt` | ISO-8601 timestamp |
| `archivedAt` | ISO-8601 timestamp \| `null` |

### Import (`POST /api/tasks/import`)

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "project": "homelab",
  "mode": "skip",
  "tasks": [{ "title": "Restore drill" }]
}
```

- `project` (slug or id) is **required**. `format` is validated if present; when `version` is
  present it must be the integer `1`. Importers must reject unknown versions rather than silently
  interpreting them as v1.
- `requestId` is an optional caller UUID for exact-once batch retry. The first normalized import
  intent commits its task/checklist mutation and durable result together. Replaying the same UUID
  and intent performs no mutation and returns the original result with `"replayed": true`; reusing
  it for different normalized intent returns `409`. The Settings UI always supplies and retains one
  until the commit is confirmed, including after reload when the same file/destination/mode is selected.
- `projectId` is assigned server-side and is **never** read from the payload.
- Per-task accepted fields: `title` (required), `description`, `notes`, `priority` (default
  `"medium"`), `status` (default `"planned"`), `dueDate`, `dueTime`, `deferredUntil`,
  `recurrence`, `labels`, `checklist`, `sortOrder` (defaults to the array index), `archivedAt`,
  `deferralCount` (non-negative integer; invalid values are rejected with `400`, not clamped),
  `plannedFor` (`YYYY-MM-DD`), `carryCount` (non-negative integer; same 400-not-clamp rule).
- Checklist item IDs/timestamps are regenerated on import; label, completion state, and order are
  preserved.
- Task IDs, `projectId`, `createdAt`, and `updatedAt` are runtime identity: they are regenerated or
  remapped to the selected target project. Every field in the accepted-fields list is preserved
  semantically; `description` and `notes` preserve exact whitespace.
- The direct endpoint accepts up to **5,000 tasks** and a **50 MiB** request body. Larger exports
  use the staged import protocol below; its total task count has no fixed record cap.
- Up to **10,000 checklist items per task** are accepted by the task candidate validator.
- **Modes:** `"skip"` (default — skip duplicates), `"append"` (insert all as new),
  `"replace"` (clear the target project, then insert).
- **Duplicate key** (skip mode): `[ title (lowercased), projectId, status, dueDate ]`.
- Response: `{ "mode", "imported": <count>, "skipped": <count>, "tasks": [], "replayed"?: <boolean> }`.
- In the shipped SQLite path, task rows, checklist rows, and a replace-mode project deletion commit
  in one transaction. A failed checklist write cannot leave a partially imported project.

## Format 2 — Library `.md` front-matter

Library export (`GET /api/library/export`) produces a ZIP of `.md` files. Each file is YAML
front-matter followed by the Markdown body, in this key order:

The Prax UI opens a scope/destination dialog before calling this route. Desktop Prax uses a native
Save dialog, browsers with File System Access use their Save picker, and other browsers download to
their configured Downloads location. These host behaviors do not alter the HTTP/export format.

```markdown
---
title: Postgres restore
type: runbook
project: homelab
tags:
  - postgres
  - dr
created_at: 2026-04-12T10:33:21.000Z
updated_at: 2026-05-20T08:11:09.000Z
kind: synthesized
content_hash: 47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d
updated_by: agent
links:
  derived-from:
    - id: c58d3108-4f93-4a50-ac42-0c1d61e61b08
      ref: homelab/cloudnativepg-restore.md
  supersedes: []
---

# Postgres restore

Steps...
```

- `type` is one of `"note"`, `"runbook"`, `"decision"`, `"known-issue"`, `"reference"`, `"post-mortem"` (defaults to `"note"`; the registry lives in `public/js/documentTypes.js`).
- `project` is the project slug, or `"unknown"`.
- `tags` is `[]` when empty, otherwise a YAML block list.
- `created_at` / `updated_at` are the raw timestamps (not quoted).
- `kind` is `source` or `synthesized` (unquoted). `source` is the default and indicates a
  hand-authored document; `synthesized` indicates an agent-generated derivation.
- `content_hash` is the SHA-256 hex digest of the document body, lowercase, 64 characters,
  unquoted. It is recomputed on every write.
- `updated_by` is `user` or `agent` (unquoted). Set from the `x-prax-origin` request
  header on every write; the MCP client sends `agent` automatically.
- A value is YAML-quoted when it contains `:`, `"`, `\`, a newline, or `#`, or starts with
  `-`, or starts/ends with whitespace; inside quotes, `\` → `\\`, newline → `\n`, `"` → `\"`.
- **Filenames:** prefer `sourceFilename` (basename only, leading dots stripped, `.md`
  appended if missing); else the slugified title + `.md`; else `untitled.md`. Collisions
  within a folder get a `-2`, `-3`, … suffix.
- **ZIP layout:** `prax-library-<scope>-<YYYY-MM-DD>.zip`, with entries under
  `<project-slug>/<file>.md` for an all-projects export (flat for a single project).

### `links:` block

The `links:` block is always present, even when a document has no outbound edges — matching
the `tags: []` convention. It captures outbound edges only; inbound edges are derivable from
the rest of the export.

Each entry is a `{ id, ref }` pair:

- `id` — the target document UUID. **Authoritative.** Use this for any programmatic
  resolution (live API lookup, cross-export join).
- `ref` — a path-style hint. **Not authoritative.** Computed to match where the target
  lives in the zip when possible, so humans and diff tools can navigate the export without
  a database. `ref` computation rules, in priority order:
  1. **All-projects export** (any target project): `<targetProjectSlug>/<targetFilename>`.
     Resolves to a file in the zip.
  2. **Single-project export, target in the same project**: bare `<targetFilename>`.
     Resolves to a file in the zip (the single-project zip is flat, no project-slug folder).
  3. **Single-project export, target in a different project**: `<targetProjectSlug>/<targetFilename>`.
     This ref **dangles by design** — the target is not in the zip. The `id` remains
     authoritative and can resolve the target against the live API or a different export.

  `targetFilename` follows the same logic as the zip-entry filename: `sourceFilename`
  basename, else slugified title, else `untitled.md`.

Two relation keys are always present under `links:`, in this order: `derived-from` then
`supersedes`. Empty relations render inline (`derived-from: []`); non-empty render as YAML
block sequences with `id:` before `ref:` per entry.

### Single-doc export route

`GET /api/library/documents/:id/export` returns a single document rendered as v2 markdown
(`text/markdown; charset=utf-8`) with `Content-Disposition: attachment; filename="<documentFilename>"`.
The server fetches the document's outbound links and computes refs in single-project scope
before rendering. Returns 404 for a missing or archived document, 400 for an invalid UUID.

**Not currently supported:** library `.md` / document **import (round-trip)**. Library export
is one-way today. **Import Markdown…** opens an explicit destination-project dialog and creates one
project-owned source note per selected file. It retains the file body/filename but does not parse
Prax front matter or restore type, provenance, trust, or graph links. The dialog retains failed files,
reports committed and remaining counts separately, and offers an exact-once-safe retry.

`POST /api/library/documents` requires `project` and accepts an optional caller UUID `id`. With an
`id`, the first create returns `201`; replaying the same create intent returns the existing document
with `200`; reusing the UUID for different title/body/type/project/tags/source/provenance intent
returns `409`. Without `id`, ordinary server-identified creation is unchanged. Documents are also
created/edited through the MCP `create_document` / `update_document` tools.

## Format 3 — MCP tools

The MCP server (`mcp/`) exposes these tools over stdio. Current tool names, input field names,
required/optional status, and enum option sets. Shared enums: `STATUS`
(`high-priority`, `in-progress`, `planned`, `completed`, `notes`), `PRIORITY` (`high`,
`medium`, `low`), `DOCUMENT_TYPE` (`runbook`, `note`, `decision`, `known-issue`, `reference`, `post-mortem`),
`KIND` (`source`, `synthesized`).

| Tool | Inputs | Read-only |
|------|--------|-----------|
| `search_tasks` | `query?`, `project?`, `status?:STATUS`, `filter?`, `limit?`, `offset?` | yes |
| `get_task` | `id` | yes |
| `create_task` | `title`, `project`, `id?`, `description?`, `priority?:PRIORITY`, `status?:STATUS`, `dueDate?`, `dueTime?`, `recurrence?`, `labels?` | — |
| `update_task` | `id`, `title?`, `description?`, `notes?`, `priority?:PRIORITY`, `status?:STATUS`, `project?`, `dueDate?`, `dueTime?`, `recurrence?`, `labels?` | — |
| `search_documents` | `query?`, `project?`, `documentType?:DOCUMENT_TYPE`, `tags?`, `kind?:KIND`, `status?:{active\|superseded\|deprecated\|all}`, `limit?`, `offset?` | yes |
| `ask_library` | `query`, `project?`, `limit?` → Markdown context pack (semantic when configured, keyword otherwise) | yes |
| `get_document` | `id` | yes |
| `create_document` | `title`, `body`, `documentType:DOCUMENT_TYPE`, `project`, `id?`, `tags?`, `kind?:KIND` | — |
| `update_document` | `id`, `title?`, `body?`, `documentType?:DOCUMENT_TYPE`, `project?`, `tags?`, `kind?:KIND` | — |
| `list_task_documents` | `taskId`, `limit?`, `offset?` | yes |
| `link_task_document` | `taskId`, `documentId` | — |
| `unlink_task_document` | `taskId`, `documentId` | — |
| `list_task_checklist` | `taskId`, `limit?`, `offset?` | yes |
| `add_checklist_item` | `taskId`, `label`, `itemId?` | — |
| `set_checklist_item` | `taskId`, `itemId`, `completed` | — |
| `delete_checklist_item` | `taskId`, `itemId` | — |
| `list_task_activity` | `taskId`, `limit?`, `offset?` | yes |
| `list_document_links` | `documentId`, `direction?:{outbound\|inbound\|both}`, `limit?`, `offset?` | yes |
| `link_documents` | `sourceId`, `targetId`, `relation:{derived-from\|supersedes}` | — |
| `unlink_documents` | `sourceId`, `targetId`, `relation:{derived-from\|supersedes}` | — |
| `supersede_document` | `documentId`, `supersededBy` | — |
| `list_external_refs` | `documentId`, `limit?`, `offset?` | yes |
| `add_external_ref` | `documentId`, `url`, `label?` | — |
| `remove_external_ref` | `documentId`, `refId` | — |
| `list_stale_documents` | `project?`, `limit?`, `offset?` | yes |
| `list_orphan_documents` | `project?`, `limit?`, `offset?` | yes |
| `search_documents_semantic` | `query`, `project?`, `limit?`, `offset?` | yes |
| `start_runbook_run` | `documentId`, `title?`, `runId?` | — |
| `list_runbook_runs` | `documentId`, `limit?`, `offset?` | yes |
| `get_runbook_run` | `runId` | yes |
| `set_run_step` | `runId`, `stepId`, `checked` | — |
| `set_run_status` | `runId`, `status:{running\|completed\|aborted}` | — |
| `ask_prax` | `query`, `project?`, `limit?` → grounded answer or degraded context pack | yes |
| `generate_post_mortem` | `runId`, `documentId?` | — |
| `generate_runbook` | `description`, `project`, `documentId?` | — |

MCP-owned output shapes:

- Task summary (from `search_tasks`): `{ id, title, status, priority, projectId, dueDate, labels }`.
- Document summary (from `search_documents`): `{ id, title, documentType, projectId, tags, snippet }` (snippet ≤ 200 chars).
- `link_task_document` → `{ linked: true, taskId, documentId, documents: [] }`.
- `unlink_task_document` → `{ unlinked: true, taskId, documentId }`.
- `delete_checklist_item` → `{ deleted: true, taskId, itemId }`.
- Task activity items include `actor: "user"|"agent"`; MCP task writes stamp `agent` through
  `x-prax-origin`, while pre-migration history defaults to `user`.

Collection tools return a versioned pagination envelope rather than a bare array:

```json
{
  "schemaVersion": 1,
  "items": [],
  "page": {
    "offset": 0,
    "limit": 20,
    "returned": 0,
    "total": 0,
    "hasMore": false,
    "nextOffset": null
  }
}
```

- `limit` defaults to 20 and must be an integer from 1 through 50.
- `offset` defaults to 0 and must be a non-negative integer.
- `total` is the exact size of the matching collection.
- When `hasMore` is true, pass `nextOffset` as the next call's `offset`.
- The envelope applies to every `search_*` / `list_*` tool whose primary result is a
  collection: task/document search, task links/checklists/activity, document links/external
  refs, graph maintenance, semantic search, and runbook-run history.
- `search_documents_semantic` returns a friendly non-collection message when semantic search
  is unavailable, directing the caller to keyword search.

Runbook execution records are independent runtime data. A full run returned by
`GET /api/library/runs/:runId` / `get_runbook_run` has this additive shape:

```json
{
  "id": "uuid",
  "documentId": "uuid-or-null",
  "documentTitle": "snapshotted source title",
  "projectId": "uuid-or-null",
  "title": "optional operation label",
  "status": "running | aborted | completed",
  "startedBy": "user | agent",
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601-or-null",
  "finishedBy": "user | agent | null",
  "steps": [],
  "events": []
}
```

Steps are the snapshotted instructions plus current checkbox state. Events are ordered by a
monotonic `sequence` and contain `{ id, runId, sequence, type, stepId, stepText, actor,
createdAt }`; `type` is `started`, `step-checked`, `step-unchecked`, `aborted`, `resumed`, or
`completed`. The event ledger is append-only. Deleting the source document sets `documentId` to
`null` but retains the run, source-title/project snapshot, steps, and events.

`POST /api/library/documents/:id/runs` accepts `{ "title"?: string, "id"?: uuid }`. Supplying
`id` makes start retry-safe: the first request returns `201`; the same start intent returns the
existing run with `200`; conflicting reuse returns `409`. Only non-archived runbook documents may
start. `PATCH /api/library/runs/:runId/steps/:stepId` changes steps only while running.
`PATCH /api/library/runs/:runId` enforces `running → aborted|completed` and
`aborted → running`; completed is terminal. Same-state requests are idempotent and preserve the
original timestamp/actor without appending another event. Invalid transitions return `409`.

Full-record tools (`get_task`, `get_document`, `create_*`, `update_*`) return the full task or
document record (the fields in the tables above). Operations intentionally **not** exposed over
MCP — archive, permanent delete, reorder, project CRUD, task import/export, library export —
remain HTTP-only.

Machine creation identity is caller-stable and exact-once. `create_task` and `create_document`
accept optional `id`; `add_checklist_item` accepts optional `itemId`; `start_runbook_run` accepts
`runId`; and generated-document tools accept optional `documentId`. MCP allocates one when omitted.
An exact retry returns the original record, conflicting identity reuse returns 409, and a transport
failure that remains unresolved reports an **unknown outcome plus the retry ID** rather than claiming
the write failed. The MCP client retries these and other declared-idempotent writes once after a
transport failure. Mutation annotations expose `idempotentHint`; overwrite/removal/lifecycle tools
also expose `destructiveHint`.

Child collections are owner-aware: task documents/checklists/activity and document links/external
refs/run history return 404 for a missing task/document, while a valid owner with no children returns
an empty collection. Relationship/ref/checklist removals implement desired absence: replaying a
removal for an existing owner succeeds with the current empty/remaining collection (or 204 for a
checklist item); a missing owner remains 404.

Context packs include `retrieval: { mode: "semantic"|"keyword"|"recency", fallback, reason }`
in JSON and render the same status in Markdown. `ask_prax` also preserves known generation and
retrieval degradation in its prose result; it never strips fallback metadata from the HTTP response.

Document graph: `document_links` are directed, typed edges (`derived-from`, `supersedes`)
between documents, created/removed/listed via the tools above and the
`/api/library/documents/:id/links` endpoints. `GET /api/library/documents/:id` and
`GET /api/tasks/:id` fetch a single record by id (returning archived records too). Outbound
links are serialized into the `links:` block of every exported `.md` file (see Format 2).

External references: `document_external_refs` attach outside URLs (a PR, a dashboard, an
upstream issue) to a document without copying the content. Each ref is
`{ id, documentId, url, label, createdAt }`, unique per `(document, url)`, deleted with the
document. Served at `GET`/`POST`/`DELETE /api/library/documents/:id/external-refs` and the
`list_external_refs` / `add_external_ref` / `remove_external_ref` MCP tools; `prax remember
--ref <url>` attaches one from the CLI. The POST is an **idempotent upsert**: `201` on first
attach, `200` when the URL is already present (the label is refreshed either way — re-adding
without a label clears it), `404` for a missing or archived document, `400` for an empty URL.
URLs are stored **as entered** (no format validation; caps: URL ≤ 2048 chars, label ≤ 200),
except that control whitespace is stripped — a newline inside a URL or label would corrupt
the editor's line-per-ref round-trip. Display kind (GitHub / GitLab / Link) is derived from
the host at render time and never stored; the UI only renders `http(s)`/`mailto` URLs as
clickable links. Refs are runtime metadata, **not** part of the portable `.md` export
(like the trust fields).

Generated runbooks and post-mortems accept an optional result-document `id` over HTTP. Their result
document stores an internal operation kind and SHA-256 hash of canonical caller intent. A retry
checks that receipt before invoking the model, returns `200` with `replayed: true`, and does not
generate again. The same ID with changed intent returns 409. The receipt is runtime-only and is not
part of full document records or portable export.

Document provenance: documents expose `contentHash` (SHA-256 of the body), `updatedBy`
(`"user"` | `"agent"`) and `updatedByAgent` (a short lowercase id such as `"claude"` or
`"codex"`, or `null`). Every document write stamps `updatedBy` from the `x-prax-origin`
request header; the MCP client sends `"agent"` automatically. `updatedByAgent` is taken from the
`x-prax-agent` header only on an agent write (`[a-z0-9][a-z0-9._-]{0,63}`, anything else is
`null`) and is cleared by a human edit, so it always describes the current revision's author. It
is an API field (migration 0026, column `updated_by_agent`); the portable Markdown export does
not carry it.

`POST /api/library/documents/upsert-by-title` is the atomic "remember": body `{ project, title,
body, tags?, documentType?, kind?, id? }`. Inside one transaction it updates the **active**
document with that exact title in the project (replacing body and tags, retyping only when
`documentType` is given) or creates one (`documentType` defaults to `note`). Superseded and
deprecated documents never match. Returns `{ document, created }` — `201` for a new document,
`200` for an update; with a caller `id`, replaying the same create returns the existing document
with `200`, and reusing the id for different content is `409`. `derived-from` links snapshot
the target document's `contentHash` at link time and refresh it on re-link. The maintenance
tools `list_stale_documents` and `list_orphan_documents` drive a client-side groom loop:
stale documents are derived docs whose source changed since the snapshot (each result includes
`updatedBy` so a loop can skip hand-edited docs); orphan documents have no inbound or outbound
links. Both tools are served at `GET /api/library/maintenance/stale` and
`GET /api/library/maintenance/orphans`.

Document `kind` distinguishes hand-authored documents (`"source"`) from agent-synthesized
derivations (`"synthesized"`). It is set explicitly by callers (defaulting to `"source"`),
mutable via `update_document`, and independent of `derived-from` edges and the
`x-prax-origin` edit-origin header. Read paths (`get_document`, search rows, stale/orphan
rows) include `kind`; the create/update tools accept it as an optional input.

### Exact document revisions and conditional updates

Full document records expose `revision`: SHA-256 over UTF-8 `JSON.stringify([storedTitle, storedBody])`.
`contentHash` remains SHA-256 of body only, preserving the export and derived-from contract.
`PATCH /api/library/documents/:id` accepts optional `ifRevision`; with it, the update commits
atomically only if the baseline matches. A mismatch returns 409
`{message,reason:"revision-mismatch",document:<current full record>}`. Send only edited fields.
The browser merges independent title/body edits and retains conflicting drafts for explicit review.
MCP/legacy HTTP partial patches without `ifRevision` remain unconditional.

### Trust fields

Documents carry four runtime trust/workflow fields. These are **not** part of the portable
`.md` export front-matter — the export shape is unchanged (trust state is not carried in the
export). If `.md` import is added in the future, an imported document would start unverified;
trust state is managed via the `verify`/`supersede` endpoints below.

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | `true` when a human has blessed the document. Agent writes (MCP `create_document` / `update_document`, CLI `remember`) land `false` by default; the consolidated SQLite schema seeds trust by origin: `updated_by = 'user'` → `true`, `updated_by = 'agent'` → `false`. |
| `verifiedAt` | ISO-8601 timestamp \| `null` | When the document was last verified (or unverified). `null` when `verified` is `false` and has never been set. |
| `verifiedBy` | string \| `null` | Who verified the document (a name, `"cli"`, `"user"`, etc.). `null` when unverified. |
| `status` | `"active"` \| `"superseded"` \| `"deprecated"` | Lifecycle state. New documents are `"active"`. A live inbound `supersedes` link makes an active document `"superseded"`. `"deprecated"` is reserved for manual use (stale, no replacement). |

All read paths that return document records (`get_document`, search rows, stale/orphan rows,
context-pack items) include these four fields. Retrieval is **active-only** by default: only
documents with `status = 'active'` appear in semantic search, the context-pack, the
`search_documents` MCP tool, and CLI recall (each accepts an explicit status/`--all` override
for curation). The raw `GET /api/library/documents` route is the exception: it returns **all
non-archived statuses** unless `?status=active|superseded|deprecated` is passed, because the
web UI lists superseded documents with their trust chips. Raw HTTP callers doing retrieval
should pass `status=active`.

**Trust under no-auth:** `verified` is a workflow signal, not access control. Under the
trusted-network model anyone on the network can call the verify endpoint. See
[SECURITY.md](../SECURITY.md).

### Trust endpoints

These endpoints manage the trust/lifecycle state of library documents. `verify` is
deliberately **not** exposed as an MCP tool — verification is a human act (Library UI button
or attended `prax verify <id> --as <human-name>` with document-specific confirmation), so
`verified` keeps meaning "a human blessed it." `supersede` **is**
available to agents via the `supersede_document` MCP tool (content lifecycle, not self-blessing),
in addition to the HTTP route below.

`POST /api/library/documents/:id/verify`

Body: `{ "verified": <boolean>, "as": "<name>", "revision"?: "<sha256>", "contentHash"?: "<sha256>" }`.
`as` defaults to `"user"` for verification. Setting `verified:true` requires the exact
`revision` displayed to the human; omission is 400. A mismatch is 409 with
`reason:"revision-mismatch"`, and verification does not change. An optional `contentHash`
must match as well. Unverification does not require a revision. Same-state replay preserves the
first reviewer/timestamp. The full document record is returned. The Health action opens the document
for review; the editor refuses to verify an unsaved draft.

`POST /api/library/documents/:id/supersede`

Body: `{ "supersededBy": "<newDocumentId>" }`. Records a `supersedes` link from `newDocumentId`
to the old document; SQLite derives the old document's `status = "superseded"` atomically in the
same statement. Returns the
full updated old-document record (400 on invalid UUIDs or self-supersede, 404 if either
document is not found).

The typed relation is the lifecycle source of truth for every path, including generic
`POST .../:id/links` / `link_documents`. Removing a `supersedes` edge, archiving its source, or
permanently deleting its source reactivates the target only when no other live replacement remains;
restoring the source reapplies the relation. Migration `0012` reconciles older databases as it
installs these invariants. Consequently a machine caller cannot receive a successful relation
write while leaving lifecycle status incoherent.

`GET /api/projects/:idOrSlug/context-pack`

Query parameters: `query` (optional, used for semantic ranking when embeddings are on),
`limit` (default `12`, max `50`), `format` (`md` or `json`, default `md`). `limit` is a
single **pack-wide** document budget, spent in section order (overview → relevant →
runbooks → unverified) — the pack never contains more than `limit` documents. Returns a
bounded, trust-aware context briefing for the project: verified documents by section, with
unverified documents quarantined in a `⚠ Unverified — pending human review` section. When
`format=md` the response is `text/markdown`; when `format=json` it is a JSON object with a
`sections` array. Semantic ranking is used when a `query` is given and embeddings are on;
falls back to recency otherwise.

Semantic search ranks documents by embedding similarity (meaning), not keywords, so a
paraphrased query can find topically-relevant docs that share no words with it. It is
**retrieval-only** — no text is generated. Embeddings are stored in SQLite and cosine-ranked in
process; no vector extension is required. It requires a configured `EMBEDDING_BACKEND`: `ollama`, `openai` (any
OpenAI-compatible `/v1/embeddings` server — real OpenAI, llama.cpp, vLLM, LiteLLM, … via
`OPENAI_BASE_URL` + optional `OPENAI_API_KEY`), or the deterministic `fake` test backend. The
default `EMBEDDING_BACKEND=none` leaves the feature absent. On top of that config gate, a
server-side runtime toggle (stored in the `app_settings` table, key `semantic_search_enabled`)
turns it on and off live, consistently across the UI and MCP; all backend config (URLs, models,
keys) is env-only. An optional `EMBEDDING_QUERY_PREFIX` is prepended to **search-query** embeddings
only (never to document embeddings) for instruct-tuned models — e.g. `qwen3-embedding`'s
`Instruct: …\nQuery:` or `nomic`'s `search_query: ` — so changing it needs no reindex.
`search_documents_semantic` returns trust-bearing references (`id`, `title`, `documentType`,
`projectId`, `tags`, `snippet`, `kind`, `updatedBy`, `verified`, `verifiedAt`, `verifiedBy`,
`stale`, `status`, and `similarity`); the embedding vector is never returned. When the feature is
disabled or not configured the tool yields a friendly fallback
message (use `search_documents` instead) rather than an error. The supporting routes —
`GET /api/library/documents/semantic-search` (cosine-ranked refs; 409 when disabled, 400 on a
blank query, 503 when a configured backend is unreachable), `POST /api/library/embeddings/reindex`
(rebuilds/repairs the index — add `?force=true` to re-embed **every** active document, e.g. after
changing the embedding model or upgrading), and `GET`/`PUT /api/settings/semantic-search`
(read-only status + the boolean toggle) — are **HTTP-only** and not part of the MCP surface. Each
document is embedded as its **title + body** together (so a query matching the title retrieves it).

The HTTP search keeps its legacy complete array response by default. Explicit pagination uses
`?page=true&limit=<1..50>&offset=<non-negative integer>` and returns
`{ items, page: { offset, limit, returned, total, hasMore, nextOffset } }`; `total` is the exact
number of relevant results after the configured cutoff. The web UI uses this envelope and offers
Load more until all results are visible.

Results are filtered by a gap-based relevance cutoff: only documents scoring within
`EMBEDDING_SEARCH_TOP_DROP` (default 0.20) of the best match and at least
`EMBEDDING_SEARCH_MIN_SIMILARITY` (default 0.45) cosine similarity are returned, so an unrelated
query can return few or no results rather than the whole ranked library. Both thresholds are
env-tunable (defaults calibrated for `qwen3-embedding:0.6b`).

`POST /api/library/ask` accepts `{ q, project?, limit? }` and returns a grounded answer or the
retrieved context pack. Its response includes `sources` with trust fields and
`retrieval: { mode: "semantic"|"keyword", fallback, reason }`. Semantic failure or no-match
keyword fallback is explicit. Generated answers over a non-empty source set must cite an exact
retrieved title; otherwise the route returns `degraded: true`,
`reason: "citation-validation-failed"`, and the context pack instead. Provider exceptions are
logged server-side and are never returned verbatim.

## Format 4 — iCalendar task feed (`GET /api/calendar.ics`)

An RFC 5545 `VCALENDAR` of open dated tasks (`text/calendar; charset=utf-8`), for subscription
from Apple Calendar, Thunderbird, or any consumer that takes a URL. Inclusion matches the in-app
calendar grid: a task appears iff it has a `dueDate`, is not `completed`, not `notes`
(design-vocab backlog), not archived, and not snoozed (`deferredUntil` in the future).
`?project=<slug|id>` scopes the feed to one project and names the calendar
`Prax — <Project>` (400 on an unknown project); unscoped feeds are named `Prax`.

Event shape (one `VEVENT` per task instance; serialization in `server/icsFeed.js`):

- `UID` is `<taskId>@prax` — **stable across refreshes**, so consumers update events in place.
- A task without `dueTime` is an **all-day event** (`DTSTART;VALUE=DATE` + exclusive next-day
  `DTEND`; the `DTEND` is omitted for a due date whose next day cannot be expressed as an
  8-digit RFC date, i.e. `9999-12-31` — the spec default of a one-day event applies).
- A task with `dueTime` uses a **floating local** `DTSTART` (no `TZID`, no `Z`): Prax stores
  wall-clock times, and floating means "09:00 wherever the reader is", matching the app.
- `SUMMARY` = title, `DESCRIPTION` = description (both RFC-escaped), `CATEGORIES` = project
  name, `PRIORITY` maps high/medium/low → 1/5/9, `DTSTAMP` from `updatedAt`.
- Recurring tasks carry **no `RRULE`** deliberately: Prax spawns the next instance server-side
  on completion, so an `RRULE` would double-count future occurrences.
- Lines are CRLF-terminated and folded at 75 octets (multibyte-safe).

## Regression tests

The shapes above are locked by characterization tests under `tests/contract/`, run by
`npm test`. They guard against *accidental* changes: a change to any shape turns a test red, so
you either revert it or update the test (and this document) **on purpose**. They are a safety
net for evolving the formats carefully — not a 1.0 stability guarantee.

## Staged task imports

The UI uses this protocol for 500 or more tasks, or a payload of at least 512 KiB. Each upload
normally contains at most 200 records and about 512 KiB (a larger individual record gets its own
chunk). The server per-chunk body limit is 50 MiB; resource failures are explicit. No workspace
mutation occurs before commit.

1. `POST /api/tasks/import-sessions`: `{requestId,project,mode?,format?,version?}` →
   `{sessionId,project,mode,status:"open"|"committed",replayed?}`.
2. `PUT /api/tasks/import-sessions/:requestId/chunks/:index`: `{tasks:[...]}` →
   `{sessionId,chunkIndex,taskCount,replayed?}`. Indices are zero-based. Identical chunk retries
   succeed; changed content under the same identity is 409. Replay all chunks even if the session
   is committed so its retained manifest validates the requested content.
3. `POST /api/tasks/import-sessions/:requestId/commit`: `{chunkCount}` → the ordinary import
   result. Missing chunks/gaps are rejected. Tasks, checklists, replace deletion and the durable
   result receipt commit together. Retry returns the original result without repeating mutation.
   Request IDs cannot cross between direct imports and staged sessions.
4. `DELETE /api/tasks/import-sessions/:requestId` cancels an open upload. It cannot undo a
   committed import or erase its replay protection.

## Retrieval freshness and empty-result semantics

Library keyword terms preserve Unicode letters/numbers; a nonblank query without usable terms
returns an empty match set. Task text search treats `%` and `_` literally.

Semantic retrieval uses only vectors matching the current document revision and active embedding
model. Legacy body-only hashes cannot prove title freshness and require reindexing. Paged semantic
search reports `index:{total,embedded,pending}`; pending vectors produce
`degraded:true,reason:"index-incomplete"`. Semantic context-pack/Ask retrieval metadata carries
index coverage too. No stale vector is presented as a current semantic match.

`GET /api/library/documents/:id/similar` now returns
`{items:[...],degraded:false}`, or `{items:[],degraded:true,reason}` where the reason includes
`semantic-off`, `not-indexed`, or `unavailable` for a repository without that capability. Missing owners return 404 for this route and the document's
`/tasks` child collection.

## Assistant approval recovery

Proposed write calls carry a server-generated `approvalId` in canonical history. The browser
persists pending history and identity before executing approval. Each write claims a durable
receipt before invoking its tool; matching concurrent/repeated approvals reuse the result, while
changed intent under the same identity is rejected. If a process stops between execution and
receipt completion, the result is explicitly unknown and the old approval is never blindly
re-executed. The person must inspect canonical workspace state before proposing a replacement.
The browser retains uncertain approvals across reload and offers a safe retry of the same action.

Weekly review counts Shipped from completion events in the selected UTC week (or an explicit completion timestamp). Reopening a task later does not erase its historical completion. Missing legacy completion dates are disclosed rather than inferred from creation or modification times. Creating a task already completed records a completion event.

Assistant recovery keeps pending approvals when the selected model is absent or cannot resume tools. `approval-unavailable` explicitly means that request executed no action; it does not erase any earlier uncertain outcome. The standalone demo opts into in-memory receipts alongside its in-memory workspace; production never falls back to volatile receipts when durable storage is unavailable.
