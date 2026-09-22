#!/usr/bin/env sh
# Install (or remove) the Prax memory skills for Claude Code, Codex, Copilot CLI
# and Antigravity. Copies the skills to $PRAX_SKILLS_DIR (default
# ~/.agents/skills, read by Codex and Copilot), links them into
# $PRAX_CLAUDE_SKILLS_DIR (default ~/.claude/skills, read by Claude Code) and
# $PRAX_GEMINI_SKILLS_DIR (default ~/.gemini/config/skills, read by Antigravity).
# Re-run to update.
#
# WHERE THE SKILLS COME FROM. When this script sits next to the skills — inside
# the Prax desktop app bundle (Prax.app/Contents/Resources/resources/app/skills)
# or a checkout — it installs from there: no git, no repository access, and the
# skills match the app exactly. Run it straight from the bundle:
#
#   sh "/Applications/Prax.app/Contents/Resources/resources/app/skills/install.sh" --instructions --cli
#
# Piped from the repository it clones the skills/ folder instead (private
# repository: an account with access, via glab login or an SSH key):
#
#   glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh
#   glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh -s -- --uninstall
#
# Transport for the clone: an explicit PRAX_SKILLS_REPO (git URL or local path)
# is used as given. Otherwise, when the GitLab CLI is logged in, the clone goes
# over HTTPS with glab's credential helper for this one command (no git config
# is changed); without glab it falls back to SSH. PRAX_SKILLS_SOURCE=clone forces
# a clone even when a local pack is present.
#
# Overrides: PRAX_SKILLS_REPO, PRAX_SKILLS_REF (branch/tag, default main),
# PRAX_SKILLS_SOURCE (auto|clone), PRAX_SKILLS_DIR (real copies),
# PRAX_CLAUDE_SKILLS_DIR (Claude Code links), PRAX_GEMINI_SKILLS_DIR
# (Antigravity links), PRAX_GEMINI_INSTRUCTIONS (global rules),
# PRAX_BIN_DIR (--cli shim, default ~/.local/bin).
#
# --instructions adds or refreshes the standing "recall first / file by project"
# rule in each tool's global instructions file, between marker comments. The
# commands it writes are `prax …` when --cli has put the shim on PATH, and the
# skill scripts' absolute paths otherwise, so the block never teaches a command
# this machine cannot run:
#   Claude Code  $PRAX_CLAUDE_INSTRUCTIONS      (default ~/.claude/CLAUDE.md)
#   Codex        $PRAX_CODEX_INSTRUCTIONS       (default ~/.codex/AGENTS.md)
#   Copilot CLI  $PRAX_COPILOT_INSTRUCTIONS_DIR/AGENTS.md (default ~/.copilot/instructions),
#                which Copilot reads only when COPILOT_CUSTOM_INSTRUCTIONS_DIRS names
#                that directory — the installer prints the export line.
#   Antigravity  $PRAX_GEMINI_INSTRUCTIONS      (default ~/.gemini/GEMINI.md)
#
# --cli writes a `prax` shim into $PRAX_BIN_DIR that runs the CLI shipped next
# to the pack (the app bundle's cli/prax.js on the app's own Node runtime, so
# the machine needs no Node for it; a checkout's cli/prax.js on `node`). It runs
# before --instructions, because the shim decides which form that block teaches.
# --mcp prints the MCP registration command for each tool, pointing at the
# same payload's mcp/server.js — registration itself stays opt-in.
# --uninstall removes the skills, their links, the instruction blocks and the
# shim, and leaves everything else alone.
set -eu

REF="${PRAX_SKILLS_REF:-main}"
DEST="${PRAX_SKILLS_DIR:-$HOME/.agents/skills}"
CLAUDE_DIR="${PRAX_CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
GEMINI_DIR="${PRAX_GEMINI_SKILLS_DIR:-$HOME/.gemini/config/skills}"
BIN_DIR="${PRAX_BIN_DIR:-$HOME/.local/bin}"
SOURCE="${PRAX_SKILLS_SOURCE:-auto}"
CLI_FORM=0
SKILLS="prax-recall prax-remember"
HTTPS_REPO="https://gitlab.com/markjoyeuxcom/apps/prax.git"
SSH_REPO="git@gitlab.com:markjoyeuxcom/apps/prax.git"
MIN_NODE_MAJOR=20

