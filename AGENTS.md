# AGENTS.md — Prax

Instructions for AI coding agents working in this repo — **Codex CLI, Cursor, aider, Claude
Code, and any shell-capable agent**. Claude Code also reads `CLAUDE.md`; this file is the
tool-agnostic equivalent and is authoritative for non-Claude agents.

## Shared agent memory

This project doubles as **shared, local-first long-term memory** for AI tools, backed by
Prax's library + semantic search. Use it so durable knowledge carries across sessions
*and across tools*: what one agent learns, another can recall. The memory lives in Prax
(Postgres + embeddings), not in your context window.

Two moves — **recall first, remember durable findings.** Both are plain Node scripts that run
in any agent that can execute a shell command (the `.claude/` path is incidental — they are
not Claude-specific):

### 1. Recall first

Before starting a task, retrieve what's already known:

```bash
node .claude/skills/prax-recall/recall.mjs "<what you're about to work on>"
```

It searches **all projects** by meaning and returns a distilled summary (top hit + a short
related list) — cheap on tokens. An honest `No relevant memory found` means start fresh.
For a chronological "what did I note recently" list instead of a similarity search:

```bash
node .claude/skills/prax-recall/recall.mjs --recent 5
```

### 2. Remember durable findings

When you learn something that outlives this session — how a system works, a decision or
convention, a reusable runbook — persist it:

```bash
node .claude/skills/prax-remember/remember.mjs "<title>" "<body>" [--type runbook] [--tags a,b]
```

Writes to the dedicated **`memory`** project, **de-dups by title** (re-running refines the
note in place rather than duplicating), and stamps agent provenance (`updatedBy: agent`,
`kind: synthesized`). Agent-written memory lands **unverified** until a human verifies it — so
treat unverified recalls as leads, not gospel. Do **not** persist transient/session-only state.

## Project context packs (optional)

For a task-scoped briefing of *this project's* verified memory, the `prax` CLI assembles a
bounded, trust-aware context pack (Markdown):

```bash
node cli/prax.js context "<task>"     # briefing for the current project (.prax/project.json)
node cli/prax.js search "<query>"     # semantic search, scoped to the current project
node cli/prax.js help                 # full surface: init/context/search/get/remember/verify/supersede
```

`npm link` installs a global `prax`. Note the CLI is **project-scoped** (it resolves the
project from `.prax/project.json` / `--project`), whereas the recall/remember scripts above
operate on the cross-tool **`memory`** namespace — use the scripts for durable shared memory,
the CLI for "what does *this project* know."

## Configuration

- Both the scripts and the CLI reach Prax at **`PRAX_API_URL`** (default
  `http://127.0.0.1:3000`). Export it to point at your running instance. Semantic recall needs
  the app running with `EMBEDDING_BACKEND` set (e.g. `ollama`).
- **No authentication by design** (trusted-network model). All backend config (DB URL, embedding
  backend/URL/keys) is env-only and never settable via the web UI. See `SECURITY.md`.

## Engineering conventions

- Run `npm test` (unit + contract suite) and `npm run check` (syntax-checks entry points) before
  proposing a change.
- The repo follows a spec → plan → review workflow; design specs/plans live under
  `docs/superpowers/`. See `CLAUDE.md` for the full workflow and `docs/agent-memory.md` for the
  memory convention in depth.
