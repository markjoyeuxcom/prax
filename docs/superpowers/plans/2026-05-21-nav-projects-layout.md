# Navigation & Projects Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the app chrome — move the five views into a topbar tab strip, slim the sidebar to an active-only projects list, group live projects by status in the Manage modal, and add a separate Archive dialog (restore / permanent-delete).

**Architecture:** Pure frontend. `renderShell` renders view tabs in the topbar and a projects-only sidebar. The Manage modal (`renderProjectManager`) receives only **live** projects (active/on-hold/completed), grouped by status, plus an archived count that opens a new **Archive dialog** (`renderProjectArchive`) gated by `state.isProjectArchiveOpen`. `main.js` partitions the already-loaded `managedProjects` into live vs archived and wires archive/restore/delete via the existing `projectApi`.

**Tech Stack:** Vanilla ES-module frontend; Node's built-in test runner for the pure render modules. Backend/API/MCP unchanged.

Spec: `docs/superpowers/specs/2026-05-21-nav-projects-layout-design.md`.

---

## Conventions

- **Commits:** conventional-commit; **every commit MUST include both co-author trailers**:
  ```
  Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- **Branch:** `feat/projects-model` (this layout work lands before the branch is finished).
- **Tests:** `node --test tests/frontend/<file>.test.js`; whole suite `npm test`; `npm run check`. Manual: `npm run demo` (:3100).

## Current code (verified)

- `renderShell.js`: `renderViewButtons(activeView)` emits `nav-button`s with `data-view`; `renderProjectButtons(activeProject, projects)` emits All + project `nav-button`s with `data-project`, then `[+] new project` (`data-action="new-project"`) and `manage` (`data-action="open-project-manager"`). The sidebar has two `<nav class="side-nav">` blocks — **Views** (`${renderViewButtons(activeView)}`) and **Projects** (`${renderProjectButtons(...)}`) — then a `.cluster-card`. The topbar has hamburger, `.search-field`, and `.topbar-actions`.
- `main.js` binds `[data-view]`, `[data-project]`, `[data-action="new-project"]`, `[data-action="open-project-manager"]` globally via `app.querySelectorAll`, and has `bindProjectManagerEvents()` + `refreshProjectManager()`; `state.managedProjects` is loaded via `fetchProjects('all')` when the manager opens.
- `renderProjectManager.js`: a flat list; each row has name input (`data-project-name`), a status `<select>` (`data-project-status`, all 4 statuses), move up/down, save, delete (`data-action="manager-*"`, `data-project-id`).
- `projectApi.js`: `updateProject(id, patch)`, `archiveProject(id)` (DELETE `/:id`), `deleteProjectPermanent(id)` (DELETE `/:id/permanent`).
- The hamburger drawer already lists only Backlog under views (bottom-nav covers the rest) + the projects list, so it needs no view change.

## File structure

```
public/js/
├── renderShell.js          MODIFY  view tabs -> topbar; sidebar = projects only (reordered)
├── renderProjectManager.js MODIFY  live-only, grouped by status, + archived button, per-row archive
├── renderProjectArchive.js CREATE  archived-projects dialog (restore / delete)
├── state.js                MODIFY  add isProjectArchiveOpen
└── main.js                 MODIFY  partition live/archived; wire archive dialog + restore + per-row archive
public/styles.css           MODIFY  .topbar-tabs, manager groups, archive dialog
tests/frontend/
├── renderShell.test.js              MODIFY
├── renderProjectManager.test.js     MODIFY
└── renderProjectArchive.test.js     CREATE
```

---

## Task 1: Views to topbar, projects-only sidebar (`renderShell.js`)

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `tests/frontend/renderShell.test.js`

- [ ] **Step 1: Update `tests/frontend/renderShell.test.js`**

Read it. Add/adjust assertions so:
- The **topbar** contains the view tabs: a `<nav class="topbar-tabs">` (or element with class `topbar-tabs`) containing the five `data-view="..."` buttons. Assert `renderShellHtml({...})` output matches `/class="topbar-tabs"/` and that a `data-view="board"` button appears **after** the `topbar` opening and **before** `topbar-actions` (a simple `assert.match(html, /topbar-tabs[\s\S]*data-view="board"/)`).
- The sidebar no longer has a "Views" nav label: `assert.doesNotMatch(html, /nav-label">Views/)` (the sidebar Views block is gone).
- The sidebar still renders the projects nav: `data-project="all"`, `data-action="new-project"`, `data-action="open-project-manager"` all present.
Keep the existing project-nav and breadcrumb assertions. Run `node --test tests/frontend/renderShell.test.js` → expect FAIL.

- [ ] **Step 2: Reorder `renderProjectButtons` (new project on top, manage in footer)**

Replace the `renderProjectButtons` function body's `return` so the order is: new-project button, All projects, project list, then manage:

```javascript
function renderProjectButtons(activeProject, projects) {
  const allActive = activeProject === 'all';
  const newBtn = `
          <button class="nav-button nav-button--accent" type="button" data-action="new-project"><span>[+] new project</span></button>`;
  const allBtn = `
          <button class="nav-button${allActive ? ' is-active' : ''}" type="button" aria-pressed="${allActive}" data-project="all">
            <span>All projects</span>
          </button>`;
  const projectBtns = projects.map((project) => {
    const isActive = project.id === activeProject;
    return `
          <button class="nav-button${isActive ? ' is-active' : ''}" type="button" aria-pressed="${isActive}" data-project="${escapeHtml(project.id)}">
            <span>${escapeHtml(project.name)}</span>
          </button>`;
  }).join('');
  const manageBtn = `
          <button class="nav-button nav-button--quiet" type="button" data-action="open-project-manager"><span>manage</span></button>`;
  return newBtn + allBtn + projectBtns + manageBtn;
}
```

- [ ] **Step 3: Move the view tabs into the topbar and remove the sidebar Views nav**

In `renderShellHtml`, delete the sidebar Views `<nav>` block:
```html
        <nav class="side-nav" aria-label="Views">
          <p class="nav-label">Views</p>${renderViewButtons(activeView)}
        </nav>
```
Keep the Projects `<nav>` (rename its label to "Projects" — it already is). In the `<header class="topbar">`, insert a tab strip right after the hamburger button and before the `.search-field`:
```html
          <nav class="topbar-tabs" aria-label="Views">${renderViewButtons(activeView)}</nav>
```
(`renderViewButtons` is unchanged; its `data-view` buttons keep working with the existing handler.)

- [ ] **Step 4: Run tests**

Run: `node --test tests/frontend/renderShell.test.js` → PASS. `node --check public/js/renderShell.js`.

- [ ] **Step 5: Commit**

```bash
git add public/js/renderShell.js tests/frontend/renderShell.test.js
git commit -m "$(cat <<'EOF'
feat: move views to a topbar tab strip; slim sidebar to projects

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Manage modal — live projects grouped, archive entry (`renderProjectManager.js`)

**Files:**
- Modify: `public/js/renderProjectManager.js`
- Modify: `tests/frontend/renderProjectManager.test.js`

The manager now receives **live** projects only (active/on-hold/completed) plus an `archivedCount`. It groups them by status, drops the per-row "archived" status option (replaced by a per-row `[archive]` action), and shows a footer button to open the Archive dialog.

- [ ] **Step 1: Update `tests/frontend/renderProjectManager.test.js`**

Read it. Change the render calls to the new signature `renderProjectManagerHtml({ projects, archivedCount, error })` where `projects` are LIVE projects. Update/replace assertions to:
- Live projects render under group headings: `assert.match(html, /Active/)`, and a project with `status:'on-hold'` appears under an "On hold" group (`assert.match(html, /On hold/)`).
- The status select offers only the three live options: `assert.doesNotMatch(html, /<option value="archived"/)`.
- Each row has a per-row archive action: `assert.match(html, /data-action="manager-archive" data-project-id="p1"/)`.
- A footer button opens the archive: `assert.match(html, /data-action="open-project-archive"/)` and shows the count, e.g. `renderProjectManagerHtml({ projects: [...], archivedCount: 2 })` → `/archived projects · 2/` (or `/archived[\s\S]*2/`).
- Existing create-row, save/delete/move, escaping, and empty-state assertions stay (empty = no live projects).
Run → expect FAIL.

- [ ] **Step 2: Rewrite `public/js/renderProjectManager.js`**

```javascript
const STATUS_GROUPS = [
  { value: 'active', label: 'Active' },
  { value: 'on-hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStatusSelect(project) {
  const id = escapeHtml(project.id);
  const selected = STATUS_GROUPS.some(option => option.value === project.status)
    ? project.status
    : STATUS_GROUPS[0].value;
  return `<select class="project-row__status" data-project-status="${id}" aria-label="Status">${
    STATUS_GROUPS.map(option =>
      `<option value="${option.value}"${option.value === selected ? ' selected' : ''}>${option.label}</option>`,
    ).join('')
  }</select>`;
}

function renderProjectRow(project) {
  const id = escapeHtml(project.id);
  return `
    <li class="project-row" data-project-row="${id}">
      <input type="text" class="project-row__name" data-project-name="${id}" value="${escapeHtml(project.name)}" autocomplete="off" aria-label="Project name">
      ${renderStatusSelect(project)}
      <div class="project-row__actions">
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-move-up" data-project-id="${id}" aria-label="Move up">[↑]</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-move-down" data-project-id="${id}" aria-label="Move down">[↓]</button>
        <button class="bracket-button" type="button" data-action="manager-save" data-project-id="${id}">[s] save</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-archive" data-project-id="${id}">[a] archive</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-delete" data-project-id="${id}">[x] delete</button>
      </div>
    </li>`;
}

function renderGroup(group, projects) {
  const inGroup = projects.filter(p => (STATUS_GROUPS.some(g => g.value === p.status) ? p.status : 'active') === group.value);
  if (inGroup.length === 0) return '';
  return `
    <li class="project-group" data-project-group="${group.value}">
      <p class="project-group__label">${group.label} · ${inGroup.length}</p>
      <ul class="project-manager__list">${inGroup.map(renderProjectRow).join('')}</ul>
    </li>`;
}

export function renderProjectManagerHtml({ projects = [], archivedCount = 0, error = '' } = {}) {
  const groups = STATUS_GROUPS.map(group => renderGroup(group, projects)).join('');
  return `
    <div class="modal-backdrop" data-project-manager>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Organize</span>
              <h2 id="project-manager-title">Projects</h2>
              <p>Create, rename, set status, reorder, archive, and delete your projects.</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="close-project-manager" aria-label="Close projects">[x] close</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-project-manager">cancel</button>
            <h2 class="modal-header__title">projects</h2>
            <span></span>
          </div>
        </header>
        <div class="project-manager">
          ${error ? `<p class="project-manager__error" role="alert">${escapeHtml(error)}</p>` : ''}
          <div class="project-manager__create">
            <input type="text" class="project-manager__new-name" data-project-new-name placeholder="New project name" autocomplete="off" aria-label="New project name">
            <button class="bracket-button bracket-button--primary" type="button" data-action="manager-create">[+] add</button>
          </div>
          <ul class="project-manager__groups">
            ${groups || '<li class="project-manager__empty">No projects yet — add one above.</li>'}
          </ul>
          <button class="bracket-button bracket-button--quiet project-manager__archive-link" type="button" data-action="open-project-archive">🗄 archived projects · ${Number(archivedCount) || 0}</button>
        </div>
      </section>
    </div>`;
}
```

- [ ] **Step 3: Run tests**

Run: `node --test tests/frontend/renderProjectManager.test.js` → PASS. `node --check public/js/renderProjectManager.js`.

- [ ] **Step 4: Commit**

```bash
git add public/js/renderProjectManager.js tests/frontend/renderProjectManager.test.js
git commit -m "$(cat <<'EOF'
feat: group live projects by status in Manage; add archive entry

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Archive dialog (`renderProjectArchive.js`)

**Files:**
- Create: `public/js/renderProjectArchive.js`
- Test: `tests/frontend/renderProjectArchive.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/frontend/renderProjectArchive.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectArchiveHtml } from '../../public/js/renderProjectArchive.js';

const ARCHIVED = [
  { id: 'p1', name: 'Cluster Migration', slug: 'cluster', status: 'archived' },
  { id: 'p2', name: 'Old Sandbox', slug: 'old', status: 'archived' },
];

test('renders the dialog chrome with back and close actions', () => {
  const html = renderProjectArchiveHtml({ projects: ARCHIVED });
  assert.match(html, /class="modal-backdrop" data-project-archive/);
  assert.match(html, /data-action="close-project-archive"/);
  assert.match(html, /data-action="back-to-manager"/);
});

test('renders a row per archived project with restore and delete', () => {
  const html = renderProjectArchiveHtml({ projects: ARCHIVED });
  assert.match(html, /data-archive-row="p1"/);
  assert.match(html, /data-action="archive-restore" data-project-id="p1"/);
  assert.match(html, /data-action="archive-delete" data-project-id="p1"/);
  assert.match(html, /Cluster Migration/);
});

test('escapes project names', () => {
  const html = renderProjectArchiveHtml({ projects: [{ id: 'p1', name: '<script>x</script>', status: 'archived' }] });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('shows an empty state when there are no archived projects', () => {
  const html = renderProjectArchiveHtml({ projects: [] });
  assert.match(html, /project-archive__empty/);
});

test('shows an error banner when error is provided', () => {
  const html = renderProjectArchiveHtml({ projects: ARCHIVED, error: 'Could not delete' });
  assert.match(html, /project-archive__error/);
  assert.match(html, /Could not delete/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend/renderProjectArchive.test.js` → FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```javascript
// public/js/renderProjectArchive.js
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRow(project) {
  const id = escapeHtml(project.id);
  return `
    <li class="archive-row" data-archive-row="${id}">
      <span class="archive-row__name">${escapeHtml(project.name || 'Untitled project')}</span>
      <div class="archive-row__actions">
        <button class="bracket-button" type="button" data-action="archive-restore" data-project-id="${id}">[↩] restore</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="archive-delete" data-project-id="${id}">[x] delete</button>
      </div>
    </li>`;
}

export function renderProjectArchiveHtml({ projects = [], error = '' } = {}) {
  return `
    <div class="modal-backdrop" data-project-archive>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="project-archive-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Recover</span>
              <h2 id="project-archive-title">Archived projects</h2>
              <p>Restore a project to active, or permanently delete an empty one.</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="back-to-manager" aria-label="Back to projects">[<] back</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="back-to-manager">back</button>
            <h2 class="modal-header__title">archived</h2>
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-project-archive">×</button>
          </div>
        </header>
        <div class="project-archive">
          ${error ? `<p class="project-archive__error" role="alert">${escapeHtml(error)}</p>` : ''}
          <ul class="project-archive__list">
            ${projects.length
              ? projects.map(renderRow).join('')
              : '<li class="project-archive__empty">No archived projects.</li>'}
          </ul>
        </div>
      </section>
    </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend/renderProjectArchive.test.js` → PASS (5 tests). `node --check public/js/renderProjectArchive.js`.

- [ ] **Step 5: Commit**

```bash
git add public/js/renderProjectArchive.js tests/frontend/renderProjectArchive.test.js
git commit -m "$(cat <<'EOF'
feat: add archived-projects dialog renderer (restore / delete)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the manager split + archive dialog (`state.js`, `main.js`)

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`

No new unit test (wiring verified by `npm run check` + suite green + manual demo smoke).

- [ ] **Step 1: `state.js`** — add the flag next to `isProjectManagerOpen`:
```javascript
  isProjectArchiveOpen: false,
```

- [ ] **Step 2: `main.js` imports** — add `import { renderProjectArchiveHtml } from './renderProjectArchive.js';`. Ensure `updateProject`, `archiveProject`, `deleteProjectPermanent` are imported from `./projectApi.js` (add any missing).

- [ ] **Step 3: Pass live projects + archived count to the manager render**

Find the `renderProjectManagerHtml({ projects: state.managedProjects, error: state.projectManagerError })` call in `renderApp`. Replace it with a partition:
```javascript
  if (state.isProjectManagerOpen) {
    const liveProjects = state.managedProjects.filter((p) => p.status !== 'archived');
    const archivedCount = state.managedProjects.length - liveProjects.length;
    app.insertAdjacentHTML('beforeend', renderProjectManagerHtml({
      projects: liveProjects,
      archivedCount,
      error: state.projectManagerError,
    }));
  }
  if (state.isProjectArchiveOpen) {
    const archivedProjects = state.managedProjects.filter((p) => p.status === 'archived');
    app.insertAdjacentHTML('beforeend', renderProjectArchiveHtml({
      projects: archivedProjects,
      error: state.projectManagerError,
    }));
  }
```
(Insert the archive block right after the manager block. The archive renders on top when open.)
After the existing `bindProjectManagerEvents();` call, add `bindProjectArchiveEvents();`.

- [ ] **Step 4: Manager — handle the per-row archive + the open-archive button**

In `bindProjectManagerEvents()` (the manager's panel handlers), add, alongside the existing manager-save/delete handlers:
```javascript
  panel.querySelectorAll('[data-action="manager-archive"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await archiveProject(button.dataset.projectId);
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not archive that project.' });
        renderApp();
      }
    });
  });

  panel.querySelector('[data-action="open-project-archive"]')?.addEventListener('click', () => {
    setState({ isProjectArchiveOpen: true, projectManagerError: '' });
    renderApp();
  });
