# List-View Swimlanes Design

**Date:** 2026-05-21
**Status:** Approved (brainstorm)
**Builds on:** v0.5.1 + PR #8 (task detail enrichment)

## Goal

Bring the board view's project **swimlanes** to the **Tasks list view**. When viewing **all projects**, the active Tasks queue can optionally group task cards under collapsible per-project section headers, mirroring the board's `boardGrouping: 'flat' | 'swimlanes'` behaviour. Today the all-projects list is a flat list whose cards show no project, so you cannot tell which project a task belongs to — swimlanes supply that grouping.

## Context

- The board already has swimlanes (shipped in the board-enhancements work):
  - State: `boardGrouping` (`'flat' | 'swimlanes'`, persisted to `moomora.boardGrouping.v1`) and `boardLaneCollapsed` (`{ [projectId]: true }`, **session-only**).
  - Render: `renderSwimlaneBoardHtml` builds lanes from projects-that-have-tasks plus a `"No project"` orphan lane (`__none__`) for tasks whose `projectId` is unknown; each lane has a collapsible header (▾/▸ glyph, name, `· count`). `renderBoardToolbar(grouping)` is a flat/swimlanes segmented toggle shown **only when viewing all projects**.
  - Handlers: `set-board-grouping`, `toggle-board-lane`.
- The list view (`renderList.js`) renders a `.task-panel` (title + count header) and a flat `.task-list` of cards via `renderCards`. `renderCard(task, selectedTaskId)` shows title, priority badge, status · due · description, and tags — **no project indicator**.
- `renderListHtml` is used by both the active **Tasks** view and the **Archive** view (via `listOptionsForView(activeView)`).

## Decisions (from brainstorm)

1. **Independent per-view preference.** A new `listGrouping` preference parallel to `boardGrouping` — the list and board each remember their own flat/swimlanes choice. Toggling one does not change the other.
2. **Scope: active Tasks view only.** Swimlanes appear only on the all-projects active Tasks queue. The Archive list stays flat.
3. **Reuse board lane behaviour:** only projects with ≥1 visible task get a lane; a trailing `"No project"` lane collects tasks with unknown `projectId`; lanes are collapsible.
4. **Collapse state is session-only**, in a separate `listLaneCollapsed` map (mirrors the board's session-only collapse; independent of the board's map).

## Non-goals (v1)

- No swimlanes on the Archive list.
- No per-card project chips in flat mode (project context comes from the lane header in swimlanes mode).
- No reordering tasks across lanes (within-lane order is the existing list order).
- No persisted collapse state (resets each session, like the board).
- No change to filtering/sorting — swimlanes only partition the already-filtered/sorted visible tasks by project.

---

## Architecture

Approach: **mirror the board pattern inside `renderList.js`**, leaving the board renderer untouched. A small pure `buildProjectLanes` helper lives in `renderList.js`. New `listGrouping` state + handlers parallel the board's. This copies a proven pattern, keeps each renderer focused, and is the lowest-risk option.

### 1. State (`public/js/state.js`)

- Add to initial state:
  - `listGrouping: 'flat'` — `'flat' | 'swimlanes'`, persisted.
  - `listLaneCollapsed: {}` — `{ [projectId]: true }`, session-only (not persisted).
- Add persistence helpers mirroring `loadBoardGrouping`/`persistBoardGrouping`:
  - `LIST_GROUPING_KEY = 'moomora.listGrouping.v1'`.
  - `loadListGrouping(storage = globalThis.localStorage)` → returns `'swimlanes'` if stored value is `'swimlanes'`, else `'flat'`; tolerant of storage errors (try/catch → `'flat'`).
  - `persistListGrouping(value, storage = globalThis.localStorage)` → writes `'swimlanes'` or `'flat'`; swallows storage errors.

### 2. Rendering (`public/js/renderList.js`)

- `buildProjectLanes(tasks, projects)` — pure helper:
  - Returns an array of `{ project, tasks }` for each project (in `projects` order) that has ≥1 task in `tasks`.
  - Appends a trailing `{ project: { id: '__none__', name: 'No project' }, tasks: orphans }` lane **only if** there are tasks whose `projectId` is not among the known project ids.
  - Does not mutate inputs; tolerates `tasks`/`projects` being `undefined` (treat as `[]`).
- `renderSwimlaneListHtml(tasks = [], selectedTaskId = null, options = {})`:
  - `options`: `{ projects = [], listLaneCollapsed = {}, title, countLabel, emptyTitle, emptyDescription }`.
  - Wraps in the same `.task-panel` shell as `renderListHtml` (header with title + total count).
  - If there are no tasks, renders the existing empty state (reuse the empty-state markup `renderListHtml` uses).
  - Otherwise, for each lane from `buildProjectLanes`, render a collapsible `.task-lane` section:
    - `data-task-lane="<projectId>"`, with a `--collapsed` modifier class when collapsed.
    - Header button: `data-action="toggle-list-lane" data-project-id="<projectId>"`, `aria-expanded`, a `.task-lane__glyph` (▾ open / ▸ collapsed), `.task-lane__name` (escaped project name), `.task-lane__count` (`· <n>`).
    - Body (omitted when collapsed): `renderCards(laneTasks, selectedTaskId, emptyTitle, emptyDescription)` — reuses the existing card renderer so selection, tags, and card markup are identical to flat mode.
  - All interpolated values escaped via the existing `escapeHtml`.
