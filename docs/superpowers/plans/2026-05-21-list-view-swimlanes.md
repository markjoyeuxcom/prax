# List-View Swimlanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional per-project swimlane grouping to the Tasks list view (active Tasks queue, all-projects only), mirroring the board's swimlanes.

**Architecture:** Mirror the existing board swimlane pattern entirely on the frontend. New `listGrouping` (persisted) + `listLaneCollapsed` (session-only) state parallel to `boardGrouping`/`boardLaneCollapsed`. `renderList.js` gains a private `buildProjectLanes` helper, a `renderSwimlaneListHtml` renderer, and a `renderListToolbar` toggle; the flat/swimlanes toggle is placed in the existing `.panel-header` (which is already `display:flex; justify-content:space-between`), so no workspace-grid wrapper is needed (a cleaner choice than the board's `.board-view` wrapper). `main.js` branches the list render and wires two handlers. The board renderer is untouched.

**Tech Stack:** Vanilla ES modules (`public/js/state.js`, `public/js/renderList.js`, `public/js/main.js`), CSS (`public/styles.css`), tests via `node:test` (`npm test`), syntax gate `npm run check`.

**Setup note:** `node_modules` is absent in this worktree — run `npm ci` once before the first `npm test`.

---

## File Structure

- `public/js/state.js` — **Modify.** Add `listGrouping` + `listLaneCollapsed` to initial state; add `LIST_GROUPING_KEY`, `loadListGrouping`, `persistListGrouping` (mirrors the existing board grouping helpers). (Task 1)
- `tests/frontend/state.test.js` — **Modify.** Add load/persist tests for `listGrouping`. (Task 1)
- `public/js/renderList.js` — **Modify.** Add private `buildProjectLanes`, private `renderListPanel` (extracted shared panel shell), exported `renderSwimlaneListHtml`, exported `renderListToolbar`; refactor `renderListHtml` to use `renderListPanel` and accept an `options.toolbar`. (Task 2)
- `tests/frontend/renderList.test.js` — **Modify.** Add swimlane + toolbar render tests. (Task 2)
- `public/js/main.js` — **Modify.** Imports; `renderWorkspacePrimary` list branch; init restore; `set-list-grouping` / `toggle-list-lane` handlers. (Task 3)
- `public/styles.css` — **Modify.** Add `.list-toolbar*` and `.task-lane*` rules. (Task 4)

---

## Task 1: List grouping state + persistence

**Files:**
- Modify: `public/js/state.js`
- Test: `tests/frontend/state.test.js`

- [ ] **Step 1: Add failing tests**

In `tests/frontend/state.test.js`, change the import on line 3 from:
```js
import { loadBoardGrouping, persistBoardGrouping } from '../../public/js/state.js';
```
to:
```js
import { loadBoardGrouping, persistBoardGrouping, loadListGrouping, persistListGrouping } from '../../public/js/state.js';
```

Then append these tests to the end of the file (they reuse the existing `storageWith` helper defined at the top of the file):
```js
test('loadListGrouping defaults to flat when unset or unknown', () => {
  assert.equal(loadListGrouping(storageWith()), 'flat');
  assert.equal(loadListGrouping(storageWith({ 'moomora.listGrouping.v1': 'weird' })), 'flat');
});

test('loadListGrouping returns swimlanes when stored', () => {
  assert.equal(loadListGrouping(storageWith({ 'moomora.listGrouping.v1': 'swimlanes' })), 'swimlanes');
});

test('persistListGrouping stores a normalized value', () => {
  const storage = storageWith();
  persistListGrouping('swimlanes', storage);
  assert.equal(storage.getItem('moomora.listGrouping.v1'), 'swimlanes');
  persistListGrouping('nonsense', storage);
  assert.equal(storage.getItem('moomora.listGrouping.v1'), 'flat');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `loadListGrouping`/`persistListGrouping` are not exported (import error or undefined).

- [ ] **Step 3: Add state fields**

In `public/js/state.js`, find the initial state lines:
```js
  boardGrouping: 'flat',        // 'flat' | 'swimlanes' (All-projects board only)
  boardLaneCollapsed: {},        // { [projectId]: true } collapsed lanes (session-only)
};
```
and change them to:
```js
  boardGrouping: 'flat',        // 'flat' | 'swimlanes' (All-projects board only)
  boardLaneCollapsed: {},        // { [projectId]: true } collapsed lanes (session-only)
  listGrouping: 'flat',         // 'flat' | 'swimlanes' (All-projects Tasks view only)
  listLaneCollapsed: {},         // { [projectId]: true } collapsed list lanes (session-only)
};
```

- [ ] **Step 4: Add persistence helpers**

In `public/js/state.js`, find the end of `persistBoardGrouping`:
```js
export function persistBoardGrouping(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(BOARD_GROUPING_KEY, value === 'swimlanes' ? 'swimlanes' : 'flat');
  } catch {
    /* ignore storage failures */
  }
}
```
and add immediately after it:
```js

