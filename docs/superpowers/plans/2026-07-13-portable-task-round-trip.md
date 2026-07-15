# Portable Task Round-Trip Implementation Plan

**Goal:** Complete Priority-0 journey #3 with fixture-backed proof that every declared portable
task/checklist semantic survives export into a fresh Prax instance.

**Design:** [Portable Task Round-Trip](../specs/2026-07-13-portable-task-round-trip-design.md)

## Work

- [x] Validate the v1 import envelope and preserve exact declared string fields.
- [x] Make shipped SQLite task + checklist import atomic, including replace mode.
- [x] Add the reusable fixture-backed production-route round-trip drill and report.
- [x] Add contract, rollback, semantic mismatch, and full `ci` fixture evidence.
- [x] Document the drill and update the exceptional-quality journey status.
- [x] Run all quality gates and attempt the durable Prax-memory write.

Verification: `npm test` (148/148 files), `npm run test:e2e` (16/16 journeys),
`npm run check`, `npm run verify:portable`, and `git diff --check` passed on 2026-07-13.
The required durable-memory write was attempted, but the local Prax service was unavailable at
`http://127.0.0.1:3000`; rerun the documented `prax-remember` command when it is online.
