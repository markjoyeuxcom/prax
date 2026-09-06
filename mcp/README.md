# Prax MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
Prax's HTTP API to Claude Code as tools, so you can search, read, create, edit, and
cross-link tasks and library documents interactively — running on your Claude Pro/Max
subscription rather than the Anthropic API.

Internal design spec (for contributors with the repo checked out):
`docs/superpowers/specs/2026-05-20-prax-mcp-design.md`.

The MCP tool surface (tool names, inputs, output shapes) is documented in
[`docs/contract.md`](../docs/contract.md). It's pre-1.0 and still evolving; a regression suite
under `tests/contract/` locks the current shapes so changes are made deliberately.

## Prerequisites

- Node.js 24 or newer (the repository's `engines` field; `npm ci` refuses older runtimes)
- A running Prax server (the in-memory demo is enough): `npm run demo`
  (serves the API on `http://127.0.0.1:3100`) or `npm start` (defaults to
  `http://127.0.0.1:3000`).

## Configuration

The server reads two environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PRAX_API_URL` | `http://127.0.0.1:3000` | Base URL of the Prax API. Use `http://127.0.0.1:3100` for the demo server. |
| `PRAX_API_TOKEN` | _(unset)_ | If set, sent as `Authorization: Bearer <token>` (for a future authenticated ingress). |

## Register with Claude Code

```bash
claude mcp add prax \
  --env PRAX_API_URL=http://127.0.0.1:3100 \
  -- node /ABSOLUTE/PATH/TO/repo/mcp/server.js
```

Replace `/ABSOLUTE/PATH/TO/repo` with the absolute path to this repository. Verify the
registration with `claude mcp list`. (Confirm the exact `claude mcp add` flag syntax with
`claude mcp add --help` for your installed Claude Code version.)

## Tools

Reads: `search_documents`, `ask_library`, `ask_prax`, `get_document`, `search_tasks`, `get_task`,
`list_task_documents`, `list_task_checklist`, `list_task_activity`, `list_document_links`,
`list_stale_documents`, `list_orphan_documents`, `list_runbook_runs`, `get_runbook_run`,
`list_external_refs`, `search_documents_semantic`.
Writes: `create_document`, `update_document`, `create_task`, `update_task`,
`link_task_document`, `unlink_task_document`, `add_checklist_item`, `set_checklist_item`,
`delete_checklist_item`, `link_documents`, `unlink_documents`, `supersede_document`,
`add_external_ref`, `remove_external_ref`, `start_runbook_run`, `set_run_step`,
`set_run_status`, `generate_post_mortem`, `generate_runbook`.

Collection reads accept optional `limit` (default 20, maximum 50) and `offset` (default 0).
They return `{ schemaVersion: 1, items, page }`; when `page.hasMore` is true, pass
`page.nextOffset` to retrieve the next page. `page.total` is exact, so a caller can distinguish
a complete inventory from a partial page.

Machine creates allocate a caller-stable UUID. `create_task` / `create_document` accept `id`,
`add_checklist_item` accepts `itemId`, and run/generation tools accept their documented result ID.
The client retries one lost transport response and exact replays return the original record;
conflicting reuse returns an error. If Prax remains unreachable, the tool reports that the outcome
is unknown and includes the ID needed to retry the same intent. Child collection reads return an
error for a missing owner rather than silently returning an empty collection.

Document graph tools:
- `link_documents` — create a typed, directional link (derived-from / supersedes) between two documents; a supersedes edge atomically retires its target from default retrieval.
- `unlink_documents` — remove a typed link; removing the last live supersedes edge atomically reactivates its target.
- `list_document_links` — list a document's links and backlinks (direction: outbound / inbound / both).
- `list_stale_documents` — list derived documents whose source changed since the last link snapshot (stale = derived doc whose source was updated after it was linked).
- `list_orphan_documents` — list documents with no inbound or outbound links.

Runbook execution tools:
- `start_runbook_run` — snapshot a runbook into an independent timestamped run; `runId` is caller-stable (allocated automatically when omitted) and makes retries exact-once.
- `list_runbook_runs` — list a runbook's runs, newest first, with status and step/done counts.
- `get_runbook_run` — fetch the source snapshot, current steps, and append-only actor-attributed event chronicle.
- `set_run_step` — check/uncheck a running run's step; actual changes append events and same-state retries are idempotent.
- `set_run_status` — finish or abort a running run, or resume an aborted run; completed runs are terminal.

AI tools:
- `ask_library` — retrieve the trust-aware context pack (Markdown) for a query, without ids.
- `ask_prax` — a grounded, cited answer synthesized from the context pack when a chat model is configured (Settings ▸ Intelligence), degrading to the raw pack otherwise.
- `generate_post_mortem` — draft an agent-written post-mortem note from a runbook run's chronicle (falls back to a deterministic template when no chat model is set); optional `documentId` is exact-once result identity.
- `generate_runbook` — draft an agent-written runbook from an alert/incident description (requires a chat model); optional `documentId` is exact-once result identity and changed intent conflicts.

No archive, delete, reorder, or import tools are exposed.

Projects: search tools take an optional `project` (a project slug or id) to scope
results — omit it to span all projects. Create tools take a required `project` (slug or
id); the server resolves it.

## Smoke test (manual)

1. Start Prax: `npm run demo` (API on `:3100`).
2. Register the server (above) with `PRAX_API_URL=http://127.0.0.1:3100`.
3. In Claude Code, confirm the round-trip:
   - "search documents for <a term you know exists>" → returns refs.
   - "get document <id from the search>" → returns the full body.
   - "create a note titled 'mcp smoke' in the work project with body 'hello'" → returns
     the new document; confirm it appears in the Library UI.
   - "link document <id> to task <id>" then "list documents for task <id>" → shows the link.
