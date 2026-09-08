# Today week-ahead review — 4ab4834

Codex report mirrored verbatim from `.local-review-backups/codex-today-week-review-4ab4834.md` (2026-09-08). Its e2e attempt was blocked by a test server left on port 3199 by its own first run; the suite passed locally before the MR was opened (121 passed) and on the MR pipeline (browser-tests, 275 s).

---

# MR !4 Today/week-ahead review — 4ab4834

## Implemented

Reviewed diff ff9a93a..4ab4834. The working tree was clean.

The Today merge is correct across the requested cases:

- renderToday.js:35-86 filters to open, non-snoozed tasks; removes today's planned tasks from due/week buckets; keeps planned rows; emits tomorrow through exactly +7 local calendar days using addDays/isoDate; groups by day; drops empty days; and reports weekCount. dueTime remains available to dueFlag/chips while date grouping intentionally uses the task's local dueDate.
- The badge remains overdue + today + planned and excludes the week ahead, as the implementation comment and tests state.
- main.js:3680-3685 removes week groups from the collection while collapsed, so flatIds, keyboard navigation, and collection progress cannot address hidden rows. On expansion it uses a distinct taskCollectionLimit key and renders the visible week groups. limitTaskGroups retains totalCount for the selected collection, so a count/progress is not silently reset.
- renderToday.js:121-143 renders the week section only when weekCount is nonzero. It uses a real type=button, data-action=toggle-section, the stable today:week key, and aria-expanded true/false. Existing action handling and keyboard button semantics apply.
- renderShell.js removes the rail Upcoming item and adds a Next 7 days count. The old Upcoming module/nav case/tests are removed.
- Grep found no stale product code assuming navType upcoming or a Today soon group. Remaining soon references are dueFlag/chip/filter/daily-brief semantics, and remaining Upcoming references are historical design/review material or Plan-mode wording, not the removed navigation surface.

No P1/P2/P3 defect was found. The new frontend pins cover +7 inclusion/+8 exclusion, grouping, planned/snoozed/completed filtering, badge semantics, collapse markup, no false empty state, rail removal, and cockpit count. A timezone boundary is handled in local-calendar arithmetic by dateHelpers.addDays, avoiding millisecond/DST drift.

## Tested

- npm test — exit 0; 1,918 passed, 0 failed.
- npm run check — exit 0; syntax checks passed and skill bundles are current.
- CI=1 npm run test:e2e — attempted. The first invocation reached the new external Today journey and emitted passing Chromium journeys, but the tool did not return a final summary. A clean retry failed before tests because http://127.0.0.1:3199/healthz was already in use. The existing server was not stopped.
- git diff ff9a93a 4ab4834 and repository grep — reviewed; no tracked files modified.

## Unable to test

A definitive e2e pass count could not be obtained because an existing server occupied the configured webServer port. I did not kill or interfere with that server. The implementation/unit checks and the supplied code paths remain verified.

## Verdict

Approve merging MR !4.

