#!/usr/bin/env sh
# Install (or remove) the Prax memory skills for Claude Code, Codex, and Antigravity
# without keeping a checkout of the repository. Fetches only the skills/ folder into a
# temporary clone, copies the skills to $PRAX_SKILLS_DIR (default
# ~/.agents/skills, read by Codex), links them into $PRAX_CLAUDE_SKILLS_DIR
# (default ~/.claude/skills, read by Claude Code) and $PRAX_GEMINI_SKILLS_DIR
# (default ~/.gemini/config/skills, read by Antigravity) and deletes the clone.
# Re-run to update.
#
#   glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh
#   glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh -s -- --uninstall
#
# Transport: an explicit PRAX_SKILLS_REPO (git URL or local path) is used as
# given. Otherwise, when the GitLab CLI is logged in, the clone goes over HTTPS
# with glab's credential helper for this one command (no git config is changed);
# without glab it falls back to SSH, which needs a key registered on GitLab.
# The repository is private: the account must have been granted access.
#
# Overrides: PRAX_SKILLS_REPO, PRAX_SKILLS_REF (branch/tag, default main),
# PRAX_SKILLS_DIR (real copies), PRAX_CLAUDE_SKILLS_DIR (Claude Code links),
# PRAX_GEMINI_SKILLS_DIR (Antigravity links).
#
# --instructions additionally appends the standing "recall first / remember
# durable findings" rule — the thing that makes the skills fire reliably — to
# each tool's global instructions file, once, between marker comments:
#   Claude Code  $PRAX_CLAUDE_INSTRUCTIONS      (default ~/.claude/CLAUDE.md)
#   Codex        $PRAX_CODEX_INSTRUCTIONS       (default ~/.codex/AGENTS.md)
#   Copilot CLI  $PRAX_COPILOT_INSTRUCTIONS_DIR/AGENTS.md (default ~/.copilot/instructions),
#                which Copilot reads only when COPILOT_CUSTOM_INSTRUCTIONS_DIRS names
#                that directory — the installer prints the export line.
# Antigravity has no global instructions file (it reads AGENTS.md / GEMINI.md at
# the workspace root), so the installer prints what to paste there instead.
# --uninstall removes the blocks it added and leaves the rest of each file alone.
set -eu

REF="${PRAX_SKILLS_REF:-main}"
DEST="${PRAX_SKILLS_DIR:-$HOME/.agents/skills}"
CLAUDE_DIR="${PRAX_CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
GEMINI_DIR="${PRAX_GEMINI_SKILLS_DIR:-$HOME/.gemini/config/skills}"
SKILLS="prax-recall prax-remember"
HTTPS_REPO="https://gitlab.com/markjoyeuxcom/apps/prax.git"
SSH_REPO="git@gitlab.com:markjoyeuxcom/apps/prax.git"
MIN_NODE_MAJOR=20

# Standing-instruction files (see --instructions in the header).
CLAUDE_MD="${PRAX_CLAUDE_INSTRUCTIONS:-$HOME/.claude/CLAUDE.md}"
CODEX_MD="${PRAX_CODEX_INSTRUCTIONS:-$HOME/.codex/AGENTS.md}"
COPILOT_DIR="${PRAX_COPILOT_INSTRUCTIONS_DIR:-$HOME/.copilot/instructions}"
COPILOT_MD="$COPILOT_DIR/AGENTS.md"
BLOCK_START='<!-- prax-memory:start -->'
BLOCK_END='<!-- prax-memory:end -->'

usage() {
  echo "usage: install.sh [--instructions]   install/update the skills (and, with the flag, the standing instructions)"
  echo "       install.sh --uninstall         remove the skills, their links and any instruction blocks"
}

UNINSTALL=0
INSTRUCTIONS=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --instructions) INSTRUCTIONS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install.sh: unknown option $arg" >&2; usage >&2; exit 2 ;;
  esac
done

