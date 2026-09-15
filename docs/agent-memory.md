# Prax as agent memory

Prax can serve as a persistent, semantically-recalled **long-term memory** for AI agents —
Claude Code, Codex CLI, or any tool that can run a shell command. The library stores durable
knowledge; semantic search retrieves it by meaning; provenance and links keep it groomed. This
document describes the convention; the `prax-recall` and `prax-remember` skills in
[`skills/`](../skills/README.md) implement it.

## What belongs in memory

Memory is for **durable** knowledge that outlives a single session:

- **Facts / knowledge** — "the homelab Postgres runs CloudNativePG", a config value, an endpoint.
- **Decisions / conventions** — "we embed with `qwen3-embedding:0.6b`", "releases are squash-merged".
- **Procedures / runbooks** — reusable how-tos.

These map onto first-class document types — pass `--type` when remembering so recall can filter
by shape later: `note` (default), `runbook` (procedures), `decision` (a choice made and why),
`known-issue` (symptom + workaround), `reference` (lookup material), `post-mortem`. Re-remembering
an existing title may retype it (a note can graduate to a decision).

It is **not** for transient, session-only state (a half-finished edit, the current TODO) — that
belongs in the working context, not the library — and never for secrets.

## The loop

```
retrieve  →  work  →  persist  →  supersede
```

1. **Retrieve-on-start** — before working a task, run the recall skill with "what I'm about to
   do". Retrieval is by meaning, so a paraphrase finds the right note even with different words;
   an honest "no relevant memory" means start fresh. For a "what did I note recently" intent (a
   list, not a similarity search) use `--recent`.
2. **Work** — using the recalled context as grounding (your documented procedures, not guesses).
3. **Persist-on-learn** — when something durable is learned or decided, run the remember skill
   with a title and body. It writes to the `memory` project, stamped `updatedBy: agent`,
   `kind: synthesized`, and the agent id. When the memory is *about* something that lives
   elsewhere — a PR, a dashboard, an upstream issue — add `--ref <url>` to attach an external
   reference instead of copying the content in. When it is *about* specific code, add
   `--cite <path[:start[-end]]>` from inside the checkout: only a hash of those lines is stored,
   and a later recall from a checkout says whether they changed, moved, or vanished.
   Recall is cross-project and says where each hit lives (`in homelab`). A remember run
   without `--project` follows that: a same-title document that exists only in another
   project is refined there, never copied into `memory`; several candidates are refused by
   name; `--id <uuid>` targets one document outright.
4. **Supersede** — re-remembering an existing title updates it in place (no duplicate). When one
   memory replaces another distinct one, run `prax supersede <oldId> --with <newId>` — it records
   the `supersedes` link and retires the old document from default retrieval. A retired title is
   never revived by a later remember: that becomes a new active document.

## How a remember is written

`prax-remember` and `prax remember` call `POST /api/library/documents/upsert-by-title`, which
finds the **active** document with that exact title in the project and updates it, or creates one,
inside a single database transaction. That closes two holes the older read-then-write client
path had: two agents remembering the same title at the same moment could both create it, and a
superseded memory could be silently overwritten by a fresh one that active recall then never
surfaced. Older servers without the endpoint get the read-then-write path with the same
active-only rule. Every write carries a caller-stable operation `id`; inside the same transaction
the server checks its receipts for that id before it looks at the title, and records a receipt
after the write — for updates as well as creates. Replaying a
completed operation returns the current document unchanged (`200`, `replayed: true`), so a
delayed retry can never revert a newer memory; reusing the id with different content is `409`;
a replay whose document has since been permanently deleted is `410` rather than a silent
re-create.

The client binds to one Prax instance for the whole run: a write first probes `/readyz` to pin
the instance and is then sent only there, never failed over to the other discovery candidate,
and the confirmation line names the base URL it wrote to.

## Namespace & provenance

- **`memory` project** — the namespace the agent writes to (created automatically on first
  remember). Recall searches **all** projects by default, so it surfaces both agent memories and
  your hand-authored runbooks/notes; scope with `--project memory` when you only want the former.
- **`updatedBy: agent`** — every skill write is stamped via the `x-prax-origin` header, so
  machine-written memory is always distinguishable from human-authored docs.
