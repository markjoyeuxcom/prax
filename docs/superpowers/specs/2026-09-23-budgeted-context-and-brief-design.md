# Budgeted context, the since-last-session delta, and `prax brief`

Scope: bound the memory an agent pulls by an explicit token budget with a deterministic,
trust-first fill order; let an agent ask for only what changed in memory since it last looked;
and give one command that briefs an agent on a task. Tracked in the Prax tasks "Budgeted context
packs with a since-last-session delta" (d259b881) and "CLI: prax brief <task-id> assembles a
single task briefing" (ec878a62). The brief shares the budget's fill order and trust labelling;
there is one ranking, not two.

## Token estimate

`tokens ≈ ceil(characters / 4)`, counted over the exact text printed, newlines included
(`cli/lib/budget.js`, `estimateTokens`). It is a heuristic, not a tokenizer: English prose runs
close to it, code and non-Latin scripts run above it. The budget is therefore a target for the
printed block, not a guarantee against a model's context limit. `--json` reports the estimate
under `budget.used` together with `budget.estimate: "chars/4"`.

## Fill order

One function, `fillOrder` in `cli/lib/budget.js`, orders candidates into three tiers:

1. **verified** — an active document a person verified. Kept in retrieval order.
2. **cited-and-unchanged** — not verified, but it pins code (`remember --cite`) and *every*
   citation was checked in this checkout and still matches at its pinned lines (`current`).
   A moved, changed, missing or unchecked citation does not qualify: the tier promises that the
   ground of the claim was confirmed here, now. Kept in retrieval order.
3. **recent** — everything else, newest `updatedAt` first; retrieval order breaks ties, and a
   row without a timestamp sorts last (an unknown age never reads as fresh).

Retired rows (superseded, deprecated, archived — only the delta shows them) are never in the
verified tier, whatever their old verification.
The fill is client-side, in `cli/lib`, because tier 2 needs the checkout: only the machine
running the command can say whether cited code still matches. The server's context-pack route
is unchanged apart from carrying `updatedAt` on each item, which tier 3 needs.

## Deterministic compaction

Each candidate has two renderings, both starting with a trust chip
(`[verified]`, `[unverified]`, `[superseded]`, `[deprecated]`, `[archived]`):

- **full** — a heading line `## [chip] Title  (type · id · project · trust line · citation
  notes)` and an excerpt below it (the first full entry up to 800 characters, later ones up to
  240, the context pack's server snippet as it comes);
- **compact** — exactly one line: `- [chip] Title (type · id) — first line`, where the first
  line is the body's first non-blank line that is not the title itself, stripped of Markdown
  heading/list/quote markers and cut at 120 characters.

No model is involved and no text is paraphrased, so an unverified note cannot lose its label:
every entry begins on a line that carries its chip, and a compacted entry is that one line.

## Budget planning

`planBudget(entries, { budget, fixed })` in `cli/lib/budget.js`, rendered by `renderBudgeted`
in `cli/lib/recall.js`:

- **Fixed lines always print**, even when they alone exceed the budget: the command header,
  retrieval mode and fallback, index coverage (`index incomplete …`, `index coverage unknown`),
  the bound note and the budget line itself. Honesty about what was searched outranks the
  budget; the budget line then says it was exceeded.
- If every entry fits in full, everything prints in full.
- Otherwise entries are taken in fill order: full while the full form fits, and from the first
  entry that does not, compact for it and every later entry (a lower tier never prints in full
  after a higher one was compacted). The first entry whose compact line does not fit stops the
  fill; it and every later entry are omitted. Room for the omission line is reserved while
  something may still be left out.
- Omissions are counted, never silent: `_N more left out by the budget (k unverified) — raise
  --budget, or prax get <id>._`
- Without `--budget` nothing changes: `prax recall` and `prax context` print exactly what they
  printed before, and their JSON carries no `budget` key.

## `--budget <tokens>` on `prax context` and `prax recall`

- `prax context [query] --budget <n>` asks the server for the JSON pack (with `--limit`, or 50
  candidates when no limit is given), checks each item's citations against this checkout, and
  renders a budgeted pack client-side. Sections keep their meaning and order (overview,
  relevant, runbooks, unverified quarantined last); which entries appear, and in which form, is
  decided in fill order. The server's own `omitted` count (the document limit) prints as its
  own line, as in the server's pack.
- `prax recall "<query>" --budget <n>` collects up to `--limit` matches (20 when no limit is
  given with a budget), fetches each match's document for its body and trust, checks every
  match's citations (not only the top hit's), and prints the fill-ordered, budgeted block. The
  top of the block is the first entry in fill order, which may not be the highest-ranked match:
  a verified runbook outranks a closer unverified note for a place in a small budget.
