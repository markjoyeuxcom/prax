# AGENTS.md — Prax

Instructions for agents working in this repository. CLAUDE.md is a symlink to this file. The
memory convention (recall first, file by subject, remember durable findings, `prax used`,
`Remember:` proposals) is in your global instructions and in
[docs/agent-memory.md](docs/agent-memory.md).

Inside this checkout run `node cli/prax.js`: it is the code you are working on. `prax` on PATH
is a shim to the installed desktop release and lags the checkout until the next release.

Until v0.99.0 everything else an agent needs lives in the Prax Library, not in the tree:

- `node cli/prax.js overview` prints the project card; `node cli/prax.js recall "Working on Prax"`
  returns the contributor guide (project organisation, code entry points, HTML escaping,
  validation); `node cli/prax.js brief <task-id>` prints a known task's checklist, handoff,
  linked documents and memories.
- The design note for each subsystem (`Prax design: …`), the desktop build guide, the security
  model and the product quality standard are Library documents of the Prax project; recall them
  by subject before changing the code they describe.
- Features, bugs, releases and acceptance checks are tasks in the Prax project; unfinished state,
  tests run and the next action go in the task's notes. Design notes, plans and review evidence
  are filed in the Library or on the task, never in the tree.

Run `npm test` and `npm run check` before proposing a change. After editing `skills/src/` or
`cli/lib/`, run `npm run skills:build` and commit the rebuilt bundles. No authentication by
design (trusted-network model): Settings is operator access and database backups are secrets.
