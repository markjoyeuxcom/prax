# Desktop Layout & Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks and Board use the widescreen via a resizable right-overlay detail drawer; navigation lives only in the left rail (grouped WORK/VIEWS/PROJECTS); density tightens (compact metric strip, no oversized content-header). Visual language unchanged.

**Architecture:** `renderShell.js` moves all view-switching into the left rail and slims the top bar; `main.js` unifies the task-detail "open" state into one `taskDetailOpen` flag, renders the detail inside a `.task-detail-drawer` overlay (Tasks/Board/Backlog/Archive), and reuses a generalized pane-resizer; `styles.css` makes the task workspace a positioning context with the drawer as an absolute overlay (full-screen on mobile). No backend change.

**Tech Stack:** Plain-JS frontend modules, Node built-in test runner (`npm test`).

**Spec:** [docs/superpowers/specs/2026-05-28-desktop-layout-nav-redesign-design.md](../specs/2026-05-28-desktop-layout-nav-redesign-design.md)

**File map:**
- `public/js/renderShell.js` — grouped rail nav, slim top bar, `.topbar-title`, no content-header, `renderMetricStrip`, metric gate excludes board (Task 1)
- `public/styles.css` — nav groups, topbar-title, remove content-header/topbar-tabs/metric-card rules, metric-strip, workspace positioning + drawer overlay, board column min-height (Tasks 1, 3, 4)
- `public/js/main.js` — `setupPaneResizer` generalization (Task 2); `taskDetailOpen` state + drawer render + open/close/reset wiring (Task 3); board drawer + drop inspector (Task 4)
- `public/js/renderTaskDetail.js` — drawer container + unified `close-task-detail` action (Task 3)
- `public/js/renderBoard.js` — (no inspector removal needed there; inspector is composed in main.js — Task 4 confirms)
- `public/js/state.js` — `taskDetailOpen` field (Task 3)
- Tests: `tests/frontend/renderShell.test.js` (rewrite changed assertions, Task 1), `tests/frontend/renderTaskDetail.test.js` (Task 3), `tests/frontend/renderBoard.test.js` (Task 4)

---

## Task 1: Shell — grouped rail nav, slim top bar, compact density

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `public/styles.css`
- Test: `tests/frontend/renderShell.test.js`

Move all five views into the left rail as `WORK` (list/board/library) + `VIEWS` (backlog/archive); remove the top bar's view-tabs; replace the big content-header with a compact `.topbar-title`; replace the metric-card grid with a one-line `.metric-strip` that is hidden on board and library.

- [ ] **Step 1: Update the existing shell tests to the new structure (write failing tests)**

In `tests/frontend/renderShell.test.js`, make these edits:

(a) Replace the test `topbar contains a topbar-tabs nav` (around lines 303-312) with its inverse plus the new title/groups:

```js
test('topbar no longer contains view-switch tabs', () => {
  const html = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'board', metrics: {} });
  assert.doesNotMatch(html, /class="topbar-tabs"/);
  // No data-view buttons inside the topbar element
  const topbar = html.slice(html.indexOf('<header class="topbar"'), html.indexOf('</header>'));
  assert.doesNotMatch(topbar, /data-view=/);
});

test('topbar shows a compact view title', () => {
  const html = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'board', metrics: {} });
  assert.match(html, /class="topbar-title"[^>]*>Board</);
});

test('left rail groups WORK and VIEWS with all five views', () => {
  const html = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', metrics: {} });
  assert.match(html, /nav-label">Work/i);
  assert.match(html, /nav-label">Views/i);
  assert.match(html, /aria-label="Work"[\s\S]*data-view="list"/);
  assert.match(html, /aria-label="Work"[\s\S]*data-view="board"/);
  assert.match(html, /aria-label="Work"[\s\S]*data-view="library"/);
  assert.match(html, /aria-label="Views"[\s\S]*data-view="backlog"/);
  assert.match(html, /aria-label="Views"[\s\S]*data-view="archive"/);
});
```

(b) Replace `sidebar no longer has a Views label` (lines 314-322) and `sidebar renders slim Main navigation for primary areas` (lines 324-336) — they assert the OLD single-group structure — with the WORK/VIEWS coverage now in the test above. Delete both old tests.

