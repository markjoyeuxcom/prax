# Session harvesting

Scope: agents miss durable findings because remembering takes a deliberate command while the
agent is busy with other work. Session harvesting gives an agent a cheap way to propose a
memory: it writes a marker line or block in its reply, and a hook files the proposal as an
unverified candidate in the **Inbox**, where a person accepts, refiles or archives it. Tracked in
the Prax task "Session harvesting: agent CLI hooks propose memories into Inbox" (3b804611).

A harvested candidate is not a memory. It is an unverified proposal that a person reviews
before it moves to its owning project. The agent still runs `remember` for findings it is sure
of.

## Vendor hook contracts

Each claim below is marked **verified**, **documented** or **assumed**. **Verified** means a
live run of the installed CLI on 2026-09-23 captured the hook's stdin. The probes used
throwaway settings passed with `--settings`/`-c` or a temporary repository and never edited
`~/.claude`, `~/.codex` or `~/.copilot`. **Documented** means the vendor's current published
reference says so but no live run checked it. **Assumed** means a design choice that neither
source confirms.

### Claude Code 2.1.280

- **Where:** `hooks` in `~/.claude/settings.json`. Structure: event, then an array of matcher
  groups `{ matcher?, hooks: [handler] }`, then handlers `{ type: "command", command, timeout?,
  async? }`. The shell form (no `args`) runs `command` through `sh -c` on macOS/Linux.
  *(documented: code.claude.com/docs/en/hooks)*
- **Stop** fires once per turn when Claude finishes responding. Stdin contains `session_id`,
  `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name: "Stop"`,
  `stop_hook_active` and `last_assistant_message`, which holds the turn's final text.
  *(verified with `claude -p --settings`)*
- **`async: true` is not used.** With `claude -p`, an async Stop handler that has to start Node
  was ended before it could hand off its input, and no candidate arrived. The same command as a
  synchronous handler filed its candidate. Handing off takes about 30 ms, so the synchronous
  handler costs the turn almost nothing. *(verified, 2026-09-23)*
- **SessionEnd** stdin contains `session_id`, `transcript_path`, `cwd`, `hook_event_name` and
  `reason`. *(verified)* All SessionEnd hooks share a 1.5 s budget, which can be raised to at
  most 60 s. *(documented)*
- **Exit codes:** exit 2 on Stop **blocks the stop** and makes Claude continue. Any other
  non-zero exit is a non-blocking error notice. Plain stdout from a Stop hook can reach the
  model as context. *(documented)* The hook therefore always exits 0 and prints nothing.
- **Transcript:** JSONL. Assistant records are `{ type: "assistant", isSidechain,
  message: { role: "assistant", content: [{ type: "text", text }] } }`. *(verified, local
  transcripts)* The transcript is written asynchronously and may not yet contain the current
  turn's last messages when a hook fires. *(documented)* This is why `last_assistant_message`
  is also harvested.

### Codex CLI 0.155.1

- **Where:** `~/.codex/hooks.json` (or `[hooks]` tables in `config.toml`, plus repository-level
  copies). The JSON schema is the same event → matcher-group → handler shape as Claude Code:
  `{ type: "command", command, timeout?, async? }`. *(documented: learn.chatgpt.com/docs/hooks;
  the binary contains the `hooks.json` name and the event list)*
- **Stop** stdin contains `session_id`, `turn_id`, `transcript_path`, `cwd`,
  `hook_event_name: "Stop"`, `model`, `permission_mode`, `stop_hook_active` and
  `last_assistant_message`. **SessionEnd** contains `session_id`, `transcript_path`, `cwd`,
  `hook_event_name` and `reason: "other"`. *(verified with `codex exec -c hooks.Stop=…
  --dangerously-bypass-hook-trust`)*
- **Timeouts:** 600 s by default. SessionEnd defaults to 1 s with a 3 s maximum and always runs
  synchronously. `async: true` runs other hooks in the background, with at most 8 at once.
  *(documented)*
- **Trust:** Codex runs a non-managed hook only after the person reviews and trusts that exact
  definition with `/hooks`. The trust is recorded against the hook's hash. Hooks can be
  disabled with `[features] hooks = false`. *(documented)* After installation, the person must
  trust the hook once, and the installer says so.
- **Exit codes:** exit 2 or `decision: "block"` on Stop makes Codex continue. *(documented)*
  The hook always exits 0 and prints nothing.
- **Transcript:** rollout JSONL. Assistant text appears as `{ type: "response_item", payload:
  { type: "message", role: "assistant", content: [{ type: "output_text", text }] } }`, and
  also as `event_msg` / `agent_message` in some sessions. *(verified, local rollouts)*
