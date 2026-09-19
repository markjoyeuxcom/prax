# Year-One Shell Design

**Date:** 2026-09-19
**Status:** Approved (brainstorm); all nine items implemented — the canvas is built
**Builds on:** v0.32.1
**Scope:** The lowest-cost structural fixes from the year-one UI audit (items 1–3), the
navigation pair (item 4: breadcrumb and Recent projects), the chrome pair (item 5: folded
On hold and the statusbar), the palette (item 6: ⌘K scopes) and the Library table mode with
its review queue (item 7), the Today redesign from the canvas (item 8) and the remaining small
shell pieces of the canvas (item 9), all added on 2026-09-19. The full audit
and the alternative mocks live on the design canvas
[Prax UI Alternatives](https://claude.ai/artifact/DEPREJFVT1bmBLj4Edvjw7) (private; the audit
summary is also a `reference` memory in Prax: "Prax UI audit at year-one scale").

## Goal

Prax was sized for its first month. The audit populated the shell with a plausible year of
heavy use — 34 projects in four areas, ~1,300 open tasks, 612 documents, 143 unverified
agent-written memories — and found the places where the layout stops working. This spec picks
the three fixes that change structure without changing the visual language (Porcelain / Deep
Fern tokens, Instrument Sans, rail + panel + main frame all stay).

## Findings this spec addresses

1. **The project title truncates.** On-call, handoff, repo and area share the header row with
   the title and render even when empty (placeholders included), so "Homelab" reads "Homel…" at
   1360 px. Longer names lose most of their characters.
2. **List groups never fold.** Later, No date and (on the board) Completed render open, so the
   three rows that need action today share the page with forty that do not. Done work has no
   time bucket in the list.
3. **The Library stacks three rows of facets above the first document** while the context panel
   beside it repeats the type facets and shows five recent documents. The header carries eight
   actions.

4. **The titlebar crumb is a caption, not a path.** "prax — Homelab" repeats the page title
   and cannot take you back to the area, the library from a document, or the document from a
   run. Calendar and Filter render an empty crumb. And with 34 projects in the panel there is no
   recency: the three projects you were just in are wherever their areas put them.

5. **Paused work sits between live work, and the statusbar is a cheat sheet.** On-hold
   projects render inside their areas beside active ones, hollow dot or not. The statusbar
   spends its width on five shortcut hints that were learned in week one.

6. **⌘K caps every group at five and has no way in.** A query for "backup" over a year of
   tasks shows five of forty with no count and no next step; nothing can be done to a result
   without opening it.

7. **The Library is cards-only, and agent memory has no queue.** Six hundred documents are
   two hundred rows of three cards each, and the 143 unverified memories agents wrote sit
   behind a trust facet with no count anywhere, no next step, and no way to act on several.

8. **Today is a list, not a cockpit.** Twenty-three overdue tasks render as twenty-three rows
   to handle one at a time; the week's load, what agents wrote overnight and who is on call
   are each a click away in another view.

Every finding of the audit, and the Today artboard, is now covered by this spec.

## 1. Project header: Ops disclosure — implemented

### Decisions

- The header row keeps only the dot, the title, the status chip, the rename pencil and an
  **Ops** toggle on the right. The title gets the row; nothing else pushes on it.
- The four fields move to their **own row** beneath the header. A field with a value renders
  as the same inline input as before (same `data-project-*` attributes, aria labels and
  placeholders, so the debounced PATCH handler is untouched). A field **without** a value
  renders as a small `＋ Field` button; clicking it reveals the input and focuses it.
- The Ops toggle is a `toggle-section` action with key `ops:<projectId>`, the same
  localStorage collapsed-sections regime the panel areas use. Default is expanded. The toggle
  shows a count of set fields so a collapsed row still tells the truth.
- A field the user is typing into is pinned visible for the session (`revealedOpsFields`),
  so clearing a value and a background re-render cannot remove the input under the caret.
- Inbox keeps no ops row, as before.

### Non-goals

- No change to the project API, the ops PATCH contract, or the prax CLI repo detection.
- No handoff/on-call editor beyond the inline inputs.

### Files

- `public/js/renderProjectOps.js` (new, pure): `OPS_FIELDS`, `opsSectionKey`, `revealKey`,
  `setOpsFields`, `renderOpsToggleHtml`, `renderProjectOpsHtml`.
