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
# repository: an account with access, via gh login or an SSH key):
#
#   gh api -H "Accept: application/vnd.github.raw" repos/markjoyeuxcom/prax/contents/skills/install.sh | sh
#   gh api -H "Accept: application/vnd.github.raw" repos/markjoyeuxcom/prax/contents/skills/install.sh | sh -s -- --uninstall
#
# Transport for the clone: an explicit PRAX_SKILLS_REPO (git URL or local path)
# is used as given. Otherwise, when the GitHub CLI is logged in, the clone goes
# over HTTPS with gh's credential helper for this one command (no git config
# is changed); without gh it falls back to SSH. PRAX_SKILLS_SOURCE=clone forces
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
# --library-block compiles the verified decisions and conventions of the
# `memory` project (PRAX_LIBRARY_BLOCK_PROJECT) into the same four instruction
# files, in a second marked block of its own (`prax mirror --agents-block`).
# It runs the payload's CLI, so it needs cli/ beside the pack and a running app;
# an unreachable app is reported and leaves the files as they were.
# --hooks adds two hooks, both on the payload's CLI and runtime, to each agent
# CLI that has hooks: session-start recall (`prax session-start --hook <vendor>`,
# which prints a budgeted briefing and the since-last-session delta as context)
# and session harvesting (`prax harvest --hook <vendor>`):
#   Claude Code  SessionStart + Stop in $PRAX_CLAUDE_SETTINGS (default ~/.claude/settings.json)
#   Codex        SessionStart + Stop in $PRAX_CODEX_HOOKS (default ${CODEX_HOME:-~/.codex}/hooks.json)
#   Copilot CLI  sessionStart + agentStop in $PRAX_COPILOT_HOOKS_DIR/prax-harvest.json
#                (default ${COPILOT_HOME:-~/.copilot}/hooks), a file the installer owns
# Only Prax's own handlers are added, replaced or removed; every other setting
# and hook is kept. See the Prax Library documents "Prax design: session-start recall" and
# "Prax design: session harvesting".
# --uninstall removes the skills, their links, the instruction blocks (both
# kinds), the shim and the harvest hooks, and leaves everything else alone.
set -eu

REF="${PRAX_SKILLS_REF:-main}"
DEST="${PRAX_SKILLS_DIR:-$HOME/.agents/skills}"
CLAUDE_DIR="${PRAX_CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
GEMINI_DIR="${PRAX_GEMINI_SKILLS_DIR:-$HOME/.gemini/config/skills}"
BIN_DIR="${PRAX_BIN_DIR:-$HOME/.local/bin}"
SOURCE="${PRAX_SKILLS_SOURCE:-auto}"
CLI_FORM=0
SKILLS="prax-recall prax-remember"
HTTPS_REPO="https://github.com/markjoyeuxcom/prax.git"
SSH_REPO="git@github.com:markjoyeuxcom/prax.git"
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
# Session-harvesting hook files (see --hooks in the header).
CLAUDE_SETTINGS="${PRAX_CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
CODEX_HOOKS="${PRAX_CODEX_HOOKS:-${CODEX_HOME:-$HOME/.codex}/hooks.json}"
COPILOT_HOOKS_DIR="${PRAX_COPILOT_HOOKS_DIR:-${COPILOT_HOME:-$HOME/.copilot}/hooks}"
COPILOT_HOOKS="$COPILOT_HOOKS_DIR/prax-harvest.json"
HARVEST_FORM=0

LIBRARY_BLOCK_PROJECT="${PRAX_LIBRARY_BLOCK_PROJECT:-memory}"
LIBRARY_BLOCK_START='<!-- prax-library:start -->'

usage() {
  echo "usage: install.sh [--instructions] [--cli] [--mcp] [--library-block] [--hooks]   install/update the skills (plus the standing instructions, the prax shim, the MCP commands, the compiled verified-conventions block, the harvest hooks)"
  echo "       install.sh --uninstall                                                  remove the skills, their links, any instruction blocks, the shim and the harvest hooks"
}

UNINSTALL=0
INSTRUCTIONS=0
CLI=0
MCP=0
LIBRARY_BLOCK=0
HOOKS=0
for arg in "$@"; do
  case "$arg" in
    --library-block) LIBRARY_BLOCK=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --instructions) INSTRUCTIONS=1 ;;
    --cli) CLI=1 ;;
    --mcp) MCP=1 ;;
    --hooks) HOOKS=1 ;;
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
prax remember "<title>" --body "<body>" --project <slug> [--type decision|runbook|…] [--tag a,b] [--cite <path[:start[-end]]>]
prax remember "<title>" --body "<body>" --memory       # useful across projects; --help lists every flag
CMDS
  else
    cat <<'CMDS'