# The block every tool gets. Quoted heredoc: nothing expands, so the backticks
# are literal Markdown; the one substitution (the installed skills directory)
# is done by awk below with index/substr, so a path with & or | is safe.
instruction_block() {
  cat <<'BLOCK' | awk -v d="$DEST" '{ i = index($0, "__SKILLS_DIR__"); while (i) { $0 = substr($0, 1, i - 1) d substr($0, i + 14); i = index($0, "__SKILLS_DIR__") } } 1'
## Long-term memory (Prax)

Prax is the shared, local-first long-term memory for every agent CLI on this machine
(Claude Code, Codex, Copilot CLI and Antigravity all read and write the same library). Use it
in every project.

**Recall first.** Before starting a task, retrieve what is already known:

```bash
node "__SKILLS_DIR__/prax-recall/scripts/recall.mjs" "<what I'm about to work on>"
node "__SKILLS_DIR__/prax-recall/scripts/recall.mjs" --recent 5      # chronological list instead
```

Every hit says which project it lives in (`in homelab`), its trust (`verified by …` or
`unverified`), its age and who wrote it. Treat `unverified` hits as leads, not gospel; weigh a
months-old agent note accordingly. `No relevant memory found` means start fresh. `Prax not
reachable` means the app is not running — say so, never invent memory.

**Remember durable findings.** When you learn something that outlives this session — how a
system works, a decision or convention, a reusable runbook — persist it:

```bash
node "__SKILLS_DIR__/prax-remember/scripts/remember.mjs" "<title>" "<body>" [--type note|runbook|decision|known-issue|reference|post-mortem] [--tags a,b] [--ref <url>] [--cite <path[:start[-end]]>]
```

Re-running with the same title refines the memory in place; without `--project`, a title that
already lives in another project is refined there, never duplicated. Use `--cite` when the claim
is about specific code (run it from inside the checkout). Never persist secrets or
session-only state.
BLOCK
}

# Append the block to one file, once. An existing file keeps everything it had;
# a second run is a no-op (the start marker is the guard).
write_instructions() {
  file="$1"
  if [ -f "$file" ] && grep -qF "$BLOCK_START" "$file"; then
    echo "instructions already present in $file"
    return 0
  fi
  mkdir -p "$(dirname "$file")"
  if [ -s "$file" ]; then printf '\n' >> "$file"; fi
  { echo "$BLOCK_START"; instruction_block; echo "$BLOCK_END"; } >> "$file"
  echo "instructions added to $file"
}

# Remove exactly the marked block; the rest of the file is untouched.
remove_instructions() {
  file="$1"
  [ -f "$file" ] || return 0
  grep -qF "$BLOCK_START" "$file" || return 0
  tmp="$file.prax-tmp.$$"
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '$0 == s { skip = 1; next } $0 == e { skip = 0; next } !skip' "$file" > "$tmp"
  mv "$tmp" "$file"
  echo "instructions removed from $file"
}

if [ "$UNINSTALL" = 1 ]; then
  for s in $SKILLS; do
    rm -rf "$DEST/$s"
    [ -L "$CLAUDE_DIR/$s" ] && rm -f "$CLAUDE_DIR/$s"
    [ -L "$GEMINI_DIR/$s" ] && rm -f "$GEMINI_DIR/$s"
    echo "removed $s"
  done
  for f in "$CLAUDE_MD" "$CODEX_MD" "$COPILOT_MD"; do remove_instructions "$f"; done
  exit 0
fi

command -v git >/dev/null 2>&1 || { echo "install.sh: git is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "install.sh: node ($MIN_NODE_MAJOR+) is required to run the skills" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  echo "install.sh: Node $MIN_NODE_MAJOR or newer is required to run the skills (found $(node --version 2>/dev/null || echo none))" >&2
  exit 1
fi

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

mkdir -p "$DEST" "$CLAUDE_DIR" "$GEMINI_DIR"
for s in $SKILLS; do
  [ -f "$TMP/prax/skills/$s/SKILL.md" ] || { echo "install.sh: $s not found at $REF" >&2; exit 1; }
  rm -rf "$DEST/$s"
  cp -R "$TMP/prax/skills/$s" "$DEST/$s"
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

echo "Prax skills installed from $REPO@$REF over $TRANSPORT."

if [ "$INSTRUCTIONS" = 1 ]; then
  for f in "$CLAUDE_MD" "$CODEX_MD" "$COPILOT_MD"; do write_instructions "$f"; done
  # Copilot only reads a custom-instructions directory it has been told about.
  case ",${COPILOT_CUSTOM_INSTRUCTIONS_DIRS:-}," in
    *",$COPILOT_DIR,"*) echo "Copilot CLI: COPILOT_CUSTOM_INSTRUCTIONS_DIRS already names $COPILOT_DIR" ;;
    ",,") echo "Copilot CLI reads that file only when your shell profile exports: export COPILOT_CUSTOM_INSTRUCTIONS_DIRS=\"$COPILOT_DIR\"" ;;
    *) echo "Copilot CLI: append $COPILOT_DIR to COPILOT_CUSTOM_INSTRUCTIONS_DIRS (comma-separated) in your shell profile" ;;
  esac
  echo "Antigravity has no global instructions file: paste the block from $CLAUDE_MD into each workspace's AGENTS.md or GEMINI.md."
fi

echo "Check: node \"$DEST/prax-recall/scripts/recall.mjs\" --recent 3"
