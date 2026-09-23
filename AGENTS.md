# AGENTS.md — Prax

Instructions for agents working in this repository. CLAUDE.md is a symlink to this file.

## Start a task

1. Read [Working on Prax](docs/working-on-prax.md) for project organisation and code entry points.
2. Print the owning project’s overview with `node cli/prax.js overview` (the checkout’s marker
   selects prax). It says whether the card is verified; an unverified card is a lead. If none
   exists, use the repository guide and the bundled Project overview starter; do not assume
   another machine’s IDs. If the app is unavailable, use the repository guide and report the
   missing memory access.
3. Run `node cli/prax.js context "<task>"` for a bounded project briefing, then
   `node cli/prax.js recall "Prax <task>"` for relevant knowledge across projects. Fetch a full
   note when its details matter. Unverified notes are leads; check them against current code.
4. For a known task, `node cli/prax.js brief <task-id>` prints its checklist, latest handoff,
   linked documents and the top related memories in one call. Inspect the working tree and the
   relevant Prax task's notes, checklist and linked documents before editing. Preserve unrelated work. Create a task for substantial new work when absent.

## Organise work and knowledge

- **Prax project → Tasks:** features, bugs, improvements, releases and acceptance checks.
- **Prax project → Library:** Prax architecture, UI conventions, decisions, runbooks and
  reusable findings. Agent-written documents belong here too; author provenance is separate.
- **Task notes/checklist or linked handoff:** unfinished implementation state, branch/commit,
  tests run and next action. Update before handing over. Close the task when its checks pass;
  retire temporary handoffs when finished.
- **Memory project:** preferences, conventions and procedures useful across projects.
  All projects participate in shared recall; `memory` is not required for other agents to read a note.

Save durable project knowledge explicitly in Prax:

```bash
prax remember "<stable title>" --body "<useful guidance>" --project prax --type decision --tag architecture --cite path/to/file
```

For knowledge useful across projects, use `--memory` instead of `--project prax`.
The remember skill uses `--project prax` for this repository and `--project memory` for
cross-project knowledge. Keep one canonical entry per subject; reuse its title or ID when
refining it. Retire replaced guidance with `prax supersede <oldId> --with <newId>`.
Use document types (reference, decision, runbook, known-issue, post-mortem, template) and a small topic
vocabulary: architecture, ui, release, ci, ai, desktop, agent-memory, quality.

Agent-written revisions remain unverified until a person reviews them. Use `--cite` for code
claims so later recall can flag changed, moved or missing source. Never store secrets or put
session-only progress into reusable memory. A miss with incomplete index coverage needs a
recent/keyword check, not an assumption that no knowledge exists.

## Memory tools

Inside this checkout, run `node cli/prax.js`: it is the code you are working on. `prax` on PATH
(`~/.local/bin/prax`) is a shim to the installed desktop release (`/Applications/Prax.app`), so
it lags the checkout until the next release and may lack new commands or fixes. Outside this
repository, `prax` is the right command. In a sandbox where `node` resolves through mise shims
that cannot read `~/.config/mise/config.toml`, run the checkout CLI on the desktop bundle's own
runtime instead: `/Applications/Prax.app/Contents/MacOS/prax-server cli/prax.js <args>` (see
[Working on Prax](docs/working-on-prax.md)). The portable prax-recall and prax-remember skills
share the CLI engine; see [the memory convention](docs/agent-memory.md) and [skills](skills/README.md).
Project commands resolve `--project`, PRAX_PROJECT, .prax/project.json, git remote or folder
name; this checkout's marker selects prax. Recall searches all projects unless scoped.

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
