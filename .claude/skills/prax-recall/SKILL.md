---
name: prax-recall
description: Use to recall relevant prior context, notes, decisions, or runbooks from Prax memory BEFORE starting a task, or whenever the user asks "what do we know about X / how do we usually do Y / did we decide Z". Retrieves by meaning (semantic search) and returns a distilled summary, so it is cheaper than pulling raw results through the MCP tools. Requires a running Prax app with semantic search enabled.
---

# prax-recall

Retrieve relevant long-term memory from Prax by **meaning**, distilled to a compact
summary the agent can act on.

## When to use

- **Retrieve-on-start:** before working a task, recall what's already known/decided about it.
- When the user asks "what do we know about…", "how do we usually…", "did we decide…".
- To check for an existing runbook/note before writing a new one.

## How to run

```bash
node .claude/skills/prax-recall/recall.mjs "<natural-language query>" [--project <slug>] [--limit <n>]
```

- Searches **all projects** by default (agent memories + authored runbooks/notes). Pass
  `--project memory` to scope to the agent memory namespace, or any project slug.
- Set `PRAX_API_URL` if the app isn't at `http://127.0.0.1:3000` (same var the MCP server uses).

For a "what did I note/do recently" intent — a chronological **list**, not a similarity search —
use `--recent` instead of a query:

```bash
node .claude/skills/prax-recall/recall.mjs --recent [n] [--project <slug>]   # latest n docs (default 5)
```

(Semantic search matches the *meaning of content*, so it won't answer "show my recent notes" —
that's what `--recent` is for.)

> Implementation note: this script is a thin wrapper over `cli/lib/recall.js` — the same
> operation behind `prax recall`. The `node …/recall.mjs` invocation is unchanged and needs
> no global `prax` install.

## What it returns

A distilled block — the top hit's title, type, id, and a trimmed body (~800 chars), then a short
`Related:` list of other matches (`title — id`). The full ranked ref list and the full document are
processed inside the script and never enter your context; fetch a full doc only when you need it
(`get_document` / `GET /api/library/documents/<id>`).

## Behaviour notes

- **Honest misses:** if nothing is relevant (the server applies a relevance cutoff), it prints
  `No relevant memory found for: "…"` — treat that as "no prior memory", not an error.
- **Graceful fallback:** if semantic search is disabled/unconfigured (HTTP 409) it falls back to
  keyword search and says so.
- **Not reachable:** if the app is down it prints a clear "Prax not reachable" message and exits
  non-zero.

Pairs with **prax-remember** (the persist side). Together they implement the
retrieve → work → persist → supersede memory loop documented in `docs/agent-memory.md`.
