# Prax as agent memory

Prax can serve as a persistent, semantically-recalled **long-term memory** for an AI
agent (e.g. Claude Code). The library stores durable knowledge; semantic search retrieves it by
meaning; provenance and links keep it groomed. This document describes the convention; the
`prax-recall` and `prax-remember` skills implement it.

## What belongs in memory

Memory is for **durable** knowledge that outlives a single session:

- **Facts / knowledge** — "the homelab Postgres runs CloudNativePG", a config value, an endpoint.
- **Decisions / conventions** — "we embed with `qwen3-embedding:0.6b`", "releases are squash-merged".
- **Procedures / runbooks** — reusable how-tos.

It is **not** for transient, session-only state (a half-finished edit, the current TODO) — that
belongs in the working context, not the library.

## The loop

```
retrieve  →  work  →  persist  →  supersede
```

1. **Retrieve-on-start** — before working a task, run `prax-recall "<what I'm about to do>"` to
   surface prior context. Retrieval is by meaning, so a paraphrase finds the right note even with
   different words; an honest "no relevant memory" means start fresh. For a "what did I note
   recently" intent (a list, not a similarity search) use `prax-recall --recent`.
2. **Work** — using the recalled context as grounding (your documented procedures, not guesses).
3. **Persist-on-learn** — when something durable is learned or decided, run
   `prax-remember "<title>" "<body>"`. It writes to the `memory` project, stamped
   `updatedBy: agent` + `kind: synthesized`.
4. **Supersede** — re-`remember`-ing an existing title updates it in place (no duplicate). When one
   memory replaces another distinct one, run `prax supersede <oldId> --with <newId>` — it records
   the `supersedes` link and retires the old document from default retrieval.

## Namespace & provenance

- **`memory` project** — the namespace the agent writes to (created automatically on first
  `remember`). Recall searches **all** projects by default, so it surfaces both agent memories and
  your hand-authored runbooks/notes; scope with `--project memory` when you only want the former.
- **`updatedBy: agent`** — every skill write is stamped via the `x-prax-origin` header, so
  machine-written memory is always distinguishable from human-authored docs.
- **`kind: synthesized`** — marks memory as machine-generated, which the maintenance tooling treats
  as safe to refresh aggressively (vs. `source` docs left for human review).

## Why skills + CLI (and where the MCP server fits)

The skills + `prax` CLI are the **canonical agent path** — they cover the whole memory loop
(recall, remember, get, search, context-pack, supersede) over one shared code path (`cli/lib/`),
and they exist for **token efficiency**: they load lazily (only a one-line description until
invoked, vs. always-on MCP tool schemas), and they do the search/fetch/filter in a script,
returning one distilled block instead of raw ref lists + full documents in context.

The MCP server (`mcp/server.js`) remains a supported product surface over the same API — it adds
the tasks/checklist suite and `derived-from` document linking, which the CLI does not cover. It is
**not enabled by default** for agent sessions in this repo; re-add it on demand
(`claude mcp add prax -- node mcp/server.js`) for a heavy task-curation session.

### Human CLI equivalents

The skills now share one code path with the `prax` CLI (`cli/lib/recall.js`,
`cli/lib/remember.js`). The human-facing commands:

- `prax recall "<query>"` — cross-project, active-only, distilled recall (`--recent [n]` for a
  chronological list; `--project <slug>` to scope).
- `prax remember "<title>" --body "<text>"` — writes to the **current** project; add `--memory`
  to write to the global `memory` namespace (what the `prax-remember` skill does).

## Setup

The skills and CLI call the HTTP API at `PRAX_API_URL` (default `http://127.0.0.1:3000`) — the
same variable the optional MCP server uses. The app must be running with semantic search enabled
(`EMBEDDING_BACKEND` set to a working backend) for meaning-based recall; otherwise recall falls back
to keyword search.

### Project detection

Project-scoped commands (`prax context`, `prax search`, `prax remember` without `--memory`)
resolve the project as: `--project` flag > `PRAX_PROJECT` env > `.prax/project.json` (walking up
from the cwd) > **git remote match** > folder name. The git rung reads the repository's `origin`
URL (pure fs — no git binary) and matches it against each project's registered **Repo** URL
(project header in the app, or set automatically by `prax init` inside a repo), so any checkout or
worktree of a registered repo lands in the right project without its own marker file. URL
spelling doesn't matter — `git@github.com:Org/Repo.git` and `https://github.com/org/repo` match
each other.
