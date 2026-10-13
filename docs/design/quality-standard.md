# Exceptional Prax — Product Quality Standard

**Status:** Adopted — regression ratchet active
**Version:** 1.0
**Date:** 2026-07-13
**Applies to:** Web UI, HTTP API, MCP, CLI, skills, ICS, portable formats, desktop, and deployment

## Purpose

Prax is a trusted operational workspace where people and agents plan work, preserve knowledge,
and execute procedures without losing data, context, or control.

This standard makes "exceptional" falsifiable. It does not require every existing surface to
meet the final bar immediately. It does require every change to preserve known-good behaviour,
every invariant violation to block release, and every surface to become subject to the full bar
after its dedicated excellence pass.

The standard covers human and machine consumers equally. A successful-looking response that
misleads an MCP client, CLI, skill, calendar reader, or import consumer is a product defect even
when no human UI is involved.

## The two-speed quality ratchet

A single absolute gate would fail the whole pre-1.0 product on adoption and quickly become
decorative. Prax therefore uses two gates.

### Gate A — regression and invariants (active immediately)

For every change and every release:

1. No invariant below may be knowingly violated. A discovered violation becomes a release
   blocker until fixed or the invariant is explicitly revised with human approval.
2. Existing automated evidence must stay green.
3. A changed surface may not regress an existing score or critical journey.
4. A defect fix must add the narrowest durable regression evidence that reproduces its defect
   class where automation is practical.
5. New machine-facing truncation, fallback, partial success, or compatibility behaviour must be
   explicit in both the response and the contract.

An invariant is policy even when its evidence is incomplete. Missing evidence is a gap to close,
not evidence that the invariant holds.

### Gate B — activated surface excellence

Each major surface goes through a named excellence pass. At the end of that pass:

- every applicable category must score at least **3 — Excellent**;
- the surface's defining categories must score **4 — Exceptional**;
- its ranked critical journeys must be automated or have a recorded, reproducible manual drill;
- its accessibility and performance bars must have reproducible evidence;
- its scorecard is activated and cannot regress without blocking release.

The release-wide absolute gate activates only after every major surface has completed its
excellence pass. Until then, Gate A applies globally and Gate B applies only to activated
surfaces.

## Quality scale

| Score | Meaning |
|---|---|
| **0 — Unsafe** | Broken, misleading, inaccessible, insecure, or capable of data loss. |
| **1 — Functional** | The basic happy path works. Failure paths or contracts are incomplete. |
| **2 — Reliable** | Expected failures are handled and important behaviour is tested. |
| **3 — Excellent** | Fast, understandable, accessible, consistent, and polished for normal use. |
| **4 — Exceptional** | Dependable under adverse conditions and credible against a focused standalone product. |

Scores require linked evidence. Intention, an unexercised code path, or the absence of a reported
bug is not evidence.

## Quality categories

| Category | Exceptional means |
|---|---|
| **Correctness** | No silent loss, corruption, duplication, stale overwrite, or misleading state. |
| **Reliability and recovery** | Delay, retry, refresh, interruption, restart, and dependency failure have predictable outcomes and recovery paths. |
| **Human usability** | Primary workflows are discoverable, concise, reversible where practical, and coherent across mouse, keyboard, touch, and viewport sizes. |
| **Agent and contract usability** | Machine-facing results are complete or explicitly paginated/truncated; partial success and degradation are structured; shapes are documented and deliberately versioned. |
| **Accessibility** | Each critical human journey works with keyboard and assistive technology, with correct focus, semantics, contrast, zoom, and reduced-motion behaviour. |
| **Performance** | Measured critical journeys stay within an activated, fixture-backed budget on declared reference hardware. |
| **Security and privacy** | Local-safe defaults, explicit exposure boundaries, validated inputs, protected secrets, and no accidental trust escalation. |
| **Consistency** | Saving, errors, menus, filters, lifecycle actions, timestamps, and trust signals obey shared interaction and contract rules. |
| **Testability and observability** | Failures are diagnosable and critical behaviour has evidence at the lowest useful layer plus production-path coverage where integration matters. |
| **Documentation** | Installation, operation, contracts, backup, security, and recovery guidance match shipped behaviour. |

