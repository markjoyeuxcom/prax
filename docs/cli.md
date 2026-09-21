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
4. A **git remote match**: the repository's `origin` URL (read from `.git/config`, no git binary
   needed) is matched against each project's registered **Repo** URL, so any checkout or
   worktree of a registered repo lands in the right project without its own marker file.
   URL spelling doesn't matter — `git@github.com:Org/Repo.git` and `https://github.com/org/repo`
   match each other.
5. The current directory's folder name (lowest priority, a convenience default)

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
| `PRAX_AGENT` | auto | Which agent CLI is writing (`claude`, `codex`, …), sent as `x-prax-agent` on agent writes. Detected from the Claude Code and Codex shell environments when unset; `--agent <id>` overrides |

## Global flags

Every command accepts:

- `--project <slug>` — the project to operate on (see [Project detection](#project-detection))
- `--url <baseUrl>` — the Prax base URL; same meaning as `PRAX_API_URL` and takes precedence
- `--agent <id>` — the agent id stamped on writes (`claude`, `codex`, …); overrides `PRAX_AGENT`
- `--json` — machine-readable output where the command supports it

### Finding the app

Without `--url` or `PRAX_API_URL` the CLI discovers the app by trying the desktop app's saved
loopback port first (the `webview-port` file under its app-data folder) and then
`http://127.0.0.1:3000`. Discovery **binds the process to one instance**: a read may probe both
candidates and pins the first that answers; a write first probes `/readyz` to pin an instance and
is then sent only there — it never fails over to the other candidate, so a lost response cannot
land the same write in a second workspace. `remember` prints the base URL it wrote to
(`… at http://127.0.0.1:<port>`). An explicit URL disables discovery entirely so a wrong address
fails loudly.

## Commands

### `init [--project <slug>]`

Writes `.prax/project.json` in the current directory so subsequent commands detect the
project automatically.

```bash
prax init --project homelab
```

If `--project` is omitted, `init` resolves the slug as `PRAX_PROJECT` > a **git remote match**
against a project already registered with this repository's URL (so a second checkout adopts
the existing project instead of creating a folder-named duplicate) > an existing
`.prax/project.json` found from the current directory upwards (re-written with the same slug) >
the folder name. Inside a git repository it also registers the remote URL on the project. The
file is safe to commit to the repo.

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

- `--all` — also include retired documents (`superseded` / `deprecated` status). Archived
  documents are never returned by search; there is no archive mode.
- `--json` — emit `{ schemaVersion, retrieval, items }`. `retrieval` names the mode
  (`semantic` / `keyword`), whether the result is `degraded`, and a `reason`
  (`semantic-not-configured` for the keyword fallback, `index-incomplete` when some documents have
  no current embedding), plus `index` (`{ total, embedded, pending }`) and `page` for semantic
  results. Semantic search is requested in pages of up to 50; when more results exist the
  envelope says so (`page.hasMore`) rather than silently stopping.

Each result shows the document title, a trust tag (`[verified]`, `[unverified]`, or
`[superseded]`), the document id, and a short snippet. A degraded result is always labelled in
the human-readable output too.

### `recall [query...] [--project <slug>] [--limit <n>] [--recent [n]] [--json]`

Cross-project, active-only recall distilled to one block: the top hit's title, type, trust
label and id, its body trimmed to about 800 characters, then a short `Related:` list. This is
the same implementation the `prax-recall` skill bundles.

```bash
prax recall "how do we restore postgres"
prax recall "how do we restore postgres" --project homelab
prax recall --recent 5
```

- Searches **all** projects by default (agent memories and hand-authored notes alike);
  `--project <slug>` narrows it (`--project memory` for cross-project guidance).
  Project-specific knowledge belongs to its owning project, including agent-written notes.
- Retrieval is by meaning when an embedding backend is configured; on a server that reports
  semantic search as not configured it falls back to keyword search and says so.
- `--recent [n]` lists the newest **active** documents chronologically instead of searching —
  superseded and deprecated documents are excluded. There is no status or `--all` override on
  `recall`; use `search --all` or `get <id>` to look at retired documents.
- Hit lines carry a trust label (`verified` / `unverified`, plus the status when it is not
  `active`), so an unverified lead is visible without a second fetch.
- An incomplete semantic index is disclosed rather than hidden: a hit prints
  `(index incomplete: N of M documents pending — results may be missing)`, and an empty result
  prints `No relevant memory found for: "…" (index incomplete: N of M documents pending — this
  may not be a true miss)`. Only a plain `No relevant memory found` is an honest miss. A server
  that predates coverage reporting is labelled `index coverage unknown`, never assumed complete.
- `--limit <n>` bounds the matches kept in the structured result (default 5). The server answers
  in pages of at most 50 and `recall` pages up to the bound; when matches remain beyond it the
  block starts with `(N of M matches shown — raise --limit for the rest)`. The rendered
  `Related:` list is deliberately short (five entries); `--json` carries every kept match.
- `--json` emits the structured result instead of the rendered block, including `index`,
  `degraded`, `reason` and `page`.

### `get <id> [--json]`

Fetch a single document by UUID.

```bash
prax get c58d3108-4f93-4a50-ac42-0c1d61e61b08
prax get c58d3108-4f93-4a50-ac42-0c1d61e61b08 --json
```

### `remember <title> [--body <text>] [--memory] [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tag a,b] [--ref <url>]`

Write a document to project memory. If an **active** document with the same title already exists
in the project it is updated in place; otherwise a new document is created. The write is one
server-side transaction (`POST /api/library/documents/upsert-by-title`), so concurrent callers
cannot create a title twice, and a superseded or deprecated document is never revived — the new
memory becomes a fresh active document. Every write carries a caller-stable operation id, and the
server keeps a receipt for it: a retried or replayed write returns the current document unchanged
instead of reapplying its old body, so a delayed retry can never revert a newer memory. Agent-written
documents (created via this command or the MCP tools) land **UNVERIFIED** by default and record
which agent wrote them (`updatedByAgent`). The confirmation line names the instance written to
(`… at http://127.0.0.1:<port>`).

```bash
prax remember "Postgres restore runbook" \
  --body "Steps: 1. Stop app. 2. pg_restore …" \
  --project homelab \
  --type runbook \
  --tag postgres,homelab
```

Flags:

- `--body <text>` — document body (Markdown); defaults to empty string
- `--project <slug>` — choose the project that owns this knowledge; all projects are available
  to shared recall. Without it, ordinary remember resolves the current project.
- `--memory` — select **`memory`** for guidance useful across projects; the document is also
  tagged `memory`. Without an explicit project, an existing unique title in another project
  is refined there. The remember skill defaults new titles to memory, so pass its `--project`
  explicitly for project-specific findings.
- `--type` — document type: `note` (default), `runbook`, `decision`, `known-issue`, `reference`, or `post-mortem`. On a re-remember (same title), omit it to keep the stored type; pass it to retype.
- `--tag a,b` — a comma-separated tag list that **replaces** the document's tags. Repeating
  `--tag` does not accumulate: the last occurrence wins.
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

### `task <add|list|show|update|done|check|uncheck>`

Tasks from any shell, for handoff notes, acceptance checklists and agent work orders. The
project resolves exactly as it does for `remember`; every write is stamped as an agent write
with the detected agent id, so the task chronicle says who changed it. The command binds to
one instance before writing, like `remember`.

```bash
prax task add "Rotate the tunnel token" --priority high --due 2026-10-01 --label ops,homelab \
  --description "Token expires on the 3rd." --check "New token issued" --check "Old token revoked"
prax task list                       # open tasks in the current project
prax task list --status in-progress --all-projects
prax task show 2234a575-027e-4218-892a-b74d2b5c7f8c
prax task update 2234a575-… --status in-progress --append-notes "Branch feat/x, tests green, next: docs"
prax task check 2234a575-… 2         # tick the second checklist item (or name it by label)
prax task done 2234a575-…
```

- `add <title>` — flags: `--priority high|medium|low` (default medium), `--status` (default
  `planned`; values `high-priority`, `in-progress`, `planned`, `completed`, `notes`),
  `--due YYYY-MM-DD`, `--planned YYYY-MM-DD`, `--label a,b`, `--description`, `--notes`, and a
  repeatable `--check "<item>"` for acceptance items. The task and its checklist commit in one
  transaction through the exact-once import route with a fresh request id, so a lost response
  can be retried without creating a second task: the reply says `Already added` when the server
  replayed a recorded result. Append mode is deliberate: an explicit add is never skipped because
  an older task shares the title.
- `list` — open tasks in the resolved project, one line each with status, priority, plan/due
  dates, labels and id. `--status <s>` filters, `--query <text>` matches title or description,
  `--all-projects` lists everything with a `#project` suffix. `--json` returns the raw array.
- `show <id>` — the task, its numbered checklist and notes. `--json` adds a `checklist` array.
- `update <id>` — patches `--title`, `--status`, `--priority`, `--due`, `--planned` (an empty
  value clears a date), `--label`, `--description`, `--notes`, or `--append-notes <text>`, which
  reads the current notes and appends a paragraph. The update route carries no operation
  receipt, so the command sends **one** request and never retries on its own; an uncertain
  transport outcome is reported as unknown and you should inspect the task before retrying.
  `--append-notes` has a small read-then-write window; two agents appending at the same
  moment can lose one paragraph.
- `done <id>` — sets `completed`; a recurring task reports the next occurrence it spawned.
- `check <id> <n|label>` / `uncheck <id> <n|label>` — set one checklist item by its 1-based
  number or exact (case-insensitive) label. Setting a value is idempotent, so these and `done`
  retry only when no request provably reached the server.

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
