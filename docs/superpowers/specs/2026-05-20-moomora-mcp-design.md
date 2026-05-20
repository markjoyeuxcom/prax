# Moomora MCP Server — Design Spec

**Date:** 2026-05-20
**Status:** Approved for implementation

## Goal

Let the operator use Claude Code interactively to search, read, create, edit, and
cross-link Moomora's tasks and library documents — running on a Claude Pro/Max
subscription rather than the Anthropic API. The bridge is a local MCP (Model Context
Protocol) server that exposes Moomora's existing HTTP API as a set of tools Claude Code
can call.

This is the "WikiLLM over an API" pattern: instead of pointing Claude Code at a folder of
Markdown files, we point it at Moomora's API, and the Postgres full-text search index
(added in v0.2.0) becomes the retrieval engine.

## Why this approach

- **Subscription, not API billing.** Interactive Claude Code use runs against the user's
  Pro/Max plan. The Anthropic Agent SDK and programmatic API calls require an API key with
  separate billing; an MCP server consumed by interactive Claude Code does not.
- **Single source of truth.** Data stays in Postgres. No export/sync step, always current,
  works across all three contexts.
- **Reuses existing validation.** Tools call the HTTP API, so Claude's writes go through
  the same route validation and business logic the web UI uses — no second code path.

## Scope

In scope: a local stdio MCP server in a new `mcp/` folder, wrapping Moomora's HTTP API
with read and write tools for documents and tasks, plus doc↔task linking.

Out of scope (deliberately excluded):

- **Destructive operations:** no archive (soft-delete), no permanent-delete, no reorder,
  no import tools. The worst case Claude can cause is an unwanted draft or edit, which the
  operator can see and fix.
- **Remote/HTTP transport.** stdio only (local single-operator homelab). The architecture
  leaves room to add an HTTP transport later without reworking tools.
- **In-app AI features.** This is not an `/api/ask` endpoint inside Moomora's UI; that
  would be the API-key path and is a separate decision.

## Architecture

```
mcp/
├── server.js          entry: registers tool groups, starts stdio transport (wiring only)
├── moomoraClient.js   the only module that talks HTTP to Moomora's API
├── tools/
│   ├── documents.js   search/get/create/update document tools
│   ├── tasks.js       search/get/create/update task tools
│   └── links.js       list/link/unlink doc↔task tools
└── (registered in the root package.json; no separate toolchain)
```

- **Transport:** stdio. Claude Code spawns `node mcp/server.js` as a subprocess.
- **`moomoraClient.js`:** the single HTTP boundary. Reads `MOOMORA_API_URL`
  (default `http://127.0.0.1:3000`) and an optional `MOOMORA_API_TOKEN`. When the token is
  set it is sent as `Authorization: Bearer <token>`; when unset the header is omitted (a
  no-op today, ready for the planned ingress auth). Owns base URL, headers, request
  timeout, and error normalization.
- **`tools/*.js`:** each module exports tool definitions (name, description, input schema,
  handler). A handler validates/normalizes args, calls a `moomoraClient` method, and shapes
  the response. Grouped by domain so each file stays small and independently testable.
- **`server.js`:** imports the tool groups, registers them with the SDK server, connects
  the stdio transport. No business logic.

**Key boundary:** tools never touch HTTP directly; the client never knows about MCP.
Either side can be understood and tested in isolation.

- **Dependency:** `@modelcontextprotocol/sdk` (latest at design time: `1.29.0`; pin the
  caret range `^1.29.0` after verifying the current version at implementation time), added
  to the existing root `package.json`.

### Registration with Claude Code

Documented as a one-time command, e.g.:

```bash
claude mcp add moomora -- node /absolute/path/to/mcp/server.js
# with env: MOOMORA_API_URL=http://127.0.0.1:3000  (and MOOMORA_API_TOKEN if used)
```

The exact, verified command and an `.mcp.json`/settings example are produced during
implementation.

## Tools

### Reads (always available)

| Tool | Args | Wraps | Returns |
|---|---|---|---|
| `search_documents` | `query`, `context?`, `documentType?`, `tags?` | `GET /api/library/documents?q=&context=&documentType=` (Postgres FTS) | Lightweight refs: `[{id, title, documentType, context, tags, snippet}]` — no bodies |
| `get_document` | `id` | library list/detail | Full doc: `{id, title, body, documentType, context, tags, …}` |
| `search_tasks` | `query?`, `context?`, `status?` | `GET /api/tasks?q=&context=&status=` | Task summaries: `[{id, title, status, priority, context, dueDate}]` |
| `get_task` | `id` | task list/detail | Full task record: `{id, title, description, status, priority, context, dueDate, sortOrder, …}` |
| `list_task_documents` | `taskId` | `GET /api/tasks/:id/documents` | Linked-doc summaries |

### Writes

| Tool | Args | Wraps |
|---|---|---|
| `create_document` | `title`, `body`, `documentType`, `context`, `tags?` | `POST /api/library/documents` |
| `update_document` | `id`, + any of `title/body/documentType/context/tags` | `PATCH /api/library/documents/:id` |
| `create_task` | `title`, `context` (required); optional `description`, `priority` (default `medium`), `status` (default `planned`), `dueDate` | `POST /api/tasks` |
| `update_task` | `id`, + any of `title/description/priority/status/context/dueDate` | `PATCH /api/tasks/:id` |
| `link_task_document` | `taskId`, `documentId` | `POST /api/tasks/:id/documents` |
| `unlink_task_document` | `taskId`, `documentId` | `DELETE /api/tasks/:id/documents/:documentId` |