- **`updatedByAgent`** — *which* agent wrote the current revision (`claude`, `codex`, `copilot`,
  `antigravity`, …), from the `x-prax-agent` header. The skills detect Claude Code, Codex,
  Copilot CLI and Antigravity from their shell environments; any other tool passes
  `--agent <id>` or sets `PRAX_AGENT`. A human edit clears it.
- **`kind: synthesized`** — marks memory as machine-generated, which the maintenance tooling treats
  as safe to refresh aggressively (vs. `source` docs left for human review).

## Why skills + CLI (and where the MCP server fits)

The skills and the `prax` CLI are the **canonical agent path** — they cover the whole memory loop
(recall, remember, get, search, context-pack, supersede) over one shared code path (`cli/lib/`),
and they exist for **token efficiency**: they load lazily (only a one-line description until
invoked, vs. always-on MCP tool schemas), and they do the search/fetch/filter in a script,
returning one distilled block instead of raw ref lists + full documents in context.

The skill scripts are **bundles** of `cli/lib` (built by `npm run skills:build`, committed under
`skills/*/scripts/`), so a skill is one file with no dependencies beyond Node 20+. That is what
lets the pack install on a machine without a checkout of this repository.

The MCP server (`mcp/server.js`) remains a supported product surface over the same API — it adds
the tasks/checklist suite and `derived-from` document linking, which the CLI does not cover. It is
**not enabled by default** for agent sessions in this repo; re-add it on demand
(`claude mcp add prax -- node mcp/server.js`) for a heavy task-curation session.

### Human CLI equivalents

- `prax recall "<query>"` — cross-project, active-only, distilled recall (`--recent [n]` for a
  chronological list of active documents only — retired memory never appears; `--project <slug>`
  to scope). Hits carry a trust label, and an incomplete semantic index is disclosed inline
  (`index incomplete: N of M documents pending`) so an empty result is never mistaken for an
  honest miss while vectors are still pending.
- `prax remember "<title>" --body "<text>"` — writes to the **current** project; add `--memory`
  to write to the global `memory` namespace (what the `prax-remember` skill does).

## Setup

### Installing the skills

- **In a checkout of this repo:** nothing to do. `.claude/skills/` and `.agents/skills/` link to
  `skills/`, so Claude Code and Codex both see `prax-recall` and `prax-remember`.
- **On any other machine:** `glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh`
  installs the pack for both tools without keeping a checkout. The repository is private, so the
  account must have been granted access; with `glab auth login` done the installer clones over
  HTTPS using `glab`'s credentials, otherwise it needs an SSH key registered with GitLab. Claude
  Code can alternatively install it as a plugin:
  `claude plugin marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git` then
  `claude plugin install prax@prax`.
  See [`skills/README.md`](../skills/README.md).

### Finding the app

The skills and CLI find the HTTP API in this order: `PRAX_API_URL` → the desktop app's saved
loopback port (the `webview-port` file under its app-data folder: `~/Library/Application
Support/com.moomora.prax` on macOS, `~/.local/share/com.moomora.prax` on Linux) →
`http://127.0.0.1:3000`. Discovery pins one instance for the run — a read may probe both
candidates, a write probes `/readyz` first and then never fails over — so one process cannot
straddle two workspaces. An explicit `PRAX_API_URL` disables the fallbacks so a wrong address
fails loudly. The app must be running with an embedding backend configured (Settings ▸
Intelligence, or `EMBEDDING_BACKEND`) for meaning-based recall; otherwise recall labels itself
and falls back to keyword search.

### Project detection

Project-scoped commands (`prax context`, `prax search`, `prax remember` without `--memory`)
resolve the project as: `--project` flag > `PRAX_PROJECT` env > `.prax/project.json` (walking up
from the cwd) > **git remote match** > folder name. The git rung reads the repository's `origin`
URL (pure fs — no git binary) and matches it against each project's registered **Repo** URL
(project header in the app, or set automatically by `prax init` inside a repo), so any checkout or
worktree of a registered repo lands in the right project without its own marker file. URL
spelling doesn't matter — `git@github.com:Org/Repo.git` and `https://github.com/org/repo` match
each other.
