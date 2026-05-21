# Task Detail Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task detail panel's Notes, Checklist, and Activity sections real (data-backed), following the existing Linked-docs feature end-to-end.

**Architecture:** Notes is a new `tasks.notes` field. Checklist gets its own repository/routes/demo/MCP. Activity is auto-logged (lifecycle + status) into `task_activity` with a read route/MCP tool. Each feature spans schema/repo → routes → in-memory demo mirror → API tests → detail-panel UI + `main.js` loaders → MCP tool → tests.

**Tech Stack:** Fastify + `pg` (in-memory demo mirror in `scripts/demo-server.js`), vanilla ES-module frontend (`public/js/`), `@modelcontextprotocol/sdk` MCP server (`mcp/`), `node:test` + `node:assert/strict`. Run tests with `npm test`; syntax-check with `npm run check`.

**Working directory:** `/Users/me/Developer/Playground/TaskBoard/.worktrees/task-detail-enrichment` (branch `feat/task-detail-enrichment`). Run `npm ci` once if `node_modules` is absent.

**Scope refinement vs spec:** Notes is wired through **create / update / read + MCP `update_task` + UI** only. It is intentionally **not** added to the import/export builders for v1 (no existing backups contain notes; this avoids churning the brittle `buildImportTasks`/`buildReplaceProjectTasks` value-array tests). Everything else matches the spec.

---

## File Structure

- `server/schema.sql` — add `notes` column to `tasks` (Task 1).
- `server/tasksRepository.js` — notes field (Task 1); `recordActivity` + `listTaskActivity` (Task 9).
- `server/tasksRoutes.js` — notes in PATCH allow-list (Task 2); activity logging hooks + GET activity route (Task 10).
- `server/checklistRepository.js` *(new)* — checklist query builders + factory (Task 4).
- `server/checklistRoutes.js` *(new)* — checklist CRUD routes (Task 5).
- `server/index.js` — register checklist routes + decorate (Task 5).
- `scripts/demo-server.js` — notes seed (Task 2); checklist mirror (Task 6); activity mirror (Task 11).
- `public/js/taskApi.js` — checklist + activity client helpers (Tasks 7, 12).
- `public/js/renderTaskDetail.js` — `renderNotes` (Task 3), `renderChecklist` (Task 7), `renderActivity` (Task 12).
- `public/js/main.js` — notes save (Task 3); checklist loaders+handlers (Task 7); activity loader (Task 12).
- `mcp/moomoraClient.js`, `mcp/tools/tasks.js` — notes arg on `update_task` (Task 2); checklist client+tools (Task 8); activity client+tool (Task 13).
- `mcp/server.js` — register new MCP tools (Tasks 8, 13).
- Tests under `tests/backend`, `tests/frontend`, `tests/mcp`.

---

# FEATURE 1 — NOTES

## Task 1: Notes field in schema + repository

**Files:** Modify `server/schema.sql`, `server/tasksRepository.js`, `tests/backend/tasksRepository.test.js`

- [ ] **Step 1: Update tests in `tests/backend/tasksRepository.test.js`**

In the test `normalizeTaskRow maps database fields to API task fields`, add `notes` to BOTH the input row and the expected object:
```js
  const task = normalizeTaskRow({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Back up CloudNativePG',
    description: 'Verify backup schedule',
    notes: 'Confirm the off-site copy completed.',
    priority: 'high',
    status: 'planned',
    project_id: PROJECT_ID,
    due_date: '2026-05-11',
    sort_order: 2,
    archived_at: null,
    created_at: '2026-05-10T10:00:00.000Z',
    updated_at: '2026-05-10T10:00:00.000Z',
  });

  assert.deepEqual(task, {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Back up CloudNativePG',
    description: 'Verify backup schedule',
    notes: 'Confirm the off-site copy completed.',
    priority: 'high',
    status: 'planned',
    projectId: PROJECT_ID,
    dueDate: '2026-05-11',
    sortOrder: 2,
    archivedAt: null,
    createdAt: '2026-05-10T10:00:00.000Z',
    updatedAt: '2026-05-10T10:00:00.000Z',
  });
```

In the test `buildCreateTask returns parameterized insert query`, change the values-length assertion from `7` to `8`:
```js
  assert.equal(query.values.length, 8);
```

Add a new test at the end of the file:
```js
test('buildUpdateTask maps notes to the notes column', () => {
  const q = buildUpdateTask('11111111-1111-4111-8111-111111111111', { notes: 'Handoff: paused on step 3.' });
  assert.match(q.text, /notes = \$2/);
  assert.deepEqual(q.values, ['11111111-1111-4111-8111-111111111111', 'Handoff: paused on step 3.']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `normalizeTaskRow` lacks `notes`, `buildCreateTask` values length is 7, `buildUpdateTask` doesn't map `notes`.

- [ ] **Step 3: Add the column in `server/schema.sql`**

In the `create table if not exists tasks (...)` block, add a `notes` column immediately after the `description` line:
```sql
  description text not null default '',
  notes text not null default '',
```

- [ ] **Step 4: Wire `notes` through `server/tasksRepository.js`**

Add `'notes'` to `ALLOWED_CREATE_FIELDS` (append at the end):
```js
const ALLOWED_CREATE_FIELDS = ['title', 'description', 'priority', 'status', 'projectId', 'dueDate', 'sortOrder', 'notes'];
```

Add `notes` to `UPDATE_COLUMN_MAP`:
```js
  notes: 'notes',
```

Add `notes` to `normalizeTaskRow`'s returned object (after `description`):
```js
    notes: row.notes,
