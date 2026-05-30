# v1.0.0 Contract Freeze — Design

**Date:** 2026-05-29
**Status:** Approved (design)
**Scope:** Documentation + CI contract tests. No `/api/v1`, no HTTP-API freeze, no `.md` import parser.

## Goal

Declare Moomora Console's **stable public contract** for the 1.0 release and add CI tests that fail the build when a frozen shape drifts. Two surfaces are frozen as the public contract:

1. The **export / import formats** — the `moomora.tasks` task envelope and the library `.md` front-matter — because users create backup artifacts that must stay importable across upgrades.
2. The **MCP tool surface** — consumed by external clients (Claude Code) over stdio.

The **HTTP API** is documented as *internal*: it is consumed only by the co-shipped frontend and the local MCP server (everything ships in one versioned image and moves in lockstep), so it carries no stability guarantee and may change between releases.

## Why these surfaces (and not the HTTP API)

The frontend, HTTP API, and MCP server are built and released as a single versioned container image. The only consumers that live *outside* that image are:

- Backup files a user exported yesterday and imports after upgrading.
- An MCP client (Claude Code) talking to the local MCP server.

Freezing the HTTP API would lock its response shapes and constrain refactoring for no external benefit, since no documented external consumer depends on it directly. So the HTTP API is documented but explicitly marked internal; durable integration is steered toward the export formats and the MCP server.

## Stability policy (to be stated in the contract doc)

Three tiers:

- **Stable (1.0 contract):** export/import formats + MCP tools. Within a `1.x` line: **no breaking changes**. Existing fields keep their name, type, and meaning. Only additive changes are allowed: new optional fields, new MCP tools, new optional tool inputs.
  - Breaking the **export format** requires bumping the envelope `version` (`1` → `2`) while continuing to *read* v1 payloads on import.
  - Breaking the **MCP surface** (removing/renaming a tool, removing an input, making an optional input required, narrowing an enum) requires a new **major** app version and a documented migration.
- **Internal:** HTTP API. Documented for the curious; may change between any release. For durable integration use the export formats or the MCP server.
- Semver mapping: a stable-surface break ⇒ **major** bump; additive change ⇒ **minor**; bug fix ⇒ **patch**.

Forward-compatibility rule for consumers: **importers MUST ignore unknown fields**; exporters MAY add fields within a major version.

## Frozen contract — exact shapes

These are the shapes the contract doc documents and the contract tests lock. All field names, enums, and ordering below are taken verbatim from the current source at `0.7.7`.

### 1. Task export envelope — `moomora.tasks` v1

Produced by `GET /api/tasks/export` (`server/tasksRoutes.js`). Envelope keys (exact set):

```
format     "moomora.tasks"   (exact string, case-sensitive)
version    1                 (integer)
exportedAt ISO-8601 datetime
project    project slug | "all"
tasks      Task[]
```

Each `Task` object key set (exact):

```
id          UUID
title       string (required)
description string ("" if unset)
notes       string ("" if unset)
priority    "high" | "medium" | "low"
status      "high-priority" | "in-progress" | "planned" | "completed" | "notes"
projectId   UUID
dueDate     "YYYY-MM-DD" | null
sortOrder   32-bit signed integer
createdAt   ISO-8601 timestamp
updatedAt   ISO-8601 timestamp
archivedAt  ISO-8601 timestamp | null
```

### 2. Task import contract

`POST /api/tasks/import` (`server/tasksRoutes.js`). Request body:

```
format   "moomora.tasks"   (optional; validated if present)
version  integer           (optional; not validated)
project  slug | id          (REQUIRED)
mode     "skip" | "append" | "replace"   (optional; default "skip")
tasks    Array of:
           title       string (REQUIRED)
           description string (optional)
           priority    enum   (optional; default "medium")
           status      enum   (optional; default "planned")
           dueDate     "YYYY-MM-DD" (optional)
           sortOrder   integer (optional; falls back to array index)
           archivedAt  ISO-8601 | null (optional)
```

Rules frozen by the contract:

- **`projectId` is assigned server-side** and is never read from the import payload.
- **Max 500 tasks** per import (`MAX_IMPORT_TASKS`).
- `sortOrder` range: `-2147483648 .. 2147483647`.
- **Modes:** `skip` (skip duplicates), `append` (insert all as new), `replace` (clear the target project, then insert).
- **Duplicate key** (skip mode): `[ title(lowercased), projectId, status, dueDate ]` joined with the ASCII unit separator `\u001f`.
- Response: `{ mode, imported: <count>, skipped: <count>, tasks: Task[] }`.

