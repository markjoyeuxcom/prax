# Moomora as Agent Memory + Token-Efficient Skills — Design

**Goal:** Let Claude Code use Moomora Console as a persistent, semantically-recalled long-term
memory, with two repo-committed skills that wrap the retrieve/persist paths in scripts so bulk
data stays out of the model's context (cheaper than the MCP tool surface).

**Scope:** Documentation + two Claude Code skills + a `CLAUDE.md` convention. **No app/server code
change** — the skills call the existing HTTP API. No migration, no version bump (ships as a docs/
skills PR; noted under CHANGELOG `[Unreleased]`).

**Not in scope:** changing the MCP server (it stays for interactive edits); auto-memory (the agent
uses the skills when instructed by the convention, not automatically).

---

## Piece 1 — The memory convention

A dedicated **`memory` project** is the namespace the agent *writes* to. Recall *reads* across the
whole library (so it surfaces both agent memories and human-authored runbooks/notes).

Deliverables:
- `docs/agent-memory.md` — the pattern, in prose: the retrieve → work → persist → supersede loop,
  what belongs in memory (durable facts, decisions, procedures — not transient state), provenance
  (`updatedBy: agent`, `kind: synthesized` for machine-written memory), and how staleness/links
  keep it groomed.
- A short **`## Agent memory` block in the repo `CLAUDE.md`** pointing Claude Code at the two
  skills and the convention: at task start, recall relevant context; when you learn something
  durable, remember it; prefer updating/superseding over duplicating.

The loop:
1. **Retrieve-on-start** — `moomora-recall "<what I'm about to work on>"` for prior context.
2. **Persist-on-learn** — `moomora-remember "<title>" "<body>"` for durable findings.
3. **Supersede** — re-remembering an existing title updates it in place (no duplicate); larger
   restructures use the MCP `link_documents` (`supersedes`) + stale tooling.

## Piece 2 — `moomora-recall` skill

`.claude/skills/moomora-recall/SKILL.md` + `recall.mjs` (Node ESM, global `fetch`, zero deps).

- **Description** (trigger): use to pull relevant prior context/notes/runbooks from Moomora memory
  by meaning before starting work, or when the user asks "what do we know about X".
- **Behaviour** `node recall.mjs "<query>" [--project <slug>] [--limit N]`:
  1. `GET /api/library/documents/semantic-search?q=<query>[&project=]` → already cutoff-filtered refs.
  2. If empty → print `No relevant memory found for: "<query>"` and exit 0 (honest miss).
  3. Else → `GET /api/library/documents/<refs[0].id>` for the top hit, print a **distilled** result:
     the top doc's `title`, `documentType`, `id`, and a trimmed body (~800 chars), then a one-line
     `Related:` list of the other refs (`title — id`). Bulk stays in the script; a compact summary
     returns.
  - Defaults: searches **all projects** (memory + authored docs); `--project memory` to scope.
  - Reads `MOOMORA_API_URL` (default `http://127.0.0.1:3000`), same as the MCP server.
  - **Graceful degradation:** on a 409 (semantic disabled/unconfigured) fall back to keyword
    `GET /api/library/documents?q=` and note it; on connection failure print a clear "Moomora not
    reachable at <url>" message and exit non-zero.

## Piece 3 — `moomora-remember` skill

`.claude/skills/moomora-remember/SKILL.md` + `remember.mjs`.

- **Description** (trigger): use to persist a durable finding/decision/procedure into Moomora
  memory so future sessions can recall it.
- **Behaviour** `node remember.mjs "<title>" "<body>" [--tags a,b] [--type note|runbook] [--project <slug>]`:
  1. Ensure the target project exists: `GET /api/projects`; if no project matches the slug
     (default `memory`), `POST /api/projects {name:"memory"}` and use the returned slug.
  2. **Dedup by title:** keyword-search that project for an exact title match; if found →
     `PATCH /api/library/documents/<id>` (update body/tags), else `POST /api/library/documents`.
  3. Always send header `x-moomora-origin: agent`; default `documentType: note`,
     `kind: synthesized` (machine-authored → groomed aggressively), plus a `memory` tag for
     faceting (merged with `--tags`).
  4. Print a one-line confirmation: `Remembered "<title>" → <id> (created|updated)`.
  - Same `MOOMORA_API_URL` + reachability handling as recall.

## Why this is token-cheaper than the MCP path

- The skills load lazily (only their one-line description sits in context until invoked), vs. the
  ~22 always-on MCP tool schemas.
- The scripts do the search + fetch + filtering in the execution environment and return one
  distilled block — the raw refs payload and the full second `get_document` round-trip never enter
  the model's context. The MCP stays available for interactive, model-driven edits where that
  turn-by-turn control is the point.

## Testing & rollout

- The scripts are operational helpers; verify with a **live smoke** against a running Moomora
  (semantic enabled): recall a known topic returns a distilled hit; recall a nonsense query reports
  an honest miss; remember a finding creates it in a freshly-created `memory` project, and
  re-remembering the same title updates (not duplicates) it.
- `npm run check` unchanged (no server entry points touched); add the two `*.mjs` to a
  `node --check` smoke if convenient, but they are not part of the server bundle.
- Ship as a PR to `main` with a CHANGELOG `[Unreleased]` note. No image/version change.
