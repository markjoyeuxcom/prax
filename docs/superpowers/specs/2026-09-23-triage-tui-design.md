# Triage TUI (`prax triage`)

User-approved scope: an interactive terminal pass over the review queue, so a person can
verify, edit, supersede, archive or skip unverified agent-written documents in seconds, and
a guard so an agent cannot verify memory, through triage or plain `prax verify`. Phase 1,
item 1 of the 2026-09-21 improvement priorities decision. Tracked in the Prax task
"Triage TUI: fast-pass verification of agent memory (prax triage)".

## Goals

- Clear the review queue from a terminal at the pace of reading: one keystroke per decision,
  the next document shown straight after.
- Keep verification an attended act by a named person. The guard covers both entry points:
  `prax triage` and `prax verify`.
- Walk the same queue, in the same order, as the Library's review walk, so the terminal and
  the UI never disagree about what is waiting.
- Use existing write routes only. Each action has the retry and reconcile behaviour already
  defined for its route.

## Non-goals

- Access control. Under the no-auth model, `verified` is a workflow signal (SECURITY.md).
  Anything that can reach the API can still call `POST …/verify` directly. The guard prevents
  an agent verifying its own memory by reflex or by following instructions. It does not stop
  an adversary.
- A full-screen interface (alternate screen, cursor addressing, mouse). Triage writes plain
  lines to a scrolling terminal, so the history stays readable and the output survives a crash.
- Title, type, tag or project edits. `e` edits the body. The rest are edits in the Library.
- Undo inside triage. Archive can be restored from Library → Archive, and a supersession can be
  undone from the document's links. Triage prints where to go.
- Batch actions (verify all by one agent, for example). Each document gets one decision.
- New npm dependencies, new routes and migrations.
- Inclusion in the single-file skill bundles. Triage is for people, and the bundles are
  agent-facing.

## Command

```
prax triage [--as <human-name>] [--project <slug>]
```

- `--as` names the verifier. Without it, the first `v` asks for a name once and keeps it for
  the session. A blank name is refused.
- `--project` limits the queue to one project, like the Library's project facet. Without it,
  the queue covers every project, like the UI queue and `recall`. The flag is not resolved
  from the checkout or `PRAX_PROJECT`: triage is a library-wide review, and a folder guess
  would hide most of the queue without saying so.
- `--json` is refused. Triage is interactive only.

## Guard: an attended human only

Both `prax triage` and `prax verify` run one guard before any network request:

1. **Agent environment.** The command refuses when the environment identifies an agent CLI:
   `PRAX_AGENT` (set for any tool that writes as an agent) or a vendor marker that `detectAgent`
   (`server/instanceDiscovery.js`) already recognises: `CLAUDECODE` (Claude Code),
   `CODEX_THREAD_ID` and `CODEX_SESSION_ID` (Codex), `COPILOT_CLI` and `COPILOT_AGENT_SESSION_ID`
   (Copilot CLI), and `ANTIGRAVITY_AGENT` and `ANTIGRAVITY_CONVERSATION_ID` (Antigravity).
   `--agent <id>` on the command line counts as `PRAX_AGENT`. The refusal names the variables it found and the agent they point to. A parity test holds the
   guard's list to `detectAgent`, so a newly supported agent cannot slip past one of them.
2. **Interactive terminal.** stdin and stdout must both be TTYs. Triage also needs raw mode
   (`setRawMode`). `prax verify` keeps its existing check and its document-specific
   confirmation phrase.

**No escape hatch; plain verify refuses outright.** The options were an override flag
(`--i-am-human`, confirmed on the TTY) or an outright refusal. We chose the refusal:

- Any documented override is text an agent reads in the error or the docs and then types.
  Agents are trained to follow the remedy in an error message. An override is therefore the
  first thing an agent would try.
- The TTY requirement is the real barrier. Agent shell tools run without a terminal. An
  override that still needed a TTY would help only a person sitting in a terminal that
  inherited agent variables. A fresh terminal fixes that case, and so does the Library UI.
- Scripted verification does not exist today. `prax verify` already refuses non-interactive
  input. Refusing outright removes no current capability.

