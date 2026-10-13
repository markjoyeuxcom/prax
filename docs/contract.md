# Prax — Data Formats & Shapes

This document describes the **current** shapes of Prax's externally-consumed data:
the export/import formats (`moomora.tasks` portable task exports, library `.md` front-matter) and
the MCP tool surface. It's a reference for anyone writing integrations, importers, or MCP clients.
The portable formats carry content, not history, links, or project metadata; an authoritative
backup is a SQLite snapshot (see `docs/backup-restore.md`).

**These shapes are not frozen.** Prax is pre-1.0 and the data model is still evolving. The
regression tests under `tests/contract/` lock the *current* shapes so that changes are caught and
made deliberately rather than by accident — they are a safety net, **not a stability promise**.

## Scope

- **Externally consumed** — the export/import formats and the MCP tool surface. These are the
  surfaces worth keeping stable where practical, because backup files and MCP clients live
  outside the app. When the project reaches 1.0 these are expected to stabilise and future
  breaking changes will be versioned (an export envelope `version` bump, MCP changes called out
  in release notes). Until then, treat them as evolving.
- **Internal** — the HTTP API (`/api/…`). Consumed by the co-shipped frontend and the local MCP
  server (released together as one image), and by the `prax` CLI and the portable
  `prax-recall` / `prax-remember` skill bundles, which can be installed and updated
  independently of the server they talk to. The API may change between any release, so a skill
  bundle newer than its server may meet a route that does not exist yet: the bundles degrade
  explicitly where they can (the remember path falls back to read-then-write on a `404` for
  `upsert-by-title`; an unpaged semantic response is accepted without index coverage) and
  otherwise surface the server's error. Keep the skills and the app at the same release when
  in doubt. For durable integration prefer the export formats or the MCP server.

### Forward-compatibility tip for consumers

Importers and MCP clients should **ignore unknown fields** rather than hard-fail — the server
may add fields over time.

### System projects

`inbox` and `memory` are reserved project slugs. Fresh databases include both.
Migration 0032 restores a missing Inbox with a new ID, or reactivates the
existing `inbox` row as Inbox without moving or modifying its contents.
Clients must resolve projects by slug; IDs belong to the installed library.

`PATCH /api/projects/:id`, `DELETE /api/projects/:id` (archive), and
`DELETE /api/projects/:id/permanent` return `403` for either system project.
This includes project metadata changes. Tasks and documents inside them retain
their normal edit, move, archive and deletion behaviour. Inbox owns unassigned
captures and new workspace weekly-review documents; Memory owns shared guidance.

### Project overview

Every project has one overview document, its master page: `<Name> project overview`, a
`reference` tagged `project-card`. `POST /api/projects` seeds it from the bundled starter
(`public/starter-content/project-overview.md`) with the name and slug filled in (the repo
URL too once it is known: `prax init` fills it after registering the remote) and returns
`overviewDocumentId` beside the project. `overview: false` in the body skips the seed (the
mirror import, which carries the project's own card). A seed that fails never fails the
create: the response then carries `overviewError` instead of `overviewDocumentId`.
`POST /api/projects/:id/overview` creates the card when the project has none (`201`,
`{ project, document, created: true }`) or returns the existing one (`200`,
`created: false`): a verified `project-card` first, then the newest, then the exact title.
The seeded card's id is derived from the project id and the create is idempotent, so
concurrent requests resolve to one document. A card that sits in the archive is a decision:
the route answers `409` with it instead of seeding a second one. The seed is always
unverified, whoever created the project; it is attributed to the agent when the request
carries `x-prax-origin: agent`. System projects return `403`; an app built without a library
repository `409` (the demo has one and seeds like the app). The librarian report lists active
projects without a card under `overview.missing` and in the `overview` check (`info`); when
the projects could not be inspected the check says so and `overview.unavailable` is true.

### Inbox processing

Migration `0033_inbox_action_receipts.sql` adds durable decision receipts. Inbox IDs are
resolved from the reserved slug. The processing routes require the persistent server;
the nonpersistent demo returns `503` / `unavailable` while ordinary task views remain usable.

| Endpoint | Contract |
| --- | --- |
| `GET /api/inbox?view=pending&offset=0&limit=50` | `view=pending|reviews`, nonnegative offset, limit 1–100. Returns `items`, exact `page` (`offset`, `limit`, `returned`, `total`, `hasMore`, `nextOffset`), `summary`, `reviewCount`, eligible destination `projects`, and `inboxId`. |
| `GET /api/inbox/items/:kind/:id` | `kind=task|document`; returns canonical `record` and `fingerprint`. Tasks include checklist labels/completion. |
| `POST /api/inbox/items/:kind/:id/actions` | Caller-stable UUID `operationId`, reviewed `fingerprint`, and `action=file|reference|complete|archive`. Filing/reference requires `projectId` outside Inbox; filed tasks optionally accept real `plannedFor` dates; filed documents optionally accept a registered `documentType`. |
| `POST /api/inbox/actions/:operationId/undo` | Reconciles or reverses one unchanged decision. Source and generated-record changes/deletion refuse undo with `409` / `undo-conflict`. |
| `POST /api/inbox/items/:kind/:id/suggest` | Takes the reviewed `fingerprint`. Returns `advisory`, destination/type/reason, validated possible duplicates, and explicit `coverage`. This endpoint makes no library/task writes. |

Pending means nonarchived, incomplete tasks and active documents without `weekly-review`.
Reviews means active, nonarchived documents with that tag. Pending pages sort oldest first;
reviews sort newest first. Cards contain previews up to 240 characters. `summary` counts all
pending tasks/notes and reports `olderThanWeek` (at least seven days) and `oldestDays`.
Offset pages represent the current collection; concurrent writes can shift later pages.

Actions and receipts commit in one transaction. A matching retry returns the current result
with `replayed: true`, preserving later edits; changed intent returns `409` / `intent-mismatch`.
A deleted source returns `410` / `result-gone` with `committed: true`, never resurrection.
A changed reviewed item returns `409` / `item-changed`; items already processed return
`409` / `not-pending`. Errors include `message` and `reason`. Successful actions return
`committed`, `operationId`, `action`, `replayed`, `undone`, `kind`, `record`, and `created`.
Post-commit embedding failure adds `indexingDegraded: true`; it is not a failed decision.

Task completion uses the normal recurrence planner. Task reference creation copies description,
notes and checklist into an unverified synthesized reference, links it to the archived task,
and records provenance. Document filing only changes project/type metadata, retaining content
and trust. Undo restores the changed source fields and archives generated references or recurring
successors; it does not permanently delete them. Replaying an undone decision does not reapply it.
Receipts survive SQLite backup/restore and server restart; they are not portable Markdown data.

Suggestions use at most 100 eligible projects, 12 title-overlap-ranked task/document candidates,
and 8,000 characters of source text. `coverage` reports `projectsShown`, `projectsTotal`,
`candidatesShown`, `candidatesTotal`, and `sourceTruncated`. Up to three possible duplicates are
validated against these candidates; their titles come from the database. Task type suggestions
are limited to `reference`; document suggestions use the registered types. Unknown IDs/types
or unreadable output return `502` / `invalid-suggestion`; unavailable/failed providers return
`503` / `ai-unavailable|ai-failed`; source changes during generation return `409` / `item-changed`.
Provider diagnostics are not returned. Suggestions neither verify records nor merge duplicates.

### Retry identity: the operation ledger

Every caller-identified write is judged by a durable receipt, through one server module
(`server/operationLedger.js`). The caller's id (an `operationId`, an import `requestId`, an
assistant approval id, or the UUID of the record being created) is claimed with a hash of the
request's intent in the same transaction as the write. A later request with that id is answered
from the receipt, never from the record's current content: the same intent **replays** the
original result as the record is now; a different intent is a **conflict**; the same intent after
the result was permanently deleted is **gone** and is not recreated; and a request that arrives
while the first is still running in the server (a document generation, an approved assistant
action) waits for it. The status codes and bodies for each route are described in their own
sections below; the ledger does not change them. Receipt kinds and their tables:

