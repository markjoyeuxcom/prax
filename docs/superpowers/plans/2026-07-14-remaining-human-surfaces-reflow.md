# Remaining Human Surfaces Reflow — Implementation Plan

**Design:** [`../specs/2026-07-14-remaining-human-surfaces-reflow-design.md`](../specs/2026-07-14-remaining-human-surfaces-reflow-design.md)

## Acceptance and regression evidence

- [x] Add a production running-runbook reflow test with long step/title/actor content.
- [x] Prove a narrow run-step mutation commits and the chronicle remains contained.
- [x] Check Appearance, Intelligence, and Data & admin at 320 CSS px.
- [x] Check parsed Markdown import and Library export dialogs without horizontal scrolling.
- [x] Keep every named run, Settings, import, and export action reachable.

## Product changes

- [x] Confirm and regression-lock the existing runbook header, progress, step, action, and
      chronicle reflow.
- [x] Reflow Settings rows and horizontal control groups, including accent/provider/import actions.
- [x] Confirm and regression-lock the existing fluid transfer-dialog regions at the reference
      width.
- [x] Correct the Settings accent-group overflow exposed by production-browser evidence.

## Quality record

- [x] Link the evidence and remaining manual constraints from the release scorecards.
- [x] Update the quality-standard adoption sequence and evidence table.

## Verification

- [x] Run targeted remaining-surface browser evidence (3/3 green on 2026-07-14).
- [x] Run `npm test` (171/171), `npm run test:e2e` (66/66), `npm run check`, and
      `git diff --check` on 2026-07-14.
- [x] Attempt to persist the durable remaining-surface reflow finding to Prax memory. The
      2026-07-14 mirror attempt failed because Prax was not reachable at
      `http://127.0.0.1:3000`; the repository record remains authoritative for this pass.