The refusal message points to the two routes that work: a terminal no agent CLI started, and
the Library review queue. It does not suggest unsetting variables. `unverify`, `supersede`
and `remember` stay available to agents. Lowering trust and retiring memory are part of the
agent memory loop, and they never raise trust.

## Queue and ordering

Triage walks the same queue, in the same order, as the Library review walk
(`public/js/reviewWalkController.js`). The Library loads every non-archived document
(`GET /api/library/documents`), keeps `isReviewQueueDoc`, sorts by `updatedAt` newest first
(`sortDocuments`, default `updated`), and groups by type in registry order (`groupDocumentsByType`,
default grouping `type`): runbooks, notes, decisions, known issues, templates, references,
post-mortems.

- `isReviewQueueDoc` moves from `renderLibrary.js` to `libraryFilters.js`, where the CLI can
  import it without the renderer. `renderLibrary.js` re-exports it, so the UI keeps a single
  definition. A queue document is agent-written (`kind: synthesized` or `updatedBy: agent`),
  unverified, not superseded and not archived.
- Triage fetches `GET /api/library/documents` (`?project=` when given) and orders the result
  with the same helpers. A parity test compares triage order with
  `buildLibraryModel({ libraryView: 'review' })` from the default UI state.
- As in the walk, the queue is a snapshot taken at the start. Before each document is shown,
  triage fetches it again (`GET /api/library/documents/:id`). If the document is no longer a
  queue document (verified elsewhere, superseded, archived or deleted), triage skips it and
  counts it as already handled. The UI does the same when `advanceReviewWalk` moves on.
- One difference: the UI walk covers the rendered batch, and triage covers the whole queue.
  The UI's view preferences (sort by title, no grouping) do not carry over. Triage always
  uses the defaults.

## What is shown for each document

Each document is shown as one block:

```
── 3 of 12 ── decision ─────────────────────────────────
Prax improvement priorities decided 2026-09-21
in prax · unverified · 1d old · via claude · created 2026-09-21
id d66025e2-195f-4874-b22f-9db885373ef6 · tags agent-memory, architecture
Citations: cli/prax.js:10-20 current · server/x.js changed since this was written
           1 citation not checked (cited in another repository)

<body excerpt: first 30 lines / 2,400 characters>
… 14 more lines — f shows the full body

Similar:
  1. CLI task command [verified] 0.81 · in prax · 3c1f…
  2. …
v verify as Mark · e edit · s supersede · r archive · n skip · f full · q quit
```

- **Header:** position in the snapshot, type, title, then the trust line from `recall`
  (`projectLabel`, `trustLabel` with age and writer), the creation date, id and tags. Project
  slugs come from a single `GET /api/projects`, because a by-id read does not join projects.
- **Citations and drift:** `GET …/code-refs`, checked against the current checkout by the
  code `recall` uses for its top hit (`checkTopCitations`, now exported). The same rules
  apply: a citation from another repository, or one read outside a checkout, is "not
  checked", never "gone".
- **Body:** a bounded excerpt. `f` prints the full body.
- **Similar documents:** `GET …/similar` (up to five, numbered for `s`). A degraded answer is
  labelled with its reason (`semantic search is off`, `not indexed yet`) instead of an empty
  list.
- **Untrusted text:** agents write the title, body, tags and similar titles, so all of it is
  untrusted. Before printing, triage replaces C0/C1 control characters (other than newline
  and tab), ESC, DEL and Unicode bidirectional controls with visible placeholders (`^[`,
  `<U+202E>`). Otherwise an ANSI or bidi sequence could hide text on screen, and the reader
  would verify content they never saw.

## Keyboard flow

Single keys are read with the input in raw mode (`setRawMode`) by a small byte decoder over
the input stream. `readline.emitKeypressEvents` is not used because its timeout for a lone
Escape makes key handling nondeterministic under test. The decoder adds no dependency. Prompts that need text (a name, a replacement) are read by a line editor in the
same raw mode, which supports Backspace, Enter, and Esc or Ctrl-C to cancel.

