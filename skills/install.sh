#!/usr/bin/env sh
# Install (or remove) the Prax memory skills for Claude Code and Codex without
# keeping a checkout of the repository. Fetches only the skills/ folder into a
# temporary clone, copies the skills to $PRAX_SKILLS_DIR (default
# ~/.agents/skills, read by Codex), links them into $PRAX_CLAUDE_SKILLS_DIR
# (default ~/.claude/skills, read by Claude Code) and deletes the clone.
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
# PRAX_SKILLS_DIR (real copies), PRAX_CLAUDE_SKILLS_DIR (Claude Code links).
set -eu

REF="${PRAX_SKILLS_REF:-main}"
DEST="${PRAX_SKILLS_DIR:-$HOME/.agents/skills}"
CLAUDE_DIR="${PRAX_CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
SKILLS="prax-recall prax-remember"
HTTPS_REPO="https://gitlab.com/markjoyeuxcom/apps/prax.git"
SSH_REPO="git@gitlab.com:markjoyeuxcom/apps/prax.git"
MIN_NODE_MAJOR=20

if [ "${1:-}" = "--uninstall" ]; then
  for s in $SKILLS; do
    rm -rf "$DEST/$s"
    [ -L "$CLAUDE_DIR/$s" ] && rm -f "$CLAUDE_DIR/$s"
    echo "removed $s"
  done
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

mkdir -p "$DEST" "$CLAUDE_DIR"
for s in $SKILLS; do
  [ -f "$TMP/prax/skills/$s/SKILL.md" ] || { echo "install.sh: $s not found at $REF" >&2; exit 1; }
  rm -rf "$DEST/$s"
  cp -R "$TMP/prax/skills/$s" "$DEST/$s"
  chmod +x "$DEST/$s"/scripts/*.mjs
  # Claude Code follows a symlinked skill folder; keep one real copy.
  if [ -e "$CLAUDE_DIR/$s" ] && [ ! -L "$CLAUDE_DIR/$s" ]; then
    echo "install.sh: $CLAUDE_DIR/$s exists and is not a symlink — left unchanged" >&2
  else
    ln -sfn "$DEST/$s" "$CLAUDE_DIR/$s"
  fi
  echo "installed $s -> $DEST/$s (linked from $CLAUDE_DIR/$s)"
done

echo "Prax skills installed from $REPO@$REF over $TRANSPORT."
echo "Check: node \"$DEST/prax-recall/scripts/recall.mjs\" --recent 3"
