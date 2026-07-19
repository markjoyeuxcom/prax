# Workflow & Self-Organisation Roadmap

**Date:** 2026-07-18
**Status:** SHIPPED — all five items landed (2026-07-19), each with its own commit, tests, and gates; see the per-item plans for as-shipped notes
**Source:** Product review of the full feature set after the Google Calendar push work.

**Detailed plans:**

1. [System-wide capture](2026-07-18-system-wide-capture.md)
2. [Today plan & shutdown ritual](2026-07-18-today-plan-shutdown.md)
3. [Task context surface](2026-07-18-task-context-surface.md)
4. [Slippage honesty](2026-07-18-slippage-honesty.md)
5. [Weekly review](2026-07-18-weekly-review.md)

Prax today is strong **infrastructure for holding work**: tasks (projects, recurring, snooze,
labels, smart views, calendar + live Google push), a markdown Library with wiki-links and
semantic search, runbooks with a chronicle, and an AI layer (NL capture, daily brief,
assistant, agent memory). The gaps are in the **rituals** — the loops that turn a system of
record into a system you run your day from.

The five items below follow a workflow arc, and that arc is the intended build order
rationale (not necessarily the build sequence — see Sequencing):

> **capture → plan → execute → stay honest → review**

**Ground rules** (inherited from the
[quality standard](../specs/2026-07-13-exceptional-prax-quality-standard.md)):

- Every increment lands with executable evidence (unit + e2e where a human surface changes).
- Honest outcomes only: partial failure surfaces as degraded, never as clean success.
- No feature may slow or block core task mutations (the calendar pusher's detachment rule
  is the precedent).

---

## 1. System-wide capture — global hotkey + tray capture bar (desktop shell)

**Problem.** Capturing a thought requires switching to Prax, so ideas mid-task either cost
focus or get lost. Capture friction decides whether the system is trusted enough to empty
your head into.

**Design sketch.**
- Tauri global shortcut (e.g. `Cmd/Ctrl+Shift+Space`) summons a small always-on-top capture
  window, even when the main window is closed; a tray icon offers the same.
- The bar reuses the existing capture pipeline: `#project @label` shorthand tokens, NL
  capture parsing, idempotent create (client-generated task id → exact-once on retry).
- Enter saves to Inbox (or the tokened project) and dismisses; Esc dismisses; failures keep
  the text and show the error inline — never silently drop a capture.
- Offline/app-not-running is out of scope for slice 1 (the shell owns the server process;
  if the server is up the bar works).

**Leverage.** `captureShorthand.js`, NL capture route, idempotent `POST /api/tasks`,
existing Tauri shell + packaging.

**Increments.**
1. Tray + global shortcut + minimal capture window (plain text → Inbox).
2. Shorthand tokens + NL parse preview in the bar.
3. Packaging/permissions polish per OS (shortcut registration failure surfaces in Settings).

**Evidence.** Unit: capture payload building, error retention. Manual desktop check per OS
(documented, like prior desktop work). E2e where drivable: capture bar logic behind a flag.

**Size.** Small–medium. Highest immediate daily payoff.

---

## 2. Today as a plan — morning planning + evening shutdown ritual

**Problem.** Today *shows* what's due; it never asks what you will *do*. Unfinished work
rolls over silently, which erodes trust in the list.

**Design sketch.**
- **Plan mode** on the Today view: walk overdue → due today → inbox → upcoming; explicitly
  pull items into a "today working set" (a first-class flag/ordering, not a new status).
- Optional **timeboxing**: assign a time to a planned item → it gets `dueTime` and flows to
  Google Calendar automatically via the existing live push.
