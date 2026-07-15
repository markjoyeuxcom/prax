# Durable runbook operations design

**Status:** Implemented and verified
**Date:** 2026-07-13
**Surface:** Runbook execution, interruption, resumption, completion, and chronicle history
**Quality gate:** QINV-02, QINV-03, QINV-04, QINV-05, QINV-06, and QINV-11 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

Prax can start a runbook and store its current checkbox state, but the current model is a mutable
snapshot rather than a durable operational record:

1. Unchecking a step erases who checked it and when. Aborting and resuming similarly overwrite
   status rather than recording an event, so the displayed chronicle cannot explain what happened.
2. Deleting the source document cascades into every past run. A completed operational record is
   therefore less durable than the editable instructions from which it began.
3. Run and step routes accept invalid transitions. A completed run can be reopened or rewritten
   through HTTP/MCP, and repeated finish requests replace the original completion time.
4. Starting a run has no caller-stable identifier. A lost response or double activation can create
   duplicate runs even though only one operation was intended.
5. Browser step and status writes are independent. A delayed checkbox response can race Finish,
   and a rejected or lost response is reported without canonical reconciliation.
6. Aborted runs can technically be reopened by the machine API, but the browser offers no explicit
   Resume action and neither surface exposes a complete actor-attributed timeline.

## Journey contract

The activated journey is:

1. Start a runbook exactly once and snapshot the instructions, title, project, and actor needed to
   understand the operation independently of later source edits or deletion.
2. Check and uncheck steps while running, with every actual change appended to the chronicle.
3. Interrupt the operation by aborting it, preserving the actor and original interruption time.
4. Leave the run, return later, and reopen the same durable record.
5. Resume only an aborted run; a completed run is terminal.
6. Finish after all intended step mutations settle, preserving the actor and first completion time.
7. Read or copy a truthful chronological history containing start, step changes, interruption,
   resumption, and completion.
8. If a response is lost, retry safely or read canonical state before reporting the outcome. A
   double activation, retry, or same-state replay must not duplicate a run or event.

## Design

### Independent run snapshots

Migration `0013` makes the source document reference nullable with `ON DELETE SET NULL` and stores
the source title and project on each run. The instructions are already snapshotted as run steps.
Together those fields make a run independently readable and allow post-mortem creation while its
snapshotted project still exists.

Deleting a project may clear the project reference, but never deletes the run. Deleting a run
remains the only operation that may cascade into its steps and events; no such product action is
introduced by this journey.

### Append-only chronicle

A new `runbook_run_events` table records a monotonic sequence per run. Event types are `started`,
`step-checked`, `step-unchecked`, `aborted`, `resumed`, and `completed`. Each event stores its actor,
time, and, for step events, the step identifier and snapshotted text.

Creating a run, changing a step, and changing run status each update the materialized current state
and append the corresponding event in one database transaction. A request that already matches
current state is an idempotent read: it preserves timestamps and actors and appends no event.
Migration backfill reconstructs the truthful history available from legacy snapshots without
inventing actors that were never stored.

### Enforced lifecycle

The repository is the shared state machine for browser and MCP traffic:

- `running` may become `aborted` or `completed`;
- `aborted` may become `running` and emits `resumed`;
- `completed` is terminal;
- steps may change only while the run is `running`;
- replaying the current step value or status is allowed and has no side effect;
- all other transitions return a conflict with canonical state still available by readback.

The first abort/completion time and actor are preserved on same-state replay. Resuming clears the
materialized finish fields because the current run is active again, while the interruption remains
in the event ledger.

### Exactly-once start intent

The browser generates a UUID before starting and submits it as the run identifier. Replaying that
identifier with the same source and title returns the existing run; reusing it for a different
intent is a conflict. The server still generates an identifier for older callers that omit one.
Only live documents of type `runbook` may start a run.

### Serialized and reconciled browser operation

Browser mutations are serialized per run. Finish or Abort waits for every previously submitted
step mutation, and controls are disabled while a mutation is pending. After a rejected mutation,
the browser fetches the canonical run and renders that state before describing the result. Start
retries reuse the same identifier, so a lost response cannot create another operation.

Aborted runs expose Resume; completed runs expose no mutating controls. The run view and copied
chronicle render the ordered event ledger with actors and times, while the checkbox snapshot remains
the concise present-state summary.

## Evidence

- Repository and SQLite integration evidence for event atomicity, idempotency, transition
  conflicts, exact-once start, source-deletion survival, and post-mortem creation.
- Frontend evidence for event rendering, actor-attributed copied chronicles, serialized mutations,
  and canonical outcome comparison.
- Production-browser evidence for start → check → uncheck → abort → leave → reopen → resume →
  finish, plus lost-response and delayed-mutation cases.
- MCP contract evidence that the machine surface shares the lifecycle and exposes the event ledger.
- Current/historical fixture, migration, backup/restore, portability, syntax, unit, browser, and
  retrieval gates.

## Out of scope

- Editing a runbook's instructions after a run has started.
- Concurrent multi-user merge semantics beyond ordered, transactional request processing.
- Deleting individual historical events or completed runs.
- General document version history; this ledger is specific to operational run execution.