| Kind | Table | Id | Used by |
|---|---|---|---|
| document upsert | `document_upsert_receipts` (0027) | `id` / `operationId` | upsert-by-title ("remember"); document create with `operationId` |
| document update | `document_update_receipts` (0031) | `operationId` | `POST /api/library/documents/:id/update` |
| Inbox action | `inbox_action_receipts` (0033) | `operationId` | Inbox decisions and their undo |
| task import | `task_import_operations` (0014) | `requestId` | direct and staged task imports |
| assistant write | `assistant_write_receipts` (0025) | approval id | approved assistant tools |
| record creation | `record_creation_receipts` (0034) | record UUID | task, checklist item and document create by ID |
| document generation | `markdown_documents.creation_*` (0015) | result `id` | post-mortem and runbook generation |

Receipts are runtime metadata: they survive restart and SQLite backup/restore but are not part of
any portable export. They outlive the records they describe, except generation receipts, which
live on the generated row, and task import receipts, which are removed with their project.

### Document update retries

CLI/skills and MCP use `POST /api/library/documents/:id/update` with the ordinary
document patch fields plus a caller-stable UUID `operationId`. Optional
`ifRevision` guards the title/body baseline. The server commits the patch and
receipt together. Replaying the same intent returns the current canonical
document with `replayed: true`, without applying the old patch or embedding it
again. Changed intent under the same ID returns `409` / `update-intent-mismatch`;
if the result was permanently deleted it returns `409` / `update-result-gone`
with `committed: true`. Receipts survive deletion and restart.

This endpoint is separate from ordinary PATCH so older servers cannot silently
ignore the operation ID. On a `404`, clients fall back to one legacy PATCH with
no automatic transport retry. A lost legacy response is explicitly an unknown
outcome; inspect the document before starting another update. Lost responses on
the receipt endpoint retain their operation ID in the client error for safe
reconciliation/replay. Document listings include both `projectId` and
`projectSlug`; newer remember clients resolve older ID-only listings through
the project list, and refuse ambiguous or unresolved ownership.

Both supersession endpoints reject cyclic replacement chains with `409` /
`supersession-cycle`. The database enforces the check atomically with insertion,
including concurrent requests and edges that could become live after restore.
Cycles stored before that check (migration `0031`) are repaired by migration
`0038_repair_legacy_cycles_and_receipts.sql`: within a cycle only the edges that point from the
newer document to the older one (by `created_at`, then id) are kept, so the newest document of
a former cycle is active again. Edges outside a cycle are not changed.

Other CLI/MCP setters and link operations without durable receipts retry only
proven pre-connection failures (connection refused or DNS resolution failure).
A reset or generic transport rejection may follow a commit and is reported as
an unknown write outcome instead of automatically reapplying an older intent.

## Format 1 — Task export/import (`moomora.tasks`)

### Export envelope (`GET /api/tasks/export`)

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "exportedAt": "2026-05-29T12:00:00.000Z",
  "project": "homelab",
  "tasks": []
}
```

- `format` is the exact, case-sensitive string `"moomora.tasks"`.
- `version` is the integer `1`.
- `project` is the project slug, or `"all"` for a cross-project export.
- Exports carry no `requestId`; request ids belong to import operations (see the import
  protocol below).

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
| `recurrenceAnchorDay` | integer `1`–`31` \| `null` — the day-of-month a `monthly` series returns to (migration `0037`). Server-computed: set from `dueDate` when a monthly recurrence is set or a monthly task's due date is moved (re-sending an unchanged due date keeps it), carried to each successor, `null` for every other recurrence; never accepted from create/patch payloads; round-trips through export/import. Monthly tasks created before `0037` stay `null` until an edit or their next completion. |
| `labels` | string array |
| `checklist` | checklist item array (`label`, `completed`, plus runtime metadata) |
| `sortOrder` | 32-bit signed integer |
| `plannedFor` | `"YYYY-MM-DD"` \| `null` — the day this task was consciously pulled into (the Today plan working set). Client-writable; orthogonal to due dates and status. |
| `carryCount` | non-negative integer — times an unfinished planned item was consciously rolled to a later day (the shutdown ritual's Carry, or a stale plan pulled forward). Server-computed on PATCH; never accepted from patch payloads; round-trips through export/import. |
| `deferralCount` | non-negative integer — times the task was consciously pushed (snoozed into the future, or due date moved later while open). Server-computed on PATCH; never accepted from patch payloads; round-trips through export/import. Counting began at migration `0020` — earlier history was never recorded, so older tasks honestly start at 0. |
| `createdAt` | ISO-8601 timestamp |
| `updatedAt` | ISO-8601 timestamp |
| `archivedAt` | ISO-8601 timestamp \| `null` |

Completing a recurring task creates its successor, due one interval after `dueDate` and strictly
after the requester's today. A `monthly` successor lands on `recurrenceAnchorDay` clamped to
shorter months, so a series set up on Jan 31 goes Feb 28 (29 in a leap year), Mar 31, Apr 30
when each occurrence is completed on time, and the Jan 31 task completed on Apr 15 gives Apr 30.
An unanchored (pre-`0037`) monthly task uses its due date's own day and passes that day to its
successor as the anchor; a clamped 28th is never widened to a guessed 31st. "Today" comes from
the optional `x-prax-local-date: YYYY-MM-DD` header, else `x-prax-time-zone: <IANA zone>` applied
to the server clock, else the server's local date. The web app sends both on task PATCH, reorder,
Inbox actions and assistant chat; the assistant's date context uses the same day. The `prax` CLI,
the skill scripts and the MCP server send both on every request, from the machine they run on.

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
  `plannedFor` (`YYYY-MM-DD`), `carryCount` (non-negative integer; same 400-not-clamp rule),
  `recurrenceAnchorDay` (integer `1`–`31` or `null`; other values are rejected with `400`; kept
  only on a `monthly` task, and a record without it stays unanchored rather than guessing).
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
  The durable result receipt keeps the counts and the imported task ids, not copies of the tasks
  (migration `0038` reduced older receipts to ids). A replay reports the original counts and the
  imported tasks as they are now; a task permanently deleted since is absent from `tasks`.
- In the shipped SQLite path, task rows, checklist rows, and a replace-mode project deletion commit
  in one transaction. A failed checklist write cannot leave a partially imported project.

## Format 2 — Library `.md` front-matter

Library export (`GET /api/library/export`) produces a ZIP of `.md` files. Each file is YAML
front-matter v3 followed by the Markdown body. `project=all` exports all projects; a slug
selects one project. The default includes every nonarchived document, including superseded and
deprecated records with explicit status. `includeArchived=true` also includes Archive;
`false` is the default and other values return 400. The field order is:

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
prax_export_version: 3
id: "11111111-1111-4111-8111-111111111111"
status: "active"
archived_at: null
verified: false
verified_at: null
verified_by: null
updated_by_agent: "codex"
source_filename: null
external_refs: []
code_refs: []
task_ids: []
links:
  derived-from:
    - id: c58d3108-4f93-4a50-ac42-0c1d61e61b08
      ref: homelab/cloudnativepg-restore.md
  supersedes: []
---

# Postgres restore

Steps...
```

- `type` is one of `"note"`, `"runbook"`, `"decision"`, `"known-issue"`, `"reference"`, `"post-mortem"`, `"template"` (defaults to `"note"`; the registry lives in `public/js/documentTypes.js`).
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
- **Ordering** is total, so equal library state renders equal bytes: documents by project slug,
  title, creation time and id; outbound links by relation, target title and target id; code
  citations by path, start line and id. The first document in that order keeps a bare filename.
