# v1.0.0 Contract Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare Moomora Console's export/import formats and MCP tool surface as the stable 1.0 public contract, and add CI shape-lock tests that fail when a frozen shape drifts.

**Architecture:** Three new "characterization" test files under `tests/contract/` assert the *current* frozen shapes against the authoritative producers (the pure row-mappers `normalizeTaskRow`/`normalizeDocumentRow`, the export route envelope, the `libraryExport.js` serializers, and the MCP tool factories). A new `docs/contract.md` documents the policy and the frozen shapes; `README.md` and `mcp/README.md` link to it.

**Tech Stack:** Node.js built-in test runner (`node --test`, invoked via `npm test` → `scripts/run-tests.js`), Fastify `app.inject()` for HTTP, Zod schema introspection via `safeParse`. No new dependencies.

---

## Important context for the implementer

These are **characterization / lock tests** over code that already exists and already works. Unlike normal TDD, **each new test is expected to PASS on its first run** because it locks the *current* behavior. The value is regression-catching: if anyone later changes a frozen shape, the test goes red and forces a conscious decision (revert, or bump the version + update `docs/contract.md` + update the test).

To gain confidence that a lock test actually bites, you MAY (optionally, per test) temporarily change one frozen expected value, run the test, see it FAIL, then revert. This is a sanity check, not a required step — do not commit the temporary change.

**Test discovery:** `npm test` runs `node scripts/run-tests.js` with no args → `node --test`, which recursively discovers every `*.test.js` and skips `node_modules`. A new `tests/contract/` directory needs **no wiring** — it is auto-discovered.

**Run a single contract file during development:**
```bash
node --test tests/contract/<file>.test.js
```

**Facts the tests depend on (verified against source at 0.7.7):**
- `normalizeTaskRow` (`server/tasksRepository.js:23`) returns keys: `id, title, description, notes, priority, status, projectId, dueDate, sortOrder, archivedAt, createdAt, updatedAt` (12).
- `normalizeDocumentRow` (`server/libraryRepository.js:15`) returns base keys: `id, title, body, documentType, projectId, tags, sourceFilename, archivedAt, createdAt, updatedAt` (10), plus `projectSlug` **only** when `row.project_slug !== undefined`.
- `GET /api/tasks/export` envelope (`server/tasksRoutes.js:284`) returns exactly: `format, version, exportedAt, project, tasks`.
- Import cap is 500; the over-limit message is `tasks cannot exceed 500 records` (`server/tasksRoutes.js:73`).
- Import defaults: `priority: 'medium'`, `status: 'planned'`, `mode: 'skip'`. Dedup key (skip mode): `[title(lowercased), projectId(lowercased), status(lowercased), dueDate]` joined with ``.
- `buildApp({ skipDb: true, tasksRepository, projectsRepository })` runs no migrations (the migration guard is `db && !options.skipDb && !options.db`).

---

## File Structure

- Create: `tests/contract/taskFormat.test.js` — locks the task export envelope, task field set, and import contract (defaults/modes/dedup/cap/enums).
- Create: `tests/contract/libraryFormat.test.js` — locks the document field set, the `.md` front-matter golden output, the client⇄server byte-identity invariant, and the filename rules.
- Create: `tests/contract/mcpToolContract.test.js` — locks the frozen MCP tool name set, each tool's input fields + optionality + enums, and the MCP-owned output shapes.
- Create: `docs/contract.md` — the stability policy + the frozen shapes (the human-readable contract).
- Modify: `README.md` — add a "Stability & Compatibility" section linking to `docs/contract.md`.
- Modify: `mcp/README.md` — add a one-line pointer to the contract doc's MCP section.

---

## Task 1: Task format contract test

**Files:**
- Create: `tests/contract/taskFormat.test.js`

- [ ] **Step 1: Write the contract test file**

