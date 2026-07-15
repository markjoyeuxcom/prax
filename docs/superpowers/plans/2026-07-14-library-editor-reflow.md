# Library and Editor Reflow — Implementation Plan

**Design:** [`../specs/2026-07-14-library-editor-reflow-design.md`](../specs/2026-07-14-library-editor-reflow-design.md)

## Acceptance and regression evidence

- [x] Add production-browser reflow checks for active Library, semantic results, and archive at
      320 CSS px.
- [x] Prove long card metadata and archive actions stay inside the main content viewport.
- [x] Prove editor header, toolbar, body, and footer do not create page-level horizontal overflow.
- [x] Prove narrow split panes stack edit before preview and the outline becomes full-width.
- [x] Edit and persist an exact title/body through the narrow production editor.

## Product changes

- [x] Make Library search, grids, cards, semantic results, archive rows, and progress controls fluid.
- [x] Wrap editor header metadata/actions and formatting controls without hiding named actions.
- [x] Stack editor split panes and constrain the outline at the narrow breakpoint.
- [x] Reflow the document-info form and editor footer.
- [x] Correct the minimum-card, semantic-badge, and editor-strip overflow exposed by the evidence.

## Quality record

- [x] Link the evidence and remaining manual constraints from the release scorecards.
- [x] Update the quality-standard adoption sequence and evidence table.

## Verification

- [x] Run the targeted Library/editor browser evidence.
- [x] Run `npm test`, `npm run test:e2e`, `npm run check`, and `git diff --check`.
- [x] Attempt to persist the durable Library/editor reflow finding to Prax memory. The local
      service remained unavailable at `http://127.0.0.1:3000` on 2026-07-14, so the repository
      design/plan and release scorecard remain canonical until the mirror can run.