(c) Update `renderShellHtml derives heading from active view` (lines 87-98): the heading moved from `.content-header h1#view-title` to `.topbar-title`; the description and the `Synced` pill are gone. Replace its body with:

```js
test('renderShellHtml derives heading from active view', () => {
  const html = renderShellHtml({ activeView: 'board', activeProject: 'all', projects: [], metrics: {} });
  assert.match(html, /class="topbar-title"[^>]*>Board</);
  assert.doesNotMatch(html, /class="content-header"/);
  assert.match(html, /id="workspace" class="workspace workspace--board"/);
});
```

(d) Update `renderShellHtml derives Library heading and document action` (lines 100-115): replace the `<h1 id="view-title">Library</h1>` and description assertions:

```js
test('renderShellHtml derives Library heading and document action', () => {
  const html = renderShellHtml({ activeView: 'library', activeProject: 'all', projects: [], metrics: {} });
  assert.match(html, /console-main console-main--library/);
  assert.match(html, /class="topbar-title"[^>]*>Library</);
  assert.match(html, /data-action="new-document"/);
  assert.match(html, /\[\+\] new doc/);
  assert.doesNotMatch(html, /class="metric-strip"/);
});
```

(e) Update `renders All-projects button active` (lines 9-37): remove the metric-card assertions (`Due today`, `Completed this week`, `>4<`, `>18<`) and assert the strip instead. Replace those four `assert.match` lines with:

```js
  assert.match(html, /class="metric-strip"/);
  assert.match(html, /due today/i);
  assert.match(html, /4/);
  assert.match(html, /18/);
```

(f) Update `defaults missing metric values and reflects API status` (lines 117-131): the strip still shows numbers; keep `Offline`, and change the metric assertions to:

```js
  assert.match(html, /class="metric-strip"/);
  assert.match(html, /2/);
```

(g) Add a board-gate test:

```js
test('metric strip is hidden on board and library, shown on list', () => {
  const list = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'list', metrics: { dueToday: 1 } });
  assert.match(list, /class="metric-strip"/);
  const board = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'board', metrics: { dueToday: 1 } });
  assert.doesNotMatch(board, /class="metric-strip"/);
  const lib = renderShellHtml({ activeProject: 'all', projects: [], activeView: 'library', metrics: { dueToday: 1 } });
  assert.doesNotMatch(lib, /class="metric-strip"/);
});
```

- [ ] **Step 2: Run the shell tests to verify they fail**

Run: `npm test -- tests/frontend/renderShell.test.js`
Expected: FAIL (topbar-title/metric-strip/Work/Views groups not yet emitted; content-header still present).

- [ ] **Step 3: Rework `renderShell.js` — view groups + metric strip**

In `public/js/renderShell.js`:

(a) After the `viewButtons` array, add group definitions:

```js
const navGroups = [
  { label: 'Work', ids: ['list', 'board', 'library'] },
  { label: 'Views', ids: ['backlog', 'archive'] },
];
const viewKeyGlyph = { list: 't', board: 'b', library: 'l', backlog: 'k', archive: 'r' };
```

(b) Replace `renderSidebarMainButtons` (the function around lines 152-162) and delete `renderViewButtons` (lines 138-150). Add:

```js
function renderSidebarNavGroups(activeView) {
  return navGroups.map((group) => {
    const buttons = group.ids.map((id) => {
      const view = viewButtons.find(v => v.id === id);
      const isActive = id === activeView;
      return `
          <button class="nav-button${isActive ? ' is-active' : ''}" type="button" aria-pressed="${isActive}" data-view="${id}">
            <span class="nav-button__main"><span class="nav-button__key">[${viewKeyGlyph[id]}]</span><span>${view.label}</span></span>
          </button>`;
    }).join('');
    return `
        <nav class="side-nav" aria-label="${group.label}">
          <p class="nav-label">${group.label}</p>
          ${buttons}
        </nav>`;
  }).join('');
}
```

(c) Replace `renderMetricCards` (lines 192-198) with a strip:

```js
function renderMetricStrip(metrics) {
  const items = metricCards.map(m => `<span class="metric-strip__item">${m.label.toLowerCase()} <b>${metricValue(metrics, m.key)}</b></span>`);
  return `<section class="metric-strip" aria-label="Task metrics">${items.join('<span class="metric-strip__sep">·</span>')}</section>`;
}
```

