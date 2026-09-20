# Default system Inbox — implementation review

Implemented in the working tree after v0.36.1; not yet released or installed.

## Changes reviewed

- Migration 0032 adopts an existing Inbox by slug, retaining IDs, content and
  links; restores missing Inbox with a new ID; reactivates/labels Inbox and pins
  its order. Healthy rows and repeat startup remain unchanged.
- The shared system-project definition protects Inbox and Memory in HTTP
  project routes and identifies their purpose in the UI. Both hide rename,
  lifecycle and Ops edits that the server refuses. Contents remain editable
  and movable. The demo includes both system defaults too.
- Current contract, working guide, README and Unreleased changelog explain the
  policy. Historical migrations are unchanged. Migration-boundary assertions
  now include 0032.
- The obsolete no-Inbox preference in Prax was superseded by the user's current
  capture/review preference. Existing live Inbox content was not changed.

## Validation

- `npm test`: **2197 passed**, no failures or skips. Includes restoration after
  deletion, preservation of linked content in renamed/inactive Inbox, retaining
  manually recreated IDs, avoiding reuse of the original ID, healthy-row and
  repeat-startup checks, server protection, normal content moves, and weekly
  review after restoration. Existing backup/restore and fixture tests passed.
- `npm run check`: passed; bundled skills remain current.
- Production browser tests: **4 passed** — `inbox-system-project.spec.js` and
  `weekly-review.spec.js`. Covered 1440px and 360px, light/dark WCAG A/AA checks
  with no rule exclusions, keyboard Inbox navigation, system and ordinary
  project controls, capture into Inbox, move to Work, and weekly-review creation
  and regeneration.
- Browser execution used Parley's reviewed host-command path, run
  `037d1ccc-266f-4d39-9249-fd2b62165f91`: returned exit 0, no truncation or
  cancellation. Test result assertions, not the command preview, establish the
  results above.
- Review used `/tmp/prax-inbox-2026-09-20/before/` to isolate this task's diff
  from the previously published work still shown as dirty in local Git.

The initial full suite exposed one stale fixture expectation (31 migration rows
instead of 32); it was updated and the complete suite rerun successfully.
An initial new test used an incorrect link-table name; corrected to the existing
`task_documents` table before the successful validation.

## Scope and remaining work

No blocking issue found in this change. The installed v0.36.1 application gains
the new migration and protection when upgraded to a build containing this work.
No live database migration, desktop package build or release was performed here.
The full browser suite was not rerun; the affected production journeys passed.

Further Inbox triage improvements are proposals in the linked
[design](../superpowers/specs/2026-09-20-inbox-system-project.md): a focused filing
flow, loose-note triage separate from retained reviews, aging/weekly-review
links and reviewed agent suggestions. They are not claimed as shipped features.