## Defining categories by subsystem

All applicable categories must reach 3 after activation. These categories must reach 4:

| Subsystem | Defining categories |
|---|---|
| Tasks and planning | Human usability; correctness |
| Library and editor | Correctness; reliability and recovery; human usability |
| Runbook execution | Correctness; reliability and recovery |
| Retrieval and AI | Correctness; security and privacy; agent and contract usability |
| Import, export, backup, and restore | Correctness; reliability and recovery |
| MCP, CLI, skills, ICS, and HTTP contracts | Agent and contract usability; correctness |
| Desktop | Human usability; reliability and recovery |
| Deployment and settings | Security and privacy; documentation |

No subsystem may average a defining-category failure away with strengths elsewhere.

## Non-negotiable invariants

Each confirmed defect should refine one of these class-level rules and gain regression evidence,
rather than remain only a one-off patch.

### QINV-01 — User input is never silently discarded

Navigation, rerendering, delayed saves, refresh, and shutdown must not lose accepted input.
When persistence fails, the unsaved state remains recoverable and the user receives an accurate
status.

### QINV-02 — Observed write outcomes are truthful

A write is never reported as failed if it succeeded. Partial success identifies exactly what
committed, preserves the canonical result/history needed to reconcile state, and cannot invite an
unsafe duplicate retry.

### QINV-03 — Consequential retries are idempotent or explicitly guarded

Transport retry, model retry, double activation, and resumed approval cannot unknowingly apply a
consequential mutation twice.

### QINV-04 — Unreviewed machine edits cannot inherit human verification

Knowledge modified **without a human reviewing the exact resulting content** cannot retain prior
human verification.

The editor AI writing actions are intentionally compliant: the model returns a preview, the
person reviews that exact text, and clicking **Apply** changes the human's local draft through the
user-origin save path. That reviewed edit may retain verification. Merely approving an autonomous
tool call is not equivalent when the person has not reviewed the exact resulting content; such
MCP/assistant/CLI writes remain agent-origin and must revoke verification.

### QINV-05 — Lifecycle state remains coherent

Archive, restore, supersession, deprecation, and permanent deletion must agree across records,
links, retrieval, UI, and machine-facing responses. Reversing or removing a replacement cannot
leave its predecessor falsely superseded.

### QINV-06 — Declared portable data round-trips

Every field declared portable must survive export and import with equivalent meaning. Deliberate
omissions must be named in the format contract. Backup claims require a restore drill; portability
exports must never be represented as authoritative backups.

### QINV-07 — Default installation is local-safe

A default installation does not expose an unauthenticated workspace beyond localhost. Containers
and cluster manifests may bind internally only when host-level exposure remains opt-in and the
documentation requires authentication and TLS.

### QINV-08 — Degraded and partial operation is explicit

Unavailable AI, embeddings, storage, network services, incomplete results, and fallback modes are
distinguishable from full success by people and machines. A friendly fallback may not erase the
reason, scope, or limitations of the result.

### QINV-09 — Older asynchronous work cannot overwrite newer state

Every background response, debounce, embedding job, search, and model result must be associated
with the state/version that produced it. A stale result is discarded or conditionally committed;
it cannot overwrite newer user or database state.

### QINV-10 — Machine-facing collections are never silently incomplete

MCP tools, CLI commands, APIs, feeds, and exports return a complete declared result or explicit
pagination/truncation metadata. Limits are documented in schemas and contracts. A bounded result
that looks complete is misleading success.

### QINV-11 — Destructive and trust-changing actions are attributable

Consequential operations are confirmable where human initiated, carry the correct actor/origin,
produce an observable result, and have an undo or documented recovery path where practical.

## Current invariant evidence and known gaps

This table is a baseline, not a claim that each broad invariant is fully proven.

