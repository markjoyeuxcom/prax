# Moomora CLI (`moomora`)

The `moomora` CLI is a thin client over the Moomora HTTP API. It gives any shell-capable AI
tool (Claude Code, a shell script, a cron job) or a human the ability to pull a bounded,
trust-aware project memory briefing, search and read documents, write new memory, and
verify or supersede it — all without opening a browser.

## Install

Install from the repo with `npm link` to get a global `moomora` command:

```bash
cd /path/to/moomora-console
npm ci
npm link
```

Or run directly without installing:

```bash
node cli/moomora.js <command> [args]
```

## Project detection

Most commands need to know which project to operate on. The CLI resolves the project in this
precedence order:

1. `--project <slug>` flag (highest priority)
2. `MOOMORA_PROJECT` environment variable
3. `.moomora/project.json` file, searched from the current directory upwards. The file must
   contain `{"project": "<slug>"}`. Use `moomora init` to create it.
4. The current directory's folder name (lowest priority, a convenience default)

Run `moomora init` once in a project root to write the file so subsequent commands pick up the
project automatically:

```bash
moomora init --project homelab
# Wrote .moomora/project.json (project: homelab).
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MOOMORA_API_URL` | `http://127.0.0.1:3000` | Base URL of the Moomora server |
| `MOOMORA_PROJECT` | — | Default project slug (overrides folder-name detection) |
| `MOOMORA_TOKEN` | — | Optional bearer token, forwarded as `Authorization: Bearer <token>`; the server does not require it under the no-auth model |

## Commands

### `init [--project <slug>]`

Writes `.moomora/project.json` in the current directory so subsequent commands detect the
project automatically.

```bash
moomora init --project homelab
```

If `--project` is omitted the CLI falls back to the usual detection order. The file is safe
to commit to the repo.

### `context [query...] [--json] [--limit <n>]`

The headline command. Pulls a bounded, trust-aware Markdown briefing assembled from the
project's active documents. With a query the server ranks documents by semantic similarity
(when embeddings are on) and falls back to recency otherwise. Without a query the server
uses recency only.

```bash
moomora context "how do we restore postgres"
moomora context --limit 20
moomora context --json
```

Flags:

- `--json` — emit the raw JSON context-pack object instead of Markdown
- `--limit <n>` — cap the number of items per section (server default: 12, max: 50)

The Markdown output groups documents into labelled sections — see [Output shape](#context-output-shape) below.

### `search <query> [--all] [--json]`

Search the project library. Attempts semantic (embedding) search first and falls back to
keyword search automatically when semantic search is unavailable.

```bash
moomora search "postgres backup"
moomora search "postgres backup" --all
moomora search "postgres backup" --json
```

Flags:

- `--all` — include archived and superseded documents (default: active only)
- `--json` — emit raw JSON results

Each result shows the document title, a trust tag (`[verified]`, `[unverified]`, or
`[superseded]`), the document id, and a short snippet.

### `get <id> [--json]`

Fetch a single document by UUID.

```bash
moomora get c58d3108-4f93-4a50-ac42-0c1d61e61b08
moomora get c58d3108-4f93-4a50-ac42-0c1d61e61b08 --json
```

### `remember <title> [--body <text>] [--type runbook|note] [--tag <t>]`

Write a document to project memory. If a document with the same title already exists in the
project it is updated in place; otherwise a new document is created. Agent-written documents
(created via this command or the MCP tools) land **UNVERIFIED** by default.

```bash
moomora remember "Postgres restore runbook" \
  --body "Steps: 1. Stop app. 2. pg_restore …" \
  --type runbook \
  --tag postgres
```

Flags:

- `--body <text>` — document body (Markdown); defaults to empty string
- `--type runbook|note` — document type (default: `note`)
- `--tag <t>` — a single tag to attach (repeated invocations replace the tag list)

### `verify <id> [--as <name>]`

Mark a document as verified (human-blessed). Sets `verified: true`, stamps `verifiedAt` and
`verifiedBy`.

```bash
moomora verify c58d3108-4f93-4a50-ac42-0c1d61e61b08 --as mark
```

The `--as` flag sets the `verifiedBy` string (defaults to `"cli"` if omitted).

### `unverify <id>`

Remove the verified flag from a document, returning it to the unverified/pending state.

```bash
moomora unverify c58d3108-4f93-4a50-ac42-0c1d61e61b08
```

### `supersede <oldId> --with <newId>`

Retire a document by marking it `superseded` and recording a `supersedes` link from the
replacement document to the old one. The old document remains readable but is excluded from
active retrieval.

```bash
moomora supersede c58d3108-4f93-4a50-ac42-0c1d61e61b08 \
  --with  d72e4219-5a04-4b61-bd53-1e2e72f7c219
```

## Trust model

Documents carry two trust/workflow fields:

- **`verified`** (boolean) — whether a human has blessed this document. Agent writes (CLI
  `remember`, MCP `create_document` / `update_document`) land unverified by default. A human
  runs `verify <id>` to bless them.
- **`status`** (`active` | `superseded` | `deprecated`) — lifecycle state. `supersede <oldId>
  --with <newId>` sets the old document's status to `superseded`. Deprecated is a manual
  state for documents that are stale but have no direct replacement.

Retrieval (`context`, `search`) is **active-only** by default. The `context` command
quarantines unverified documents in a clearly-labelled section so an AI tool can see them
but treat them with appropriate caution. Passing `--all` to `search` disables the active-only
filter.

**Important:** under the no-auth / trusted-network model, `verified` is a **workflow signal,
not access control**. Anyone on the network who can reach the Moomora server can call `verify`
or `unverify`. It is useful for distinguishing agent-written memory that has been reviewed by a
human from memory that hasn't — not for preventing unauthorized writes. See
[SECURITY.md](../SECURITY.md) for the security model.

## `context` output shape

Below is an example of the Markdown emitted by `moomora context "restore postgres"`. The
structure is: a top-level header naming the project, an optional query line, then one or more
`##` sections. Unverified documents always appear last under a clearly-labelled warning header.

```markdown
# Context: Homelab (active)

_Query: restore postgres_

## Relevant memory

### CloudNativePG overview

This cluster runs PostgreSQL 18 on CloudNativePG …

## Active runbooks

### Postgres restore runbook
(runbook · c58d3108-4f93-4a50-ac42-0c1d61e61b08)

## ⚠ Unverified — pending human review

### Draft: K8s network policy — _unverified_

Early notes, not yet reviewed …
```

Sections that have no documents are omitted entirely. A "Project overview" section is
prepended when the project has any verified document tagged `project-card`.