```

Update `buildCreateTask` to insert the `notes` column with an 8th placeholder:
```js
export function buildCreateTask(task) {
  return {
    text: `
      insert into tasks (title, description, priority, status, project_id, due_date, sort_order, notes)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
    `,
    values: ALLOWED_CREATE_FIELDS.map(field => task[field] ?? null),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/schema.sql server/tasksRepository.js tests/backend/tasksRepository.test.js
git commit -m "$(cat <<'EOF'
feat: add notes field to the task model

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 2: Notes in route allow-list, demo, and MCP update_task

**Files:** Modify `server/tasksRoutes.js`, `scripts/demo-server.js`, `mcp/tools/tasks.js`, `tests/backend/tasksRoutes.test.js`

- [ ] **Step 1: Write the failing route test**

Add to `tests/backend/tasksRoutes.test.js` (it builds an app with an injected fake repository — match the existing test setup in that file; if the file injects a stub repo, assert the patch reaches it). Add:
```js
test('PATCH /api/tasks/:id accepts a notes field', async () => {
  const app = await buildTestApp(); // use whatever helper the file already uses
  const created = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'N', project: SEED_PROJECT, priority: 'low', status: 'planned' } });
  const id = created.json().id;
  const res = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { notes: 'remember to rotate creds' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().notes, 'remember to rotate creds');
  await app.close();
});
```
(Adapt `buildTestApp`/`SEED_PROJECT` to the helpers already present in `tasksRoutes.test.js`. If the suite uses the in-memory demo repositories, `notes` must already round-trip after Task 1 + the demo change below.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `notes` is stripped by the PATCH allow-list.

- [ ] **Step 3: Add `notes` to the PATCH allow-list in `server/tasksRoutes.js`**

```js
const PATCH_FIELDS = ['title', 'description', 'notes', 'priority', 'status', 'project', 'dueDate', 'sortOrder'];
```

- [ ] **Step 4: Seed notes in the demo task factory (`scripts/demo-server.js`)**

In the `createTask(seed)` factory object, add a `notes` property mirroring the others:
```js
    notes: seed.notes || '',
```
(The demo `updateTask` already does `Object.assign(task, fields, …)`, so PATCHing `notes` works.)

- [ ] **Step 5: Add the `notes` arg to MCP `update_task` (`mcp/tools/tasks.js`)**

In the `update_task` tool's `inputSchema`, add (alongside the other optional task fields):
```js
        notes: z.string().optional().describe('Free-form operational notes / handoff context for the task.'),
```
Confirm the tool already forwards arbitrary task fields to `PATCH /api/tasks/:id`; if it maps fields explicitly, add `notes` to that mapping.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test` then `npm run check`
Expected: PASS / success.

- [ ] **Step 7: Commit**

```bash
git add server/tasksRoutes.js scripts/demo-server.js mcp/tools/tasks.js tests/backend/tasksRoutes.test.js
git commit -m "$(cat <<'EOF'
feat: allow editing task notes via the API and MCP update_task

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 3: Notes editor in the detail panel

**Files:** Modify `public/js/renderTaskDetail.js`, `public/js/main.js`, `tests/frontend/renderTaskDetail.test.js`

- [ ] **Step 1: Write the failing render test**

Add to `tests/frontend/renderTaskDetail.test.js`:
```js
test('renderTaskDetailHtml renders an editable notes textarea with the task notes', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low', notes: 'paused on step 3' },
    {},
  );
  assert.match(html, /<textarea[^>]*data-task-notes[^>]*>paused on step 3<\/textarea>/);
  assert.match(html, /data-action="save-task-notes"/);
});

test('renderTaskDetailHtml renders notes read-only when readOnly', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'completed', priority: 'low', notes: 'archived note' },
    { readOnly: true },
  );
  assert.doesNotMatch(html, /data-action="save-task-notes"/);
  assert.match(html, /archived note/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — no `data-task-notes` / `save-task-notes`.

- [ ] **Step 3: Add `renderNotes` and use it in `public/js/renderTaskDetail.js`**

Add this function (near `renderLinkedDocs`):
```js
function renderNotes(task, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const notes = task.notes || '';
  if (readOnly) {
    return `
      <section class="detail-block">
        <h3>Notes</h3>
        <p>${notes ? escapeHtml(notes) : 'No notes.'}</p>
      </section>`;
  }
  return `
      <section class="detail-block">
        <div class="detail-block__head">
          <h3>Notes</h3>
          <button class="bracket-button bracket-button--quiet" type="button" data-action="save-task-notes">[s] save</button>
        </div>
        <textarea class="detail-notes" data-task-notes rows="4" placeholder="Operational notes and handoff context…">${escapeHtml(notes)}</textarea>
      </section>`;
}
```

In `renderTaskDetailHtml`, replace the Notes placeholder in the `detail-body` line — change:
```js
${renderDetailBlock('Notes', 'Operational notes and handoff context will appear here.')}
```
to:
```js
${renderNotes(task, options)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire the save action in `public/js/main.js`**

In `renderWorkspace()` (the function that binds detail-panel actions — where `[data-action="unlink-document"]` etc. are bound), add a handler after the existing detail bindings:
```js
  workspace.querySelector('[data-action="save-task-notes"]')?.addEventListener('click', async () => {
    const textarea = workspace.querySelector('[data-task-notes]');
    if (!textarea) return;
    const task = selectedTask();
    if (!task) return;
    try {
      const updated = await updateTask(task.id, { notes: textarea.value });
      setState({ tasks: state.tasks.map(t => (t.id === updated.id ? updated : t)) });
      renderWorkspace();
    } catch {
      window.alert('Could not save notes.');
    }
  });
```
(`updateTask` and `selectedTask` are already imported/defined in `main.js`. Match the exact import name — `updateTask` from `./taskApi.js`.)

- [ ] **Step 6: Verify**

Run: `npm test` (PASS) and `npm run check` (success).

- [ ] **Step 7: Commit**

```bash
git add public/js/renderTaskDetail.js public/js/main.js tests/frontend/renderTaskDetail.test.js
git commit -m "$(cat <<'EOF'
feat: edit task notes inline in the detail panel

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

# FEATURE 2 — CHECKLIST

## Task 4: Checklist repository

**Files:** Create `server/checklistRepository.js`, `tests/backend/checklistRepository.test.js`

- [ ] **Step 1: Write the failing tests** — create `tests/backend/checklistRepository.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeChecklistRow,
  buildListChecklist,
  buildAddChecklistItem,
  buildSetChecklistItemCompleted,
  buildDeleteChecklistItem,
} from '../../server/checklistRepository.js';

const TASK = '11111111-1111-4111-8111-111111111111';

test('normalizeChecklistRow maps db columns to API shape', () => {
  assert.deepEqual(
    normalizeChecklistRow({ id: 'a', task_id: TASK, label: 'Step 1', completed: false, sort_order: 0, created_at: 'c', updated_at: 'u' }),
    { id: 'a', taskId: TASK, label: 'Step 1', completed: false, sortOrder: 0, createdAt: 'c', updatedAt: 'u' },
  );
});

test('buildListChecklist orders by sort_order', () => {
  const q = buildListChecklist(TASK);
  assert.match(q.text, /from task_checklist_items/);
  assert.match(q.text, /where task_id = \$1/);
  assert.match(q.text, /order by sort_order/);
  assert.deepEqual(q.values, [TASK]);
});

test('buildAddChecklistItem appends with max\+1 sort_order', () => {
  const q = buildAddChecklistItem(TASK, 'New step');
  assert.match(q.text, /insert into task_checklist_items/);
  assert.match(q.text, /coalesce\(max\(sort_order\), -1\) \+ 1/);
  assert.deepEqual(q.values, [TASK, 'New step']);
});

test('buildSetChecklistItemCompleted updates completed + updated_at', () => {
  const q = buildSetChecklistItemCompleted('item1', true);
  assert.match(q.text, /update task_checklist_items/);
  assert.match(q.text, /set completed = \$2, updated_at = now\(\)/);
  assert.match(q.text, /where id = \$1/);
  assert.deepEqual(q.values, ['item1', true]);
});

test('buildDeleteChecklistItem deletes by id', () => {
  const q = buildDeleteChecklistItem('item1');
  assert.match(q.text, /delete from task_checklist_items/);
  assert.match(q.text, /where id = \$1/);
  assert.deepEqual(q.values, ['item1']);
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npm test` → module not found.

- [ ] **Step 3: Implement `server/checklistRepository.js`:**
```js
export function normalizeChecklistRow(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    label: row.label,
    completed: row.completed,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildListChecklist(taskId) {
  return {
    text: `select * from task_checklist_items where task_id = $1 order by sort_order, created_at`,
    values: [taskId],
  };
}

export function buildAddChecklistItem(taskId, label) {
  return {
    text: `
      insert into task_checklist_items (task_id, label, sort_order)
      values ($1, $2, (select coalesce(max(sort_order), -1) + 1 from task_checklist_items where task_id = $1))
      returning *
    `,
    values: [taskId, label],
  };
}

export function buildSetChecklistItemCompleted(itemId, completed) {
  return {
    text: `update task_checklist_items set completed = $2, updated_at = now() where id = $1 returning *`,
    values: [itemId, completed],
  };
}

export function buildDeleteChecklistItem(itemId) {
  return {
    text: `delete from task_checklist_items where id = $1 returning *`,
    values: [itemId],
  };
}

export function createChecklistRepository(db) {
  return {
    async listChecklist(taskId) {
      const q = buildListChecklist(taskId);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeChecklistRow);
    },
    async addChecklistItem(taskId, label) {
      const q = buildAddChecklistItem(taskId, label);
      const result = await db.query(q.text, q.values);
      return normalizeChecklistRow(result.rows[0]);
    },
    async setChecklistItemCompleted(itemId, completed) {
      const q = buildSetChecklistItemCompleted(itemId, completed);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeChecklistRow(result.rows[0]) : null;
    },
    async deleteChecklistItem(itemId) {
      const q = buildDeleteChecklistItem(itemId);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeChecklistRow(result.rows[0]) : null;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add server/checklistRepository.js tests/backend/checklistRepository.test.js
git commit -m "$(cat <<'EOF'
feat: add task checklist repository

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 5: Checklist routes + registration

**Files:** Create `server/checklistRoutes.js`; Modify `server/index.js`, `tests/backend/checklistRoutes.test.js`

- [ ] **Step 1: Write failing route tests** — create `tests/backend/checklistRoutes.test.js`, modelled on `tests/backend/tasksRoutes.test.js`'s app-build helper (use a fake `checklistRepository` injected via `buildApp({ skipDb: true, checklistRepository, tasksRepository })`, mirroring how the existing route tests inject repositories). Cover: GET returns items; POST with blank label → 400; POST valid → 201 returns item; PATCH toggles completed; DELETE returns 204/removed; invalid task id → 400.
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const TASK = '11111111-1111-4111-8111-111111111111';
function fakeChecklistRepo() {
  let items = [];
  return {
    async listChecklist() { return items; },
    async addChecklistItem(taskId, label) { const it = { id: 'i' + (items.length + 1), taskId, label, completed: false, sortOrder: items.length }; items.push(it); return it; },
    async setChecklistItemCompleted(id, completed) { const it = items.find(x => x.id === id); if (!it) return null; it.completed = completed; return it; },
    async deleteChecklistItem(id) { const i = items.findIndex(x => x.id === id); if (i < 0) return null; return items.splice(i, 1)[0]; },
    _items: () => items,
  };
}
async function appWith(repo) { return buildApp({ skipDb: true, checklistRepository: repo, tasksRepository: {}, libraryRepository: {}, projectsRepository: {} }); }

test('POST /api/tasks/:id/checklist rejects a blank label', async () => {
  const app = await appWith(fakeChecklistRepo());
  const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { label: '  ' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('checklist add/list/toggle/delete round-trip', async () => {
  const app = await appWith(fakeChecklistRepo());
  const add = await app.inject({ method: 'POST', url: `/api/tasks/${TASK}/checklist`, payload: { label: 'Step 1' } });
  assert.equal(add.statusCode, 201);
  const itemId = add.json().id;
  const list = await app.inject({ method: 'GET', url: `/api/tasks/${TASK}/checklist` });
  assert.equal(list.json().length, 1);
  const patch = await app.inject({ method: 'PATCH', url: `/api/tasks/${TASK}/checklist/${itemId}`, payload: { completed: true } });
  assert.equal(patch.json().completed, true);
  const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${TASK}/checklist/${itemId}` });
  assert.equal(del.statusCode, 204);
  await app.close();
});

test('GET /api/tasks/:id/checklist rejects an invalid task id', async () => {
  const app = await appWith(fakeChecklistRepo());
  const res = await app.inject({ method: 'GET', url: '/api/tasks/not-a-uuid/checklist' });
  assert.equal(res.statusCode, 400);
  await app.close();
});
```
(If the existing `tasksRoutes.test.js` uses a different injection helper, follow that file's exact pattern instead.)

- [ ] **Step 2: Run tests to verify they fail** — `npm test` → routes 404 / repo undefined.

- [ ] **Step 3: Implement `server/checklistRoutes.js`:**
```js
import { createChecklistRepository } from './checklistRepository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export async function registerChecklistRoutes(app, options = {}) {
  const repository = options.checklistRepository || app.checklistRepository || createChecklistRepository(app.db);

  app.get('/api/tasks/:id/checklist', async (request, reply) => {
    if (!isUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    return repository.listChecklist(request.params.id);
  });

  app.post('/api/tasks/:id/checklist', async (request, reply) => {
    if (!isUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    const label = typeof request.body?.label === 'string' ? request.body.label.trim() : '';
    if (!label) { reply.code(400); return { message: 'label is required' }; }
    reply.code(201);
    return repository.addChecklistItem(request.params.id, label);
  });

  app.patch('/api/tasks/:taskId/checklist/:itemId', async (request, reply) => {
    if (!isUuid(request.params.taskId) || !isUuid(request.params.itemId)) { reply.code(400); return { message: 'id is invalid' }; }
    if (typeof request.body?.completed !== 'boolean') { reply.code(400); return { message: 'completed must be a boolean' }; }
    const item = await repository.setChecklistItemCompleted(request.params.itemId, request.body.completed);
    if (!item) { reply.code(404); return { message: 'checklist item not found' }; }
    return item;
  });

  app.delete('/api/tasks/:taskId/checklist/:itemId', async (request, reply) => {
    if (!isUuid(request.params.taskId) || !isUuid(request.params.itemId)) { reply.code(400); return { message: 'id is invalid' }; }
    const removed = await repository.deleteChecklistItem(request.params.itemId);
    if (!removed) { reply.code(404); return { message: 'checklist item not found' }; }
    reply.code(204);
    return null;
  });
}
```

- [ ] **Step 4: Register in `server/index.js`** — add the import, decorate, and registration alongside the others:
```js
import { registerChecklistRoutes } from './checklistRoutes.js';
```
```js
  app.decorate('checklistRepository', options.checklistRepository || null);
```
```js
  await registerChecklistRoutes(app, options);
```
(Place the decorate next to the other `app.decorate(...Repository...)` lines and the register call next to the other `await register...Routes` calls.)

- [ ] **Step 5: Run tests to verify they pass** — `npm test` → PASS; `npm run check` → success.

- [ ] **Step 6: Commit**
```bash
git add server/checklistRoutes.js server/index.js tests/backend/checklistRoutes.test.js
git commit -m "$(cat <<'EOF'
feat: add task checklist CRUD routes

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 6: Checklist demo mirror

**Files:** Modify `scripts/demo-server.js`

- [ ] **Step 1: Add an in-memory checklist store + repository** near the other in-memory repositories. Use the existing seeded task ids (the demo creates tasks with `createTask`; capture the "Back up CNPG" task's id to seed two items):
```js
function createMemoryChecklistRepository() {
  const items = [];
  let seq = 0;
  const nextId = () => `cl-${++seq}`;
  return {
    async listChecklist(taskId) {
      return items.filter(i => i.taskId === taskId).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async addChecklistItem(taskId, label) {
      const sortOrder = items.filter(i => i.taskId === taskId).reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;
      const item = { id: nextId(), taskId, label, completed: false, sortOrder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      items.push(item);
      return item;
    },
    async setChecklistItemCompleted(itemId, completed) {
      const it = items.find(i => i.id === itemId);
      if (!it) return null;
      it.completed = completed; it.updatedAt = new Date().toISOString();
      return it;
    },
    async deleteChecklistItem(itemId) {
      const i = items.findIndex(x => x.id === itemId);
      if (i < 0) return null;
      return items.splice(i, 1)[0];
    },
    _seed(taskId, labels) { for (const l of labels) { const sortOrder = items.filter(i => i.taskId === taskId).length; items.push({ id: nextId(), taskId, label: l, completed: false, sortOrder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); } },
  };
}
```

- [ ] **Step 2: Wire it into `buildApp`** — pass it where the other repositories are passed:
```js
  checklistRepository: createMemoryChecklistRepository(),
```
If the demo seeds checklist items, do so after the tasks are created (call `_seed(<task id>, ['Verify backup CR', 'Confirm object-store creds'])`). If wiring the seed to a specific task id is awkward in the demo's structure, skip seeding — an empty checklist with a working add box is acceptable.

- [ ] **Step 3: Verify** — `npm run check` (success). Manually: `npm run demo`, then `curl -s -XPOST localhost:3100/api/tasks/<some task id>/checklist -H 'content-type: application/json' -d '{"label":"x"}'` returns 201; `curl localhost:3100/api/tasks/<id>/checklist` lists it. Stop the demo.

- [ ] **Step 4: Commit**
```bash
git add scripts/demo-server.js
git commit -m "$(cat <<'EOF'
feat: mirror task checklist in the in-memory demo server

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 7: Checklist UI + client + wiring

**Files:** Modify `public/js/taskApi.js`, `public/js/renderTaskDetail.js`, `public/js/main.js`, `tests/frontend/renderTaskDetail.test.js`

- [ ] **Step 1: Add the failing render test** to `tests/frontend/renderTaskDetail.test.js`:
```js
test('renderTaskDetailHtml renders checklist items with a done count and controls', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low' },
    { checklistItems: [
      { id: 'c1', label: 'Step one', completed: true },
      { id: 'c2', label: 'Step two', completed: false },
    ] },
  );
  assert.match(html, /Checklist/);
  assert.match(html, /1\/2/);
  assert.match(html, /data-action="toggle-checklist-item"[^>]*data-item-id="c1"/);
  assert.match(html, /data-action="delete-checklist-item"[^>]*data-item-id="c2"/);
  assert.match(html, /data-action="add-checklist-item"/);
  assert.match(html, /Step one/);
});

test('renderTaskDetailHtml checklist is read-only with no controls when readOnly', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'completed', priority: 'low' },
    { readOnly: true, checklistItems: [{ id: 'c1', label: 'Done step', completed: true }] },
  );
  assert.match(html, /Done step/);
  assert.doesNotMatch(html, /data-action="toggle-checklist-item"/);
  assert.doesNotMatch(html, /data-action="add-checklist-item"/);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm test` → FAIL.

- [ ] **Step 3: Add `renderChecklist` to `public/js/renderTaskDetail.js`:**
```js
function renderChecklist(items = [], options = {}) {
  const readOnly = Boolean(options.readOnly);
  const done = items.filter(i => i.completed).length;
  const rows = items.length
    ? items.map(item => `
        <div class="checklist-item${item.completed ? ' is-done' : ''}" data-checklist-id="${escapeHtml(item.id)}">
          ${readOnly
            ? `<span class="checklist-item__mark">${item.completed ? '[x]' : '[ ]'}</span>`
            : `<button class="checklist-item__toggle bracket-button bracket-button--quiet" type="button" data-action="toggle-checklist-item" data-item-id="${escapeHtml(item.id)}" data-completed="${item.completed ? 'true' : 'false'}" aria-label="Toggle">${item.completed ? '[x]' : '[ ]'}</button>`}
          <span class="checklist-item__label">${escapeHtml(item.label || '')}</span>
          ${readOnly ? '' : `<button class="checklist-item__delete bracket-button bracket-button--quiet" type="button" data-action="delete-checklist-item" data-item-id="${escapeHtml(item.id)}" aria-label="Delete">[x]</button>`}
        </div>`).join('')
    : '<p class="checklist__empty">No checklist items.</p>';
  const adder = readOnly ? '' : `
        <div class="checklist-add">
          <input type="text" class="checklist-add__input" data-checklist-new placeholder="Add a checklist item" autocomplete="off">
          <button class="bracket-button bracket-button--quiet" type="button" data-action="add-checklist-item">[+] add</button>
        </div>`;
  return `
      <section class="detail-block">
        <div class="detail-block__head">
          <h3>Checklist</h3>
          <span class="detail-block__count">${done}/${items.length}</span>
        </div>
        <div class="checklist">${rows}</div>${adder}
      </section>`;
}
```
Replace the Checklist placeholder in `renderTaskDetailHtml`'s `detail-body` (`${renderDetailBlock('Checklist', …)}`) with `${renderChecklist(options.checklistItems, options)}`.

- [ ] **Step 4: Run test to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Add client helpers to `public/js/taskApi.js`** (after `unlinkTaskDocument`):
```js
export async function fetchTaskChecklist(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/checklist`);
  if (!response.ok) throw new Error('Failed to load checklist');
  return response.json();
}

export async function addChecklistItem(taskId, label) {
  const response = await fetch(`/api/tasks/${taskId}/checklist`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new Error('Failed to add checklist item');
  return response.json();
}

export async function setChecklistItem(taskId, itemId, completed) {
  const response = await fetch(`/api/tasks/${taskId}/checklist/${itemId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed }),
  });
  if (!response.ok) throw new Error('Failed to update checklist item');
  return response.json();
}

export async function deleteChecklistItem(taskId, itemId) {
  const response = await fetch(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete checklist item');
}
```

- [ ] **Step 6: Wire state + handlers in `public/js/main.js`:**
  - Add `fetchTaskChecklist, addChecklistItem, setChecklistItem, deleteChecklistItem` to the `./taskApi.js` import.
  - Add `taskChecklist: []` to the import-less state usage — i.e. ensure `state.taskChecklist` exists (add to `public/js/state.js` initial state: `taskChecklist: [],`).
  - Add a loader mirroring `loadTaskDocuments`:
```js
async function loadTaskChecklist(taskId) {
  if (!taskId) { setState({ taskChecklist: [] }); return; }
  const requestedTaskId = taskId;
  try {
    const items = await fetchTaskChecklist(taskId);
    if (state.selectedTaskId === requestedTaskId) setState({ taskChecklist: items });
  } catch {
    if (state.selectedTaskId === requestedTaskId) setState({ taskChecklist: [] });
  }
}
```
  - In the task-select handler (where `await loadTaskDocuments(row.dataset.taskId)` is called), also `await loadTaskChecklist(row.dataset.taskId);`.
  - In the `renderTaskDetailHtml(...)` call inside `renderWorkspace()`, add `checklistItems: state.taskChecklist` to the options object.
  - Bind handlers in `renderWorkspace()` (near the notes handler):
```js
  workspace.querySelector('[data-action="add-checklist-item"]')?.addEventListener('click', async () => {
    const input = workspace.querySelector('[data-checklist-new]');
    const label = input?.value.trim();
    if (!label) return;
    await addChecklistItem(state.selectedTaskId, label);
    await loadTaskChecklist(state.selectedTaskId);
    renderWorkspace();
  });
  workspace.querySelectorAll('[data-action="toggle-checklist-item"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await setChecklistItem(state.selectedTaskId, btn.dataset.itemId, btn.dataset.completed !== 'true');
      await loadTaskChecklist(state.selectedTaskId);
      renderWorkspace();
    });
  });
  workspace.querySelectorAll('[data-action="delete-checklist-item"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteChecklistItem(state.selectedTaskId, btn.dataset.itemId);
      await loadTaskChecklist(state.selectedTaskId);
      renderWorkspace();
    });
  });
```

- [ ] **Step 7: Add minimal CSS** to `public/styles.css` (near the linked-docs styles): a `.checklist`, `.checklist-item` (flex row, gap), `.checklist-item.is-done .checklist-item__label { text-decoration: line-through; color: var(--text-dim); }`, `.checklist-item__label { flex: 1; }`, `.checklist-add { display: flex; gap: 8px; margin-top: 8px; }`, `.checklist-add__input { flex: 1; }`, `.detail-block__count { font-family: var(--font-mono); color: var(--accent-amber); font-size: 0.78rem; }` — using existing tokens.

- [ ] **Step 8: Verify** — `npm test` (PASS), `npm run check` (success), CSS braces balanced (`node -e "..."` brace check as used elsewhere).

- [ ] **Step 9: Commit**
```bash
git add public/js/taskApi.js public/js/renderTaskDetail.js public/js/main.js public/js/state.js public/styles.css tests/frontend/renderTaskDetail.test.js
git commit -m "$(cat <<'EOF'
feat: checklist UI in the task detail panel

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 8: Checklist MCP tools

**Files:** Modify `mcp/moomoraClient.js`, create `mcp/tools/checklist.js`; Modify `mcp/server.js`, `tests/mcp/checklistTools.test.js`

- [ ] **Step 1: Write failing tests** — create `tests/mcp/checklistTools.test.js` mirroring `tests/mcp/tasksTools.test.js` (it constructs the tools with a fake client and asserts each tool's name, that it calls the right client method, and maps results through `okResult`). Cover the four tools: `list_task_checklist`, `add_checklist_item`, `set_checklist_item`, `delete_checklist_item`.

- [ ] **Step 2: Run tests to verify they fail** — `npm test`.

- [ ] **Step 3: Add client methods to `mcp/moomoraClient.js`** (mirroring the existing `listTaskDocuments`/`linkTaskDocument` methods):
```js
    listChecklist: (taskId) => request(`/api/tasks/${taskId}/checklist`),
    addChecklistItem: (taskId, label) => request(`/api/tasks/${taskId}/checklist`, { method: 'POST', body: { label } }),
    setChecklistItem: (taskId, itemId, completed) => request(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'PATCH', body: { completed } }),
    deleteChecklistItem: (taskId, itemId) => request(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' }),
```
(Match the exact `request(...)` helper signature already used in `moomoraClient.js`.)

- [ ] **Step 4: Implement `mcp/tools/checklist.js`** mirroring `mcp/tools/tasks.js` structure (each tool: `name`, `title`, `description`, `inputSchema` of zod fields, `annotations` for read tools, `handler` wrapped in the project's `withErrorHandling`/`okResult` helpers). Tools:
  - `list_task_checklist` { taskId } (readOnlyHint)
  - `add_checklist_item` { taskId, label }
  - `set_checklist_item` { taskId, itemId, completed }
  - `delete_checklist_item` { taskId, itemId }

- [ ] **Step 5: Register in `mcp/server.js`** — import `createChecklistTools` and spread `...createChecklistTools(apiClient)` into the `tools` array.

- [ ] **Step 6: Run tests to verify they pass** — `npm test`, `npm run check`.

- [ ] **Step 7: Commit**
```bash
git add mcp/moomoraClient.js mcp/tools/checklist.js mcp/server.js tests/mcp/checklistTools.test.js
git commit -m "$(cat <<'EOF'
feat: expose task checklist via MCP tools

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

# FEATURE 3 — ACTIVITY

## Task 9: Activity repository methods

**Files:** Modify `server/tasksRepository.js`, `tests/backend/tasksRepository.test.js`

- [ ] **Step 1: Write failing tests** — add to `tests/backend/tasksRepository.test.js`:
```js
test('buildRecordActivity inserts an event', () => {
  const q = buildRecordActivity(PROJECT_ID, 'status', 'Status → in-progress');
  assert.match(q.text, /insert into task_activity/);
  assert.match(q.text, /\(task_id, event_type, message\)/);
  assert.deepEqual(q.values, [PROJECT_ID, 'status', 'Status → in-progress']);
});

test('buildListTaskActivity orders newest first', () => {
  const q = buildListTaskActivity(PROJECT_ID);
  assert.match(q.text, /from task_activity/);
  assert.match(q.text, /where task_id = \$1/);
  assert.match(q.text, /order by created_at desc/);
  assert.deepEqual(q.values, [PROJECT_ID]);
});

test('normalizeActivityRow maps columns', () => {
  assert.deepEqual(
    normalizeActivityRow({ id: 'a', task_id: PROJECT_ID, event_type: 'created', message: 'Task created', created_at: 'c' }),
    { id: 'a', taskId: PROJECT_ID, eventType: 'created', message: 'Task created', createdAt: 'c' },
  );
});
```
(Add `buildRecordActivity, buildListTaskActivity, normalizeActivityRow` to the file's imports from `../../server/tasksRepository.js`.)

- [ ] **Step 2: Run tests to verify they fail** — `npm test`.

- [ ] **Step 3: Implement in `server/tasksRepository.js`** (add these exports near the other build functions):
```js
export function normalizeActivityRow(row) {
  return { id: row.id, taskId: row.task_id, eventType: row.event_type, message: row.message, createdAt: row.created_at };
}

export function buildRecordActivity(taskId, eventType, message) {
  return {
    text: `insert into task_activity (task_id, event_type, message) values ($1, $2, $3) returning *`,
    values: [taskId, eventType, message],
  };
}

export function buildListTaskActivity(taskId) {
  return {
    text: `select * from task_activity where task_id = $1 order by created_at desc, id desc`,
    values: [taskId],
  };
}

export function buildGetTask(id) {
  return { text: `select * from tasks where id = $1 limit 1`, values: [id] };
}
```
Add three methods to the object returned by `createTasksRepository(db)` (`getTask` is needed so the route layer can detect an actual status change before logging activity):
```js
    async getTask(id) {
      const q = buildGetTask(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
    },
    async recordActivity(taskId, eventType, message) {
      const q = buildRecordActivity(taskId, eventType, message);
      const result = await db.query(q.text, q.values);
      return normalizeActivityRow(result.rows[0]);
    },
    async listTaskActivity(taskId) {
      const q = buildListTaskActivity(taskId);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeActivityRow);
    },
```
Also add a `buildGetTask` test to `tests/backend/tasksRepository.test.js` in Step 1 of this task:
```js
test('buildGetTask selects one task by id', () => {
  const q = buildGetTask(PROJECT_ID);
  assert.match(q.text, /select \* from tasks where id = \$1/);
  assert.deepEqual(q.values, [PROJECT_ID]);
});
```
(Add `buildGetTask` to the imports.)

- [ ] **Step 4: Run tests to verify they pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add server/tasksRepository.js tests/backend/tasksRepository.test.js
git commit -m "$(cat <<'EOF'
feat: add task activity repository methods

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 10: Activity logging hooks + read route

**Files:** Modify `server/tasksRoutes.js`, `tests/backend/tasksRoutes.test.js`

- [ ] **Step 1: Write failing tests** — add to `tests/backend/tasksRoutes.test.js`: after creating a task, `GET /api/tasks/:id/activity` returns at least one `created` event; after a PATCH that changes status, the activity list contains a `status` event with message `Status → <new>`; archive adds an `archived` event. (Use the same app/repo helper as the file; if it uses the in-memory demo repos, the demo mirror from Task 11 must be in place — sequence Task 11 before running these, or use a fake repo exposing `recordActivity`/`listTaskActivity`.)

- [ ] **Step 2: Run tests to verify they fail** — `npm test`.

- [ ] **Step 3: Add a logging helper and GET route in `server/tasksRoutes.js`.** Near the top of `registerTasksRoutes` (after `repository` is defined), add:
```js
  const logActivity = async (taskId, eventType, message) => {
    try { if (repository.recordActivity) await repository.recordActivity(taskId, eventType, message); }
    catch { /* activity logging is best-effort; never fail the mutation */ }
  };
```
GET route (place near the other `/api/tasks/:id/...` routes):
```js
  app.get('/api/tasks/:id/activity', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    return repository.listTaskActivity ? repository.listTaskActivity(request.params.id) : [];
  });
```
Hook the mutations (always compare the prior status so we log a `status` event only on a real change — the edit form sends `status` on every save):
- **Create** — in `POST /api/tasks`, change `return repository.createTask(...)` to capture and log:
```js
    const created = await repository.createTask(cleanTaskPayload(request.body));
    await logActivity(created.id, 'created', 'Task created');
    return created;
```
- **Update** — in `PATCH /api/tasks/:id`, read the prior status before updating, then log only if it changed:
```js
    const prior = await repository.getTask(request.params.id);
    const task = await repository.updateTask(request.params.id, fields);
    if (!task) {
      reply.code(404);
      return { message: 'task not found' };
    }
    if (prior && prior.status !== task.status) {
      await logActivity(task.id, 'status', `Status → ${task.status}`);
    }
    return task;
```
  (Replace the existing `const task = await repository.updateTask(...)` / 404 / `return task` block with the above.)
- **Reorder (board drag)** — in `PATCH /api/tasks/reorder`, capture priors for the affected ids, then log status changes only:
```js
    const payload = cleanTaskReorderPayload(request.body);
    const priors = new Map();
    for (const t of payload.tasks) {
      const p = await repository.getTask(t.id);
      if (p) priors.set(t.id, p.status);
    }
    const updated = await repository.reorderTasks(payload);
    for (const t of updated) {
      if (priors.get(t.id) !== t.status) {
        await logActivity(t.id, 'status', `Status → ${t.status}`);
      }
    }
    return updated;
```
  (`cleanTaskReorderPayload(request.body)` returns `{ tasks: [...] }` — adapt to its real shape; the existing handler calls `repository.reorderTasks(cleanTaskReorderPayload(request.body))`.)
- **Archive** — in `DELETE /api/tasks/:id`, after the successful archive (before `return task`): `await logActivity(task.id, 'archived', 'Task archived');`.
- **Restore** — in `PATCH /api/tasks/:id/restore`, after success (before `return task`): `await logActivity(task.id, 'restored', 'Task restored');`.

- [ ] **Step 4: Run tests to verify they pass** — `npm test` (PASS), `npm run check` (success).

- [ ] **Step 5: Commit**
```bash
git add server/tasksRoutes.js tests/backend/tasksRoutes.test.js
git commit -m "$(cat <<'EOF'
feat: log task lifecycle and status activity; expose an activity feed

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 11: Activity demo mirror

**Files:** Modify `scripts/demo-server.js`

- [ ] **Step 1: Extend the in-memory tasks repository** to support `getTask` (needed by the route status-change hooks) plus record + list activity. Add an `activity` array and inside the demo's tasks repository object add:
```js
    async getTask(id) {
      return tasks.find(t => t.id === id) || null;
    },
    async recordActivity(taskId, eventType, message) {
      const event = { id: `act-${activity.length + 1}`, taskId, eventType, message, createdAt: new Date().toISOString() };
      activity.push(event);
      return event;
    },
    async listTaskActivity(taskId) {
      return activity.filter(a => a.taskId === taskId).slice().reverse();
    },
```
(`tasks` is the in-memory array the demo tasks repository already closes over — match its actual variable name.) Seed one `created` event per seeded task (`activity.push({ ..., eventType: 'created', message: 'Task created' })`). The route-layer `logActivity` calls these methods, so the demo gets activity for free via the routes.

- [ ] **Step 2: Verify** — `npm run check`; `npm run demo`, create/patch a task via curl, then `GET /api/tasks/:id/activity` shows events. Stop the demo.

- [ ] **Step 3: Commit**
```bash
git add scripts/demo-server.js
git commit -m "$(cat <<'EOF'
feat: mirror task activity in the in-memory demo server

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 12: Activity feed UI + client + wiring

**Files:** Modify `public/js/taskApi.js`, `public/js/renderTaskDetail.js`, `public/js/main.js`, `public/js/state.js`, `tests/frontend/renderTaskDetail.test.js`

- [ ] **Step 1: Add the failing render test:**
```js
test('renderTaskDetailHtml renders an activity feed newest-first', () => {
  const html = renderTaskDetailHtml(
    { id: 't1', title: 'X', status: 'planned', priority: 'low' },
    { activityEvents: [
      { id: 'a2', message: 'Status → in-progress', createdAt: '2026-05-20T10:00:00.000Z' },
      { id: 'a1', message: 'Task created', createdAt: '2026-05-19T09:00:00.000Z' },
    ] },
  );
  assert.match(html, /Activity/);
  assert.match(html, /Status → in-progress/);
  assert.match(html, /Task created/);
});

test('renderTaskDetailHtml shows an empty activity state', () => {
  const html = renderTaskDetailHtml({ id: 't1', title: 'X', status: 'planned', priority: 'low' }, { activityEvents: [] });
  assert.match(html, /No activity yet\./);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm test`.

- [ ] **Step 3: Add `renderActivity` to `public/js/renderTaskDetail.js`:**
```js
function renderActivity(events = []) {
  const rows = events.length
    ? events.map(e => `
        <div class="activity-item">
          <span class="activity-item__msg">${escapeHtml(e.message || '')}</span>
          <span class="activity-item__time">${escapeHtml((e.createdAt || '').slice(0, 10))}</span>
        </div>`).join('')
    : '<p class="activity__empty">No activity yet.</p>';
  return `
      <section class="detail-block">
        <h3>Activity</h3>
        <div class="activity">${rows}</div>
      </section>`;
}
```
Replace the Activity placeholder in `renderTaskDetailHtml`'s `detail-body` with `${renderActivity(options.activityEvents)}`.

- [ ] **Step 4: Run test to verify it passes** — `npm test` → PASS.

- [ ] **Step 5: Client + wiring:**
  - `public/js/taskApi.js`: add
```js
export async function fetchTaskActivity(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/activity`);
  if (!response.ok) throw new Error('Failed to load activity');
  return response.json();
}
```
  - `public/js/state.js`: add `taskActivity: [],` to initial state.
  - `public/js/main.js`: import `fetchTaskActivity`; add a `loadTaskActivity(taskId)` mirroring `loadTaskChecklist`; call it in the task-select handler; add `activityEvents: state.taskActivity` to the `renderTaskDetailHtml(...)` options. After a notes save and after any checklist change, activity isn't affected; after a status change via the edit form, also `await loadTaskActivity(state.selectedTaskId)` so the feed refreshes (call it in the edit-save success path that already reloads tasks).

- [ ] **Step 6: Add minimal CSS** to `public/styles.css`: `.activity { display: grid; gap: 6px; }`, `.activity-item { display: flex; justify-content: space-between; gap: 10px; font-size: 0.82rem; }`, `.activity-item__time { color: var(--text-dim); font-family: var(--font-mono); font-size: 0.74rem; }`, `.activity__empty { color: var(--text-dim); }`.

- [ ] **Step 7: Verify** — `npm test` (PASS), `npm run check` (success), CSS braces balanced.

- [ ] **Step 8: Commit**
```bash
git add public/js/taskApi.js public/js/renderTaskDetail.js public/js/main.js public/js/state.js public/styles.css tests/frontend/renderTaskDetail.test.js
git commit -m "$(cat <<'EOF'
feat: activity feed in the task detail panel

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Task 13: Activity MCP tool

**Files:** Modify `mcp/moomoraClient.js`, create `mcp/tools/activity.js`; Modify `mcp/server.js`, `tests/mcp/activityTools.test.js`

- [ ] **Step 1: Write failing test** — create `tests/mcp/activityTools.test.js` mirroring `tests/mcp/tasksTools.test.js`: assert `list_task_activity` has the right name, is read-only, calls `client.listTaskActivity(taskId)`, and maps the result through `okResult`.

- [ ] **Step 2: Run test to verify it fails** — `npm test`.

- [ ] **Step 3: Client method** in `mcp/moomoraClient.js`:
```js
    listTaskActivity: (taskId) => request(`/api/tasks/${taskId}/activity`),
```

- [ ] **Step 4: Implement `mcp/tools/activity.js`** mirroring a read tool in `mcp/tools/tasks.js`: one tool `list_task_activity` with `{ taskId: z.string() }`, `annotations: { readOnlyHint: true }`, handler returning `okResult(await client.listTaskActivity(taskId))` wrapped in the project's error helper.

- [ ] **Step 5: Register in `mcp/server.js`** — import `createActivityTools` and spread `...createActivityTools(apiClient)` into `tools`.

- [ ] **Step 6: Run tests to verify they pass** — `npm test`, `npm run check`.

- [ ] **Step 7: Commit**
```bash
git add mcp/moomoraClient.js mcp/tools/activity.js mcp/server.js tests/mcp/activityTools.test.js
git commit -m "$(cat <<'EOF'
feat: expose task activity via an MCP read tool

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)

- [ ] `npm test` — all suites pass.
- [ ] `npm run check` — success.
- [ ] Manual smoke (`npm run demo`, `:3100`): select a task → edit notes + save; add/toggle/delete checklist items, see the N/M count; change status (edit form + board drag) → activity feed shows `Status → …`, archive/restore show events. Drive the same via the MCP server if convenient (`update_task` notes, `add_checklist_item`, `list_task_activity`). Stop the demo when done.

## Notes for the implementer

- Reference implementation for the whole pattern is **Linked docs**: `tasksRepository` link methods, the `/api/tasks/:id/documents` routes, the demo mirror, `renderLinkedDocs` + `loadTaskDocuments` + handlers in `main.js`, and the `mcp/tools` document tools. Match its conventions (validation, status codes, `okResult`/`withErrorHandling`, state-guard on async loads).
- `tests/backend/tasksRoutes.test.js` and `tests/mcp/*.test.js` already establish app-build / fake-client helpers — reuse them; do not invent new harnesses.
- Activity logging is **best-effort** — a logging failure must never fail the underlying task mutation (the `logActivity` wrapper swallows errors).
- Keep new files single-purpose: `checklistRepository.js`, `checklistRoutes.js`, `mcp/tools/checklist.js`, `mcp/tools/activity.js`. Activity repo methods fold into `tasksRepository.js`.
