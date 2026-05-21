# Projects Model — Project Manager (Phase 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-manager modal so the operator can create, rename, change status (active/on-hold/completed/archived), reorder, and permanently delete (when empty) projects — wired to the `open-project-manager` control that Phase 2a rendered but left inert.

**Architecture:** A new pure render module `renderProjectManager.js` builds the modal from a passed-in project list (all statuses) using the existing `modal-backdrop`/`admin-modal`/`modal-header` chrome. `main.js` opens it (fetching `fetchProjects('all')` into `state.managedProjects`), renders it when `state.isProjectManagerOpen`, and binds create/save/delete/reorder handlers that call the existing `projectApi` CRUD and refresh both the manager list and the active nav list.

**Tech Stack:** Vanilla ES-module frontend, Node's built-in test runner for the render module. Backend projects CRUD (Phase 1) and `projectApi` (Phase 2a) already exist.

Spec: `docs/superpowers/specs/2026-05-20-projects-model-design.md`. This is **Phase 2b** (final frontend slice); Phase 3 (MCP `context`→`project`) follows separately.

---

## Conventions for the executor

- **Commits:** conventional-commit; **every commit MUST include both co-author trailers**:
  ```
  Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- **Branch:** `feat/projects-model` (holds Phase 1 + 2a).
- **Tests:** `node --test tests/frontend/<file>.test.js`; whole suite `npm test`; `npm run check`; manual `npm run demo`.

## Already in place (use, do not recreate)

- `public/js/projectApi.js`: `fetchProjects(status)`, `createProject(name)`, `updateProject(id, patch)`, `archiveProject(id)`, `deleteProjectPermanent(id)`.
- `public/js/state.js`: `state.activeProject`, `state.projects` (active list), `loadActiveProject`/`persistActiveProject`. `setState(patch)` merges.
- `public/js/main.js`: `loadProjects()` (fetches active → `setState({projects})`); the modal pattern — render the panel HTML in `renderApp()` when its `state.isXOpen` flag is set, then call `bindXEvents()` (which queries `[data-x-panel]`); existing handlers for `open-project-manager` do NOT exist yet (the button is inert).
- Backend: `GET /api/projects?status=all`, `POST`, `PATCH /:id` (name/status/sortOrder), `DELETE /:id` (archive), `DELETE /:id/permanent` (409 when non-empty).
- Modal chrome classes: `modal-backdrop`, `admin-modal`, `modal-header` (+ `modal-header--desktop`/`--mobile`, `modal-header__close`, `bracket-button`). See `renderAdminPanel.js` for the exact structure to mirror.

## File structure

```
public/js/
├── renderProjectManager.js   CREATE  pure modal HTML builder
├── state.js                  MODIFY  add isProjectManagerOpen / managedProjects / projectManagerError
└── main.js                   MODIFY  open handler, render+bind, CRUD wiring, refresh
public/styles.css             MODIFY  project-manager layout styles
tests/frontend/
└── renderProjectManager.test.js  CREATE
```

---

## Task 1: `renderProjectManager.js` + tests

**Files:**
- Create: `public/js/renderProjectManager.js`
- Test: `tests/frontend/renderProjectManager.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/frontend/renderProjectManager.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProjectManagerHtml } from '../../public/js/renderProjectManager.js';

const PROJECTS = [
  { id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active', sortOrder: 0 },
  { id: 'p2', name: 'Work', slug: 'work', status: 'on-hold', sortOrder: 1 },
];

test('renders the modal chrome with a close action', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /class="modal-backdrop" data-project-manager/);
  assert.match(html, /data-action="close-project-manager"/);
});

test('renders a row per project with name input and status select preselected', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /data-project-row="p1"/);
  assert.match(html, /data-project-name="p1"[^>]*value="Homelab"/);
  assert.match(html, /data-project-row="p2"/);
  // p2 status on-hold is the selected option
  assert.match(html, /data-project-status="p2"[\s\S]*?<option value="on-hold" selected>/);
  // each row exposes save / delete / move actions tagged with the id
  assert.match(html, /data-action="manager-save" data-project-id="p1"/);
  assert.match(html, /data-action="manager-delete" data-project-id="p1"/);
  assert.match(html, /data-action="manager-move-up" data-project-id="p1"/);
  assert.match(html, /data-action="manager-move-down" data-project-id="p1"/);
});

