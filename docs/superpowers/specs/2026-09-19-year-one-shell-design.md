# Year-One Shell Design

**Date:** 2026-09-19
**Status:** Approved (brainstorm); items 1–4 implemented
**Builds on:** v0.32.1
**Scope:** The lowest-cost structural fixes from the year-one UI audit (items 1–3), plus the
navigation pair added on 2026-09-19 (item 4: breadcrumb and Recent projects). The full audit
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

Findings the audit raised but this spec leaves for later: folded On-hold in the browser panel,
the shortcut-hint statusbar, the Library table mode and review queue, and ⌘K scopes.

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
- The Playwright spec change is unverified here (no browsers installed on this machine);
  run `npm run test:e2e` before release.
- Manual: at 1360 px the panel filters the grid with live counts and chips appear in the main
  view; at 900 px the rows return; ⋯ opens and closes on outside click; Import from ⋯ opens the
  destination dialog.

## 4. Breadcrumb and Recent projects — implemented

### Decisions

- `buildBreadcrumb(state)` in `renderShell.js` returns `[{ label, action?, data? }]`, last =
  current. Paths: Today · Calendar · All projects · Filter (› smart view) · Area › Project ›
  Tab · Library (› Archive) · Library › document · Library › document › Run · Settings ›
  section. A segment with an `action` renders as a button dispatching that existing action
  (`nav-project`, `nav-library`, `open-linked-doc`, `nav-filter`, `nav-settings`); the area is
  plain text because there is no area view. The `<nav>` keeps `data-tauri-drag-region`, so the
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