# Standing-instruction files (see --instructions in the header).
CLAUDE_MD="${PRAX_CLAUDE_INSTRUCTIONS:-$HOME/.claude/CLAUDE.md}"
CODEX_MD="${PRAX_CODEX_INSTRUCTIONS:-$HOME/.codex/AGENTS.md}"
GEMINI_MD="${PRAX_GEMINI_INSTRUCTIONS:-$HOME/.gemini/GEMINI.md}"
COPILOT_DIR="${PRAX_COPILOT_INSTRUCTIONS_DIR:-$HOME/.copilot/instructions}"
COPILOT_MD="$COPILOT_DIR/AGENTS.md"
BLOCK_START='<!-- prax-memory:start -->'
BLOCK_END='<!-- prax-memory:end -->'
SHIM_MARK='# prax-shim: written by the Prax skills installer; --uninstall removes it.'

usage() {
  echo "usage: install.sh [--instructions] [--cli] [--mcp]   install/update the skills (plus the standing instructions, the prax shim, the MCP commands)"
  echo "       install.sh --uninstall                       remove the skills, their links, any instruction blocks and the shim"
}

UNINSTALL=0
INSTRUCTIONS=0
CLI=0
MCP=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --instructions) INSTRUCTIONS=1 ;;
    --cli) CLI=1 ;;
    --mcp) MCP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install.sh: unknown option $arg" >&2; usage >&2; exit 2 ;;
  esac
done

