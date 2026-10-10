# AGENTS.md — Prax

Instructions for agents working in this repository. CLAUDE.md is a symlink to this file. The
memory convention itself (recall first, file by subject, remember durable findings) is in your
global instructions and in [docs/agent-memory.md](docs/agent-memory.md); this file covers only
what is specific to Prax.

## Start a task

1. Read [Working on Prax](docs/working-on-prax.md) for project organisation and code entry points.
2. `node cli/prax.js overview` prints the owning project's card (the checkout's marker selects
   prax); an unverified card is a lead. If none exists or the app is unavailable, use the
   repository guide and report the missing memory access.
3. `node cli/prax.js context "<task>"` gives a bounded project briefing, then
   `node cli/prax.js recall "Prax <task>"` finds knowledge across projects. Fetch a full note
   when its details matter; check unverified notes against current code.
4. For a known task, `node cli/prax.js brief <task-id>` prints its checklist, latest handoff,
   linked documents and related memories. Inspect the working tree and the task before editing;
   preserve unrelated work. Create a task for substantial new work when absent.

## Where things go

- **Prax project → Tasks:** features, bugs, improvements, releases and acceptance checks.
- **Prax project → Library:** architecture, UI conventions, decisions, runbooks and reusable
  findings (`prax remember … --project prax`, with `--cite` for code claims). One canonical
  entry per subject; retire replaced guidance with `prax supersede <oldId> --with <newId>`.
  Types: reference, decision, runbook, known-issue, post-mortem, template. Tags: architecture,
  ui, release, ci, ai, desktop, agent-memory, quality.
- **Task notes/checklist or linked handoff:** unfinished implementation state, branch/commit,
  tests run and next action. Update before handing over; close the task when its checks pass
  and retire temporary handoffs.

## Memory tools

Inside this checkout run `node cli/prax.js`: it is the code you are working on. `prax` on PATH
is a shim to the installed desktop release and lags the checkout until the next release. When
`node` is unavailable in a sandbox, see the runtime note in
[Working on Prax](docs/working-on-prax.md). The MCP server (`mcp/server.js`) is not enabled
by default here; add it with `claude mcp add prax -- node mcp/server.js` only for a heavy
task-curation session.

## Configuration and security

No authentication by design (trusted-network model). Settings access is operator access,
including execution of the selected local CLI, and database backups are secrets. See
`SECURITY.md`.

## Product quality

The active quality policy is
[Exceptional Prax — Product Quality Standard](docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md).
Its Gate A invariants apply to every change. Do not leave an invariant violation in a proposed
release, and add regression evidence for confirmed defect classes where practical.

## Engineering conventions

- Run `npm test` and `npm run check` before proposing a change. After editing `skills/src/` or
  `cli/lib/`, run `npm run skills:build` and commit the rebuilt bundles.
- Specs and plans live under `docs/superpowers/` (spec → plan → review).
