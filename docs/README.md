# Prax documentation

One guide per subject. The [README](../README.md) covers installing and running Prax and what it
does; everything else is here.

| Guide | Read it for |
| --- | --- |
| [CLI](cli.md) | Every `prax` command with its flags, environment variables, output shapes and budgets |
| [Agent memory](agent-memory.md) | The memory convention: what belongs in memory, the recall/remember loop, the librarian, harvesting, provenance, verification, the git mirror, transport |
| [Skills](../skills/README.md) | Installing the portable `prax-recall` and `prax-remember` skills, standing instructions, harvesting hooks, the CLI shim |
| [MCP server](../mcp/README.md) | Registering the MCP server with Claude Code, its tools and a smoke test |
| [Data formats](contract.md) | Task export/import, library front matter, the backup ZIP, the MCP tool surface, retry identities, the ICS feed |
| [Backup and restore](backup-restore.md) | Editor draft recovery, workspace backups, the SQLite snapshot, restore, git backup, version and schema guards |
| [Deployment](deployment.md) | The Kubernetes examples, bind safety, host names, exposure rules, data movement |
| [Google Calendar](google-calendar.md) | Setting up and running the one-way push sync |
| [Templates and starter guides](templates-and-starter-guides.md) | The bundled starters, user-authored templates, how creates recover |
| [Changelog](../CHANGELOG.md) | Release history |

Until v0.99.0 the repository carries only these user-facing guides. The contributor guide, the
design notes for each subsystem, the desktop build guide, the security model, the quality
standard and its evidence live in the Prax Library as documents of the Prax project; recall them
by subject (`prax recall "Prax design: librarian"`, `prax recall "security model"`). Git history
before 2026-10-25 keeps the files.
