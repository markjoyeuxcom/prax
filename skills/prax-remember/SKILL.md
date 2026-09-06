---
name: prax-remember
description: Persist a durable finding, decision, convention, or procedure into Prax long-term memory so a future session or another agent CLI can recall it. Use after discovering how something works, agreeing an approach, or writing a reusable runbook. De-duplicates by title (updates in place), stamps agent provenance, and never revives a superseded memory. Needs a running Prax app; nothing else to install.
---

# prax-remember

Persist knowledge that outlives this session. Pairs with **prax-recall**.

## What belongs here

Facts about how a system works, decisions and their reasons, conventions,
reusable procedures, known issues with workarounds, lookup references. Not
transient state (a half-finished edit, the current TODO), and never secrets.
Prefer one memory per fact with a specific, stable title — the title is the
de-duplication key.

## Run

```bash
node <skill-dir>/scripts/remember.mjs "<title>" "<body>" \
  [--type note|runbook|decision|known-issue|reference|post-mortem] \
  [--tags a,b] [--ref <url>] [--project <slug>] [--agent <id>]
```

`<skill-dir>` is the folder that holds this SKILL.md. In Claude Code it is
`${CLAUDE_SKILL_DIR}`; in Codex it is the path this skill was loaded from. The
script is one self-contained file: Node 20+, no packages, no repository checkout.

- Writes to the **`memory`** project (created on first use). `--project <slug>`
  files it under a specific project instead.
- `--type` says what the document *is*. Omit it on a re-remember to keep the stored
  type; pass it to retype (a note can graduate to a decision).
- `--ref <url>` attaches an external reference (a PR, dashboard, issue) instead of
  copying its content into the body.
- Quote the title and the body; unknown options are errors, not ignored.

## Behaviour

- **Update in place by exact title.** Re-remembering a title refines that memory
  (body, tags, optional retype). The write is one server-side transaction, so two
  agents remembering the same title at once cannot create it twice.
- **A superseded memory stays retired.** Remembering a title that was superseded
  creates a new active memory; the old one keeps its body. To replace one memory
  with a different one, use `prax supersede <oldId> --with <newId>`.
- **Provenance.** Every write is stamped `updatedBy: agent`, `kind: synthesized`,
  plus which agent CLI wrote it: `claude` or `codex` are detected automatically;
  `--agent <id>` or `PRAX_AGENT` sets it explicitly. Agent memory lands
  **unverified** until a person verifies it.
- Output: `Remembered "<title>" → <id> (created|updated, as <agent>)`.

## Finding the app

In order: `PRAX_API_URL` if set → the desktop app's saved loopback port
(`webview-port` under its app-data folder) → `http://127.0.0.1:3000`.