- [ ] **Step 4: Rework the `renderShellHtml` markup**

In `renderShellHtml` (starts ~line 206):

(a) Change the metrics gate (lines 220-222) to exclude board too:

```js
  const showMetrics = activeViewConfig.id !== 'library' && activeViewConfig.id !== 'board';
  const metricsHtml = showMetrics ? renderMetricStrip(metrics) : '';
```

(b) In the `.sidebar` markup, replace the single `Main` nav block (lines 236-239) with the grouped nav:

```js
        ${renderSidebarNavGroups(activeViewConfig.id)}
```

(Keep the `Projects` nav and cluster card exactly as-is below it.)

(c) In `.topbar` (lines 272-285): remove the `<nav class="topbar-tabs">…</nav>` line entirely, and add a `.topbar-title` right after the hamburger trigger:

```js
        <header class="topbar">
          <button class="hamburger-trigger" type="button" data-action="toggle-drawer" aria-label="Menu">≡</button>
          <h1 class="topbar-title">${escapeHtml(activeViewConfig.label)}</h1>
          <label class="search-field">
            <span class="sr-only">${isLibraryView ? 'Search documents' : 'Search tasks'}</span>
            <input type="search" placeholder="${isLibraryView ? 'Search documents' : 'Search tasks'}" autocomplete="off" value="${escapeHtml(searchQuery)}" data-search-input>
          </label>
          <div class="topbar-actions">
            <button type="button" data-action="open-settings" class="bracket-button">[~] settings</button>
            <button type="button" data-action="open-admin" class="bracket-button">[a] admin</button>
            ${isLibraryView ? '<button type="button" data-action="import-document" class="bracket-button">[↑] import</button>' : ''}
            <button type="button" data-action="${primaryAction.action}" class="bracket-button bracket-button--primary">[+] ${primaryAction.label === 'New Document' ? 'new doc' : 'new'}</button>
          </div>
        </header>
```

(d) Remove the `.content-header` `<section>` block (lines 287-293) entirely. The `${metricsHtml}` line stays directly after the `</header>`. The `#workspace` div and status-footer are unchanged.

- [ ] **Step 5: Update CSS for nav groups, topbar-title, metric strip; remove dead rules**

In `public/styles.css`:

(a) Delete the `.content-header`, `.content-header h1`, `.content-header p` rules (lines 608-635 region — remove the content-header block) and the `.metrics-row` + `.metric-card*` + `.metric-label` rules (lines 401 and 647-679 region). Delete the `.topbar-tabs` rules (lines 3601-3602).

(b) Add a compact title + strip near the topbar rules:

```css
.topbar-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  margin: 0 4px 0 0;
  white-space: nowrap;
}
.metric-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0 16px 10px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-dim);
}
.metric-strip__item b { color: var(--accent-amber); font-weight: 700; margin-left: 2px; }
.metric-strip__sep { color: var(--border-dim); }
```

(c) The `.side-nav` rules already style grouped navs (the Projects nav uses the same class), so WORK/VIEWS groups inherit correct styling. No new rule needed for them.

- [ ] **Step 6: Run the shell tests + full frontend suite**

Run: `npm test -- tests/frontend/renderShell.test.js`
Expected: PASS (all updated + new tests green).

