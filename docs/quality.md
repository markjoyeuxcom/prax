# Quality evidence

The policy is the [product quality standard](design/quality-standard.md): Gate A (the
regression and invariant ratchet) applies to every change; Gate B activates a surface only when
its evidence meets the standard. This document records where that evidence stands, surface by
surface, and the manual drills that remain before any surface is activated.

**State:** baseline; no surface is Gate-B activated.
**Last evidence pass:** 2026-07-14. The September 2026 independent-review repairs (see the
changelog for those releases) added regression, recovery, portability and native-runtime
evidence without changing the activation scores below.

Scores use the standard's 0–4 scale without averaging away a defining-category gap. They
describe the evidence present in this repository, not confidence or intention. A score of 2 for
accessibility or performance means useful, repeatable evidence exists but the activation
requirements are not met.

Abbreviations: **C** correctness, **RR** reliability/recovery, **HU** human usability, **ACU**
agent/contract usability, **A11y** accessibility, **Perf** performance, **SP** security/privacy,
**Cons** consistency, **TO** testability/observability, **Docs** documentation.

## Scorecards

| Surface | C | RR | HU | ACU | A11y | Perf | SP | Cons | TO | Docs | Defining-category result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Tasks and planning | 4 | 4 | 3 | 3 | 2 | 2 | 3 | 3 | 4 | 3 | Correctness 4; human usability 3 — not activated |
| Library and editor | 4 | 4 | 3 | 3 | 2 | 2 | 4 | 3 | 4 | 3 | Correctness/recovery 4; human usability 3 — not activated |
| Runbook execution | 4 | 4 | 3 | 4 | 2 | 2 | 3 | 3 | 4 | 3 | Defining categories 4; cross-category gates remain |
| Retrieval and AI | 4 | 3 | 3 | 4 | 2 | 2 | 4 | 3 | 4 | 3 | Defining categories 4; cross-category gates remain |
| Import, export, backup, restore | 4 | 4 | 3 | 3 | 2 | 2 | 4 | 3 | 4 | 4 | Defining categories 4; cross-category gates remain |
| MCP, CLI, skills, ICS, HTTP | 4 | 4 | 3 | 4 | N/A | 2 | 3 | 4 | 4 | 4 | Defining categories 4; performance gate remains |
| Desktop | 3 | 4 | 3 | N/A | 2 | 2 | 4 | 3 | 3 | 4 | Recovery 4; human usability 3 — not activated |
| Deployment and settings | 3 | 3 | 3 | 3 | 2 | 2 | 4 | 3 | 4 | 4 | Defining categories 4; cross-category gates remain |

### Evidence common to the human surfaces

- `tests/e2e/accessibility.spec.js` runs axe WCAG 2 A/AA, 2.1 A/AA and 2.2 AA rules over task
  collection/detail/capture, Library/editor/runbook, Settings, import and export in both themes
  and every accent, with no rule exclusions.
- `tests/e2e/human-surface-breadth.spec.js`, `library-editor-reflow.spec.js` and
  `remaining-human-surfaces-reflow.spec.js` prove a 320 CSS px (400 %-equivalent) one-dimensional
  reflow for every core surface, board stacking order, touch-only bulk completion, reduced-motion
  durations, ordered split panes, and real narrow edits that persist.
- Accessibility is deliberately scored **2**, not 3: every surface has browser evidence, but no
  recorded VoiceOver/NVDA/Orca journey, physical-device review or cognitive walkthrough exists.
  Axe and viewport emulation are not assistive-technology certification.
