# Moomora MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
Moomora's HTTP API to Claude Code as tools, so you can search, read, create, edit, and
cross-link tasks and library documents interactively — running on your Claude Pro/Max
subscription rather than the Anthropic API.

Internal design spec (for contributors with the repo checked out):
`docs/superpowers/specs/2026-05-20-moomora-mcp-design.md`.

The MCP tool surface (tool names, inputs, output shapes) is documented in
[`docs/contract.md`](../docs/contract.md). It's pre-1.0 and still evolving; a regression suite
under `tests/contract/` locks the current shapes so changes are made deliberately.

## Prerequisites

- Node.js 20+
- A running Moomora server (the in-memory demo is enough): `npm run demo`
  (serves the API on `http://127.0.0.1:3100`) or `npm start` (defaults to
  `http://0.0.0.0:3000`).

## Configuration

The server reads two environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `MOOMORA_API_URL` | `http://127.0.0.1:3000` | Base URL of the Moomora API. Use `http://127.0.0.1:3100` for the demo server. |
| `MOOMORA_API_TOKEN` | _(unset)_ | If set, sent as `Authorization: Bearer <token>` (for a future authenticated ingress). |

## Register with Claude Code

```bash
claude mcp add moomora \
  --env MOOMORA_API_URL=http://127.0.0.1:3100 \
  -- node /ABSOLUTE/PATH/TO/repo/mcp/server.js
```

Replace `/ABSOLUTE/PATH/TO/repo` with the absolute path to this repository. Verify the
registration with `claude mcp list`. (Confirm the exact `claude mcp add` flag syntax with
`claude mcp add --help` for your installed Claude Code version.)

## Tools

Reads: `search_documents`, `get_document`, `search_tasks`, `get_task`,
`list_task_documents`.
Writes: `create_document`, `update_document`, `create_task`, `update_task`,
`link_task_document`, `unlink_task_document`.

No archive, delete, reorder, or import tools are exposed.

Projects: search tools take an optional `project` (a project slug or id) to scope
results — omit it to span all projects. Create tools take a required `project` (slug or
id); the server resolves it.

## Known limitations

- `get_document` and `get_task` fetch the list endpoint and filter by id in the MCP
  layer, because the API has no `GET /:id` detail route. This is fine at homelab scale
  but is worth revisiting (e.g. adding a detail route) if the library or task set grows
  large, since each call transfers the full active list to filter one record.

## Smoke test (manual)

1. Start Moomora: `npm run demo` (API on `:3100`).
2. Register the server (above) with `MOOMORA_API_URL=http://127.0.0.1:3100`.
3. In Claude Code, confirm the round-trip:
   - "search documents for <a term you know exists>" → returns refs.
   - "get document <id from the search>" → returns the full body.
   - "create a note titled 'mcp smoke' in the work project with body 'hello'" → returns
     the new document; confirm it appears in the Library UI.
   - "link document <id> to task <id>" then "list documents for task <id>" → shows the link.