node "__SKILLS_DIR__/prax-remember/scripts/remember.mjs" "<title>" "<body>" --project <slug> [--type decision|runbook|…] [--tags a,b] [--cite <path[:start[-end]]>]
node "__SKILLS_DIR__/prax-remember/scripts/remember.mjs" "<title>" "<body>" --project memory   # useful across projects
CMDS
  fi
}

# Only the CLI has `used`; the skill scripts do not, so the script form says nothing.
used_note() {
  [ "$CLI_FORM" = 1 ] || return 0
  cat <<'NOTE'
When a hit informed your work, run `prax used <id>`: it is how Prax learns which memory answers
questions and which questions have no answer yet.

NOTE
}

# The CLI shim has an absolute fallback when the shell's PATH differs.
remember_note() {
  [ "$CLI_FORM" = 1 ] || return 0
  cat <<'NOTE'
If `prax` is not found, run it as `__BIN_DIR__/prax`.

NOTE
}

# Taught only when a harvest hook is installed on this machine (HARVEST_FORM),
# so an agent is never told a marker files anything when nothing harvests it.
harvest_note() {
  [ "$HARVEST_FORM" = 1 ] || return 0
  cat <<'NOTE'
**Propose what you are unsure of.** When a finding might be durable but you are not sure, start
a line of your reply with `Remember:` and one self-contained sentence; a hook on this machine
files it as an unverified Inbox candidate for review. Remember what you are sure of directly.
A session-start hook opens each session with a budgeted briefing and what changed since your
last session; still recall for the specific task.

NOTE
}

