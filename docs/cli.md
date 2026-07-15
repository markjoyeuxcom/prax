# Prax CLI (`prax`)

The `prax` CLI is a thin client over the Prax HTTP API. It gives any shell-capable AI
tool (Claude Code, a shell script, a cron job) or a human the ability to pull a bounded,
trust-aware project memory briefing, search and read documents, write new memory, and
verify or supersede it — all without opening a browser.

## Install

Install from the repo with `npm link` to get a global `prax` command:

```bash
cd /path/to/prax
npm ci
npm link
```

Or run directly without installing:

```bash
node cli/prax.js <command> [args]
```

## Project detection

Most commands need to know which project to operate on. The CLI resolves the project in this
precedence order:

1. `--project <slug>` flag (highest priority)
2. `PRAX_PROJECT` environment variable
3. `.prax/project.json` file, searched from the current directory upwards. The file must
   contain `{"project": "<slug>"}`. Use `prax init` to create it.
4. The current directory's folder name (lowest priority, a convenience default)

Run `prax init` once in a project root to write the file so subsequent commands pick up the
project automatically:

```bash
prax init --project homelab
# Wrote .prax/project.json (project: homelab).
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRAX_API_URL` | `http://127.0.0.1:3000` | Base URL of the Prax server |
| `PRAX_PROJECT` | — | Default project slug (overrides folder-name detection) |
| `PRAX_TOKEN` | — | Optional bearer token, forwarded as `Authorization: Bearer <token>`; the server does not require it under the no-auth model |

## Commands

### `init [--project <slug>]`

Writes `.prax/project.json` in the current directory so subsequent commands detect the
project automatically.

```bash
prax init --project homelab
```

If `--project` is omitted the CLI falls back to the usual detection order. The file is safe
to commit to the repo.

### `context [query...] [--json] [--limit <n>]`

The headline command. Pulls a bounded, trust-aware Markdown briefing assembled from the
project's active documents. With a query the server ranks documents by semantic similarity
(when embeddings are on) and falls back to recency otherwise. Without a query the server
uses recency only.

```bash
prax context "how do we restore postgres"
prax context --limit 20
prax context --json
```

Flags:

- `--json` — emit the raw JSON context-pack object instead of Markdown
- `--limit <n>` — cap the total number of documents in the pack (server default: 12, max: 50)

The Markdown output groups documents into labelled sections — see [Output shape](#context-output-shape) below.
Both Markdown and JSON name the retrieval mode. Query fallback is explicit (for example,
`recency fallback (semantic-unavailable)`), so a machine never mistakes fallback context for a
semantic match.

### `search <query> [--all] [--json]`

Search the project library. Attempts semantic (embedding) search first and falls back to
keyword search only when the server explicitly reports that semantic search is not configured.
The fallback is always labelled; other semantic failures are returned as errors.

```bash
prax search "postgres backup"
prax search "postgres backup" --all
prax search "postgres backup" --json
```

Flags:

- `--all` — include archived and superseded documents (default: active only)
- `--json` — emit `{ schemaVersion, retrieval, items }`; `retrieval` names the semantic/keyword
  mode and whether the result is degraded

Each result shows the document title, a trust tag (`[verified]`, `[unverified]`, or
`[superseded]`), the document id, and a short snippet.

### `get <id> [--json]`

Fetch a single document by UUID.

```bash
prax get c58d3108-4f93-4a50-ac42-0c1d61e61b08
prax get c58d3108-4f93-4a50-ac42-0c1d61e61b08 --json
```

### `remember <title> [--body <text>] [--type note|runbook|decision|known-issue|reference|post-mortem] [--tag <t>] [--ref <url>]`

Write a document to project memory. If a document with the same title already exists in the
project it is updated in place; otherwise a new document is created. Agent-written documents
(created via this command or the MCP tools) land **UNVERIFIED** by default.

```bash
prax remember "Postgres restore runbook" \
  --body "Steps: 1. Stop app. 2. pg_restore …" \
  --type runbook \
  --tag postgres
```

Flags:

- `--body <text>` — document body (Markdown); defaults to empty string
- `--type` — document type: `note` (default), `runbook`, `decision`, `known-issue`, `reference`, or `post-mortem`. On a re-remember (same title), omit it to keep the stored type; pass it to retype.
- `--tag <t>` — a single tag to attach (repeated invocations replace the tag list)
- `--ref <url>` — attach an external reference (a PR, dashboard, or issue URL) to the memory. Best-effort: a rejected URL warns on stderr but never fails the remember.

### `verify <id> --as <human-name>`

Mark a document as verified (human-blessed). Sets `verified: true`, stamps `verifiedAt` and
`verifiedBy`.

```bash
prax verify c58d3108-4f93-4a50-ac42-0c1d61e61b08 --as mark
```

Verification is an attended trust action. The command refuses non-interactive input, requires an
explicit human name, prints the full current document for review, and asks for a document-specific
confirmation phrase before changing trust. It does not support `--json`. Use the Library UI when
an interactive terminal is unavailable. The write includes the reviewed document's content hash;
if it changes before confirmation, Prax returns a conflict instead of verifying unseen content.

### `unverify <id>`

Remove the verified flag from a document, returning it to the unverified/pending state.

```bash
prax unverify c58d3108-4f93-4a50-ac42-0c1d61e61b08
```

### `supersede <oldId> --with <newId>`

Retire a document by marking it `superseded` and recording a `supersedes` link from the
replacement document to the old one. The old document remains readable but is excluded from
active retrieval.

```bash
prax supersede c58d3108-4f93-4a50-ac42-0c1d61e61b08 \
  --with  d72e4219-5a04-4b61-bd53-1e2e72f7c219
```

## Trust model

Documents carry two trust/workflow fields:

- **`verified`** (boolean) — whether a human has blessed this document. Agent writes (CLI
  `remember`, MCP `create_document` / `update_document`) land unverified by default. A human
  runs the attended `verify <id> --as <name>` flow (or uses the Library UI) to bless them.
- **`status`** (`active` | `superseded` | `deprecated`) — lifecycle state. `supersede <oldId>
  --with <newId>` sets the old document's status to `superseded`. Deprecated is a manual
  state for documents that are stale but have no direct replacement.

Retrieval (`context`, `search`) is **active-only** by default. The `context` command
quarantines unverified documents in a clearly-labelled section so an AI tool can see them
but treat them with appropriate caution. Passing `--all` to `search` disables the active-only
filter.

**Important:** under the no-auth / trusted-network model, `verified` is a **workflow signal,
not access control**. Anyone on the network who can reach the Prax server can call `verify`
or `unverify`. It is useful for distinguishing agent-written memory that has been reviewed by a
human from memory that hasn't — not for preventing unauthorized writes. See
[SECURITY.md](../SECURITY.md) for the security model.

## `context` output shape

Below is an example of the Markdown emitted by `prax context "restore postgres"`. The
structure is: a top-level header naming the project, an optional query line, then one or more
`##` sections. Unverified documents always appear last under a clearly-labelled warning header;
with a small `--limit` they may be dropped entirely once the budget is spent on
higher-priority sections.

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