Create `tests/contract/taskFormat.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { normalizeTaskRow } from '../../server/tasksRepository.js';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEED_TASK_ID = '11111111-1111-4111-8111-111111111111';

// The frozen 1.0 task field set (order-independent).
const FROZEN_TASK_KEYS = [
  'archivedAt', 'createdAt', 'description', 'dueDate', 'id', 'notes',
  'priority', 'projectId', 'sortOrder', 'status', 'title', 'updatedAt',
].sort();

function createFakeProjectsRepository() {
  return {
    async resolveProject(value) {
      if (value === 'homelab' || value === PROJECT_UUID) {
        return { id: PROJECT_UUID, slug: 'homelab', status: 'active' };
      }
      return null;
    },
  };
}

function createFakeTasksRepository() {
  const tasks = [{
    id: SEED_TASK_ID,
    title: 'Back up CloudNativePG',
    description: '',
    notes: '',
    priority: 'high',
    status: 'planned',
    projectId: PROJECT_UUID,
    dueDate: '2026-05-12',
    sortOrder: 0,
    createdAt: 'now',
    updatedAt: 'now',
    archivedAt: null,
  }];
  let seq = 0;
  return {
    async listTasks(filters = {}) {
      return tasks.filter((task) => {
        if (filters.projectId && task.projectId !== filters.projectId) return false;
        if (filters.status && task.status !== filters.status) return false;
        if (filters.archived === true || filters.archived === 'true') return Boolean(task.archivedAt);
        if (filters.archived !== 'all') return !task.archivedAt;
        return true;
      });
    },
    async importTasks(imported) {
      const created = imported.map((task) => {
        seq += 1;
        return { id: `imported-${seq}`, ...task, createdAt: 'now', updatedAt: 'now', archivedAt: task.archivedAt ?? null };
      });
      tasks.push(...created);
      return created;
    },
    async replaceProjectTasks(projectId, imported) {
      for (let i = tasks.length - 1; i >= 0; i -= 1) {
        if (tasks[i].projectId === projectId) tasks.splice(i, 1);
      }
      return this.importTasks(imported);
    },
    async getTask(id) {
      const found = tasks.find((task) => task.id === id);
      return found ? { ...found } : null;
    },
    async recordActivity() { return null; },
    async listTaskActivity() { return []; },
  };
}

function buildContractApp(tasksRepository = createFakeTasksRepository()) {
  return buildApp({
    skipDb: true,
    tasksRepository,
    projectsRepository: createFakeProjectsRepository(),
  });
}

test('CONTRACT: normalizeTaskRow produces exactly the frozen task field set', () => {
  const row = {
    id: 'id', title: 't', description: 'd', notes: 'n',
    priority: 'high', status: 'planned', project_id: 'pid',
    due_date: null, sort_order: 3, archived_at: null,
    created_at: 'c', updated_at: 'u',
  };
  assert.deepEqual(Object.keys(normalizeTaskRow(row)).sort(), FROZEN_TASK_KEYS);
});

test('CONTRACT: GET /api/tasks/export envelope shape is frozen', async () => {
  const app = await buildContractApp();
  const res = await app.inject({ method: 'GET', url: '/api/tasks/export?project=homelab' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), ['exportedAt', 'format', 'project', 'tasks', 'version'].sort());
  assert.equal(body.format, 'moomora.tasks');
  assert.equal(body.version, 1);
  assert.equal(body.project, 'homelab');
  await app.close();
});

test('CONTRACT: import applies documented defaults (priority=medium, status=planned, mode=skip)', async () => {
  const app = await buildContractApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'Fresh task' }] },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.mode, 'skip');
  assert.equal(body.tasks[0].priority, 'medium');
  assert.equal(body.tasks[0].status, 'planned');
  await app.close();
});

test('CONTRACT: skip mode dedups on [title(lowercased), projectId, status, dueDate]', async () => {
  const app = await buildContractApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: '  back up cloudnativepg  ', status: 'planned', dueDate: '2026-05-12' }] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().skipped, 1);
  assert.equal(res.json().imported, 0);
  await app.close();
});

test('CONTRACT: append mode inserts duplicates as new', async () => {
  const app = await buildContractApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', mode: 'append', tasks: [{ title: 'Back up CloudNativePG', status: 'planned', dueDate: '2026-05-12' }] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().mode, 'append');
  assert.equal(res.json().imported, 1);
  await app.close();
});

test('CONTRACT: replace mode clears the project then inserts', async () => {
  const repo = createFakeTasksRepository();
  const app = await buildContractApp(repo);
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', mode: 'replace', tasks: [{ title: 'Only task' }] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().mode, 'replace');
  const remaining = await repo.listTasks({ archived: 'all' });
  assert.deepEqual(remaining.map((t) => t.title), ['Only task']);
  await app.close();
});

test('CONTRACT: import rejects more than 500 tasks', async () => {
  const app = await buildContractApp();
  const tasks = Array.from({ length: 501 }, (_, i) => ({ title: `Task ${i}` }));
  const res = await app.inject({ method: 'POST', url: '/api/tasks/import', payload: { project: 'homelab', tasks } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /cannot exceed 500/);
  await app.close();
});

test('CONTRACT: priority/status enums are frozen (import rejects out-of-enum)', async () => {
  const app = await buildContractApp();
  const badPriority = await app.inject({
    method: 'POST', url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'X', priority: 'urgent' }] },
  });
  assert.equal(badPriority.statusCode, 400);
  assert.match(badPriority.json().message, /priority/);

  const badStatus = await app.inject({
    method: 'POST', url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'X', status: 'blocked' }] },
  });
  assert.equal(badStatus.statusCode, 400);
  assert.match(badStatus.json().message, /status/);
  await app.close();
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `node --test tests/contract/taskFormat.test.js`
Expected: PASS — all 8 tests green (these lock existing behavior).

- [ ] **Step 3: Commit**

```bash
git add tests/contract/taskFormat.test.js
git commit -m "test(contract): lock moomora.tasks export/import format"
```

---

## Task 2: Library format contract test

**Files:**
- Create: `tests/contract/libraryFormat.test.js`

- [ ] **Step 1: Write the contract test file**

Create `tests/contract/libraryFormat.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentRow } from '../../server/libraryRepository.js';
import {
  renderDocumentMarkdown,
  documentFilename,
  libraryArchiveFilename,
} from '../../server/libraryExport.js';
import { buildExportedMarkdown } from '../../public/js/libraryExport.js';

