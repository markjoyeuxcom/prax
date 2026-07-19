# Weekly Review Implementation Plan

**Goal:** One click compiles an honest week-in-review — shipped, stalled, most-slipped,
aging inbox, silent projects, next week's load — and writes it as a dated, wiki-linked
Library document that accumulates into a searchable, agent-recallable history. Optional AI
narration on top; the deterministic compilation stands alone.

**Roadmap:** [Workflow & Self-Organisation Roadmap](2026-07-18-workflow-selforganisation-roadmap.md) · item 5
**Depends on:** [Slippage honesty](2026-07-18-slippage-honesty.md) (deferral counts) and
[Today plan & shutdown](2026-07-18-today-plan-shutdown.md) (carry data) enrich it, but the
compiler must degrade gracefully to whatever data exists — neither is a hard prerequisite.
**Status:** Shipped (all three increments)

## Current state

- The daily brief is the pattern to follow: pure compile
  ([brief.js](../../../public/js/brief.js): state + now → Markdown), separate optional AI
  narration, overlay with copy ([renderDailyBrief.js](../../../public/js/renderDailyBrief.js)).
  But it is client-side over *loaded* state — a weekly review needs completed/archived tasks
  and chronicle events across a full week, which the client does not hold.
- The chronicle (`task_activity`) has per-task events with timestamps; documents have
  taxonomy types ([documentTypes.js](../../../public/js/documentTypes.js)), templates,
  wiki-links, and semantic embeddings; the agent memory path (`prax-recall`) searches the
  Library — a review written as a doc is automatically recallable later.
- Reminder delivery (native/in-app while running) exists via `dueReminders.js` + main.js.

## Design decisions

1. **Server-side pure compiler.** New `server/weeklyReview.js`:
   `compileWeeklyReview({ tasks, archived, activity, projects, documents, weekStart, now })`
   → Markdown + structured stats. Pure and fixture-testable; a thin route feeds it from the
   repositories. Sections:
   - **Shipped** — tasks completed in the week (incl. archived-after-completion), by project.
   - **Stalled** — open in-progress tasks with no chronicle events all week.
   - **Most-slipped** — top tasks by in-week `deferred`/`rescheduled`/`carried` events
     (falls back to nothing, honestly, before the slippage plan lands).
   - **Inbox aging** — inbox items older than 7 days (count + oldest few).
   - **Silent projects** — projects with zero task/doc movement in the week.
   - **Next week** — due + planned load for the coming week, day by day.
   - An **empty week compiles truthfully** ("nothing shipped") — never padded, never
     omitted; a valid review of a bad week is the product working.
2. **Week identity is ISO-8601** (Monday start, `2026-W29`); the doc title is
   `Weekly review — 2026-W29`. **Idempotent by title:** regenerating the same week updates
   the existing doc in place (the `prax-remember` de-dup convention), never duplicates.
   Regeneration overwrites only the generated body; a review the human edited is preserved
   under the app's agent-edit rules (generated docs carry agent provenance; a re-run on a
   human-verified review refuses and says why — trust model already enforces this shape).
3. **Route:** `POST /api/library/weekly-review` `{ week? }` (defaults to the week
   containing yesterday, so a Monday-morning run reviews last week) → `{ documentId,
   created|updated, stats }`. Follows the advisory regime: compilation failures return
   degraded JSON, never 500. The doc is typed via taxonomy (e.g. `review`) and wiki-links
   every project it mentions, so the graph and backlinks light up.
4. **AI narration is a second, optional step** reusing the daily brief's narration plumbing
   ("Draft with AI"), appended under a marked heading; absent a chat model the
   deterministic review is complete on its own — same honest degrade as every AI surface.
5. **Entry points:** a Library-view action ("Generate weekly review"), and a
   preference-gated gentle nudge (default off; Friday or Sunday hour) through the existing
   reminder delivery. The MCP/CLI surface gets it for free later via the route — not in
   slice 1.

## Work

### Increment 1 — compiler + idempotent doc writer

- [x] `server/weeklyReview.js` pure compiler with a fixture week exercising every section,
      the empty week, ISO week boundaries (year-crossing weeks), and the
      slippage-data-absent fallback.
- [x] Repository support: `listActivityInRange` (a once-a-week bounded date scan —
      measured as fine locally; no index added).
- [x] `POST /api/library/weekly-review`: compile → create-or-update by title, taxonomy
      type, project wiki-links, agent provenance stamp; degraded JSON on failure;
      refuse + explain on a human-verified existing review.

### Increment 2 — UI + narration

- [x] Library action + result surface (open the doc on success; degraded reason inline).
- [x] Narration step (server-side, reusing the chat provider), appended under `## Narrative`;
      "AI-narrated" labeling per the app's provenance conventions.

### Increment 3 — nudge + polish

- [x] Preference-gated Sunday-evening nudge via the reminder tick (default off).
- [x] CHANGELOG entry (the doc's own footer carries the definitions; no separate docs
      page — the artifact documents itself).

## Verification (as shipped)

- Unit: `tests/backend/weeklyReview.test.js` — ISO-week identity incl. year-crossing
  weeks, full fixture week (every section + stats), truthful empty week, and the
  route journey: generate → idempotent regenerate (same doc id, exactly one doc) →
  verified-review refusal → narration degrade without a chat model.
- E2e: `tests/e2e/weekly-review.spec.js` — Library action compiles + opens the doc;
  regenerate keeps exactly one tagged review.
- Gates: 1739 unit, 85 e2e; no schema change (queries only).
- Deviations from the sketch, deliberate: the doc is typed `note` + tag `weekly-review`
  (no new taxonomy type — the registry did not need to grow for one artifact), lives in
  the system Inbox project (documents are project-owned; NOT NULL constraint), and
  wiki-links go to the week's touched DOCUMENTS (wiki-links target docs, not projects).

## Original verification sketch

- Unit: compiler fixture week (every section + empty week + year-boundary week);
  idempotent second run (same doc id, updated body); verified-review refusal; degraded
  compile path.
- E2e: generate → doc exists in the Library with the week title and project links;
  regenerate → still exactly one doc; with no chat model configured the review renders
  complete and un-narrated.
- Gates: `npm test`, `npx playwright test`; no schema change expected (queries only) — if
  an index migration proves necessary, the pin cascade applies.

## Risks / notes

- "Stalled" and "silent" are judgement calls — the compiler's fixtures pin the definitions
  so they cannot drift silently; the doc states its own definitions in a footer so the
  reader always knows what the words mean.
- The chronicle range queries are the only new load; they run on demand (one click a
  week), so correctness beats cleverness — but the index check keeps the drawer's
  activity view unaffected.
- Write conflicts with the user editing the review doc mid-generation are handled by the
  existing document save/conflict machinery — the route writes through the same repository
  path as every other doc write.
