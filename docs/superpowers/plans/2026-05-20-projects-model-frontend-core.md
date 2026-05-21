# Projects Model — Frontend Core (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend work against the project-based backend: replace the fixed `context` everywhere in the UI with user-creatable projects, add an "All projects" nav toggle plus per-project selection and inline project creation, and key task/document creation, view filtering, and admin import/export on `project`.

**Architecture:** `state.activeProject` (`'all'` or a project id) drives every view; `state.projects` holds the loaded active list, fetched via a new `projectApi.js`. The nav, forms, and admin panel render from `state.projects` instead of a hardcoded enum. List/document loads send `project` (the active id, or omitted when `'all'`).

**Tech Stack:** Vanilla ES-module frontend, Node's built-in test runner for the pure render/helper modules. Backend (Phase 1) already accepts `project` (slug-or-id), exposes `/api/projects`, and treats omitted/`all` project as a cross-project query.

Spec: `docs/superpowers/specs/2026-05-20-projects-model-design.md`. This is **Phase 2a**; the project-manager panel is **Phase 2b** (separate plan). MCP is **Phase 3**.

---

## Conventions for the executor

- **Commits:** conventional-commit; **every commit MUST include both co-author trailers**:
  ```
  Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- **Branch:** `feat/projects-model` (already holds Phase 1).
- **Tests:** `node --test tests/frontend/<file>.test.js`; whole suite `npm test`; `npm run check`.
- **Manual UI check:** `npm run demo` (serves on `:3100`) — the demo backend already supports projects.
- The render modules are pure string builders tested in isolation; `main.js` is wired and verified manually + by the existing integration-style frontend tests.

## Key facts about the current code (verified)

- `public/js/state.js` has `activeContext: 'homelab'` and no `projects`. `setState(patch)` merges.
- `public/js/main.js`:
  - `loadTasks` (~line 1635) calls `fetchTasks({ context: state.activeContext, archived: … })`.
  - `loadDocuments` (~1654) calls `fetchDocuments({ context: state.activeContext, archived: 'all' })`.
  - Client-side doc filter appears twice: `state.documents.filter(d => d.context === state.activeContext)` (~110 and ~429).
  - `[data-context]` click handler (~1203–1210) sets `activeContext`.
  - Task create payload (~1604) `context: String(data.get('context') || state.activeContext)`.
  - Document create payload (~1336) `context: String(data.get('context') || state.activeContext)` and post-save `activeContext: savedDocument.context …` (~1350, ~1617).
  - Admin export (~1368 `exportAdminTasks`, ~1436 `export-context` handler) and import (~1399) use `state.activeContext`.
- `public/js/taskApi.js`: `fetchTasks(filters)` serializes truthy filter entries to query params; `exportTasks(filters)`; `importTasks({ context, mode, tasks })` posts `{ context, mode, tasks }`.
- `public/js/renderShell.js`: `contextButtons` array + `renderContextButtons(activeContext)`; drawer hardcodes `['personal','work','homelab']`; status footer breadcrumb prints `activeContext`.
- `public/js/renderTaskForm.js`: `const CONTEXTS = [...]` + a `<select name="context">`.
- `public/js/renderLibrary.js`: `const CONTEXTS = [...]` + a `<select name="context">`.
- Backend list endpoints: `GET /api/tasks?project=<id|slug>` / `GET /api/library/documents?project=…`; omit or `project=all` → all projects; unknown project → 400. Task/doc create accept `project`. Documents/tasks now carry `projectId` (not `context`).

## File structure

```
public/js/
├── projectApi.js          CREATE  fetch/create/update/archive/deletePermanent projects
├── state.js               MODIFY  activeContext->activeProject, add projects + persistence
├── main.js                MODIFY  loadProjects, project-aware loads/filters/handlers/payloads
├── renderShell.js         MODIFY  dynamic Projects nav (All + list + new), breadcrumb
├── renderTaskForm.js      MODIFY  project picker instead of CONTEXTS select
├── renderLibrary.js       MODIFY  project picker instead of CONTEXTS select
├── renderAdminPanel.js    MODIFY  project-keyed export/import controls
└── taskApi.js             MODIFY  importTasks/exportTasks use `project`
tests/frontend/
├── projectApi.test.js     CREATE
├── renderShell.test.js     MODIFY  projects nav assertions
├── renderTaskForm.test.js  MODIFY  project picker assertions
├── renderLibrary.test.js   MODIFY  project picker assertions
├── renderAdminPanel.test.js MODIFY project export/import assertions
└── taskApi.test.js          MODIFY  project param assertions
```

---

## Task 1: `projectApi.js` + tests

**Files:**
- Create: `public/js/projectApi.js`
- Test: `tests/frontend/projectApi.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/frontend/projectApi.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchProjects, createProject, updateProject, archiveProject, deleteProjectPermanent,
} from '../../public/js/projectApi.js';

