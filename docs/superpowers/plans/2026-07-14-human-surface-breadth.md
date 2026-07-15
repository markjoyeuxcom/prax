# Human-surface Breadth — Implementation Plan

**Design:** [`../specs/2026-07-14-human-surface-breadth-design.md`](../specs/2026-07-14-human-surface-breadth-design.md)

## Acceptance and regression evidence

- [x] Protect explicit task Select/Deselect markup, pressed state, and bulk-toolbar semantics in
      the renderer unit suite.
- [x] Add production-browser assertions for 320 px page reflow across list, board, backlog, and
      archive.
- [x] Prove board columns stack in visible keyboard order at the narrow breakpoint.
- [x] Use a touch-enabled browser context to select multiple tasks and complete a real bulk
      lifecycle action.
- [x] Assert computed animation and transition durations under the operating-system
      reduced-motion preference.

## Product changes

- [x] Add a dedicated task selection control without changing modifier-click behavior.
- [x] Reflow the board, bulk toolbar, page header, and task metadata at narrow widths.
- [x] Correct the list/tab overflow exposed by the production-browser evidence.
- [x] Keep all core actions named, visible, focusable, and touch-operable.

## Quality record

- [x] Link the new evidence and remaining manual constraints from the release scorecards.
- [x] Update the quality-standard adoption sequence now that the task breadth constraint is closed.

## Verification

- [x] Run targeted renderer and human-surface browser tests.
- [x] Run `npm test`, `npm run test:e2e`, `npm run check`, and `git diff --check`.
- [x] Attempt to persist the durable responsive/touch runbook finding to Prax memory. The local
      service remained unavailable at `http://127.0.0.1:3000` on 2026-07-14, so this repository
      design/plan and the release scorecard remain the canonical record until the mirror can run.