- `--budget` with `recall --recent` is refused (a chronological list has its own bound, `n`).
- `--json` returns the usual structure plus `budget: { tokens, used, estimate, fill, entries:
  [{ id, tier, form }], omitted: { total, unverified } }`.
- The recall skill accepts `--budget` with the same meaning; its strict parser
  (`cli/lib/skillArgs.js`) declares it, so a mistyped flag is still refused.
- The MCP context tools keep their document `limit`. A budget there would need the fill without
  tier 2 (the MCP server has no checkout); deferred rather than shipped as a second ordering.

## Since-last-session delta

`prax recall --since-last-session` (or `--since <iso>`) returns only memory that changed in the
window, instead of searching.

**What counts as a change.** `GET /api/library/changes?since=<iso>` returns documents whose
`created_at`, `updated_at`, `verified_at` or `archived_at` is later than `since`, each with
`changes` from `created`, `updated`, `verified`, `superseded`, `deprecated`, `archived` and
`changedAt`, the latest of those stamps. Rules: a document created in the window is `created`,
not also `updated`; a retired document (the supersession trigger bumps `updated_at`) reports its
lifecycle state instead of `updated`; `verified` means verified in the window and still verified.
Superseded rows carry `supersededBy` (the replacing ids). Unverification clears `verified_at` and
is therefore **not** visible to the delta; an unverification also leaves `updated_at` alone. This
is disclosed in the docs rather than covered by an extra change log.

**Paging without loss.** Rows come oldest change first; `limit` (default 50, max 200) bounds a
page. `until` is the `changedAt` of the last row returned, never the server clock, so a write
committing while the page is read is picked up next time. A page never splits rows with the same
`changedAt`: the page is extended to the end of that tie. With no rows `until` equals `since`.
`page: { returned, total, hasMore }` says whether more remain; the next call starts at `until`.
Timestamps are compared after normalising both sides to `YYYY-MM-DDTHH:MM:SS.sssZ`.

**Per-agent markers (migration 0041).** Table `agent_recall_markers(agent, scope,
last_recall_at, updated_at)`, primary key `(agent, scope)`. `agent` is the `x-prax-agent` id
(sent with `x-prax-origin: agent`); `scope` is a project id, or `*` for all projects, so a
project-scoped delta never advances the all-projects feed. `GET /api/library/changes?
sinceLastSession=true[&project=]` reads the marker and answers with `baseline: "marker"` and
the marker's time as `since`; with no marker it answers `baseline: "none"`, no rows, and `until`
set to the server's now. `PUT /api/library/recall-marker` `{ project?, at }` records `at`
monotonically (`max(stored, at)`, and never later than the server's now), so the setter is
idempotent and a stale or concurrent session can never move a marker backwards; the client
retries it only when no request reached the server. Both require an agent id: without one the
server answers 400 and the CLI refuses before sending (`--agent`, `PRAX_AGENT`, or a detected
agent shell).

**When the marker moves.** Only a `--since-last-session` delta advances it, to that delta's
`until`, after the block has been printed. Plain recalls, `--recent`, context packs, briefs and
explicit `--since` deltas never move it. The marker is therefore "the end of the last delta this
agent read", and the delta is a lossless change feed: every change reaches each agent's feed
exactly once, even when a session recalled other things in between. Advancing on every recall
would silently drop changes that happened between an agent's last delta and its last unrelated
query. A marker that could not be written is reported on stderr (the next delta repeats these
changes), never fails the command. Several concurrent sessions of the same agent share one
marker; `--since <iso>` is the precise alternative, and every delta prints its window so a
caller can pass it on.

**First run.** With no marker: `No earlier delta recorded for agent "claude" (all projects);
baseline set at <until> — the next --since-last-session starts here. Use --since <iso> or
--recent to look back.`

**Rendering.** A header with the window, scope and baseline source, then the changed rows in
fill order through the same planner (`--budget` applies; without it every row prints). Retired
rows print as their compact line — their bodies are no longer current memory — with the change
and the replacing id (`superseded by <id>`). `--limit` bounds the page. `--since` and
`--since-last-session` exclude each other, a query and `--recent`. `--json` returns the route's
envelope plus the fill decisions (`tier` on each item, `budget`) and `advance`, whether the
marker is advanced after output; stderr confirms `delta marker recorded at <until>` or `not advanced`.
When a budget leaves changes out, the marker is **not** advanced and the block says so: the
left-out changes were never read, so the next delta repeats the window.

## `prax brief <task-id>`

A read-only composition over existing routes, for an agent starting a task:

1. **Header** — title, status, priority, project, due/planned dates, labels and id; the
   description.
2. **Checklist** — numbered 1-based (the numbers `prax task check` takes), `[x]`/`[ ]`, with a
   `n of m done` count.
3. **Latest handoff** — the last non-blank paragraph of the task's notes (paragraphs split on a
   blank line), marked `(latest of N paragraphs — prax task show <id> for all)`; `No handoff
   notes.` when there are none.
