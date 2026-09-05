# Manual Activation and Performance Budgets — Design

**Status:** Approved for implementation
**Date:** 2026-07-14
**Quality-standard scope:** Gate-B human evidence and performance-budget activation

## Problem

Prax has broad production-browser, WCAG-rule, recovery, fixture, and candidate-performance
evidence. It must not turn that evidence into claims it cannot support. Four human clauses remain:

- a real screen reader must announce and operate the critical journeys;
- an independent cognitive walkthrough must expose misleading language, hidden state, and recovery
  ambiguity;
- real touch hardware must operate the responsive product without hover or precision-pointer help;
- each supported native artifact family must install, launch, persist, restart, and use its
  operating-system dialogs successfully.

Performance has an instrument and an 11-sample candidate baseline, but no person has approved the
point at which slower feedback ceases to feel excellent. Candidate numbers therefore cannot be
silently promoted into release gates.

## Outcomes

### 1. Reproducible manual evidence

Manual evidence is stored as versioned JSON and validated before it can support a scorecard. Each
record identifies the candidate revision, operator role, date, real device/OS, browser or native
artifact, assistive technology where applicable, and the result of every required journey.

The four evidence lanes are independent:

| Lane | Minimum matrix | Human boundary |
|---|---|---|
| Screen reader | macOS VoiceOver, Windows NVDA, Ubuntu Orca | Real speech/braille navigation and control operation; accessibility-tree inspection alone does not count. |
| Cognitive walkthrough | At least one reviewer who did not implement the candidate | Goal-based prompts without UI-specific instructions; record assistance, wrong turns, misleading feedback, and recovery comprehension. |
| Physical touch | iOS/iPadOS Safari and Android Chrome on real hardware | Touch-only portrait and landscape operation; browser device emulation does not count. |
| Native platform | macOS arm64 and Ubuntu x64 release artifacts (scope reduced by the user on 5 September 2026) | Install/launch, persistence across two launches, restart/recovery, native import/export dialogs, and uninstall/update expectations. |

An evidence record may say `fail` or `blocked`; the validator preserves that truth. Only a complete
record whose required checks all pass is activation evidence. A failure must name an issue or give
an actionable observation. An operator attestation is required; generated or inferred attestations
are invalid.

### 2. One deterministic drill workspace

The runbook uses the existing `ci` quality fixture for shorter interaction drills and the `large`
fixture for performance and long-collection observation. Drills use disposable database copies,
never the operator's live Prax database. Named goal prompts cover shell/navigation, task lifecycle,
Library/editor/trust, runbook operation, import/export, Settings/provider state, and recovery
feedback. The exact same prompt IDs appear in evidence files.

### 3. Approval-ready performance budgets

A versioned budget manifest separates three states:

- `proposed`: thresholds are review material and cannot gate a release;
- `approved`: a named human, date, reference machine, harness command, and rationale are present;
- `retired`: historical evidence only.

Budget verification consumes an approved manifest plus a raw `prax.quality-performance` report.
It rejects fixture/profile/sample mismatches, missing measurements, a reference machine that does
not match the declared class, or any p50/p95/resource value over budget. The raw measurement report
remains `candidate-baseline-only`; approval lives in the separate human-owned manifest so the
measurement tool cannot self-authorize its result.

The initial proposal uses the corrected 2026-07-13 baseline as evidence and is refreshed on the
current candidate. Thresholds need both observed headroom and a stated human feedback boundary;
they are not calculated by an unexplained multiplier.

## Required journeys

All manual lanes use the applicable subset of these stable IDs:

- `shell-navigation`
- `task-lifecycle`
- `library-editor-trust`
- `runbook-operation`
- `import-export-native-dialog`
- `settings-provider-status`
- `failure-recovery-comprehension`
- `touch-orientation`
- `native-install-persist-restart`

The runbook defines exact actions and observable pass criteria for each lane. Evidence records the
result, concise notes, and issue references rather than screenshots containing private workspace
content. Screenshots or recordings may be referenced as optional local artifacts.

## Safety and claim boundary

- No automated tool may mark a manual record passed or invent an operator attestation.
- No template, partial record, emulator run, CI native build, or accessibility-tree snapshot counts
  as human evidence.
- No proposed budget is a Gate-B release check.
- Manual drills use loopback services and disposable fixture databases except the physical-touch
  lane. A real phone/tablet may use a firewall-restricted isolated private network with Prax's
  explicit no-auth acknowledgement; it must never use live data or a public route.
- Failed checks keep the relevant score at its current baseline and become actionable product work;
  they are not averaged away.

## Verification

- Unit tests cover evidence schema, matrix completeness, honest failed/blocked records, duplicate
  journey rejection, human attestation, proposal-versus-approved budgets, report compatibility,
  and threshold failures.
- CLI smoke tests validate the committed templates/proposal without claiming activation.
- `npm test`, `npm run check`, the complete browser suite, and `git diff --check` remain required.

## Non-goals

- Simulating VoiceOver, NVDA, Orca, cognition, or physical touch and calling it manual evidence.
- Approving a performance boundary on the user's behalf.
- Committing private recordings or personal medical/accessibility information.
- Expanding the supported native platform matrix in this pass.
