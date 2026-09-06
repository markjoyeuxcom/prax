---
name: prax-recall
description: Recall relevant prior context, decisions, conventions, and runbooks from Prax long-term memory by meaning. Use BEFORE starting a task, and whenever the user asks "what do we know about X", "how do we usually do Y", or "did we decide Z". Returns one distilled block, not raw search results. Needs a running Prax app (desktop or server); nothing else to install.
---

# prax-recall

Retrieve durable memory from Prax, distilled to a compact block you can act on.
Pairs with **prax-remember** (the persist side) — together they implement
retrieve → work → persist → supersede.

## Run

```bash
node <skill-dir>/scripts/recall.mjs "<natural-language query>" [--project <slug>] [--limit <n>]
node <skill-dir>/scripts/recall.mjs --recent [n] [--project <slug>]
```

`<skill-dir>` is the folder that holds this SKILL.md. In Claude Code it is
`${CLAUDE_SKILL_DIR}`; in Codex it is the path this skill was loaded from. The
script is one self-contained file: Node 20+, no packages, no repository checkout.

- Searches **all projects** by default (agent memories and hand-authored notes).
  `--project memory` scopes to the agent memory namespace; any project slug works.
- Retrieval is by meaning, so a paraphrase finds the note. For "what did I note
  recently" (a chronological list, not a similarity search) use `--recent`.

## Finding the app

In order: `PRAX_API_URL` if set → the desktop app's saved loopback port
(`webview-port` under its app-data folder) → `http://127.0.0.1:3000`. Set
`PRAX_API_URL` only when the app runs somewhere else.

## Reading the output

- A distilled block: the top hit's title, type and id, its body trimmed to about
  800 characters, then a short `Related:` list (`title — id`). Fetch a full document
  only when you need it: `GET $PRAX_API_URL/api/library/documents/<id>`.
- `No relevant memory found for: "…"` is an honest miss (the server applies a
  relevance cutoff). Treat it as "no prior memory" and start fresh.
- `(semantic search disabled — keyword results)` means the app has no embedding
  backend; the hits are keyword matches, so paraphrases may miss.
- `Prax not reachable …` means the app is not running. Say so; never invent memory.
- Unverified memory is a lead to check, not gospel. Verified memory was blessed by a person.
