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
their own: `PRAX_API_URL` → the desktop app's saved port → `http://127.0.0.1:3000`. Each run
binds to the one instance it finds (a write probes `/readyz` first and never fails over), and
the remember confirmation names the base URL it wrote to.

The layout follows the [Agent Skills](https://agentskills.io) standard, which both
Claude Code and Codex read.

## Install without a checkout

One command, both tools. It needs `git`, `node` **20 or newer** (the installer checks and
refuses older runtimes), and access to this repository. The repository is **private**: your
GitLab account must have been granted access to `markjoyeuxcom/apps/prax` — logging in alone is
not enough. Then fetch the installer through the GitLab CLI (`glab auth login` once):

```bash
glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh
```

Without the GitLab CLI, fetch the installer with whatever access you do have:

- **SSH key only** — check out just the `skills/` folder and run the installer from it:

  ```bash
  git clone --depth 1 --filter=blob:none --sparse git@gitlab.com:markjoyeuxcom/apps/prax.git /tmp/prax-skills \
    && git -C /tmp/prax-skills sparse-checkout set --no-cone skills \
    && PRAX_SKILLS_REPO=/tmp/prax-skills sh /tmp/prax-skills/skills/install.sh \
    && rm -rf /tmp/prax-skills
  ```

- **A personal access token** (scope `read_api` + `read_repository`):

  ```bash
  curl -fsSL -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    "https://gitlab.com/api/v4/projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" \
    | PRAX_SKILLS_REPO="https://oauth2:$GITLAB_TOKEN@gitlab.com/markjoyeuxcom/apps/prax.git" sh
  ```

If the repository is ever made public, the plain form works too:
`curl -fsSL https://gitlab.com/markjoyeuxcom/apps/prax/-/raw/main/skills/install.sh | sh`.

How it reaches the repository: when `PRAX_SKILLS_REPO` is unset and `glab auth status` succeeds,
the installer clones over **HTTPS** using `glab`'s stored credentials (`glab auth git-credential`,
passed to that one `git` invocation — your git configuration is not modified). Without a
working `glab` login it falls back to **SSH** (`git@gitlab.com:markjoyeuxcom/apps/prax.git`), which
needs an SSH key registered with GitLab. To force a transport, set `PRAX_SKILLS_REPO` yourself
(for example `https://gitlab.com/markjoyeuxcom/apps/prax.git` after `glab auth setup-git`).

It clones only the `skills/` folder into a temporary directory, copies the two
skills to `~/.agents/skills/` (where Codex looks), links them into `~/.claude/skills/`
(where Claude Code looks) and `~/.gemini/config/skills/` (where Antigravity looks),
and deletes the temporary clone. Re-run it to update. To
uninstall without a checkout, pipe the same installer with the flag:

```bash
glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh -s -- --uninstall
```

(From a checkout, `sh skills/install.sh --uninstall` does the same.) Environment overrides:

| Variable | Default | Purpose |
|---|---|---|
| `PRAX_SKILLS_REPO` | `https://gitlab.com/markjoyeuxcom/apps/prax.git` with a `glab` login, else `git@gitlab.com:markjoyeuxcom/apps/prax.git` | repository to fetch from (a local path works too) |
| `PRAX_SKILLS_REF` | `main` | branch or tag |
| `PRAX_SKILLS_DIR` | `~/.agents/skills` | where the real copies live |
| `PRAX_CLAUDE_SKILLS_DIR` | `~/.claude/skills` | where the Claude Code symlinks are created |
| `PRAX_GEMINI_SKILLS_DIR` | `~/.gemini/config/skills` | where the Antigravity symlinks are created |

A custom `PRAX_SKILLS_DIR` changes where the real copies live but the Claude Code and Antigravity links are
still created (in `PRAX_CLAUDE_SKILLS_DIR` and `PRAX_GEMINI_SKILLS_DIR`); an arbitrary directory is **not** a place Codex
discovers skills on its own, so keep the default unless you also point Codex at it. Nothing
else is downloaded.

### Claude Code only: plugin install

The repository is also a Claude Code plugin marketplace, so Claude Code can install
the skills through its plugin manager from the repository's git URL (same git credentials
apply):

```bash
claude plugin marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git
claude plugin install prax@prax
```

The skills are then available as `prax:prax-recall` and `prax:prax-remember`.

### Codex only

Codex's bundled `skill-installer` skill takes GitHub `owner/repo` shorthand, which does not
reach a GitLab project; use the installer above, which places the skills where Codex looks.

## Inside this repository

`.claude/skills/` and `.agents/skills/` are symlinks into `skills/`, so a checkout
gets both skills in both tools with no install. `AGENTS.md` tells the agents when to
use them.

## Verify an install

```bash
node ~/.agents/skills/prax-recall/scripts/recall.mjs --recent 3
```

With the app running this lists the newest active documents. `Prax not reachable` means the
app is not running or is on a port the script cannot discover — set `PRAX_API_URL`.

That only proves reachability. To exercise a write and a read without touching your real
library, start a disposable server on a throwaway database and point the scripts at it:

```bash
PRAX_DB_FILE=/tmp/prax-skill-check.db PORT=3777 npm start &     # from a checkout; or use the app
export PRAX_API_URL=http://127.0.0.1:3777
node ~/.agents/skills/prax-remember/scripts/remember.mjs "Skill check" "Installed on $(hostname)." --type note
# Remembered "Skill check" → <id> (created, as claude) at http://127.0.0.1:3777
node ~/.agents/skills/prax-recall/scripts/recall.mjs "skill check"
# one distilled block: the title, type, trust label (unverified) and id, then the body
```

Without an embedding backend the recall line is prefixed `(semantic search disabled — keyword
results)`; with one configured but still indexing it says `(index incomplete: N of M documents
pending — results may be missing)`. Stop the server and delete `/tmp/prax-skill-check.db*`
afterwards, and `unset PRAX_API_URL` so the skills go back to discovering the real app.

## Developing the pack

The scripts are generated. Edit `skills/src/*.mjs` or `cli/lib/*`, then:

```bash
npm run skills:build    # rebundle skills/*/scripts/*.mjs (commit the result)
npm run skills:check    # fail if a committed bundle is stale (part of npm run check)
```