// The frozen 1.0 library document base field set (order-independent).
const FROZEN_DOC_KEYS = [
  'archivedAt', 'body', 'createdAt', 'documentType', 'id',
  'projectId', 'sourceFilename', 'tags', 'title', 'updatedAt',
].sort();

const GOLDEN_DOC = {
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  tags: ['postgres', 'dr'],
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
};

const GOLDEN_MARKDOWN = `---
title: Postgres restore
type: runbook
project: homelab
tags:
  - postgres
  - dr
created_at: 2026-04-12T10:33:21.000Z
updated_at: 2026-05-20T08:11:09.000Z
---

# Postgres restore

Steps...
`;

test('CONTRACT: normalizeDocumentRow base field set is frozen', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: ['x'], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
  };
  assert.deepEqual(Object.keys(normalizeDocumentRow(row)).sort(), FROZEN_DOC_KEYS);
});

test('CONTRACT: normalizeDocumentRow adds projectSlug only when project_slug present', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u', project_slug: 'homelab',
  };
  const out = normalizeDocumentRow(row);
  assert.equal(out.projectSlug, 'homelab');
  assert.deepEqual(Object.keys(out).sort(), [...FROZEN_DOC_KEYS, 'projectSlug'].sort());
});

test('CONTRACT: renderDocumentMarkdown emits the frozen front-matter format', () => {
  assert.equal(renderDocumentMarkdown(GOLDEN_DOC, 'homelab'), GOLDEN_MARKDOWN);
});

