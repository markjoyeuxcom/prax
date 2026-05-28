# Desktop Layout & Navigation Redesign

**Date:** 2026-05-28
**Status:** Approved (brainstorm)
**Builds on:** v0.7.5
**Scope:** Spec A of the UI-improvement effort (desktop layout + navigation + density). Mobile/consistency polish is a separate Spec B.

## Goal

Make the Tasks and Board views use the widescreen the way the Library already does, remove the duplicated navigation, and tighten vertical density — without changing the "operator/TUI" visual language (zero-radius, mono accents, bracket glyphs, the four palettes).

Three coupled changes:

1. **Detail drawer** — Tasks and Board show a full-width list / full-width columns for scanning; selecting a task (or board card) opens a resizable detail drawer overlaid on the right edge. Closing it returns to the full-width surface. This replaces the current stacked-below detail (Tasks) and the stacked-above "selected card" inspector (Board).
2. **Single navigation home** — the left rail owns all navigation: a `WORK` group (Tasks, Board, Library), a `VIEWS` group (Backlog, Archive), then `PROJECTS`. The top bar's view-tabs are removed; the top bar slims to breadcrumb + search + actions.
3. **Density** — the tall metric-card grid on Tasks becomes a compact single-line strip; the Board drops its metric strip entirely and tightens empty-column height. The oversized content-header (large H1 + description paragraph) is removed; the view title lives in the top-bar breadcrumb.

## Current state (context)

- Shell is rendered by [public/js/renderShell.js](public/js/renderShell.js): a left `.sidebar` (brand, `Main` nav with only Tasks/Board/Library via `renderSidebarMainButtons`, `Projects` nav, cluster card) and a `.console-main` containing `.topbar` (hamburger, `topbar-tabs` = all 5 view buttons via `renderViewButtons`, search, actions), a `.content-header` (big H1 + description), a `.metrics-row` (4 `metric-card`s, hidden on Library), the `#workspace` grid, and the `.status-footer`. A `renderBottomNav` (mobile) and `renderHamburgerDrawer` also exist.
- The view list is the module-level `viewButtons` array (list/board/backlog/archive/library) with `heading`/`description`/`label`.
- `#workspace` is a CSS grid. For Tasks, [public/js/main.js](public/js/main.js) `renderWorkspace` appends `renderWorkspacePrimary(...)` (the list) + `renderTaskDetailHtml(...)` (the detail) into the grid; on desktop the grid stacks the detail below. For Board, the detail (`renderBoardInspectorHtml`) is rendered inside `.board-view` above the columns, gated by `state.isBoardTaskDetailOpen`. The mobile full-screen detail is gated by `state.mobileDetailOpen` (class `is-mobile-detail-open`).
- The Library already implements the target pattern: full browser list + resizable pane via `setupLibraryResizer` (drag a `[data-library-resizer]` handle, width stored in localStorage under `LIBRARY_BROWSER_WIDTH_KEY`, applied as a CSS var). This is the reference implementation for the drawer resizer.
- Layout/visual rules live in [public/styles.css](public/styles.css) (the `.workspace`, `.metrics-row`, `.metric-card`, `.sidebar`, `.topbar`, `.content-header`, board, and library-resizer rules).

## Non-goals

- No change to the visual language: palettes, fonts, zero-radius, bracket glyphs, mono accents all stay.
- No change to the Library view (it already has the target layout) beyond shared CSS/JS the drawer reuses.
- No backend, API, MCP, or data-model change. Pure frontend.
- No mobile-specific polish here (clipping, empty square, button clip, archive-toggle styling) — that is Spec B.
- No new keyboard shortcut scheme; existing shortcuts keep working (the `[t]/[b]/[l]` glyphs stay as rail affordances).
- No swimlane/grouping behaviour change; the list/board toolbars keep their current options.

---

## 1. Navigation: left rail owns everything

### Left rail (`renderShell.js`, desktop `.sidebar`)

Replace the single `Main` nav (which lists only Tasks/Board/Library) with two grouped navs, keeping `Projects` and the cluster card below:

```
WORK
  [t] tasks
  [b] board
  [l] library
VIEWS
  [k] backlog
  [r] archive
PROJECTS
  all projects
  personal / work / homelab …
  [...] project tools
```

- `renderSidebarMainButtons` becomes `renderSidebarNavGroups`, emitting the `WORK` group (ids `list`, `board`, `library`) and the `VIEWS` group (ids `backlog`, `archive`), each as a `.side-nav` with its own `.nav-label`. Reuse the existing `nav-button` markup with the key-glyph span. Pick stable glyph letters: `t/b/l` (existing) for WORK, and for VIEWS use `k` (backlog) and `r` (archive) — purely decorative, consistent with the existing affordance style.
- All five buttons carry `data-view="<id>"` exactly as today, so the existing `[data-view]` click handler in `main.js` works unchanged.

### Top bar (`renderShell.js`, `.topbar`)

- Remove the `<nav class="topbar-tabs">${renderViewButtons(...)}</nav>` entirely (this is the duplicate). Delete `renderViewButtons`.
- The top bar becomes: hamburger trigger (mobile only, already CSS-hidden on desktop), a compact breadcrumb/title (`<h1 class="topbar-title">` showing the active view label — preserves the single `h1` landmark that `.content-header` used to provide), the search field, and `.topbar-actions` (settings / admin / import-on-library / new). No other change to actions.

### Content header (`renderShell.js`)

- Remove the `.content-header` block (the large `<h1 id="view-title">` + `<p>` description + sync pill). The view title moves to `.topbar-title` (above). The description string is dropped from the UI (it stays in `viewButtons` data, unused by the shell, harmless). The sync state is already shown in the status-footer and cluster card, so the standalone `Synced` pill is removed.

### Acceptance

- Exactly one set of view-switch controls on desktop (the left rail). No `topbar-tabs` in the DOM.
- Backlog and Archive are reachable from the left rail (previously only via the top tabs).
- The mobile bottom-nav and hamburger drawer are unchanged in this spec.

---

## 2. Density: compact metric strip, slimmer chrome

### Tasks metric strip (`renderShell.js` + `styles.css`)

- Replace the `.metrics-row` of four `.metric-card` blocks with a single-line `.metric-strip`: `due today N · overdue N · in progress N · done this wk N`, label dim, value in `--accent-amber`, separated by dim middots. `renderMetricCards` becomes `renderMetricStrip(metrics)` returning the inline strip. Much shorter than the current card grid.
- The strip renders on the task-bearing views (list/board/backlog/archive contexts) per the existing `isLibraryView` gate — but see Board below.

### Board (`renderShell.js`)

- The Board does **not** show the metric strip (status columns already convey the same signal). Extend the metrics gate: render the strip only when `activeView !== 'library' && activeView !== 'board'`.

### General

- Removing `.content-header` and shrinking metrics reclaims ~120px of vertical space at the top of every task view, which (with the drawer change) lets the list/board fill the canvas.

---

## 3. Task detail drawer (Tasks + Board + Backlog + Archive)

### Behaviour

- On load or view change, **no drawer**: the list (or board columns) spans the full width of `#workspace` for scanning. No task is auto-opened.
- Clicking a task row (Tasks/Backlog/Archive) or a board card (Board) selects it **and** opens the detail drawer.
- The drawer is an **overlay** docked to the right edge of `#workspace`: it floats above the list with a left border + drop shadow; the list underneath does not reflow. A resize grip on the drawer's left edge drags its width; width is clamped and persisted (localStorage, new key `moomora.taskDetailWidth.v1`), mirroring the Library resizer.
- Closing: a `[x]` button in the drawer header and the `Escape` key both close it (set the drawer-closed state). Selection highlight on the row may remain; the drawer simply hides.
- **Mobile**: the drawer renders as the existing full-screen detail overlay (the current `is-mobile-detail-open` behaviour). The same open/close state drives both; CSS decides overlay-right (desktop) vs full-screen (mobile).

### State model (`main.js` + `state.js`)