# The block every tool gets. Quoted heredocs: nothing expands, so the backticks
# stay literal Markdown and the paths are filled in by subst_paths.
instruction_block() {
  {
    cat <<'BLOCK'
## Long-term memory (Prax)

Prax is the shared, local-first long-term memory that every agent CLI on this machine reads
and writes. Use it in every project.

**Recall first.** Read the repository's startup guide and its Prax project overview when
available, then retrieve knowledge relevant to the task:

```bash
BLOCK
    recall_commands
    cat <<'BLOCK'
```

Each hit shows its project, trust (`verified by …` or `unverified`), age and author. Treat
unverified hits as leads, not gospel. A miss with an incomplete index needs a keyword or recent
check. If Prax is unreachable, say so and use repository documentation; never invent memory.

BLOCK
    used_note
    cat <<'BLOCK'
**File by subject.** Project knowledge (architecture, decisions, runbooks, findings) belongs in
that project's Library; the `memory` project holds preferences, conventions and procedures
useful across projects. Recall searches every project by default.

**Remember durable findings.** Persist what outlives this session (how a system works, a
decision or convention, a reusable runbook):

```bash
BLOCK
    remember_commands
    cat <<'BLOCK'
```

BLOCK
    remember_note
    harvest_note
    cat <<'BLOCK'
Re-remembering a title refines that memory in place. Use `--cite` for claims about specific
code (run it inside the checkout). Supersede obsolete guidance; agent-written memory stays
unverified until a person reviews it. Never persist secrets.
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
// Another managed block (the compiled prax-library block shares these files)
// inside ours or around it, or marker-shaped text in the new body, would let
// this edit replace or delete part of that block: refuse.
const anyMarker = /<!-- [a-z][a-z0-9-]*:(start|end) -->/;
const others = [...before.matchAll(/<!-- ([a-z][a-z0-9-]*):(start|end) -->/g)].filter((m) => m[1] !== 'prax-memory');
if (markers.length && (anyMarker.test(before.slice(a.index + start.length, b.index))
    || others.some((s) => s[2] === 'start' && s.index < a.index + start.length
      && others.some((e) => e[1] === s[1] && e[2] === 'end' && e.index >= b.index)))) {
  console.error(`The Prax instruction block in ${file} overlaps another managed block; file left unchanged`);
  process.exit(1);
}
if (mode === 'write' && anyMarker.test(body)) {
  console.error(`The new Prax instruction block holds marker-shaped text; ${file} left unchanged`);
  process.exit(1);
}
let after;
if (mode === 'remove') {
  // The block and its own line ending, plus the blank line the installer put
  // before it when a blank line or the end of the file follows (a block
  // written after this one starts with its own separator).
  const tail = b.index + end.length + (before[b.index + end.length] === '\n' ? 1 : 0);
  let head = before.slice(0, a.index);
  let rest = before.slice(tail);
  if (head.endsWith('\n\n') && (rest === '' || rest.startsWith('\n'))) head = head.slice(0, -1);
  else if (head === '' && rest.startsWith('\n')) rest = rest.slice(1);
  after = head + rest;
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

# ---- session-harvesting hooks (--hooks) ------------------------------------
# Kept apart from the instruction-block code above: these edit each agent
# CLI's own settings file, which holds far more than Prax's entry.
#
# Add, replace or remove only Prax's harvest handler in one vendor's hook
# settings. A handler is Prax's when its command runs `… prax(.js) harvest
# --hook <vendor>`; everything else in the file is kept in order. A symlinked
# file is edited at its target (the link stays a link) and keeps its mode; a
# new file is 0600. Invalid JSON, or a hooks value of the wrong shape, refuses
# the edit and leaves the file as it is. The write is atomic and is refused if
# the file changed while it was being edited. The Copilot file is the
# installer's own (hooks/prax-harvest.json): written whole, removed whole —
# but only when it holds Prax's command.
#   edit_hook_settings install <claude|codex|copilot> <file> <runtime> <cli>
#   edit_hook_settings remove  <claude|codex|copilot> <file>
edit_hook_settings() {
  node --input-type=module - "$@" <<'NODE'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const [mode, vendor, file, runtime, cli] = process.argv.slice(2);
const LABEL = {
  claude: 'Claude Code SessionStart + Stop', codex: 'Codex SessionStart + Stop', copilot: 'Copilot CLI sessionStart + agentStop',
}[vendor];
// Both of Prax's handlers: session-start recall and harvest.
const OURS = /prax(?:\.js)?'?\s+(?:harvest|session-start)\s+--hook(?:\s+|=)'?(?:claude|codex|copilot)\b/;
const isOurs = (handler) => Boolean(handler) && typeof handler === 'object'
  && [handler.command, handler.bash].some((c) => typeof c === 'string' && OURS.test(c));
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
if (mode === 'remove' && !existsSync(file)) process.exit(0);
const path = existsSync(file) ? realpathSync(file) : file;
const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
const refuse = (why) => { console.error(`install.sh: ${why} in ${file}; file left unchanged`); process.exit(1); };
// POSIX single quotes: literal under sh -c, and under shell-style splitting.
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const command = mode === 'install' ? `${quote(runtime)} ${quote(cli)} harvest --hook ${vendor}` : null;
const startCommand = mode === 'install' ? `${quote(runtime)} ${quote(cli)} session-start --hook ${vendor}` : null;
// Nothing of Prax's in the file: there is nothing to remove, whatever its shape.
if (mode === 'remove' && !OURS.test(before)) process.exit(0);

let after;
if (vendor === 'copilot') {
  if (before && !OURS.test(before)) refuse('a hook file that is not the installer\'s own');
  if (mode === 'remove') {
    if (before) { unlinkSync(path); console.log(`harvest hook removed: ${file}`); }
    process.exit(0);
  }
  // sessionStart: only its JSON `additionalContext` is consumed; 20 s because a
  // session-start hook delays the first response.
  after = `${JSON.stringify({ version: 1, hooks: {
    sessionStart: [{ type: 'command', bash: startCommand, timeoutSec: 20 }],
    agentStop: [{ type: 'command', bash: command, timeoutSec: 30 }],
  } }, null, 2)}\n`;
} else {
  let settings = {};
  if (before.trim()) {
    try { settings = JSON.parse(before); } catch { refuse('invalid JSON'); }
  }
  if (!plain(settings)) refuse('settings that are not a JSON object');
  if (settings.hooks !== undefined && !plain(settings.hooks)) refuse('a "hooks" value that is not an object');
  const hooks = settings.hooks || {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) refuse(`a hooks.${event} value that is not an array`);
  }
  // Remove every Prax handler (any event, so a moved event cannot leave a
  // stale copy behind), pruning only the containers that held nothing else.
  let removed = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = [];
    for (const group of groups) {
      if (!plain(group) || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const handlers = group.hooks.filter((h) => !isOurs(h));
      removed += group.hooks.length - handlers.length;
      if (handlers.length === group.hooks.length) kept.push(group);
      else if (handlers.length) kept.push({ ...group, hooks: handlers });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (mode === 'remove' && !removed) process.exit(0);
  if (mode === 'install') {
    // Synchronous on purpose: the handler hands off to a detached worker and
    // returns in tens of milliseconds, and an async handler was killed before
    // it could hand off when `claude -p` exited (verified 2026-09-23).
    hooks.Stop = [...(hooks.Stop || []), { hooks: [{ type: 'command', command, timeout: 30 }] }];
    // No matcher: startup, resume, clear and compact all lose the briefing
    // otherwise. The command fails open and holds its own 8 s deadline.
    hooks.SessionStart = [...(hooks.SessionStart || []), { hooks: [{ type: 'command', command: startCommand, timeout: 20 }] }];
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  after = `${JSON.stringify(settings, null, 2)}\n`;
}
if (after === before) { console.log(`Prax hooks already current in ${file} (${LABEL})`); process.exit(0); }
const temporary = `${path}.prax-tmp.${randomUUID()}`;
try {
  writeFileSync(temporary, after, { flag: 'wx', mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
  if ((existsSync(path) ? readFileSync(path, 'utf8') : '') !== before) throw new Error(`${file} changed during the update; left unchanged`);
  renameSync(temporary, path);
} finally {
  if (existsSync(temporary)) unlinkSync(temporary);
}
console.log(`Prax hooks ${mode === 'remove' ? 'removed from' : before ? 'updated in' : 'added in'} ${file} (${LABEL})`);
NODE
}

install_hooks() {
  for pair in "claude:$CLAUDE_SETTINGS" "codex:$CODEX_HOOKS" "copilot:$COPILOT_HOOKS"; do
    vendor="${pair%%:*}"
    file="${pair#*:}"
    mkdir -p "$(dirname "$file")"
    edit_hook_settings install "$vendor" "$file" "$RUNTIME" "$APP_DIR/cli/prax.js" || HOOK_FAILED=1
  done
  echo "Codex runs a new hook only after you trust it: open Codex, run /hooks and trust both Prax hooks."
  echo "Session start: each agent session opens with a budgeted Prax briefing and what changed since its last session."
  echo "Harvest: agents propose memories with 'Remember:' lines or prax-remember blocks; candidates land unverified in the Inbox."
}

# Without Node there is no safe edit, so a file that holds a Prax hook is left.
remove_hooks() {
  for pair in "claude:$CLAUDE_SETTINGS" "codex:$CODEX_HOOKS" "copilot:$COPILOT_HOOKS"; do
    vendor="${pair%%:*}"
    file="${pair#*:}"
    [ -e "$file" ] || continue
    if ! command -v node >/dev/null 2>&1; then
      if grep -qE '(harvest|session-start) --hook' "$file"; then
        echo "install.sh: node is needed to remove the Prax hooks from $file safely; left unchanged" >&2
        REMOVE_FAILED=1
      fi
      continue
    fi
    edit_hook_settings remove "$vendor" "$file" || REMOVE_FAILED=1
  done
}

# Whether any agent CLI on this machine runs the harvest hook.
harvest_hooks_present() {
  for file in "$CLAUDE_SETTINGS" "$CODEX_HOOKS" "$COPILOT_HOOKS"; do
    [ -f "$file" ] && grep -q 'harvest --hook' "$file" && return 0
  done
  return 1
}

# The shim is ours only if it carries the marker; a foreign `prax` is never touched.
remove_shim() {
  [ -f "$BIN_DIR/prax" ] || return 0
  grep -qF "$SHIM_MARK" "$BIN_DIR/prax" || return 0
  rm -f "$BIN_DIR/prax"
  echo "removed $BIN_DIR/prax"
}

# --library-block: the compiled block of verified conventions. The CLI owns
# compiling and the marked edit (cli/lib/managedBlock.js, the same routine as
# edit_instructions above, under its own prax-library markers), so these only
# run it. Compiling reads the running app; when it cannot, the files are left
# as they were and the install carries on.
write_library_blocks() {
  if [ -z "$APP_DIR" ]; then
    echo "install.sh: --library-block needs the app payload (cli/ next to skills/): run this installer from the Prax app bundle or a checkout." >&2
    exit 1
  fi
  runtime="$(runtime_for_app)"
  for f in "$CLAUDE_MD" "$CODEX_MD" "$COPILOT_MD" "$GEMINI_MD"; do
    mkdir -p "$(dirname "$f")"
    if ! "$runtime" "$APP_DIR/cli/prax.js" mirror --agents-block --project "$LIBRARY_BLOCK_PROJECT" --file "$f"; then
      echo "install.sh: could not compile the verified-conventions block from Prax (is the app running?); instruction files left unchanged." >&2
      return 0
    fi
  done
}

# Remove the compiled block. Without the payload's CLI there is no safe edit,
# so a file that holds one is reported and the run fails, as for the other block.
remove_library_block() {
  file="$1"
  [ -e "$file" ] || return 0
  grep -qF "$LIBRARY_BLOCK_START" "$file" || return 0
  runtime=""
  [ -n "$APP_DIR" ] && runtime="$(runtime_for_app)"
  if [ -z "$runtime" ]; then
    echo "install.sh: the compiled Prax block in $file needs the app payload's CLI to be removed safely; run --uninstall from the app bundle or a checkout. Left unchanged." >&2
    REMOVE_FAILED=1
    return 0
  fi
  "$runtime" "$APP_DIR/cli/prax.js" mirror --agents-block --remove --file "$file" || REMOVE_FAILED=1
}

if [ "$UNINSTALL" = 1 ]; then
  for s in $SKILLS; do
    rm -rf "$DEST/$s"
    [ -L "$CLAUDE_DIR/$s" ] && rm -f "$CLAUDE_DIR/$s"
    [ -L "$GEMINI_DIR/$s" ] && rm -f "$GEMINI_DIR/$s"
    echo "removed $s"
  done
  # The compiled block first: it was added after the skills' block, and
  # removing in reverse order also takes each block's separating blank line.
  for f in "$CLAUDE_MD" "$CODEX_MD" "$COPILOT_MD" "$GEMINI_MD"; do remove_library_block "$f"; done
  for f in "$CLAUDE_MD" "$CODEX_MD" "$COPILOT_MD" "$GEMINI_MD"; do remove_instructions "$f"; done
  remove_shim
  remove_hooks
  # A block that could not be removed safely is reported, and the run fails.
  if [ "$REMOVE_FAILED" = 1 ]; then
    echo "install.sh: some instruction blocks or harvest hooks were left in place; remove them by hand" >&2
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
  # Pick the repository and, for the gh path, a one-command credential helper.
  CREDENTIAL_ARGS=""
  if [ -n "${PRAX_SKILLS_REPO:-}" ]; then
    REPO="$PRAX_SKILLS_REPO"
    TRANSPORT="explicit"
  elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    REPO="$HTTPS_REPO"
    TRANSPORT="https (gh credentials)"
    CREDENTIAL_ARGS="yes"
  else
    REPO="$SSH_REPO"
    TRANSPORT="ssh"
  fi

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM

  # Every git command that may talk to the remote goes through here, so the gh
  # credential helper applies to the clone AND to the sparse checkout that
  # fetches the skills blobs afterwards (a blobless clone defers them). An empty
  # helper value resets git's inherited helper list; the next one is gh's.
  run_git() {
    if [ -n "$CREDENTIAL_ARGS" ]; then
      git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"
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
    echo "install.sh: the repository is private. Log in with 'gh auth login' (HTTPS), register an SSH key on GitHub (SSH)," >&2
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

if [ "$CLI" = 1 ] || [ "$MCP" = 1 ] || [ "$HOOKS" = 1 ]; then
  if [ -z "$APP_DIR" ]; then
    echo "install.sh: --cli and --mcp need the app payload (cli/ and mcp/ next to skills/), and so does --hooks: run this installer from the Prax app bundle or a checkout." >&2
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

HOOK_FAILED=0
if [ "$HOOKS" = 1 ]; then
  install_hooks
fi
# The standing block teaches the harvest markers only where a hook reads them.
if harvest_hooks_present; then HARVEST_FORM=1; fi

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

if [ "$LIBRARY_BLOCK" = 1 ]; then
  write_library_blocks
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

# A hook file that could not be edited safely was reported above; fail the run.
if [ "$HOOK_FAILED" = 1 ]; then
  echo "install.sh: some harvest hooks were not installed; fix the files named above and re-run with --hooks" >&2
  exit 1
fi