- **`format`** is `zip` (default) or `json`; **`layout`** is `flat` (default, the layout above)
  or `mirror` (see [Library git mirror](#library-git-mirror)). Other values return 400.
  `format=json` returns `{ format: "prax.library-export", version: 1, markdownVersion: 3, scope,
  layout, includeArchived, documents: [{ path, id, title, documentType, status, tags, verified,
  verifiedBy, verifiedAt, contentHash, markdown }] }` in export order, where `path` is the entry
  name and `markdown` its exact bytes, with `Cache-Control: no-store`.

The v3 additions record the document UUID, lifecycle/archive and verification state, specific agent,
original filename, external references, code citations and linked task IDs. Each `code_refs`
entry is the citation object above, so since migration `0039` it also carries `normalizedHash` and
`symbol`. The addition stays within the JSON objects, so the version remains 3. Optional values are
explicit JSON-quoted strings or `null`; relation arrays use JSON flow syntax (valid YAML). Titles,
slugs and tags that resemble typed YAML values or begin with YAML punctuation are quoted. These
fields describe saved evidence and do not authorize an importer to verify a document automatically.

### Full workspace backup ZIP

`GET /api/workspace/backup` creates a coherent snapshot through SQLite's online backup API,
serialized behind the application's transaction gate. It includes **all committed SQLite tables**:
projects, tasks/checklists/activity, documents/templates/archive, trust and attribution, links and
citations, run history, settings, embeddings, Inbox action/undo receipts, and the local recall
telemetry and librarian proposals (see [Recall telemetry and the librarian](#recall-telemetry-and-the-librarian)).
It also packages the bundled starter guides and `RESTORE.md`. Both ZIP routes send
`Cache-Control: no-store`. The portable Library export never contains recall telemetry.

The ZIP contains `prax.db` and `manifest.json` with `format: "prax.workspace-backup"`, `version: 1`,
`praxVersion`, `schema: {finalMigration}` (the last migration the snapshot records, for example
`"0041_add_agent_recall_markers.sql"`; absent from backups made before it was added),
`createdAt`, `database: {file, sha256, bytes, integrityCheck, foreignKeyViolations}`,
and explicit `includes`/`excludes` lists. The snapshot must pass integrity and foreign-key checks
before download. Only one full backup streams per app at a time (409 on overlap); unavailable
storage returns 503 and a failed snapshot returns 500. Temporary files are removed on completion,
failure or disconnect. There is no HTTP restore route that overwrites an open database.

Backups contain saved provider credentials. Unsaved drafts, browser-only settings/pending
choices, external files and environment configuration are excluded. With Prax stopped,
`npm run restore -- --from extracted/prax.db --to /new/path/prax.db --sha256 <manifest digest>`
validates the digest and database, rejects unexpected source WAL/SHM sidecars, and refuses an
existing target or its sidecars. It reads the `manifest.json` beside the database, or the one
named by `--manifest <path>`, and refuses before writing anything when the manifest's
`praxVersion` is newer than this Prax, its `schema.finalMigration` is unknown to this build, its
format or version is not understood, or its `database.sha256` disagrees with `--sha256`. It also
refuses a database whose own `schema_migrations` holds a migration this build does not know, with
or without a manifest. Restore with the same or a newer Prax version. See
[Schema versions and downgrades](#schema-versions-and-downgrades) and
[the bundled restore guide](../public/starter-content/workspace-restore.md).

### `links:` block

The `links:` block is always present, even when a document has no outbound edges — matching
the `tags: []` convention. It captures outbound edges only; inbound edges are derivable from
the rest of the export.

Each entry carries `id`, `ref`, and (when recorded) `target_hash`, the dependency snapshot digest:

- `id` — the target document UUID. **Authoritative.** Use this for any programmatic
  resolution (live API lookup, cross-export join).
- `ref` — a path-style hint. **Not authoritative.** Computed to match where the target
  lives in the zip when possible, so humans and diff tools can navigate the export without
  a database. `ref` computation rules, in priority order:
  1. **All-projects export** (any target project): `<targetProjectSlug>/<targetFilename>`.
     Resolves to a file in the zip when the target is included.
  2. **Single-project export, target in the same project**: bare `<targetFilename>`.
     Resolves when included (the single-project zip is flat, no project-slug folder).
  3. **Single-project export, target in a different project**: `<targetProjectSlug>/<targetFilename>`.
     This ref **dangles by design** — the target is not in the zip. The `id` remains
     authoritative and can resolve the target against the live API or a different export.

  Archived targets retain their ID/ref even when Archive is excluded.

  `targetFilename` follows the same logic as the zip-entry filename: `sourceFilename`
  basename, else slugified title, else `untitled.md`.

Two relation keys are always present under `links:`, in this order: `derived-from` then
`supersedes`. Empty relations render inline (`derived-from: []`); non-empty render as YAML
block sequences with `id:` before `ref:` per entry.

### Single-doc export route

`GET /api/library/documents/:id/export` returns a single document rendered as v3 Markdown
(`text/markdown; charset=utf-8`) with `Content-Disposition: attachment; filename="<documentFilename>"`.
A filename outside printable ASCII (CJK, emoji) or containing `"`, `\` or `%` gets an ASCII
fallback in `filename` (each such run replaced by `_`) plus the exact name as RFC 5987
`filename*=UTF-8''<percent-encoded>`; the library ZIP route uses the same rule.
The server fetches the document's outbound links and computes refs in single-project scope
before rendering. Returns 404 for a missing or archived document, 400 for an invalid UUID.

### Library git mirror

`prax mirror` writes one project's export (`format=json&layout=mirror`) into a folder of the
checkout, default `.prax/library/`. The mirror layout puts active documents at the folder root and
superseded or deprecated ones under `retired/`; link `ref`s name those paths. The root also holds
the mirror's own `README.md` (a generated table of documents; a document whose file name folds to
it takes the `-2` suffix) and `index.json`:

```json
{
  "format": "prax.library-mirror",
  "version": 1,
  "project": "homelab",
  "documents": [
    { "path": "postgres-restore.md", "id": "…", "title": "Postgres restore", "type": "runbook",
      "status": "active", "verified": true, "verifiedBy": "Mark", "contentHash": "…" }
  ]
}
```

Entries are sorted by path; neither index file carries a timestamp. The mirror deletes only paths
its manifest lists that match `[retired/]<name>.md`, so an edited manifest cannot reach outside
the folder. An interrupted run leaves a manifest with `"pending": true` naming every path it may
have written, and the next run finishes and cleans up. Not mirrored: operation receipts, revisions,
run history, embeddings, activity, settings, tasks and archived documents.

`prax mirror import` is the Markdown v3 read path. It creates the folder's `active` documents
through `POST /api/library/documents` with each document's own UUID (the record-creation receipt,
so `201` created, `200` replayed, `409` id used for different content, `410` permanently deleted
here and not recreated), always with `verified: false`. An existing document is never
overwritten: SQLite stays the only writer. Portable through the mirror: `id`, `title`, `type`,
`tags`, `kind`, body (recovered exactly using `content_hash`, since the renderer adds a final
newline), `source_filename`, `external_refs` (URL and label) and `code_refs` (path, lines, commit,
hash). Deliberately not round-tripped: `created_at`, `updated_at`, `updated_by`,
`updated_by_agent` (the import is stamped as the importer's agent write), `verified_at`,
`task_ids`, `links` and retired or archived documents. `tests/contract/libraryMirror.test.js`
locks this set.

Front-matter verification is a claim. The importer records it, through the verify route bound to
the created revision, only when the file says `verified: true` with a `verified_by` name that the
operator trusts (`--trust-verifier` or `PRAX_TRUSTED_VERIFIERS`, never the mirror itself), the body
hashes to `content_hash`, the library copy is unverified with that hash, and a person confirms in an
attended terminal (`VERIFY <n>`). The claim covers the body, not the title.

**Library intake without front matter.** **Import Markdown…** opens an explicit destination-project dialog and creates one
project-owned source note per selected file. It retains the file body/filename but does not parse
Prax front matter or restore type, provenance, trust, or graph links. The dialog retains failed files,
reports committed and remaining counts separately, and offers an exact-once-safe retry.

`POST /api/library/documents` requires `project` and accepts an optional caller UUID `id`. With an
`id`, the first create returns `201`; replaying the same create intent returns the existing document
with `200`; reusing the UUID for different title/body/type/project/tags/source/provenance intent
returns `409`. Without `id`, ordinary server-identified creation is unchanged. Documents are also
created/edited through the MCP `create_document` / `update_document` tools.

Document titles are a single line. Every write (create, PATCH, upsert-by-title and server-generated
documents) collapses each whitespace run containing a line break or other control character
(including U+2028/U+2029) to one space and trims; ordinary spaces are kept, so exact-title
matching is unchanged. A title that is empty after this is `400 title is required`. Migration
`0035` applies the same rule to stored titles (clearing `revision` for the repository to
recompute, which leaves those documents pending a reindex); verification is kept.

## Format 3 — MCP tools

The MCP server (`mcp/`) exposes these tools over stdio. Current tool names, input field names,
required/optional status, and enum option sets. Shared enums: `STATUS`
(`high-priority`, `in-progress`, `planned`, `completed`, `notes`), `PRIORITY` (`high`,
`medium`, `low`), `DOCUMENT_TYPE` (`runbook`, `note`, `decision`, `known-issue`, `template`, `reference`, `post-mortem`),
`KIND` (`source`, `synthesized`).

| Tool | Inputs | Read-only |
|------|--------|-----------|
| `search_tasks` | `query?`, `project?`, `status?:STATUS`, `filter?`, `limit?`, `offset?` | yes |
| `get_task` | `id` | yes |
| `create_task` | `title`, `project`, `id?`, `description?`, `priority?:PRIORITY`, `status?:STATUS`, `dueDate?`, `dueTime?`, `recurrence?`, `labels?` | — |
| `update_task` | `id`, `title?`, `description?`, `notes?`, `priority?:PRIORITY`, `status?:STATUS`, `project?`, `dueDate?`, `dueTime?`, `recurrence?`, `labels?` | — |
| `search_documents` | `query?`, `project?`, `documentType?:DOCUMENT_TYPE`, `tags?`, `kind?:KIND`, `status?:{active\|superseded\|deprecated\|all}`, `includeHarvested?:boolean`, `limit?`, `offset?` | yes |
| `ask_library` | `query`, `project?`, `limit?`, `includeHarvested?:boolean` → Markdown context pack (semantic when configured, keyword otherwise) | yes |
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
| `search_documents_semantic` | `query`, `project?`, `includeHarvested?:boolean`, `limit?`, `offset?` | yes |
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
  `x-prax-origin`, while pre-migration history defaults to `user`. `actorAgent` (migration
  `0036_add_task_activity_agent.sql`) names the agent CLI from `x-prax-agent` when an agent
  identified itself, else `null`. Events cover creation (including an agent's
  `POST /api/tasks/import`, which is how `prax task add` creates), status, slip/plan changes,
  title, description, notes and priority edits (a repeat of the same edit by the same author
  within 15 minutes is covered by the earlier event), and checklist items added, checked,
  unchecked and removed. A person's import stays unlogged.

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
An exact retry returns the record's current state (including edits made since), conflicting identity
reuse returns 409, and a transport failure that remains unresolved reports an **unknown outcome plus
the retry ID** rather than claiming the write failed. `create_document` sends its `id` as the
`operationId` too, so it uses the receipt-backed document creation described under Bundled templates
and guides.

Caller-identified creates over HTTP (`POST /api/tasks` with `id`, `POST /api/tasks/:id/checklist`
with `id`, and `POST /api/library/documents` with `id` but no `operationId`) record a durable
creation receipt (migration `0034_record_creation_receipts.sql`) in the same transaction as the
insert. The receipt, not the row's current content, decides a retry: the same intent returns `200`
with the current record even after it was edited (a task that has since been archived still returns
`409` with its distinct archived message), a different intent returns `409`, and a retry after the
record was permanently deleted returns `410` instead of recreating it. Receipts outlive the record
and are runtime metadata, not portable export. Rows created before `0034` have no receipt and keep
the older content comparison. The MCP client retries these and other declared-idempotent writes once after a
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

Code citations: `document_code_refs` pin a document to the code it makes a claim about, so
the repository itself can report when the claim has gone stale. Where an external ref copies
nothing and therefore has no staleness, a citation stores a `content_hash` (sha256 of the cited
lines, line endings normalised) and is checked by re-hashing the file. The source is never
stored — only its hash. Each citation is
`{ id, documentId, path, startLine, endLine, commitSha, contentHash, normalizedHash, symbol, createdAt }`, unique per
`(document, path, startLine, endLine)`, deleted with the document. `startLine`/`endLine` are
inclusive and 1-based; both null means the whole file. `commitSha` records where the pin was
taken and is **informational** — the check is content-based, so a citation survives rebases and
branch switches that a commit comparison would false-alarm on.

Hybrid anchors (migration `0039`), both nullable:

- `normalizedHash` is the sha256 of the cited lines with all whitespace removed, newlines
  included.
- `symbol` is the name of the definition enclosing the first cited line, from a
  zero-dependency heuristic for JS/TS, Python, Rust, Go, Swift and shell (`cli/lib/symbols.js`).
  It is `null` for other files, whole-file citations and top-level code.
- A non-null `normalizedHash` means the anchors were computed. Both null is a **legacy** pin
  from before 0039, which is checked by `contentHash` alone.

Served at `GET`/`POST`/`DELETE /api/library/documents/:id/code-refs`. POST is an idempotent
upsert on the range (`201`; re-citing refreshes the hash and commit, which is what re-verifying
a memory does) — for a whole-file citation too: the key is a NULL-safe unique index over the
coalesced bounds (migration 0029), because SQLite treats NULLs as distinct in a plain UNIQUE
constraint and the 0028 key silently duplicated whole-file pins. `404` for a missing or archived
document, `400` for a missing `path` or `contentHash`, an absolute or `..`-escaping path, an
inverted range, or an `endLine` without a `startLine` (not a range). `prax remember --cite
<path[:start[-end]]>` and the `prax-remember` skill attach one, resolving it against the current
checkout.

The anchors are written as follows:

- POST accepts optional `normalizedHash` (64 hex digits) and `symbol` (one line, at most 200
  characters, and only together with `normalizedHash`). Otherwise it returns `400`.
- The upsert overwrites both. A re-cite from a client that sends neither stores nulls, because
  the old anchors described old content.
- `POST /api/library/documents/:id/code-refs/:refId/anchors` with
  `{ contentHash, normalizedHash, symbol? }` backfills a legacy pin. It is a compare-and-set:
  the write happens only while the row still has that `contentHash` and a null
  `normalizedHash`. The route returns `{ updated, ref }`, or `404` for an unknown citation. The
  CLI's recall sends it when the line hash proves that the checkout holds the pinned content.

`GET /api/library/code-refs?path=<p>[&path=<p>…][&project=<slug>]` is the read-only lookup behind
`prax check`.

- It returns `{ items: [{ …citation, document: { id, title, documentType, status, verified,
  verifiedBy, updatedAt, projectId, projectSlug, projectRepoUrl } }] }`.
- Only non-archived documents with status `active` are included.
- A request takes 1 to 200 repository-relative paths. It returns `400` for none, too many, an
  absolute or `..` path, or an unknown project. The CLI sends 50 per request.

**Checking happens client-side**, because only a working tree can answer it: `prax recall` and
the `prax-recall` skill re-read the cited file and report `current`, `moved` (the content was
re-found elsewhere in the file — line numbers drift, and a staleness signal that cries wolf on
every insertion above gets ignored), `changed`, or `missing`.

The check tries the anchors in order:

1. The line hash at the recorded range.
2. The line hash over nearby equal-length windows, which gives `moved`.
3. The content hash over variable windows, which gives `current` or `moved` with
   `anchor: "content"`.
4. The symbol, which gives `changed` with `symbol: { name, line | null }`.

A result that the line hash settles keeps its pre-0039 shape. `prax check` applies the same
check to the base and head of a diff and fails only on drift the change introduced (see
`docs/cli.md`). Recall run from outside a checkout
reports **nothing either way**: silence must not read as "still true", and an unreadable file
must not read as "deleted".

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
clickable links. Markdown v3 includes these records in `external_refs`.

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
is an API field (migration 0026, column `updated_by_agent`) and appears in Markdown v3 as
`updated_by_agent`.

Authorship follows content: `updatedBy` and `updatedByAgent` change only when a write changes
the title or the body. A tag change, a retype, a save that resends the same text, an archive or
a restore keeps the previous writer, so an unreviewed agent document stays in the review queue
through housekeeping. Archive has its own attribution: `archivedBy` (`"user"` | `"agent"` |
`null`) and `archivedByAgent` (migration 0042), cleared again by restore; a supersession has
`retiredBy` and `retiredByAgent` (migration 0043), cleared when the document is revived.

`POST /api/library/documents/upsert-by-title` is the atomic "remember": body `{ project, title,
body, tags?, documentType?, kind?, id? }`. Inside one transaction it updates the **active**
document with that exact title in the project (replacing the body, replacing tags only when
`tags` is given — an omitted `tags` keeps the stored ones, `[]` clears them — and retyping only
when `documentType` is given) or creates one (`documentType` defaults to `note`). Superseded and
deprecated documents never match. Returns `{ document, created }` — `201` for a new document,
`200` for an update. A caller `id` is an **operation id**, not only a create id: inside the same
transaction the server first looks the id up in its receipts, and only when none exists does it
touch the title and then store a receipt (the id, the resulting document, and a hash of the
caller's intent) — for updates as well as creates. Replaying a completed operation — even after
a later write changed the document — returns the **current** document unchanged with `200` and
`replayed: true`; reusing the id with different content is `409`; a replay whose document has
since been permanently deleted is `410`. `derived-from` links snapshot
the target document's `contentHash` at link time and refresh it on re-link. The maintenance tool
`list_stale_documents` drives a client-side groom loop: stale documents are derived docs whose
source changed since the snapshot (each result includes `updatedBy` so a loop can skip hand-edited
docs). It is served at `GET /api/library/maintenance/stale`.

Document `kind` distinguishes hand-authored documents (`"source"`) from agent-synthesized
derivations (`"synthesized"`). It is set explicitly by callers (defaulting to `"source"`),
mutable via `update_document`, and independent of `derived-from` edges and the
`x-prax-origin` edit-origin header. Full read paths (`get_document`, `search_documents_semantic`
refs, stale rows, context-pack items, HTTP search rows) include `kind`; the create/update
tools accept it as an optional input. The one exception is the compact MCP `search_documents`
summary (`{ id, title, documentType, projectId, tags, snippet }`), which deliberately omits `kind`
and the trust/lifecycle fields — call `get_document` for them.

### Exact document revisions and conditional updates

Full document records expose `revision`: SHA-256 over UTF-8 `JSON.stringify([storedTitle, storedBody])`.
`contentHash` remains SHA-256 of body only, preserving the export and derived-from contract.
`PATCH /api/library/documents/:id` accepts optional `ifRevision`; with it, the update commits
atomically only if the baseline matches. A mismatch returns 409
`{message,reason:"revision-mismatch",document:<current full record>}`. Send only edited fields.
The browser merges independent title/body edits and retains conflicting drafts for explicit review.
MCP/legacy HTTP partial patches without `ifRevision` remain unconditional.

### Trust fields

Documents carry four trust/workflow fields. Markdown v3 records these as evidence; plain Markdown
intake does not reconstruct them. Full workspace recovery retains the exact database trust state.
Trust is managed via the `verify`/`supersede` endpoints below.

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | `true` when a human has blessed the document. Agent writes (MCP `create_document` / `update_document`, CLI `remember`) land `false` by default; the consolidated SQLite schema seeds trust by origin: `updated_by = 'user'` → `true`, `updated_by = 'agent'` → `false`. |
| `verifiedAt` | ISO-8601 timestamp \| `null` | When the document was last verified (or unverified). `null` when `verified` is `false` and has never been set. |
| `verifiedBy` | string \| `null` | Who verified the document (a name, `"cli"`, `"user"`, etc.). `null` when unverified. |
| `status` | `"active"` \| `"superseded"` \| `"deprecated"` | Lifecycle state. New documents are `"active"`. A live inbound `supersedes` link makes an active document `"superseded"`. `"deprecated"` is reserved for manual use (stale, no replacement). |

All read paths that return full document records (`get_document`, HTTP search rows,
`search_documents_semantic` refs, stale rows, context-pack items) include these four
fields; the compact MCP `search_documents` summary omits them (see the `kind` note above).
Retrieval is **active-only** by default: only documents with `status = 'active'` appear in
semantic search, the context-pack, the `search_documents` MCP tool, and CLI/skill recall
(including `recall --recent`). `prax search --all` and the semantic route's `?all=true` widen a
search to retired statuses (`superseded` / `deprecated`, never archived rows); `recall` has no
such override. The raw `GET /api/library/documents` route is the exception: it returns **all
non-archived statuses** unless `?status=active|superseded|deprecated` is passed, because the
web UI lists superseded documents with their trust chips. `status=all` is the explicit
no-filter value; any other value returns `400` rather than silently listing every status.
Raw HTTP callers doing retrieval should pass `status=active`.

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
falls back to recency otherwise. The JSON pack also carries `omitted: { total, unverified }`,
the substantive active candidates the `limit` left out; the Markdown pack states that count
when it is non-zero. Each Markdown entry is one heading line carrying its title and its
labels (`— _unverified_`, `— _stale_`); titles are rendered on one line, so they cannot add
headings. The library-wide `GET /api/library/context-pack?q=` follows the same rules.
JSON pack items carry `updatedAt` (the current revision's time), which the CLI's token budget
(`prax context --budget`) uses for its newest-first tier; the budget itself is applied by the
client, which alone can check code citations against its checkout (see
[Budgets and the fill order](cli.md#budgets-and-the-fill-order)).

### Unreviewed harvested candidates

A document that is **unverified and tagged `harvested`** (case-insensitive) is a session-harvest
proposal awaiting triage (`server/harvestedCandidates.js`). Retrieval routes leave it out unless
the request opts in with `includeHarvested=true` (a JSON body field `includeHarvested: true` for
`POST /api/library/ask`); any other value, or none, excludes. Verification, or tags without
`harvested`, makes it an ordinary document again. Each route discloses what it hid:

| Route | Excluded by default | Disclosure |
|-------|---------------------|------------|
| `GET /api/library/documents/semantic-search` (semantic and hybrid) | yes; ranking and the relevance cutoff are computed as if the candidates were absent, and `page.total` counts only what may be shown | `hiddenHarvested: n` in the paged envelope; `x-prax-hidden-harvested: n` header on the legacy array |
| `GET /api/library/documents?q=` (keyword search) | yes, only when `q` is non-blank | `x-prax-hidden-harvested: n` header (the body stays an array) |
| `GET /api/library/documents` without `q` (a listing) | no | — |
| `GET /api/projects/:idOrSlug/context-pack`, `GET /api/library/context-pack` | yes (semantic, keyword and recency candidates) | JSON `hiddenHarvested: n`; Markdown line `_n unreviewed harvested candidate(s) hidden …; --include-harvested (includeHarvested=true) to show._` |
| `POST /api/library/ask` | yes; never an answer source | `retrieval.hiddenHarvested: n`, and the pack Markdown line |
| `GET /api/library/documents/:id/similar` | yes | `hiddenHarvested: n` |
| `GET /api/tasks/:id/related-documents` | yes | `hiddenHarvested: n` |
| `GET /api/library/changes` | yes (a SQL filter, so paging and `until` are unaffected) | `hiddenHarvested: n`: candidates changed in the window |

`hiddenHarvested` is present only when non-zero; for ranked routes it counts the candidates the
relevance cutoff would have returned. The web UI opts in for its Library search, similar
documents and the task drawer's suggestions; its Ask does not. The CLI (`--include-harvested`),
the recall skill and the MCP tools (`includeHarvested`) send the opt-in only when asked.

### Memory changes and recall markers

The since-last-session delta (`prax recall --since-last-session | --since <iso>`). Design:
[the spec](design/budgeted-context-and-brief.md).

`GET /api/library/changes?since=<iso>|sinceLastSession=true[&project=<slug|id>][&limit=<n>]`

Exactly one of `since` (an ISO-8601 date or date-time) and `sinceLastSession=true` is required
(400 otherwise). `limit` defaults to 50, max 200. `project` narrows to one project (400 when
unknown). Returns:

```json
{ "agent": "claude" | null, "project": { "id", "slug", "name" } | null,
  "baseline": "explicit" | "marker" | "none", "since": "<iso>" | null, "until": "<iso>",
  "items": [ { "id", "title", "documentType", "projectId", "projectSlug", "tags", "kind",
               "verified", "verifiedAt", "verifiedBy", "status", "updatedBy", "updatedByAgent",
               "createdAt", "updatedAt", "archivedAt", "supersededBy": ["<id>"],
               "changes": ["created"|"updated"|"verified"|"superseded"|"deprecated"|"archived"],
               "changedAt": "<iso>", "snippet": "<first 800 characters>" } ],
  "page": { "returned", "total", "hasMore", "limit" },
  "hiddenHarvested": <n, only when non-zero> }
```

`includeHarvested=true` includes [unreviewed harvested candidates](#unreviewed-harvested-candidates);
without it they are left out and `hiddenHarvested` (present only when non-zero) counts those
changed in the window.

A document is included when its `created_at`, `updated_at`, `verified_at` (while verified) or
`archived_at` is later than `since`; archived documents appear only when archived in the window.
A document created in the window is `created`, not also `updated`; a retired document reports
`superseded`/`deprecated` instead of `updated`; an archived one is not also `updated`.
Unverification and permanent deletion are not visible. Items are ordered oldest `changedAt`
first; a page never splits items with the same `changedAt`. `until` is the last item's
`changedAt` (equal to `since` when nothing changed), never the server clock, so the next page
or delta starts strictly after it without losing a write that committed during the read.

With `sinceLastSession=true` the caller must identify as an agent (`x-prax-origin: agent` and a
valid `x-prax-agent`; 400 otherwise). The server reads that agent's marker for the scope (`*`
for all projects, else the project id): `baseline: "marker"` uses it as `since`; with no marker,
`baseline: "none"`, `since: null`, no items and `until` = the server's now.

`GET /api/library/recall-marker[?project=]` → `{ agent, project, lastRecallAt | null }`.

`PUT /api/library/recall-marker` `{ "at": "<iso>", "project"?: "<slug|id>" }` →
`{ agent, project, lastRecallAt }`. Monotonic: the stored value becomes `max(stored, at)`,
clamped to the server's clock, so a replay or a stale session never moves it back (a setter
that is safe to retry when no request reached the server). Both marker routes require the agent
headers (400 otherwise). Markers live in `agent_recall_markers` (migration `0041`), keyed by
`(agent, scope)`; they are runtime metadata, not part of portable export. The CLI advances a
marker only after it printed a `--since-last-session` delta in full.

Semantic search ranks documents by embedding similarity (meaning), not keywords, so a
paraphrased query can find topically-relevant docs that share no words with it. It is
**retrieval-only** — no text is generated. Embeddings are stored in SQLite and cosine-ranked in
process; no vector extension is required. It requires a configured embedding backend: `local`
(in-process, see below), `ollama`, `openai` (any OpenAI-compatible `/v1/embeddings` server — real
OpenAI, vLLM, LiteLLM, … via `OPENAI_BASE_URL` + optional `OPENAI_API_KEY`), the dedicated
`llamacpp`, `gemini`, and `voyage` providers, or the deterministic `fake` test backend.

**`local` — embeddings on this device.** Runs the model inside the Prax process: no daemon, no API
key, no per-query cost, and no network after the first model fetch. Its runtime is an **optional**
install, deliberately not a dependency of Prax (ONNX ships ~210MB of per-platform binaries, which
does not belong in the default install or the desktop bundle):

```bash
npm install @huggingface/transformers
```

Without it the backend is selectable but reports itself unavailable with that install command,
rather than failing at embed time. The default model is `Xenova/all-MiniLM-L6-v2` (384 dimensions,
~23MB, a few milliseconds per document); set `EMBEDDING_MODEL` for another. Vectors are mean-pooled
and L2-normalised.

Relevance floors are per-backend. `EMBEDDING_SEARCH_MIN_SIMILARITY` remains the operator override
and always wins; when it is unset, the active backend's own floor applies, falling back to the
global 0.45. Cosine distributions belong to the model, not to search: on `all-MiniLM-L6-v2` the
0.45 default discards most true positives, so that backend declares 0.35. `EMBEDDING_BACKEND` and its companion
variables are the deployment defaults; the single-user Settings ▸ Intelligence screen can also
choose the provider, model, URL, and key at runtime, and those values are persisted in the
local SQLite database (the operator-settings model described in `README.md` and `SECURITY.md`).
The default `EMBEDDING_BACKEND=none` with nothing chosen in Settings leaves the feature absent.
On top of that, a server-side runtime toggle (stored in the `app_settings` table, key
`semantic_search_enabled`) turns it on and off live, consistently across the UI and MCP. An
optional `EMBEDDING_QUERY_PREFIX` is prepended to **search-query** embeddings
only (never to document embeddings) for instruct-tuned models — e.g. `qwen3-embedding`'s
`Instruct: …\nQuery:` or `nomic`'s `search_query: ` — so changing it needs no reindex.
`search_documents_semantic` returns trust-bearing references (`id`, `title`, `documentType`,
`projectId`, `tags`, `snippet`, `kind`, `updatedBy`, `updatedByAgent`, `updatedAt`, `verified`,
`verifiedAt`, `verifiedBy`, `stale`, `status`, `similarity`, and — in hybrid mode — `match`);
the embedding vector is never returned. `updatedAt` and `updatedByAgent` ride on the ref so a
retrieval client can weigh a hit by age and origin without fetching the whole document. When the feature is
disabled or not configured the tool yields a friendly fallback
message (use `search_documents` instead) rather than an error. The supporting routes —
`GET /api/library/documents/semantic-search` (cosine-ranked refs; 409 when disabled, 400 on a
blank query, 503 when a configured backend is unreachable), `POST /api/library/embeddings/reindex`
(rebuilds/repairs the index — add `?force=true` to re-embed **every** active document, e.g. after
changing the embedding model or upgrading), `GET`/`PUT /api/settings/semantic-search` (status +
the boolean toggle: `enabled` must be a JSON `true`/`false`, required when no provider field is
sent, and any other value returns `400` without changing anything; the status carries `connected` plus `unavailableReason`, a sentence naming
why a configured backend is not usable when the backend can say — the on-device backend reports
its missing runtime and the install command; other backends leave it `null`), and the provider
settings routes under `/api/settings` — are **HTTP-only**
and not part of the MCP surface. Each
document is embedded as its **title + body** together (so a query matching the title retrieves it).

The HTTP search keeps its legacy complete array response by default. Explicit pagination uses
`?page=true&limit=<1..50>&offset=<non-negative integer>` and returns
`{ items, page: { offset, limit, returned, total, hasMore, nextOffset }, index, degraded,
reason? }`; `total` is the exact number of relevant results after the configured cutoff, and
`index` (`{ total, embedded, pending }`) reports index coverage — when `pending > 0` the
response is `degraded: true` with `reason: "index-incomplete"`, because documents without a
current vector cannot be ranked. Only the paged envelope carries coverage; the legacy array
cannot. The web UI, the `prax` CLI, and the skill bundles use the paged envelope and surface
`degraded` rather than presenting a partial index as a complete miss.

**Retrieval mode.** `?mode=semantic` (the default) is the pure cosine ranking above.
`?mode=hybrid` fuses that ranking with the FTS5 BM25 ranking by Reciprocal Rank Fusion
(`k = 60`) and then weights each hit by trust; any other value is `400`. Hybrid exists for two
memory-shaped misses: a document whose vector is pending, stale, or from another model is
invisible to cosine alone (it is re-admitted by keyword rank), and an exact token — an error code,
a version, a file name — is what embeddings are worst at. Each hybrid ref carries
`match: { semanticRank, keywordRank, rrf, trust, score }` so the client can see *why* it placed
where it did; a ref with `semanticRank: null` was found by keyword only (the query's meaning did
not match), and the CLI/skill label it `keyword-only`. Trust is a bounded multiplier sized
against RRF's narrow score band: a verified memory gets ×1.05 (about three places up, and its
decay is arrested), an unverified one decays from ×1.0 toward a floor of ×0.9 with a one-year
half-life (never more than about six places down). It re-orders near-ties; it cannot let trust
outrank relevance, and `tests/backend/hybridRanking.test.js` pins that magnitude. The `prax`
CLI and the `prax-recall` skill request `mode=hybrid`; the web UI keeps the default. Older
servers ignore `mode` and answer with the cosine ranking.

Results are filtered by a gap-based relevance cutoff: only documents scoring within
`EMBEDDING_SEARCH_TOP_DROP` (default 0.20) of the best match and at least
`EMBEDDING_SEARCH_MIN_SIMILARITY` (default 0.45) cosine similarity are returned, so an unrelated
query can return few or no results rather than the whole ranked library. Both thresholds are
env-tunable (defaults calibrated for `qwen3-embedding:0.6b`). The same per-backend floor (above)
applies to every retrieval route: semantic search, both context packs, Ask, similar documents,
task related documents and the AI health review's neighbour search.

`POST /api/library/ask` accepts `{ q, project?, limit? }` and returns a grounded answer or the
retrieved context pack. Its response includes `sources` with trust fields and
`retrieval: { mode: "semantic"|"keyword", fallback, reason }`. Semantic failure or no-match
keyword fallback is explicit. The answer is generated from the full bodies of at most
`min(6, limit)` retrieved documents (verified first, bounded by a character budget); `sources`
lists exactly the documents placed in that answer context, in every response (with or without a
chat model), while `markdown` is the separate `limit`-bounded context pack. Generated answers over
a non-empty source set must cite an exact title from `sources`; otherwise the route returns `degraded: true`,
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

## Recall telemetry and the librarian

Design: [2026-09-23 librarian](design/librarian.md). Migration
`0040_recall_telemetry_and_librarian.sql` adds `recall_queries`, `recall_query_hits`,
`recall_uses` and `librarian_proposals`.

**Recording.** A retrieval is recorded only when its request carries
`x-prax-query-source: recall|search|context|mcp|assistant` (the CLI and skills send the first
three, the MCP server `mcp`, the in-app assistant `assistant`; any other value, or none, records
nothing). The agent id is taken from `x-prax-agent` when `x-prax-origin: agent` is also sent.
Recorded routes: `GET /api/library/documents/semantic-search` (the first page only; `hitCount`
is the page's `total`), `GET /api/library/documents?q=` (keyword; every returned id, at most 50
stored), and `GET /api/projects/:idOrSlug/context-pack?query=` / `GET /api/library/context-pack?q=`
(the pack's document ids; a project pack that fell back to recency records zero hits). Recording
is scheduled after the response and every failure is swallowed: the response body and status are
identical with telemetry on, off, or failing. Rows are deleted after 90 days and each table keeps
at most 20,000 rows. `PRAX_RECALL_TELEMETRY=off` turns recording off.

**Redaction.** `query` is never stored verbatim: credential spans are replaced by `[redacted]`
(`server/secretPatterns.js`: private-key blocks, AWS access key ids, GitHub, GitLab, Slack,
OpenAI and Anthropic tokens, JWTs, `Bearer`/`Basic` values, `password=`/`secret=`/`token=`/
`api_key=`-style assignments, URL passwords) over the whole query before the 500-character cap,
and `query_key` is computed from the redacted text.

| Route | Result |
|-------|--------|
| `POST /api/library/telemetry/used` `{ documentId, source? }` | `{ id, documentId, agent, occurredAt, title }`; 400 bad id, 404 unknown document, 409 `reason: "telemetry-off"` |
| `GET /api/library/telemetry` | `{ enabled, queries, uses, oldestAt, newestAt, retentionDays, maxQueryRows, maxUseRows }` |
| `DELETE /api/library/telemetry` | `{ cleared: { queries, uses } }` (works with recording off) |
| `GET /api/library/librarian/gaps` | `{ items: [{ query, queryKey, reason: "no-hits"\|"unused", occurrences, lastAskedAt, lastHitCount, agents, sources }], usedSignals, since, windowHours, enabled }` |
| `GET /api/library/librarian/recall-counts` | `{ counts: { <documentId>: { hits, uses, lastRecalledAt } }, since }` |
| `GET /api/library/librarian/prune-candidates?project=` | `{ ready, coverageDays, minAgeDays, items: [{ id, title, documentType, projectId, createdAt, updatedAt, updatedByAgent, verified }] }` |
| `GET /api/library/librarian/report?project=` | read-only: `{ status: "ok"\|"warn", checks: [{ id, level: "ok"\|"info"\|"warn", count, message }], health, index, clusters, proposals, gaps, prune, telemetry }` |
| `POST /api/library/librarian/run` `{ project?, embeddingThreshold?, shingleThreshold? }` | `{ method, thresholds, documentsScanned, documentsEligible, documentsWithVectors, truncated, clusters: [{ key, status: "new"\|"proposed"\|"covered"\|"dismissed"\|"approved", method, proposalId, projectId, documents, edges, truncatedFrom }], created: [{ id, title, projectId, sourceIds }] }`; thresholds are 0.5–0.999 |
| `GET /api/library/librarian/proposals?status=open\|approved\|dismissed` | `{ items: [{ documentId, clusterKey, projectId, sourceIds, method, status, createdAt, decidedAt, title, verified, archived, revision }] }` |
| `POST /api/library/librarian/proposals/:id/approve` | `{ proposal, results: [{ id, outcome: "superseded"\|"already-superseded"\|"missing"\|"archived"\|"cycle" }] }`; 403 `human-approval-required` for an agent-origin request, 409 `verify-first` for an unverified proposal, 409 `not-open` after a dismissal; a repeat returns `replayed: true` |
| `POST /api/library/librarian/proposals/:id/dismiss` | `{ proposal }`; archives the proposal document; 403 for an agent-origin request |
| `GET` / `PUT /api/library/librarian/settings` `{ scheduleEnabled }` | `{ scheduleEnabled, lastScheduledRunAt, telemetryEnabled }` |

Without a database the librarian routes answer 409 `reason: "unavailable"`.

**Proposals.** A run clusters active documents within each project (templates, weekly reviews
and earlier proposals excluded): cosine ≥ 0.92 between current vectors when semantic search is
on, 3-word shingle Jaccard ≥ 0.5 otherwise and for any pair lacking a current vector. Each new
cluster becomes one document: `kind: "synthesized"`, `updatedBy: "agent"`,
`updatedByAgent: "librarian"`, `verified: false`, tag `librarian-proposal`, with `derived-from`
links to its sources. A run never creates a `supersedes` link and never edits, archives or
retires a source; only approval of a verified proposal by a non-agent request does. Re-running
skips a cluster key already proposed (in any status) or wholly inside an open proposal.

**Review order.** `GET /api/library/health?sort=recall` orders `needsReview` by recall hits,
then uses, then the default order, and adds `recallHits` and `recallUses` to those rows (both
`null` when telemetry cannot be read). Any other `sort` value is 400. Without `sort` the
response is unchanged.

## Schema versions and downgrades

The schema version of a database is the set of migrations in its `schema_migrations` table; each
build ships `server/migrations/`. Startup and `npm run migrate` apply the missing ones in order.

- **Newer database, older build.** If the database records a migration this build does not ship,
  startup and `npm run migrate` refuse before changing anything, naming the unknown migration(s)
  and the last one this build knows (error code `PRAX_SCHEMA_TOO_NEW`). Older code never runs on a
  newer schema.
- **Newer backup, older build.** The restore command refuses a backup from a newer Prax, by its
  manifest and by its database (see [Full workspace backup ZIP](#full-workspace-backup-zip)).
- **Trigger set.** The FTS, lifecycle and supersession triggers on `markdown_documents` and
  `document_links` are listed once, in `EXPECTED_TRIGGERS` (`server/migrate.js`). After the final
  migration, inside its transaction, and at each startup of an up-to-date database, the set must
  match exactly: a missing, moved or unexpected trigger fails startup with its name, and a
  migration that caused it is rolled back. A table-rebuild migration must drop the
  `document_links` triggers before renaming and recreate every trigger afterwards.

`tests/backend/migrationSafety.test.js` and `tests/backend/restoreVersionGuard.test.js` pin these
rules.

## Regression tests

The shapes above are locked by characterization tests under `tests/contract/`, run by
`npm test`. They guard against *accidental* changes: a change to any shape turns a test red, so
you either revert it or update the test (and this document) **on purpose**. They are a safety
net for evolving the formats carefully — not a 1.0 stability guarantee.

## Request size limits

HTTP request bodies are limited to **1 MiB** (1,048,576 bytes of JSON, Fastify's default),
except `POST /api/tasks/import` and staged import chunks (50 MiB each). This is a deliberate
bound, not an accident of configuration: a document write — create, update, upsert-by-title,
Inbox and assistant writes through the same routes — therefore carries a Markdown body of just
under 1 MiB of UTF-8, less where JSON escaping expands it (quotes, backslashes, newlines and
other control characters). A larger body returns `413` with
`code: "FST_ERR_CTP_BODY_TOO_LARGE"` and nothing is written. Keep larger material as several
linked documents, or raise the limit deliberately together with the context-pack and embedding
budgets that read whole bodies.

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

An open session left untouched for 7 days expires: its staged chunks are deleted and it becomes
`cancelled`, so further chunks or a commit return `409` and its `requestId` stays reserved.
Expiry is applied whenever a session is created, read, extended or committed.

## Retrieval freshness and empty-result semantics

Library keyword terms preserve Unicode letters/numbers; a nonblank query without usable terms
returns an empty match set. Task text search treats `%` and `_` literally.

Semantic retrieval uses only vectors matching the current document revision and active embedding
model. Legacy body-only hashes cannot prove title freshness and require reindexing. Paged semantic
search reports `index:{total,embedded,pending}`; pending vectors produce
`degraded:true,reason:"index-incomplete"`. Semantic context-pack/Ask retrieval metadata carries
index coverage too. No stale vector is presented as a current semantic match.

`POST /api/library/documents/:id/wiki-link` (`{ title }`) links the first plain mention of `title`
in the body. The write is conditional on the revision it read: a concurrent change is `409`
`{message,reason:"revision-mismatch",document}`; no remaining mention is `409` without a reason; a
missing or archived document is `404`. Like every body write it refreshes the document's vector.

`GET /api/library/documents/:id/similar` now returns
`{items:[...],degraded:false}`, or `{items:[],degraded:true,reason}` where the reason includes
`semantic-off`, `not-indexed`, or `unavailable` for a repository without that capability. Missing owners return 404 for this route and the document's
`/tasks` child collection.

## Assistant approval recovery

Proposed write calls carry a server-generated `approvalId` in canonical history. The browser
persists pending history and identity before executing approval. Each write claims a durable
receipt before invoking its tool; matching concurrent approvals share the result, and a later
repeat returns the recorded outcome — a fixed note saying the action completed or reported an
error, with the call's `id`, `name` and `isError` — never the tool's original output, which could
hold a document body or task text that outlives a permanent delete (migration `0038` compacted
older receipts). Changed intent under the same identity is rejected. If a process stops between execution and
receipt completion, the result is explicitly unknown and the old approval is never blindly
re-executed. The person must inspect canonical workspace state before proposing a replacement.
The browser retains uncertain approvals across reload and offers a safe retry of the same action.

The server keeps the newest 120 turns of an echoed conversation, cut so the window opens on a
person's turn (a tool result is never separated from its call). Any turn or tool result longer
than 20,000 characters is cut with a trailing `[… N characters clipped]` note.

Model-proposed tool input is parsed with the tool's own schema (unknown keys rejected) before it
is proposed and again before it runs; invalid calls are answered with an error result and never
offered for approval. Each `pending` entry carries `summary`, `targets` (role, id, resolved title,
`missing` when absent), `changes` (every field the call sets, with `before` for updates and
`format: 'body'` for Markdown bodies) and `notes`. `decisions` maps each call id to `approve` or
`deny`; with several pending writes the browser sends nothing until every call has a decision,
and a safe retry resends the recorded decisions. A new supersedes edge (the supersede route or a
`supersedes` link) records the actor on the retired document's `retiredBy`/`retiredByAgent`
(migration `0043`), never on `updatedBy`: a supersession is not an edit. The edge itself keeps
its actor (`created_by`, `created_by_agent`), so a restore that re-retires the target attributes
the retirement to whoever made the edge. Reviving the document (the edge removed, or the
superseder archived) clears both.

Chat adapters return `finishReason` and `truncated`. Output cut off at the token limit is never
presented as complete: the assistant does not propose tool calls from it (`status:'error'`,
`reason:'truncated'`) and marks a truncated answer as incomplete; writing actions return
`{text:null, degraded:true, reason:'truncated'}`; Ask returns its sources with
`{answer:null, degraded:true, reason:'truncated'}` and Ask tasks `{tasks:[], degraded:true,
reason:'truncated'}`; runbook generation returns 502 with
`reason:'truncated'` and saves nothing; post-mortems fall back to the chronicle template with
`degraded:true, reason:'truncated'`. HTTP adapters apply a request timeout (180 s; 300 s for
Ollama). OpenAI Responses requests ask for `reasoning.encrypted_content` so stateless tool
continuations can replay reasoning; reasoning items without it are dropped on replay.

Weekly review counts Shipped from completion events in the selected UTC week (or an explicit completion timestamp). Reopening a task later does not erase its historical completion. Missing legacy completion dates are disclosed rather than inferred from creation or modification times. Creating a task already completed records a completion event.

Assistant recovery keeps pending approvals when the selected model is absent or cannot resume tools. `approval-unavailable` explicitly means that request executed no action; it does not erase any earlier uncertain outcome. The standalone demo opts into in-memory receipts alongside its in-memory workspace; production never falls back to volatile receipts when durable storage is unavailable.


## Bundled templates and guides

See [Templates and starter guides](templates-and-starter-guides.md) for the complete read-only
`GET /api/library/starters` catalogue contract and copy workflow. `template` is a first-class
document type on HTTP, CLI, MCP, skills and Markdown export. Raw Markdown import
continues to create notes without interpreting portable front matter. Starters never seed or
update Library rows during startup. Task starters use the existing atomic, receipt-backed
`POST /api/tasks/import` contract with one task and its checklist.

`POST /api/library/documents` also honours optional `verified: false` to create an unverified
human-origin draft (used by template copies). This flag only lowers initial trust.
`verified: true` cannot grant verification to an agent-origin create; verification still
requires the dedicated human review endpoint. Ordinary create defaults are unchanged.

For receipt-backed document creation, also supply `operationId` (UUID) and `id` (UUID).
The transaction records the normalised creation intent and result in the existing durable
document operation ledger (`document_upsert_receipts`, using a create-specific hash domain).
An identical retry returns the current document with `replayed: true`; changed intent returns
409, and a permanently deleted result returns 410. Neither title lookup nor upsert is used:
a fresh operation always creates an independent copy. The ledger outlives the result.
ID-only creation (no `operationId`) uses the creation receipts described under Format 3 (machine
creation identity), with the same replay, 409 and 410 outcomes.