- `renderListToolbar(grouping = 'flat')`:
  - A segmented flat/swimlanes toggle mirroring `renderBoardToolbar`: two buttons `data-action="set-list-grouping" data-grouping="flat|swimlanes"` with `aria-pressed` reflecting the active grouping. Wrapper class e.g. `list-toolbar` / `list-toolbar__group` (parallel to `board-toolbar`).

### 3. Wiring (`public/js/main.js`)

- Import `renderSwimlaneListHtml`, `renderListToolbar` (alongside `renderListHtml`), and `loadListGrouping`/`persistListGrouping` (alongside the board grouping imports).
- In `renderWorkspacePrimary`'s list branch (the `return renderListHtml(...)` path):
  - `isAllProjects = state.activeProject === 'all'`.
  - `useSwimlanes = state.listGrouping === 'swimlanes' && isAllProjects && state.activeView === 'tasks'`.
  - When `useSwimlanes`: render a wrapper containing `renderListToolbar(state.listGrouping)` + `renderSwimlaneListHtml(visibleTasks, selectedTaskId, { projects: state.projects, listLaneCollapsed: state.listLaneCollapsed, ...listOptionsForView(state.activeView) })`. Wrap toolbar + panel in a single container element (e.g. `<div class="list-view">`) so the workspace grid treats the list as one primary cell (same lesson as the board `.board-view` wrapper).
  - When not: render the toolbar only when `isAllProjects && state.activeView === 'tasks'`, followed by the current flat `renderListHtml(...)`, in the same `list-view` wrapper. (So the toggle is visible in flat mode too, letting the user switch into swimlanes.) In archive view or single-project view, render the flat list with no toolbar (current behaviour).
- Restore `listGrouping: loadListGrouping()` in the init/bootstrap state load (where `boardGrouping: loadBoardGrouping()` is set).
- Handlers (bind where `set-board-grouping` / `toggle-board-lane` are bound):
  - `set-list-grouping`: read `data-grouping`, `setState({ listGrouping })`, `persistListGrouping(grouping)`, re-render.
  - `toggle-list-lane`: read `data-project-id`, `setState({ listLaneCollapsed: { ...state.listLaneCollapsed, [id]: state.listLaneCollapsed[id] !== true } })`, re-render.

### 4. Styling (`public/styles.css`)

- Add `.list-view` (container), `.list-toolbar` / `.list-toolbar__group` / `.list-toolbar__option` (mirror `.board-toolbar`), and `.task-lane`, `.task-lane__header`, `.task-lane__toggle`, `.task-lane__glyph`, `.task-lane__name`, `.task-lane__count`, `.task-lane--collapsed` — reusing existing design tokens, visually consistent with the board lanes. Must work inside the existing list panel and the mobile drill-down (card markup is unchanged).

## Data Flow

```text
activeProject='all' + activeView='tasks' + listGrouping='swimlanes'
  → renderWorkspacePrimary → list-view wrapper:
      renderListToolbar(listGrouping)
      renderSwimlaneListHtml(visibleTasks, selectedTaskId, { projects, listLaneCollapsed, ...listOptions })
        → buildProjectLanes(visibleTasks, projects) → [{project, tasks}] (+ orphan lane)
        → per lane: collapsible header + renderCards(laneTasks, selectedTaskId, …)

set-list-grouping  → setState({listGrouping}) + persistListGrouping → re-render
toggle-list-lane   → setState({listLaneCollapsed[id] = !current}) → re-render
```

## Testing (`node:test`)

- **`tests/frontend/renderList.test.js`:**
  - `renderSwimlaneListHtml` groups cards under per-project headers with names and `· count`.
  - Only projects with ≥1 task appear (a project with no visible tasks has no lane).
  - A task with an unknown `projectId` appears under a `"No project"` lane (`data-task-lane="__none__"`); no orphan lane when all tasks map to known projects.
  - A collapsed lane (via `listLaneCollapsed`) hides its cards but keeps the header + count and sets `aria-expanded="false"` / `--collapsed`.
  - Empty input renders the existing empty state.
  - `renderListToolbar` renders both flat and swimlanes options with `aria-pressed` on the active one and `data-action="set-list-grouping"`.
  - Selection still applies inside a lane (selected card carries `is-selected` / `aria-current`).
- **`tests/frontend/state.test.js` (or the existing state test file):**
  - `loadListGrouping` returns `'swimlanes'` when stored, `'flat'` otherwise and on storage error.
  - `persistListGrouping` writes the normalized value and swallows storage errors.

## Build Order

1. State: `listGrouping` + `listLaneCollapsed` + `loadListGrouping`/`persistListGrouping` (+ tests).
2. Render: `buildProjectLanes`, `renderSwimlaneListHtml`, `renderListToolbar` (+ render tests).
3. Wiring: `renderWorkspacePrimary` branch, init restore, `set-list-grouping` / `toggle-list-lane` handlers.
4. Styles: `.list-view` / `.list-toolbar` / `.task-lane*` CSS.
5. Verify: `npm test`, `npm run check`, demo smoke (`npm run demo`, all-projects Tasks view → toggle swimlanes → collapse lanes).

## Risks / Notes

- The list renderer is shared with the Archive view; the `activeView === 'tasks'` guard keeps swimlanes off the archive (and off single-project views) — tests must cover that the flat path is unchanged.
- Within-lane ordering is whatever order tasks arrive in; no extra sort is introduced.
- Keep `renderList.js` focused: `buildProjectLanes` is a small pure helper; the board renderer is not modified.
- Mobile drill-down reuses the same card markup, so no mobile-specific work is expected beyond CSS that fits the existing list panel.
