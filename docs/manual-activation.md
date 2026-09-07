# Manual activation drills

This runbook turns Prax's remaining human quality clauses into repeatable evidence. It does not
replace axe, Playwright, native build verification, or performance measurement, and those tools do
not replace this runbook. A human performs each drill on the stated real environment and records
what actually happened.

## Evidence states

- **Prepared:** the fixture, candidate, prompts, templates, and validator exist. This repository is
  currently at least prepared.
- **Recorded:** a human completed a record, including failures or blocks, and the schema validates.
- **Activated:** the full matrix validates with `--matrix --require-pass`, every linked failure has
  been resolved and rerun, and the scorecard identifies the exact evidence revision.

Never mark a template `pass` from automated evidence or memory. Do not include private workspace
content, health information, or identifying participant details; a stable reviewer handle is
enough.

## Prepare disposable data

For browser, screen-reader, and cognitive drills, create a fresh fixture rather than using the
operator's library:

```bash
mkdir -p /tmp/prax-manual-activation
npm run fixture:quality -- --profile ci --output /tmp/prax-manual-activation/prax.db --force
HOST=127.0.0.1 PORT=3102 PRAX_DB_FILE=/tmp/prax-manual-activation/prax.db npm start
```

Open `http://127.0.0.1:3102`. Delete `/tmp/prax-manual-activation` after the record is complete.
If a drill needs semantic retrieval, start the same disposable server with the known working
embedding provider and reindex it; record that provider in `notes`.

Native drills must use a disposable OS account, VM/snapshot, or an explicitly backed-up Prax app-
data directory. Do not test install/uninstall or destructive recovery against the operator's only
copy of Prax data.

### Real touch devices

A phone cannot reach another machine's loopback address. Use only an isolated trusted network and
the disposable fixture. Bind to the test host's private address, firewall the port to the two test
devices, set `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`, and remove the listener immediately after
the drill. Prax has no built-in authentication. Never port-forward or expose this drill publicly.

## Stable journey prompts

Use the prompt wording below. The operator may explain the goal but must not reveal control names
or navigation steps during a cognitive walkthrough.

### `shell-navigation`

Goal: identify where you are, then reach Today, Library, and Settings and return without using a
pointer-only/visual-only cue.

Pass observations:

- current location and major landmarks are perceivable;
- focus/touch order follows the visible reading order and never becomes trapped;
- returning from a dialog/editor restores a sensible location.

### `task-lifecycle`

Goal: capture a task for a named project with a label and tomorrow's date, add description and
notes, schedule recurrence, complete it, and undo completion.

Pass observations:

- labels, state, required fields, and pending/failed/saved feedback are understandable;
- keyboard, screen reader, or touch can reach every named action;
- no double action, silent loss, or uncertainty about whether the task committed occurs.

### `library-editor-trust`

Goal: find the fixture's runbook, identify its project and trust state, edit an exact sentence,
wait for save confirmation, navigate away, and reopen it.

Pass observations:

- ownership, trust, archive state, and semantic/keyword mode are not conveyed by colour alone;
- editor mode, outline, information fields, and save/recovery state are announced or visible;
- the exact edit persists and no unrelated document receives it.

### `runbook-operation`

Goal: start a run, complete a step, interrupt it, reopen and resume, finish, then explain who did
what from the chronicle.

Pass observations:

- step names, checked state, progress, actor, timestamps, and terminal state remain understandable;
- conflicting actions are unavailable while a mutation is pending;
- interruption and completion are distinct and the post-mortem path is reachable.

### `import-export-native-dialog`

Goal: open Markdown import, select a destination and multiple files, review the non-round-trip
boundary, then cancel. Export one project, change the filename/location in the OS dialog, cancel,
retry, and save.

Pass observations:

- focus is contained and returns to the opener; fields have useful names and error associations;
- project ownership, export scope, destination behaviour, and backup limitations are understood;
- cancellation is not reported as failure and the final file exists only at the chosen location.

### `settings-provider-status`

Goal: explain the active network/authentication boundary, change theme/accent, inspect semantic
provider status, make and cancel a provider draft, then find Data & admin actions.

Pass observations:

- Off, unavailable, pending, failed, and connected are distinguishable in words;
- no backend secret is exposed and no setting disappears at zoom or narrow width;
- cancelling/rejecting a draft leaves the prior configuration truthful.

### `failure-recovery-comprehension`

Goal: use the supplied test failure (offline embedding provider or rejected disposable write),
explain what did and did not commit, and choose the safe next action.

Pass observations:

- committed, failed, uncertain, and retryable outcomes cannot be confused;
- the suggested next action does not risk a duplicate consequence;
- recovery content and restart/log locations are reachable without developer knowledge.

### `touch-orientation`

Repeat the shell, task, Library, runbook, dialog, and Settings goals touch-only in portrait and
landscape on real iOS/iPadOS Safari and Android Chrome hardware.

Pass observations:

- no required action depends on hover, right-click, or a precision pointer;
- selection and destructive confirmation are deliberate, with no accidental adjacent activation;
- no page-level horizontal travel is needed and rotation does not lose draft or dialog state.

### `native-install-persist-restart`

Install the exact release artifact for the record's target. Launch, create one uniquely named task
and document, quit normally, relaunch and verify both, exercise Restart Prax, then run the native
save-dialog portion of import/export.

Pass observations:

- install/security messaging is actionable and the launched binary identifies the candidate;
- data survives two launches and normal quit leaves no child process;
- restart/recovery and log location are usable; native dialogs can save/cancel in arbitrary folders.

## Lane-specific method

### Screen reader

Run the applicable journeys with macOS VoiceOver, Windows NVDA, and Ubuntu Orca using their normal
browse/navigation and forms modes. Listen to actual speech (or use a connected braille display).
Inspecting the accessibility tree alone does not count. Record unlabeled controls, duplicated or
stale announcements, unexpected mode changes, focus loss, and status messages that are never
announced.

### Cognitive walkthrough

Use at least one reviewer who did not implement the candidate. Give only the goal paragraphs, in
order. Record requested assistance, wrong turns, misunderstood terminology, unexpected outcomes,
and whether recovery language enabled a safe decision. A pass requires every goal to complete
without critical ambiguity, silent loss, or an unsafe irreversible action; non-critical friction is
still recorded and triaged.

### Physical touch

Use actual iOS/iPadOS Safari and Android Chrome devices, touch-only, in portrait and landscape.
Browser emulation may reproduce a defect but cannot close this lane.

### Native platform

Use artifacts from the same candidate revision for `macos-arm64` and `ubuntu-x64`.
Windows, Intel Mac and Linux ARM64 installers are outside the supported native release matrix.
CI proving an artifact exists is prerequisite evidence, not this manual result.

## Record and validate

Copy the matching file from [`quality-evidence/templates`](quality-evidence/templates), replace all
angle-bracket placeholders, set every journey to `pass`, `fail`, or `blocked`, and provide concise
notes. A failure/block requires at least one issue identifier or URL.

Validate one honest record, even if it contains failures:

```bash
npm run verify:manual-activation -- --input /path/to/record.json
```

Require that record to pass:

```bash
npm run verify:manual-activation -- --input /path/to/record.json --require-pass
```

After all eight matrix records exist, pass each with a separate `--input`, followed by:

```bash
--matrix --require-pass
```

The full matrix is three screen readers, one independent cognitive walkthrough, two real touch
platforms, and three native release targets. Windows NVDA still covers the browser application.
Commit only reviewed, privacy-safe evidence intended to support activation.
