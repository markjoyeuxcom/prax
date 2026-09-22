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

**File by subject.** Use `--project <slug>` for knowledge about one project, including
agent-written architecture, decisions and runbooks. Reserve `--project memory` for
preferences, conventions and procedures useful across projects. All project documents
are available to shared recall; the author's identity does not determine the destination.
Keep unfinished work, tests run and next actions in the task's notes/checklist or linked
handoff, then close or retire that working context when complete.

## Run

```bash
node <skill-dir>/scripts/remember.mjs "<title>" "<body>" \
  [--type note|runbook|decision|known-issue|reference|post-mortem|template] \
  [--tags a,b] [--ref <url>] [--cite <path[:start[-end]]>] [--project <slug>] [--id <uuid>] [--agent <id>]
# --tag is accepted as well (the `prax remember` spelling); give one of them.
```

`<skill-dir>` is the folder that holds this SKILL.md. In Claude Code it is
`${CLAUDE_SKILL_DIR}`; in Codex it is the path this skill was loaded from. The
script is one self-contained file: Node 20+, no packages, no repository checkout.

- With no project flag, new titles default to **`memory`**. Choose `--project <slug>`
  explicitly for project knowledge; `--project memory` is for cross-project guidance.
- `--type` says what the document *is*. Omit it on a re-remember to keep the stored
  type; pass it to retype (a note can graduate to a decision).
- `--ref <url>` attaches an external reference (a PR, dashboard, issue) instead of
  copying its content into the body.
- `--cite <path[:start[-end]]>` pins the memory to the code it makes a claim about
  (`server/config.js:12-36`: repository-relative, 1-based inclusive lines, or the whole
  file with no range). Only a sha256 of the cited lines is stored, never the source. Run
  it from inside the checkout; a later recall from a checkout of the same repository
  reports when those lines changed, moved, or vanished, and says `not checked` anywhere
  else. File the memory in the project whose registered repo it cites (or keep the
  commit reachable) so recall can tell the repository apart. Best-effort: a bad citation
  warns and the memory is still saved (`code NOT pinned`).
- Quote the title and the body; unknown options are errors, not ignored.

## Behaviour

- **Update in place by exact title.** Re-remembering a title refines that memory
  (body, tags, optional retype). The write is one server-side transaction, so two
  agents remembering the same title at once cannot create it twice.
- **A title that already lives in another project is refined there.** Recall searches
  every project, so when you run remember **without `--project`** and an active document
  with that exact title exists in one other project (say `homelab`) and none in `memory`,
  that document is updated in place — body replaced, your tags merged into its own — and
  the output says `updated in homelab`. It is never copied into `memory`. If the title
  exists in several other projects the write is refused and the projects are named: pass
  `--project <slug>` or `--id <uuid>` to say which. Saying `--project memory` explicitly
  keeps the write in `memory`.
- **`--id <uuid>` targets one document outright**, wherever it lives (recall prints the
  id on every hit). The body, tags (merged) and title are applied to that document, so
  this is also how a memory is renamed.
- **A superseded memory stays retired.** Remembering a title that was superseded
  creates a new active memory; the old one keeps its body. To replace one memory
  with a different one, use `prax supersede <oldId> --with <newId>`.
- **Provenance.** Every write is stamped `updatedBy: agent`, `kind: synthesized`,
  plus which agent CLI wrote it: `claude`, `codex`, `copilot`, and `antigravity` are detected automatically;
  `--agent <id>` or `PRAX_AGENT` sets it explicitly. Agent memory lands
  **unverified** until a person verifies it.
- **Exact-once retries.** Every write carries an operation id and the server keeps a
  receipt for it. A retried remember returns what the first attempt produced; it can
  never revert a newer memory written in between. Reusing an id with different content
  is refused (409), and a retry whose memory was permanently deleted in the meantime is
  refused (410) rather than silently recreated.
- **One instance per run.** The script pins the first Prax that answers a read-only
  probe and sends the write only there — it never fails over to another candidate
  (for example a dev server on port 3000 while the desktop app is closed).
- Output: `Remembered "<title>" → <id> (created|updated, as <agent>) at <base URL>`.
  Check the URL when more than one Prax could be running.

## Finding the app

In order: `PRAX_API_URL` if set → the desktop app's saved loopback port
(`webview-port` under its app-data folder) → `http://127.0.0.1:3000`.
