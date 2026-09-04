# Prax Release-wide Quality Scorecards

**State:** Baseline; no surface is Gate-B activated
**Standard:** [`superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md`](superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md)
**Evidence pass:** 2026-07-13; task and Library/editor human-surface breadth updated 2026-07-14

The [4 September independent-review repair verification](reviews/2026-09-04-repair-verification.md) records the later combined regression, recovery, portability, audit and native-runtime results. These repairs do not change the activation scores below.

These scorecards apply the adopted 0–4 scale without averaging away a defining-category gap.
They describe the evidence present in this repository, not confidence or intention. Gate A remains
active globally. A score of 2 for accessibility or performance means the product now has useful,
repeatable evidence but has not yet met the standard's activation requirements.

Abbreviations: **C** correctness, **RR** reliability/recovery, **HU** human usability, **ACU**
agent/contract usability, **A11y** accessibility, **Perf** performance, **SP** security/privacy,
**Cons** consistency, **TO** testability/observability, and **Docs** documentation.

## Baseline matrix

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

## Evidence common to human surfaces

- `tests/e2e/accessibility.spec.js` runs axe WCAG 2 A/AA, 2.1 A/AA, and 2.2 AA rules over task
  collection/detail/capture, Library/editor/runbook, Settings, import, and export in light and dark
  themes. It also audits every selectable accent. The pass has no rule exclusions.
- Existing Playwright journeys cover keyboard activation, dialog containment/return, pending-write
  barriers, delayed responses, and relevant responsive states.
- `tests/e2e/human-surface-breadth.spec.js` adds a 320 CSS px/400%-equivalent reflow gate for task
  list, board, backlog, and archive; verifies board stacking order; operates bulk completion in a
  touch-only browser context; and asserts computed reduced-motion durations.
- `tests/e2e/library-editor-reflow.spec.js` adds the same reference-width gate for active/archive/
  semantic Library states and editor chrome, proves ordered vertical split panes and a bounded
  outline, and persists an exact title/body edit without zooming out.
- `tests/e2e/remaining-human-surfaces-reflow.spec.js` completes the reference-width browser pass
  for active/terminal runbooks, every Settings section, parsed Markdown import, and Library export;
  it also commits a real narrow run-step mutation and retains the chronicle and dialog actions.
- The automated accessibility result is deliberately scored **2**, not 3: every major core human
  surface now has 320 CSS px/400%-equivalent browser evidence, but there is no recorded
  VoiceOver/NVDA/Orca journey, physical-device review, or full cognitive review. Axe and viewport
  emulation are not assistive-technology certification.
- [`manual-activation.md`](manual-activation.md), `scripts/verify-manual-activation.mjs`, and the
  non-self-validating templates now define the exact three-screen-reader, independent cognitive,
  two-device touch, and four-target native matrix. This is **prepared**, not recorded or activated;
  validators cannot perform a human drill or create an attestation.
- `npm run measure:performance` now owns a verified `large` fixture, production server, installed
  Chromium, warm HTTP reads, browser feedback/completion journeys, machine metadata, RSS, database
  size, and a versioned JSON report. Raw reports retain `candidate-baseline-only`; the separate
  reference-hardware manifest now has explicit human approval and `npm run gate:performance`
  performs a fresh enforcing measurement.
- The refreshed 11-sample candidate recorded p95 shell/task/capture/Library/editor times of
  479.13/599.73/42.38/872.08/1,075.51 ms respectively. Representative HTTP p95 remained 31.59 ms
  or lower. The exact reference metadata and resource values are in
  [`quality-fixture.md`](quality-fixture.md). The committed candidate passes the approved manifest,
  but the first fresh gate exposed Library p50 at 862.93 ms against its 850 ms boundary. Performance
  scores remain unchanged until that live failure is resolved and the gate reruns cleanly.
- Large collections use explicit progressive disclosure. Task and document group headers retain
  full totals, “Showing X of Y” states disclose the bounded DOM, and keyboard order contains only
  mounted tasks. This protects responsiveness without violating QINV-10.

## Tasks and planning

Evidence: `tests/e2e/task-capture-organization.spec.js`, `tests/e2e/task-drawer-draft.spec.js`,
`tests/e2e/task-lifecycle.spec.js`, `tests/e2e/human-surface-breadth.spec.js`, task route/repository
tests, recovery and mutation-queue unit tests, and bounded list/board/backlog/archive renderer
tests. These prove exact-once capture, render-stable drafts, serialized mutation, recurrence,
snooze, lost-response reconciliation, truthful failed refreshes, 400%-equivalent one-dimensional
reflow, explicit touch selection, bulk completion, and reduced-motion behaviour.

