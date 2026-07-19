# Slippage Honesty Implementation Plan

**Goal:** Make the user's own procrastination visible the way the app's failures already are:
per-task deferral counts and age surfaced as calm chips, a built-in Stale view, and an
optional WIP limit on the board — signals, never enforcement.

**Roadmap:** [Workflow & Self-Organisation Roadmap](2026-07-18-workflow-selforganisation-roadmap.md) · item 4
**Status:** Proposed

## Current state

- The task chronicle (`task_activity`: `task_id, event_type, message, actor`, written via
  `logActivity` in [tasksRoutes.js](../../../server/tasksRoutes.js) and
  `buildRecordActivity` in [tasksRepository.js](../../../server/tasksRepository.js)) records
  `created` / `status` / `archived` / `restored` events — but **snoozes and due-date pushes
  are silent**: a `PATCH` that sets `deferredUntil` or moves `dueDate` writes no event, so
  slippage is currently unreconstructable for history and invisible going forward.
- Smart views live in [taskSmartViews.js](../../../public/js/taskSmartViews.js) on the shared
  filter grammar ([taskFilter.js](../../../public/js/taskFilter.js)); due/snooze chips render
  via [dueFlags.js](../../../public/js/dueFlags.js).
- Preferences are client-side (`prax.preferences` in localStorage,
  [preferences.js](../../../public/js/preferences.js)); board columns render in
  [renderBoard.js](../../../public/js/renderBoard.js).
- Migrations run through `0019`; adding one triggers the known pin cascade
  (`migrate.test.js`, `migrateTaxonomy.test.js`, `qualityFixture.test.js` schema count,
  `backupRestoreDrill.test.js`).

## Design decisions

1. **Count on the task row, event in the chronicle.** New columns on `tasks`:
   `deferral_count` (integer, default 0). It increments server-side inside the PATCH path
   when a change is a *slip*: `deferredUntil` set to a future instant, or `dueDate` moved
   later while the task stays open. The same mutation records a `deferred` /
   `rescheduled` chronicle event (message carries old → new), so the count is cheap to
   render and the history is auditable. Setting a date on a previously undated task is
   scheduling, **not** slippage — no increment.
2. **Honest backfill.** Historic snoozes were never recorded, so backfill cannot invent
   them: the migration starts every task at 0 and the docs say counts begin at adoption.
   No fabricated history.
3. **Age needs no schema** — derived from `createdAt` at render time.
4. **Chips inform, never nag:** shown only past thresholds (defaults: deferrals ≥ 3, age ≥
   30 days), thresholds live in client preferences. Drawer shows exact values; list/board
   show compact chips ("deferred 4×", "60d old").
5. **Stale is a built-in smart view**, not magic: expressed in the existing filter grammar
   (open, not snoozed, no activity for 30+ days) so it composes and is user-editable. This
   needs `lastActivityAt` exposed on the task API (derivable from the chronicle; add it to
   the task list payload rather than a new column — measure first, denormalize only if the
   list query shows it matters).
6. **WIP limit renders, never blocks:** a preference (default off, e.g. limit 3) makes the
   In-progress column header show `4/3` in the warning treatment when exceeded. Drags still
   land — the app tells the truth and leaves the decision to the human.
7. **Slip semantics are shared:** the increment rule lives in one pure module
   (`server/slippage.js`) consumed by the PATCH route — the reorder-with-lifecycle path and
   imports do **not** count (imports are data movement, not decisions).

## Work

### Increment 1 — counters + chronicle events (backend)

- [ ] Pure `server/slippage.js`: `classifySlip(prior, fields, now)` → `none | deferred |
      rescheduled` with the old→new payload; exhaustive unit tests (undated→dated, earlier
      moves, reopen, snooze-clear, completed tasks never slip).
- [ ] Migration `00XX_add_task_deferral_count.sql` (next free number): `deferral_count`
      integer not null default 0. Update the four pinned manifests deliberately.
- [ ] PATCH route: on slip, increment inside the same transaction as the update, record the
      chronicle event with the honest message ("Due moved 2026-07-20 → 2026-07-24").
- [ ] Expose `deferralCount` and `lastActivityAt` in task payloads; include
      `deferralCount` in export/import round-trip (contract doc + portable fixtures), and
      preserve it across archive/restore.

### Increment 2 — chips + Stale view (frontend)

- [ ] Chips in list/board/drawer via a small pure `slippageFlags.js` (mirrors
      `dueFlags.js`); thresholds from preferences with the defaults above.
- [ ] Built-in **Stale** smart view registered in `taskSmartViews.js`; sidebar placement
      alongside Upcoming; empty state says what Stale means.
- [ ] Preferences UI: thresholds + chip visibility toggle (off entirely for users who
      don't want the mirror).

### Increment 3 — WIP limit (board)

- [ ] Preference: WIP limit number (0 = off). Board In-progress header renders `n/limit`
      with the warning treatment when exceeded; no drag behavior changes.
- [ ] CHANGELOG entry covering all three increments.

## Verification

- Unit: `classifySlip` exhaustive table; increment-in-transaction (a failed PATCH does not
  bump the count); chip threshold logic; Stale predicate through the shared filter grammar.
- E2e: snooze a task twice → chip appears at threshold; drag past WIP limit → over-limit
  header renders and the drag still lands.
- Gates: `npm test`, `npx playwright test`, `npm run verify:portable`, `npm run
  verify:restore` (schema change), migration pin cascade updated.

## Risks / notes

- The line between "rescheduling" and "slipping" is judgement — the pure module + tests pin
  the chosen semantics so they never drift silently; the chronicle message always shows the
  raw change, so even a misclassification is auditable.
- `lastActivityAt` via join must not slow the main list query; if it does, denormalize with
  a trigger in the same migration (decide on measurement, not guess).