| Invariant | Existing evidence | Current status |
|---|---|---|
| QINV-01 | Editor/task-drawer recovery evidence plus capture and import render-stability browser/unit tests | Editor, task text, unfinished capture, transient label input, and a parsed task-import file survive their relevant failure/reload/rerender boundaries. Broader input-surface inventory remains. |
| QINV-02 | Assistant/UI lost-response evidence plus stable-ID MCP/CLI client, handler, route, and SQLite contracts | Known human and machine mutations distinguish committed, reconciled, failed, and still-unknown outcomes; unresolved MCP creates return their exact retry identity instead of claiming failure. |
| QINV-03 | UI exact-once journeys plus MCP stable task/document/checklist/run/generation IDs, durable generation receipts, idempotent removal routes, and safe transport-retry tests | Consequential UI and machine retries are exact-once or desired-state idempotent; generated artifacts do not invoke the model again on replay and changed ID intent conflicts. |
| QINV-04 | Origin-boundary/E2E cases plus atomic reviewed-content-hash verification contracts | A person reviewing and saving exact editor text retains verification; agent revision revokes it; CLI/UI verification refuses to bless content changed after human review. |
| QINV-05 | Migration/SQLite generic-link and multi-replacement evidence plus the complete lifecycle browser journey | Supersession status is database-derived and atomic across dedicated/generic HTTP-MCP linking, unlink, archive, restore, cascade delete, historical reconciliation, default retrieval, and exact human Undo. |
| QINV-06 | `npm run verify:portable`, `npm run verify:restore`, import browser/adversarial tests, task contract/repository tests, and `prax.quality-fixture` semantic manifests | Portable task semantics, safe human task restore, and authoritative live-WAL/historical database restore are automated; the Markdown dialog explicitly distinguishes project-owned plain intake from one-way Library export. |
| QINV-07 | Runtime binding tests, rendered deployment contracts, exact-origin Rust tests, served CSP evidence, and packaged smoke | Plain, container, cluster, and desktop defaults are fail-closed/local-safe; the desktop child owns its ephemeral port and the webview trusts only that exact origin. |
| QINV-08 | Assistant provider-after-write journey, CLI search envelopes, context-pack retrieval metadata, and Ask Prax degraded-path tests | Assistant partial success plus semantic-to-keyword/recency fallback are explicit in machine JSON and prose/Markdown; unexpected CLI semantic failure propagates instead of silently degrading. |
| QINV-09 | Editor delayed-save/recovery E2E, library-navigation E2E, task-drawer render/context E2E, capture pending-barrier/label-render evidence, task mutation queue tests, conditional recovery clear tests, conditional embedding-write tests, and stale Ask Prax browser evidence | Editor exits, Active/Archive collections, semantic initial/append queries, grounded answers, task drawer context, capture completion, label entry, same-task mutations, and embedding writes reject stale outcomes; async inventory remains for other surfaces. |
| QINV-10 | MCP pagination contracts, semantic HTTP/browser evidence, CLI retrieval envelopes, owner-aware child-collection tests, and explicit UI collection windows | Every MCP collection exposes exact pagination; semantic legacy arrays remain complete; CLI bounded modes are declared; a missing owner cannot masquerade as an empty child collection; and large UI task/document sets retain full counts with explicit “Showing X of Y” expansion. |
| QINV-11 | Origin/confirmation/trust tests, task-activity actor migration, MCP annotations, and attended verification evidence | Destructive/idempotent MCP semantics are declared, task machine writes are actor-stamped, and verification is attended, named, exact-content guarded, and replay-safe without rewriting the first reviewer timestamp. |

## Evidence already owned by Prax

The standard absorbs existing evidence rather than demanding a Playwright duplicate for every
rule.

