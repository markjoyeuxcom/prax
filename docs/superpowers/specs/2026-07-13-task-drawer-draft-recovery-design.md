# Task Drawer Coherent Draft Recovery — Design

**Date:** 2026-07-13
**Status:** Implemented and verified
**Quality gate:** QINV-01, QINV-02, QINV-03, and QINV-09 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

The task drawer saves title, legacy description, and notes through three independent debounces.
Only notes are mirrored into client state. An unrelated drawer action can therefore re-render and
replace a newly typed title or description with the older saved value before its timer fires.
Closing, switching, opening a linked document, or archiving does not await any of the timers; a
process exit inside that window loses the edit. Failures either disappear silently or leave no
explicit retry state.

## Draft contract

The three text fields form one coherent task draft:

- input mirrors title, description, and notes immediately into state;
- one debounce writes one atomic PATCH carrying all three fields;
- an origin-local recovery record stores the saved base plus exact draft before acknowledgement;
- an unrelated drawer render reads the draft, never the stale task snapshot;
- an acknowledgement clears recovery only when it matches the exact sent draft; and
- typing during an in-flight save remains dirty and schedules the newer revision.

Blank titles do not write and produce an actionable in-drawer status. A failed request performs one
canonical GET: if the response was lost after commit, the observed matching task is acknowledged
without a duplicate PATCH. Otherwise the draft remains locally protected with an explicit Retry.

## Exit and conflict contract

Closing or switching the drawer, opening a linked document, starting a task lifecycle archive, and
other actions that discard the drawer context wait for the current draft. A failed save keeps the
drawer open. Reloading and reopening restores a draft when the stored base still matches. If both
the server copy and local draft changed, automatic save stays paused until the person explicitly
confirms replacement.

Immediate non-text task controls may re-render while a text draft exists; the mirrored draft must
remain visible and later commit as one coherent text revision.

Task-linked documents, checklist, and activity load concurrently. Only the newest drawer context
may install its result. Before any full application render replaces an active drawer, the live
three-field DOM draft is captured into state and local recovery. This closes the narrow browser
race between a control's value changing and its input event reaching the delegated handler.

## Evidence

Pure tests own dirty comparison, recovery/obsolete/conflict classification, and conditional clear.
Production-path Playwright owns:

- title/description/notes surviving an intervening priority render and committing together;
- close waiting behind a delayed PATCH;
- failed close remaining in the drawer with Retry;
- reload/reopen restoring the exact protected draft; and
- a rapid retry committing one exact PATCH, including lost-response reconciliation.

**Verified:** 2026-07-13 on `codex/resolve-review-findings`; the original four browser journeys
passed three consecutive runs (12/12), the expanded conflict-aware suite passed 5/5, followed by
`npm test` (151/151 files), `npm run test:e2e` (26/26 journeys), `npm run check`,
`npm run verify:portable`, and `npm run verify:restore`.
