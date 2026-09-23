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
node <skill-dir>/scripts/recall.mjs "<natural-language query>" [--project <slug>] [--limit <n>] [--budget <tokens>]
node <skill-dir>/scripts/recall.mjs --recent [n] [--project <slug>]
node <skill-dir>/scripts/recall.mjs --since-last-session [--project <slug>] [--budget <tokens>]
node <skill-dir>/scripts/recall.mjs --since <iso> [--project <slug>] [--budget <tokens>]
```

`<skill-dir>` is the folder that holds this SKILL.md. In Claude Code it is
`${CLAUDE_SKILL_DIR}`; in Codex it is the path this skill was loaded from. The
script is one self-contained file: Node 20+, no packages, no repository checkout.

- Searches **all projects** by default (agent memories and hand-authored notes).
  Project knowledge belongs to its owning project; `--project memory` retrieves only
  cross-project guidance and can miss the project's architecture and runbooks.
- At task start, read the repository's startup guide and project overview when available,
  then recall the actual task. Check the task's notes/checklist for unfinished work;
  reusable memory is not the task's progress log.
- Retrieval is by meaning, so a paraphrase finds the note. For "what did I note
  recently" (a chronological list, not a similarity search) use `--recent`.
- `--budget <tokens>` bounds the block by an estimated token count (characters / 4) instead
  of a match count: verified memory first, then unverified memory whose cited code still
  matches in this checkout, then the newest. Lower entries shrink to one line
  (`- [unverified] Title (type · id) — first line`) and the rest are counted as left out;
  every entry keeps its trust chip. Use it when context is tight.
- `--since-last-session` lists only what changed in memory (created, updated, verified,
  superseded, deprecated, archived) since this agent's previous `--since-last-session`. Run it
  at the start of a session. The first run only sets a baseline and says so. It needs an agent
  id (detected in Claude Code, Codex, Copilot CLI and Antigravity; otherwise `--agent <id>`).
  `--since <iso>` reads an explicit window instead. Neither takes a query.

## Finding the app

In order: `PRAX_API_URL` if set → the desktop app's saved loopback port
(`webview-port` under its app-data folder) → `http://127.0.0.1:3000`. Set
`PRAX_API_URL` only when the app runs somewhere else.

## Reading the output

- A distilled block: the top hit's title, type, id, **the project it lives in** (`in homelab`)
  and trust line, its body trimmed to about 800 characters, then a short `Related:` list
  (`title — id (in <project> · trust) — snippet`). Fetch a full document only when you need
  it: `GET $PRAX_API_URL/api/library/documents/<id>`.
- The project matters when you re-remember: recall is cross-project, and a hit that says
  `in homelab` is a homelab document. `prax-remember` without `--project` refines it there
  rather than duplicating it into `memory`; `--id <its id>` targets it outright.
- The trust line reads like `verified by mark · 3mo old · human-written` or
  `unverified · 2d old · via codex · keyword-only`: verification (and by whom), a lifecycle
  status when it is not `active`, the age of the current revision, who wrote it (a person, a
  named agent CLI, or `via an unnamed agent`), and `keyword-only` when the hit was found by
  exact terms but not by meaning. Weigh a months-old unverified agent note accordingly.
- Retrieval is hybrid: the ranking fuses meaning (cosine) with exact terms (BM25) and nudges
  by trust — a verified memory a few places up, an unverified one a few places down as it
  ages. Trust never outranks relevance; age is disclosed so you can discount further.
- When the top hit pins code (`--cite`) and you run recall inside the repository it was cited
  in, the trust line also says `path changed since this was written`, `moved to path:a-b`, or
  `path is gone`; a checked citation with no such note still matches. Citations that could not
  be checked are said too: `N citations not checked (not run inside a checkout)`,
  `(cited in another repository)`, `(pinned at a commit this checkout does not have)`,
  `(the cited repository is not recorded)` or `(the citations could not be read)` — that is no
  claim either way, so check the code yourself before relying on the memory. The repository is the
  hit's project's registered repo URL when both it and this checkout's origin are known,
  otherwise the commit the citation was pinned at must exist in this checkout. In a very
  large file only the lines near the citation are searched for a move, and the note says so.
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
  backend; the hits are keyword matches ranked by how often the query's words occur, so
  paraphrases may miss. `--limit` and the `N of M matches shown` note apply as usual.
- `--recent` takes no query; `--limit` must be a positive integer. Both are refused
  otherwise, never silently ignored.
- `--recent` lists **active** documents only; superseded and deprecated memory never
  appears there, so it cannot be replayed as current.
- `(budget: ~N of M tokens, chars/4 · k of n shown · …)` heads a budgeted block;
  `_N more left out by the budget (k unverified) …_` counts what did not fit. Raise
  `--budget` or fetch a document by id before concluding it is not there.
- In a delta, `[superseded] … superseded by <id>` means that memory stopped being current;
  read the replacement. `(marker not advanced …)` means the budget left changes out and the
  next `--since-last-session` repeats the window. The delta does not see unverifications or
  permanent deletions.
- `Prax not reachable …` means the app is not running. Say so; never invent memory.
- Unverified memory is a lead to check, not gospel. Verified memory was blessed by a person.