| Evidence | Role |
|---|---|
| `npm test` | Unit, route, repository, SQLite integration, CLI, MCP, frontend, and contract gates. |
| `npm run test:e2e` | Production-server browser journeys against real SQLite repositories. |
| `npm run check` | Entry-point syntax gate plus `npm run lint`, an undefined-identifier check (ESLint `no-undef` only). |
| `npm run verify:portable` | Deterministic mature-workspace task/checklist export/import proof against a fresh instance. |
| `npm run verify:restore` | Live-WAL `large` backup, validated destruction/restore, production boot, and historical migration proof. |
| `npm run eval` and `tests/backend/retrievalEval.test.js` | Deterministic retrieval recall and junk-exclusion evidence. |
| `npm run eval:nl` | Provider-specific NL capture/filter quality report when a model is configured. |
| `tests/backend/nlEval.test.js` | Deterministic evaluator and failure-handling evidence independent of a live model. |
| `tests/contract/` | Deliberate portable and MCP contract evolution. |
| `npm run fixture:quality` and `tests/backend/qualityFixture.test.js` | Deterministic mature workspaces, semantic manifests, corruption detection, and historical-schema upgrade evidence. |
| `npm audit --audit-level=high` | Dependency vulnerability gate. |
| `cargo test`, `cargo check`, `npm run desktop:verify`, `npm run desktop:smoke`, and native release workflows | Desktop logic/compile, staged production payload, two-launch SQLite persistence, graceful shutdown, native packaging, and complete-release evidence. |
| `tests/e2e/accessibility.spec.js` | Axe WCAG A/AA gate over critical human states, both themes, and every selectable accent; complements rather than replaces manual assistive-technology evidence. |
| `tests/e2e/human-surface-breadth.spec.js` | Task-list/board/backlog/archive reflow at 320 CSS px, ordered board stacking, touch-only bulk lifecycle operation, and computed reduced-motion evidence. |
| `tests/e2e/library-editor-reflow.spec.js` | Active/archive/semantic Library and editor reflow at 320 CSS px, ordered vertical split panes, bounded outline, document-info reachability, and exact narrow draft persistence. |
| `tests/e2e/remaining-human-surfaces-reflow.spec.js` | Active/terminal runbook, every Settings section, parsed Markdown import, and Library export reflow at 320 CSS px, including a canonical run-step mutation and reachable dialog actions. |
| `npm run measure:performance` | Versioned candidate p50/p95 HTTP/browser/resource baseline against the deterministic `large` fixture; not an activated numerical budget. |
| `docs/quality.md`, `npm run verify:manual-activation` | Reproducible, human-attested screen-reader/cognitive/real-touch/native matrix; prepared templates and validation do not count as completed human evidence. |
| `npm run verify:performance-budget` | Separates raw candidate measurements, proposed thresholds, and explicitly human-approved compatible reference-hardware gates. |

Evidence is selected by risk:

- Pure logic belongs in unit/property tests.
- Persistence invariants belong in real SQLite integration tests.
- Cross-layer user journeys belong in production-path browser tests.
- Machine interfaces belong in contract plus handler/client tests.
- Backup, restore, packaging, accessibility, and performance use reproducible drills/harnesses
  when ordinary tests cannot prove the outcome.

## Mature, messy workspace fixture (v1 deliverable)

Performance budgets, migration evidence, round-trip tests, restore drills, and realistic UI
behaviour all depend on one deterministic fixture system. It is part of v1 of this standard, not
optional follow-up infrastructure.

The fixture system provides:

1. **A deterministic generator**, `scripts/create-quality-fixture.js`, with a fixed clock and
   random seed.
2. **CI and scale profiles** so ordinary correctness runs stay fast while performance work uses a
   realistically large workspace.
3. Tasks across every status, priority, due/snooze/recurrence state, labels, notes, checklists,
   archives, and intentionally awkward Unicode/long-text cases.
4. Documents across every type, trust and lifecycle state, links/backlinks, stale derivations,
   external references, runbook runs, and optional deterministic embeddings.
5. A manifest of expected counts and sentinel records so import, retrieval, migration, and restore
   tests can prove meaning rather than only row counts.
6. **Historical-schema generation** by applying migrations only through a declared version and
   then upgrading, avoiding opaque committed database binaries.
7. Generated database files under a temporary directory; source fixtures and the generator stay
   reviewable in Git.

Initial profiles:

| Profile | Purpose | Initial scale target |
|---|---|---|
| `ci` | Fast correctness, migration, and round-trip checks | 200 tasks, 50 documents, representative related rows |
| `large` | UI/API performance and restore drills | 5,000 tasks, 750 documents, 1,000 document links, 250 runs, representative checklists/activity |