Next constraint: complete a human screen-reader/cognitive/physical-touch review of the task
lifecycle, then set the task feedback/completion budget on declared hardware. Defining human
usability remains 3 until that manual breadth complements the production-browser evidence.

Release blockers: any QINV-01/02/03/09 regression, silent collection omission, or loss of existing
keyboard/recovery evidence.

## Library and editor

Evidence: `tests/e2e/editor-autosave.spec.js`, `tests/e2e/library-navigation.spec.js`,
`tests/e2e/knowledge-retrieval.spec.js`, `tests/e2e/trust-actions.spec.js`,
`tests/e2e/library-editor-reflow.spec.js`, editor recovery/save unit tests, and Library
filtering/ownership renderer tests. Opening a document installs links, references, task backlinks,
similar documents, and run history in one stale-guarded update rather than repeatedly remounting
the editor. Active/archive/semantic collections and editor header/toolbar/info/footer remain
one-dimensional at 400%-equivalent width; split panes stack in order and exact narrow drafts save.

Next constraint: manual long-document, screen-reader, cognitive, and physical-device editing
review; then activate large-Library collection and editor-open budgets. Human usability remains 3
until that human breadth complements the automated reflow and persistence evidence.

Release blockers: silent draft loss, stale collection/context install, false verification or
lifecycle state, ambiguous project ownership, or undeclared collection truncation.

## Runbook execution

Evidence: `tests/e2e/runbook-operation.spec.js`,
`tests/e2e/remaining-human-surfaces-reflow.spec.js`, `tests/backend/runbookRuns.test.js`, MCP run
tools, migration/fixture verification, and the destructive restore drill. They cover exact-once
start, snapshots, serialized/readback-reconciled steps, valid transitions, interruption/resume,
terminal completion, actor-attributed chronicle events, source-deletion survival, and active/
terminal operation with contained long content at the 400%-equivalent width.

Next constraint: manual screen-reader, cognitive, and physical-device operation plus a declared
large-chronicle performance budget. No defining-category gap remains, but the surface is not
activated while its accessibility/performance categories remain 2.

Release blockers: non-atomic state/event mutation, duplicate start, invalid transition acceptance,
or loss of the chronicle/source snapshot.

## Retrieval and AI

Evidence: deterministic retrieval evaluation, `tests/e2e/knowledge-retrieval.spec.js`, Ask/context
route tests, citation validation, assistant partial-success browser/route tests, structured CLI/MCP
degradation, and settings provider failure/reconciliation tests. Trust-bearing results, exact totals,
stale-query rejection, keyword fallback, invalid-citation withholding, and provider-after-write
partial success are automated.

Next constraint: activate representative index/query/model budgets and perform assistive-technology
review of search results and assistant confirmation. Reliability is 3 because real provider rate
limit/outage soak evidence is not yet recorded.

Release blockers: uncited generated claims presented as grounded, provider errors leaking secrets,
unreviewed writes, hidden fallback, stale results, or committed writes reported as failed.

## Import, export, backup, and restore

Evidence: `npm run verify:portable`, `npm run verify:restore`,
`tests/e2e/import-restore.spec.js`, `tests/e2e/library-export.spec.js`,
`tests/e2e/remaining-human-surfaces-reflow.spec.js`, SQLite backup tests, and portable/contract
suites. The surface has explicit ownership/scope, stable retry identities, atomic import evidence,
non-overwriting/fsynced/validated backups, owned destruction, historical migration, native/browser
save cancellation, unavailable-destination source safety, and contained parsed import/export
dialogs with reachable actions at the 400%-equivalent width.

Next constraint: manual platform save-dialog and assistive-technology review plus declared archive/
restore completion budgets. Human usability and accessibility prevent activation.

Release blockers: overwrite without confirmation, partial import without truthful evidence,
ambiguous ownership/scope, unsafe webview filesystem paths, or destructive restore before backup
validation.

## MCP, CLI, skills, ICS, and HTTP contracts

Evidence: contract tests, MCP pagination and stable-mutation suites, owner-aware child collections,
CLI unavailable/degraded envelopes, attended exact-content verification, activity actors, and
portable format validation. Collections expose versioned totals/offsets/limits/hasMore; mutations
declare retry/destructive semantics and stable identities.

Next constraint: activate HTTP/CLI/MCP latency and resource budgets and record one end-to-end skill
consumer drill against the packaged command. Accessibility is not scored for protocol surfaces;
the CLI's human-readable output remains part of human usability.

Release blockers: silent caps, ambiguous partial success, unsafe automatic retry, contract-shape
drift without versioning, or machine verification without attended exact-content confirmation.

## Desktop