- `public/js/main.js`: header uses the module; `reveal-ops-field` action; ops input handler
  pins the field visible; `revealedOpsFields` in `state.js`.
- `public/prax.css`: `.page-head__title` gets `min-width: 0` and `flex: 1 1 auto`; `.proj-ops`
  becomes a wrapping full-width row; new `.proj-ops__add`, `.page-head__ops-toggle`.

### Testing

- `tests/frontend/renderProjectOps.test.js`: set fields render inputs, unset fields render add
  buttons, revealed fields render inputs, collapsed renders nothing, the toggle carries the
  section key / `aria-expanded` / count, values are escaped.
- `tests/frontend/praxStyles.test.js`: the title can shrink (`min-width: 0`) and the ops row
  wraps on its own line.
- Manual: a project named "Homelab infrastructure and networking" at 1100 px keeps its full
  name; a new project shows four `＋` buttons and no placeholders; collapse persists across
  reload; typing into On call then deleting it keeps the input until you navigate away.

## 2. Collapsible list groups with a "Done this week" bucket — implemented

### Decisions

- Every list group header is a `toggle-section` button (key `list:<projectId>:<group>`) in
  the `collapsedSections` regime. Collapsed groups render the label and count only. The stored
  key means "the opposite of the group's default": due, priority and status groups start open,
  the done groups start folded (`isGroupCollapsed`).
- The former **Completed** group becomes **Done this week** (`completed`) and **Done earlier**
  (`completed-earlier`), split at 7 × 24 h before `now` on `completedAt`, else `updatedAt`
  (the weekly review's fallback; a task with neither stays in "this week" because nothing can
  age it). Both carry an **Archive all** button beside the toggle (a sibling, never nested)
  that dispatches `archive-group`, which archives the group's current tasks through
  `archiveSelectedTasks` — the same undoable path as the bulk bar.
- `applyCollapsedGroups` empties a folded group's tasks and keeps `totalCount`;
  `limitTaskGroups` keeps such groups in place, so `flatIds`, the batch limit and the
  "Showing N of M" row only ever address rows on screen (the Today week-ahead precedent).
- Today, Board, Backlog and Archive are unchanged: `renderTaskGroupsHtml` only emits toggles
  for groups carrying a `sectionKey`.

### Files

- `public/js/renderList.js`: `DONE_WEEK_MS`, `groupSectionKey`, `isGroupCollapsed`,
  `applyCollapsedGroups`, the done split in `buildListGroups`, the toggle header in
  `renderTaskGroupsHtml`, `limitTaskGroups` keeping folded groups.
- `public/js/main.js`: the List tab folds groups before limiting; `archive-group` action.
- `public/prax.css`: `.group-label__toggle`, `.group-label__action`, `.group-label.is-collapsed`.

### Testing

- `tests/frontend/renderList.test.js`: the seven-day split (including `completedAt` winning
  over a later `updatedAt`), default-vs-stored collapse semantics, folded groups leaving the
  collection and the batch count, the toggle / Archive all markup, and Today's plain headers.
- Manual: fold No date, reload, it stays folded; complete a task, it moves under a folded
  "Done this week" whose count goes up; Archive all on it shows the undo toast.

## 3. Library facets move into the context panel — implemented

### Decisions

- The Library panel (`renderLibraryPanel` in `renderShell.js`) carries every filter axis:
  **Type** (all registry types), **Project** and **Trust** (only where a document exists or the
  facet is active, so an active facet can always be cleared), and **Tags** (most-used first,
  folded past `TAG_ROW_LIMIT` with an "N more, by use" row; a "Find a tag…" box appears once
  the tag set outgrows the limit and narrows the list on its own state key,
  `libraryTagFilter`, so nothing leaks into the Projects/Views filter). Saved views and Recent
  stay beneath. Counts come from one shared `libraryFacetCounts`.
- The panel dispatches the same `toggle-lib-type` / `-trust` / `-project` / `-tag` /
  `toggle-lib-tags` / `save-library-view` actions the main view's rows did, so `main.js` gains
  no new filter handlers.
- **Facets apply while browsing.** In the archive and semantic modes the panel shows one line
  saying so instead of dead toggles, matching the main view's existing rule.
