# Release-wide Evidence Pass — Implementation Plan

**Design:** [`../specs/2026-07-13-release-wide-evidence-design.md`](../specs/2026-07-13-release-wide-evidence-design.md)

## Accessibility gate

- [x] Add the official Playwright axe integration as a pinned development dependency.
- [x] Audit the production-rendered task, Library, editor, runbook, Settings, import, export, and
      capture states against WCAG A/AA rules.
- [x] Fix every automatically detected violation without rule exclusions.
- [x] Keep existing keyboard, focus-containment, and focus-return journeys green.

## Performance instrument

- [x] Add tested percentile/report validation helpers and explicit CLI parsing.
- [x] Generate and verify a temporary `large` fixture, boot the real app on port zero, and measure
      warm HTTP and browser feedback/completion journeys.
- [x] Capture declared machine/runtime/resource metadata and emit versioned JSON.
- [x] Document the command and record one candidate local baseline without activating a budget.
- [x] Fix the eager collection/editor-context remount defects exposed by the first large baseline,
      preserving explicit full counts and visible keyboard order.

## Adverse dependency and scorecard evidence

- [x] Protect an unavailable filesystem destination and prove source/owned-artifact safety.
- [x] Link the existing chat, embedding, and network failure evidence into Journey 13.
- [x] Publish baseline scorecards for all major subsystems with explicit gaps and constraints.
- [x] Update the exceptional-quality adoption sequence and evidence command table.

## Verification

- [x] Run targeted unit, browser-accessibility, and performance commands.
- [x] Run `npm test`, `npm run test:e2e`, `npm run check`, and `git diff --check`.
- [x] Attempt to persist the durable evidence/runbook finding in Prax memory; the local Prax
      service remained unavailable at `http://127.0.0.1:3000`, so the repository documents remain
      canonical and the memory mirror is an explicit follow-up.
