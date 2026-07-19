# Today Plan & Shutdown Ritual Implementation Plan

**Goal:** Turn Today from a list of what's due into a plan of what you'll do: a morning
planning pass that builds an explicit working set (optionally timeboxed → Google Calendar),
and an evening shutdown where every unfinished planned item is consciously carried,
rescheduled, or dropped — with the carries recorded.

**Roadmap:** [Workflow & Self-Organisation Roadmap](2026-07-18-workflow-selforganisation-roadmap.md) · item 2
**Depends on:** [Slippage honesty](2026-07-18-slippage-honesty.md) increment 1 (chronicle
event pattern + slip semantics; carry counting extends it).
**Status:** Proposed

## Current state

- Today view ([renderToday.js](../../../public/js/renderToday.js), `navType: 'today'`)
  selects by due date/overdue; capturing from it pre-sets `captureDueDate`. Its selection
  logic is deliberately shared with reminders
  ([dueReminders.js](../../../public/js/dueReminders.js)).
- `dueTime` exists full-stack; a task gaining a time flows to Google Calendar automatically
  via the live pusher (`server/googleCalendarSync.js`) — timeboxing needs zero new sync work.
- The chronicle records route-side via `logActivity`; the drawer/board mutate through
  `PATCH /api/tasks/:id` which the calendar pusher already watches.
- There is no notion of "chosen for today" distinct from "due today".

## Design decisions

1. **The working set is a date, not a status.** New nullable column `planned_for` (ISO
   date) on `tasks`. Planned-for-today ∧ open = today's working set. It is orthogonal to
   due dates (you can plan an undated task) and to status (planning is not starting).
   A date, rather than a boolean, makes "planned yesterday but never shut down" detectable
   and makes carry semantics trivial.
2. **Plan mode is a pass, not a page.** Today gains a "Plan today" affordance that walks
   the candidate buckets in order — overdue → due today → snoozed-arriving-today → inbox →
   upcoming (7 days) — with keyboard-first add/skip per task. Adding sets
   `planned_for = today` via the normal PATCH (one mutation path; MCP/assistant/agents can
   plan too, for free). The pass is resumable and skippable; Today without a plan behaves
   exactly as it does now.
3. **Planned rendering:** Today splits into **Planned** (ordered working set, with
   plan-scoped ordering) and **Also due** (due items not pulled in). "Planned 5 · done 2"
   renders on the view — the honest score, computed from data, no streaks or gamification.
4. **Timeboxing = `dueTime` on a planned task,** assigned inline during the pass or on the
   Planned list. No parallel time model; the calendar push and the ICS feed pick it up
   because it is just the existing field.
5. **Shutdown is user-invoked and decisive.** A "Shut down today" affordance (Today view;
   nudged after a preference-set hour) walks each unfinished planned item with exactly
   three choices: **Carry** (`planned_for = tomorrow`, records a `carried` chronicle event,
   increments a `carry_count` column), **Reschedule** (opens due/planned date change — a
   slip, counted by the slippage rules), **Drop from plan** (`planned_for = null`, task
   untouched — dropping a plan is not dropping a task). No bulk "carry all" in slice 1:
   the point is the per-item decision. Skipping shutdown entirely stays possible; the
   morning pass then shows yesterday's stale plan first ("3 items planned yesterday were
   never shut down") — visible, not punitive.
6. **Carry data feeds the review layer:** `carry_count` + `carried` events are exactly what
   [weekly review](2026-07-18-weekly-review.md) reads for "most-slipped".

## Work

### Increment 1 — working set data model + planned rendering

- [ ] Migration `00XX_add_task_planning.sql`: `planned_for` (text, nullable ISO date),
      `carry_count` (integer not null default 0). Pin cascade + contract doc + portable
      round-trip fixtures updated; both fields survive export/import and archive/restore.
- [ ] `PATCH` accepts `plannedFor` (validated ISO date or null) through
      `validateTaskPatchPayload` / `cleanTaskPatchPayload`; exposed in payloads and the
      task filter grammar (`planned:today`, `planned:none`) so smart views compose.
- [ ] Today renders Planned / Also due sections from `planned_for`; planned-today counts;
      stale-plan banner for un-shut-down previous days.

### Increment 2 — the planning pass

- [ ] Plan-mode overlay on Today: bucket walk (order above), keyboard add/skip/snooze,
      inline due-time assignment; every action is a normal PATCH.
- [ ] Capture-from-plan: the existing capture pre-set gains `plannedFor = today` so a task
      captured mid-planning joins the set.
- [ ] `planned` chronicle event on entering the working set (actor-aware: an agent
      planning via MCP records as agent — the existing actor column).

### Increment 3 — shutdown

- [ ] Shutdown overlay: per-item Carry / Reschedule / Drop with the semantics above;
      `carried` event + `carry_count` increment transactional with the PATCH.
- [ ] Preference: shutdown nudge hour (default off; delivered through the existing
      reminder machinery in `dueReminders.js` + main.js delivery, same native/in-app path).
- [ ] Carry chip ("carried 3×") joins the slippage chips; CHANGELOG entry.

## Verification

- Unit: plannedFor validation, working-set selection (incl. timezone day boundaries — reuse
  the reminders' local-date convention), shutdown transitions (carry increments exactly
  once per invocation; drop clears without touching the task), stale-plan detection.
- E2e: plan two tasks → complete one → shutdown forces a decision on the other → carry →
  tomorrow's Today shows it planned with the carry recorded; skip shutdown → next morning
  shows the stale-plan banner.
- Calendar: a planned task given a due time appears via the pusher (extend the existing
  route-integration test with `calendarPushDebounceMs: 1`).
- Gates: `npm test`, `npx playwright test`, `verify:portable`, `verify:restore`, pins.

## Risks / notes

- Day boundaries are local-time; reuse `dueReminders.js`'s `isoDateOnly` convention
  everywhere so Today, the plan, and reminders never disagree about what "today" is.
- The working set must stay optional — users (and tests) that ignore planning entirely see
  today's exact current behavior. No behavior may become conditional on having planned.
- MCP surface: `plannedFor` rides the existing task tools (search filter + update); no new
  tools in slice 1.
