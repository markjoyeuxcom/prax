# Session-start recall

**Date:** 2026-10-11 · **Status:** adopted, implemented with this note · **Builds on:**
[session harvesting](session-harvesting.md) (the hook installer and vendor contracts) and
[budgeted context and brief](budgeted-context-and-brief.md) (the fill order and the
since-last-session delta). Tracked in the Prax task "Close the memory loop" (eac561f5).

## Problem

Recall depended on the agent obeying a paragraph in its global instructions. Measured on one
machine on 2026-10-11: 77 recall queries, 0 `prax used` signals, the since-last-session marker
never set, and the only installed hook was the harvest hook on Stop. The loop was open at both
ends: nothing recalled at session start, and nothing told the librarian which hits mattered.

## Design

### A. A read-only SessionStart hook

`prax session-start --hook <vendor>` is the hook entry point for Claude Code, Codex and
Copilot CLI. It reads the vendor's hook JSON on stdin (bounded in size and time, as the harvest
hook does), finds the project from the hook's `cwd` (marker file, then the registered repo URL,
then the folder name), and prints one block of additional context:

1. `prax context --budget <n>` for that project (default 1200 tokens), so the verified and
   cited memory that the fill order ranks first is in the conversation before the first prompt;
2. `prax recall --since-last-session` for the vendor's agent id (default 400 tokens), and the
   marker is advanced only when the whole delta was printed, exactly as the command does;
3. two lines that name `prax used <id>` and `prax remember`, so the agent knows how to close
   the loop without rereading its instructions.

The block is wrapped in the envelope each vendor consumes: Claude Code and Codex read
`{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "…"}}`, Copilot
CLI reads `{"additionalContext": "…"}` and ignores everything else. Claude Code caps a context
string at 10,000 characters, so the default budgets keep the block near 6,400 characters.

**Fail open, always.** Prax not running, no project, the delta unsupported, a slow request:
the command prints nothing and exits 0. It holds one deadline (`PRAX_SESSION_START_MS`, default
8 s) over the whole run and per-request timeouts of 5 s, because SessionStart hooks delay the
first response. It never writes memory; advancing the delta marker is the only state it touches,
and that is the marker the delta command itself advances.

The agent id is the vendor name unless `PRAX_AGENT` or `--agent` says otherwise, so the delta
and the recall telemetry are attributed the same way the harvest hook's candidates are.

### Vendor contracts

Each claim is **documented** (the vendor's published reference, read 2026-10-11) unless marked
**verified** (a live run).

- **Claude Code.** `hooks.SessionStart` in `~/.claude/settings.json`, matcher groups
  `{ matcher?, hooks: [{ type: "command", command, timeout? }] }`; without a matcher the hook runs
  for `startup`, `resume`, `clear`, `compact` and `fork`. Stdin: `session_id`,
  `transcript_path`, `cwd`, `hook_event_name: "SessionStart"`, `source`. Plain stdout or the
  `hookSpecificOutput.additionalContext` JSON is added to the conversation before the first
  prompt; each string is capped at 10,000 characters. Exit 2 shows stderr to the person and the
  session proceeds; other non-zero exits are non-blocking; the default timeout is 600 s and the
  installer sets 20 s. SessionStart cannot block.
- **Codex CLI.** `hooks.SessionStart` in `~/.codex/hooks.json`, the same group and handler
  shape, matcher values `startup`, `resume`, `clear`, `compact`. Stdin: `session_id`,
  `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `source`. Plain stdout
  or `hookSpecificOutput.additionalContext` becomes developer context. Hooks are on by default
  and a non-managed hook runs only after the person trusts it in `/hooks`; the installer says so.
- **Copilot CLI.** `hooks.sessionStart` in a file under `~/.copilot/hooks/`, handlers
  `{ type: "command", bash, timeoutSec }`. Stdin: `sessionId`, `timestamp`, `cwd`, `source`
  (`startup`, `resume`, `new`), optional `initialPrompt`. Only `additionalContext` in the hook's
  JSON output is consumed; several hooks are joined with blank lines; non-zero exits and
  timeouts fail open.
- **Antigravity.** No hooks. The standing instruction block remains the only prompt to recall.

### B. Teach the used signal

`prax used <id>` existed but nothing taught it. Now:

- the standing instruction block (`skills/install.sh --instructions`, CLI form) says: when a
  hit informed the work, run `prax used <id>`;
- the recall skill's SKILL.md says the same under "Reading the output";
- `prax recall` ends a hit block with the command, naming the top hit's id;
- the session-start block carries the same line.

The script form of the block (no `prax` shim on PATH) does not mention it, because the skill
scripts have no `used` entry point; the block never teaches a command the machine cannot run.

### C. Repo URL drift in `prax doctor`

A project whose registered repo URL no longer matches the checkout's `origin` silently loses
remote-based project detection and makes every `--cite` claim report "cited in another
repository", so `prax check` never finds drift. `prax doctor` now adds a local check,
`repo-url`, computed in the CLI from `detectRepoUrl` and the project list:

- `warn` when the project detected for the current directory has a registered repo URL that does
  not normalise to the origin; the message names both and the fix (`prax init` after confirming
  the move);
- `info` when the origin matches no registered project at all (the detected project has none);
- absent outside a repository.

It is a CLI-side check because only the CLI can see the checkout; the server report is unchanged.

## Out of scope

Contradiction detection between a verified document and a newer unverified decision stays with
the librarian's near-duplicate clusters and human triage; the fill order deliberately trusts
verification. A UserPromptSubmit hook is unnecessary while every vendor's SessionStart carries
context. A SessionStart hook for Antigravity waits for Antigravity to have hooks.
