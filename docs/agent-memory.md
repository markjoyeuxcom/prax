# Moomora as agent memory

Moomora Console can serve as a persistent, semantically-recalled **long-term memory** for an AI
agent (e.g. Claude Code). The library stores durable knowledge; semantic search retrieves it by
meaning; provenance and links keep it groomed. This document describes the convention; the
`moomora-recall` and `moomora-remember` skills implement it.

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

1. **Retrieve-on-start** — before working a task, run `moomora-recall "<what I'm about to do>"` to
   surface prior context. Retrieval is by meaning, so a paraphrase finds the right note even with
   different words; an honest "no relevant memory" means start fresh.
2. **Work** — using the recalled context as grounding (your documented procedures, not guesses).
3. **Persist-on-learn** — when something durable is learned or decided, run
   `moomora-remember "<title>" "<body>"`. It writes to the `memory` project, stamped
   `updatedBy: agent` + `kind: synthesized`.
4. **Supersede** — re-`remember`-ing an existing title updates it in place (no duplicate). When one
   memory replaces another distinct one, link them with the MCP `link_documents` tool using the
   `supersedes` relation, and let the stale/maintenance tooling flag what's outdated.

## Namespace & provenance

- **`memory` project** — the namespace the agent writes to (created automatically on first
  `remember`). Recall searches **all** projects by default, so it surfaces both agent memories and
  your hand-authored runbooks/notes; scope with `--project memory` when you only want the former.
- **`updatedBy: agent`** — every skill write is stamped via the `x-moomora-origin` header, so
  machine-written memory is always distinguishable from human-authored docs.
- **`kind: synthesized`** — marks memory as machine-generated, which the maintenance tooling treats
  as safe to refresh aggressively (vs. `source` docs left for human review).

## Why the skills (vs. the MCP tools alone)

The MCP server exposes the same data and is ideal for interactive, model-driven edits. The skills
exist for **token efficiency**: they load lazily (only a one-line description until invoked, vs. the
always-on MCP tool schemas), and they do the search/fetch/filter in a script, returning one
distilled block instead of raw ref lists + full documents in context. Use both — skills for the
retrieve/persist loop, MCP for interactive linking and edits.

## Setup

The skills call the HTTP API at `MOOMORA_API_URL` (default `http://127.0.0.1:3000`) — the same
variable the MCP server uses. The app must be running with semantic search enabled
(`EMBEDDING_BACKEND` set to a working backend) for meaning-based recall; otherwise recall falls back
to keyword search.