- The main view takes `facetsInPanel` from `main.js` (true when `winW >= 940`, the rail/panel
  line). With it, the facet and tag rows are replaced by an **active-filter row**: one
  removable chip per active type, trust, project and tag (each dispatching its toggle), plus
  Save view (tags active) and Clear filters. Narrow windows render exactly what they did.
- The header is **Ask Prax**, **＋ New doc** (the existing template menu) and a **⋯** overflow
  (`toggle-library-menu`, `libraryMenuOpen`) holding New runbook from an incident, Health,
  Weekly review, Import Markdown…, Export… and Archive/Active, every item with its original
  `data-action` and title. Choosing an item closes the menu; the archive view is named in the
  header sub-line since its toggle is now inside the overflow.

### Files

- `public/js/renderLibrary.js`: `libraryFacetCounts`, `TRUST_FACETS` exported;
  `renderLibraryMenu`, `renderActiveFilters`; `renderLibraryHtml(state, model, { facetsInPanel })`.
- `public/js/renderShell.js`: the facet panel.
- `public/js/main.js`: passes `facetsInPanel`; `toggle-library-menu`; the tag-box input handler;
  overflow items close the menu. `public/js/state.js`: `libraryMenuOpen`, `libraryTagFilter`.
- `public/prax.css`: `.filter-row`, `.filter-chip`, `.btn-ghost--icon`, panel tag rows.
- `tests/e2e/import-restore.spec.js`: opens the overflow before clicking Import.

### Testing

- `tests/frontend/renderShell.test.js`: Project/Trust facets and counts, the tag fold, the tag
  box and its narrowing, active-tag visibility, archive/semantic mode.
- `tests/frontend/renderLibrary.test.js`: header contents closed and open, `facetsInPanel`
  hiding the rows and rendering chips, archive/semantic chip rules, `libraryFacetCounts`.
- Playwright: every spec that clicked Import, Export, Health, Weekly review or Archive directly
  now opens the ⋯ overflow first; the focus-restore assertions after the Import and Export
  dialogs expect the overflow button, since the opener is gone once the menu closes (the app
  falls back to it in `afterRender`). Full suite green (121) on 2026-09-19.
- Manual: at 1360 px the panel filters the grid with live counts and chips appear in the main
  view; at 900 px the rows return; ⋯ opens and closes on outside click; Import from ⋯ opens the
  destination dialog.

## 4. Breadcrumb and Recent projects — implemented

### Decisions

- `buildBreadcrumb(state)` in `renderShell.js` returns `[{ label, action?, data? }]`, last =
  current. Paths: Today · Calendar · All projects · Filter (› smart view) · Area › Project ›
  Tab · Library (› Archive) · Library › document · Library › document › Run · Settings ›
  section. A segment with an `action` renders as a button with `data-action="breadcrumb"` and
  `data-target` set to the existing action (`nav-project`, `nav-library`, `open-linked-doc`,
  `nav-filter`, `nav-settings`), which `main.js` re-dispatches. The indirection keeps
  `[data-action="nav-project"]` meaning the rail and panel rows only — the Playwright specs
  and focus restores select on those, and a crumb link matching first (invisible at narrow
  widths, no `aria-current`) broke four of them. The area is plain text because there is no
  area view. The `<nav>` keeps `data-tauri-drag-region`, so the
  desktop titlebar still drags; the buttons inside it still click.
- **Recent** in the browser panel: the last `MAX_RECENT` (3) project ids, most recent first,
  stored per device (`prax.recentProjects.v1`, `public/js/recentProjects.js`) and pushed from
  `goProject`. Rendered above Pinned only when the panel lists at least
  `RECENT_MIN_PROJECTS` (6) projects, never while a filter is typed; ids that no longer render
  are skipped; rows repeat in their area below and carry the area name as a sub-label and no
  pin star (the area row has it).

### Testing

- `tests/frontend/recentProjects.test.js`: push/dedupe/cap, normalize, storage round-trip and
  broken storage.
- `tests/frontend/renderShell.test.js`: every navType's crumb, project link vs current, editor
  / run / archive / settings paths, escaping, the drag region; the Recent section's order,
  stale-id skipping, sub-labels, threshold and filter rules.
- Manual: open Homelab › Board, click "Homelab" in the crumb to return to List; open a document
  and click "Library"; with six projects, visit three and see them lead the panel.