Evidence: Rust tests, desktop lifecycle/web-security/permission contracts,
`npm run desktop:verify`, `npm run desktop:smoke`, and release-workflow contracts. The desktop owns
an ephemeral loopback endpoint, restricts navigation/scripts to the exact origin, shuts down over a
bounded owner-only channel, preserves SQLite across two launches, exposes actionable restart UI,
and publishes complete checksummed packages.

Next constraint: manual native interaction/accessibility review on every supported OS and startup,
steady-state, restart, and large-workspace budgets. Human usability remains 3 and correctness is 3
until supported-platform native package drills are recorded outside CI contracts.

Release blockers: non-loopback exposure, cross-origin navigation/script acceptance, orphaned
sidecars, missing release artifacts/checksums, or lost app-data persistence.

## Deployment and settings

Evidence: runtime config tests, deployment contract tests, rendered manifests, security docs, and
`tests/e2e/deployment-settings.spec.js` plus
`tests/e2e/remaining-human-surfaces-reflow.spec.js`. Local defaults bind loopback, network exposure
requires an explicit no-auth acknowledgement, examples expose no accidental route, provider
settings are failure-explicit, draft-preserving, single-flight, and readback-reconciled, and every
Appearance, Intelligence, and Data & admin section remains contained at the 400%-equivalent width.

Next constraint: manual screen-reader, cognitive, and physical-device Settings review and
activation of settings/status feedback budgets. Correctness/recovery stay 3 until a real reverse-
proxy/network deployment drill is recorded in addition to rendered-contract evidence.

Release blockers: implicit non-loopback exposure, UI-settable backend secrets/config, proxy-auth
claims Prax cannot verify, provider failure masquerading as Off, or documentation contradicting
the shipped manifests.

## Journey 13 — adverse dependency inventory

**Status:** Automated baseline. The named dependency classes have executable evidence; provider
soak and physical disk-exhaustion drills remain activation work.

| Dependency | Required outcome | Executable evidence |
|---|---|---|
| Chat unavailable/rejected | No-model and provider rejection are explicit degraded outcomes; citation-invalid answers are withheld; a write committed before provider failure is truthful partial success and not replayed. | `tests/backend/chat.test.js`, `tests/backend/askRoutes.test.js`, `tests/backend/assistantRoute.test.js`, `tests/e2e/knowledge-retrieval.spec.js`, `tests/e2e/assistant-partial-success.spec.js` |
| Embeddings unavailable | Disabled/unreachable embedding providers are explicit; Ask/context and CLI retrieval use declared keyword/recency fallback without leaking provider internals. | `tests/backend/embedderProvider.test.js`, `tests/backend/embeddingService.test.js`, `tests/backend/semanticRoutes.test.js`, `tests/backend/contextPack.test.js`, `tests/cli/search.test.js`, `tests/e2e/knowledge-retrieval.spec.js` |
| Network unavailable/lost response | Browser writes reconcile canonical readback with stable identities; CLI/MCP distinguish unreachable service from API rejection and do not retry unsafe anonymous writes. | `tests/cli/apiClient.test.js`, `tests/mcp/errors.test.js`, `tests/mcp/praxClient.test.js`, `tests/e2e/editor-autosave.spec.js`, `tests/e2e/import-restore.spec.js`, `tests/e2e/runbook-operation.spec.js`, `tests/e2e/deployment-settings.spec.js` |
| Filesystem unavailable/unsafe | Backup/restore/export reject occupied or unsafe targets, clean owned partial artifacts, preserve the live source when destination creation fails, and expose save cancellation without false success. | `tests/backend/backupRestoreDrill.test.js`, `tests/frontend/libraryExportDestination.test.js`, `tests/e2e/library-export.spec.js`, `npm run verify:restore` |

## Activation checklist

No scorecard may move from baseline to activated until all of these are recorded for that surface:

1. every applicable category is at least 3 and each defining category is 4;
2. manual assistive-technology, zoom, and platform clauses complement the automated WCAG gate;
3. a human-approved p50/p95/resource budget is stored with reference hardware and the harness
   command, then enforced;
4. every ranked journey and adverse variant is linked to executable evidence or a reproducible
   manual drill;
5. the final verification revision and date replace this pass-level baseline.

**Last verification:** 2026-07-14 — `npm test` (173 test files), `npm run test:e2e` (66 browser
journeys), the no-exclusion WCAG gate, all-core-surface 400%-equivalent reflow evidence, touch/
reduced-motion evidence, manual-evidence/budget-validator units, `npm run check`, `git diff --check`,
backup destination failure, collection-window units, and the refreshed 11-sample large-fixture
candidate baseline are green. The performance manifest is human-approved and the committed report
passes, but the first fresh enforcing run honestly failed the Library p50 boundary; performance
activation remains held.