| Key | Action |
| --- | --- |
| `v` | Verify the displayed revision as the session's name (asks once when `--as` is absent). If the excerpt was truncated, the first `v` prints the full body and asks for `v` again. Verification never covers text the reader has not been shown. |
| `e` | Edit the body in `$VISUAL`, then `$EDITOR`, then `vi`. Save and quit to apply. An unchanged or blank result is not written. The saved document is shown again and not advanced, so it can be verified next. |
| `s` | Supersede: pick a replacement by its number in the Similar list, a pasted document id, or search words (a keyword search across projects, with results numbered). Then confirm with `y`. The shown document is retired in favour of the replacement, as the editor's Supersede… does. |
| `r` | Reject by archiving (confirmed with `y`). Restore from Library → Archive. |
| `n` | Skip to the next document. |
| `f` | Print the full body. |
| `?` | Print the key help. |
| `q`, Ctrl-C, Ctrl-D | Quit and print the summary. |

Any other key re-prints the key line. The session ends with a summary: counts of verified,
edited, superseded, archived, skipped and already-handled documents, and how many are left
in the queue.

## Actions and routes

Every action uses an existing route. Triage writes as a person: its requests carry no
`x-prax-origin: agent`, because the guard has already ruled out an agent environment. A
human edit clears `updatedByAgent`, as in the Library.

| Action | Route | Retry identity | Reconcile after an unknown outcome |
| --- | --- | --- | --- |
| verify | `POST /api/library/documents/:id/verify` with `revision` and `contentHash` of the shown content | Revision-bound, same-state replay returns success; retried only when provably unsent (`connect-only`) | Re-read: verified at the shown revision = done; otherwise report unknown and move on |
| edit | `POST /api/library/documents/:id/update` with `body`, `ifRevision` (shown revision) and a fresh `operationId` | Operation receipt (`document-update` ledger kind); one resend after a lost response replays exactly | Re-read: body equals the draft = saved; otherwise unknown, draft kept on disk |
| supersede | `POST /api/library/documents/:id/supersede` `{ supersededBy }` | Idempotent link; `connect-only` | Re-read: `status: superseded` = done |
| archive | `DELETE /api/library/documents/:id` | Idempotent setter; `connect-only` | Re-read: `archivedAt` set = done |

No new write path is added, so no new receipt kind is needed. Only the edit route creates
content, and it is already receipted through `server/operationLedger.js`. The other three
routes set a state and are safe to replay. A conflict is always shown and never overridden:
`409 revision-mismatch` on verify or edit reloads and shows the current document, and
`409 supersession-cycle` is reported.

## Errors and interrupts

- **Refusals before any request:** agent environment, non-TTY, `--json`, an unknown flag.
- **Unreachable app at start:** the transport's standard message, exit status 1.
- **A failed action:** the message is printed under the document, and the session goes on.
  A `404` means the document was deleted meanwhile, so triage counts it as handled and moves
  on. An unknown outcome is reconciled as shown above. What cannot be reconciled is reported
  as unknown and never retried by triage.
- **Editor:** raw mode is switched off while the editor runs, then restored. The editor is
  started asynchronously, so triage's signal handlers run while it is open; they are removed as
  soon as it exits. The draft is a `0600` file in a private temporary directory, created only
  once those handlers are in place. Triage removes it after a confirmed save, and keeps it
  (printing the path) after a conflict or an unknown outcome, so no typing is lost.