- **Shell:** the documentation does not say whether `command` runs through a shell. A
  `sh <script> <arg>` command worked in the probe. *(assumed: the POSIX single quotes the
  installer writes also survive shell-style argument splitting)*

### GitHub Copilot CLI 1.0.85

- **Where:** user-level hook files in `~/.copilot/hooks/*.json` (or `$COPILOT_HOME/hooks`), the
  `hooks` key in `~/.copilot/config.json`/`settings.json`, and repository-level
  `.github/hooks/*.json`. File schema: `{ version: 1, hooks: { <event>: [ { type: "command",
  bash, powershell?, timeoutSec?, cwd?, env? } ] } }`. *(documented: docs.github.com, Copilot
  hooks reference; `copilot help config` confirms `hooks` uses "the same schema as
  .github/hooks/*.json")* The user-level directory is **documented**. The live probe used a
  repository-level file.
- **agentStop** stdin contains `sessionId`, `timestamp`, `cwd`, `transcriptPath`,
  `stopReason: "end_turn"` and `stop_hook_active`. There is no last-message field. The
  transcript (`~/.copilot/session-state/<id>/events.jsonl`) already contained the turn's
  `assistant.message` when the hook ran. **sessionEnd** stdin contains `sessionId`,
  `timestamp`, `cwd` and `reason` (`"complete"`, …), with no transcript path. *(verified)*
- **Exit codes and timeouts:** a non-zero exit or a timeout fails open. agentStop output is
  parsed. Hooks have no async option, so a slow hook delays the agent. *(documented)*
- **Transcript:** JSONL of `{ type: "assistant.message", data: { content } }` events.
  *(verified)*

### Antigravity (`agy`)

`agy --help` lists no hook mechanism. **Gap:** nothing runs automatically. The fallback is
`prax harvest --transcript <file>`, which the person or the agent runs on an exported
conversation. It reads the file as plain text.

### Fallback for every vendor

`prax harvest --transcript <file>` accepts any of the three JSONL formats above or a plain-text
file. `prax harvest` with no file reads hook JSON or a transcript from stdin. The fallback works
for a vendor without hooks, a hook that was not trusted, and a re-run after Prax was down.

## Candidate extraction: deterministic first

Candidates come **only from text the agent wrote**: Claude `assistant` text blocks outside
sidechains, Codex assistant `output_text` and `agent_message`, Copilot `assistant.message`, and
the hook's `last_assistant_message`. User messages, tool calls, tool results and system text
are never scanned. If a web page or a file an agent read contains "Remember: …", that text
cannot become a candidate unless the agent repeats it in its own reply.

The agent marks a proposal in one of two ways:

- **Marker line.** Outside any code fence, a line that starts with `Remember:` (optionally
  after a `-`, `*` or `+` bullet, and optionally bolded as `**Remember:**`). The line's text is
  the body. The title is its first sentence, capped at 100 characters on a word boundary.
  Text under 12 characters is ignored.
- **Structured block.** A fenced block with the info string `prax-remember`. Its header is
  `key: value` lines (`title` required; `type`, `project` and `tags` optional), followed by a
  blank line and the body:

  ````markdown
  ```prax-remember
  title: Release tags are cut from main only
  type: decision
  project: prax
  tags: release

  Tags are cut from main after the squash-merge. A tag on a feature branch breaks the
  desktop updater's feed.
  ```
  ````

Lines inside any other code fence are ignored, so an agent that quotes the syntax as an
example does not create a candidate. Each run has these limits:

- at most 20 candidates;
- titles of at most 200 characters;
- bodies of at most 8,000 characters. A longer body is skipped with a message to use
  `prax remember` instead.

A candidate that looks like it contains a credential is **skipped**: a private-key block, an
AWS access key id (`AKIA`/`ASIA`), or a GitHub, GitLab, Slack, OpenAI or Anthropic token prefix.
The shapes live in `server/secretPatterns.js`, shared with recall telemetry's query redaction. Memory never
persists secrets. Within one run, candidates are de-duplicated by content hash and by
normalised title.

**Model summarisation is not built.** It could extract findings from an entire session, but it
has four costs:

1. it spends a chat-model call on every turn, or at session end, when time is shortest;
2. it sends the whole transcript to a provider, including tool output the agent read;
3. its output is the model's paraphrase, which a person must check against the session;
4. most importantly, it turns untrusted tool output into proposed memory. A transcript full of
   fetched web pages is a prompt-injection surface that the marker rule avoids by construction.

If summarisation is added later, it should be an explicit opt-in (`--summarise`) that uses the
configured chat backend and runs off the hook path. Its output would carry the same Inbox,
unverified and harvested stamps and a `summarised` tag.

## The candidate document

Each candidate is created through `POST /api/library/documents` with:

- `project: "inbox"`, the protected system project, which always exists;
- `kind: "synthesized"`, the agent stamps (`x-prax-origin: agent`, and `x-prax-agent` from the
  hook vendor or the usual detection) and no verification, so it is **unverified**;
- `documentType` set to the marker's `type` when that type is valid, otherwise `note`;
- `tags`: `harvested`, followed by the marker's tags.

The body starts with the proposed memory text, because the Inbox preview shows the first 240
characters. A `Harvest details` section follows a rule and lists:

- the suggested owning project, from the marker's `project:`, then the session directory's
  `.prax/project.json`, then its repository's name. A plain folder name outside a repository
  is too weak a guess, so none is shown;
- the suggested type and any unrecognised type;
- the source vendor, session id, hook event and transcript path;
- **similar active memories**: up to three hits from a cross-project recall (hybrid semantic,
  or keyword when semantic search is not configured) on the candidate's title and body, each
  with project, type, trust and id. If recall fails, the section says that similar memories
  were not checked and gives the reason.

Harvested candidates are active documents in Inbox, but they are **not recalled until a person
reviews them** (decided after Agy's review of 2026-09-23; this closes the earlier open question).
A document that is unverified and tagged `harvested` is left out of every default agent-facing
retrieval, server-side (`server/harvestedCandidates.js`), so the CLI, the skills, the MCP server
and the in-app assistant all get the same rule:

- semantic and hybrid search, keyword search (`GET /api/library/documents?q=`), both context
  packs, Ask, similar documents, task-related documents and the memory-changes delta. Ranked
  routes rank and cut off as if the candidates were absent. The delta filters in SQL, so its
  paging and `until` are unaffected;
- `prax recall --recent` reads the plain listing and applies the same rule client-side.

The opt-in is explicit: `includeHarvested=true` on the routes, `--include-harvested` on `prax
recall`, `search`, `context` and `brief` and on the recall skill, `includeHarvested: true` on the
MCP `search_documents`, `search_documents_semantic` and `ask_library` tools. Every result that
hid a candidate says how many (`hiddenHarvested`, a header on array routes, a line in the text
output), so a thin or empty answer is not mistaken for a complete one (QINV-08).

Not filtered: plain listings without a query (the Inbox, triage, the harvester's own title
dedupe), `GET /api/library/documents/:id`, and the web UI's Library, Library search, similar
documents and task-drawer suggestions, which opt in because a person is reading them. The
app's Ask does not ground an answer on candidates and says so. The harvester's own "similar
active memories" check opts in, so a near-duplicate proposal is shown to the person triaging.

A candidate that a person verifies, or refiles without the `harvested` tag, is an ordinary
document: recalled normally, and reported by the next delta as `verified` or `updated`. If an
agent later edits a verified candidate that still carries the tag, the edit revokes the
verification and the document is hidden again until it is re-reviewed.

## Exactly once: operation ids from the session and the candidate

`hash = sha256(normalised title + "\n" + normalised body)`. The document id and the operation id
are UUIDs (version-5 layout) derived from `sha256("prax-harvest:doc|op:" + sessionId + ":" +
hash)`. The session id comes from the hook input, then the transcript's own session record,
then `--session`, then a hash of the transcript's absolute path.

For each candidate:

1. `GET /api/library/documents/<derived id>`. If the document exists, archived or not, the
   candidate is **already proposed** and nothing is sent. This makes a per-turn re-run cost one
   read per candidate. It sends no write and runs no recall.
2. **Title dedupe:** an active document in any project with the same normalised title (trimmed,
   whitespace collapsed, case-insensitive) makes the candidate **skipped**, and the output names
   the existing document. A candidate never overwrites a memory, so harvesting does not use
   upsert-by-title. The active listing is fetched once per run, and only when there is a
   candidate to create.
3. Recall for similar memories, then `POST /api/library/documents` with the derived `id` and
   `operationId`. The server's receipt makes a lost response safe to retry: an identical replay
   returns `200 replayed`. A replay with a different body (similar memories changed between
   runs) is `409`, and one after a permanent delete is `410`. Both mean the candidate was
   proposed before, and both are reported as such. **Nothing is ever created twice, and a
   candidate that a person deleted is never recreated.**

No migration is needed. The existing receipt-backed create route (`createDocumentExactlyOnce`)
provides all of this.

## Time budget and failing open

- `--hook <claude|codex|copilot>` is the hook entry point. It reads stdin (at most 8 MB, 2 s),
  writes it to a private temporary file (a `0700` directory, removed by the worker) and starts a
  **detached background worker**. It then exits 0 with no output, usually within a node start.
  The agent's turn and exit never wait on Prax, the network or the embedding model. This also
  avoids the 1–3 s SessionEnd caps and Copilot's synchronous hooks. `--foreground` runs the work
  inline, for tests and debugging.
- The worker has a hard budget (`--budget-ms`, default 20,000). No single request may outlast
  the budget. When the budget expires, the run stops and reports what it did. A create that was
  in flight may still commit, and the next run replays it through its receipt.
- In hook mode every failure stays in the worker and ends with exit 0: bad stdin, an unreadable
  transcript, an unreachable server, a timeout or an HTTP error. A diagnostic line goes to
  `PRAX_HARVEST_LOG` when it is set. A manual run reports failures and exits 1.
- **Idle cost.** A turn with no markers makes no network request. A turn whose markers were
  already harvested makes one `GET` per candidate.

## Installation (`skills/install.sh --hooks`)

`--hooks` needs the app payload (bundle or checkout), as `--cli` does. The hook command runs
`'<runtime>' '<app>/cli/prax.js' harvest --hook <vendor>` with POSIX single quotes. It uses the
same runtime as the shim, so it does not depend on the agent's `PATH`.

| Vendor | File | Entry |
|---|---|---|
| Claude Code | `$PRAX_CLAUDE_SETTINGS` (default `~/.claude/settings.json`) | `hooks.Stop[] += { hooks: [{ type: "command", command, timeout: 30 }] }` |
| Codex | `$PRAX_CODEX_HOOKS` (default `${CODEX_HOME:-~/.codex}/hooks.json`) | same shape under `hooks.Stop` |
| Copilot CLI | `$PRAX_COPILOT_HOOKS_DIR/prax-harvest.json` (default `${COPILOT_HOME:-~/.copilot}/hooks`) | an installer-owned file: `{ version: 1, hooks: { agentStop: [{ type: "command", bash: command, timeoutSec: 30 }] } }` |

The installer edits settings files through one Node routine, `edit_hook_settings`, kept separate
from `edit_instructions` and the rest of the installer:

- a symlinked file is edited at its target, and the link stays a link;
- the file's mode is kept, and a new file is `0600`;
- the write is atomic: a temporary file is renamed over the original, after checking that the
  file did not change during the edit;
- invalid JSON, or a `hooks`/event value of the wrong type, **refuses the edit** and leaves the
  file unchanged;
- every other key, event and handler is preserved in its order. Only handlers whose command
  matches `…prax(.js)' harvest --hook <vendor>` are Prax's. A re-install replaces them, so there
  is never more than one, and an unchanged file is not rewritten. The file is re-serialised
  with two-space indentation;
- `--uninstall` removes only Prax's handlers and prunes the matcher groups and event arrays that
  held nothing else. It never deletes a settings file. It removes the Copilot file only when
  that file holds the Prax command.

With `--instructions`, the standing block gains a paragraph that teaches the marker syntax. The
paragraph appears only when a harvest hook is installed on this machine, detected in the files
above, so an agent is never told that a marker files anything when nothing will harvest it. The
installer reminds the person to trust the hook in Codex (`/hooks`).

## Evidence

- `tests/cli/harvest.test.js`: extraction from the three transcript formats and plain text;
  exclusion of user and tool text; fenced examples ignored; secret screening; stable derived ids.
  Against a real app on an in-memory database: candidates filed into Inbox with the stamps, a
  replay that creates nothing, an existing title skipped, fail-open with exit 0 on an
  unreachable server and on an exhausted budget, and the detached hook path.
- `tests/backend/harvestedRetrieval.test.js`: every retrieval route hides an unreviewed
  candidate by default, discloses the count, shows it with `includeHarvested=true`, and treats a
  verified or re-tagged candidate normally; plain listings are unfiltered.
  `tests/cli/harvestedRecall.test.js` and `tests/cli/commandLine.test.js`: the CLI, skill and MCP
  opt-in and every disclosure line.
- `tests/skills/installHooks.test.js`: `--hooks` with a temporary HOME writes all three vendor
  entries and preserves unrelated settings and a symlink. A re-install is idempotent,
  `--uninstall` restores the unrelated content, and malformed JSON is refused.
- Live, end to end, on 2026-09-23: each vendor ran the real hook command against a disposable
  server on a temporary database, and each filed one candidate stamped with its own agent id:
  - `claude -p --settings <file>` on Claude Code 2.1.280;
  - `codex exec -c hooks.Stop=…` on Codex 0.155.1, with the single-quoted command;
  - a repository-level `.github/hooks` file on Copilot CLI 1.0.85.

  None of these runs edited the real settings files.
- `npm test`, `npm run check`.