# The pack next to this script, when the script was run from a file (piped
# through `sh -s`, $0 is the shell and there is no pack). Inside the app bundle
# or a checkout the app payload — cli/, mcp/ — sits one level up.
PACK_DIR=""
APP_DIR=""
case "${0:-}" in
  */*) if [ -f "$(dirname "$0")/prax-recall/SKILL.md" ]; then PACK_DIR="$(cd "$(dirname "$0")" && pwd)"; fi ;;
esac
if [ -n "$PACK_DIR" ] && [ -f "$PACK_DIR/../cli/prax.js" ]; then
  APP_DIR="$(cd "$PACK_DIR/.." && pwd)"
fi

# The runtime that runs the payload's CLI and MCP server: the app's own bundled
# Node when the pack is inside the bundle (macOS: Contents/MacOS/prax-server;
# Linux packages put prax-server on PATH), otherwise whatever `node` is on PATH.
runtime_for_app() {
  if [ -x "$APP_DIR/../../../MacOS/prax-server" ]; then
    echo "$(cd "$APP_DIR/../../../MacOS" && pwd)/prax-server"
  elif command -v prax-server >/dev/null 2>&1; then
    command -v prax-server
  else
    command -v node
  fi
}

# Substitute the installed paths into a block. awk with index/substr rather
# than sed, so a path holding & or | is inserted literally.
subst_paths() {
  awk -v d="$DEST" -v b="$BIN_DIR" '
    {
      i = index($0, "__SKILLS_DIR__")
      while (i) { $0 = substr($0, 1, i - 1) d substr($0, i + 14); i = index($0, "__SKILLS_DIR__") }
      i = index($0, "__BIN_DIR__")
      while (i) { $0 = substr($0, 1, i - 1) b substr($0, i + 11); i = index($0, "__BIN_DIR__") }
    } 1'
}

# The commands the block teaches, in the form this machine can actually run:
# the `prax` shim once --cli has put one on PATH (shorter, and it carries the
# app's own Node), else the installed skill scripts by absolute path. CLI_FORM
# is decided after the shim is written, below.
recall_commands() {
  if [ "$CLI_FORM" = 1 ]; then
    cat <<'CMDS'
prax recall "<what I'm about to work on>"
prax recall --recent 5      # chronological list instead
CMDS
  else
    cat <<'CMDS'
node "__SKILLS_DIR__/prax-recall/scripts/recall.mjs" "<what I'm about to work on>"
node "__SKILLS_DIR__/prax-recall/scripts/recall.mjs" --recent 5      # chronological list instead
CMDS
  fi
}

remember_commands() {
  if [ "$CLI_FORM" = 1 ]; then
    cat <<'CMDS'
# Knowledge about one project:
prax remember "<title>" --body "<body>" --project <slug> [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tag a,b] [--ref <url>] [--cite <path[:start[-end]]>]
# Knowledge useful across projects:
prax remember "<title>" --body "<body>" --memory [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tag a,b] [--ref <url>]
CMDS
  else
    cat <<'CMDS'
# Knowledge about one project:
node "__SKILLS_DIR__/prax-remember/scripts/remember.mjs" "<title>" "<body>" --project <slug> [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tags a,b] [--ref <url>] [--cite <path[:start[-end]]>]
# Knowledge useful across projects:
node "__SKILLS_DIR__/prax-remember/scripts/remember.mjs" "<title>" "<body>" --project memory [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tags a,b] [--ref <url>]
CMDS
  fi
}

# The CLI shim has an absolute fallback when the shell's PATH differs.
remember_note() {
  [ "$CLI_FORM" = 1 ] || return 0
  cat <<'NOTE'
If `prax` is not found, run it as `__BIN_DIR__/prax`.

NOTE
}

# The block every tool gets. Quoted heredocs: nothing expands, so the backticks
# stay literal Markdown and the paths are filled in by subst_paths.
instruction_block() {
  {
    cat <<'BLOCK'
## Long-term memory (Prax)

Prax is the shared, local-first long-term memory for every agent CLI on this machine
(Claude Code, Codex, Copilot CLI and Antigravity all read and write the same library). Use it
in every project.

**Recall first.** Read the repository's startup guide and its Prax project overview when
available, then retrieve knowledge relevant to the task:

```bash
BLOCK
    recall_commands
    cat <<'BLOCK'
```

Every hit says which project it lives in (`in homelab`), its trust (`verified by …` or
`unverified`), its age and who wrote it. Treat `unverified` hits as leads, not gospel; weigh a
months-old agent note accordingly. A miss with complete index coverage means start fresh;
an incomplete-index or keyword-only result needs a recent/keyword check. If Prax is
unreachable, report that and use repository documentation; never invent memory.

**File by subject.** Project-specific architecture, decisions, runbooks and findings belong
in that project's Library. Reserve the `memory` project for preferences, conventions and
procedures useful across projects. Documents in every project are shared with all agents;
the author's identity is recorded separately. Recall searches across projects by default.

**Remember durable findings.** When you learn something that outlives this session — how a
system works, a decision or convention, a reusable runbook — persist it:

```bash
BLOCK
    remember_commands
    cat <<'BLOCK'
```

BLOCK
    remember_note
    cat <<'BLOCK'
Re-running with the same title refines the memory in place; without `--project`, a title that
already lives in another project is refined there, never duplicated. Use `--cite` when the claim
is about specific code (run it from inside the checkout). Keep entries concise and supersede
obsolete guidance. Agent-written revisions remain unverified until a person reviews them.

**Track the work.** Put unfinished implementation state, branch/commit, test results and the
next action in the relevant task's notes/checklist or linked handoff. Update it before handing
over; close the task when its acceptance checks pass. Keep reusable findings in the Library,
and retire temporary handoffs when finished. Never persist secrets.
BLOCK
  } | subst_paths
}

# Add, refresh or remove only our marked block — one Node path for both
# directions. Preserve unrelated bytes, modes and symlinks (a symlinked file is
# edited at its target, the link stays a link); refuse malformed/ambiguous
# markers rather than guessing which text to replace or delete (a start marker
# with no end would otherwise take every line after it); write atomically.
#   edit_instructions write <file> <body>     edit_instructions remove <file>
edit_instructions() {
  node --input-type=module - "$@" <<'NODE'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const [mode, file, body] = process.argv.slice(2);
if (mode === 'remove' && !existsSync(file)) process.exit(0);
const path = existsSync(file) ? realpathSync(file) : file;
const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
const start = '<!-- prax-memory:start -->';
const end = '<!-- prax-memory:end -->';
const markers = [...before.matchAll(/<!-- prax-memory:(start|end) -->/g)];
if (mode === 'remove' && !markers.length) process.exit(0);
const [a, b] = markers;
if (markers.length && (markers.length !== 2 || a[1] !== 'start' || b[1] !== 'end'
    || (a.index && before[a.index - 1] !== '\n') || before[a.index + start.length] !== '\n'
    || before[b.index - 1] !== '\n'
    || (b.index + end.length < before.length && before[b.index + end.length] !== '\n'))) {
  console.error(`Malformed Prax instruction markers in ${file}; file left unchanged`);
  process.exit(1);
}
let after;
if (mode === 'remove') {
  // The block and its own line ending; when it closed the file, also the
  // blank line the installer put before it.
  const tail = b.index + end.length + (before[b.index + end.length] === '\n' ? 1 : 0);
  after = before.slice(0, a.index) + before.slice(tail);
  if (tail === before.length && after.endsWith('\n\n')) after = after.slice(0, -1);
} else {
  const block = `${start}\n${body}\n${end}`;
  after = markers.length
    ? before.slice(0, a.index) + block + before.slice(b.index + end.length)
    : `${before}${before ? '\n' : ''}${block}\n`;
}
if (after === before) console.log(`instructions already current in ${file}`);
else {
  const temporary = `${path}.prax-tmp.${randomUUID()}`;
  try {
    writeFileSync(temporary, after, { flag: 'wx', mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
    if ((existsSync(path) ? readFileSync(path, 'utf8') : '') !== before) throw new Error(`Instructions changed during update: ${file}`);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  console.log(`instructions ${mode === 'remove' ? 'removed from' : markers.length ? 'updated in' : 'added in'} ${file}`);
}
NODE
}

write_instructions() {
  file="$1"
  mkdir -p "$(dirname "$file")"
  edit_instructions write "$file" "$(instruction_block)"
}

# Remove exactly the marked block; the rest of the file is untouched. Without
# Node there is no safe edit, so a file that holds a block is left as it is.
REMOVE_FAILED=0
remove_instructions() {
  file="$1"
  [ -e "$file" ] || return 0
  if ! command -v node >/dev/null 2>&1; then
    if grep -qF "$BLOCK_START" "$file"; then
      echo "install.sh: node is needed to remove the Prax block from $file safely; left unchanged" >&2
      REMOVE_FAILED=1
    fi
    return 0
  fi
  edit_instructions remove "$file" || REMOVE_FAILED=1
}

# The shim is ours only if it carries the marker; a foreign `prax` is never touched.
remove_shim() {
  [ -f "$BIN_DIR/prax" ] || return 0
  grep -qF "$SHIM_MARK" "$BIN_DIR/prax" || return 0
  rm -f "$BIN_DIR/prax"
  echo "removed $BIN_DIR/prax"
}

if [ "$UNINSTALL" = 1 ]; then
  for s in $SKILLS; do
    rm -rf "$DEST/$s"
    [ -L "$CLAUDE_DIR/$s" ] && rm -f "$CLAUDE_DIR/$s"
    [ -L "$GEMINI_DIR/$s" ] && rm -f "$GEMINI_DIR/$s"
    echo "removed $s"
  done
  for f in "$CLAUDE_MD" "$CODEX_MD" "$COPILOT_MD" "$GEMINI_MD"; do remove_instructions "$f"; done
  remove_shim
  # A block that could not be removed safely is reported, and the run fails.
  if [ "$REMOVE_FAILED" = 1 ]; then
    echo "install.sh: some instruction blocks were left in place; remove them by hand" >&2
    exit 1
  fi
  exit 0
fi

command -v node >/dev/null 2>&1 || { echo "install.sh: node ($MIN_NODE_MAJOR+) is required to run the skills" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  echo "install.sh: Node $MIN_NODE_MAJOR or newer is required to run the skills (found $(node --version 2>/dev/null || echo none))" >&2
  exit 1
fi

# Where to copy the skills from: the local pack when there is one (and nothing
# forces a clone), else a sparse clone of the repository.
SRC=""
ORIGIN=""
if [ -n "$PACK_DIR" ] && [ "$SOURCE" != "clone" ] && [ -z "${PRAX_SKILLS_REPO:-}" ]; then
  SRC="$PACK_DIR"
  if [ -n "$APP_DIR" ] && [ -f "$APP_DIR/package.json" ]; then
    APP_VERSION="$(node -p 'require(process.argv[1]).version' "$APP_DIR/package.json" 2>/dev/null || echo unknown)"
    ORIGIN="the local pack at $PACK_DIR (Prax v$APP_VERSION)"
  else
    ORIGIN="the local pack at $PACK_DIR"
  fi
else
  command -v git >/dev/null 2>&1 || { echo "install.sh: git is required to fetch the skills (or run this installer from the Prax app bundle, which needs no git)" >&2; exit 1; }
  # Pick the repository and, for the glab path, a one-command credential helper.
  CREDENTIAL_ARGS=""
  if [ -n "${PRAX_SKILLS_REPO:-}" ]; then
    REPO="$PRAX_SKILLS_REPO"
    TRANSPORT="explicit"
  elif command -v glab >/dev/null 2>&1 && glab auth status >/dev/null 2>&1; then
    REPO="$HTTPS_REPO"
    TRANSPORT="https (glab credentials)"
    CREDENTIAL_ARGS="yes"
  else
    REPO="$SSH_REPO"
    TRANSPORT="ssh"
  fi

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM

  # Every git command that may talk to the remote goes through here, so the glab
  # credential helper applies to the clone AND to the sparse checkout that
  # fetches the skills blobs afterwards (a blobless clone defers them). An empty
  # helper value resets git's inherited helper list; the next one is glab's.
  run_git() {
    if [ -n "$CREDENTIAL_ARGS" ]; then
      git -c credential.helper= -c 'credential.helper=!glab auth git-credential' "$@"
    else
      git "$@"
    fi
  }

  # A blobless sparse clone fetches the skills/ folder only. --no-local keeps the
  # same code path for a local repository path (used by the self-test).
  # git prints a harmless "filtering not recognized" warning for local transports;
  # show git's stderr only when a step actually fails.
  if ! run_git clone --quiet --no-local --depth 1 --branch "$REF" --filter=blob:none --sparse "$REPO" "$TMP/prax" 2>"$TMP/clone.err"; then
    cat "$TMP/clone.err" >&2
    echo "install.sh: could not clone $REPO@$REF over $TRANSPORT." >&2
    echo "install.sh: the repository is private. Log in with 'glab auth login' (HTTPS), register an SSH key on GitLab (SSH)," >&2
    echo "install.sh: or point PRAX_SKILLS_REPO at a URL or local path you can reach." >&2
    exit 1
  fi
  if ! run_git -C "$TMP/prax" sparse-checkout set --no-cone skills >/dev/null 2>"$TMP/sparse.err"; then
    cat "$TMP/sparse.err" >&2
    echo "install.sh: cloned $REPO@$REF but could not fetch its skills/ folder over $TRANSPORT (check repository access)." >&2
    exit 1
  fi
  SRC="$TMP/prax/skills"
  ORIGIN="$REPO@$REF over $TRANSPORT"
fi

mkdir -p "$DEST" "$CLAUDE_DIR" "$GEMINI_DIR"
for s in $SKILLS; do
  [ -f "$SRC/$s/SKILL.md" ] || { echo "install.sh: $s not found in $SRC" >&2; exit 1; }
  rm -rf "$DEST/$s"
  cp -R "$SRC/$s" "$DEST/$s"
  chmod +x "$DEST/$s"/scripts/*.mjs
  # Claude Code and Antigravity follow a symlinked skill folder; keep one real copy.
  if [ -e "$CLAUDE_DIR/$s" ] && [ ! -L "$CLAUDE_DIR/$s" ]; then
    echo "install.sh: $CLAUDE_DIR/$s exists and is not a symlink — left unchanged" >&2
  else
    ln -sfn "$DEST/$s" "$CLAUDE_DIR/$s"
  fi
  if [ -e "$GEMINI_DIR/$s" ] && [ ! -L "$GEMINI_DIR/$s" ]; then
    echo "install.sh: $GEMINI_DIR/$s exists and is not a symlink — left unchanged" >&2
  else
    ln -sfn "$DEST/$s" "$GEMINI_DIR/$s"
  fi
  echo "installed $s -> $DEST/$s (linked from $CLAUDE_DIR/$s and $GEMINI_DIR/$s)"
done

echo "Prax skills installed from $ORIGIN."

if [ "$CLI" = 1 ] || [ "$MCP" = 1 ]; then
  if [ -z "$APP_DIR" ]; then
    echo "install.sh: --cli and --mcp need the app payload (cli/ and mcp/ next to skills/): run this installer from the Prax app bundle or a checkout." >&2
    exit 1
  fi
  RUNTIME="$(runtime_for_app)"
fi

if [ "$CLI" = 1 ]; then
  if [ -f "$BIN_DIR/prax" ] && ! grep -qF "$SHIM_MARK" "$BIN_DIR/prax"; then
    echo "install.sh: $BIN_DIR/prax exists and is not the installer's shim — left unchanged" >&2
  else
    mkdir -p "$BIN_DIR"
    {
      echo '#!/bin/sh'
      echo "$SHIM_MARK"
      echo "exec \"$RUNTIME\" \"$APP_DIR/cli/prax.js\" \"\$@\""
    } > "$BIN_DIR/prax"
    chmod +x "$BIN_DIR/prax"
    echo "installed $BIN_DIR/prax -> $RUNTIME $APP_DIR/cli/prax.js"
    case ":$PATH:" in
      *":$BIN_DIR:"*) ;;
      *) echo "add $BIN_DIR to your PATH to use it as \`prax\`" ;;
    esac
  fi
fi

# What form the instruction block teaches: `prax` only when this machine really
# has the installer's shim AND resolves it on PATH, so every command the block
# writes is one that runs here. Anything else keeps the skill scripts' absolute
# paths, which need nothing but Node.
CLI_FORM=0
if [ -f "$BIN_DIR/prax" ] && grep -qF "$SHIM_MARK" "$BIN_DIR/prax"; then
  case ":$PATH:" in *":$BIN_DIR:"*) CLI_FORM=1 ;; esac
fi

if [ "$INSTRUCTIONS" = 1 ]; then
  for f in "$CLAUDE_MD" "$CODEX_MD" "$COPILOT_MD" "$GEMINI_MD"; do write_instructions "$f"; done
  # Copilot only reads a custom-instructions directory it has been told about.
  case ",${COPILOT_CUSTOM_INSTRUCTIONS_DIRS:-}," in
    *",$COPILOT_DIR,"*) echo "Copilot CLI: COPILOT_CUSTOM_INSTRUCTIONS_DIRS already names $COPILOT_DIR" ;;
    ",,") echo "Copilot CLI reads that file only when your shell profile exports: export COPILOT_CUSTOM_INSTRUCTIONS_DIRS=\"$COPILOT_DIR\"" ;;
    *) echo "Copilot CLI: append $COPILOT_DIR to COPILOT_CUSTOM_INSTRUCTIONS_DIRS (comma-separated) in your shell profile" ;;
  esac
  if [ "$CLI_FORM" = 1 ]; then
    echo "instructions use the \`prax\` command (the shim in $BIN_DIR)."
  elif [ "$CLI" = 1 ]; then
    echo "instructions use the skill scripts: $BIN_DIR is not on PATH, so \`prax\` would not resolve there."
    echo "  add $BIN_DIR to your PATH, then re-run with --instructions to refresh the block."
  fi
  echo "Antigravity: global instructions written to $GEMINI_MD; workspace AGENTS.md or GEMINI.md can add project guidance."
fi

if [ "$MCP" = 1 ]; then
  echo "MCP (optional — the skills do not need it; registers the app's full task/library tool tree):"
  echo "  claude mcp add prax -- \"$RUNTIME\" \"$APP_DIR/mcp/server.js\""
  echo "  codex mcp add prax -- \"$RUNTIME\" \"$APP_DIR/mcp/server.js\""
  echo "  copilot mcp add prax -- \"$RUNTIME\" \"$APP_DIR/mcp/server.js\""
  echo "  agy mcp add prax \"$RUNTIME\" \"$APP_DIR/mcp/server.js\""
  # No PRAX_API_URL is needed: the MCP server finds the app like the CLI does.
  echo "  It finds the running app like the prax CLI: PRAX_API_URL if set, else the desktop app's saved port, else http://127.0.0.1:3000."
fi

if [ "$CLI_FORM" = 1 ]; then
  echo "Check: prax recall --recent 3"
else
  echo "Check: node \"$DEST/prax-recall/scripts/recall.mjs\" --recent 3"
fi
