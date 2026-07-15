# Task Lifecycle and Recurrence Reliability Implementation Plan

**Goal:** Make scheduling controls coherent and recurring completion atomic, truthful, and safe to
reconcile.

**Design:** [Task Lifecycle and Recurrence Reliability](../specs/2026-07-13-task-lifecycle-recurrence-design.md)

## Work

- [x] Add pure recurrence-transition, task-patch outcome, and keyed-queue tests.
- [x] Make task update and reorder recurrence transitions transactional.
- [x] Serialize same-task UI mutations and reconcile exact lost responses.
- [x] Make recurrence completion/reopen messages truthful and controls accessible.
- [x] Add real-SQLite rollback and production-browser lifecycle evidence.
- [x] Update the quality record, run all gates, and attempt durable Prax memory.

## Verification

- `npm test` — 153/153 test files passed.
- `npm run check` — passed.
- `npm run test:e2e` — 29/29 Chromium journeys passed.
- `npx playwright test tests/e2e/task-drawer-draft.spec.js tests/e2e/task-lifecycle.spec.js --repeat-each=3`
  — 24/24 passed.
- `npx playwright test tests/e2e/list-chip-clipping.spec.js --repeat-each=10` — 10/10 passed after
  making the pre-existing shared-server regression fixture render-stable.
- `npm run verify:portable` and `npm run verify:restore` — passed.
- Prax recall and durable-memory writes were attempted, but the configured local service at
  `http://127.0.0.1:3000` was unavailable; version-controlled design, plan, and regression evidence
  remain canonical.
