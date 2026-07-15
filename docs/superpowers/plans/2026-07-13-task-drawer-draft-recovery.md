# Task Drawer Coherent Draft Recovery Implementation Plan

**Goal:** Make task title, description, and notes one recoverable, render-stable, save-before-exit
draft.

**Design:** [Task Drawer Coherent Draft Recovery](../specs/2026-07-13-task-drawer-draft-recovery-design.md)

## Work

- [x] Add pure task-draft comparison and local recovery records.
- [x] Mirror all drawer text fields and save one atomic draft PATCH.
- [x] Add truthful saved/dirty/failure/recovered/conflict status and explicit retry.
- [x] Await the draft before close, switch, linked-document exit, and archive.
- [x] Add frontend and production-browser adverse-path evidence.
- [x] Update the quality record, run all gates, and attempt durable Prax memory.

Verification: the original four Playwright journeys passed three consecutive runs (12/12), the
expanded conflict-aware suite passed 5/5, then `npm test` (151/151 files), `npm run test:e2e`
(26/26 journeys), `npm run check`, `npm run verify:portable`, and `npm run verify:restore` all
passed on 2026-07-13. The Prax-memory write was attempted, but the local service was unavailable
at `http://127.0.0.1:3000`; this version-controlled design remains authoritative.
