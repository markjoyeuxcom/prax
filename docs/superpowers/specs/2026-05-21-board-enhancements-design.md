# Board Enhancements Design — Swimlanes & Density

**Date:** 2026-05-21
**Status:** Approved (brainstorm)
**Builds on:** v0.4.1 (projects model + board card signals)

## Goal

Add two deferred board features to Moomora Console:

1. **Project swimlanes** — an opt-in toggle in the All-projects board that groups tasks into one horizontal lane per project.
2. **Board density** — a saved appearance preference (comfortable / compact) that tightens board cards.

The two are cohesive ("board view enhancements") but independently implementable; density can ship on its own.

## Non-goals

- No swimlanes for any view other than the board's All-projects view.
- No grouping dimension other than project (no group-by-priority/assignee).
- Compact density does **not** drop information — all card signals stay visible.
- No backend/API/schema changes. Both features are frontend-only.

---

## Feature 1: Board Density (appearance preference)

Parallels the existing `palette` and `fontScale` preferences exactly.

### Components

- **`public/js/preferences.js`**
  - Add `boardDensity: 'comfortable'` to `DEFAULT_PREFERENCES`.
  - Add `export const BOARD_DENSITY_OPTIONS = Object.freeze(['comfortable', 'compact']);`
  - `normalizePreferences` validates `boardDensity` against `BOARD_DENSITY_OPTIONS`, falling back to the default.
  - `applyPreferences` sets `root.setAttribute('data-board-density', normalized.boardDensity)`.

- **`public/js/renderSettingsPanel.js`**
  - In the Appearance section, add a "Board Density" block with two buttons (`comfortable`, `compact`) rendered from `BOARD_DENSITY_OPTIONS`, using `data-settings-board-density="<value>"` and the same `aria-pressed` selected styling as the font-scale buttons.

- **`public/styles.css`**
  - `:root[data-board-density="compact"] .board-card { padding: 5px 9px; gap: 3px; }`
  - Compact shrinks the card meta/chip/due font slightly (e.g. `0.7rem`) but keeps the priority dot, title, due-date flag, and project chip visible.
  - Comfortable is the current styling (no override).

- **`public/js/main.js`**
  - Bind `[data-settings-board-density]` buttons: merge into `state.preferences`, `savePreferences` + `applyPreferences`, re-render (mirrors the palette handler at the existing `data-settings-palette` binding).
  - The existing `reset-preferences` handler already calls `applyPreferences(resetPreferences())`; since defaults now include `boardDensity`, reset restores comfortable automatically.
  - On load, the existing `applyPreferences(loadPreferences())` call applies `data-board-density`.

### Tests

- `tests/frontend/preferences.test.js`: `BOARD_DENSITY_OPTIONS` includes `compact`; `normalizePreferences` keeps a valid density and rejects an invalid one; `applyPreferences` writes `data-board-density`.
- `tests/frontend/renderSettingsPanel.test.js`: renders both density buttons; marks the active one with `aria-pressed="true"`.

---

## Feature 2: Project Swimlanes (board view toggle)

### Activation