test('CONTRACT: browser serializer is byte-identical to server (dual-write invariant)', () => {
  const fixtures = [
    { doc: { ...GOLDEN_DOC, sourceFilename: null }, slug: 'homelab' },
    { doc: { ...GOLDEN_DOC, title: 'Has: colon', sourceFilename: null }, slug: 'homelab' },
    { doc: { ...GOLDEN_DOC, title: '#heading', sourceFilename: null }, slug: 'homelab' },
    { doc: { ...GOLDEN_DOC, tags: [], body: '', sourceFilename: null }, slug: 'homelab' },
  ];
  for (const { doc, slug } of fixtures) {
    assert.equal(buildExportedMarkdown(doc, slug), renderDocumentMarkdown(doc, slug));
  }
});

test('CONTRACT: documentFilename precedence is frozen', () => {
  assert.equal(documentFilename({ sourceFilename: 'runbooks/restore.md', title: 'x' }), 'restore.md');
  assert.equal(documentFilename({ sourceFilename: 'restore', title: 'x' }), 'restore.md');
  assert.equal(documentFilename({ sourceFilename: null, title: 'Postgres Restore — Steps' }), 'postgres-restore-steps.md');
  assert.equal(documentFilename({ sourceFilename: null, title: '   ' }), 'untitled.md');
});

