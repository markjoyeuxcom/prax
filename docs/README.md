# Prax documentation

One guide per subject. The [README](../README.md) covers installing and running Prax and what it
does; everything else is here.

| Guide | Read it for |
| --- | --- |
| [Working on Prax](working-on-prax.md) | Contributing: starting and handing over a task, where knowledge is filed, code entry points, HTML escaping, validation |
| [CLI](cli.md) | Every `prax` command with its flags, environment variables, output shapes and budgets |
| [Agent memory](agent-memory.md) | The memory convention: what belongs in memory, the recall/remember loop, the librarian, harvesting, provenance, verification, the git mirror, transport |
| [Skills](../skills/README.md) | Installing the portable `prax-recall` and `prax-remember` skills, standing instructions, harvesting hooks, the CLI shim |
| [MCP server](../mcp/README.md) | Registering the MCP server with Claude Code, its tools and a smoke test |
| [Data formats](contract.md) | Task export/import, library front matter, the backup ZIP, the MCP tool surface, retry identities, the ICS feed |
| [Backup and restore](backup-restore.md) | Editor draft recovery, workspace backups, the SQLite snapshot, restore, version and schema guards |
| [Desktop build](desktop/BUILD.md) | Building and packaging the Tauri app, where data lives, the menu bar, lifecycle guarantees, releases, updates, recovery |
| [Deployment](deployment.md) | The Kubernetes examples, bind safety, host names, exposure rules, data movement |
| [Google Calendar](google-calendar.md) | Setting up and running the one-way push sync |
| [Templates and starter guides](templates-and-starter-guides.md) | The bundled starters, user-authored templates, how creates recover |
| [Quality](quality.md) | Per-surface scorecards, release blockers, the activation checklist and the manual drills |
| [Quality fixture](quality-fixture.md) | The deterministic workspace generator, the performance baseline, the portable and restore drills |
| [Security](../SECURITY.md) | The trust model, what is in and out of scope, how to report a vulnerability |
| [Changelog](../CHANGELOG.md) | Release history |

## Design notes

`design/` holds the design note for each subsystem whose behaviour is easier to follow from its
rationale than from the code alone. Each names its date and status; check it against the current
code before relying on a detail.

| Note | Covers |
| --- | --- |
| [Quality standard](design/quality-standard.md) | The product quality policy: promise, Gate A/B ratchet, invariants, critical journeys, evidence requirements |
| [Year-one shell](design/year-one-shell.md) | The shell redesign for a year of heavy use: header, navigation, palette scopes, Library table mode, Today |
| [Budgeted context and brief](design/budgeted-context-and-brief.md) | Token budgets for `context`, `recall` and `brief`, and the since-last-session memory delta |
| [Librarian](design/librarian.md) | Recall telemetry, near-duplicate and stale detection, and the librarian review surface |
| [Session harvesting](design/session-harvesting.md) | Turning an agent's `Remember:` proposals into unverified Inbox candidates through vendor hooks |
| [Session-start recall](design/session-start-recall.md) | The SessionStart hook that opens every agent session with a budgeted briefing and the delta, the taught `prax used` signal, and the repo-URL drift check in doctor |
| [Triage TUI](design/triage-tui.md) | The attended-terminal review queue and the human-only guard on verification |
| [Library git mirror](design/library-git-mirror.md) | `prax mirror`: the Library as reviewable Markdown in the repository and the compiled instruction block |
| [`prax check`](design/prax-check.md) | Checking a diff or file set against the project's memory |
| [Knowledge-base health AI](design/kb-health-ai.md) | Wiki-link suggestions and the bounded, grounded contradiction and gap scan |

Historical specs, implementation plans, review transcripts and the 2026-07 desktop design
prompts were removed from the tree on 2026-10-11; git history before that commit keeps them.
Decisions and review evidence worth keeping belong in the Prax project's Library (see
[Working on Prax](working-on-prax.md#file-useful-knowledge)).
