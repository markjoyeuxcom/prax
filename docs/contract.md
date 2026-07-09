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
| `deferredUntil` | ISO-8601 timestamp \| `null` (snooze target; hidden from Today until it passes) |
| `sortOrder` | 32-bit signed integer |
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

- `project` (slug or id) is **required**. `format` is validated if present; `version` is
  accepted but not validated.
- `projectId` is assigned server-side and is **never** read from the payload.
- Per-task accepted fields: `title` (required), `description`, `priority` (default
  `"medium"`), `status` (default `"planned"`), `dueDate`, `sortOrder` (defaults to the array
  index), `archivedAt`.
- **Max 500 tasks** per import.
- **Modes:** `"skip"` (default — skip duplicates), `"append"` (insert all as new),
  `"replace"` (clear the target project, then insert).
- **Duplicate key** (skip mode): `[ title (lowercased), projectId, status, dueDate ]`.
- Response: `{ "mode", "imported": <count>, "skipped": <count>, "tasks": [] }`.

## Format 2 — Library `.md` front-matter

Library export (`GET /api/library/export`) produces a ZIP of `.md` files. Each file is YAML
front-matter followed by the Markdown body, in this key order:

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

- `type` is `"runbook"` or `"note"` (defaults to `"note"`).
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
is one-way today. Documents are created/edited via the app, the HTTP API, or the MCP
`create_document` / `update_document` tools.

## Format 3 — MCP tools

The MCP server (`mcp/`) exposes these tools over stdio. Current tool names, input field names,
required/optional status, and enum option sets. Shared enums: `STATUS`
(`high-priority`, `in-progress`, `planned`, `completed`, `notes`), `PRIORITY` (`high`,
`medium`, `low`), `DOCUMENT_TYPE` (`runbook`, `note`),
`KIND` (`source`, `synthesized`).

| Tool | Inputs | Read-only |
|------|--------|-----------|
| `search_tasks` | `query?`, `project?`, `status?:STATUS` | yes |
| `get_task` | `id` | yes |
| `create_task` | `title`, `project`, `description?`, `priority?:PRIORITY`, `status?:STATUS`, `dueDate?`, `recurrence?` | — |
| `update_task` | `id`, `title?`, `description?`, `notes?`, `priority?:PRIORITY`, `status?:STATUS`, `project?`, `dueDate?`, `recurrence?` | — |
| `search_documents` | `query?`, `project?`, `documentType?:DOCUMENT_TYPE`, `tags?`, `kind?:KIND`, `status?:{active\|superseded\|deprecated\|all}` | yes |
| `ask_library` | `query`, `project?`, `limit?` → Markdown context pack (semantic when configured, keyword otherwise) | yes |
| `get_document` | `id` | yes |
| `create_document` | `title`, `body`, `documentType:DOCUMENT_TYPE`, `project`, `tags?`, `kind?:KIND` | — |
| `update_document` | `id`, `title?`, `body?`, `documentType?:DOCUMENT_TYPE`, `project?`, `tags?`, `kind?:KIND` | — |
| `list_task_documents` | `taskId` | yes |
| `link_task_document` | `taskId`, `documentId` | — |
| `unlink_task_document` | `taskId`, `documentId` | — |
| `list_task_checklist` | `taskId` | yes |
| `add_checklist_item` | `taskId`, `label` | — |
| `set_checklist_item` | `taskId`, `itemId`, `completed` | — |
| `delete_checklist_item` | `taskId`, `itemId` | — |
| `list_task_activity` | `taskId` | yes |
| `list_document_links` | `documentId`, `direction?:{outbound\|inbound\|both}` | yes |
| `link_documents` | `sourceId`, `targetId`, `relation:{derived-from\|supersedes}` | — |
| `unlink_documents` | `sourceId`, `targetId`, `relation:{derived-from\|supersedes}` | — |
| `supersede_document` | `documentId`, `supersededBy` | — |
| `list_stale_documents` | `project?` | yes |
| `list_orphan_documents` | `project?` | yes |
| `search_documents_semantic` | `query`, `project?` | yes |

MCP-owned output shapes:

- Task summary (from `search_tasks`): `{ id, title, status, priority, projectId, dueDate }`.
- Document summary (from `search_documents`): `{ id, title, documentType, projectId, tags, snippet }` (snippet ≤ 200 chars).
- `link_task_document` → `{ linked: true, taskId, documentId, documents: [] }`.
- `unlink_task_document` → `{ unlinked: true, taskId, documentId }`.
- `delete_checklist_item` → `{ deleted: true, taskId, itemId }`.
- List results are capped at **20** items.

Full-record tools (`get_task`, `get_document`, `create_*`, `update_*`) return the full task or
document record (the fields in the tables above). Operations intentionally **not** exposed over
MCP — archive, permanent delete, reorder, project CRUD, task import/export, library export —
remain HTTP-only.

