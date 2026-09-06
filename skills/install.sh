#!/usr/bin/env sh
# Install (or remove) the Prax memory skills for Claude Code and Codex without
# keeping a checkout of the repository. Fetches only the skills/ folder into a
# temporary clone, copies the skills to $PRAX_SKILLS_DIR (default
# ~/.agents/skills, read by Codex), links them into ~/.claude/skills (read by
# Claude Code) and deletes the clone. Re-run to update.
#
#   curl -fsSL https://raw.githubusercontent.com/markjoyeuxcom/prax/main/skills/install.sh | sh
#   sh install.sh --uninstall
#
# Overrides: PRAX_SKILLS_REPO (git URL or local path), PRAX_SKILLS_REF (branch/tag),
# PRAX_SKILLS_DIR (destination for the real copies).
set -eu

REPO="${PRAX_SKILLS_REPO:-git@github.com:markjoyeuxcom/prax.git}"
REF="${PRAX_SKILLS_REF:-main}"
DEST="${PRAX_SKILLS_DIR:-$HOME/.agents/skills}"
CLAUDE_DIR="$HOME/.claude/skills"
SKILLS="prax-recall prax-remember"

if [ "${1:-}" = "--uninstall" ]; then
  for s in $SKILLS; do
    rm -rf "$DEST/$s"
    [ -L "$CLAUDE_DIR/$s" ] && rm -f "$CLAUDE_DIR/$s"
    echo "removed $s"
  done
  exit 0
fi

command -v git >/dev/null 2>&1 || { echo "install.sh: git is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "install.sh: node (20+) is required to run the skills" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

# A blobless sparse clone fetches the skills/ folder only. --no-local keeps the
# same code path for a local repository path (used by the self-test).
git clone --quiet --no-local --depth 1 --branch "$REF" --filter=blob:none --sparse "$REPO" "$TMP/prax" \
  || { echo "install.sh: could not clone $REPO@$REF (check repository access)" >&2; exit 1; }
git -C "$TMP/prax" sparse-checkout set --no-cone skills >/dev/null

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

echo "Prax skills installed from $REPO@$REF."
echo "Check: node \"$DEST/prax-recall/scripts/recall.mjs\" --recent 3"