## 5. Folded On hold and the statusbar — implemented

### Decisions

- In the browser panel, `panelProjectRows` partitions the unpinned rows into active (grouped
  by area as before, so area counts are active-only) and on-hold, which render as one trailing
  **On hold** section via the existing `sectionHeader` / `toggle-section` machinery under the
  key `panel:onhold`. The stored key means *expanded* (the opposite of the default, as with
  the list's done groups). A typed filter and a section holding the current project always
  open it. Pinning is applied first, so a pinned on-hold project floats to Pinned as before.
- The statusbar renders `Saved locally`, then `statusbarFacts(state)` — active + on-hold
  projects, open tasks (`isOpen`), unarchived documents — then a `⌘/ shortcuts` button
  (`open-shortcuts`). The hint strip is gone.
- The **Keyboard shortcuts** overlay (`public/js/renderShortcuts.js`, `state.shortcutsOpen`)
  is a modal dialog on the shared `overlay-center` scrim: `SHORTCUT_GROUPS` mirrors the keymap
  in `keyboardShortcuts.js` (Everywhere, Lists and boards, Go to, Quick capture); the desktop
  shell adds the global capture chord from `captureShortcut`. `⌘/` toggles it (new
  `shortcuts` action in `matchShortcut`), Esc closes it first in the cascade, the scrim closes
  it on an outside click, and the Tab trap treats it like the other modal overlays.

### Testing

- `tests/frontend/renderShell.test.js`: the On hold section closed / opened / filtered /
  current / pinned, area counts, and the statusbar facts and button.
- `tests/frontend/renderShortcuts.test.js`: dialog semantics, every group and key renders, the
  listed keys agree with `matchShortcut`, the desktop capture chord.
- `tests/frontend/keyboardShortcuts.test.js`: `⌘/` → `shortcuts`.
- Manual: with an on-hold project the panel shows a folded On hold row that opens on click and
  stays open after reload; `⌘/` and the statusbar button open the overlay, Esc and a scrim
  click close it.

## 6. ⌘K scopes — implemented

### Decisions

- `buildPaletteGroups` builds every group in full, returns `scopes` (`PALETTE_SCOPES` with a
  match count each; All = the sum) and `scope`, then caps per scope: **All** keeps Commands
  uncapped and the search groups at `MAX_SEARCH_ITEMS` (5) plus a `+N more in <Group>` item
  (`action: 'palette-scope'`, selectable like any row) when a group overflows; a **single
  scope** lists that group alone up to `MAX_SCOPED_ITEMS` (40) and carries `truncated` for the
  rest. A scope with an empty query browses the whole group; All with no query stays the
  command list.
- `state.paletteScope` resets to `all` on open. ⇥ / ⇧⇥ in the input call `cyclePaletteScope`;
  pills and the more-row dispatch `palette-scope`; `setPaletteScope` re-renders and returns
  the caret to the end of the input.
- The selected task row renders an inline **Done** (`palette-task-done`, a sibling of the run
  button, never nested); ⌘↵ / Ctrl↵ on a selected task runs the same `toggleTaskDone` and
  closes the palette.

### Testing

- `tests/frontend/renderPalette.test.js`: All-scope cap and more-row, single-scope depth and
  browse, the `MAX_SCOPED_ITEMS` truncation and honest counts, scope helpers, the scope bar,
  the inline Done on the selected task only, footer hints.
- Manual: ⌘K, type a common word, see counts on the pills, ⇥ into Tasks, ⌘↵ on a task marks
  it done with the undo toast.

## 7. Library table mode and the review queue — implemented

### Decisions

- **Table layout** (`renderDocTable`): a flat table of the visible documents — select box,
  title (`open-doc`), type chip, project, trust chips (UNVERIFIED shown explicitly), tags, By
  (`updatedByAgent`, else "agent" for agent-touched documents, else "you"), updated, and a
  **Review** button on unverified rows (`review-doc` → `verifyHealthDoc`: preview mode with
  the Verify control and a toast saying to read first). The cards/table choice is per device
  (`public/js/libraryLayout.js`, `prax.libraryLayout.v1`), switched beside Sort; the archive
  keeps its rows and the queue is always a table, so the switch hides there.
- **Selection and bulk bar**: `librarySelectedDocIds`, `toggle-doc-selection`,
  `select-visible-docs` (all shown ↔ clear), `clear-doc-selection`. The bulk bar's one action
  is **Archive** (`bulk-archive-docs`): each id goes through `reconcileDocumentLifecycle` +
  `cacheLifecycleDocument`, then one reload and one summary toast. No bulk verify: the trust
  model requires reading the saved content before verifying (the editor's revision check),
  and supersede needs a replacement per document.
- **Review queue**: `isReviewQueueDoc` = agent-written (`TRUST_PREDICATES.agent`) and not
  verified, superseded or archived. `libraryView: 'review'` narrows the model to the queue
  before facets, tags and the query; `reviewQueueSummary` feeds the banner (total, per agent,
  stale). Entry points: the panel's first row (`open-review-queue`, shown while anything waits
  or the queue is open), the rail's amber Library badge (`counts.reviewQueue`), the ⋯ menu item
  with a count, and the breadcrumb `Library › Review queue`. `toggleReviewQueue` flips between
  review and active without dropping facets; `back-to-library` from a document opened in the
  queue returns to the queue. **Review next** opens the first unverified document in the
  current order.

### Testing

- `tests/frontend/libraryLayout.test.js`; `tests/frontend/renderLibrary.test.js` (queue
  predicate and summary, the review model, the review page, both empty states, table layout
  and toggle, selection and the bulk bar, the overflow item); `tests/frontend/renderShell.test.js`
  (panel row, rail badge, breadcrumb).
- Manual: create an agent-written document via the API, see the badge and panel row, open the
  queue, Review a row, Verify in the editor, go back and see the queue shrink; switch the
  browse view to table and archive two selected documents.

## 8. Today, year one — implemented

### Decisions

- `buildTodayGroups` orders Overdue oldest first and returns `overdueCount`, `slippedCount`
  (deferred at least `SLIPPED_DEFERRALS` = 2 times) and `dueTodayCount`. `main.js` trims the
  overdue group to `OVERDUE_PREVIEW` (5) unless the stored key `today:overdue-all` says show
  all, so the collection (and ↑↓) only holds what is on screen.
- **Triage band** (`renderTriageBand`): count chip, the slipping sentence, and three set-level
  decisions — `triage-all` with `monday` (next Monday via `nextWeekday`) or `backlog`, and
  Review one by one (`open-plan-mode`). Rows are the shared task rows with the project chip;
  the selected row is followed by a sibling decision strip (`triage-task`: today / monday /
  backlog). `triageTasks` applies the patch through the per-task mutation queue and offers one
  undo that restores each task's prior due date or status.
- **Ritual tails** via `group.tailHtml` on plain group headers: Planned → Edit plan
  (`open-plan-mode`); Due today → Add all to plan (`plan-add-today`, `plannedFor` = today).
  The header gains Weekly review (`generate-weekly-review`) with a *due* chip from
  `weeklyReviewStatus` (no review, or the latest older than six days — the nudge's rule).
- **Side column** (`.today-layout`, one column under 1180 px): `weekLoad` (open tasks due per
  day for seven days from today), `recentAgentDocs` (agent-written, last 24 h, newest first,
  four at most, with the review-queue link), `onCallProjects` (live projects carrying on-call
  or handoff notes, two at most). Cards render only when they have something to say; the week
  strip always renders.
- The Today panel gains a **Rituals** section: Weekly review (with the same due state), Brief
  me, Library health.

### Testing

- `tests/frontend/renderToday.test.js`: overdue order and counts, the band (chip, sentence,
  bulk buttons, preview and unfold, the decision strip on the selected row only), the ritual
  tails and weekly chip, `weekLoad`, `recentAgentDocs`, `onCallProjects`,
  `weeklyReviewStatus`, `nextMondayIso`, and the side cards from state.
- `tests/frontend/renderShell.test.js` (panel rituals), `tests/frontend/renderList.test.js`
  (`tailHtml`).
- Manual: with overdue tasks, Reschedule all to Monday moves them and Undo restores; select a
  row and use its strip; Add all to plan fills Planned; the cards reflect agent writes and
  on-call notes.

## 9. The remaining small pieces of the canvas — implemented

- **New ▾ split button** (`renderNewSplitHtml`): `open-capture` stays primary; the chevron
  (`toggle-new-menu`, `newMenuOpen`) opens New task / New document (`new-document`) / New
  project (`new-project` → All projects with `[data-new-project-name]` focused). Closed by the
  shared outside-click rule.
- **Rail project tiles** (`railProjectsHtml`, `RAIL_PROJECT_LIMIT` = 5): in narrow windows the
  rail shows the current project, then pinned, then recent — lettered tiles in the project
  colour — instead of every project as a dot. Nothing pinned or recent means no tiles.
- **Row density**: `preferences.listDensity` (`comfortable` | `compact`, normalized like the
  other preferences) applied as `data-density` on `<body>`; a two-button toggle beside Group
  on the List tab (`set-list-density`). Compact tightens task rows, list rows and table rows.
- **Reschedule all on a project's Overdue header**: `buildListGroups` attaches a
  `triage-all` tail with `data-project-id`; `main.js` scopes the set to that project's overdue
  group. `renderTaskGroupsHtml` renders `tailHtml` on section-keyed headers too.
- **Library**: the Semantic toggle is a Keyword | Semantic segment (`set-search-mode`);
  Group: Type / None (`cycle-lib-group`, `libraryGroupBy`) — None is one flat run in sort
  order; both hidden in the archive and in semantic mode.
- **⌘K**: the selected task's row offers Today (`palette-task-today` → the triage path with
  today's date) beside Done.
- Tests: `renderShell.test.js` (split button, tiles: order, cap, none), `preferences.test.js`
  (density), `renderList.test.js` (the tail on section headers), `renderLibrary.test.js`
  (segment, group control), `renderPalette.test.js` (Today).

## 10. Dark-mode and accessibility pass — implemented

- `tests/e2e/accessibility.spec.js` gains a "year-one surfaces" audit: Today with a triage band,
  the Library table, the review queue with its banner, ⌘K with scopes, the shortcuts overlay and
  the New menu, each in light and dark. The open-menu state skips `target-size` only, because a
  popover covers what sits beneath it by design; its own items are held to every other rule.
- Findings fixed: alarm red as small text (`--hi-text`, used by the overdue chip, the Overdue
  group label and the rail badge); the UNVERIFIED chip's undefined `--surface2` and translucent
  ground; `role="cell"` / `columnheader` on every Library table cell; 24 px targets on the Today
  card links; `role="menuitem"` on every `.menu__item`.
- Visual check in Deep Fern: project list, Today, Library cards and table, review queue, ⌘K,
  shortcuts overlay, New menu — all on tokens, nothing hard-coded.

## 11. Review-queue walk — implemented

- `state.reviewWalk = { ids, index, verified }` is a snapshot of the queue as shown
  (`visibleLibraryDocuments()` filtered by `isReviewQueueDoc`), started by a row's Review or
  the banner's Review next. `renderReviewWalkHtml` (in `renderEditor.js`) renders the strip
  only while the walk's current id is the open document, so opening anything else hides it.
- **Verify and next** (`review-walk-verify`) runs the existing `changeDocumentVerification`
  through `performDocumentLifecycleOnce` and advances only if the document is verified
  afterwards — a refused verification (dirty draft, changed revision) leaves the strip with
  its toast. **Skip** (`review-walk-skip`) advances; both skip ids no longer in the queue. The
  end returns to the queue (`goLibrary({ libraryView: 'review' })`) with a count toast.
  `back-to-library` clears the walk.
- Tests: `tests/frontend/renderEditor.test.js` (strip conditions and labels),
  `tests/e2e/review-queue-walk.spec.js` (verify-and-next, verify-and-finish with the API
  confirming both verified, skip without verifying, back to queue).

## 12. Board at year one — implemented

- `buildBoardColumns(state, tasks, { now })` keeps only `doneWithinWeek` tasks in the
  Completed column (relabelled **Done this week**) and reports `olderCount`; the column renders
  a footer button to the List tab (`set-tab`) naming the older cards.
- The extras endpoint adds `latestActivityKind` (the `task_activity.event_type` behind
  `latestActivity`, additive). Cards hide the activity line when the kind is `created`, or,
  for an extras row without a kind, when the message is the creation message.
- Tests: `renderBoard.test.js` (time box, older count and footer, creation-only activity),
  backend repository and route shape tests carry the new field.
