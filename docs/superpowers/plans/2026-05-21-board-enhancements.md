# Board Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a board density appearance preference (comfortable/compact) and an opt-in project-swimlanes layout to the All-projects board.

**Architecture:** Frontend-only. Density is a third appearance preference (parallel to palette/font-scale) applied via a `data-board-density` attribute on `:root`. Swimlanes add a second render path in `renderBoard.js` plus a board toolbar toggle and per-lane collapse state, persisted like `activeProject`. The flat board is left untouched.

**Tech Stack:** Vanilla ES modules (`public/js/`), `node:test` + `node:assert/strict`, CSS custom properties. Run tests with `npm test`; syntax-check with `npm run check`.

**Working directory:** `/Users/me/Developer/Playground/TaskBoard/.worktrees/board-enhancements` (branch `feat/board-enhancements`). Run `npm ci` once before starting if `node_modules` is absent.

---

## File Structure

- `public/js/preferences.js` — add `boardDensity` preference + `BOARD_DENSITY_OPTIONS`; apply `data-board-density`. (Task 1)
- `public/js/renderSettingsPanel.js` — add a "Board Density" control to the Appearance section. (Task 2)
- `public/js/main.js` — bind density buttons (Task 3); branch flat vs swimlanes + render toolbar + wire toggle/lane-collapse + load grouping at init (Task 6).
- `public/js/state.js` — `boardGrouping` + `boardLaneCollapsed` state and persistence helpers. (Task 4)
- `public/js/renderBoard.js` — `renderSwimlaneBoardHtml` + `renderBoardToolbar` (reusing existing card/column helpers). (Task 5)
- `public/styles.css` — compact density override (Task 3); swimlane + toolbar styles (Task 7).
- Tests: `tests/frontend/preferences.test.js`, `renderSettingsPanel.test.js`, `renderBoard.test.js`, new `tests/frontend/state.test.js`.

---

## Task 1: Board density preference

**Files:**
- Modify: `public/js/preferences.js`
- Test: `tests/frontend/preferences.test.js`

- [ ] **Step 1: Update failing tests for the new field**

In `tests/frontend/preferences.test.js`, update the import to include `BOARD_DENSITY_OPTIONS`:

```js
import {
  DEFAULT_PREFERENCES,
  LOCAL_STORAGE_KEY,
  PALETTE_OPTIONS,
  BOARD_DENSITY_OPTIONS,
  applyPreferences,
  loadPreferences,
  normalizePreferences,
  resetPreferences,
  savePreferences,
} from '../../public/js/preferences.js';
```

Then update the three `deepEqual` expectations that list the full preferences object to include `boardDensity`, and the `applyPreferences` test:

```js
test('normalizePreferences preserves valid font scale and palette values', () => {
  assert.deepEqual(
    normalizePreferences({ fontScale: 'large', palette: 'daylight' }),
    { fontScale: 'large', palette: 'daylight', boardDensity: 'comfortable' },
  );
});
```

```js
test('loadPreferences parses saved localStorage JSON', () => {
  const storage = storageWith({
    [LOCAL_STORAGE_KEY]: JSON.stringify({ fontScale: 'compact', palette: 'graphite' }),
  });

  assert.deepEqual(loadPreferences(storage), { fontScale: 'compact', palette: 'graphite', boardDensity: 'comfortable' });
});
```

```js
test('savePreferences stores normalized preferences', () => {
  const storage = storageWith();

  const saved = savePreferences({ fontScale: 'large', palette: 'daylight' }, storage);

  assert.deepEqual(saved, { fontScale: 'large', palette: 'daylight', boardDensity: 'comfortable' });
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), JSON.stringify(saved));
});
```

```js
test('applyPreferences writes root attributes', () => {
  const root = rootStub();

  applyPreferences({ fontScale: 'large', palette: 'graphite', boardDensity: 'compact' }, root);

  assert.equal(root.getAttribute('data-font-scale'), 'large');
  assert.equal(root.getAttribute('data-palette'), 'graphite');
  assert.equal(root.getAttribute('data-board-density'), 'compact');
});
```

Add two new tests at the end of the file:

```js
test('BOARD_DENSITY_OPTIONS includes comfortable and compact', () => {
  assert.deepEqual([...BOARD_DENSITY_OPTIONS], ['comfortable', 'compact']);
});

test('normalizePreferences keeps a valid board density and rejects an invalid one', () => {
  assert.equal(normalizePreferences({ boardDensity: 'compact' }).boardDensity, 'compact');
  assert.equal(normalizePreferences({ boardDensity: 'cozy' }).boardDensity, 'comfortable');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: failures — `BOARD_DENSITY_OPTIONS` is `undefined` (import) and the new/updated assertions fail.

- [ ] **Step 3: Implement the preference in `public/js/preferences.js`**

Change `DEFAULT_PREFERENCES`:

```js
export const DEFAULT_PREFERENCES = Object.freeze({
  fontScale: 'comfortable',
  palette: 'console',
  boardDensity: 'comfortable',
});
```

Add after the `PALETTE_OPTIONS` line:

```js
export const BOARD_DENSITY_OPTIONS = Object.freeze(['comfortable', 'compact']);
```

In `normalizePreferences`, add the `boardDensity` field to the returned object:

```js
  return {
    fontScale: isAllowed(source.fontScale, FONT_SCALE_OPTIONS) ? source.fontScale : DEFAULT_PREFERENCES.fontScale,
    palette: isAllowed(source.palette, PALETTE_OPTIONS) ? source.palette : DEFAULT_PREFERENCES.palette,
    boardDensity: isAllowed(source.boardDensity, BOARD_DENSITY_OPTIONS) ? source.boardDensity : DEFAULT_PREFERENCES.boardDensity,
  };
```

In `applyPreferences`, add the attribute write before `return normalized;`:

```js
  root?.setAttribute?.('data-board-density', normalized.boardDensity);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all preferences tests green).

- [ ] **Step 5: Commit**

```bash
git add public/js/preferences.js tests/frontend/preferences.test.js
git commit -m "feat: add board density appearance preference"
```

---

## Task 2: Board density settings control

**Files:**
- Modify: `public/js/renderSettingsPanel.js`
- Test: `tests/frontend/renderSettingsPanel.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/frontend/renderSettingsPanel.test.js`:

```js
test('renderSettingsPanelHtml renders the board density control', () => {
  const html = renderSettingsPanelHtml({
    preferences: { fontScale: 'comfortable', palette: 'console', boardDensity: 'compact' },
  });
  assert.match(html, /Board Density/);
  assert.match(html, /data-settings-board-density="comfortable"/);
  assert.match(html, /data-settings-board-density="compact"/);
  assert.match(html, /data-settings-board-density="compact"[^>]*aria-pressed="true"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — no `data-settings-board-density` in the output.

- [ ] **Step 3: Implement the control in `public/js/renderSettingsPanel.js`**

Update the import line to include `BOARD_DENSITY_OPTIONS`:

```js
import { DEFAULT_PREFERENCES, FONT_SCALE_OPTIONS, PALETTE_OPTIONS, BOARD_DENSITY_OPTIONS, normalizePreferences } from './preferences.js';
```

Add a render helper next to `renderFontScaleButton`:

```js
function renderDensityButton(value, activeValue) {
  return `<button class="settings-choice settings-choice--font" type="button" data-settings-board-density="${escapeHtml(value)}"${selected(value, activeValue)}>${escapeHtml(labelFromValue(value))}</button>`;
}
```

In `renderAppearance(preferences)`, insert this section immediately after the closing `</section>` of the "Interface Size" block and before the "Colour Palette" section:

```js
    <section class="settings-section" aria-labelledby="settings-density-title">
      <div>
        <h3 id="settings-density-title">Board Density</h3>
        <p>Card spacing on the board. Compact fits more cards without hiding signals.</p>
      </div>
      <div class="settings-choice-row" aria-label="Board density">
        ${BOARD_DENSITY_OPTIONS.map(value => renderDensityButton(value, preferences.boardDensity)).join('')}
      </div>
    </section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/renderSettingsPanel.js tests/frontend/renderSettingsPanel.test.js