```

- [ ] **Step 5: Archive dialog handlers**

Add a new binder (call it from `renderApp` per Step 3):
```javascript
function bindProjectArchiveEvents() {
  const panel = app.querySelector('[data-project-archive]');
  if (!panel) return;

  const back = () => { setState({ isProjectArchiveOpen: false, projectManagerError: '' }); renderApp(); };
  panel.querySelector('[data-action="back-to-manager"]')?.addEventListener('click', back);
  panel.querySelector('[data-action="close-project-archive"]')?.addEventListener('click', () => {
    setState({ isProjectArchiveOpen: false, isProjectManagerOpen: false, projectManagerError: '' });
    renderApp();
  });

  panel.querySelectorAll('[data-action="archive-restore"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await updateProject(button.dataset.projectId, { status: 'active' });
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not restore that project.' });
        renderApp();
      }
    });
  });

  panel.querySelectorAll('[data-action="archive-delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('Permanently delete this archived project? Only empty projects can be deleted.')) return;
      try {
        await deleteProjectPermanent(button.dataset.projectId);
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not delete: the project still has tasks or documents.' });
        renderApp();
      }
    });
  });
}
```
Note: `refreshProjectManager()` already re-fetches `managedProjects` (all statuses) and re-renders, so restoring/archiving updates both the manager groups and the archive list while the dialog stays open. The Escape-key closer selector should also include the archive — add `[data-action="back-to-manager"]` to the existing escape closer query string in `main.js` so Esc backs out of the archive first.

- [ ] **Step 6: Verify**

Run `node --check public/js/main.js public/js/state.js`, then `npm test` (suite green) and `npm run check`.

- [ ] **Step 7: Commit**

```bash
git add public/js/state.js public/js/main.js
git commit -m "$(cat <<'EOF'
feat: wire archive dialog (open/back/restore/delete) + per-row archive

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Styles (`styles.css`)

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Append the layout styles**

