# Prax memory skills

Two skills that let an agent CLI use Prax as long-term memory:

| Skill | Does |
|---|---|
| `prax-recall` | retrieve prior context by meaning, distilled to one block |
| `prax-remember` | persist a durable finding, de-duplicated by title, with agent provenance |

Each skill is a folder with a `SKILL.md` (the instructions the agent loads) and one
bundled script under `scripts/`. The scripts are single files with **no dependencies**
beyond Node 20+, so the pack installs on a machine that has never seen this repository.
They talk to the Prax HTTP API of the running app (desktop or server) and find it on
their own: `PRAX_API_URL` → the desktop app's saved port → `http://127.0.0.1:3000`.

The layout follows the [Agent Skills](https://agentskills.io) standard, which both
Claude Code and Codex read.

## Install without a checkout

One command, both tools. It needs `git` (with access to this repository) and `node`. The
repository is private, so fetch the installer through the GitHub CLI (`gh auth login` once):

```bash
gh api -H "Accept: application/vnd.github.raw" repos/markjoyeuxcom/prax/contents/skills/install.sh | sh
```

If the repository is ever made public, the plain form works too:
`curl -fsSL https://raw.githubusercontent.com/markjoyeuxcom/prax/main/skills/install.sh | sh`.

It clones only the `skills/` folder into a temporary directory, copies the two
skills to `~/.agents/skills/` (where Codex looks), links them into `~/.claude/skills/`
(where Claude Code looks), and deletes the temporary clone. Re-run it to update;
`sh install.sh --uninstall` removes them. Environment overrides:

| Variable | Default | Purpose |
|---|---|---|
| `PRAX_SKILLS_REPO` | `git@github.com:markjoyeuxcom/prax.git` | repository to fetch from (a local path works too) |
| `PRAX_SKILLS_REF` | `main` | branch or tag |
| `PRAX_SKILLS_DIR` | `~/.agents/skills` | where the real copies live |

The repository is private, so the machine needs git credentials for it (an SSH key
or `gh auth login`). Nothing else is downloaded.

### Claude Code only: plugin install

The repository is also a Claude Code plugin marketplace, so Claude Code can install
the skills through its plugin manager (same git credentials apply):

```bash
claude plugin marketplace add markjoyeuxcom/prax
claude plugin install prax@prax
```

The skills are then available as `prax:prax-recall` and `prax:prax-remember`.

### Codex only: skill-installer

Codex's bundled `skill-installer` skill installs from a repository path:

```
$skill-installer install from markjoyeuxcom/prax path skills/prax-recall and skills/prax-remember
```

## Inside this repository

`.claude/skills/` and `.agents/skills/` are symlinks into `skills/`, so a checkout
gets both skills in both tools with no install. `AGENTS.md` tells the agents when to
use them.

## Verify an install

```bash
node ~/.agents/skills/prax-recall/scripts/recall.mjs --recent 3
```

With the app running this lists the newest documents. `Prax not reachable` means the
app is not running or is on a port the script cannot discover — set `PRAX_API_URL`.

## Developing the pack

The scripts are generated. Edit `skills/src/*.mjs` or `cli/lib/*`, then:

```bash
npm run skills:build    # rebundle skills/*/scripts/*.mjs (commit the result)
npm run skills:check    # fail if a committed bundle is stale (part of npm run check)
```
