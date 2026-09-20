# Shared agent memory and repository instructions

Prax stores shared local-first knowledge for agent tools. File by subject: the owning
project's Library holds its architecture, decisions and runbooks; the memory project
holds reusable conventions across repositories. Every project participates in recall.
Agent authorship and human verification are separate from where a document belongs.

## Install the commands and instructions

With a source checkout, use `node cli/prax.js` directly or `npm link` to install `prax`.
The repository's `skills/install.sh --instructions --cli` installs the portable recall
and remember skills, shared instruction blocks and a CLI shim. With a desktop installation,
run that script from the app's bundled `app/skills` directory: it uses the packaged Node
runtime, so a separate Node installation or repository is unnecessary.

The default macOS bundle location is:

```sh
/bin/sh /Applications/Prax.app/Contents/Resources/resources/app/skills/install.sh --instructions --cli
```

For another install location/platform, locate the packaged `app/skills/install.sh` instead
of assuming the macOS path. The installer reports exactly which files it updates. It refreshes
its managed blocks while preserving custom content; malformed duplicate blocks require repair.

Instruction files include `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`,
`~/.copilot/instructions/AGENTS.md` and `~/.gemini/GEMINI.md`. Enable Copilot's
custom-instruction directory in its configuration as described by the installer's output.
Installing a file does not prove a running agent has loaded it. Check loaded instructions
in a fresh session; follow the host tool's restart permissions.

## Start work

1. Read the repository's startup/codebase guide and its Prax project overview.
2. Inspect the working tree and the current task's notes, checklist and linked documents.
3. Retrieve context for the actual task; then recall across projects:

```sh
prax context "<task>" --project <project-slug>
prax recall "<project name> <task>"
prax get <document-id>
```

Use Library → New doc → Templates & guides for repository setup, a project overview
and an onboarding task. Start with the [repository setup runbook](/starter-content/repository-setup.md)
for new repositories, existing ones and additional checkouts. Keep root instructions short:
entry points, boundaries, exact validation commands and links to maintained detail.

## Save knowledge and hand over work

```sh
# Knowledge owned by one project
prax remember "<stable title>" --body "<finding and reason>" --project <project-slug> --type decision --tag architecture --cite path/to/file
# Guidance reusable across projects
prax remember "<stable title>" --body "<reusable procedure>" --memory --type runbook --tag agent-memory
```

The remember skill takes the body as its second positional argument and uses `--tags`;
choose `--project <slug>` explicitly for project knowledge. Without a project, a unique
existing title can be refined in its owning project. Reuse the canonical title or ID;
use `prax supersede <old-id> --with <new-id>` when one document replaces another.

Use a few topic tags. Types describe the document: Note, Runbook, Decision, Known issue,
Reference, Post-mortem or Template. A template is a reusable master; use it to create a
separate working copy. Do not treat it as a completed project overview or an open task.

Before handing over, update the task with changes, branch/commit, actual test results,
remaining checks and next action. Keep temporary progress out of durable memory. Complete
the task only when its acceptance checks pass; retire temporary handoffs when no longer useful.

## Trust and recovery

Agent-written knowledge is unverified until a person reviews it. Check code citations against
the current checkout. An incomplete index or keyword fallback limits recall: inspect recent
or keyword results before assuming no knowledge exists. If Prax is unavailable, use repository
guidance and report that memory could not be read; never invent a remembered decision.

Do not persist secrets or full session transcripts. Database backups may contain provider
credentials and must be protected. An ordinary app upgrade preserves the library. A new
database has the bundled starters available, but personal notes require a backup restore.