git commit -m "feat: add board density control to settings appearance"
```

---

## Task 3: Density CSS + settings wiring

**Files:**
- Modify: `public/styles.css`, `public/js/main.js`

- [ ] **Step 1: Add the compact density CSS**

Append to `public/styles.css` (anywhere after the `.board-card` rules):

```css
/* Compact board density: tighter cards, all signals still visible. */
:root[data-board-density="compact"] .board-cards { gap: 6px; }
:root[data-board-density="compact"] .board-card { padding: 5px 9px; gap: 3px; }
:root[data-board-density="compact"] .board-card .board-card__title { font-size: 0.85rem; }
:root[data-board-density="compact"] .board-card .board-card__due,
:root[data-board-density="compact"] .board-card .board-card__chip { font-size: 0.7rem; }
```

- [ ] **Step 2: Wire the density buttons in `public/js/main.js`**

In `bindSettingsPanelEvents`, add this block immediately after the `[data-settings-palette]` `forEach` block (around line 1778):

```js
  panel.querySelectorAll('[data-settings-board-density]').forEach((button) => {
    button.addEventListener('click', () => {
      updatePreferences({
        ...state.preferences,
        boardDensity: button.dataset.settingsBoardDensity,
      });
      renderApp();
    });
  });
```

(The existing `reset-preferences` handler and the `init()` `applyPreferences(loadPreferences())` call already cover reset and load because `boardDensity` is now part of `DEFAULT_PREFERENCES`.)

- [ ] **Step 3: Verify**

Run: `npm test` (expected: PASS — no regressions)
Run: `npm run check` (expected: no output / success)

- [ ] **Step 4: Manual smoke (optional, demo server)**

Run `npm run demo`, open `http://127.0.0.1:3100/`, Settings → Board Density → Compact, switch to Board: cards are tighter, dot/title/due/chip still visible. Stop the demo when done.

- [ ] **Step 5: Commit**

```bash
git add public/styles.css public/js/main.js
git commit -m "feat: apply board density preference and wire the control"
```

---

## Task 4: Swimlane state + persistence

**Files:**
- Modify: `public/js/state.js`
- Test: `tests/frontend/state.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/frontend/state.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBoardGrouping, persistBoardGrouping } from '../../public/js/state.js';

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    values,
  };
}

test('loadBoardGrouping defaults to flat when unset or unknown', () => {
  assert.equal(loadBoardGrouping(storageWith()), 'flat');
  assert.equal(loadBoardGrouping(storageWith({ 'moomora.boardGrouping.v1': 'weird' })), 'flat');
});

test('loadBoardGrouping returns swimlanes when stored', () => {
  assert.equal(loadBoardGrouping(storageWith({ 'moomora.boardGrouping.v1': 'swimlanes' })), 'swimlanes');
});

test('persistBoardGrouping stores a normalized value', () => {
  const storage = storageWith();
  persistBoardGrouping('swimlanes', storage);
  assert.equal(storage.getItem('moomora.boardGrouping.v1'), 'swimlanes');
  persistBoardGrouping('nonsense', storage);
  assert.equal(storage.getItem('moomora.boardGrouping.v1'), 'flat');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `loadBoardGrouping`/`persistBoardGrouping` are not exported.

- [ ] **Step 3: Implement in `public/js/state.js`**

Add two fields to the `state` object (after the `boardOpenSections` line):

```js
  boardGrouping: 'flat',        // 'flat' | 'swimlanes' (All-projects board only)
  boardLaneCollapsed: {},        // { [projectId]: true } collapsed lanes (session-only)
```

Add at the end of the file, after `persistActiveProject`:

```js
const BOARD_GROUPING_KEY = 'moomora.boardGrouping.v1';

export function loadBoardGrouping(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(BOARD_GROUPING_KEY) === 'swimlanes' ? 'swimlanes' : 'flat';
  } catch {
    return 'flat';
  }
}

