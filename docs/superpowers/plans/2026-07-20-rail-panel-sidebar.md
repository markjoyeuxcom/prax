# Rail + Panel Sidebar Implementation Plan

**Goal:** Replace the single wide sidebar with a two-level shell: a slim icon rail owning
top-level navigation, and a browser panel beside it with Projects/Views tabs and a
type-to-filter box — so 60 projects and 80 smart views browse instead of scroll.

**Source:** Sidebar-at-scale discussion (2026-07-20); mockup option B chosen by the user
over fold-and-pin (A) and areas (C).
**Status:** Shipped

## Current state

- Wide windows render `renderSidebarHtml` (brand, nav list, Projects, Smart views, Library
  saved views, Settings); narrow windows (<940px) already swap to `renderRailHtml` — an
  icon rail with project dots. The choice is JS-driven in `renderApp` off `state.winW`.
- Every affordance is a `data-action` (nav-*, nav-project, select-smart-view,
  delete-smart-view, select-saved-view, delete-library-view, manage-projects) — the e2e
  suite navigates via these, so preserving them preserves the tests' meaning.
- Live inputs that survive full re-renders follow the library-search pattern: on input,
  setState → renderApp → re-query the input → focus + caret restore.

## Design decisions

1. **Promote the existing rail.** Wide mode renders the SAME `renderRailHtml` (badges
   added; project dots suppressed — the panel owns projects) + a new `renderPanelHtml`.
   Narrow mode keeps rail-only with dots, exactly as before. One rail renderer, two modes.
2. **The panel is a browser, not a list.** Brand at top, then tabs — Projects (n) /
   Views (n) — then a filter input, then the filtered rows. Rows reuse the existing
   `side-item` markup and data-actions verbatim (dots, open counts, hover-× deletes,
   active states). The Views tab holds task smart views (built-ins included) plus Library
   saved views under a small subheader when any exist.
3. **Filtering is render-side state** (`panelTab`, `panelFilter`), applied in the pure
   renderer; the input uses the library-search focus-restore pattern. Switching tabs
   clears the filter (least surprise). An empty result renders an honest "No matches".
4. **Nothing moves out of reach:** Settings stays in the rail; manage-projects (＋) moves
   to the Projects tab header; every nav item keeps its badge (Today, Inbox counts now
   render on the rail as mini count pills — an upgrade for narrow mode too).
5. **No dual layout.** The old sidebar renderer is deleted, not preference-gated — one
   shell, no drift. Git history keeps the old one.

## Work

- [x] `renderShell.js`: rail gains `counts` (Today/Inbox mini badges) and a
      `{ showProjects }` switch; new `renderPanelHtml`; `renderSidebarHtml` + its
      panel-superseded helpers deleted.
- [x] `state.js`: `panelTab: 'projects'`, `panelFilter: ''`.
- [x] `main.js`: shell composition (rail always; panel on wide), `set-panel-tab` handler,
      `[data-panel-filter]` input handler with focus/caret restore.
- [x] `prax.css`: `.panel` block (reusing side-item row styles), `.rail__badge`, rail
      Settings pushed to the bottom on wide.
- [x] Tests: `renderShell.test.js` pins rewritten for rail+panel (tabs, filter, badge,
      delete affordances, built-in Stale present without delete); new e2e
      `rail-panel.spec.js` (tab switch, filter narrows + no-match state, project nav,
      view nav); `slippage-honesty.spec.js` updated to open the Views tab first.
- [x] CHANGELOG entry.

## Verification (as shipped)

- Unit + e2e suites green after the pin rewrites; full gates recorded in the commit.
- Follow-ups shipped separately: ⌘K palette jump targets (Projects + Views result groups,
  ranked above content search) and pinned favorites (hover-star per row, leading Pinned
  section per tab, pinned-first palette ranking, localStorage-persisted). Still open:
  areas/folders (option C) — layers on top of this shell without rework.

## Risks / notes

- The e2e suite navigates by data-action; keeping the vocabulary identical is the safety
  net. The one behavioral change tests must absorb: smart-view rows are only visible on
  the Views tab.
- The desktop titlebar (drag region, traffic lights) is above the shell body and is
  untouched.
