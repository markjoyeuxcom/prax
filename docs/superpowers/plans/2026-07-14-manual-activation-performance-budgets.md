# Manual Activation and Performance Budgets — Implementation Plan

**Design:** [`../specs/2026-07-14-manual-activation-performance-budgets-design.md`](../specs/2026-07-14-manual-activation-performance-budgets-design.md)

## Evidence contract

- [x] Add a versioned validator for individual manual records and aggregate matrix completeness.
- [x] Require real environment metadata, human attestation, all lane-specific journeys, and honest
      issue-bearing failures.
- [x] Add unit evidence for pass, fail, blocked, duplicate, missing-matrix, and generated-attestation
      rejection paths.

## Human drill pack

- [x] Document disposable fixture preparation and cleanup.
- [x] Define exact screen-reader, cognitive, physical-touch, and native-platform actions and pass
      observations.
- [x] Add fillable evidence templates that deliberately do not validate until a human completes
      them.
- [x] Document the platform matrix and the difference between prepared, recorded, and activated.

## Performance budgets

- [x] Refresh the 11-sample `large` candidate report on declared hardware.
- [x] Add a versioned proposed budget with explicit rationale and reference constraints.
- [x] Add a validator that refuses proposed/unattested budgets and checks approved thresholds
      against compatible raw reports.
- [x] Present the proposal for explicit human approval. The project owner supplied the exact
      approval attestation on 2026-07-14; the first fresh gate then honestly failed Library p50 at
      862.93 ms against 850 ms. A revised boundary or product improvement requires a new decision.

## Quality record and verification

- [x] Link the manual pack and budget proposal from the scorecards and quality standard without
      raising scores prematurely.
- [x] Run focused tests, `npm test` (173/173), `npm run test:e2e` (66/66), `npm run check`, and
      `git diff --check` on 2026-07-14.
- [x] Persist the durable activation-evidence contract to Prax memory as
      `add15be5-257f-4d50-9cfc-92a3f50bafb8` on 2026-07-14.