### Context handling

Search/list tools accept an **optional** `context` argument (`personal` / `work` /
`homelab`). When omitted, the query spans all contexts. This supports both
"search everything" and scoped questions per call.

### Valid enums (mirrors the API)

- `context`: `personal`, `work`, `homelab`
- `documentType`: `runbook`, `note`
- task `status`: `high-priority`, `in-progress`, `planned`, `completed`, `notes`
- task `priority`: `high`, `medium`, `low`

(Source of truth: the `STATUSES`, `PRIORITIES`, `CONTEXTS`, and `PATCH_FIELDS` sets in
`server/tasksRoutes.js`; `DOCUMENT_TYPES`/`CONTEXTS` in `server/libraryRoutes.js`. The
implementation re-checks these so the tool schemas cannot drift from the API.)

Note: `sortOrder` is a writable task field on the API but is intentionally **not** exposed
by `update_task` — reordering is out of scope for this slice.

## Data flow & response shapes

Typical read ("what runbooks cover the cluster upgrade?"):

```
Claude → search_documents{query:"cluster upgrade", context:"homelab"}
   → moomoraClient.listDocuments(...) → GET /api/library/documents?q=…&context=homelab
   ← [{id, title, documentType, tags, snippet}, …]      (refs only — no bodies)
Claude picks the relevant ref →
Claude → get_document{id} → GET … ← full body
Claude answers from the body.
```

Two round-trips, but only the chosen document's body enters context. FTS ranking does the
narrowing, so this scales to 100+ documents.

Response shaping rules (in the tool handlers, not the client):

- `search_*` strips bodies and derives a short `snippet` (first ~200 chars of body, or a
  match excerpt). Results are capped (default 20) so a broad query cannot flood context.
- `get_*` returns the full record as-is.
- All results are returned as **structured JSON** (serialized by the SDK), so Claude
  receives typed fields rather than prose to re-parse.
- Writes return the created/updated record's `id` plus key fields, so Claude can confirm
  and chain operations (e.g. create a document, then link it to a task).

**Snippet sourcing:** the list endpoint currently returns full bodies (the frontend uses
them). The tool handler trims them before returning, so the token-economy win lives in the
MCP layer and the API is unchanged. Making the API itself return snippets is a possible
later optimization, not part of this slice.

## Error handling

The server sits between Claude and the API. It must never crash and never return a raw
stack trace; every failure becomes a clear sentence Claude can reason about.

In `moomoraClient.js` (one place for all failure modes):

- **Connection refused / timeout** (Moomora not running) → throw a typed
  `MoomoraUnavailableError`: *"Moomora API not reachable at `<url>` — is the server
  running?"* A ~5s timeout via `AbortController` prevents a hung API from hanging Claude.
- **Non-2xx responses** → throw `MoomoraApiError` carrying the status code and the API's
  `{message}` body (the routes already return structured messages, e.g. *"title is
  required"*, *"document not found"*).

In the tool handlers:

- Catch those errors and return them as an MCP **tool error result** (`isError: true`) with
  a readable message — not a thrown exception. Claude sees *"Couldn't create document:
  title is required"* and can self-correct rather than breaking the session.
- **Input validation up front:** validate UUIDs and required fields in the handler before
  calling the API, giving an immediate specific message and saving a round-trip. (Defense
  in depth mirroring the route validation, not a reimplementation of business logic.)
- **404 on get/update** → friendly *"No document with id … (it may be archived or
  deleted)."*

Deliberately not done: no retries on writes (avoid duplicate creates); no silently
swallowed errors. Reads are not retried either — Claude can simply re-ask.

## Testing

Following the repo pattern (Node's built-in test runner under `tests/`; `npm test` runs
backend + frontend).

**Unit — tool handlers (stubbed client):**

- Each tool maps args → the correct `moomoraClient` method with the correct params
  (e.g. `search_documents{context:"homelab"}` → `listDocuments({q, context:"homelab"})`).
- `search_*` shaping: bodies stripped, `snippet` derived, result cap enforced.
- Input validation: bad UUID / missing required field → tool error before any client call.
- Error mapping: client throws `MoomoraApiError(404)` → handler returns an `isError` result
  with the friendly message.

**Unit — `moomoraClient.js` (fetch mocked):**

- Builds correct URL + query string from args.
- Adds `Authorization` header only when `MOOMORA_API_TOKEN` is set.
- Maps connection-refused → `MoomoraUnavailableError`, non-2xx → `MoomoraApiError` carrying
  status + `{message}`.

**Smoke — end to end (manual, documented, not in CI):**

- Run Moomora (the demo server suffices), register the MCP server, and in Claude Code
  confirm a `search_documents` → `get_document` → `create_document` round-trip against live
  data. Documented as a checklist in the implementation plan, since it needs a running
  server and interactive Claude Code.

Not tested: the MCP SDK protocol layer (a dependency with its own tests) and the HTTP API
(already covered by existing route/repository tests).

## Rollout

Single slice on a new `feat/mcp-server` branch, cut from the v0.2.0 `main`:

1. Spec (this document), committed first.
2. Implementation plan (via writing-plans).
3. Build: `moomoraClient.js` → tool groups → `server.js` → tests, with the registration
   command and smoke checklist documented in `README` or an `mcp/README.md`.

Stage-only during implementation; commit when verification is green, consistent with prior
work on this repo.