- Introduce a single `taskDetailOpen` boolean (default `false`) that gates the detail for **all** task views. It supersedes `isBoardTaskDetailOpen` (Board) and unifies with the desktop list behaviour (which previously always rendered the detail).
- `mobileDetailOpen` is retained only as the mobile presentation signal; on mobile, opening the drawer sets both `taskDetailOpen` and `mobileDetailOpen`. (Implementation may fold `mobileDetailOpen` into `taskDetailOpen` + a viewport check if cleaner; the plan decides. The observable contract is: one logical "detail open" state.)
- Row/card click handler: `setState({ selectedTaskId, taskDetailOpen: true, mobileDetailOpen: isMobile() })` then load the task's docs/checklist/activity (existing `selectTask` flow) and re-render.
- Close handler (`[x]` / Esc): `setState({ taskDetailOpen: false, mobileDetailOpen: false })` and re-render.
- View switch and project switch reset `taskDetailOpen` to `false` (start scanning fresh), matching how those handlers already reset `mobileDetailOpen`/`isBoardTaskDetailOpen`.

### Rendering (`main.js` `renderWorkspace` / `renderWorkspacePrimary`)

- Tasks/Backlog/Archive: `renderWorkspacePrimary` returns the full-width list. The detail (`renderTaskDetailHtml`) is appended only when `taskDetailOpen`, wrapped in a `.task-detail-drawer` container that also holds a `[data-task-detail-resizer]` grip. The `#workspace` grid/positioning gives the list full width and positions the drawer as an absolute/overlay element on the right.
- Board: drop `renderBoardInspectorHtml` from inside `.board-view`. The columns render full-width. The detail drawer is the **same** `.task-detail-drawer` element appended at the workspace level (not inside `.board-view`), shown when `taskDetailOpen`. The board's existing per-card detail content needs (docs count, checklist, next action) are already part of `renderTaskDetailHtml`'s sections, so the dedicated board inspector is retired.
- `renderTaskDetailHtml` content is unchanged; only its container and positioning change. It already accepts a `closeAction` option — wire `[x]` to a single `close-task-detail` action for all views.

### Resizer (`main.js`)

- Generalize the Library resizer into a small reusable helper `setupPaneResizer({ resizer, pane, target, cssVar, storageKey, min, max, edge })` where `edge: 'left' | 'right'` controls drag-direction sign (the drawer grows when dragged left; the library browser grows when dragged right). `setupLibraryResizer` becomes a thin caller of it, and the task drawer adds a second caller. Keeps one resizer implementation.

### Board column height (`styles.css`)

- Reduce the board column `min-height` so empty/short columns don't reserve a large fixed block. Columns grow with content; the board area no longer leaves a large empty band beneath one card.

---

## 4. Layout / CSS summary (`public/styles.css`)

- `.workspace` (task views): becomes a positioning context (`position: relative`) so `.task-detail-drawer` can overlay. List/board occupy full width. Remove the old two-row/stacked grid behaviour for the task detail.
- `.task-detail-drawer`: `position: absolute; right: 0; top: 0; bottom: 0; width: var(--task-detail-width, 360px);` with left border + shadow; clamped via the resizer (min ~300, max ~640). Mobile media query overrides to full-screen fixed overlay (reuse the existing mobile detail rules).
- `[data-task-detail-resizer]`: a thin grab handle on the drawer's left edge, styled like `[data-library-resizer]`.
- `.metric-strip`: single-line flex, dim labels, amber values, middot separators; replaces `.metrics-row`/`.metric-card` rules (those rules are removed if no longer referenced).
- Left-rail group labels reuse existing `.nav-label` styling; no new visual primitives.
- Remove `.content-header` rules and `.topbar-tabs` rules; add a compact `.topbar-title`.

---

## 5. Data flow summary

```text
load / switch view / switch project
  → taskDetailOpen = false → full-width list or board columns

click task row / board card
  → setState({ selectedTaskId, taskDetailOpen: true, mobileDetailOpen: isMobile() })
  → load docs/checklist/activity → render
  → desktop: resizable right overlay drawer; mobile: full-screen overlay

[x] or Escape
  → setState({ taskDetailOpen: false, mobileDetailOpen: false }) → render → full-width surface

drag drawer grip
  → --task-detail-width updated + persisted (moomora.taskDetailWidth.v1)
```

