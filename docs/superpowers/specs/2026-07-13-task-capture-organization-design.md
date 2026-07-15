# Task Capture and Organization Reliability — Design

**Date:** 2026-07-13
**Status:** Implemented and verified
**Quality gate:** QINV-01, QINV-02, QINV-03, QINV-09, and QINV-11 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

Quick capture guards two simultaneous Enter events in one page, but its POST is not safe after an
ambiguous transport failure. If the server commits and the response is lost, the overlay reports
failure and a retry creates a second task. A successful create followed by a failed task-list
refresh is also caught as if creation failed. While a request is in flight, the overlay remains
editable and dismissible, so an older completion can erase a newly opened capture.

Typed capture state is only in memory. Reloading during an unfinished or uncertain capture loses
the title, destination, parsed preview, and safe retry identity. The overlay has no direct submit
button, incomplete dialog/busy semantics, and project options do not all expose selection state.

Organization is incomplete after creation: the API supports project reassignment, but the task
drawer exposes no project control. A task captured into the wrong project cannot be corrected from
the UI.

## Creation identity and acknowledgement contract

The production UI gives every capture attempt a client-generated UUID and sends it as the task ID.
The create route treats that ID as the retry identity:

- the first matching request creates the task and returns `201`;
- an exact replay returns the existing task with `200` and never creates another row; and
- reuse of the ID with different task content returns `409` rather than claiming success.

Legacy clients that omit an ID keep the existing server-generated-ID `201` behavior. The task
response shape does not change.

If the create response fails, the UI performs one canonical read by the generated ID. An exact
match acknowledges a lost success response without replaying the POST. If acknowledgement remains
uncertain, the overlay preserves the draft and retry identity; an unchanged retry is safe.

Creation success and cache refresh are separate outcomes. After an acknowledged create, the
overlay closes and its recovery record clears. A failed collection refresh reports “added; reload
to show it” and must never be described as a failed create.

## Draft and concurrency contract

Capture state is stored locally as a versioned recovery record while non-empty or while a request
is uncertain. It includes the visible title, destination/defaults, NL preview state, and any pending
request payload/identity. Reload restores the overlay and marks it as recovered. Explicit cancel or
acknowledged success clears the record.

While submission is pending, capture input, project selection, submit, scrim dismissal, and Escape
closure are disabled. This prevents an older response from erasing newer capture intent. Failure
re-enables the exact preserved draft. Editing a failed draft starts a new request identity; retrying
it unchanged reuses the existing identity.

## Organization and accessibility contract

The task drawer exposes an explicitly named native project selector containing every active or
on-hold project currently available to the UI. Reassignment uses the existing same-task mutation
queue and exact readback reconciliation, so it cannot overtake other task edits.

Quick capture is an `aria-modal` dialog with an explicit task-title label, busy state, live status,
a named project picker, selection state on every project option, and a native **Add task** button.
Enter and the keyboard shortcut remain equivalent paths. Pending controls are disabled rather than
accepting actions that cannot be honored safely.

## Evidence

- repository/route tests cover first create, exact replay, and conflicting ID reuse;
- capture recovery and exact create-outcome helpers have pure tests;
- real SQLite evidence proves two identical requests create exactly one row;
- render tests cover dialog, busy, submit, project-option, and drawer-project semantics; and
- Playwright drives keyboard capture, shorthand organization, destination selection, lost-response
  acknowledgement, pending-submit barriers, failed refresh truthfulness, reload recovery, lost
  project-response reconciliation, render-stable label entry, project reassignment, and labels
  through the production server.

Verified on 2026-07-13 with `npm test` (155/155 files), `npm run check`,
`npm run test:e2e` (34/34 Chromium journeys), a 10-run focused capture/organization stress pass,
`npm run verify:portable`, and `npm run verify:restore`.