test('renders the create row', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS });
  assert.match(html, /data-project-new-name/);
  assert.match(html, /data-action="manager-create"/);
});

test('renders all four status options for each row', () => {
  const html = renderProjectManagerHtml({ projects: [PROJECTS[0]] });
  for (const value of ['active', 'on-hold', 'completed', 'archived']) {
    assert.match(html, new RegExp(`<option value="${value}"`));
  }
});

test('escapes project names', () => {
  const html = renderProjectManagerHtml({ projects: [{ id: 'p1', name: '<script>x</script>', slug: 'x', status: 'active', sortOrder: 0 }] });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('shows an error banner when error is provided', () => {
  const html = renderProjectManagerHtml({ projects: PROJECTS, error: 'Could not delete' });
  assert.match(html, /project-manager__error/);
  assert.match(html, /Could not delete/);
});

test('renders an empty list without throwing', () => {
  const html = renderProjectManagerHtml({ projects: [] });
  assert.match(html, /project-manager__list/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend/renderProjectManager.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// public/js/renderProjectManager.js
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on-hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
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
  return `<select class="project-row__status" data-project-status="${id}" aria-label="Status">${
    STATUS_OPTIONS.map(option =>
      `<option value="${option.value}"${option.value === project.status ? ' selected' : ''}>${option.label}</option>`,
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
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-delete" data-project-id="${id}">[x] delete</button>
      </div>
    </li>`;
}

export function renderProjectManagerHtml({ projects = [], error = '' } = {}) {
  return `
    <div class="modal-backdrop" data-project-manager>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Organize</span>
              <h2 id="project-manager-title">Projects</h2>
              <p>Create, rename, set status, reorder, and delete your projects.</p>
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
          <ul class="project-manager__list">
            ${projects.map(renderProjectRow).join('')}
          </ul>
        </div>
      </section>
    </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend/renderProjectManager.test.js`
Expected: PASS (7 tests). Also `node --check public/js/renderProjectManager.js`.

- [ ] **Step 5: Commit**

```bash
git add public/js/renderProjectManager.js tests/frontend/renderProjectManager.test.js
git commit -m "$(cat <<'EOF'
feat: add project manager modal renderer

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Project-manager styles

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Append the layout styles**

Add this block at the end of `public/styles.css` (uses existing palette CSS variables `--border`, `--bg-deep`, `--text-dimmer`, `--accent-amber`):

```css
/* Project manager modal */
.project-manager { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px; }
.project-manager__error {
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--accent-amber);
  border-radius: 6px;
  color: var(--accent-amber);
  font-size: 0.85rem;
}
.project-manager__create { display: flex; gap: 8px; }
.project-manager__new-name {
  flex: 1;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-body);
  padding: 8px 10px;
}
.project-manager__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.project-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--bg-deep);
}
.project-row__name { flex: 1 1 160px; min-width: 120px; background: transparent; border: 1px solid var(--border); border-radius: 6px; color: var(--text-body); padding: 6px 8px; }
.project-row__status { background: transparent; border: 1px solid var(--border); border-radius: 6px; color: var(--text-body); padding: 6px 8px; }
.project-row__actions { display: flex; gap: 6px; flex-wrap: wrap; }
```

- [ ] **Step 2: Verify the CSS is valid (no unbalanced braces)**

Run: `node -e "const c=require('fs').readFileSync('public/styles.css','utf8'); const o=(c.match(/{/g)||[]).length, x=(c.match(/}/g)||[]).length; if(o!==x){throw new Error('unbalanced braces '+o+' vs '+x)} console.log('braces balanced', o)"`
Expected: prints "braces balanced <n>".

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "$(cat <<'EOF'
feat: add project manager modal styles

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the project manager in `main.js`

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`

No new unit test (wiring is verified by `npm run check` + the suite staying green + a manual demo smoke).

- [ ] **Step 1: Add the manager state flags in `state.js`**

In the `state` object, add (next to the other panel flags like `isAdminPanelOpen`):
```javascript
  isProjectManagerOpen: false,
  managedProjects: [],
  projectManagerError: '',
```

- [ ] **Step 2: Imports in `main.js`**

- Add `import { renderProjectManagerHtml } from './renderProjectManager.js';`
- Extend the existing `./projectApi.js` import to include `updateProject` and `deleteProjectPermanent`:
  `import { fetchProjects, createProject, updateProject, deleteProjectPermanent } from './projectApi.js';`

- [ ] **Step 3: Render the modal in `renderApp()`**

After the `if (state.isAdminPanelOpen) { … }` render block, add:
```javascript
  if (state.isProjectManagerOpen) {
    app.insertAdjacentHTML('beforeend', renderProjectManagerHtml({
      projects: state.managedProjects,
      error: state.projectManagerError,
    }));
  }
```
And after the existing `bindAdminPanelEvents();` call, add `bindProjectManagerEvents();`.

- [ ] **Step 4: Wire the `open-project-manager` action**

Where the other top-level `[data-action]` buttons are bound (use `querySelectorAll`, since the control is in both sidebar and drawer), add:
```javascript
  app.querySelectorAll('[data-action="open-project-manager"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const managed = await fetchProjects('all');
        setState({ isProjectManagerOpen: true, managedProjects: managed, projectManagerError: '', isDrawerOpen: false });
        renderApp();
      } catch {
        window.alert('Moomora Console could not load projects.');
      }
    });
  });
```

- [ ] **Step 5: Add a refresh helper + `bindProjectManagerEvents`**

Add near the other helpers/binders:
```javascript
async function refreshProjectManager() {
  const managed = await fetchProjects('all');
  await loadProjects();
  if (state.activeProject !== 'all' && !state.projects.some((p) => p.id === state.activeProject)) {
    setState({ activeProject: 'all' });
    persistActiveProject('all');
  }
  setState({ managedProjects: managed });
  renderApp();
}

function bindProjectManagerEvents() {
  const panel = app.querySelector('[data-project-manager]');
  if (!panel) return;

  panel.querySelector('[data-action="close-project-manager"]')?.addEventListener('click', async () => {
    setState({ isProjectManagerOpen: false, projectManagerError: '' });
    // Reflect any project changes in the current view.
    try {
      if (state.activeView === 'library') await loadDocuments({ selectedDocumentId: null });
      else await loadTasks({ selectedTaskId: null });
    } catch (error) {
      setState({ apiStatus: 'error' });
      renderError(error.message);
    }
  });

  panel.querySelector('[data-action="manager-create"]')?.addEventListener('click', async () => {
    const name = panel.querySelector('[data-project-new-name]')?.value?.trim();
    if (!name) return;
    try {
      await createProject(name);
      await refreshProjectManager();
    } catch {
      setState({ projectManagerError: 'Could not create that project.' });
      renderApp();
    }
  });

  panel.querySelectorAll('[data-action="manager-save"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.projectId;
      const name = panel.querySelector(`[data-project-name="${id}"]`)?.value?.trim();
      const status = panel.querySelector(`[data-project-status="${id}"]`)?.value;
      if (!name) {
        setState({ projectManagerError: 'Project name is required.' });
        renderApp();
        return;
      }
      try {
        await updateProject(id, { name, status });
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not save that project.' });
        renderApp();
      }
    });
  });

  panel.querySelectorAll('[data-action="manager-delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.projectId;
      if (!window.confirm('Permanently delete this project? Only empty projects (no tasks or documents) can be deleted.')) return;
      try {
        await deleteProjectPermanent(id);
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not delete: the project still has tasks or documents.' });
        renderApp();
      }
    });
  });

  const move = async (id, direction) => {
    const ordered = [...state.managedProjects].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((p) => p.id === id);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return;
    const current = ordered[index];
    const neighbor = ordered[swapIndex];
    try {
      await updateProject(current.id, { sortOrder: neighbor.sortOrder });
      await updateProject(neighbor.id, { sortOrder: current.sortOrder });
      await refreshProjectManager();
    } catch {
      setState({ projectManagerError: 'Could not reorder projects.' });
      renderApp();
    }
  };
  panel.querySelectorAll('[data-action="manager-move-up"]').forEach((button) => {
    button.addEventListener('click', () => move(button.dataset.projectId, 'up'));
  });
  panel.querySelectorAll('[data-action="manager-move-down"]').forEach((button) => {
    button.addEventListener('click', () => move(button.dataset.projectId, 'down'));
  });
}
```

- [ ] **Step 6: Verify**

Run: `node --check public/js/main.js public/js/state.js` (exit 0), then `npm test` (whole suite green) and `npm run check` (exit 0).
Manual demo smoke:
```bash
npm run demo > /tmp/demo.log 2>&1 &
until curl -sf http://127.0.0.1:3100/healthz >/dev/null; do sleep 0.5; done
echo "open http://127.0.0.1:3100/ → click 'manage' in the Projects nav → create/rename/status/reorder/delete a project; confirm the sidebar list updates and deleting a project that has tasks shows the 'still has tasks' error"
# pkill -f scripts/demo-server.js  (when done)
```

- [ ] **Step 7: Commit**

```bash
git add public/js/state.js public/js/main.js
git commit -m "$(cat <<'EOF'
feat: wire the project manager modal (create/rename/status/reorder/delete)

Open from the Projects nav 'manage' control; loads all projects, applies
CRUD via projectApi, and refreshes both the manager list and the active
nav (resetting activeProject to 'all' if the selected project is no
longer active). Permanent delete surfaces the backend 409 as a friendly
error.

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full verification + push

**Files:** none

- [ ] **Step 1: Suite + check**

Run: `npm test && npm run check`
Expected: all pass; exit 0.

- [ ] **Step 2: Manual demo smoke (documented)**

With `npm run demo`, open the app, click **manage** in the Projects nav, and confirm: creating a project adds it to the sidebar; renaming + changing status to `archived` removes it from the active nav (it stays in the manager list under the archived status); reordering with `[↑]`/`[↓]` changes nav order; deleting an empty project succeeds; deleting a project that owns tasks shows the "still has tasks or documents" error.

- [ ] **Step 3: Push**

```bash
git push origin feat/projects-model
```

---

## Self-Review

**1. Spec coverage (Phase 2b portion of the design spec):**
- Project manager UI: create → Task 1 (create row) + Task 3 (`manager-create`). ✔
- Rename → name input + `manager-save` (PATCH name). ✔
- Status change incl. archive (active/on-hold/completed/archived) → status select + `manager-save` (PATCH status); archiving via status select removes it from the active nav on refresh. ✔
- Reorder → `[↑]`/`[↓]` swap sortOrder via two PATCHes. ✔
- Permanent-delete-when-empty → `manager-delete` → `deleteProjectPermanent`; backend 409 surfaced as a friendly error. ✔
- On-hold/completed/archived projects live in the manager (it loads `status=all`), keeping the main nav to active ones. ✔
- The `open-project-manager` control (rendered inert in Phase 2a) is now wired. ✔
- Active-project safety: refresh resets `activeProject` to `'all'` if the selected project is no longer active. ✔

**2. Placeholder scan:** `renderProjectManager.js` + its test have full code; the styles block is complete; the `main.js`/`state.js` edits are concrete code with exact insertion points relative to existing anchors (`isAdminPanelOpen` render block, `bindAdminPanelEvents()` call, the projectApi import). No "TBD"/"handle errors"-style vagueness — every handler has explicit try/catch + error text.

**3. Type/name consistency:** The render module emits `data-project-manager`, `data-action="close-project-manager"|"manager-create"|"manager-save"|"manager-delete"|"manager-move-up"|"manager-move-down"`, `data-project-name="<id>"`, `data-project-status="<id>"`, `data-project-id="<id>"`, `data-project-new-name`, `data-project-row="<id>"` — and `main.js` Task 3 queries those exact attributes. State keys `isProjectManagerOpen`/`managedProjects`/`projectManagerError` are declared in `state.js` (Task 3 Step 1) and used in `renderApp`/handlers. `projectApi` functions `fetchProjects`/`createProject`/`updateProject`/`deleteProjectPermanent` match Phase 2a's exports.
