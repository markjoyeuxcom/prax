# Trustworthy Import and Restore Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-13-trustworthy-import-restore-design.md`

## 1. Exact-once task import storage

- Add migration `0014_add_task_import_operations.sql` with durable request identity, normalized intent
  hash, result snapshot, and project/mode metadata.
- Extend the task repository with one transactional operation method that checks replays inside the
  same write transaction, mutates tasks/checklists, and records the result atomically.
- Preserve the existing import methods for compatibility and focused unit tests.

## 2. HTTP contract

- Validate optional UUID `requestId`.
- Hash cleaned pre-deduplication intent.
- Route caller-identified imports through the exact-once repository path.
- Return `replayed`, use `409` for conflicting identity reuse, and document the additive contract.
- Cover first commit, exact replay, conflict, zero-row replay, and injected rollback.

## 3. Durable Settings state

- Add explicit destination, parsed filename/payload, pending/error/result, and retained retry identity
  to application state.
- Capture a valid destination when entering Settings.
- Parse the file on change and retain it across mode/destination re-renders.
- Render an explicit destination select, retained-file summary, actionable status, and pending lock.

## 4. Truthful submit/reconciliation

- Send `requestId` from the browser API client.
- Serialize submit, reuse the UUID for unchanged retry intent, and distinguish transport/rejection
  from a known commit.
- Separate canonical task refresh from the committed import outcome.
- Clear the chosen file only after the committed result has been presented.

## 5. Truthful loose Markdown intake

- Initially label the action as plain Markdown intake and explain that files become source notes.
- Prevent concurrent processing, report failed filenames/counts, and separate refresh failure from
  the already committed per-file outcomes.
- Align README, contract, and quality-fixture wording.

This interaction was subsequently superseded by the destination-selecting, caller-ID exact-once
dialog in `2026-07-13-project-owned-library-import-dialog.md`.

## 6. Browser and gate evidence

- Add production-server E2E for correct destination, retained file, repeat activation, safe retry
  after a lost response, and truthful refresh failure.
- Run focused unit/contract/integration tests while iterating.
- Run `npm test`, `npm run check`, `npm run test:e2e`, portable round-trip, and restore drills.
- Update the exceptional-quality evidence matrix and attempt to remember the durable runbook in Prax.

## Completion evidence

- `npm test`: 157 test files passed.
- `npm run check`: passed.
- `npm run test:e2e`: 46/46 production-server browser journeys passed, including all four
  import/restore cases.
- `npm run verify:portable`: 200 tasks and 150 checklist items round-tripped with the pinned
  semantic digest.
- `npm run verify:restore`: current live-WAL and historical `0009` destructive restores both
  migrated/verified at `0014_add_task_import_operations.sql` and booted the production app.
- SQLite integration proves same-ID replay, changed-ID-intent conflict, and transactional
  deduplication across concurrent distinct skip-mode operations.
- Injected checklist failure proves task rows and the import-operation record roll back together.