### 3. Library `.md` front-matter

Produced by `formatFrontMatter` / `renderDocumentMarkdown` in `server/libraryExport.js`, mirrored byte-for-byte in `public/js/libraryExport.js`. **Frozen key order:**

```
---
title: <yaml-string>
type: <yaml-string>          # "runbook" | "note"; defaults to "note"
project: <yaml-string>       # project slug, or "unknown"
tags: []                     # OR a block list (see below)
created_at: <raw ISO value or empty>   # NOT yaml-quoted
updated_at: <raw ISO value or empty>   # NOT yaml-quoted
---

<markdown body>
```

- **tags:** empty → literal `tags: []`. Non-empty → `tags:` followed by `  - <yaml-string>` lines, one per tag.
- **`created_at` / `updated_at`** are emitted as the raw `createdAt` / `updatedAt` value (or empty string), **not** run through the YAML quoter.
- **Body:** if non-empty, separated from the closing `---` by one blank line and guaranteed a trailing newline. If the body is empty, the file is the front-matter block alone.
- **YAML quoting** (`yamlString`): empty string → `""`. A value is quoted when it contains any of `: " \ <newline> #`, or starts with `-`, or starts/ends with whitespace. Escapes inside a quoted value: `\` → `\\`, newline → `\n`, `"` → `\"`.

Filename rules (`documentFilename`, `dedupeFilenames`, `libraryArchiveFilename`):

- Prefer `sourceFilename` (basename only; leading dots stripped; trimmed; `.md` appended if missing).
- Else slugify the title (lowercase, non-alphanumeric runs → `-`, trim leading/trailing `-`) + `.md`.
- Else `untitled.md`.
- Per-path dedup: append `-2`, `-3`, … before the `.md` extension.
- ZIP layout: `moomora-console-library-<scope>-<YYYY-MM-DD>.zip`; entries under `<project-slug>/<file>.md` for all-projects scope, flat for single-project scope.

**Explicit non-promise:** library `.md` / document **import (round-trip) is not supported at 1.0**. Library export is one-way. The contract doc states this so it is a conscious, documented gap rather than an implied capability.

### 4. MCP tool surface

Sixteen tools (factories in `mcp/tools/*.js`, registered in `mcp/server.js`). Each tool: `name`, `title`, `description`, `inputSchema` (a map of field name → Zod schema), optional `annotations`, `handler`. Frozen shared enums:

```
STATUS        = high-priority | in-progress | planned | completed | notes
PRIORITY      = high | medium | low
DOCUMENT_TYPE = runbook | note
```

Frozen tool list with input fields (`?` = optional):

| Tool | Inputs | Read-only |
|------|--------|-----------|
| `search_tasks` | `query?:str`, `project?:str`, `status?:STATUS` | yes |
| `get_task` | `id:str` | yes |
| `create_task` | `title:str(min1)`, `project:str`, `description?:str`, `priority?:PRIORITY`, `status?:STATUS`, `dueDate?:str` | — |
| `update_task` | `id:str`, `title?:str(min1)`, `description?:str`, `notes?:str`, `priority?:PRIORITY`, `status?:STATUS`, `project?:str`, `dueDate?:str` | — |
| `search_documents` | `query?:str`, `project?:str`, `documentType?:DOCUMENT_TYPE`, `tags?:str[]` | yes |
| `get_document` | `id:str` | yes |
| `create_document` | `title:str(min1)`, `body:str`, `documentType:DOCUMENT_TYPE`, `project:str`, `tags?:str[]` | — |
| `update_document` | `id:str`, `title?:str(min1)`, `body?:str`, `documentType?:DOCUMENT_TYPE`, `project?:str`, `tags?:str[]` | — |
| `list_task_documents` | `taskId:str` | yes |
| `link_task_document` | `taskId:str`, `documentId:str` | — |
| `unlink_task_document` | `taskId:str`, `documentId:str` | — |
| `list_task_checklist` | `taskId:str` | yes |
| `add_checklist_item` | `taskId:str`, `label:str(min1)` | — |
| `set_checklist_item` | `taskId:str`, `itemId:str`, `completed:bool` | — |
| `delete_checklist_item` | `taskId:str`, `itemId:str` | — |
| `list_task_activity` | `taskId:str` | yes |

MCP-owned output shapes (defined by the MCP layer itself, therefore frozen):