- `npm run measure:performance` records a versioned candidate baseline against the `large`
  fixture; `npm run gate:performance` enforces the human-approved manifest on reference hardware
  (see [quality-fixture.md](quality-fixture.md#candidate-performance-baseline)). The first fresh
  enforcing run on 2026-07-14 failed the Library p50 boundary (862.93 ms against 850 ms), so
  performance scores stay at 2 until the gate reruns cleanly.
- Large collections use explicit progressive disclosure: group headers keep full totals,
  "Showing X of Y" discloses the bounded DOM, and keyboard order contains only mounted rows.

### Surfaces

**Tasks and planning.** Evidence: `task-capture-organization`, `task-drawer-draft`,
`task-lifecycle` and `human-surface-breadth` browser journeys, task route/repository tests and
recovery/mutation-queue units: exact-once capture, render-stable drafts, serialized mutation,
recurrence, snooze, lost-response reconciliation and truthful failed refreshes. Next: a human
screen-reader, cognitive and touch review of the task lifecycle, then a feedback/completion
budget on declared hardware. Release blockers: any QINV-01/02/03/09 regression, silent collection
omission, or loss of keyboard/recovery evidence.

**Library and editor.** Evidence: `editor-autosave`, `library-navigation`,
`knowledge-retrieval`, `trust-actions` and `library-editor-reflow` journeys plus editor
recovery/save and Library filtering units. Opening a document installs links, references,
backlinks, similar documents and run history in one stale-guarded update. Next: manual
long-document, screen-reader, cognitive and device review, then large-Library and editor-open
budgets. Release blockers: silent draft loss, stale collection or context install, false
verification or lifecycle state, ambiguous ownership, undeclared truncation.

**Runbook execution.** Evidence: `runbook-operation` journey, `tests/backend/runbookRuns.test.js`,
the MCP run tools and the destructive restore drill: exact-once start, snapshots,
readback-reconciled steps, valid transitions, interruption and resume, actor-attributed
chronicle, survival of source deletion. Next: manual accessibility review and a large-chronicle
budget. Release blockers: non-atomic state/event mutation, duplicate start, invalid transition
acceptance, loss of the chronicle or snapshot.

**Retrieval and AI.** Evidence: the deterministic retrieval evaluation (`npm run eval`),
`knowledge-retrieval` journey, Ask/context route tests, citation validation, assistant
partial-success tests and provider failure/reconciliation tests. Reliability is 3 because no
real provider rate-limit or outage soak is recorded. Next: index/query/model budgets and
assistive-technology review of results and confirmations. Release blockers: uncited generated
claims presented as grounded, provider errors leaking secrets, unreviewed writes, hidden
fallback, stale results, committed writes reported as failed.

**Import, export, backup and restore.** Evidence: `npm run verify:portable`,
`npm run verify:restore`, `import-restore` and `library-export` journeys, SQLite backup tests and
the contract suites: explicit ownership and scope, stable retry identities, atomic import
evidence, non-overwriting fsynced validated backups, owned destruction, historical migration,
native and browser save cancellation. Next: manual platform save-dialog and assistive-technology
review, archive/restore budgets. Release blockers: overwrite without confirmation, partial import
without truthful evidence, ambiguous ownership, unsafe webview paths, destructive restore before
backup validation.

**MCP, CLI, skills, ICS and HTTP.** Evidence: the contract tests, MCP pagination and
stable-mutation suites, owner-aware child collections, CLI unavailable/degraded envelopes,
attended exact-content verification and portable format validation. Next: latency and resource
budgets and one end-to-end skill-consumer drill against the packaged command. Release blockers:
silent caps, ambiguous partial success, unsafe automatic retry, contract drift without
versioning, machine verification without attended confirmation.

**Desktop.** Evidence: the Rust tests, lifecycle/web-security/permission contracts,
`npm run desktop:verify`, `npm run desktop:smoke` and the release-workflow contract: a persisted
loopback endpoint that refuses an occupied port, exact-origin navigation, bounded owner-only
shutdown, SQLite persistence across launches, actionable restart UI, complete checksummed
packages. Correctness stays 3 until native package drills are recorded outside CI. Release
blockers: non-loopback exposure, cross-origin navigation or script acceptance, orphaned
sidecars, missing artifacts or checksums, lost app data.

**Deployment and settings.** Evidence: runtime config and deployment contract tests, rendered
manifests, `deployment-settings` journey: loopback defaults, an explicit no-auth acknowledgement
for network exposure, failure-explicit single-flight provider settings, contained Settings at
reference width. Correctness and recovery stay 3 until a real reverse-proxy deployment drill is
recorded. Release blockers: implicit non-loopback exposure, provider secrets or the selected
local CLI settable from outside the operator trust boundary (Settings is operator access by
design, see `SECURITY.md`), the bind or its acknowledgement settable from the UI, provider keys
returned by the API, proxy-auth claims Prax cannot verify, provider failure shown as Off,
documentation contradicting the manifests.

### Adverse dependency inventory (journey 13)

Automated baseline; provider soak and physical disk-exhaustion drills remain activation work.

| Dependency | Required outcome | Executable evidence |
|---|---|---|
| Chat unavailable or rejected | No-model and provider rejection are explicit degraded outcomes; citation-invalid answers are withheld; a write committed before provider failure is truthful partial success, never replayed. | `tests/backend/chat.test.js`, `askRoutes.test.js`, `assistantRoute.test.js`; `tests/e2e/knowledge-retrieval.spec.js`, `assistant-partial-success.spec.js` |
| Embeddings unavailable | Disabled or unreachable providers are explicit; Ask, context and CLI retrieval fall back to declared keyword/recency search without leaking provider internals. | `tests/backend/embedderProvider.test.js`, `embeddingService.test.js`, `semanticRoutes.test.js`, `contextPack.test.js`; `tests/cli/search.test.js` |
| Network unavailable or lost response | Browser writes reconcile canonical readback with stable identities; CLI and MCP distinguish an unreachable service from an API rejection and never retry unsafe anonymous writes. | `tests/cli/apiClient.test.js`, `tests/mcp/errors.test.js`, `praxClient.test.js`; `editor-autosave`, `import-restore`, `runbook-operation`, `deployment-settings` journeys |
| Filesystem unavailable or unsafe | Backup, restore and export reject occupied or unsafe targets, clean owned partial artifacts, preserve the live source when the destination fails, and expose cancellation without false success. | `tests/backend/backupRestoreDrill.test.js`, `tests/frontend/libraryExportDestination.test.js`, `library-export` journey, `npm run verify:restore` |

### Activation checklist

No scorecard moves from baseline to activated until, for that surface:

1. every applicable category is at least 3 and each defining category is 4;
2. manual assistive-technology, zoom and platform drills (below) complement the automated gate;
3. a human-approved p50/p95/resource budget is stored with its reference hardware and harness
   command, then enforced;
4. every ranked journey and adverse variant links to executable evidence or a reproducible
   manual drill;
5. the final verification revision and date replace this baseline.

## Manual activation drills

These drills turn the remaining human clauses into repeatable evidence. They do not replace
axe, Playwright, native build verification or performance measurement, and those do not replace
the drills. A person performs each drill on the stated real environment and records what
happened.

Evidence states: **prepared** (fixture, prompts, templates and validator exist; this repository
is at least prepared), **recorded** (a person completed a record, failures included, and it
validates), **activated** (the full matrix validates with `--matrix --require-pass`, every
linked failure is resolved and rerun, and the scorecard names the exact evidence revision).
Never mark a template `pass` from automated evidence or memory. Records carry no private
workspace content, health information or identifying participant details; a stable reviewer
handle is enough.

### Prepare disposable data

```bash
mkdir -p /tmp/prax-manual-activation
npm run fixture:quality -- --profile ci --output /tmp/prax-manual-activation/prax.db --force
HOST=127.0.0.1 PORT=3102 PRAX_DB_FILE=/tmp/prax-manual-activation/prax.db npm start
```

Open `http://127.0.0.1:3102` and delete the directory after the record is complete. A drill that
needs semantic retrieval starts the same disposable server with a known working embedding
provider and records it in `notes`. Native drills use a disposable OS account, a VM snapshot or
an explicitly backed-up app-data directory, never the operator's only copy of Prax data.

A phone cannot reach another machine's loopback address. For touch drills bind to the test
host's private address on an isolated trusted network, firewall the port to the test devices,
set `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`, and remove the listener immediately afterwards.
Prax has no built-in authentication; never port-forward or expose the drill publicly.

### Journey prompts

Use this wording. The operator may explain the goal but must not reveal control names or
navigation steps during a cognitive walkthrough.

- **`shell-navigation`.** Identify where you are, reach Today, Library and Settings and return,
  without a pointer-only or visual-only cue. Pass: location and landmarks are perceivable; focus
  or touch order follows reading order and never traps; returning from a dialog or editor
  restores a sensible location.
- **`task-lifecycle`.** Capture a task for a named project with a label and tomorrow's date, add
  description and notes, schedule recurrence, complete it, undo completion. Pass: labels, state,
  required fields and pending/failed/saved feedback are understandable; every named action is
  reachable by keyboard, screen reader or touch; no double action, silent loss or doubt about
  whether the task committed.
- **`library-editor-trust`.** Find the fixture's runbook, identify its project and trust state,
  edit an exact sentence, wait for save confirmation, navigate away and reopen it. Pass:
  ownership, trust, archive state and search mode are not conveyed by colour alone; editor mode,
  outline, info fields and save/recovery state are announced or visible; the exact edit persists
  and no other document received it.
- **`runbook-operation`.** Start a run, complete a step, interrupt it, reopen and resume, finish,
  then explain who did what from the chronicle. Pass: step names, checked state, progress,
  actor, timestamps and terminal state stay understandable; conflicting actions are unavailable
  while a mutation is pending; interruption and completion are distinct and the post-mortem path
  is reachable.
- **`import-export-native-dialog`.** Open Markdown import, select a destination and several
  files, review the non-round-trip boundary, cancel. Export one project, change the file name and
  location in the OS dialog, cancel, retry, save. Pass: focus is contained and returns to the
  opener; fields have useful names and error associations; ownership, scope, destination and
  backup limits are understood; cancellation is not reported as failure and the file exists only
  at the chosen location.
- **`settings-provider-status`.** Explain the active network and authentication boundary,
  change theme and accent, inspect semantic provider status, make and cancel a provider draft,
  find the Data & admin actions. Pass: Off, unavailable, pending, failed and connected are
  distinguishable in words; no secret is exposed and no setting disappears at zoom or narrow
  width; cancelling a draft leaves the prior configuration truthful.
- **`failure-recovery-comprehension`.** Using the supplied failure (offline embedding provider or
  rejected disposable write), explain what did and did not commit and choose the safe next
  action. Pass: committed, failed, uncertain and retryable outcomes cannot be confused; the next
  action risks no duplicate consequence; recovery content and restart/log locations are
  reachable without developer knowledge.
- **`touch-orientation`.** Repeat the shell, task, Library, runbook, dialog and Settings goals
  touch-only in portrait and landscape on real iOS/iPadOS Safari and Android Chrome. Pass: no
  required action depends on hover, right-click or a precision pointer; selection and
  destructive confirmation are deliberate; no page-level horizontal travel; rotation keeps draft
  and dialog state.
- **`native-install-persist-restart`.** Install the exact release artifact for the target,
  launch, create one uniquely named task and document, quit, relaunch and verify both, exercise
  Restart Prax, then run the native save-dialog part of import/export. Pass: install and security
  messaging is actionable and the binary identifies the candidate; data survives two launches and
  a normal quit leaves no child process; restart, recovery and log location are usable; native
  dialogs save and cancel in arbitrary folders.

### Lanes

- **Screen reader.** macOS VoiceOver, Windows NVDA and Ubuntu Orca in their normal browse and
  forms modes, listening to actual speech or a braille display; inspecting the accessibility
  tree does not count. Record unlabeled controls, duplicated or stale announcements, unexpected
  mode changes, focus loss and unannounced status messages.
- **Cognitive walkthrough.** At least one reviewer who did not implement the candidate, given
  only the goal paragraphs in order. Record requested assistance, wrong turns, misunderstood
  terminology, unexpected outcomes and whether recovery language enabled a safe decision. A
  pass needs every goal completed without critical ambiguity, silent loss or an unsafe
  irreversible action; non-critical friction is still recorded and triaged.
- **Physical touch.** Real iOS/iPadOS Safari and Android Chrome devices, touch only, both
  orientations. Emulation may reproduce a defect but cannot close the lane.
- **Native platform.** Artifacts from the same candidate revision for `macos-arm64` and
  `ubuntu-x64`; Windows, Intel Mac and Linux ARM64 are outside the release matrix. CI proving an
  artifact exists is prerequisite evidence, not this result.

### Record and validate

Copy the matching template from [`quality-evidence/templates`](quality-evidence/templates),
replace every angle-bracket placeholder, set each journey to `pass`, `fail` or `blocked`, and add
concise notes; a failure or block needs at least one issue identifier or URL. Validate one honest
record, failures included, then require it to pass:

```bash
npm run verify:manual-activation -- --input /path/to/record.json
npm run verify:manual-activation -- --input /path/to/record.json --require-pass
```

The full matrix is three screen readers, one independent cognitive walkthrough, two real touch
platforms and the native release targets; once every record exists, pass each with its own
`--input` and add `--matrix --require-pass`. Commit only reviewed, privacy-safe evidence that is
meant to support activation.