Run: `npm test -- tests/frontend`
Expected: PASS.

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add public/js/renderShell.js public/styles.css tests/frontend/renderShell.test.js
git commit -m "feat: single left-rail navigation, compact metric strip, slim top bar"
```

---

## Task 2: Generalize the pane resizer

**Files:**
- Modify: `public/js/main.js`

Extract the Library resizer into a reusable `setupPaneResizer` so the task drawer (Task 3) can reuse it. Library behaviour must stay identical.

- [ ] **Step 1: Add the generalized helper**

In `public/js/main.js`, add `setupPaneResizer` just above `setupLibraryResizer` (~line 653):

```js
// Generic drag-to-resize for a pane. edge:'right' grows the pane as the pointer
// moves right (left-docked browser); edge:'left' grows it as the pointer moves
// left (right-docked drawer). Width is applied to `target` as `cssVar` and
// persisted under `storageKey`.
function setupPaneResizer({ resizer, pane, target, cssVar, storageKey, min, max, edge = 'right' }) {
  if (!resizer || !pane || !target) return;
  const applyWidth = (width) => {
    const clamped = Math.min(max, Math.max(min, width));
    target.style.setProperty(cssVar, `${clamped}px`);
    return clamped;
  };
  let saved = null;
  try { saved = window.localStorage?.getItem(storageKey); } catch { saved = null; }
  if (saved) applyWidth(parseInt(saved, 10) || min);

  const persist = () => {
    try {
      const current = target.style.getPropertyValue(cssVar);
      if (current) window.localStorage?.setItem(storageKey, current.trim());
    } catch { /* convenience only */ }
  };

  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;
    resizer.classList.add('is-dragging');
    resizer.setPointerCapture?.(event.pointerId);
    const sign = edge === 'left' ? -1 : 1;
    const onMove = (m) => applyWidth(startWidth + sign * (m.clientX - startX));
    const onEnd = () => {
      resizer.classList.remove('is-dragging');
      resizer.releasePointerCapture?.(event.pointerId);
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onEnd);
      resizer.removeEventListener('pointercancel', onEnd);
      persist();
    };
    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onEnd);
    resizer.addEventListener('pointercancel', onEnd);
  });

  resizer.addEventListener('keydown', (event) => {
    const step = (event.shiftKey ? 32 : 16) * (edge === 'left' ? -1 : 1);
    if (event.key === 'ArrowLeft') { event.preventDefault(); applyWidth(pane.getBoundingClientRect().width - step); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); applyWidth(pane.getBoundingClientRect().width + step); }
    else { return; }
    persist();
  });
}
```

- [ ] **Step 2: Re-express `setupLibraryResizer` through it**

Replace the body of `setupLibraryResizer` (lines 653-~725) with a thin caller:

```js
function setupLibraryResizer(workspace, libraryWorkspaceElement) {
  const resizer = workspace.querySelector('[data-library-resizer]');
  const browser = workspace.querySelector('.library-browser');
  setupPaneResizer({
    resizer,
    pane: browser,
    target: libraryWorkspaceElement,
    cssVar: '--library-browser-width',
    storageKey: LIBRARY_BROWSER_WIDTH_KEY,
    min: 220,
    max: 560,
    edge: 'right',
  });
}
```

- [ ] **Step 3: Verify Library still works**

Run: `npm test -- tests/frontend`
Expected: PASS (no library test regressions).

Run: `npm run check`
Expected: clean.

Manual: `npm run demo`, open Library, drag the resizer — width changes and persists across reload. Stop the demo.

- [ ] **Step 4: Commit**

```bash
git add public/js/main.js
git commit -m "refactor: generalize library resizer into setupPaneResizer"
```

---

## Task 3: Task detail drawer (Tasks / Backlog / Archive)

**Files:**
- Modify: `public/js/state.js`, `public/js/main.js`, `public/js/renderTaskDetail.js`, `public/styles.css`
- Test: `tests/frontend/renderTaskDetail.test.js`

Unify the detail-open state into `taskDetailOpen`; render the detail inside a resizable right-overlay drawer; open on task select, close on `[x]`/Esc; reset on view/project switch.

- [ ] **Step 1: Add the state field**

In `public/js/state.js`, after `isBoardTaskDetailOpen: false,` add:

```js
  taskDetailOpen: false,        // unified detail drawer open state (Tasks/Board/Backlog/Archive)