Scale targets are fixture definitions, not performance budgets. Budgets activate only after the
measurement harness exists. The generated SQLite artifact and neighbouring
`prax.quality-fixture` v1 manifest are temporary; generation and post-copy verification commands
are documented in [`docs/quality-fixture.md`](../quality-fixture.md).

## Performance-budget activation

No numerical performance claim is a gate until it has an instrument. For each surface:

1. Run the relevant journeys against the `large` fixture on declared reference hardware.
2. Capture repeatable p50/p95 baselines for feedback, completion, and resource use.
3. Identify the threshold at which the workflow ceases to feel excellent or becomes operationally
   unsafe.
4. Record the agreed budget and harness command in the surface scorecard.
5. Activate that budget under Gate B and ratchet it against regression.

Candidate numbers may guide investigation, but they are not release claims before these steps.

## Ranked critical journeys

Accessibility, keyboard operation, responsive layout, failure behaviour, and performance are
acceptance clauses on each relevant journey—not duplicate standalone journeys.

### Priority 0 — known invariant defect classes

Automate these first:

1. **Edit and switch away:** change body/title while persistence is delayed; switch documents;
   old content saves only to the old record and the new editor is untouched. **Automated.**
2. **Failed-save recovery:** make persistence fail, confirm the dirty draft remains recoverable,
   retry, and prove exactly one correct version commits. **Automated**, including reload/reopen,
   coalesced double activation, conflict detection, and lost-success-response reconciliation.
3. **Portable round-trip:** export the mature workspace, import it into a new project/instance, and
   prove every declared portable field and checklist state. **Automated** through production HTTP
   routes with a fresh SQLite instance, project/identity remapping proof, deterministic semantic
   digest, strict version validation, and atomic checklist-failure rollback.
4. **Backup and restore drill:** back up a live mature workspace, destroy the working copy,
   restore it, migrate if needed, and verify manifest sentinels. **Automated** for a live `large`
   WAL snapshot and a `0009` historical snapshot, including pre-destruction integrity/semantic
   validation, owned-path deletion, exact-path restore, migration, marker preservation, and app boot.
5. **Approved assistant write followed by provider failure:** prove the committed write, truthful
   partial-success response, canonical history, UI refresh signal, and safe retry posture.
   **Automated** through the production assistant route and UI: the fake provider fails only after
   the real tool result, exactly one task commits, canonical history marks the tool done, awaited
   cache refresh makes the task visible, the approval is gone, and the status explicitly says not
   to repeat the action. A refresh-failure unit case truthfully directs the person to reload.

### Priority 1 — defining product workflows

6. Capture, organize, schedule, snooze, complete, and regenerate a recurring task. **Automated**
   through the production server: recoverable keyboard/button capture, exact-once lost-response
   handling, shorthand fields, project/label organization, lost project-response reconciliation,
   serialized scheduling, due time, keyboard recurrence, snooze/unsnooze, atomic completion,
   exact-once regeneration, failed-refresh truthfulness, safe reopening, 400%-equivalent
   list/board/backlog/archive reflow, ordered narrow-board stacking, explicit touch multi-selection,
   real bulk completion, and reduced-motion behaviour.
7. Find the correct knowledge through filters and retrieval while preserving trust boundaries.
   **Automated:** keyword and semantic evaluation stays at 7/7; the production browser reports
   exact totals, loads every semantic page, labels cosine similarity honestly, exposes synthesized,
   stale, verified, and unverified state, rejects stale query/answer responses, makes keyword
   fallback explicit, withholds citation-invalid generation, opens cited sources by keyboard, and
   keeps active/archive/semantic ownership, trust, tags, and actions within the 400%-equivalent
   viewport.
8. Verify, revise, supersede, archive, restore, and retrieve knowledge with coherent provenance.
   **Automated:** agent-written knowledge starts visibly unverified; human-reviewed revision retains
   verification while an agent revision revokes it; supersession is atomic on dedicated and generic
   HTTP/MCP link paths, absent from default active retrieval, guarded against double activation,
   readback-reconciled after a lost response, exactly undoable, multi-replacement safe, and coherent
   through archive, restore, permanent-delete confirmation, cascade deletion, and historical-schema
   migration. A failed collection refresh is reported as committed partial success. Narrow editor
   chrome retains every action, split panes stack edit before preview, the outline becomes bounded
   and full-width, and an exact title/body draft persists without zooming out.