function stubFetch(captured, response = { ok: true, json: async () => ({}) }) {
  globalThis.fetch = async (url, options) => {
    captured.url = url;
    captured.options = options;
    return response;
  };
}

test('fetchProjects requests /api/projects with optional status', async () => {
  const c = {};
  stubFetch(c, { ok: true, json: async () => [{ id: 'p1' }] });
  assert.deepEqual(await fetchProjects(), [{ id: 'p1' }]);
  assert.equal(c.url, '/api/projects');
  await fetchProjects('all');
  assert.equal(c.url, '/api/projects?status=all');
});

test('createProject POSTs the name', async () => {
  const c = {};
  stubFetch(c, { ok: true, json: async () => ({ id: 'p9', name: 'X' }) });
  const project = await createProject('X');
  assert.equal(c.url, '/api/projects');
  assert.equal(c.options.method, 'POST');
  assert.deepEqual(JSON.parse(c.options.body), { name: 'X' });
  assert.equal(project.id, 'p9');
});

test('updateProject PATCHes the patch', async () => {
  const c = {};
  stubFetch(c);
  await updateProject('p1', { status: 'on-hold' });
  assert.equal(c.url, '/api/projects/p1');
  assert.equal(c.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(c.options.body), { status: 'on-hold' });
});

test('archiveProject DELETEs the project', async () => {
  const c = {};
  stubFetch(c);
  await archiveProject('p1');
  assert.equal(c.url, '/api/projects/p1');
  assert.equal(c.options.method, 'DELETE');
});

test('deleteProjectPermanent DELETEs the permanent endpoint', async () => {
  const c = {};
  stubFetch(c);
  await deleteProjectPermanent('p1');
  assert.equal(c.url, '/api/projects/p1/permanent');
  assert.equal(c.options.method, 'DELETE');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend/projectApi.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// public/js/projectApi.js
export async function fetchProjects(status) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`/api/projects${qs}`);
  if (!response.ok) throw new Error('Failed to load projects');
  return response.json();
}

export async function createProject(name) {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error('Failed to create project');
  return response.json();
}

export async function updateProject(id, patch) {
  const response = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Failed to update project');
  return response.json();
}

export async function archiveProject(id) {
  const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to archive project');
  return response.json();
}

