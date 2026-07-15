# Mature Workspace Quality Fixture Implementation Plan

**Goal:** Deliver the deterministic CI/large fixture, semantic manifest, verifier, and
historical-schema upgrade path required by Step 4 of the Exceptional Prax adoption sequence.

**Design:** [Mature Workspace Quality Fixture](../specs/2026-07-13-quality-fixture-design.md)

## Work

- [x] Add a validated `through` boundary to the production migration runner.
- [x] Implement deterministic profile seeding, manifest publication, and semantic verification.
- [x] Add the fixture CLI, package script, contributor documentation, and generated-artifact guard.
- [x] Test current-schema coverage and a `0009` → current semantic upgrade.
- [x] Generate and verify both `ci` and `large` artifacts under a temporary directory.
- [x] Run the complete test and syntax gates and update the quality standard with evidence.
- [x] Attempt the durable Prax-memory write. The local service was unavailable, so
  `docs/quality-fixture.md` remains the authoritative runbook until it can be retried.
