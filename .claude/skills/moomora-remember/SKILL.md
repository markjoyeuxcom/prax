---
name: moomora-remember
description: Use to persist a durable finding, decision, convention, or procedure into Moomora memory so future sessions can recall it — e.g. after discovering how something works, agreeing on an approach, or writing a reusable runbook. Writes to a dedicated `memory` project, de-duplicates by title (updates in place), and stamps agent provenance. Requires a running Moomora app.
---

# moomora-remember

Persist durable knowledge into Moomora Console so a future session (via **moomora-recall** or the
MCP tools) can retrieve it.

## When to use

- **Persist-on-learn:** you discovered something durable (how a system works, a config value, a
  gotcha) that's worth keeping beyond this session.
- A decision or convention was agreed and should be remembered.
- You produced a reusable procedure/runbook.

Do **not** use it for transient/session-only state — that belongs in the working context, not
long-term memory.

## How to run

```bash
node .claude/skills/moomora-remember/remember.mjs "<title>" "<body>" [--tags a,b] [--type note|runbook] [--project <slug>]
```

- Writes to the **`memory`** project by default (created automatically on first use). Override with
  `--project <slug>` to file it under a specific project.
- `--type` is `note` (default) or `runbook`; `--tags` is a comma-separated list (a `memory` tag is
  always added).
- Set `MOOMORA_API_URL` if the app isn't at `http://127.0.0.1:3000`.

## Behaviour notes

- **De-dup by title:** if a document with the same title already exists in the target project it is
  **updated in place** (body + tags), not duplicated — so re-remembering refines an existing memory.
- **Provenance:** writes are stamped `updatedBy: agent` and `kind: synthesized`, so machine-written
  memory is distinguishable from your hand-authored docs and is groomed aggressively by the
  stale/maintenance tooling.
- For a larger restructure (one memory supersedes another) prefer the MCP `link_documents`
  (`supersedes`) tool rather than overwriting.

Pairs with **moomora-recall** (the retrieve side); see `docs/agent-memory.md` for the full loop.
