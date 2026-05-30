# Moomora Console — Stability & Compatibility Contract

This document defines Moomora Console's **public contract** as of the 1.0 release: which
interfaces are stable, what "stable" promises, and how breaking changes are versioned.

## Stability tiers

| Tier | Surfaces | Promise |
|------|----------|---------|
| **Stable** | Export/import formats (`moomora.tasks` task backups, library `.md` front-matter) and the MCP tool surface | Within a `1.x` line, changes are **additive only** — new optional fields, new MCP tools, new optional tool inputs. Existing fields keep their name, type, and meaning. |
| **Internal** | The HTTP API (`/api/…`) | No stability guarantee. Consumed by the co-shipped frontend and the local MCP server, which are released together as one versioned image. May change between any release. |

For durable, version-independent integration, use the **export formats** or the **MCP server** —
not the HTTP API directly.

### How breaking changes are versioned

- **Export format:** a breaking change bumps the envelope `version` (`1` → `2`); importers
  continue to accept `version: 1` payloads.
- **MCP surface:** removing or renaming a tool, removing an input, making an optional input
  required, or narrowing an enum is a breaking change and requires a new **major** app version
  plus a documented migration.
- **Semver mapping:** a stable-surface break ⇒ **major** bump; an additive change ⇒ **minor**;
  a bug fix ⇒ **patch**.

### Forward-compatibility rule for consumers

Importers and MCP clients **MUST ignore unknown fields**. Exporters and the server **MAY add
fields** within a major version. Do not hard-fail on a field you do not recognise.

## Stable surface 1 — Task export/import (`moomora.tasks`)

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

## Stable surface 2 — Library `.md` front-matter

Library export (`GET /api/library/export`) produces a ZIP of `.md` files. Each file is YAML
front-matter followed by the Markdown body, in this exact key order:

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
---

# Postgres restore

Steps...
```

- `type` is `"runbook"` or `"note"` (defaults to `"note"`).
- `project` is the project slug, or `"unknown"`.
- `tags` is `[]` when empty, otherwise a YAML block list.
- `created_at` / `updated_at` are the raw timestamps (not quoted).
- A value is YAML-quoted when it contains `:`, `"`, `\`, a newline, or `#`, or starts with
  `-`, or starts/ends with whitespace; inside quotes, `\` → `\\`, newline → `\n`, `"` → `\"`.
- **Filenames:** prefer `sourceFilename` (basename only, leading dots stripped, `.md`
  appended if missing); else the slugified title + `.md`; else `untitled.md`. Collisions
  within a folder get a `-2`, `-3`, … suffix.
- **ZIP layout:** `moomora-console-library-<scope>-<YYYY-MM-DD>.zip`, with entries under
  `<project-slug>/<file>.md` for an all-projects export (flat for a single project).

**Not promised at 1.0:** library `.md` / document **import (round-trip) is not supported**.
Library export is one-way. Documents are created/edited via the app, the HTTP API, or the MCP
`create_document` / `update_document` tools.

## Stable surface 3 — MCP tools

The MCP server (`mcp/`) exposes these tools over stdio. Tool names, input field names,
required/optional status, and enum option sets are frozen. Shared enums: `STATUS`
(`high-priority`, `in-progress`, `planned`, `completed`, `notes`), `PRIORITY` (`high`,
`medium`, `low`), `DOCUMENT_TYPE` (`runbook`, `note`).

| Tool | Inputs | Read-only |
|------|--------|-----------|
| `search_tasks` | `query?`, `project?`, `status?:STATUS` | yes |
| `get_task` | `id` | yes |
| `create_task` | `title`, `project`, `description?`, `priority?:PRIORITY`, `status?:STATUS`, `dueDate?` | — |
| `update_task` | `id`, `title?`, `description?`, `notes?`, `priority?:PRIORITY`, `status?:STATUS`, `project?`, `dueDate?` | — |
| `search_documents` | `query?`, `project?`, `documentType?:DOCUMENT_TYPE`, `tags?` | yes |
| `get_document` | `id` | yes |
| `create_document` | `title`, `body`, `documentType:DOCUMENT_TYPE`, `project`, `tags?` | — |
| `update_document` | `id`, `title?`, `body?`, `documentType?:DOCUMENT_TYPE`, `project?`, `tags?` | — |
| `list_task_documents` | `taskId` | yes |
| `link_task_document` | `taskId`, `documentId` | — |
| `unlink_task_document` | `taskId`, `documentId` | — |
| `list_task_checklist` | `taskId` | yes |
| `add_checklist_item` | `taskId`, `label` | — |
| `set_checklist_item` | `taskId`, `itemId`, `completed` | — |
| `delete_checklist_item` | `taskId`, `itemId` | — |
| `list_task_activity` | `taskId` | yes |

MCP-owned output shapes (frozen):

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

## Enforcement

These shapes are locked by characterization tests under `tests/contract/`, run by `npm test`.
A change to any frozen shape turns those tests red. Resolving a red contract test means either
reverting the change or making it deliberately: bump the relevant `version` / major release,
update this document, and update the contract test.