9. Start, operate, interrupt, resume, and finish a runbook with a durable chronicle.
   **Automated:** start is caller-ID exact-once and double-activation safe; source context and steps
   are snapshotted; check, uncheck, abort, resume, and completion append actor-attributed events in
   the same transaction as current state; invalid transitions conflict; completed runs are terminal;
   source deletion preserves the run and post-mortem path; browser mutations serialize, disable
   conflicting controls, and reconcile lost responses through canonical readback; current and
   `0009`-upgrade fixtures plus destructive restore verify the current schema without semantic
   loss. Active and terminal run states, long steps, actor timestamps, footer actions, and the
   chronicle remain ordered, reachable, and contained at the 400%-equivalent reference width.
10. Import portable tasks and intake loose Markdown without ambiguity or duplicate consequence.
    **Automated:** Settings shows and submits one explicit destination; the parsed file survives
    mode/destination renders; submit is locked; a caller UUID makes append/replace retry exact-once
    across a lost response; changed UUID reuse conflicts; task/checklist writes and operation
    evidence roll back together; and commit remains truthful when collection refresh fails. Loose
    Markdown selects its destination inside a modal, previews retained files, describes its
    intentionally non-round-trip semantics, makes project ownership visible, filterable, and
    editable, and retries an interrupted per-file commit with the same UUID instead of duplicating it.
    Library export also selects scope inside one shared modal, states its active-document/non-backup
    boundary, uses native or browser Save dialogs where available, exposes an honest Downloads
    fallback elsewhere, and never accepts a desktop destination path from the webview. Parsed
    import state and export destination state retain every action without horizontal scrolling at
    the 400%-equivalent reference width.
11. Install locally and deploy without accidentally exposing an unauthenticated workspace.
    **Automated:** local and desktop defaults stay on loopback; non-loopback startup fails before
    database open/listen unless the operator explicitly acknowledges the no-auth network boundary;
    the image bakes in no escape hatch; Compose publishes host-loopback only; Kubernetes stays
    explicit ClusterIP with no rendered route and version-aligned overlays; Settings reports local
    versus network scope without claiming proxy authentication; provider status failure, pending,
    rejection, and lost-response reconciliation remain truthful and single-flight. Appearance,
    Intelligence, and Data & admin keep every control inside their cards at the 400%-equivalent
    reference width.

### Priority 2 — breadth and adverse operation

12. Upgrade a historical-schema mature workspace without semantic data loss. **Automated for the
    `ci` profile across `0009` → current, including the `0010` document-table/FTS rebuild.**
13. Continue safely when chat, embeddings, filesystem, or network dependencies are unavailable.
    **Automated baseline:** no-model/provider/citation failures, explicit embedding fallback,
    browser/CLI/MCP unreachable and lost-response outcomes, and unavailable/unsafe filesystem
    destinations have linked executable evidence in
    [`docs/quality.md`](../quality.md). Provider soak, physical disk
    exhaustion, and platform-manual drills remain Gate-B activation work.
14. Use MCP/CLI/skills to enumerate, read, mutate, and reconcile data without silent omission or
    misleading success. **Automated:** owner-aware collections distinguish missing from empty;
    all exposed MCP mutations declare retry/destructive semantics and use safe transport retry;
    creates and model-generated artifacts have exact-once identities; removals enforce desired
    absence; task activity records machine origin; CLI/skills create safely; search/context fallback
    is structured and visible; and human verification is attended and atomically bound to reviewed
    content.
15. Build, launch, update, and recover the packaged desktop application on supported platforms.
    **Automated:** Node owns the race-free ephemeral bind and announces it to its exact Rust parent;
    webview navigation and script loading are origin-restricted; ordinary quit/restart closes
    Fastify and SQLite over a bounded cross-platform control channel; early and later sidecar exits
    produce an accessible restart screen and bounded owner-only logs. The release binary launches
    twice against isolated app data, applies all migrations, preserves a sentinel, and proves two
    graceful exits. Native release jobs make missing artifacts fatal; the container waits for every
    supported desktop package; one release publishes collision-checked assets and SHA-256 sums.
    Updating is an explicit backup/install/validate/rollback workflow; an automatic updater remains
    intentionally off until authenticated update-signing and key-rotation infrastructure exists.