```

- [ ] **Step 2: Write the failing detail-close test**

In `tests/frontend/renderTaskDetail.test.js`, add:

```js
test('renderTaskDetailHtml renders a close control when closeAction is provided', () => {
  const task = { id: 't1', title: 'Back up CNPG', status: 'planned', priority: 'high', projectId: 'p1' };
  const html = renderTaskDetailHtml(task, { closeAction: 'close-task-detail' });
  assert.match(html, /data-action="close-task-detail"/);
});
```

Run: `npm test -- tests/frontend/renderTaskDetail.test.js`
Expected: PASS if `renderTaskDetailHtml` already honours `closeAction` (it does today for the board). If it only emitted the close button conditionally on a board-specific flag, adjust the call in the test to match the existing option name — read `renderTaskDetail.js` and confirm the option that drives the close button, then standardise it to `closeAction: 'close-task-detail'`. The goal: one close action name used everywhere.

- [ ] **Step 3: Render the drawer in `renderWorkspace`**

In `public/js/main.js` `renderWorkspace` (~line 344), change the task-view branch so the detail is wrapped in a drawer container and only rendered when `taskDetailOpen`:

Replace the `shouldRenderTaskDetail` / `taskDetailHtml` / `workspace.innerHTML` block (lines 358-383) with:

```js
  const isBoardView = state.activeView === 'board';
  const shouldRenderTaskDetail = state.taskDetailOpen && Boolean(task);
  const taskDetailHtml = shouldRenderTaskDetail
    ? `<div class="task-detail-drawer" data-task-detail-drawer>
         <div class="task-detail-resizer" data-task-detail-resizer role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize detail"></div>
         ${renderTaskDetailHtml(task, {
           readOnly,
           restoreAction: readOnly,
           deleteAction: readOnly,
           mobileDetailOpen: state.mobileDetailOpen,
           linkedDocuments: state.taskDocuments,
           checklistItems: state.taskChecklist,
           activityEvents: state.taskActivity,
           activeTaskDetailTab: state.activeTaskDetailTab,
           activeTaskDetailSection: state.activeTaskDetailSection,
           taskNotesDraft: taskNotesDraftFor(task),
           isTaskNotesDirty: Boolean(task && state.taskNotesDraftId === task.id && state.isTaskNotesDirty),
           taskNotesSavedAt: task && state.taskNotesDraftId === task.id ? state.taskNotesSavedAt : '',
           closeAction: 'close-task-detail',
         })}
       </div>`
    : '';

  workspace.innerHTML = [
    renderWorkspacePrimary(visibleTasks, selectedTaskId),
    taskDetailHtml,
  ].join('');

  workspace.classList.toggle('is-mobile-detail-open', Boolean(state.mobileDetailOpen));
  workspace.classList.toggle('is-task-detail-open', Boolean(state.taskDetailOpen));

  if (state.taskDetailOpen) {
    setupPaneResizer({
      resizer: workspace.querySelector('[data-task-detail-resizer]'),
      pane: workspace.querySelector('[data-task-detail-drawer]'),
      target: workspace,
      cssVar: '--task-detail-width',
      storageKey: 'moomora.taskDetailWidth.v1',
      min: 300,
      max: 640,
      edge: 'left',
    });
  }
```

(The `readOnly` const defined earlier in the function stays. `isBoardView` is still used below for the board-detail class toggle — remove the now-unused `is-board-detail-open` toggle line, replaced by `is-task-detail-open` above.)

- [ ] **Step 4: Open the drawer on task select; wire close + Esc**

(a) In the task-row click handler (~line 385-422), ensure selecting a task sets `taskDetailOpen: true`. Find the `setState({ ... })` in that handler and add `taskDetailOpen: true,` (alongside the existing `mobileDetailOpen: isMobile() ? true : state.mobileDetailOpen` and selection fields).

(b) Add a close handler near the other workspace handlers (after the row-click binding, ~line 422). The detail drawer is re-rendered each time, so bind by querying after render:

```js
  workspace.querySelector('[data-action="close-task-detail"]')?.addEventListener('click', () => {
    setState({ taskDetailOpen: false, mobileDetailOpen: false });
    renderWorkspace();
  });
```

(c) Esc: there is an existing global keydown handler (search for `close-mobile-detail` ~line 2499). Extend it so Escape also closes the task detail drawer when open. In that handler, before/after the mobile-detail check add:

```js
        if (state.taskDetailOpen) { setState({ taskDetailOpen: false, mobileDetailOpen: false }); renderWorkspace(); return; }
