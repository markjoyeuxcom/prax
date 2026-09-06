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

- A distilled block: the top hit's title, type, id and trust label (`verified` or
  `unverified`, plus a lifecycle status when it is not `active`), its body trimmed to
  about 800 characters, then a short `Related:` list (`title — id (trust)`). Fetch a full
  document only when you need it: `GET $PRAX_API_URL/api/library/documents/<id>`.
- `No relevant memory found for: "…"` with no qualifier is an honest miss (the server
  applies a relevance cutoff). Treat it as "no prior memory" and start fresh.
- `(index incomplete: N of M documents have no current embedding — …)` means some
  documents could not be ranked (new, re-typed, or written before a model change).
  A miss or a thin result under this note is NOT proof there is no memory: say so,
  and fall back to `--recent` or a keyword `prax search` before starting fresh. The
  operator can reindex from Settings ▸ Intelligence.
- `(index coverage unknown: this server predates coverage reporting — …)` means an
  older Prax that cannot say whether every document is indexed; treat a miss under it
  like an incomplete index, not as proof.
- `(N of M matches shown — raise --limit for the rest)` means more matches exist beyond
  the requested bound; the block is complete up to `--limit`, not beyond it.
- `(semantic search disabled — keyword results)` means the app has no embedding
  backend; the hits are keyword matches, so paraphrases may miss.
- `--recent` lists **active** documents only; superseded and deprecated memory never
  appears there, so it cannot be replayed as current.
- `Prax not reachable …` means the app is not running. Say so; never invent memory.
- Unverified memory is a lead to check, not gospel. Verified memory was blessed by a person.
