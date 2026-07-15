# Task Capture and Organization Reliability Implementation Plan

**Goal:** Make task capture recoverable, exact-once under ambiguous failure, truthful after refresh
degradation, and fully organizable from the task drawer.

**Design:** [Task Capture and Organization Reliability](../specs/2026-07-13-task-capture-organization-design.md)

## Work

- [x] Add exact create-outcome, retry-identity, and capture-recovery helpers with pure tests.
- [x] Make client-ID task creation idempotent through the production repository and route.
- [x] Preserve capture state across failure/reload and reconcile lost responses without replay.
- [x] Separate acknowledged creation from collection refresh and guard pending capture interaction.
- [x] Add accessible capture submit/busy semantics and task project reassignment.
- [x] Add real-SQLite and production-browser capture/organization evidence.
- [x] Update the quality record, run all gates, and attempt durable Prax memory.

## Verification

- `npm test` — 155/155 test files passed.
- `npm run check` — passed.
- `npm run test:e2e` — 34/34 Chromium journeys passed.
- `npx playwright test tests/e2e/task-capture-organization.spec.js --repeat-each=2` — 10/10
  passed, including lost create/project responses and a delayed pending-create barrier.
- `npm run verify:portable` and `npm run verify:restore` — passed.
- Prax recall and durable-memory writes were attempted, but the configured local service at
  `http://127.0.0.1:3000` was unavailable; version-controlled design, plan, and regression evidence
  remain canonical.