test('CONTRACT: libraryArchiveFilename shape is frozen', () => {
  const date = new Date('2026-05-29T12:00:00.000Z');
  assert.equal(libraryArchiveFilename('homelab', date), 'moomora-console-library-homelab-2026-05-29.zip');
  assert.equal(libraryArchiveFilename('', date), 'moomora-console-library-all-2026-05-29.zip');
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `node --test tests/contract/libraryFormat.test.js`
Expected: PASS — all 6 tests green.

If the `renderDocumentMarkdown` golden test fails, do **not** edit the golden string to match unless you have confirmed the production serializer is correct — a diff here means the front-matter format changed and the contract is broken. Compare the actual vs expected output character-by-character (the difference is almost always a blank-line or trailing-newline change).

- [ ] **Step 3: Commit**

```bash
git add tests/contract/libraryFormat.test.js
git commit -m "test(contract): lock library .md front-matter and document shape"
```

---

## Task 3: MCP tool contract test

**Files:**
- Create: `tests/contract/mcpToolContract.test.js`

- [ ] **Step 1: Write the contract test file**

Create `tests/contract/mcpToolContract.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskTools } from '../../mcp/tools/tasks.js';
import { createDocumentTools } from '../../mcp/tools/documents.js';
import { createLinkTools } from '../../mcp/tools/links.js';
import { createChecklistTools } from '../../mcp/tools/checklist.js';
import { createActivityTools } from '../../mcp/tools/activity.js';
import { toTaskRef, toDocumentRef, capResults } from '../../mcp/shape.js';

// The frozen 1.0 MCP tool surface: tool name -> required + optional input fields.
const FROZEN_TOOLS = {
  search_tasks: { required: [], optional: ['query', 'project', 'status'] },
  get_task: { required: ['id'], optional: [] },
  create_task: { required: ['title', 'project'], optional: ['description', 'priority', 'status', 'dueDate'] },
  update_task: { required: ['id'], optional: ['title', 'description', 'notes', 'priority', 'status', 'project', 'dueDate'] },
  search_documents: { required: [], optional: ['query', 'project', 'documentType', 'tags'] },
  get_document: { required: ['id'], optional: [] },
  create_document: { required: ['title', 'body', 'documentType', 'project'], optional: ['tags'] },
  update_document: { required: ['id'], optional: ['title', 'body', 'documentType', 'project', 'tags'] },
  list_task_documents: { required: ['taskId'], optional: [] },
  link_task_document: { required: ['taskId', 'documentId'], optional: [] },
  unlink_task_document: { required: ['taskId', 'documentId'], optional: [] },
  list_task_checklist: { required: ['taskId'], optional: [] },
  add_checklist_item: { required: ['taskId', 'label'], optional: [] },
  set_checklist_item: { required: ['taskId', 'itemId', 'completed'], optional: [] },
  delete_checklist_item: { required: ['taskId', 'itemId'], optional: [] },
  list_task_activity: { required: ['taskId'], optional: [] },
};

function allTools(client = {}) {
  return [
    ...createTaskTools(client),
    ...createDocumentTools(client),
    ...createLinkTools(client),
    ...createChecklistTools(client),
    ...createActivityTools(client),
  ];
}

test('CONTRACT: the frozen set of MCP tool names is present (no removals/renames)', () => {
  const names = allTools().map((t) => t.name);
  for (const frozen of Object.keys(FROZEN_TOOLS)) {
    assert.ok(names.includes(frozen), `MCP tool "${frozen}" is missing from the surface`);
  }
  // Additive new tools are allowed; duplicate names are not.
  assert.equal(names.length, new Set(names).size, 'duplicate tool names registered');
});

test('CONTRACT: each frozen tool has the frozen input fields with frozen optionality', () => {
  const tools = allTools();
  for (const [name, spec] of Object.entries(FROZEN_TOOLS)) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `tool ${name} exists`);
    const fields = Object.keys(tool.inputSchema).sort();
    assert.deepEqual(fields, [...spec.required, ...spec.optional].sort(), `${name} input field set`);
    for (const field of spec.required) {
      assert.equal(tool.inputSchema[field].safeParse(undefined).success, false, `${name}.${field} must be required`);
    }
    for (const field of spec.optional) {
      assert.equal(tool.inputSchema[field].safeParse(undefined).success, true, `${name}.${field} must be optional`);
    }
  }
});

test('CONTRACT: tool enums expose exactly the frozen option sets', () => {
  const tools = allTools();
  const get = (name, field) => tools.find((t) => t.name === name).inputSchema[field];

  const STATUS = ['high-priority', 'in-progress', 'planned', 'completed', 'notes'];
  const PRIORITY = ['high', 'medium', 'low'];
  const DOCUMENT_TYPE = ['runbook', 'note'];

  const assertEnum = (schema, values) => {
    for (const v of values) assert.equal(schema.safeParse(v).success, true, `accepts ${v}`);
    assert.equal(schema.safeParse('definitely-not-valid').success, false, 'rejects out-of-enum value');
  };

  assertEnum(get('search_tasks', 'status'), STATUS);
  assertEnum(get('create_task', 'priority'), PRIORITY);
  assertEnum(get('create_task', 'status'), STATUS);
  assertEnum(get('search_documents', 'documentType'), DOCUMENT_TYPE);
  assertEnum(get('create_document', 'documentType'), DOCUMENT_TYPE);
});

test('CONTRACT: MCP-owned ref shapes are frozen', () => {
  const taskRef = toTaskRef({
    id: '1', title: 't', status: 'planned', priority: 'high',
    projectId: 'p', dueDate: '2026-05-12', description: 'x', notes: 'y',
  });
  assert.deepEqual(Object.keys(taskRef).sort(), ['dueDate', 'id', 'priority', 'projectId', 'status', 'title'].sort());

  const docRef = toDocumentRef({
    id: '1', title: 't', documentType: 'note', projectId: 'p', tags: ['a'], body: 'long body',
  });
  assert.deepEqual(Object.keys(docRef).sort(), ['documentType', 'id', 'projectId', 'snippet', 'tags', 'title'].sort());
});

test('CONTRACT: capResults caps lists at 20', () => {
  assert.equal(capResults(Array.from({ length: 50 }, (_, i) => i)).length, 20);
});

test('CONTRACT: link/unlink/delete wrapper shapes are frozen', async () => {
  const TASK = '11111111-1111-4111-8111-111111111111';
  const DOC = '55555555-5555-4555-8555-555555555555';
  const ITEM = '99999999-9999-4999-8999-999999999999';

  const linkTools = createLinkTools({ linkTaskDocument: async () => [], unlinkTaskDocument: async () => true });
  const link = linkTools.find((t) => t.name === 'link_task_document');
  const unlink = linkTools.find((t) => t.name === 'unlink_task_document');

  const linkRes = JSON.parse((await link.handler({ taskId: TASK, documentId: DOC })).content[0].text);
  assert.deepEqual(Object.keys(linkRes).sort(), ['documentId', 'documents', 'linked', 'taskId'].sort());
  assert.equal(linkRes.linked, true);

  const unlinkRes = JSON.parse((await unlink.handler({ taskId: TASK, documentId: DOC })).content[0].text);
  assert.deepEqual(Object.keys(unlinkRes).sort(), ['documentId', 'taskId', 'unlinked'].sort());

  const checklistTools = createChecklistTools({ deleteChecklistItem: async () => true });
  const del = checklistTools.find((t) => t.name === 'delete_checklist_item');
  const delRes = JSON.parse((await del.handler({ taskId: TASK, itemId: ITEM })).content[0].text);
  assert.deepEqual(Object.keys(delRes).sort(), ['deleted', 'itemId', 'taskId'].sort());
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `node --test tests/contract/mcpToolContract.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 3: Commit**

```bash
git add tests/contract/mcpToolContract.test.js
git commit -m "test(contract): lock MCP tool names, input schemas, and output shapes"
```

---

## Task 4: Write the contract document

**Files:**
- Create: `docs/contract.md`

- [ ] **Step 1: Write the document**

Create `docs/contract.md` with this exact content:

````markdown
# Moomora Console — Stability & Compatibility Contract

This document defines Moomora Console's **public contract** as of the 1.0 release: which
interfaces are stable, what "stable" promises, and how breaking changes are versioned.

## Stability tiers

| Tier | Surfaces | Promise |
|------|----------|---------|
| **Stable** | Export/import formats (`moomora.tasks` task backups, library `.md` front-matter) and the MCP tool surface | Within a `1.x` line, changes are **additive only** — new optional fields, new MCP tools, new optional tool inputs. Existing fields keep their name, type, and meaning. |
| **Internal** | The HTTP API (`/api/…`) | No stability guarantee. Consumed by the co-shipped frontend and the local MCP server, which are released together as one versioned image. May change between any release. |

For durable, version-independent integration, use the **export formats** or the **MCP server** —
not the HTTP API directly.

### How breaking changes are versioned

- **Export format:** a breaking change bumps the envelope `version` (`1` → `2`); importers
  continue to accept `version: 1` payloads.
- **MCP surface:** removing or renaming a tool, removing an input, making an optional input
  required, or narrowing an enum is a breaking change and requires a new **major** app version
  plus a documented migration.
- **Semver mapping:** a stable-surface break ⇒ **major** bump; an additive change ⇒ **minor**;
  a bug fix ⇒ **patch**.

### Forward-compatibility rule for consumers

Importers and MCP clients **MUST ignore unknown fields**. Exporters and the server **MAY add
fields** within a major version. Do not hard-fail on a field you do not recognise.

## Stable surface 1 — Task export/import (`moomora.tasks`)

### Export envelope (`GET /api/tasks/export`)

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "exportedAt": "2026-05-29T12:00:00.000Z",
  "project": "homelab",
  "tasks": []
}
```

- `format` is the exact, case-sensitive string `"moomora.tasks"`.
- `version` is the integer `1`.
- `project` is the project slug, or `"all"` for a cross-project backup.

### Task object

| Field | Type |
|-------|------|
| `id` | UUID |
| `title` | string (required) |
| `description` | string (`""` if unset) |
| `notes` | string (`""` if unset) |
| `priority` | `"high"` \| `"medium"` \| `"low"` |
| `status` | `"high-priority"` \| `"in-progress"` \| `"planned"` \| `"completed"` \| `"notes"` |
| `projectId` | UUID |
| `dueDate` | `"YYYY-MM-DD"` \| `null` |
| `sortOrder` | 32-bit signed integer |
| `createdAt` | ISO-8601 timestamp |
| `updatedAt` | ISO-8601 timestamp |
| `archivedAt` | ISO-8601 timestamp \| `null` |

### Import (`POST /api/tasks/import`)

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "project": "homelab",
  "mode": "skip",
  "tasks": [{ "title": "Restore drill" }]
}
```

- `project` (slug or id) is **required**. `format` is validated if present; `version` is
  accepted but not validated.
- `projectId` is assigned server-side and is **never** read from the payload.
- Per-task accepted fields: `title` (required), `description`, `priority` (default
  `"medium"`), `status` (default `"planned"`), `dueDate`, `sortOrder` (defaults to the array
  index), `archivedAt`.
- **Max 500 tasks** per import.
- **Modes:** `"skip"` (default — skip duplicates), `"append"` (insert all as new),
  `"replace"` (clear the target project, then insert).
- **Duplicate key** (skip mode): `[ title (lowercased), projectId, status, dueDate ]`.
- Response: `{ "mode", "imported": <count>, "skipped": <count>, "tasks": [] }`.

## Stable surface 2 — Library `.md` front-matter

Library export (`GET /api/library/export`) produces a ZIP of `.md` files. Each file is YAML
front-matter followed by the Markdown body, in this exact key order:

```markdown
---
title: Postgres restore
type: runbook
project: homelab
tags:
  - postgres
  - dr
created_at: 2026-04-12T10:33:21.000Z
updated_at: 2026-05-20T08:11:09.000Z
---

# Postgres restore

Steps...
```

- `type` is `"runbook"` or `"note"` (defaults to `"note"`).
- `project` is the project slug, or `"unknown"`.
- `tags` is `[]` when empty, otherwise a YAML block list.
- `created_at` / `updated_at` are the raw timestamps (not quoted).
- A value is YAML-quoted when it contains `:`, `"`, `\`, a newline, or `#`, or starts with
  `-`, or starts/ends with whitespace; inside quotes, `\` → `\\`, newline → `\n`, `"` → `\"`.
- **Filenames:** prefer `sourceFilename` (basename only, leading dots stripped, `.md`
  appended if missing); else the slugified title + `.md`; else `untitled.md`. Collisions
  within a folder get a `-2`, `-3`, … suffix.
- **ZIP layout:** `moomora-console-library-<scope>-<YYYY-MM-DD>.zip`, with entries under
  `<project-slug>/<file>.md` for an all-projects export (flat for a single project).

**Not promised at 1.0:** library `.md` / document **import (round-trip) is not supported**.
Library export is one-way. Documents are created/edited via the app, the HTTP API, or the MCP
`create_document` / `update_document` tools.

## Stable surface 3 — MCP tools

The MCP server (`mcp/`) exposes these tools over stdio. Tool names, input field names,
required/optional status, and enum option sets are frozen. Shared enums: `STATUS`
(`high-priority`, `in-progress`, `planned`, `completed`, `notes`), `PRIORITY` (`high`,
`medium`, `low`), `DOCUMENT_TYPE` (`runbook`, `note`).

| Tool | Inputs | Read-only |
|------|--------|-----------|
| `search_tasks` | `query?`, `project?`, `status?:STATUS` | yes |
| `get_task` | `id` | yes |
| `create_task` | `title`, `project`, `description?`, `priority?:PRIORITY`, `status?:STATUS`, `dueDate?` | — |
| `update_task` | `id`, `title?`, `description?`, `notes?`, `priority?:PRIORITY`, `status?:STATUS`, `project?`, `dueDate?` | — |
| `search_documents` | `query?`, `project?`, `documentType?:DOCUMENT_TYPE`, `tags?` | yes |
| `get_document` | `id` | yes |
| `create_document` | `title`, `body`, `documentType:DOCUMENT_TYPE`, `project`, `tags?` | — |
| `update_document` | `id`, `title?`, `body?`, `documentType?:DOCUMENT_TYPE`, `project?`, `tags?` | — |
| `list_task_documents` | `taskId` | yes |
| `link_task_document` | `taskId`, `documentId` | — |
| `unlink_task_document` | `taskId`, `documentId` | — |
| `list_task_checklist` | `taskId` | yes |
| `add_checklist_item` | `taskId`, `label` | — |
| `set_checklist_item` | `taskId`, `itemId`, `completed` | — |
| `delete_checklist_item` | `taskId`, `itemId` | — |
| `list_task_activity` | `taskId` | yes |

MCP-owned output shapes (frozen):

- Task summary (from `search_tasks`): `{ id, title, status, priority, projectId, dueDate }`.
- Document summary (from `search_documents`): `{ id, title, documentType, projectId, tags, snippet }` (snippet ≤ 200 chars).
- `link_task_document` → `{ linked: true, taskId, documentId, documents: [] }`.
- `unlink_task_document` → `{ unlinked: true, taskId, documentId }`.
- `delete_checklist_item` → `{ deleted: true, taskId, itemId }`.
- List results are capped at **20** items.

Full-record tools (`get_task`, `get_document`, `create_*`, `update_*`) return the full task or
document record (the fields in the tables above). Operations intentionally **not** exposed over
MCP — archive, permanent delete, reorder, project CRUD, task import/export, library export —
remain HTTP-only.

## Enforcement

These shapes are locked by characterization tests under `tests/contract/`, run by `npm test`.
A change to any frozen shape turns those tests red. Resolving a red contract test means either
reverting the change or making it deliberately: bump the relevant `version` / major release,
update this document, and update the contract test.
````

- [ ] **Step 2: Verify the doc matches the locked behavior**

Run the contract tests written in Tasks 1–3 (they encode the same facts this doc states):

```bash
node --test tests/contract/
```
Expected: PASS. Then re-read `docs/contract.md` and confirm every frozen value (enums, the 500
cap, the front-matter key order, the tool table) matches what the tests assert. Fix any drift
in the doc.

- [ ] **Step 3: Commit**

```bash
git add docs/contract.md
git commit -m "docs: add the 1.0 stability & compatibility contract"
```

---

## Task 5: Link the contract from README and the MCP README, then verify the full suite

**Files:**
- Modify: `README.md`
- Modify: `mcp/README.md`

- [ ] **Step 1: Add a "Stability & Compatibility" section to README.md**

In `README.md`, find this block (end of the "Import And Export" section, immediately before
the Kubernetes section):

```markdown
Legacy TaskBoard export envelopes are not supported. This project is treated as a greenfield Moomora Console app.

## Kubernetes Deployment
```

Replace it with:

```markdown
Legacy TaskBoard export envelopes are not supported. This project is treated as a greenfield Moomora Console app.

## Stability & Compatibility

The export/import formats (`moomora.tasks` task backups and library `.md` front-matter) and the
MCP tool surface are Moomora Console's stable public contract: within a `1.x` line they change
only additively (new optional fields, new tools), and a breaking change bumps the format
`version` or the major release. The HTTP API is internal and may change between releases —
integrate against the export formats or the MCP server for stability. See
[docs/contract.md](docs/contract.md) for the full policy and the frozen shapes.

## Kubernetes Deployment
```

- [ ] **Step 2: Add a pointer to mcp/README.md**

In `mcp/README.md`, find this block (lines 8–9):

```markdown
Internal design spec (for contributors with the repo checked out):
`docs/superpowers/specs/2026-05-20-moomora-mcp-design.md`.
```

Replace it with:

```markdown
Internal design spec (for contributors with the repo checked out):
`docs/superpowers/specs/2026-05-20-moomora-mcp-design.md`.

The MCP tool surface is part of Moomora Console's stable 1.0 public contract — see
[`docs/contract.md`](../docs/contract.md) for the stability policy and the frozen tool list.
```

- [ ] **Step 3: Run the full test suite and syntax check**

Run:
```bash
npm test && npm run check
```
Expected: all tests pass (including the three new `tests/contract/` files), and `npm run check`
exits 0.

- [ ] **Step 4: Commit**

```bash
git add README.md mcp/README.md
git commit -m "docs: link the stability contract from README and the MCP README"
```

---

## Self-review notes (for the implementer)

- The three contract tests are independent and can be implemented in any order. Task 4 (doc)
  depends on nothing; Task 5 depends on `docs/contract.md` existing (it links to it).
- Do **not** add `tests/contract/` to any glob or config — `node --test` auto-discovers it.
- Do **not** modify `package.json`'s `check` script — contract tests are executed by `npm test`,
  not syntax-checked.
- If a golden/shape assertion fails on first run, that is a real signal the documented frozen
  value is wrong (or the code already drifted from the design) — investigate before "fixing"
  the test to match.
