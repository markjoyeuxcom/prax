# Task Lifecycle and Recurrence Reliability — Design

**Date:** 2026-07-13
**Status:** Implemented and verified
**Quality gate:** QINV-02, QINV-03, QINV-09, and QINV-11 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

Scheduling, snoozing, status, and recurrence controls all issue independent task PATCHes. Two
overlapping controls can install full-task responses out of order, so the drawer may show an older
state than the database. A lost success response is reported as failure even when the requested
lifecycle change committed.

Recurring completion is currently a non-atomic two-write operation: the occurrence is marked
complete and the next occurrence is then created on a silent best-effort path. Regeneration can
fail while the UI reports ordinary completion. Reopening and completing the old recurring
occurrence again can also create another successor because the already scheduled successor is not
part of the undo contract.

## Mutation and acknowledgement contract

All PATCH mutations for the same task run through one keyed serial queue, including coherent text
draft saves. Different tasks remain independent. A failed PATCH performs one canonical GET while
the queue is still held. An exact patch match acknowledges a lost response without repeating the
write; a mismatch remains a failure and reloads canonical state.

Nullable scheduling values compare by API meaning (`''` and `null` both mean cleared). Labels
compare as ordered normalized arrays. Unknown or unobservable patch fields never produce a false
acknowledgement.

## Recurrence transition contract

A transition from non-completed to completed with recurrence is one database transaction:

1. read the prior occurrence under the write transaction;
2. update the occurrence;
3. calculate and create exactly one future planned occurrence; and
4. commit both writes, or roll both back.

The same rule applies when a board reorder changes status. Activity remains best-effort metadata
after the authoritative transition; it cannot determine lifecycle success.

The existing task response shape remains unchanged. A successful recurring completion therefore
means the successor is committed. The client reloads the task collection and reports “next
occurrence scheduled.” A lost response is safe to reconcile from the completed source because the
source and successor committed atomically.

Reopening a completed recurring occurrence preserves the successor that already carries the
series forward and clears recurrence from the reopened historical occurrence. The UI describes it
as a one-off; completing it again cannot generate a duplicate successor. This deliberately avoids
deleting or mutating a future occurrence that may already contain user work.

## Scheduling and accessibility contract

Due date/time, recurrence, snooze, unsnooze, status, and priority controls remain native keyboard
controls. Date/time inputs have explicit accessible names. Choice groups have group labels and
selected pills expose `aria-pressed`. A due-time mutation cannot overtake its preceding due-date
mutation. Snooze state and exact due values must persist through the production API.

## Evidence

- pure transition tests cover spawn, no-op, and reopen-as-one-off planning;
- queue tests prove same-task serialization, cross-task independence, and recovery after failure;
- patch-outcome tests cover exact and nullable acknowledgement;
- real SQLite failure injection proves successor creation failure rolls back completion;
- route/integration evidence proves one successor and no duplicate after reopening; and
- Playwright drives due date/time, recurrence, snooze, keyboard activation, delayed serialization,
  a lost recurring-completion response, and a committed-completion/failed-refresh outcome through
  the production server.

Verified on 2026-07-13 with `npm test` (153/153 files), `npm run check`,
`npm run test:e2e` (29/29 Chromium journeys), a 24-run focused drawer/lifecycle stress pass, and a
10-run focused chip-clipping stability pass discovered during full-suite verification.