- A `flat / swimlanes` segmented control renders in a small **board toolbar that `main.js` prepends to the board workspace output** (in `renderWorkspacePrimary`'s board branch, above the board panel) — not in the shared shell content-header, so board concerns stay in the board render.
- The toggle is shown **only when `state.activeView === 'board'` and `state.activeProject === 'all'`**.
- In a single-project board (or any non-board view) the control is absent and the layout is always the flat board.
- The chosen grouping is remembered across sessions.

### State

- **`public/js/state.js`**
  - `boardGrouping: 'flat'` — persisted under its own localStorage key `moomora.boardGrouping.v1`, mirroring how `activeProject` is persisted (load on init, save on change). Allowed values `'flat' | 'swimlanes'`; unknown values fall back to `'flat'`.
  - `boardLaneCollapsed: {}` — in-memory map `{ [projectId]: true }` of collapsed lanes (not persisted, like `boardOpenSections`). Absent/false means expanded.

### Rendering

- **`public/js/renderBoard.js`** (keep the flat `renderBoardHtml` unchanged; factor out shared helpers and add a swimlane renderer in the same module):
  - Extract the shared pieces already used by the flat board so both paths reuse them: `COLUMNS`, `priorityClass`, `dueState`, `renderCard`, `renderColumnCards`, and the `ctx` builder (`today`, `showProjectChips`, `projectName`).
  - Add `export function renderSwimlaneBoardHtml(tasks, selectedTaskId, options)` where `options` carries `today`, `projects` (ordered list of `{ id, name, sortOrder }`), and `boardLaneCollapsed`.
    - Group `tasks` by `projectId`.
    - Build lanes for projects that have **at least one active task**, ordered by project `sortOrder` (projects appear in `options.projects` order, which is already sort_order-ordered from the API).
    - Each lane renders:
      - a header: a collapse toggle button (`data-action="toggle-board-lane"`, `data-project-id="<id>"`, `aria-expanded`), a `▾`/`▸` glyph, the project name, and a task count.
      - when expanded: the 5 status columns (`COLUMNS`) scoped to that lane's tasks, via `renderColumnCards`, with `showProjectChips: false` (the lane header already names the project — no need to repeat the chip inside a single-project lane).
      - when collapsed: columns omitted (header only).
  - Tasks whose `projectId` matches no known project are grouped under a trailing "Unassigned" / "No project" lane only if such tasks exist (defensive; normally every task has a project).

- **`public/js/main.js`**
  - `renderWorkspacePrimary`: when `state.activeView === 'board'`, choose the renderer:
    - swimlanes when `state.boardGrouping === 'swimlanes' && state.activeProject === 'all'` → `renderSwimlaneBoardHtml(visibleTasks, selectedTaskId, { today: today(), projects: state.projects, boardLaneCollapsed: state.boardLaneCollapsed })`.
    - otherwise the current `renderBoardHtml(...)` (flat, with `showProjectChips: state.activeProject === 'all'`).
  - Render the `flat / swimlanes` toggle in a board toolbar prepended to the board workspace output (only in the All-projects board) with `data-action="set-board-grouping"` and `data-grouping="flat|swimlanes"`.
  - Wire handlers:
    - `set-board-grouping`: set `state.boardGrouping`, persist to `moomora.boardGrouping.v1`, re-render.
    - `toggle-board-lane`: flip `state.boardLaneCollapsed[projectId]`, re-render.
  - Drag-and-drop: board card drag currently reorders within a status column. In swimlanes the existing per-lane columns reuse the same `data-board-column` hooks; lane drag behaves the same within a lane. (No cross-project drag in scope.)

### Styles

- **`public/styles.css`**
  - `.board-lane` (bordered container, bottom margin), `.board-lane__header` (flex row, surface-warm background, divider), `.board-lane__name` (mono, uppercase), `.board-lane__count` (amber), reusing existing tokens.
  - Collapsed lane: header only (columns not rendered).
  - The lane's inner board uses the existing `.board-panel` grid; on laptop widths it inherits the existing `overflow-x: auto` behavior.

### Tests

- `tests/frontend/renderBoard.test.js` (new cases against `renderSwimlaneBoardHtml`):
  - Renders one lane per project that has tasks; omits projects with no tasks.
  - Lane header shows the project name, count, and a `toggle-board-lane` control with the correct `data-project-id`.
  - A collapsed lane (via `boardLaneCollapsed`) renders the header but not its columns.
  - Cards inside lanes keep the priority dot and due-date flag (chip suppressed inside lanes).
  - The flat `renderBoardHtml` output is unchanged (existing tests still pass).
- A `renderShell`/board-header test (or a `renderWorkspacePrimary`-level assertion if practical): the `flat/swimlanes` toggle appears only in the All-projects board, not in a single-project board.

---

## Data Flow Summary

```text
main.js renderWorkspacePrimary()
  activeView === 'board' ?
    boardGrouping === 'swimlanes' && activeProject === 'all'
      → renderSwimlaneBoardHtml(tasks, sel, { today, projects, boardLaneCollapsed })
      else → renderBoardHtml(tasks, sel, { today, projects, showProjectChips, boardOpenSections })

clicks:
  set-board-grouping  → state.boardGrouping (persist moomora.boardGrouping.v1) → re-render
  toggle-board-lane   → state.boardLaneCollapsed[projectId] toggle → re-render
  data-settings-board-density → state.preferences.boardDensity → save+apply → re-render
```

## Build Order

1. **Density** (preferences → settings panel → CSS → main wiring → tests). Self-contained; can ship first.
2. **Swimlanes state + persistence** (state.js + load/save).
3. **Swimlane renderer** (renderBoard.js shared helpers + `renderSwimlaneBoardHtml` + styles + tests).
4. **Toggle + lane-collapse wiring** (main.js + board-toolbar control + tests).

## Risks / Notes

- `renderBoard.js` grows but stays cohesive ("the board"); the flat path is untouched to protect existing tests.
- Lane collapse and per-column collapse are deliberately separate axes (per-column collapse stays flat-board-only) to avoid two interacting collapse states.
- All changes are frontend-only and covered by the existing `node:test` unit suite; no API, schema, or MCP changes.