```

(Place it so the existing mobile-detail close still works; on mobile both flags clear together.)

- [ ] **Step 5: Reset the drawer on view/project switch and replace `isBoardTaskDetailOpen`**

Search `main.js` for every `isBoardTaskDetailOpen` and every setState that resets `mobileDetailOpen` on navigation:

- The `[data-view]` handler (~line 1764) and `[data-project]` handler (~line 1668): add `taskDetailOpen: false,` to their setState objects (next to the existing `mobileDetailOpen: false` / `isBoardTaskDetailOpen: false`).
- The board card-open handler (~line 1247) currently sets `isBoardTaskDetailOpen: true`: change it to `taskDetailOpen: true` (Task 4 also touches this; setting it here is fine and consistent).
- Replace remaining `isBoardTaskDetailOpen` reads/writes with `taskDetailOpen`. After this task, `isBoardTaskDetailOpen` should no longer be referenced. Remove its declaration from `state.js`.

- [ ] **Step 6: Add the drawer CSS**

In `public/styles.css`:

(a) Replace the `.workspace` grid rules (lines 722-744) for task views with a positioning context:

```css
.workspace {
  position: relative;
  display: block;
  min-height: 0;
  margin: 0 16px 16px;
}
.workspace--library { display: block; min-height: 0; margin: 0 16px 16px; overflow: hidden; }
.workspace--board { display: block; }
```

(Delete the old `grid-template-columns` rules and the `.workspace--board.is-board-detail-open` rule.)

(b) Add the drawer + resizer:

```css
.task-detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--task-detail-width, 380px);
  display: flex;
  background: var(--surface);
  border-left: 1px solid var(--accent);
  box-shadow: -10px 0 24px rgba(0, 0, 0, 0.5);
  z-index: 5;
}
.task-detail-resizer {
  width: 6px;
  flex: 0 0 6px;
  cursor: col-resize;
  background: transparent;
  border-right: 1px solid var(--border);
}
.task-detail-resizer:hover,
.task-detail-resizer:focus-visible,
.task-detail-resizer.is-dragging { background: var(--border-dim); border-right-color: var(--accent); }
.task-detail-drawer .detail-panel { flex: 1; min-width: 0; border: none; overflow-y: auto; }

@media (max-width: 720px) {
  .task-detail-drawer { position: fixed; inset: 0; width: auto; border-left: none; box-shadow: none; z-index: 50; }
  .task-detail-resizer { display: none; }
}
```

(Confirm the mobile breakpoint matches the existing `is-mobile-detail-open` media query width in the file; reuse that exact breakpoint value so desktop/mobile switch consistently.)

- [ ] **Step 7: Run tests + smoke**

Run: `npm test -- tests/frontend`
Expected: PASS (detail-close test green; existing task tests still pass — they assert detail content, not its container).

Run: `npm run check`
Expected: clean.

Manual (`npm run demo`): Tasks list is full-width, no drawer on load; click a task → drawer opens on the right; `[x]` and Escape close it; drag the grip → resizes + persists across reload; switching view/project closes it.

- [ ] **Step 8: Commit**

```bash
git add public/js/state.js public/js/main.js public/js/renderTaskDetail.js public/styles.css tests/frontend/renderTaskDetail.test.js
git commit -m "feat: resizable task detail drawer for Tasks/Backlog/Archive"
```

---

## Task 4: Board adopts the drawer; drop inline inspector + tighten columns

**Files:**
- Modify: `public/js/main.js`, `public/styles.css`
- Test: `tests/frontend/renderBoard.test.js`

The Board renders full-width columns and opens the shared drawer on card click; the stacked `renderBoardInspectorHtml` panel is removed; empty columns no longer reserve large height.

- [ ] **Step 1: Write the failing board test**

In `tests/frontend/renderBoard.test.js`, add (adjust to the file's existing import/fixtures style):

```js
test('renderBoardHtml does not embed a stacked selected-card inspector', () => {
  const tasks = [{ id: 't1', title: 'Patch ingress', status: 'in-progress', priority: 'medium', projectId: 'p1' }];
  const html = renderBoardHtml(tasks, 't1', { today: '2026-05-28', boardOpenSections: {}, projects: [], taskBoardExtras: {} });
  // The board grid renders columns, not an inline inspector panel.
  assert.doesNotMatch(html, /board-inspector/i);
  assert.match(html, /board-column|board-section/i);
});
```

(Read `renderBoard.js` to confirm the column class name; use the real one in the second assertion.)

Run: `npm test -- tests/frontend/renderBoard.test.js`
Expected: PASS already if the inspector was never inside `renderBoardHtml` (it's composed in main.js `renderWorkspacePrimary`). If so, this test documents/guards that; proceed. If the inspector markup IS produced inside `renderBoardHtml`, the test fails and Step 2 removes it.

- [ ] **Step 2: Remove the inline inspector from the board composition**

In `public/js/main.js` `renderWorkspacePrimary` (~line 1483-1508), the board branch builds `const inspector = renderBoardInspectorHtml(...)` and returns `<div class="board-view">${toolbar}${filters}${inspector}${board}</div>`.

- Delete the `inspector` line and remove `${inspector}` from the returned template:

```js
    return `<div class="board-view">${toolbar}${filters}${board}</div>`;