- `toTaskRef` → `{ id, title, status, priority, projectId, dueDate }`
- `toDocumentRef` → `{ id, title, documentType, projectId, tags, snippet }` (snippet ≤ 200 chars)
- `link_task_document` → `{ linked: true, taskId, documentId, documents: [] }`
- `unlink_task_document` → `{ unlinked: true, taskId, documentId }`
- `delete_checklist_item` → `{ deleted: true, taskId, itemId }`
- List results capped at **20** items (`capResults`).

Full-record passthroughs (`get_task`, `get_document`, `create_*`, `update_*`) return the full task/document record. Those records mirror the (internal) HTTP shape and are documented as "the full record" rather than field-frozen — the *frozen* MCP commitment is the tool names, input schemas, enums, and the MCP-owned output shapes above.

Intentionally **not** exposed over MCP (documented as deliberate): archive, permanent delete, reorder, project CRUD, task import/export, library export. These remain HTTP-only.

## Deliverables

### A. Contract document — `docs/contract.md`

A single document with: the stability tiers & policy (above), the three frozen format specs, the MCP tool table, and a short "HTTP API is internal" note. The forward-compat rules and the `.md`-import non-promise are stated explicitly.

### B. Contract tests — `tests/contract/` (auto-discovered by `node --test`)

The repo's `npm test` runs `node scripts/run-tests.js` with no args → `node --test`, which recursively discovers every `*.test.js` (and skips `node_modules`). A new `tests/contract/` directory is picked up with no wiring change.

These are deliberately **shape-lock** tests, distinct from the existing behavioral tests in `tests/backend`, `tests/frontend`, `tests/mcp`. They assert the frozen *set* of fields / enums / tools, so any addition or removal trips them and forces a conscious decision: revert, or bump the version + update the doc + update the test.

1. **`tests/contract/taskFormat.test.js`**
   - Build an in-memory app (same harness pattern as `tests/backend/tasksRoutes.test.js`), seed a task, call `GET /api/tasks/export`.
   - Assert the envelope key set is exactly `{format, version, exportedAt, project, tasks}`, `format === "moomora.tasks"`, `version === 1`.
   - Assert each exported task's key set equals the frozen set, and that `priority`/`status` only ever hold the frozen enum values.
   - Assert `POST /api/tasks/import` applies the documented defaults (`priority: medium`, `status: planned`, `mode: skip`), that `skip` dedups on the documented key, that `replace` clears first, and that the 501st task is rejected (500 cap boundary).

2. **`tests/contract/libraryMarkdownFormat.test.js`**
   - Golden assertion: for a representative doc (with tags, with a colon in the title to exercise quoting, and an empty-body doc), assert `renderDocumentMarkdown` produces an exact expected string (front-matter keys, order, quoting, blank-line/body handling) embedded in the test.
   - Assert the browser serializer in `public/js/libraryExport.js` produces a **byte-identical** string for the same inputs (locks the dual-write invariant as contract).
   - Assert `documentFilename` precedence (sourceFilename → slug → `untitled.md`), `dedupeFilenames` `-N` suffixing, and `libraryArchiveFilename` shape.

3. **`tests/contract/mcpToolContract.test.js`**
   - Import all five `create*Tools()` factories with a stub client; flatten the tool list.
   - Assert the set of tool names **contains** the frozen 16 and that **none** of the frozen names is missing (new tools allowed; removals/renames fail).
   - For each frozen tool, introspect its `inputSchema` and assert: the input field-name set matches the frozen table, which fields are optional matches, and enum-typed fields expose exactly the frozen option set (Zod introspection).
   - Assert the MCP-owned output wrapper shapes (`link`/`unlink`/`delete` confirmations, `toTaskRef`/`toDocumentRef` key sets) and the cap of 20.

### C. References

- Add a short **"Stability & Compatibility"** section to `README.md` linking to `docs/contract.md`.
- Add a one-line pointer from `mcp/README.md` to the MCP section of the contract doc.
- No `package.json` `check` change (contract tests are executed, not syntax-checked).

## Out of scope (YAGNI)

- No `/api/v1` prefix or HTTP-API version negotiation.
- No freeze of HTTP response shapes (HTTP API stays internal).
- No `.md` / document import parser (round-trip import remains unsupported at 1.0).
- No `CHANGELOG.md` / `SECURITY.md` — those are separate v1.0.0 punch-list items.

## Testing strategy

Contract tests are intentionally "annoying": they fail the moment a frozen shape changes. That failure is the enforcement mechanism — it forces the change to be either reverted or deliberately versioned (bump `version` / major, update `docs/contract.md`, update the test). They complement, not replace, the existing behavioral tests.