export async function deleteProjectPermanent(id) {
  const response = await fetch(`/api/projects/${id}/permanent`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete project');
  return response.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend/projectApi.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/projectApi.js tests/frontend/projectApi.test.js
git commit -m "$(cat <<'EOF'
feat: add projectApi client for the projects resource

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: State — `activeProject` + `projects` + persistence

**Files:**
- Modify: `public/js/state.js`

- [ ] **Step 1: Replace `activeContext` with `activeProject` and add `projects`**

In `public/js/state.js`, change:
```javascript
  activeContext: 'homelab',
```
to:
```javascript
  activeProject: 'all',   // 'all' or a project id
  projects: [],           // active projects loaded from /api/projects
```

- [ ] **Step 2: Add a persistence helper for the active project selection**

At the end of `state.js`, add:
```javascript
const ACTIVE_PROJECT_KEY = 'moomora.activeProject.v1';

export function loadActiveProject() {
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY) || 'all';
  } catch {
    return 'all';
  }
}

export function persistActiveProject(value) {
  try {
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, value);
  } catch {
    /* ignore storage failures */
  }
}
```

- [ ] **Step 3: Verify it parses**

Run: `node --check public/js/state.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add public/js/state.js
git commit -m "$(cat <<'EOF'
feat: state tracks activeProject and the loaded projects list

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Dynamic Projects nav in `renderShell.js`

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `tests/frontend/renderShell.test.js`

`renderShellHtml` currently takes `activeContext`. It will take `activeProject` and `projects` and render an "All projects" item plus a button per active project, a `[+] new project` action, and a `manage` action. The drawer's hardcoded contexts become the same dynamic list. The footer breadcrumb shows the active project's name (or "all projects").

- [ ] **Step 1: Update `tests/frontend/renderShell.test.js`**

Read the file. Replace context-nav assertions with project-nav ones. The render call now passes `activeProject` and `projects`. Add/change tests to assert:
- Calling `renderShellHtml({ activeProject: 'all', projects: [{ id: 'p1', name: 'Homelab', slug: 'homelab', status: 'active' }] })` produces an "All projects" control with `data-project="all"` marked active, and a `data-project="p1"` button labelled "Homelab".
- A `[+] new project` control with `data-action="new-project"` and a `data-action="open-project-manager"` control are present.
- When `activeProject: 'p1'`, the `data-project="p1"` button is active and the breadcrumb shows "Homelab".

Run: `node --test tests/frontend/renderShell.test.js` → expect FAIL.

- [ ] **Step 2: Edit `renderShell.js`**

- Remove the `contextButtons` array and `renderContextButtons` function.
- Add a `renderProjectButtons(activeProject, projects)` that returns:
  - an "All projects" button: `data-project="all"`, active class when `activeProject === 'all'`;
  - one button per project in `projects`: `data-project="${project.id}"`, label `escapeHtml(project.name)`, active when `project.id === activeProject`.
- In `renderShellHtml`, change the signature to accept `{ activeProject = 'all', projects = [], … }` (remove `activeContext`). Replace the "Contexts" `<nav>` block body with `renderProjectButtons(activeProject, projects)` plus two action buttons:
  ```
  <button class="nav-button nav-button--ghost" type="button" data-action="new-project"><span>[+] new project</span></button>
  <button class="nav-button nav-button--ghost" type="button" data-action="open-project-manager"><span>manage</span></button>
  ```
- In the hamburger drawer, replace the hardcoded `['personal','work','homelab'].map(...)` with the same project list (use `projects` + `activeProject`, `data-project` attributes) and add the `new-project`/`open-project-manager` items.
- Footer breadcrumb: replace `escapeHtml(activeContext)` with the active project's name — compute `const activeProjectName = activeProject === 'all' ? 'all projects' : (projects.find(p => p.id === activeProject)?.name || 'all projects');` and print `escapeHtml(activeProjectName)`.

- [ ] **Step 3: Run tests**

Run: `node --test tests/frontend/renderShell.test.js` → expect PASS.

- [ ] **Step 4: Commit**

```bash
git add public/js/renderShell.js tests/frontend/renderShell.test.js
git commit -m "$(cat <<'EOF'
feat: render a dynamic Projects nav (All + per-project + new/manage)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Project pickers in the task and library forms

**Files:**
- Modify: `public/js/renderTaskForm.js`
- Modify: `public/js/renderLibrary.js`
- Modify: `tests/frontend/renderTaskForm.test.js`, `tests/frontend/renderLibrary.test.js`

Both forms must render `<select name="project">` populated from active projects, with the option whose value matches the form's current project pre-selected.

- [ ] **Step 1: Update the two render tests**

Read both test files. The render functions will now receive a `projects` array (active projects) and the values object will carry `project` (a project id) rather than `context`. Assert:
- The form renders `<select name="project">` with one `<option value="${project.id}">${project.name}</option>` per provided project.
- The option matching `values.project` is `selected`.
Run both files → expect FAIL.

- [ ] **Step 2: Edit `renderTaskForm.js`**

- Remove `const CONTEXTS = [...]`.
- The render function takes the active `projects` list (thread it through from the caller — `renderTaskForm({ values, projects, … })`). Replace the `<select name="context">…CONTEXTS…</select>` with:
  ```javascript
  <select name="project">${projects.map(project =>
    `<option value="${project.id}"${project.id === values.project ? ' selected' : ''}>${escapeHtml(project.name)}</option>`
  ).join('')}</select>
  ```
  (Use the file's existing `escapeHtml`/option helper if present; otherwise inline as above.)

- [ ] **Step 3: Edit `renderLibrary.js`**

Apply the identical change to the library document form: remove `CONTEXTS`, accept `projects`, render `<select name="project">` with the active projects and pre-select `values.project`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/frontend/renderTaskForm.test.js tests/frontend/renderLibrary.test.js` → expect PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/renderTaskForm.js public/js/renderLibrary.js tests/frontend/renderTaskForm.test.js tests/frontend/renderLibrary.test.js
git commit -m "$(cat <<'EOF'
feat: task and library forms use a project picker

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `taskApi` import/export use `project`

**Files:**
- Modify: `public/js/taskApi.js`
- Modify: `tests/frontend/taskApi.test.js`

- [ ] **Step 1: Update `tests/frontend/taskApi.test.js`**

Read it. Change `importTasks`/`exportTasks` expectations from `context` to `project`: `importTasks({ project, mode, tasks })` posts `{ project, mode, tasks }`; `exportTasks({ project })` sets the `project` query param. Run → expect FAIL.

- [ ] **Step 2: Edit `public/js/taskApi.js`**

- `exportTasks(filters)` already serializes filter entries to query params, so callers passing `{ project }` work — no change needed beyond confirming the caller passes `project`. (If `exportTasks` hardcodes `context`, change it to `project`.)
- `importTasks`: change the signature and body from `context` to `project`:
  ```javascript
  export async function importTasks({ project, mode = 'skip', tasks }) {
    const response = await fetch('/api/tasks/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project, mode, tasks }),
    });
    if (!response.ok) throw new Error('Failed to import tasks');
    return response.json();
  }
  ```

- [ ] **Step 3: Run tests**

Run: `node --test tests/frontend/taskApi.test.js` → expect PASS.

- [ ] **Step 4: Commit**

```bash
git add public/js/taskApi.js tests/frontend/taskApi.test.js
git commit -m "$(cat <<'EOF'
refactor: task import/export client uses project instead of context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Admin panel — project-keyed export/import

**Files:**
- Modify: `public/js/renderAdminPanel.js`
- Modify: `tests/frontend/renderAdminPanel.test.js`

The admin panel currently exports "this context" / "all contexts" and imports into the active context. It becomes project-keyed: export the active project (or all), and import into the active project. It needs the active projects list + the current `activeProject` to label controls.

- [ ] **Step 1: Update `tests/frontend/renderAdminPanel.test.js`**

Read it. Replace context-labelled export/import assertions with project ones: the panel renders an "export this project" control (`data-action="export-project"`) and "export all projects" (`data-action="export-all"`); import targets the active project. Pass `projects` + `activeProject` (with a project name) into the render call and assert the project name appears. Run → expect FAIL.

- [ ] **Step 2: Edit `renderAdminPanel.js`**

- The render function takes `activeProject` + `projects` (thread through from the caller). Replace any "context" wording/labels with the active project's name (compute it from `projects.find(p => p.id === activeProject)?.name`, fallback "all projects").
- Rename the export control from `data-action="export-context"` to `data-action="export-project"` (keep `export-all`). Keep the import control but its label references the active project name.

- [ ] **Step 3: Run tests**

Run: `node --test tests/frontend/renderAdminPanel.test.js` → expect PASS.

- [ ] **Step 4: Commit**

```bash
git add public/js/renderAdminPanel.js tests/frontend/renderAdminPanel.test.js
git commit -m "$(cat <<'EOF'
feat: admin panel export/import are keyed on project

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `main.js` — load projects, project-aware loads/filters/handlers/payloads

**Files:**
- Modify: `public/js/main.js`

This task has no new unit test (main.js is the integration layer, verified by `npm run check` + the full suite staying green + a manual demo smoke). Make these edits:

- [ ] **Step 1: Import the project API and add `loadProjects`**

- Add to the imports: `import { fetchProjects, createProject } from './projectApi.js';` and `import { loadActiveProject, persistActiveProject } from './state.js';` (merge into the existing `state.js` import).
- Add a loader:
  ```javascript
  async function loadProjects() {
    const projects = await fetchProjects('active');
    setState({ projects });
    return projects;
  }
  ```

- [ ] **Step 2: Initialize projects + active selection in `init`**

In `init()` (before the first `loadTasks`/`loadDocuments`), call `await loadProjects();` and set the persisted active project: `setState({ activeProject: loadActiveProject() });`. If the persisted id is not `'all'` and not present in the loaded projects, fall back to `'all'`:
```javascript
  await loadProjects();
  const stored = loadActiveProject();
  const valid = stored === 'all' || state.projects.some((p) => p.id === stored);
  setState({ activeProject: valid ? stored : 'all' });
```

- [ ] **Step 3: Make `loadTasks` / `loadDocuments` project-aware**

In `loadTasks`, change the `fetchTasks` filter:
```javascript
  const tasks = await fetchTasks({
    project: state.activeProject === 'all' ? undefined : state.activeProject,
    archived: isArchiveView(state.activeView) ? true : undefined,
  });
```
In `loadDocuments`, change the `fetchDocuments` filter:
```javascript
  const documents = await fetchDocuments({
    project: state.activeProject === 'all' ? undefined : state.activeProject,
    archived: 'all',
  });
```

- [ ] **Step 4: Update the client-side document filters**

Both occurrences of `state.documents.filter(document => document.context === state.activeContext)` become project-aware: when `activeProject === 'all'` keep all, else filter by `projectId`:
```javascript
  const contextDocuments = state.activeProject === 'all'
    ? state.documents
    : state.documents.filter(document => document.projectId === state.activeProject);
```
(Keep the local variable name to minimize churn; it now means "documents for the current selection".)

- [ ] **Step 5: Replace the `[data-context]` handler with `[data-project]`**

Replace the `app.querySelectorAll('[data-context]')` block with:
```javascript
  app.querySelectorAll('[data-project]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextProject = button.dataset.project;
      if (!nextProject || nextProject === state.activeProject) return;
      setState({ activeProject: nextProject, selectedTaskId: null, selectedDocumentId: null, mobileDetailOpen: false });
      persistActiveProject(nextProject);
      if (state.activeView === 'library') {
        await loadDocuments({ selectedDocumentId: null });
      } else {
        await loadTasks({ selectedTaskId: null });
      }
    });
  });