export function persistBoardGrouping(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(BOARD_GROUPING_KEY, value === 'swimlanes' ? 'swimlanes' : 'flat');
  } catch {
    /* ignore storage failures */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/state.js tests/frontend/state.test.js
git commit -m "feat: add board grouping state and persistence"
```

---

## Task 5: Swimlane renderer + board toolbar

**Files:**
- Modify: `public/js/renderBoard.js`
- Test: `tests/frontend/renderBoard.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend/renderBoard.test.js` (import is already `import { renderBoardHtml } from '../../public/js/renderBoard.js';` — change it to also import the new functions):

```js
import { renderBoardHtml, renderSwimlaneBoardHtml, renderBoardToolbar } from '../../public/js/renderBoard.js';
```

Then add:

```js
const SWIM_PROJECTS = [
  { id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' },
  { id: 'p2', name: 'Work', slug: 'work', status: 'active' },
  { id: 'p3', name: 'Empty', slug: 'empty', status: 'active' },
];

test('renderSwimlaneBoardHtml renders a lane only for projects with tasks', () => {
  const tasks = [
    { id: 'a', title: 'Patch ingress', priority: 'medium', status: 'in-progress', projectId: 'p1', sortOrder: 0 },
    { id: 'b', title: 'Q2 pack', priority: 'high', status: 'planned', projectId: 'p2', sortOrder: 0, dueDate: '2026-05-19' },
  ];
  const html = renderSwimlaneBoardHtml(tasks, null, { today: '2026-05-21', projects: SWIM_PROJECTS });
  assert.match(html, /data-board-lane="p1"/);
  assert.match(html, /data-board-lane="p2"/);
  assert.doesNotMatch(html, /data-board-lane="p3"/); // empty project omitted
  assert.match(html, /board-lane__name">Homelab</);
  assert.match(html, /data-action="toggle-board-lane"[^>]*data-project-id="p1"/);
  // overdue flag present, but no project chip inside a lane
  assert.match(html, /board-card__due--over/);
  assert.doesNotMatch(html, /board-card__chip/);
});

test('renderSwimlaneBoardHtml hides columns for a collapsed lane', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'low', status: 'planned', projectId: 'p1', sortOrder: 0 }];
  const html = renderSwimlaneBoardHtml(tasks, null, {
    today: '2026-05-21', projects: SWIM_PROJECTS, boardLaneCollapsed: { p1: true },
  });
  assert.match(html, /data-board-lane="p1"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /class="board-panel"/); // collapsed: no columns
});