Document graph: `document_links` are directed, typed edges (`derived-from`, `supersedes`)
between documents, created/removed/listed via the tools above and the
`/api/library/documents/:id/links` endpoints. `GET /api/library/documents/:id` and
`GET /api/tasks/:id` fetch a single record by id (returning archived records too). Outbound
links are serialized into the `links:` block of every exported `.md` file (see Format 2).

Document provenance: documents expose `contentHash` (SHA-256 of the body) and `updatedBy`
(`"user"` | `"agent"`). Every document write stamps `updatedBy` from the `x-prax-origin`
request header; the MCP client sends `"agent"` automatically. `derived-from` links snapshot
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

### Trust fields

Documents carry four runtime trust/workflow fields. These are **not** part of the portable
`.md` export front-matter — the export shape is unchanged (trust state is not carried in the
export). If `.md` import is added in the future, an imported document would start unverified;
trust state is managed via the `verify`/`supersede` endpoints below.

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | `true` when a human has blessed the document. Agent writes (MCP `create_document` / `update_document`, CLI `remember`) land `false` by default; the `0007` migration backfills existing rows: `updated_by = 'user'` → `true`, `updated_by = 'agent'` → `false`. |
| `verifiedAt` | ISO-8601 timestamp \| `null` | When the document was last verified (or unverified). `null` when `verified` is `false` and has never been set. |
| `verifiedBy` | string \| `null` | Who verified the document (a name, `"cli"`, `"user"`, etc.). `null` when unverified. |
| `status` | `"active"` \| `"superseded"` \| `"deprecated"` | Lifecycle state. New documents are `"active"`. `POST .../supersede` sets the old document to `"superseded"`. `"deprecated"` is reserved for manual use (stale, no replacement). |

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
or `prax verify --as`), so `verified` keeps meaning "a human blessed it." `supersede` **is**
available to agents via the `supersede_document` MCP tool (content lifecycle, not self-blessing),
in addition to the HTTP route below.

`POST /api/library/documents/:id/verify`

Body: `{ "verified": <boolean>, "as": "<name>" }` (`as` is optional; defaults to `"user"`
when `verified: true`). Sets `verified`, `verifiedAt`, and `verifiedBy`. Returns the full
updated document record (404 if not found, 400 if `verified` is not a boolean).

`POST /api/library/documents/:id/supersede`

Body: `{ "supersededBy": "<newDocumentId>" }`. Records a `supersedes` link from `newDocumentId`
to the old document, then sets the old document's `status` to `"superseded"`. Returns the
full updated old-document record (400 on invalid UUIDs or self-supersede, 404 if either
document is not found).

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
**retrieval-only** — no text is generated. Availability is **Postgres-only**: it requires the
pgvector extension and a configured `EMBEDDING_BACKEND`: `ollama`, `openai` (any
OpenAI-compatible `/v1/embeddings` server — real OpenAI, llama.cpp, vLLM, LiteLLM, … via
`OPENAI_BASE_URL` + optional `OPENAI_API_KEY`), or the deterministic `fake` test backend. The
default `EMBEDDING_BACKEND=none` leaves the feature absent. On top of that config gate, a
server-side runtime toggle (stored in the `app_settings` table, key `semantic_search_enabled`)
turns it on and off live, consistently across the UI and MCP; all backend config (URLs, models,
keys) is env-only. An optional `EMBEDDING_QUERY_PREFIX` is prepended to **search-query** embeddings
only (never to document embeddings) for instruct-tuned models — e.g. `qwen3-embedding`'s
`Instruct: …\nQuery:` or `nomic`'s `search_query: ` — so changing it needs no reindex. `search_documents_semantic` returns the **same ref shape** as keyword `search_documents`
(`{ id, title, documentType, projectId, tags, snippet }`); the embedding vector is never
returned. When the feature is disabled or not configured the tool yields a friendly fallback
message (use `search_documents` instead) rather than an error. The supporting routes —
`GET /api/library/documents/semantic-search` (cosine-ranked refs; 409 when disabled, 400 on a
blank query, 503 when a configured backend is unreachable), `POST /api/library/embeddings/reindex`
(rebuilds/repairs the index — add `?force=true` to re-embed **every** active document, e.g. after
changing the embedding model or upgrading), and `GET`/`PUT /api/settings/semantic-search`
(read-only status + the boolean toggle) — are **HTTP-only** and not part of the MCP surface. Each
document is embedded as its **title + body** together (so a query matching the title retrieves it).

Results are filtered by a gap-based relevance cutoff: only documents scoring within
`EMBEDDING_SEARCH_TOP_DROP` (default 0.20) of the best match and at least
`EMBEDDING_SEARCH_MIN_SIMILARITY` (default 0.45) cosine similarity are returned, so an unrelated
query can return few or no results rather than the whole ranked library. Both thresholds are
env-tunable (defaults calibrated for `qwen3-embedding:0.6b`).

## Regression tests

The shapes above are locked by characterization tests under `tests/contract/`, run by
`npm test`. They guard against *accidental* changes: a change to any shape turns a test red, so
you either revert it or update the test (and this document) **on purpose**. They are a safety
net for evolving the formats carefully — not a 1.0 stability guarantee.