```
(Preserve whatever post-switch reload logic the original used; the key change is `data-context`→`data-project`, `activeContext`→`activeProject`, and persisting.)

- [ ] **Step 6: Add a `new-project` action handler**

Wherever top-level `data-action` buttons are wired, add a handler for `new-project` that prompts for a name, creates the project, reloads projects, and selects it:
```javascript
  app.querySelectorAll('[data-action="new-project"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const name = window.prompt('New project name');
      if (!name || !name.trim()) return;
      const project = await createProject(name.trim());
      await loadProjects();
      setState({ activeProject: project.id });
      persistActiveProject(project.id);
      if (state.activeView === 'library') await loadDocuments({ selectedDocumentId: null });
      else await loadTasks({ selectedTaskId: null });
    });
  });
```
(`open-project-manager` is wired in Phase 2b — for now it may be a no-op or open nothing; do NOT implement the manager here.)

- [ ] **Step 7: Update create payloads + form rendering calls**

- Task create payload (~line 1604): change `context: String(data.get('context') || state.activeContext)` to `project: String(data.get('project') || defaultProjectId())` where `defaultProjectId()` returns `state.activeProject !== 'all' ? state.activeProject : (state.projects[0]?.id || '')`. Add that small helper near the other helpers.
- After task save, the post-save `activeContext: savedTask.context …` (~1617) becomes `activeProject: savedTask.projectId || state.activeProject` (and persist it).
- Document create payload (~1336): same change to `project`, and post-save (~1350) `activeProject: savedDocument.projectId || state.activeProject`.
- Where the task/library forms are rendered, pass `projects: state.projects` and a `values.project` defaulting to the current selection (`state.activeProject !== 'all' ? state.activeProject : state.projects[0]?.id`). Find the `renderTaskForm(...)` and library form render calls and thread `projects` + the default `project` value through.

- [ ] **Step 8: Update admin export/import wiring**

- `exportAdminTasks(context)` → `exportAdminTasks(project)`; call `exportTasks({ project })`; update the alert text from "context" to "project".
- The `export-context` handler becomes `export-project` and passes `state.activeProject` (or `'all'`).
- The import call `importTasks({ context: state.activeContext, … })` → `importTasks({ project: state.activeProject === 'all' ? (state.projects[0]?.id) : state.activeProject, … })` (import must target a concrete project; if "all" is selected, default to the first active project).
- Pass `activeProject` + `projects` into the admin panel render call.

- [ ] **Step 9: Update the `renderShellHtml` call**

Find where `renderShellHtml({ … activeContext: state.activeContext … })` is called (around the app render) and change it to pass `activeProject: state.activeProject, projects: state.projects` instead of `activeContext`.

- [ ] **Step 10: Verify**

Run: `npm run check` (expect exit 0) and `npm test` (whole suite green).
Then manual smoke:
```bash
npm run demo > /tmp/demo.log 2>&1 &
until curl -sf http://127.0.0.1:3100/healthz >/dev/null; do sleep 0.5; done
echo "open http://127.0.0.1:3100/ and verify: All projects + Personal/Work/Homelab in the nav; switching filters tasks; [+] new project creates and selects; creating a task/doc uses the project picker"
# (leave running for manual check, or:) pkill -f scripts/demo-server.js
```
Confirm there are no `state.activeContext` references left: `grep -n "activeContext" public/js/*.js` → no matches.

- [ ] **Step 11: Commit**

```bash
git add public/js/main.js
git commit -m "$(cat <<'EOF'
feat: wire the app to projects (nav, loads, filters, forms, admin)

Replace activeContext with activeProject end to end: load active
projects on init, filter views by the selected project (or all), switch
projects from the nav, create projects inline, and key task/doc creation
and admin import/export on project.

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full verification

**Files:** none

- [ ] **Step 1: Run the whole suite + check**

Run: `npm test && npm run check`
Expected: all tests pass; `npm run check` exits 0.

- [ ] **Step 2: Confirm no `context`/`activeContext` UI residue**

Run: `grep -rn "activeContext\|data-context\|name=\"context\"" public/js/` → expected: no matches.

- [ ] **Step 3: Manual demo smoke (documented)**

With `npm run demo`, confirm in the browser: nav shows All projects + the three seeded projects; selecting one filters Today/Board/Backlog/Library; "[+] new project" creates and switches to it; the task and document forms show a project picker defaulting to the current selection; admin export/import operate on the selected project.

- [ ] **Step 4: Push**

```bash
git push origin feat/projects-model
```

---

## Self-Review

**1. Spec coverage (Phase 2a portions):**
- `activeContext`→`activeProject` ('all' or id) + persistence → Task 2, used in Tasks 3/7. ✔
- `projectApi` (fetch/create/update/archive/deletePermanent) → Task 1. ✔
- Dynamic Projects nav: All toggle + per-project + new + manage hook → Task 3 + Task 7 handlers. ✔
- Cross-project aggregate when `all`, filter when specific (views + client doc filter + loads) → Task 7. ✔
- Forms use a project picker; create payloads send `project` → Tasks 4 + 7. ✔
- Admin import/export keyed on project → Tasks 5/6/7. ✔
- The project-manager panel (rename/status/reorder/archive/delete) is **out of 2a** — Phase 2b. The `open-project-manager` control is rendered but inert until 2b. ✔ (intentional)

**2. Placeholder scan:** New files (`projectApi.js`, its test) have full code. Existing-file edits are symbol-level against the verified current code, with exact replacement snippets. `main.js` (Task 7) is described as concrete edits with code; no "add handling"-style vagueness. The one deferred item (project manager) is explicitly scoped to 2b, not a placeholder.

**3. Type/name consistency:** `state.activeProject` (id or `'all'`) and `state.projects` are used identically across `renderShell.js`, the forms, the admin panel, and `main.js`. The request field is `project` (id, the API resolves id-or-slug); documents/tasks expose `projectId`. The nav attribute is `data-project`; the new action is `data-action="new-project"` (manager hook `open-project-manager`). `fetchProjects('active')` is the loader call. These names match between the render tasks and the `main.js` wiring task.