const LIST_GROUPING_KEY = 'moomora.listGrouping.v1';

export function loadListGrouping(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(LIST_GROUPING_KEY) === 'swimlanes' ? 'swimlanes' : 'flat';
  } catch {
    return 'flat';
  }
}

export function persistListGrouping(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(LIST_GROUPING_KEY, value === 'swimlanes' ? 'swimlanes' : 'flat');
  } catch {
    /* ignore storage failures */
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all existing + 3 new tests).

- [ ] **Step 6: Commit**

```bash
git add public/js/state.js tests/frontend/state.test.js
git commit -m "$(cat <<'EOF'
feat: add list-view grouping state and persistence

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: List swimlane renderers + toolbar

**Files:**
- Modify: `public/js/renderList.js`
- Test: `tests/frontend/renderList.test.js`

- [ ] **Step 1: Add failing render tests**

In `tests/frontend/renderList.test.js`, change the `renderList.js` import (line 3) from:
```js
import { renderListHtml } from '../../public/js/renderList.js';
```
to:
```js
import { renderListHtml, renderSwimlaneListHtml, renderListToolbar } from '../../public/js/renderList.js';
```

Then append these tests to the end of the file:
```js
const SWIMLANE_PROJECTS = [
  { id: 'p1', name: 'Homelab' },
  { id: 'p2', name: 'Work' },
];

test('renderSwimlaneListHtml groups cards under per-project lane headers', () => {
  const tasks = [
    { id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' },
    { id: 't2', title: 'Beta', priority: 'low', status: 'planned', projectId: 'p2' },
  ];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.match(html, /data-task-lane="p1"/);
  assert.match(html, /data-task-lane="p2"/);
  assert.match(html, /class="task-lane__name">Homelab</);
  assert.match(html, /class="task-lane__name">Work</);
  assert.match(html, /class="task-lane__count">· 1</);
  assert.match(html, /Alpha/);
  assert.match(html, /Beta/);
  assert.match(html, /data-action="toggle-list-lane"[^>]*data-project-id="p1"/);
});

test('renderSwimlaneListHtml only renders lanes for projects with tasks', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.match(html, /data-task-lane="p1"/);
  assert.doesNotMatch(html, /data-task-lane="p2"/);
});

test('renderSwimlaneListHtml puts unknown-project tasks in a No project lane', () => {
  const tasks = [{ id: 't1', title: 'Orphan', priority: 'medium', status: 'planned', projectId: 'ghost' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.match(html, /data-task-lane="__none__"/);
  assert.match(html, /class="task-lane__name">No project</);
});

test('renderSwimlaneListHtml omits the No project lane when every task maps to a known project', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS });
  assert.doesNotMatch(html, /data-task-lane="__none__"/);
});

test('renderSwimlaneListHtml hides cards in a collapsed lane but keeps the header', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, null, { projects: SWIMLANE_PROJECTS, listLaneCollapsed: { p1: true } });
  assert.match(html, /task-lane--collapsed/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /class="task-lane__name">Homelab</);
  assert.doesNotMatch(html, /data-task-id="t1"/);
});

test('renderSwimlaneListHtml renders the empty state when there are no tasks', () => {
  const html = renderSwimlaneListHtml([], null, { projects: SWIMLANE_PROJECTS, emptyTitle: 'No tasks', emptyDescription: 'Nothing here' });
  assert.match(html, /task-list--empty/);
});

test('renderSwimlaneListHtml marks the selected card inside its lane', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned', projectId: 'p1' }];
  const html = renderSwimlaneListHtml(tasks, 't1', { projects: SWIMLANE_PROJECTS });
  assert.match(html, /class="task-card[^"]*is-selected"/);
  assert.match(html, /aria-current="true"/);
});