## Journey evidence template

Each journey definition records:

```text
Journey ID and title:
Surfaces:
Invariant/category protected:
Fixture/profile and fixed clock:
Preconditions:
Happy-path outcome:
Delay/failure/interruption variants:
Accessibility clauses:
Machine-contract clauses:
Performance measurements (only after instrumented):
Automated evidence or reproducible drill:
Last verified revision/date:
Known gaps:
```

A solo-plus-agents project does not require a ceremonial named owner. The Git history, task, and
verification metadata provide accountability.

## Surface scorecard template

```text
Surface:
Activation state: baseline | excellence pass active | activated

Correctness:                  0–4 — evidence
Reliability and recovery:     0–4 — evidence
Human usability:              0–4 — evidence
Agent and contract usability: 0–4 — evidence
Accessibility:                0–4 — evidence
Performance:                  0–4 — evidence or "not instrumented"
Security and privacy:         0–4 — evidence
Consistency:                  0–4 — evidence
Testability and observability:0–4 — evidence
Documentation:                0–4 — evidence

Defining-category result:
Next constraint:
Release blockers:
Last verified revision/date:
```

## Release rules

Immediately, a release is rejected when:

- an invariant is knowingly violated;
- an existing test, contract, eval gate, or activated journey fails;
- a changed surface regresses its evidence-backed baseline;
- a data-integrity, trust, exposure, or misleading-success defect remains unresolved;
- documentation contradicts the released behaviour.

For a Gate-B-activated surface, a release is also rejected when its score or activated
accessibility/performance/journey evidence falls below its recorded bar.

After every surface is activated, all applicable categories must be at least 3 and defining
categories 4 for a product release.

## Adoption sequence

1. Adopt these invariants and the two-speed ratchet. **Done by this document.**
2. Keep the production-path E2E suite green. The current review-fix branch has a green suite and
   includes the edit-and-switch regression; this remains a continuous gate.
3. Resolve the known MCP QINV-10 violation by replacing silent caps with an explicit
   bounded/paginated collection contract and update MCP contract tests/documentation
   deliberately. **Done:** versioned collection envelope, exact semantic-search totals, contract
   migration, and full-suite evidence landed together.
4. Build the mature-workspace fixture and historical-schema generator. **Done:** deterministic
   `ci`/`large` profiles, semantic manifest/verifier, optional embeddings, production-app smoke,
   and `0009` → current upgrade evidence are in place without committed database binaries.
5. Complete the five Priority-0 journeys in order. **Done:** all five have production-path or
   destructive-drill evidence, including adverse persistence, portability, recovery, and assistant
   partial-success outcomes.
