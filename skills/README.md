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
the remember confirmation names the project and the base URL it wrote to. A request that gets
no answer within 30 s (`PRAX_TIMEOUT_MS`) fails rather than hangs, and is never re-sent. The
scripts use the `prax` CLI's client and argument engine, so discovery, tokens, timeouts and
retries are the ones described in
[Connecting to the app](../docs/agent-memory.md#connecting-to-the-app), and options accept
`--flag=value` and a `--` terminator as the CLI's do.

The layout follows the [Agent Skills](https://agentskills.io) standard, which both
Claude Code and Codex read.

## Install from the desktop app (no repository, no git)

The desktop bundle ships this pack next to the app's CLI and MCP server
(`Prax.app/Contents/Resources/resources/app/{skills,cli,mcp}` on macOS), so a machine that
installed Prax from the dmg needs neither a checkout nor repository access:

```bash
sh "/Applications/Prax.app/Contents/Resources/resources/app/skills/install.sh" --instructions --cli
```

Run from inside a pack (the bundle, or a checkout) the installer copies the skills from
there — no clone, and the skills always match the installed app. The extra flags:

| Flag | Does |
|---|---|
| `--instructions` | writes the standing recall/remember rule into each tool's global instructions file (below) |
| `--cli` | writes a `prax` shim into `~/.local/bin` (`PRAX_BIN_DIR`) that runs the bundle's `cli/prax.js` on the app's **own** Node runtime — no Node install needed for it; from a checkout it runs `cli/prax.js` on `node`. Installed from the app bundle, the shim tracks the **installed** desktop version, so it lags a development checkout until the next release (use `node cli/prax.js` there). Combined with `--instructions`, the standing rule is written in `prax …` form |
| `--hooks` | adds two hooks to Claude Code, Codex and Copilot CLI, both on the bundle's CLI and runtime: session-start recall (`prax session-start --hook <vendor>`, a budgeted briefing plus what changed since the agent's last session, as context before the first prompt) and session harvesting (`prax harvest --hook <vendor>`, which files the proposals an agent writes as `Remember:` lines or `prax-remember` blocks once as unverified Inbox candidates); see [below](#session-hooks---hooks) |
| `--mcp` | prints the `mcp add prax …` command for Claude Code, Codex, Copilot CLI and Antigravity, pointing at the bundle's `mcp/server.js` on that same runtime (registration stays opt-in). No `PRAX_API_URL` is needed: the MCP server finds the running app the way the CLI does |
| `--library-block` | compiles the **verified** decisions (and verified documents tagged `convention`) of the `memory` project into each tool's global instructions file, in a second marked block (`<!-- prax-library:start -->` … `end`) beside the standing rule. It runs the pack's `prax mirror --agents-block`, so it needs the app payload beside the pack and a running app; when the app is unreachable it says so and leaves the files unchanged. Unverified memory is never compiled. Re-run to refresh; see [the CLI guide](../docs/cli.md#mirror---out-dir---check---force-mirror-import-dir-mirror---agents-block) |

`--uninstall` removes the skills, the links, both kinds of instruction block, the shim (never a
`prax` it did not write) and Prax's harvest hook handlers (never anyone else's). The skills
themselves still need Node 20+ on `PATH`, because the
agents run them with `node`.

## Install without a checkout

One command, both tools. It needs `git`, `node` **20 or newer** (the installer checks and
refuses older runtimes), and access to this repository. The repository is **private**: your
GitHub account must have been granted access to `markjoyeuxcom/prax` — logging in alone is
not enough. Then fetch the installer through the GitHub CLI (`gh auth login` once):

```bash
gh api -H "Accept: application/vnd.github.raw" repos/markjoyeuxcom/prax/contents/skills/install.sh | sh
```

Without the GitHub CLI, fetch the installer with whatever access you do have:

- **SSH key only** — check out just the `skills/` folder and run the installer from it:

  ```bash
  git clone --depth 1 --filter=blob:none --sparse git@github.com:markjoyeuxcom/prax.git /tmp/prax-skills \
    && git -C /tmp/prax-skills sparse-checkout set --no-cone skills \
    && PRAX_SKILLS_REPO=/tmp/prax-skills sh /tmp/prax-skills/skills/install.sh \
    && rm -rf /tmp/prax-skills
  ```

- **A personal access token** (fine-grained, with read access to this repository's contents):

  ```bash
  curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" \
    https://api.github.com/repos/markjoyeuxcom/prax/contents/skills/install.sh \
    | PRAX_SKILLS_REPO="https://oauth2:$GITHUB_TOKEN@github.com/markjoyeuxcom/prax.git" sh
  ```

If the repository is ever made public, the plain form works too:
`curl -fsSL https://raw.githubusercontent.com/markjoyeuxcom/prax/main/skills/install.sh | sh`.

How it reaches the repository: when `PRAX_SKILLS_REPO` is unset and `gh auth status` succeeds,
the installer clones over **HTTPS** using `gh`'s stored credentials (`gh auth git-credential`,
passed to that one `git` invocation — your git configuration is not modified). Without a
working `gh` login it falls back to **SSH** (`git@github.com:markjoyeuxcom/prax.git`), which
needs an SSH key registered with GitHub. To force a transport, set `PRAX_SKILLS_REPO` yourself
(for example `https://github.com/markjoyeuxcom/prax.git` after `gh auth setup-git`).

It clones only the `skills/` folder into a temporary directory, copies the two
skills to `~/.agents/skills/` (where Codex looks), links them into `~/.claude/skills/`
(where Claude Code looks) and `~/.gemini/config/skills/` (where Antigravity looks),
and deletes the temporary clone. Re-run it to update. To
uninstall without a checkout, pipe the same installer with the flag:

```bash
gh api -H "Accept: application/vnd.github.raw" repos/markjoyeuxcom/prax/contents/skills/install.sh | sh -s -- --uninstall
```

(From a checkout, `sh skills/install.sh --uninstall` does the same.)

### Standing instructions: `--instructions`

Skills only fire when the model decides to use them. What makes memory reliable is a standing
rule in each tool's **global** instructions — read the project briefing, recall before a task,
file durable findings with their project, and record progress on the task. `--instructions`
adds or refreshes that rule between `<!-- prax-memory:start/end -->` markers. Unchanged blocks
are left alone; unrelated text is preserved; malformed or ambiguous markers stop the update.
`--uninstall` removes the marked block the same way: a symlinked file is edited at its target,
its mode is kept, and a missing or duplicated marker leaves the file unchanged and fails the run:

```bash
gh api -H "Accept: application/vnd.github.raw" repos/markjoyeuxcom/prax/contents/skills/install.sh | sh -s -- --instructions
```

| Tool | File written | Note |
|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | managed block refreshed; other content kept |
| Codex | `~/.codex/AGENTS.md` | managed block refreshed; other content kept |
| Copilot CLI | `~/.copilot/instructions/AGENTS.md` | Copilot reads it only when your shell exports `COPILOT_CUSTOM_INSTRUCTIONS_DIRS="$HOME/.copilot/instructions"` — the installer prints the line |
| Antigravity | `~/.gemini/GEMINI.md` | global guidance; workspace `AGENTS.md`/`GEMINI.md` can add project details |

The commands in the block follow what the machine can run. With `--cli` (and `PRAX_BIN_DIR` on
your `PATH`) it teaches the short form — `prax recall "…"`, `prax remember "…" --body "…"
--project <slug>` for project knowledge and `--memory` for cross-project guidance — and names
the shim's absolute path as the fallback; otherwise it names the installed
script paths (`~/.agents/skills/…`). Either way it works from any directory. `--cli` is applied
before `--instructions` for exactly this reason. Re-run `--instructions` to refresh an existing
block or switch its command form; no uninstall is required. Environment overrides:

| Variable | Default | Purpose |
|---|---|---|
| `PRAX_SKILLS_REPO` | `https://github.com/markjoyeuxcom/prax.git` with a `gh` login, else `git@github.com:markjoyeuxcom/prax.git` | repository to fetch from (a local path works too) |
| `PRAX_SKILLS_REF` | `main` | branch or tag |
| `PRAX_SKILLS_DIR` | `~/.agents/skills` | where the real copies live |
| `PRAX_CLAUDE_SKILLS_DIR` | `~/.claude/skills` | where the Claude Code symlinks are created |
| `PRAX_GEMINI_SKILLS_DIR` | `~/.gemini/config/skills` | where the Antigravity symlinks are created |
| `PRAX_CLAUDE_INSTRUCTIONS` | `~/.claude/CLAUDE.md` | `--instructions`: Claude Code's global instructions file |
| `PRAX_CODEX_INSTRUCTIONS` | `~/.codex/AGENTS.md` | `--instructions`: Codex's global instructions file |
| `PRAX_GEMINI_INSTRUCTIONS` | `~/.gemini/GEMINI.md` | `--instructions`: Antigravity's global instructions file |
| `PRAX_COPILOT_INSTRUCTIONS_DIR` | `~/.copilot/instructions` | `--instructions`: the directory Copilot is pointed at via `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` |
| `PRAX_CLAUDE_SETTINGS` | `~/.claude/settings.json` | `--hooks`: Claude Code's settings file (the `Stop` hook) |
| `PRAX_CODEX_HOOKS` | `${CODEX_HOME:-~/.codex}/hooks.json` | `--hooks`: Codex's hook file (the `Stop` hook) |
| `PRAX_COPILOT_HOOKS_DIR` | `${COPILOT_HOME:-~/.copilot}/hooks` | `--hooks`: where the installer's own `prax-harvest.json` (the `agentStop` hook) is written |
| `PRAX_BIN_DIR` | `~/.local/bin` | `--cli`: where the `prax` shim is written (and what decides whether `--instructions` can use the `prax` form) |
| `PRAX_LIBRARY_BLOCK_PROJECT` | `memory` | `--library-block`: the project whose verified conventions are compiled |

A custom `PRAX_SKILLS_DIR` changes where the real copies live but the Claude Code and Antigravity links are
still created (in `PRAX_CLAUDE_SKILLS_DIR` and `PRAX_GEMINI_SKILLS_DIR`); an arbitrary directory is **not** a place Codex
discovers skills on its own, so keep the default unless you also point Codex at it. Nothing
else is downloaded.

### Session hooks: `--hooks`

`--hooks` needs the app payload (run the installer from the bundle or a checkout, as for
`--cli`). It installs two hooks per agent CLI that has hooks: **session-start recall**
(`prax session-start --hook <vendor>`), which opens every session with a budgeted context pack
for the project the session's directory belongs to plus what changed in memory since that
agent's last session, and **session harvesting** (`prax harvest --hook <vendor>`). Both commands
run the payload's `cli/prax.js` on the same runtime as the shim, so they work whatever the
agent's `PATH` is, and both fail open: Prax down, no project, a slow request, and the hook prints
nothing and exits 0.

| Tool | File | Hooks |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `SessionStart` (no matcher: startup, resume, clear and compact) and `Stop` |
| Codex | `~/.codex/hooks.json` | `SessionStart` and `Stop`. Codex runs a new hook only after you trust it: open Codex, run `/hooks`, trust both |
| Copilot CLI | `~/.copilot/hooks/prax-harvest.json` | `sessionStart` and `agentStop`, in a file the installer owns |
| Antigravity | — | no hooks; the standing block is the only prompt to recall, and `prax harvest --transcript <file>` reads an exported conversation |

The settings edit follows the same rules as the instruction blocks. Only Prax's own handlers
(commands running `prax.js session-start --hook <vendor>` and `prax.js harvest --hook <vendor>`)
are added, replaced or removed. Every other key and hook stays in place and in order. A symlinked file is edited at its target and keeps its
mode, and the write is atomic. Invalid JSON, or a `hooks` value of the wrong shape, leaves the
file unchanged and fails the run. A re-run is idempotent. `--uninstall` removes Prax's handlers,
prunes only the containers that held nothing else, and never deletes a settings file.

With a hook installed, `--instructions` adds a paragraph to the standing block that teaches the
proposal markers. Without a hook the paragraph is left out, so an agent is never told a marker
files anything when nothing reads it. What the hook does, and what it never does, is described
under
[session harvesting](../docs/agent-memory.md#session-harvesting-proposals-into-the-inbox) and
[`prax harvest`](../docs/cli.md#harvest---transcript-file---session-id---dry-run---budget-ms-n---json).

### Claude Code only: plugin install

The repository is also a Claude Code plugin marketplace, so Claude Code can install
the skills through its plugin manager (same `gh` or git credentials apply):

```bash
claude plugin marketplace add markjoyeuxcom/prax
claude plugin install prax@prax
```

The skills are then available as `prax:prax-recall` and `prax:prax-remember`.

### Codex only

Codex's bundled `skill-installer` skill takes GitHub `owner/repo` shorthand, but the installer
above remains the supported route: it places the skills where Codex looks, links them for the
other tools and writes the standing instructions.

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
# Remembered "Skill check" → <id> (created in memory, as claude) at http://127.0.0.1:3777
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
