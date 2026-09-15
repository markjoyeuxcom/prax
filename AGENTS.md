# AGENTS.md — Prax

Instructions for AI coding agents working in this repo — **Claude Code, Codex CLI, Antigravity (agy),
Cursor, aider, and any shell-capable agent**. `CLAUDE.md` is a symlink to this file, so all tools read
the same rules.

## Shared agent memory

This project doubles as **shared, local-first long-term memory** for AI tools, backed by
Prax's library + semantic search. Use it so durable knowledge carries across sessions
*and across tools*: what one agent learns, another can recall. The memory lives in Prax
(SQLite + embeddings), not in your context window.

Two skills implement it, **prax-recall** and **prax-remember**. They live in
[`skills/`](skills/) and are mirrored into `.claude/skills/` (Claude Code) and
`.agents/skills/` (Codex), so in a checkout both tools already have them. Each is one
self-contained Node script; outside a checkout install them with
[`skills/install.sh`](skills/README.md) — no repository needed on that machine.

### 1. Recall first

Before starting a task, retrieve what's already known:

```bash
node skills/prax-recall/scripts/recall.mjs "<what you're about to work on>"
node skills/prax-recall/scripts/recall.mjs --recent 5      # chronological list instead
```

It searches **all projects** by meaning and returns a distilled summary (top hit + a short
related list) — cheap on tokens. An honest `No relevant memory found` means start fresh.

### 2. Remember durable findings

When you learn something that outlives this session — how a system works, a decision or
convention, a reusable runbook — persist it:

```bash
node skills/prax-remember/scripts/remember.mjs "<title>" "<body>" [--type note|runbook|decision|known-issue|reference|post-mortem] [--tags a,b] [--ref <url>] [--cite <path[:start[-end]]>]
```

When the memory makes a claim about specific code, add `--cite server/config.js:12-36` (a
repository-relative path, optionally a 1-based inclusive line range). Recall run from inside a
checkout then re-hashes those lines and labels the hit `changed`, `moved to path:a-b`, or
`is gone` when the ground under the claim has shifted — silence means the citation still holds.

Writes to the dedicated **`memory`** project and **de-dups by exact title** in one server-side
transaction (re-running refines the memory in place; two agents cannot create the same title
twice). A superseded memory is never revived — a fresh memory under a retired title becomes a
new document. Every write is stamped `updatedBy: agent`, `kind: synthesized`, plus **which
agent** wrote it (`claude` / `codex` / `copilot` / `antigravity` detected automatically; `--agent <id>` or `PRAX_AGENT`
overrides). Agent-written memory lands **unverified** until a human verifies it — treat
unverified recalls as leads, not gospel. Do **not** persist transient/session-only state or
secrets.

### 3. Supersede, don't duplicate

Re-remember an existing title to refine it. When one memory replaces a *different* one, run
`node cli/prax.js supersede <oldId> --with <newId>`: the old document is retired from default
retrieval and linked to its replacement.

### Finding the app

The skills and the CLI find Prax in this order: `PRAX_API_URL` → the desktop app's saved
loopback port (`webview-port` under its app-data folder) → `http://127.0.0.1:3000`. Set
`PRAX_API_URL` only when the app runs elsewhere. Semantic (meaning-based) recall needs an
embedding backend configured in the app; without one recall says so and falls back to
keyword matching.

## Project context packs (optional)

For a task-scoped briefing of *this project's* verified memory, the `prax` CLI assembles a
bounded, trust-aware context pack (Markdown):

```bash
node cli/prax.js context "<task>"     # briefing for the current project (.prax/project.json)
node cli/prax.js search "<query>"     # semantic search, scoped to the current project
node cli/prax.js help                 # full surface: init/context/search/get/recall/remember/verify/unverify/supersede
```

`npm link` installs a global `prax`. The project-scoped commands (`context`, `search`, and
`remember` without `--memory`) resolve the project from `--project` / `PRAX_PROJECT` /
`.prax/project.json` / the git remote / the folder name, whereas the `prax-remember` skill
**writes** to the cross-tool **`memory`** namespace. Recall is cross-project on both surfaces:
`prax recall` and the `prax-recall` skill search every project by default and take
`--project memory` to narrow to agent memory. Use the skills for durable shared memory, the
project-scoped CLI commands for "what does *this project* know."

## Configuration

- **No authentication by design** (trusted-network model). The database path and network
  binding are env-only. Provider backends, URLs, keys and the local CLI path can also be
  configured through Settings and are stored in the single-user SQLite database. Treat
  database backups as secrets. Settings access is operator access, including execution of the
  selected local CLI. See `SECURITY.md`.
- The MCP server (`mcp/server.js`) remains a product feature but is **not enabled by default**
  for agent sessions here; add it with `claude mcp add prax -- node mcp/server.js` only for a
  heavy task-curation session. See [docs/agent-memory.md](docs/agent-memory.md) for the full
  memory convention.

## Product quality

The active quality policy is
[Exceptional Prax — Product Quality Standard](docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md).
Its Gate A invariants apply to every change immediately. Preserve the evidence-backed baseline,
do not knowingly leave an invariant violation in a proposed release, and add regression evidence
for confirmed defect classes where practical.

## Engineering conventions

- Run `npm test` (unit + contract suite) and `npm run check` (syntax-checks entry points and
  verifies the committed skill bundles are current) before proposing a change. After editing
  `skills/src/` or `cli/lib/`, run `npm run skills:build` and commit the rebuilt bundles.
- The repo follows a spec → plan → review workflow; design specs/plans live under
  `docs/superpowers/`.