```

- Remove the now-unused `renderBoardInspectorHtml` import if nothing else uses it (grep first; if unused, drop the import line at the top of `main.js`).

The board card click already routes through the same selection path; ensure the card-click handler sets `taskDetailOpen: true` (done in Task 3 Step 5). The shared `.task-detail-drawer` (rendered at the workspace level in `renderWorkspace`) now serves the board too.

- [ ] **Step 3: Tighten board column height (CSS)**

In `public/styles.css`, find the board column rule (search `board-column` / the column min-height near line 3624 `.board-view`). Reduce any fixed/large `min-height` on the column body so empty columns are short. Concretely, set the column body min-height to a small value:

```css
.board-column__body, .board-section__body { min-height: 64px; }
```

(Use the actual column-body class from `renderBoard.js`. If the column currently has no explicit min-height and the height came from the old grid, no change is needed — verify in the demo.)

- [ ] **Step 4: Run tests + smoke**

Run: `npm test -- tests/frontend`
Expected: PASS.

Run: `npm run check`
Expected: clean.

Manual (`npm run demo`): Board shows full-width columns, no metric strip, no stacked selected-card panel; empty columns are short; clicking a card opens the same right drawer as Tasks; `[x]`/Esc close it.

- [ ] **Step 5: Commit**

```bash
git add public/js/main.js public/styles.css tests/frontend/renderBoard.test.js
git commit -m "feat: board uses the shared task detail drawer; drop stacked inspector"
```

---

## Task 5: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full suite + check**

Run: `npm test` → all pass. Run: `npm run check` → clean.

- [ ] **Step 2: Manual smoke (`npm run demo`, http://127.0.0.1:3100)**

Verify each spec acceptance:
1. Desktop left rail shows WORK (tasks/board/library) + VIEWS (backlog/archive) + PROJECTS; the top bar has no view tabs; rail switches views.
2. Tasks: full-width list, no drawer on load; click → right drawer; `[x]`/Esc close; grip resizes + persists across reload.
3. Board: full-width columns, no metric strip, no stacked selected-card panel, short empty columns; card click opens the same drawer.
4. Backlog/Archive: same drawer; Archive detail read-only (restore/delete).
5. Library: unchanged; resizer still works (Task 2 didn't regress it).
6. Switching view or project closes the drawer and returns to full-width.
7. Mobile (resize narrow): task click opens full-screen detail; bottom nav unchanged; rail collapses to hamburger as today.

- [ ] **Step 3: Fix-and-recommit if any step failed.** Otherwise no commit.

---

## Self-review checklist

- [x] **Spec coverage:** left-rail grouped nav + remove top tabs (Task 1 §3-4), `.topbar-title` + drop content-header (Task 1 §4-5), compact metric strip + board gate (Task 1 §3-5), resizer reuse (Task 2), unified `taskDetailOpen` + drawer overlay + open-on-select + `[x]`/Esc + reset triggers + persistence (Task 3), board drawer + drop inspector + tighter columns (Task 4), mobile full-screen via media query (Task 3 §6), tests + manual smoke (Tasks 1/3/4 + Task 5).
- [x] **No placeholder steps:** every code step shows exact before/after; commands show expected results; the two "confirm the real class name" notes (renderBoard column class, renderTaskDetail close-option name) instruct reading the specific file and using the real identifier rather than guessing — required because those identifiers must match existing code exactly.
- [x] **Type/name consistency:** `taskDetailOpen` is introduced in Task 3 §1 (state), gated in `renderWorkspace` (§3), set true on select (§4) and board card-open (§5), reset on view/project switch (§5), and replaces `isBoardTaskDetailOpen` everywhere (§5). `setupPaneResizer` signature defined in Task 2 §1 is called identically in Task 2 §2 (library) and Task 3 §3 (drawer). CSS class `.task-detail-drawer` / `[data-task-detail-resizer]` / `--task-detail-width` / storage key `moomora.taskDetailWidth.v1` are consistent across Task 3 §3 and §6. `close-task-detail` is the single close action used in Task 3 §2/§3/§4. The `is-task-detail-open` workspace class replaces `is-board-detail-open` (Task 3 §3).