- **Signals while the editor runs.** The rule: an abandonment removes the draft; an interruption
  that may have cut off typing keeps it and says where.

  | Event while the editor is open | Triage | Draft |
  | --- | --- | --- |
  | Editor exits 0 | Goes on (save, no change or blank, as above) | Settled as above |
  | Editor exits non-zero, or is stopped by Ctrl-C (SIGINT) | "Edit discarded" | Removed (abandonment) |
  | Editor stopped by another signal (SIGHUP, SIGTERM, …) that triage did not receive | "Edit discarded", goes on | Kept and named if it may hold typing, else removed |
  | Triage receives SIGINT | Ignored: Ctrl-C belongs to the editor | — |
  | Triage receives SIGHUP (terminal or window closed) or SIGTERM | Passes the signal to the editor, waits for it to exit, stops with status 128 + n and a message on stderr | Kept and named if it may hold typing, else removed |

  "May hold typing" means the draft file differs from the text it was opened with, or the editor
  left another file in the draft directory (a swap or backup file, such as Vim's `.swp`, which
  holds unsaved typing); the path printed is the draft, or the directory when only the editor's
  files changed. We chose to keep rather than delete on SIGHUP: a closed window is the likeliest
  way to lose a long edit, the text may be valuable, and the draft sits in a private `0600`
  directory under the system temporary folder, which the OS clears. The path goes to stderr; if
  the terminal is gone the message is lost, but the draft is still in its `prax-triage-*`
  directory. An unchanged draft with no editor files is removed, since it holds nothing new.
- **Terminal state:** raw mode is restored in an unconditional `finally` at the triage entry
  point (a quit, or any thrown error), on process exit (an uncaught exception) and on SIGHUP,
  SIGTERM or an external SIGINT outside the editor, which also names any draft whose save was in
  flight and exits with status 128 + n. Triage never hides the cursor or switches screens (it
  writes plain lines, and escapes in agent text are neutralised), so raw mode is the only terminal
  state to restore. Ctrl-C in raw mode arrives as a key, not a signal, and quits cleanly with the
  summary. During a text prompt, Ctrl-C cancels the prompt only.

## Code layout

- `cli/lib/triage.js`: the guard-aware session (`runTriage`), queue ordering, card rendering,
  terminal key reader and line editor, editor launcher and a small human-origin client over
  `server/praxTransport.js` (reads plus the four writes). All I/O is injected: client,
  streams, env, editor and checkout.
- `cli/lib/verify.js`: `agentEnvironment(env)` and `assertAttendedHuman({ input, output, env })`,
  shared by `triage` and `verify`.
- `cli/prax.js`: one `triage` entry in the command table and one command block. The `verify`
  block calls the guard first.
- The skill bundles import neither module. A contract test builds each skill entry with an
  esbuild metafile and asserts that neither `cli/lib/triage.js` nor `cli/lib/verify.js` is an
  input. It also checks that the committed bundles contain no triage code.

## Evidence

- `tests/cli/triage.test.js`: fake client and fake TTY streams. It covers the keyboard flow
  (verify, the verify-after-full-body rule, edit with a fake editor, supersede by number and
  by search, archive, skip, quit, Ctrl-C), refusals under each agent marker and on a non-TTY,
  queue ordering and parity with `buildLibraryModel`, already-handled skipping, conflict
  reload, unknown-outcome reconciliation, control-character sanitising and human-origin
  headers.
- `tests/cli/triageSignals.test.js`: the editor's signal handlers exist only while it runs;
  SIGHUP and SIGTERM keep a changed draft (or a directory holding a swap file) and remove an
  unchanged one, with status 129 and 143; SIGINT is left to the editor; a non-zero exit or Ctrl-C
  removes the draft; a real child process with a real editor process and real signals; raw mode
  restored and handlers removed after an uncaught error, and after SIGTERM outside the editor,
  which names a draft whose save is in flight.
- `tests/cli/verify.test.js`: guard parity with `detectAgent`, and refusals.
- `tests/cli/commandLine.test.js`: `prax verify` and `prax triage` refuse under an agent
  environment and without a TTY before any network request, and `triage --json` is refused.
- `tests/contract/skillBundlesExcludeTriage.test.js`: the bundle exclusion above.
- `tests/skills/installScript.test.js`: the fake desktop bundle copies
  `public/js/libraryFilters.js`, because the CLI now imports it. The real payload ships all of
  `public/`.
- A manual smoke run on a real pseudo-terminal (Python `pty`) against a throwaway in-memory app:
  raw-mode keys, `$EDITOR` round trip (draft `0600`, the saved edit is human-written), verify,
  and a clean exit that restores the terminal.
- `npm test`, `npm run check`. The skill bundles are byte-identical: the only change to a
  bundled module is the `export` on `checkTopCitations`.