test('renderBoardToolbar marks the active grouping', () => {
  const html = renderBoardToolbar('swimlanes');
  assert.match(html, /data-action="set-board-grouping"[^>]*data-grouping="flat"/);
  assert.match(html, /data-grouping="swimlanes"[^>]*aria-pressed="true"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `renderSwimlaneBoardHtml`/`renderBoardToolbar` not exported.

- [ ] **Step 3: Implement in `public/js/renderBoard.js`**

Add these functions at the end of the file (they reuse the existing module-private `COLUMNS`, `renderColumnCards`, `localToday`, and `escapeHtml`):

```js
function renderLaneColumns(laneTasks, selectedTaskId, ctx) {
  return COLUMNS.map(col => {
    const cards = renderColumnCards(laneTasks, col.id, selectedTaskId, ctx);
    const count = laneTasks.filter(t => (t.status || t.column || 'planned') === col.id).length;
    return `
        <section class="board-column board-column--open" aria-label="${col.label}" data-board-column="${col.id}">
          <header class="board-column__header">
            <span class="board-column__title">[ ${col.label} ]</span>
            <span class="board-column__count">${count}</span>
          </header>
          <div class="board-cards" data-board-column="${col.id}">${cards}
          </div>
        </section>`;
  }).join('');
}

export function renderSwimlaneBoardHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const projects = Array.isArray(options.projects) ? options.projects : [];
  const collapsed = options.boardLaneCollapsed || {};
  const ctx = {
    today: options.today || localToday(),
    showProjectChips: false,
    projectName: () => '',
  };

  const lanes = projects
    .map(project => ({ project, tasks: safe.filter(t => t.projectId === project.id) }))
    .filter(lane => lane.tasks.length > 0);

  const known = new Set(projects.map(p => p.id));
  const orphans = safe.filter(t => !known.has(t.projectId));
  if (orphans.length) lanes.push({ project: { id: '__none__', name: 'No project' }, tasks: orphans });

  if (!lanes.length) {
    return `<section class="board-swimlanes" aria-label="Task board"><p class="board-empty">[ no tasks ]</p></section>`;
  }

  return `
    <section class="board-swimlanes" aria-label="Task board">
      ${lanes.map(({ project, tasks: laneTasks }) => {
        const isCollapsed = collapsed[project.id] === true;
        return `
        <section class="board-lane" data-board-lane="${escapeHtml(project.id)}">
          <header class="board-lane__header">
            <button class="board-lane__toggle" type="button" data-action="toggle-board-lane" data-project-id="${escapeHtml(project.id)}" aria-expanded="${!isCollapsed}">
              <span class="board-lane__glyph">${isCollapsed ? '▸' : '▾'}</span>
              <span class="board-lane__name">${escapeHtml(project.name)}</span>
              <span class="board-lane__count">· ${laneTasks.length}</span>
            </button>
          </header>
          ${isCollapsed ? '' : `<div class="board-panel">${renderLaneColumns(laneTasks, selectedTaskId, ctx)}</div>`}
        </section>`;
      }).join('')}
    </section>`;
}

export function renderBoardToolbar(grouping = 'flat') {
  const option = (value, label) =>
    `<button class="board-toolbar__option" type="button" data-action="set-board-grouping" data-grouping="${value}" aria-pressed="${grouping === value}">${label}</button>`;
  return `
    <div class="board-toolbar">
      <span class="board-toolbar__label">Group</span>
      <div class="board-toolbar__group">${option('flat', 'flat')}${option('swimlanes', 'swimlanes')}</div>
    </div>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (including the existing flat-board tests, which are unchanged).

- [ ] **Step 5: Commit**

```bash
git add public/js/renderBoard.js tests/frontend/renderBoard.test.js
git commit -m "feat: add swimlane board renderer and grouping toolbar"
```

---

## Task 6: Wire swimlanes into the workspace

**Files:**
- Modify: `public/js/main.js`

- [ ] **Step 1: Import the new renderers and state helpers**

Change the `renderBoard.js` import (line 38) to:

```js
import { renderBoardHtml, renderSwimlaneBoardHtml, renderBoardToolbar } from './renderBoard.js';
```

Change the `state.js` import (line 1) to add the grouping helpers:

```js
import { state, setState, loadActiveProject, persistActiveProject, loadBoardGrouping, persistBoardGrouping } from './state.js';
```

- [ ] **Step 2: Branch flat vs swimlanes in `renderWorkspacePrimary`**

Replace the `renderWorkspacePrimary` function body's board branch (lines 1068-1079) with:

```js
function renderWorkspacePrimary(visibleTasks, selectedTaskId) {
  if (state.activeView === 'board') {
    const useSwimlanes = state.boardGrouping === 'swimlanes' && state.activeProject === 'all';
    const board = useSwimlanes
      ? renderSwimlaneBoardHtml(visibleTasks, selectedTaskId, {
          today: today(),
          projects: state.projects,
          boardLaneCollapsed: state.boardLaneCollapsed,
        })
      : renderBoardHtml(visibleTasks, selectedTaskId, {
          boardOpenSections: state.boardOpenSections,
          today: today(),
          showProjectChips: state.activeProject === 'all',
          projects: state.projects,
        });
    const toolbar = state.activeProject === 'all' ? renderBoardToolbar(state.boardGrouping) : '';
    return toolbar + board;
  }

  return renderListHtml(visibleTasks, selectedTaskId, listOptionsForView(state.activeView));
}
```

- [ ] **Step 3: Wire toolbar + lane-collapse clicks in `bindBoardEvents`**

In `bindBoardEvents` (the function that contains the `[data-action="toggle-board-section"]` binding ending around line 1010), add these two blocks immediately before the function's closing `}`:

```js
  workspace.querySelectorAll('[data-action="set-board-grouping"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const grouping = btn.dataset.grouping === 'swimlanes' ? 'swimlanes' : 'flat';
      persistBoardGrouping(grouping);
      setState({ boardGrouping: grouping });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="toggle-board-lane"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.projectId;
      if (!id) return;
      setState({ boardLaneCollapsed: { ...state.boardLaneCollapsed, [id]: state.boardLaneCollapsed[id] !== true } });
      renderWorkspace();
    });
  });
```

- [ ] **Step 4: Load grouping at init**

In `init()` (line 1948), add `boardGrouping` to the first `setState` call (lines 1951-1955):

```js
    setState({
      preferences,
      boardGrouping: loadBoardGrouping(),
      librarySavedViews: savedLibraryViewsFromJson(window.localStorage?.getItem(SAVED_LIBRARY_VIEWS_KEY)),
      ...loadLibraryControls(),
    });
```

- [ ] **Step 5: Verify**

Run: `npm test` (expected: PASS)
Run: `npm run check` (expected: success — confirms `public/js/main.js` parses)

- [ ] **Step 6: Manual smoke (optional, demo server)**

`npm run demo` → `http://127.0.0.1:3100/` → All projects → Board. Toggle `flat`/`swimlanes`: swimlanes shows a lane per project with tasks; click a lane header to collapse/expand; reload keeps the grouping. Switch to a single project: the toggle disappears and the flat board shows. Stop the demo when done.

- [ ] **Step 7: Commit**

```bash
git add public/js/main.js
git commit -m "feat: wire swimlane toggle and lane collapse into the board"
```

---

## Task 7: Swimlane + toolbar styles, final verification

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Add the styles**

Append to `public/styles.css`:

```css
/* Board grouping toolbar */
.board-toolbar { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
.board-toolbar__label { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.board-toolbar__group { display: inline-flex; border: 1px solid var(--border); }
.board-toolbar__option { font-family: var(--font-mono); font-size: 0.78rem; padding: 4px 12px; background: transparent; color: var(--text-dim); border: 0; cursor: pointer; }
.board-toolbar__option[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }

/* Project swimlanes */
.board-swimlanes { display: grid; gap: 14px; }
.board-lane { border: 1px solid var(--border); background: var(--bg-deep); }
.board-lane__header { border-bottom: 1px solid var(--border); background: var(--surface-warm); }
.board-lane__toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; background: transparent; border: 0; color: var(--text); cursor: pointer; text-align: left; }
.board-lane__glyph { color: var(--text-dim); }
.board-lane__name { font-family: var(--font-mono); font-size: 0.82rem; letter-spacing: 0.04em; text-transform: uppercase; }
.board-lane__count { font-family: var(--font-mono); font-size: 0.74rem; color: var(--accent-amber); }
.board-lane .board-panel { padding: 10px; background: transparent; }
```

- [ ] **Step 2: Verify CSS braces balanced**

Run: `node -e "const c=require('fs').readFileSync('public/styles.css','utf8'); let n=0; for(const ch of c){if(ch==='{')n++;if(ch==='}')n--;} if(n!==0) throw new Error('unbalanced braces: '+n); console.log('braces OK');"`
Expected: `braces OK`

- [ ] **Step 3: Full verification**

Run: `npm test` (expected: PASS, all suites)
Run: `npm run check` (expected: success)

- [ ] **Step 4: Manual smoke (optional)**

`npm run demo`, Board view, toggle swimlanes + try Compact density together: lanes render with headers, cards are tight but keep dot/due, toolbar active state is highlighted. Stop the demo when done.

- [ ] **Step 5: Commit**

```bash
git add public/styles.css
git commit -m "feat: style board swimlanes and grouping toolbar"
```

---

## Notes for the implementer

- The flat `renderBoardHtml` and its tests are intentionally untouched — do not modify them.
- Drag-and-drop hooks (`data-board-card`, `data-board-column`) are reused inside lanes; within-lane status reorder works via the existing `handleBoardDrop`. Cross-project drag is out of scope (a card dragged across lanes only changes status; its project is unchanged and it returns to its own lane on re-render).
- Swimlane columns are always open (no per-column toggle / no duplicate `id` attributes); lane-level collapse is the only collapse axis in swimlane mode.
- Per-column collapse (`boardOpenSections`) remains flat-board-only.