---

## Build order

1. **Shell nav + chrome** (`renderShell.js` + CSS): grouped left rail, remove `topbar-tabs`/`renderViewButtons`, add `.topbar-title`, remove `.content-header`, compact `.metric-strip` (+ Board gate). Render tests for the new shell. No behaviour change to the workspace yet.
2. **Resizer generalization** (`main.js`): extract `setupPaneResizer`, re-express `setupLibraryResizer` through it (Library must keep working — its tests/manual behaviour unchanged).
3. **Task detail drawer** (`main.js` + `renderTaskDetail.js` container + CSS): unify detail-open state, render the drawer overlay for Tasks/Backlog/Archive, wire open-on-select + `[x]`/Esc close + resizer + persistence.
4. **Board drawer** (`main.js` `renderWorkspacePrimary` + `renderBoard.js`/CSS): drop the inline inspector, full-width columns, tighter column min-height, card-click opens the shared drawer.

---

## Testing

### Frontend render tests

- `tests/frontend/renderShell.test.js` (new or extend if present):
  - Left rail renders a `WORK` group containing `data-view="list"`, `data-view="board"`, `data-view="library"` and a `VIEWS` group containing `data-view="backlog"`, `data-view="archive"`.
  - The top bar contains **no** `topbar-tabs` / view-switch buttons (assert `data-view` does not appear inside the `.topbar`), and contains a `.topbar-title` with the active view label.
  - No `.content-header` element is emitted.
  - Metric strip: present (single `.metric-strip`, not `.metric-card` grid) for `activeView: 'list'`; absent for `activeView: 'board'` and `activeView: 'library'`.
- `tests/frontend/renderTaskDetail.test.js` (extend): the detail still renders its sections and a close control (`data-action="close-task-detail"`) when a `closeAction` is provided.
- Board render test (`tests/frontend/renderBoard.test.js`, extend): `renderBoardHtml` output no longer contains the inline inspector markup (assert the board columns render without the stacked selected-card panel).

### Manual smoke (PR description, against `npm run demo`)

1. Desktop: left rail shows WORK + VIEWS + PROJECTS; the top bar has no view tabs; switching views works from the rail.
2. Tasks: list is full-width with no drawer on load; clicking a task opens the right drawer; `[x]` and Escape close it; dragging the grip resizes and the width persists across a reload.
3. Board: columns are full-width with no stacked selected-card panel and no metric strip; empty columns are short, not tall; clicking a card opens the same drawer.
4. Backlog/Archive: same drawer behaviour; Archive detail stays read-only (restore/delete).
5. Library: unchanged — still resizes and behaves as before (resizer refactor didn't regress it).
6. Switching view or project closes the drawer and returns to a full-width surface.
7. Mobile width: clicking a task still opens the full-screen detail; bottom nav unchanged.

### Backend

No change.

---

## Risks / notes

- **Largest blast radius is the detail-open state unification.** `isBoardTaskDetailOpen` and the always-on desktop list detail both collapse into `taskDetailOpen`. Every setState that currently resets `isBoardTaskDetailOpen`/`mobileDetailOpen` (view switch, project switch, task save, etc.) must reset `taskDetailOpen` instead/as well. The plan must enumerate these sites; the manual smoke's "switch view/project closes drawer" step guards it.
- **Resizer refactor must not regress Library.** Generalizing `setupLibraryResizer` is the one place existing behaviour could break; step 2 keeps Library green before the drawer reuses the helper.
- **Auto-select change.** Today the list auto-selects the first task and shows its detail; the new model starts with the drawer closed. This is intentional (scan-first), but any code assuming a selected task on load (e.g. board extras, keyboard shortcuts that act on selection) must tolerate `selectedTaskId` being null until the user clicks. The plan checks the shortcut handlers.
- **Visual language unchanged.** This is a layout/structure change only; no palette/typography edits. The drawer, strip, and rail all reuse existing visual primitives (`nav-button`, `nav-label`, bracket buttons, the library resizer styling).
- The dropped `.content-header` description text remains in the `viewButtons` data unused — harmless, and leaves the door open to reintroduce it as a tooltip later without re-plumbing.
