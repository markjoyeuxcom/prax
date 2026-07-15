# Release-wide Evidence Pass — Design

**Status:** Approved for implementation
**Date:** 2026-07-13
**Quality-standard scope:** cross-surface scorecards, accessibility, performance, and Journey 13

## Problem

Prax now has strong journey-specific correctness and recovery evidence, but the product-wide claim
is still incomplete in three important ways:

1. accessibility assertions are distributed across individual tests and do not run a consistent
   WCAG audit over the major rendered application states;
2. the deterministic `large` fixture exists, but there is no repeatable instrument for startup,
   HTTP, browser-feedback, browser-completion, and resource baselines;
3. chat, embedding, network, and filesystem failures have substantial test coverage, but Journey
   13 has no single evidence inventory and the backup filesystem failure case is not protected.

An exceptional-product standard must distinguish measured evidence from confidence. This pass
therefore creates an honest baseline and closes automatable gaps; it does not manufacture scores
or performance budgets.

## Outcomes

### 1. Automated accessibility baseline

Add `@axe-core/playwright`, following Playwright's documented integration, and run its WCAG A/AA
rules against production-rendered critical states:

- task list and task detail;
- quick capture;
- Library collection and document editor;
- runbook execution;
- Settings;
- Markdown import and Library export dialogs.

The gate fails on every automatically detected violation in the selected WCAG tags. It is not
described as a screen-reader certification: keyboard journeys, focus containment/return, zoom,
reduced motion, contrast, and assistive-technology semantics remain explicit scorecard clauses.
Any defect discovered by the scan is fixed at the shared component/style layer where practical.

### 2. Reproducible large-fixture performance instrument

Add one command that owns a temporary `large` fixture, boots the real production app on an
ephemeral loopback port, launches the installed Chromium build, and records:

- fixture-generation and application-ready duration;
- p50/p95 HTTP duration for representative task, Library, search, and detail reads;
- p50/p95 browser feedback/completion duration for initial task rendering, Library rendering,
  document opening, and quick-capture feedback;
- Node RSS and database size;
- runtime, operating-system, CPU, memory, fixture manifest, warm-up count, and sample count.

The report has a versioned JSON shape and validates that all measurements are finite and
non-negative. The initial run is a candidate baseline only. Numerical release budgets remain
inactive until the declared reference hardware and human excellence thresholds are agreed, as
required by the quality standard.

The first `large` run exposed a real browser-scale defect even though API reads remained fast:
task/document collections eagerly mounted every result and editor context reads independently
rebuilt/remounted the editor. This pass therefore also bounds initial task/document/card rendering
with explicit full counts and “show more” controls, limits task enrichment reads to mounted items,
prioritizes an interactive shell/task workspace during startup, and installs independent editor
context reads in one stale-guarded render. These are evidence-driven corrections, not activated
budgets.

### 3. Adverse-dependency journey inventory

Journey 13 becomes automated only when its four named dependency classes have linked evidence:

- **chat:** no provider, provider rejection, citation rejection, and post-commit provider failure
  remain degraded or partial-success outcomes rather than misleading generic failure;
- **embeddings:** disabled/unavailable providers are explicit and Ask/context retrieval falls back
  without leaking provider errors;
- **network:** browser, CLI, and MCP consumers expose unreachable/lost-response states and retry
  only stable identities;
- **filesystem:** backup/restore/export refuse unsafe targets, clean partial owned artifacts, and
  do not damage the source when a destination cannot be created.

The missing destination-creation case is added to the backup tests. The scorecard links the
specific executable evidence instead of duplicating it in a ceremonial umbrella test.

### 4. Evidence-backed baseline scorecards

Create one release-wide scorecard document with a section for each major subsystem. Every category
is scored only where the linked evidence supports it. Accessibility is limited by the distinction
between automated scans and manual assistive-technology evidence. Performance remains **not
activated** even after the harness exists. No surface is activated unless every Gate-B clause is
actually met.

## Release integration

- `npm run test:e2e` owns the WCAG gate.
- `npm run measure:performance` is reproducible evidence but is not added to ordinary CI until a
  numerical budget is activated; Chromium plus the large fixture is intentionally heavier than a
  correctness test.
- `npm test` owns report-shape/quantile logic and the adverse filesystem regression.
- `npm run check` syntax-checks the new measurement entry point.

## Non-goals

- Claiming that axe replaces manual screen-reader, zoom, or cognitive-usability review.
- Choosing arbitrary latency budgets from a single developer machine.
- Averaging weak defining categories into an "excellent" surface score.
- Broad visual redesign unrelated to defects found by the new evidence.