Add at the end of `public/styles.css` (uses existing palette vars):
```css
/* Topbar view tabs */
.topbar-tabs { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.topbar-tabs .nav-button { padding: 5px 10px; }
@media (max-width: 1023px) { .topbar-tabs { display: none; } } /* bottom-nav covers views on mobile */

/* Sidebar project action variants */
.nav-button--accent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.nav-button--quiet { color: var(--text-dim); }

/* Manage groups */
.project-manager__groups { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.project-group { list-style: none; }
.project-group__label { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: var(--text-dimmer); margin: 4px 2px; }
.project-manager__archive-link { width: 100%; margin-top: 12px; text-align: center; }

/* Archive dialog */
.project-archive { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.project-archive__error { margin: 0; padding: 8px 12px; border: 1px solid var(--accent-amber); border-radius: 6px; color: var(--accent-amber); font-size: 0.85rem; }
.project-archive__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.archive-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: var(--bg-deep); }
.archive-row__name { font-weight: 600; }
.archive-row__actions { display: flex; gap: 6px; }
.project-archive__empty { color: var(--text-dimmer); font-size: 0.85rem; padding: 6px 2px; list-style: none; }
```

- [ ] **Step 2: Verify braces balance**

Run: `node -e "const c=require('fs').readFileSync('public/styles.css','utf8'); const o=(c.match(/{/g)||[]).length,x=(c.match(/}/g)||[]).length; if(o!==x) throw new Error('unbalanced '+o+' vs '+x); console.log('balanced', o)"`
Expected: prints "balanced <n>".

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "$(cat <<'EOF'
feat: styles for topbar tabs, manage groups, and archive dialog

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full verification + demo smoke + push