6. Run excellence passes by surface. **In progress:** the editor/library state-and-navigation pass
   covers save-before-exit, blocked failed exits, collection/query stale-response rejection,
   semantic loading feedback, and native keyboard activation. **Priority-1 task journey 6 is now
   automated:** the task pass covers recoverable exact-once capture, project/label organization,
   an atomic render-stable title/description/notes draft, serialized scheduling/recurrence/snooze,
   atomic exact-once regeneration, safe reopening, keyboard semantics, and truthful
   lost-response/failed-refresh outcomes. Its board/bulk/archive breadth is now production-browser
   tested at 400%-equivalent width and in a touch-only context, including explicit selection, real
   bulk completion, ordered board stacking, and reduced motion; human assistive-technology,
   cognitive, and physical-device review remains activation work. **Priority-1 knowledge retrieval
   journey 7 is now automated:** semantic HTTP
   arrays are complete, paged browser retrieval has exact totals and trust-bearing cards, and Ask
   Prax is stale-safe, fallback-explicit, citation-checked, provider-error-sanitized, and linked to
   canonical sources. Active/archive/semantic Library states now also reflow at the 400%-equivalent
   reference width without losing ownership, trust, tag, or lifecycle actions. **Priority-1
   knowledge lifecycle journey 8 is now automated:** trust follows
   reviewed versus agent origin, supersession is a database invariant across human and machine
   paths, lifecycle writes are exact-once/readback-aware, and archive/restore/delete cannot strand
   false retrieval state. Editor controls, split panes, outline, document information, and exact
   draft persistence now share the narrow reflow contract. **Priority-1 runbook journey 9 is now
   automated:** independent run
   snapshots, enforced transitions, an append-only chronicle, safe resume, exact-once start,
   serialized/readback-aware browser operation, source-deletion survival, and human/MCP contract
   agreement are proven through migration, fixture, browser, and restore evidence. **Priority-1
   import/restore journey 10 is now automated:** exact visible targeting, render-stable parsed files,
   exact-once batch and per-file retries, atomic operation evidence, commit/readback truthfulness,
   explicit plain-intake semantics, and visible/filterable/editable document ownership are proven
   through migration, SQLite, contract, renderer, and browser evidence. The Library export follow-up
   now adds explicit scope and destination selection, native/browser save handling, cancellation,
   keyboard containment, platform-safe filesystem boundaries, and full desktop/browser evidence.
   **Priority-1 deployment/settings journey 11 is now automated:** local startup is fail-closed,
   container/pod networking requires an explicit no-auth acknowledgement, shipped exposure examples
   are contract-locked, the active boundary is visible in Settings, and provider configuration is
   failure-explicit, single-flight, draft-preserving, and readback-reconciled. **Priority-2 machine
   interface journey 14 is now automated:** MCP/CLI/skills have complete enumeration contracts,
   stable mutation identities, safe reconciliation, actor/destructive metadata, explicit degraded
   retrieval, owner-aware child collections, and exact-content human verification. **Priority-2
   packaged desktop journey 15 is now automated:** endpoint ownership is race-free, navigation and
   content are origin-restricted, normal quit/restart is graceful with a bounded fallback, startup
   and post-start failure are actionable, app-data/log permissions are tightened, and the actual
   release binary proves two-launch migration/persistence/shutdown. Native packages and the
   container are now one complete checksummed release gate. **The release-wide evidence pass is now
   implemented:** baseline scorecards cover every major subsystem, the production-rendered WCAG
   gate covers critical states/themes/accents without exclusions, a versioned large-fixture
   performance instrument records candidate HTTP/browser/resource baselines, eager collection and
   editor-context remount defects exposed by that instrument are bounded/coalesced, and Journey 13
   links all four adverse dependency classes. Production-browser 400%-equivalent evidence now
   spans task views, Library/editor, active and terminal runbooks, every Settings section, and
   import/export dialogs; a long real run-step mutation remains canonical within that narrow state.
   Gate-B activation still requires manual assistive-technology/platform drills and human-approved
   performance budgets; those constraints are recorded in
   [`docs/quality.md`](../quality.md).
   The manual drill matrix, privacy-safe evidence schema, and threshold validator are now prepared.
   The 2026-07-14 large-fixture boundary has explicit human approval, but its first fresh enforcing
   run failed Library p50 (862.93 ms versus 850 ms), so performance activation remains held alongside
   the still-unrecorded real-device matrix.

Architecture work such as decomposing `public/js/main.js` is justified by the journeys and
invariants it makes safer; it is not a detached rewrite or framework migration.

## Prax dogfood and document lifecycle

The version-controlled repository copy is the canonical policy. Prax should also manage its live
operational form:

- Mirror this standard into the `moomora-console` Library as a verified **decision** named
  `Exceptional Prax — Product Quality Standard` with tags `quality-standard` and `dogfood`.
- Store each activated journey as a **runbook** tagged `quality-journey`.
- Store each surface scorecard as a **reference** tagged `quality-scorecard`.
- Link scorecards and journeys to the standard; revise in place or supersede—never create
  ambiguous duplicates.
- Record the repository path/revision in each mirrored document so the canonical source is clear.

Mirroring is not proof of compliance. Human verification, linked evidence, and executed journeys
are the proof. If Prax is unavailable when this standard changes, repository work continues and
the mirror becomes an explicit follow-up rather than silently disappearing.
