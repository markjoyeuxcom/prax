# Durable runbook operations implementation plan

**Spec:** [2026-07-13-durable-runbook-operations-design.md](../specs/2026-07-13-durable-runbook-operations-design.md)
**Status:** Complete

## 1. Durable persistence and state machine

- [x] Add migration `0013` for independent run snapshots, finish provenance, and event history.
- [x] Backfill the recoverable legacy chronology without fabricating provenance.
- [x] Make start, step changes, and status changes transactional and idempotent.
- [x] Enforce running/aborted/completed transitions and protect terminal records.
- [x] Prove source deletion cannot delete historical runs.

## 2. HTTP and machine contract

- [x] Accept caller-stable run identifiers and reject conflicting reuse.
- [x] Restrict run start to live runbook documents and return lifecycle conflicts explicitly.
- [x] Include events and snapshotted source context in run reads.
- [x] Create post-mortems from run snapshots when the source document is gone.
- [x] Align MCP schemas, descriptions, and contract documentation with the shared state machine.

## 3. Truthful browser operation

- [x] Reuse one client UUID across start retries and guard double activation.
- [x] Serialize step and status writes per run and disable conflicting controls while pending.
- [x] Reconcile rejected or lost responses through canonical run readback.
- [x] Add explicit Resume for aborted runs and preserve completed runs as read-only.
- [x] Render and copy the ordered actor-attributed event chronicle.

## 4. Production-path evidence

- [x] Automate start, step changes, interruption, navigation, reopen, resume, and finish.
- [x] Prove lost start/status responses cannot duplicate state.
- [x] Prove delayed step writes settle before completion.
- [x] Prove completed runs cannot be rewritten through HTTP or MCP.

## 5. Gates and adoption record

- [x] Update deterministic current/historical fixtures and migration/restore expectations.
- [x] Run focused repository, route, frontend, MCP, SQLite, and browser tests.
- [x] Run `npm test`, `npm run check`, `npm run test:e2e`, and `npm run eval`.
- [x] Run portability/restore drills and `git diff --check`.
- [x] Mark the spec, plan, and exceptional-quality journey evidence complete.

## Verification

- `npm test`: 157/157 test files.
- `npm run check`: passed, including the run repository, renderer, and outcome matcher.
- `npm run test:e2e`: 42/42 production-browser journeys.
- Focused runbook browser suite: 3/3.
- `npm run eval`: 7/7 cases, 100% recall.
- `npm run verify:portable`: passed for 200 tasks and 150 checklist items.
- `npm run verify:restore`: passed at schema `0013` for the large current live-WAL drill and
  `0009` historical upgrade, including event-ledger verification.
- `git diff --check`: clean.
- `npm run eval:nl`: not runnable without a configured chat backend; this journey did not change
  natural-language parsing or generation behavior.