**Files:** none

- [ ] **Step 1: Suite + check**

Run: `npm test && npm run check`. Expected: all pass; exit 0.

- [ ] **Step 2: Manual demo smoke (documented)**

`npm run demo`, open the app, and confirm:
- View tabs sit in the topbar; clicking them switches views; the sidebar shows only `[+] new project`, All projects, the active projects, and `manage` (no Views block, no archived).
- Open **manage** → projects grouped Active / On hold / Completed; a row's `[a] archive` moves it out of the groups and out of the sidebar; the `🗄 archived projects · N` count increments.
- Click `🗄 archived projects` → Archive dialog lists archived projects; **[↩] restore** returns one to active (back in groups + sidebar); **[x] delete** on an empty archived project succeeds; deleting one with tasks shows the error. **[<] back** returns to Manage; Esc backs out.

- [ ] **Step 3: Push**

```bash
git push origin feat/projects-model
```

---

## Self-Review

**1. Spec coverage:**
- Views → topbar tab strip; sidebar Views block removed → Task 1. ✔
- Sidebar projects-only, active-only, `[+] new project` prominent + All + active list + manage → Task 1 (reordered `renderProjectButtons`; `state.projects` is already active-only). ✔
- Manage groups live projects by status, excludes archived, per-row archive, status select limited to 3 live, `🗄 archived projects · N` button → Task 2. ✔
- Separate Archive dialog (restore / delete-when-empty, back/close) gated by `isProjectArchiveOpen` → Tasks 3–4. ✔
- Reuse `managedProjects` (no extra fetch) by partitioning live/archived → Task 4 Step 3. ✔
- restore = `updateProject(status:'active')`, archive = `archiveProject`, delete = `deleteProjectPermanent`; refresh resets activeProject when needed (existing `refreshProjectManager`) → Task 4. ✔
- Mobile: topbar tabs hidden ≤1023px (bottom-nav covers views); drawer unchanged → Task 1 + Task 5 (`@media`). ✔
- Styles for tabs/groups/archive → Task 5. ✔
- Tests for renderShell, manager, archive → Tasks 1–3; wiring via smoke → Task 6. ✔
- No backend/API/MCP changes. ✔

**2. Placeholder scan:** New module + tests have full code; the manager rewrite is given in full; existing-file edits are exact snippets against verified current code; `main.js` handlers are concrete with try/catch + messages. No vague placeholders.

**3. Type/name consistency:** Render emits `data-action` values `new-project`, `open-project-manager`, `manager-create|save|delete|move-up|move-down|archive`, `open-project-archive`, `close-project-manager`, and the archive's `back-to-manager`, `close-project-archive`, `archive-restore`, `archive-delete`; `main.js` (Task 4) binds those exact strings. `renderProjectManagerHtml({ projects, archivedCount, error })` and `renderProjectArchiveHtml({ projects, error })` signatures match their call sites. `state.isProjectArchiveOpen` declared (Task 4 Step 1) and used in `renderApp`/handlers. `STATUS_GROUPS` (3 live) is the manager's status set; archived is reached only via the archive dialog.