- **Shutdown step** (end of day, user-invoked): every unfinished planned item must be
  consciously carried to tomorrow, rescheduled, or dropped; the choice is recorded to the
  task chronicle (`carried` events power item 4's slippage signals).
- The plan is data, not vibes: "planned today, done today" counts render on the view.

**Leverage.** Today view + `captureDueDate` plumbing, `dueTime` full stack, calendar pusher,
task activity chronicle.

**Increments.**
1. Working-set flag + plan mode UI + planned-today rendering.
2. Shutdown flow + `carried` chronicle events.
3. Timeboxing (assign times in plan mode; push handled by existing sync).

**Evidence.** Unit: plan/shutdown state transitions, chronicle events. E2e: plan two tasks,
complete one, shutdown forces a decision on the other; carry count visible next morning.

**Size.** Medium. Biggest behavioural change per line of code.

---

## 3. Context surface — the Library feeds the task you're doing

**Problem.** Tasks and knowledge are parallel silos: when you open a task, the notes that
would help you do it are a manual search away. Every work session starts with a
re-finding-context tax.

**Design sketch.**
- Task drawer gains a **Related knowledge** row: semantic search over the Library seeded
  from the task title + description (existing embeddings; degrade honestly to "semantic
  search off" when no embedding backend).
- One click **links** a suggested doc to the task (existing task↔document links) or spawns
  a **working note**: a new doc pre-linked to the task, titled from it, typed appropriately.
- Reverse surface: a doc shows its open linked tasks (extend the existing links row).
- Advisory-AI regime: suggestions never block the drawer; they load after it renders.

**Leverage.** Semantic search routes, task↔document links (`/api/tasks/:id/documents`),
document taxonomy + templates, links row UI.

**Increments.**
1. Related-knowledge row (read-only suggestions) + link action.
2. Working-note spawn.
3. Doc-side open-tasks surface.

**Evidence.** Unit: suggestion request shaping, degraded rendering. E2e: task with a
semantically related doc shows it; link + working-note round-trip.

**Size.** Medium. Compounds with every doc written.

---

## 4. Slippage honesty — surface your own procrastination signals

**Problem.** The app was made honest (no misleading success); the user's relationship with
their own list still isn't. Tasks that keep slipping are mis-scoped, unwanted, or scary —
invisible slippage means the real decision never gets made.

**Design sketch.**
- Track per task: **defer/reschedule count** (derivable from chronicle events; store a
  counter for cheap rendering), **age**, and (with item 2) **carry count**.
- Render honesty chips in list/board/drawer: "deferred 4×", "60 days old" — informative,
  not nagging; thresholds configurable in preferences.
- Built-in **Stale** smart view (untouched 30+ days, excluding backlog-by-intent).
- Optional **WIP limit** on the In-progress board column: exceeding it renders a visible
  over-limit state (never blocks the move — honesty, not enforcement).

**Leverage.** Task activity chronicle (already records status/defer events), smart-view
grammar, board rendering, preferences.

**Increments.**
1. Counters (migration + backfill from chronicle) + chips.
2. Stale built-in view.
3. WIP limit preference + board rendering.

**Evidence.** Unit: counter derivation incl. backfill, chip thresholds. Migration pins
updated deliberately (known cascade: migrate/taxonomy/qualityFixture/backupRestoreDrill
tests). E2e: defer twice → chip appears.

**Size.** Small–medium. Feeds item 5.

---

## 5. One-click weekly review — written into the Library

**Problem.** The daily brief covers the stand-up horizon; nothing covers the week. Reviews
are the highest-value self-organisation habit and the first one dropped — the artifact must
be one click.

**Design sketch.**
- **Generate weekly review**: compiles from live data — shipped (completed this week),
  stalled (in-progress with no chronicle events), most-slipped (item 4's counters), inbox
  items older than a week, projects with zero movement, next week's load (due + planned).
- AI narration optional and clearly labelled (same pattern as the daily brief's
  "Draft with AI"); the deterministic compilation stands alone without a chat model.
- Saved as a **dated Library doc** (e.g. `Weekly review — 2026-W29`), typed via taxonomy,
  wiki-linked to the projects it mentions — so reviews accumulate into a searchable,
  agent-recallable history.
- Regenerating the same week updates the same doc (idempotent by title), never duplicates.

**Leverage.** Daily brief compilation + narration pattern, Library create route, taxonomy,
wiki-links, semantic search/agent memory for recall.

**Increments.**
1. Deterministic compiler + doc writer (idempotent by week).
2. AI narration + Settings-aware degrade.
3. Entry points: Library action + a gentle Friday/Sunday nudge via existing reminders.

**Evidence.** Unit: compiler on a fixture week (incl. empty-week honesty — "nothing
shipped" is a valid, truthful review), idempotent regeneration. E2e: generate → doc exists,
regenerate → still one doc.

**Size.** Medium. Best long-term compounder.

---

## Sequencing

Recommended build order (impact ÷ size, plus data dependencies):

| Order | Item | Why now |
| ----- | ---- | ------- |
| 1 | **#1 System-wide capture** | Smallest build, most immediately felt daily benefit. |
| 2 | **#4 Slippage counters** | Small; its data makes #2 and #5 richer the earlier it lands. |
| 3 | **#2 Today plan + shutdown** | The core ritual; uses #4's counters and existing GCal push. |
| 4 | **#5 Weekly review** | Consumes #2's carry data and #4's slippage data. |
| 5 | **#3 Context surface** | Independent; valuable any time, no data dependencies. |

Each item ships as its own increment train with full gates (unit, e2e, portable/restore
drills where data models change) and a changelog entry; anything touching migrations
updates the manifest pins deliberately.