test('renderListToolbar renders flat and swimlanes options with the active one pressed', () => {
  const html = renderListToolbar('swimlanes');
  assert.match(html, /data-action="set-list-grouping"[^>]*data-grouping="flat"[^>]*aria-pressed="false"/);
  assert.match(html, /data-action="set-list-grouping"[^>]*data-grouping="swimlanes"[^>]*aria-pressed="true"/);
});

test('renderListHtml still renders a flat task list and panel header', () => {
  const tasks = [{ id: 't1', title: 'Alpha', priority: 'high', status: 'planned' }];
  const html = renderListHtml(tasks, 't1', { title: 'Task Queue', countLabel: 'active tasks' });
  assert.match(html, /class="task-panel"/);
  assert.match(html, /id="task-queue-title">Task Queue</);
  assert.match(html, /1 active tasks/);
  assert.match(html, /class="task-list"/);
  assert.match(html, /Alpha/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `renderSwimlaneListHtml` / `renderListToolbar` not exported.

- [ ] **Step 3: Add the shared panel helper and refactor `renderListHtml`**

In `public/js/renderList.js`, replace the existing `renderListHtml` function (the block starting `export function renderListHtml(` through its closing `}`) with:
```js
function renderListPanel(bodyHtml, options = {}) {
  const title = options.title || 'Task Queue';
  const countLabel = options.countLabel || 'active tasks';
  const count = Number.isFinite(options.count) ? options.count : 0;
  const toolbar = options.toolbar || '';

  return `
    <section class="task-panel" aria-labelledby="task-queue-title">
      <header class="panel-header">
        <div>
          <h2 id="task-queue-title">${escapeHtml(title)}</h2>
          <p>${count} ${escapeHtml(countLabel)}</p>
        </div>
        ${toolbar}
      </header>
      ${bodyHtml}
    </section>`;
}

export function renderListHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const body = `<div class="task-list">${renderCards(safeTasks, selectedTaskId, options.emptyTitle, options.emptyDescription)}
      </div>`;
  return renderListPanel(body, { ...options, count: safeTasks.length });
}
```

- [ ] **Step 4: Add `buildProjectLanes`, `renderSwimlaneListHtml`, and `renderListToolbar`**

Append to the end of `public/js/renderList.js`:
```js
function buildProjectLanes(tasks, projects) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeProjects = Array.isArray(projects) ? projects : [];
  const lanes = safeProjects
    .map(project => ({ project, tasks: safeTasks.filter(t => t.projectId === project.id) }))
    .filter(lane => lane.tasks.length > 0);
  const known = new Set(safeProjects.map(p => p.id));
  const orphans = safeTasks.filter(t => !known.has(t.projectId));
  if (orphans.length) lanes.push({ project: { id: '__none__', name: 'No project' }, tasks: orphans });
  return lanes;
}

export function renderSwimlaneListHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const projects = Array.isArray(options.projects) ? options.projects : [];
  const collapsed = options.listLaneCollapsed || {};
  const lanes = buildProjectLanes(safeTasks, projects);

  const body = lanes.length
    ? `<div class="task-lanes">${lanes.map(({ project, tasks: laneTasks }) => {
        const isCollapsed = collapsed[project.id] === true;
        return `
        <section class="task-lane${isCollapsed ? ' task-lane--collapsed' : ''}" data-task-lane="${escapeHtml(project.id)}">
          <header class="task-lane__header">
            <button class="task-lane__toggle" type="button" data-action="toggle-list-lane" data-project-id="${escapeHtml(project.id)}" aria-label="Toggle ${escapeHtml(project.name)}" aria-expanded="${!isCollapsed}">
              <span class="task-lane__glyph">${isCollapsed ? '▸' : '▾'}</span>
              <span class="task-lane__name">${escapeHtml(project.name)}</span>
              <span class="task-lane__count">· ${laneTasks.length}</span>
            </button>
          </header>
          ${isCollapsed ? '' : `<div class="task-lane__cards">${renderCards(laneTasks, selectedTaskId, options.emptyTitle, options.emptyDescription)}</div>`}
        </section>`;
      }).join('')}</div>`
    : `<div class="task-list">${renderCards([], selectedTaskId, options.emptyTitle, options.emptyDescription)}</div>`;

  return renderListPanel(body, { ...options, count: safeTasks.length });
}

export function renderListToolbar(grouping = 'flat') {
  const option = (value, label) =>
    `<button class="list-toolbar__option" type="button" data-action="set-list-grouping" data-grouping="${value}" aria-pressed="${grouping === value}">${label}</button>`;
  return `
    <div class="list-toolbar">
      <span class="list-toolbar__label">Group</span>
      <div class="list-toolbar__group">${option('flat', 'flat')}${option('swimlanes', 'swimlanes')}</div>
    </div>`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (existing renderList tests + 9 new tests).

- [ ] **Step 6: Commit**

```bash
git add public/js/renderList.js tests/frontend/renderList.test.js
git commit -m "$(cat <<'EOF'
feat: add list swimlane renderer and grouping toolbar

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire grouping into the workspace + handlers

**Files:**
- Modify: `public/js/main.js`

There is no unit test for this wiring task (it is DOM/event glue); correctness is gated by `npm run check` plus the render/state tests from Tasks 1–2 and the manual smoke in Task 5.

- [ ] **Step 1: Extend the state import**

In `public/js/main.js`, line 1 currently reads:
```js
import { state, setState, loadActiveProject, persistActiveProject, loadBoardGrouping, persistBoardGrouping } from './state.js';
```
Change it to:
```js
import { state, setState, loadActiveProject, persistActiveProject, loadBoardGrouping, persistBoardGrouping, loadListGrouping, persistListGrouping } from './state.js';
```

- [ ] **Step 2: Extend the renderList import**

In `public/js/main.js`, the line:
```js
import { renderListHtml } from './renderList.js';
```
Change it to:
```js
import { renderListHtml, renderSwimlaneListHtml, renderListToolbar } from './renderList.js';
```

- [ ] **Step 3: Branch the list render**

In `public/js/main.js`, find the final return of `renderWorkspacePrimary`:
```js
  return renderListHtml(visibleTasks, selectedTaskId, listOptionsForView(state.activeView));
}
```
Replace those two lines with:
```js
  const listOptions = listOptionsForView(state.activeView);
  const showListToolbar = state.activeProject === 'all' && state.activeView === 'tasks';
  const useSwimlanes = showListToolbar && state.listGrouping === 'swimlanes';
  const toolbar = showListToolbar ? renderListToolbar(state.listGrouping) : '';
  return useSwimlanes
    ? renderSwimlaneListHtml(visibleTasks, selectedTaskId, {
        ...listOptions,
        toolbar,
        projects: state.projects,
        listLaneCollapsed: state.listLaneCollapsed,
      })
    : renderListHtml(visibleTasks, selectedTaskId, { ...listOptions, toolbar });
}
```

- [ ] **Step 4: Restore the persisted grouping on init**

In `public/js/main.js`, find the `setState` call inside `init()`:
```js
    setState({
      preferences,
      boardGrouping: loadBoardGrouping(),
      librarySavedViews: savedLibraryViewsFromJson(window.localStorage?.getItem(SAVED_LIBRARY_VIEWS_KEY)),
      ...loadLibraryControls(),
    });
```
Change it to add the `listGrouping` line:
```js
    setState({
      preferences,
      boardGrouping: loadBoardGrouping(),
      listGrouping: loadListGrouping(),
      librarySavedViews: savedLibraryViewsFromJson(window.localStorage?.getItem(SAVED_LIBRARY_VIEWS_KEY)),
      ...loadLibraryControls(),
    });
```

- [ ] **Step 5: Add the two event handlers**

In `public/js/main.js`, find the end of the `toggle-board-lane` handler block:
```js
  workspace.querySelectorAll('[data-action="toggle-board-lane"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const id = btn.dataset.projectId;
      if (!id) return;
      setState({ boardLaneCollapsed: { ...state.boardLaneCollapsed, [id]: state.boardLaneCollapsed[id] !== true } });
      renderWorkspace();
    });
  });
```
Add immediately after it (still inside the same function):
```js

  workspace.querySelectorAll('[data-action="set-list-grouping"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const grouping = btn.dataset.grouping === 'swimlanes' ? 'swimlanes' : 'flat';
      persistListGrouping(grouping);
      setState({ listGrouping: grouping });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="toggle-list-lane"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const id = btn.dataset.projectId;
      if (!id) return;
      setState({ listLaneCollapsed: { ...state.listLaneCollapsed, [id]: state.listLaneCollapsed[id] !== true } });
      renderWorkspace();
    });
  });
```

- [ ] **Step 6: Verify syntax + full suite**

Run: `npm run check`
Expected: success (no output errors).

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add public/js/main.js
git commit -m "$(cat <<'EOF'
feat: wire list-view swimlanes toggle and lane collapsing

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Styling

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Add the list toolbar + lane styles**

In `public/styles.css`, find the last board-lane rule:
```css
.board-lane .board-panel { padding: 10px; background: transparent; }
```
Add immediately after it:
```css

.list-toolbar { display: flex; align-items: center; gap: 10px; }
.list-toolbar__label { font-family: var(--font-mono); font-size: 0.7857rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.list-toolbar__group { display: inline-flex; border: 1px solid var(--border); }
.list-toolbar__option { font-family: var(--font-mono); font-size: 0.7857rem; padding: 4px 12px; background: transparent; color: var(--text-dim); border: 0; border-right: 1px solid var(--border); cursor: pointer; }
.list-toolbar__option:last-child { border-right: 0; }
.list-toolbar__option:hover { color: var(--text); }
.list-toolbar__option[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }

.task-lanes { display: flex; flex-direction: column; }
.task-lane { border-bottom: 1px solid var(--border); }
.task-lane:last-child { border-bottom: 0; }
.task-lane__header { background: var(--surface-warm); }
.task-lane__toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 14px; background: transparent; border: 0; color: var(--text); cursor: pointer; text-align: left; }
.task-lane__glyph { color: var(--text-dim); }
.task-lane__name { font-family: var(--font-mono); font-size: 0.82rem; letter-spacing: 0.04em; text-transform: uppercase; }
.task-lane__count { font-family: var(--font-mono); font-size: 0.74rem; color: var(--accent-amber); }
.task-lane__cards { display: grid; }
```

- [ ] **Step 2: Verify CSS braces are balanced**

Run: `node -e "const c=require('fs').readFileSync('public/styles.css','utf8');const o=(c.match(/{/g)||[]).length,x=(c.match(/}/g)||[]).length;console.log('open',o,'close',x);if(o!==x)process.exit(1)"`
Expected: `open N close N` (equal counts), exit 0.

- [ ] **Step 3: Verify syntax gate**

Run: `npm run check`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "$(cat <<'EOF'
feat: style list-view swimlane toolbar and lanes

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Final verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite + syntax**

Run: `npm test`
Expected: PASS, 0 fail.

Run: `npm run check`
Expected: success.

- [ ] **Step 2: Manual smoke via the demo server**

Run: `npm run demo` (serves on `:3100`; if a stale process holds the port, kill it first: `lsof -ti:3100 | xargs -r kill`).

In the browser at `http://localhost:3100`:
1. Ensure the **Projects** selector is **All** and you are on the **Tasks** view → a `Group [ flat | swimlanes ]` toggle appears in the task panel header.
2. Click **swimlanes** → tasks group under per-project lane headers (each with a `· count`); tasks with no/unknown project fall under **No project**.
3. Click a lane header → it collapses (▸) and hides its cards; click again → expands (▾).
4. Reload the page → the flat/swimlanes choice persists; collapsed lanes reset to expanded (session-only, by design).
5. Switch to a single project (not All) → the toggle disappears and the list is flat. Switch to the **Archive** view while on All → still flat (no toggle).

Stop the demo when done.

- [ ] **Step 3: No commit** — this task only verifies. If any step fails, fix in the relevant file (Tasks 1–4), re-run, and amend the corresponding task's commit conventions (create a new fix commit, do not rewrite history).

---

## Notes for the implementer

- Reference implementation is the **board swimlanes**: `renderSwimlaneBoardHtml` / `renderBoardToolbar` in `public/js/renderBoard.js`, `boardGrouping` / `boardLaneCollapsed` / `loadBoardGrouping` / `persistBoardGrouping` in `public/js/state.js`, and the `set-board-grouping` / `toggle-board-lane` handlers + `renderWorkspacePrimary` board branch in `public/js/main.js`. The list version mirrors these names with `list*`.
- The toggle lives in the existing `.panel-header` (already `display:flex; justify-content:space-between`), so no `.list-view` wrapper or workspace-grid change is needed — this is a deliberate simplification over the board's `.board-view` wrapper.
- Swimlanes are gated to `activeProject === 'all' && activeView === 'tasks'`. The Archive view and single-project views always render the flat list with no toolbar (unchanged behaviour).
- Within-lane card order is the order tasks arrive in (existing upstream filtering/sorting is not changed).
- `listLaneCollapsed` is session-only (never persisted) — matching the board's lane-collapse behaviour.
```