4. **Linked documents** (`GET /api/tasks/:id/documents`) and **related documents**
   (`GET /api/tasks/:id/related-documents`), one line each with the trust chip, type, id,
   project and trust line. Trust comes from each document's full record; a record that cannot be
   read prints `[trust unknown]`, never a guessed label. At most 20 linked documents are read
   individually; the rest are listed with `[trust unknown]` and counted. A related suggestion is
   left out of Related only when the Memory section **as rendered** prints it (full or compact):
   `--budget` can omit a memory match, and a suggestion deduplicated against an omitted entry
   would appear nowhere (Agy's review, 2026-09-23). The split is recomputed from the rendered
   plan whenever the brief is formatted (`splitRelated` in `cli/lib/brief.js`), so it always
   follows the rendering. A degraded related route says why
   (`related documents unavailable: semantic-off`).
5. **Memory** — the top 3 recall matches for the task's title and description (at most 500
   characters of query), cross-project, excluding documents already linked to the task. Every
   match has its citations checked (not only the first), and the section uses the same fill
   order, compaction and trust chips as `recall --budget`, with the same coverage disclosure
   (`index incomplete`, `index coverage unknown`, keyword fallback). `--budget <n>` applies to
   this section only; the task's own text always prints in full.

`--json` returns `{ schemaVersion: 1, task, project, checklist, handoff: { paragraph,
paragraphs }, linked, related: { items, underMemory, alsoUnderMemory, degraded, reason,
hiddenHarvested }, memory: { query,
keyword, note, degraded, reason, index, page, items, budget } }`, where `memory.items` carry their
`tier` and `memory.budget` the planner's decisions (or `null` without `--budget`). A task that does
not exist is an error, as for `prax task show`. In keyword mode (no embedder) every word of the
task text must match a document, so the memory section is often an honest-but-thin miss there;
the section says it ran on keywords.

## Reliability and compatibility

- Budget, delta and brief are reads, except the marker write, which is a monotonic setter.
- Old servers: without `/api/library/changes` the delta fails with the server's 404 and a hint
  that this Prax predates the delta; a pack without `updatedAt` sorts tier 3 in pack order; a
  brief on a server without related-documents lists none and says so.
- The skill bundle gains `cli/lib/budget.js` and the delta; the brief is CLI-only.

## Evidence

Unit tests: `tests/cli/budget.test.js` (estimate, fill order, compaction, planning, labels on
every entry), `tests/cli/recallBudget.test.js` (recall and context budgets, unchanged default),
`tests/cli/delta.test.js`, `tests/cli/brief.test.js`, `tests/cli/skillArgs.test.js` and
`tests/cli/commandLine.test.js` (new flags and refusals), `tests/cli/apiClient.test.js` (agent
headers, marker retry rule). Route tests:
`tests/backend/memoryChangesRoutes.test.js` over a real in-memory SQLite database (classification,
paging and ties, markers monotonic and scoped, agent required). Retrieval eval cases for the
budget and the delta (`tests/eval/fixtures.js`: `MEMORY_DOCS`, `BUDGET_CASES`, `DELTA_CASES`) run
in the keyword mode of `npm run eval` (no embedder needed) and as gates in
`tests/backend/retrievalEval.test.js`. Migration lists updated for 0041.
