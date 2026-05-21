# Projects Model — Backend (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `context` enum with a first-class, user-creatable `projects` resource (with lifecycle) referenced by `tasks` and `markdown_documents`, exposing a projects CRUD API and switching all task/document endpoints from `context` to `project`.

**Architecture:** A normalized `projects` table (id, name, slug, status, sort_order) referenced by `project_id` FK on tasks and documents. A new `projectsRepository` + `projectsRoutes` provide CRUD with archive-vs-permanent-delete safety. Existing task/doc repositories and routes swap `context` for `project_id`, accepting a slug-or-id `project` value that the route layer resolves to an id. The in-memory demo server mirrors all of it.

**Tech Stack:** Node.js (ESM), Fastify, PostgreSQL via `pg`, Node's built-in test runner (`node:test` + `node:assert/strict`).

Spec: `docs/superpowers/specs/2026-05-20-projects-model-design.md`. This plan is **Phase 1 of 3** (backend); frontend and MCP phases follow as separate plans.

---

## Conventions for the executor

- **Commits:** conventional-commit messages; **every commit MUST include both co-author trailers** (repo policy):
  ```
  Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
  Commit examples use a HEREDOC to include them.
- **Branch:** all work lands on `feat/projects-model` (already created from v0.3.0 `main`).
- **Run a single test file:** `node --test tests/backend/<file>.test.js`
- **Whole suite:** `npm test`. Syntax check: `npm run check`.
- **Greenfield:** existing data may be discarded. There is NO backfill migration. `schema.sql` is canonical; existing local DBs are reset.
- **This is a breaking change.** Backend tests that assert `context` will be updated within the relevant tasks (called out explicitly).

## File structure

```
server/
├── schema.sql                 MODIFY  projects table, project_id FKs, drop context, seed defaults
├── slug.js                    CREATE  deriveSlug() pure helper
├── projectsRepository.js      CREATE  build* SQL builders + createProjectsRepository(db)
├── projectsRoutes.js          CREATE  GET/POST/PATCH/DELETE /api/projects (+ /permanent)
├── index.js                   MODIFY  register projects routes
├── tasksRepository.js         MODIFY  context -> project_id throughout
├── tasksRoutes.js             MODIFY  context -> project (slug-or-id resolution), drop CONTEXTS
├── libraryRepository.js       MODIFY  context -> project_id
└── libraryRoutes.js           MODIFY  context -> project, drop CONTEXTS
scripts/demo-server.js         MODIFY  in-memory projects store + project filtering
tests/backend/
├── slug.test.js               CREATE
├── projectsRepository.test.js CREATE
├── projectsRoutes.test.js     CREATE
├── tasksRepository.test.js    MODIFY  context -> project_id expectations
├── tasksRoutes.test.js        MODIFY  fake repo + payloads use projectId/project
└── libraryRepository.test.js / libraryRoutes/ (as present) MODIFY  same
```

---

## Task 1: Schema — projects table, FKs, seed defaults

**Files:**
- Modify: `server/schema.sql`

- [ ] **Step 1: Replace the `context` columns/indexes and add the projects table**

In `server/schema.sql`:

1. Add this block immediately after the `create extension ...` line and BEFORE `create table if not exists tasks`:

```sql
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active'
    check (status in ('active', 'on-hold', 'completed', 'archived')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into projects (name, slug, sort_order)
values ('Personal', 'personal', 0), ('Work', 'work', 1), ('Homelab', 'homelab', 2)
on conflict (slug) do nothing;
```

2. In the `tasks` table, replace the line:
```sql
  context text not null check (context in ('personal', 'work', 'homelab')),
```
with:
```sql
  project_id uuid not null references projects(id),
```

3. In the `markdown_documents` table, replace the same `context ...` line with:
```sql
  project_id uuid not null references projects(id),
```

4. Replace the two context indexes:
```sql
create index if not exists idx_tasks_context_status on tasks (context, status);
```
with:
```sql
create index if not exists idx_tasks_project_status on tasks (project_id, status);
```
and:
```sql
create index if not exists idx_markdown_documents_context_type on markdown_documents (context, document_type);
```
with:
```sql
create index if not exists idx_markdown_documents_project_type on markdown_documents (project_id, document_type);
```

- [ ] **Step 2: Verify the schema parses (no live DB needed for syntax)**

Run: `grep -c "project_id uuid not null references projects(id)" server/schema.sql`
Expected: `2`

Run: `grep -c "context" server/schema.sql`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add server/schema.sql
git commit -m "$(cat <<'EOF'
feat: add projects table and project_id FKs to schema

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Slug helper (`server/slug.js`)

**Files:**
- Create: `server/slug.js`
- Test: `tests/backend/slug.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/backend/slug.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSlug } from '../../server/slug.js';

test('lowercases and hyphenates a name', () => {
  assert.equal(deriveSlug('Home Lab Ops'), 'home-lab-ops');
  assert.equal(deriveSlug('  Work!! '), 'work');
});

test('falls back to "project" for empty/symbol-only names', () => {
  assert.equal(deriveSlug('!!!'), 'project');
  assert.equal(deriveSlug(''), 'project');
});

test('appends a numeric suffix to avoid collisions', () => {
  assert.equal(deriveSlug('Work', ['work']), 'work-2');
  assert.equal(deriveSlug('Work', ['work', 'work-2']), 'work-3');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backend/slug.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/slug.js
export function deriveSlug(name, taken = []) {
  const base = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/backend/slug.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/slug.js tests/backend/slug.test.js
git commit -m "$(cat <<'EOF'
feat: add deriveSlug helper for project slugs

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Projects repository (`server/projectsRepository.js`)

**Files:**
- Create: `server/projectsRepository.js`
- Test: `tests/backend/projectsRepository.test.js`

The repository follows the existing pattern (`tasksRepository.js`): exported `build*` functions returning `{ text, values }`, a `normalizeProjectRow`, and a `createProjectsRepository(db)` factory.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/backend/projectsRepository.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProjectRow,
  buildListProjects,
  buildCreateProject,
  buildUpdateProject,
  buildArchiveProject,
  buildCountProjectDependents,
  buildDeleteProject,
} from '../../server/projectsRepository.js';

test('normalizeProjectRow maps snake_case to camelCase', () => {
  const row = {
    id: 'p1', name: 'Work', slug: 'work', status: 'active',
    sort_order: 1, created_at: 'c', updated_at: 'u',
  };
  assert.deepEqual(normalizeProjectRow(row), {
    id: 'p1', name: 'Work', slug: 'work', status: 'active',
    sortOrder: 1, createdAt: 'c', updatedAt: 'u',
  });
});

test('buildListProjects filters by status when provided', () => {
  const all = buildListProjects();
  assert.match(all.text, /from projects/);
  assert.equal(all.values.length, 0);

  const active = buildListProjects('active');
  assert.match(active.text, /where status = \$1/);
  assert.deepEqual(active.values, ['active']);
});

test('buildCreateProject inserts name, slug, status', () => {
  const q = buildCreateProject({ name: 'Work', slug: 'work', status: 'active' });
  assert.match(q.text, /insert into projects/);
  assert.deepEqual(q.values, ['Work', 'work', 'active']);
});

test('buildUpdateProject sets only provided fields', () => {
  const q = buildUpdateProject('p1', { name: 'Renamed', status: 'on-hold' });
  assert.match(q.text, /name = \$2/);
  assert.match(q.text, /status = \$3/);
  assert.deepEqual(q.values, ['p1', 'Renamed', 'on-hold']);
});

test('buildCountProjectDependents counts tasks + documents', () => {
  const q = buildCountProjectDependents('p1');
  assert.match(q.text, /from tasks/);
  assert.match(q.text, /from markdown_documents/);
  assert.deepEqual(q.values, ['p1']);
});

test('buildArchiveProject sets status archived', () => {
  const q = buildArchiveProject('p1');
  assert.match(q.text, /set status = 'archived'/);
  assert.deepEqual(q.values, ['p1']);
});

test('buildDeleteProject deletes by id', () => {
  const q = buildDeleteProject('p1');
  assert.match(q.text, /delete from projects/);
  assert.deepEqual(q.values, ['p1']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backend/projectsRepository.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/projectsRepository.js
import { deriveSlug } from './slug.js';

const UPDATE_COLUMN_MAP = {
  name: 'name',
  status: 'status',
  sortOrder: 'sort_order',
};

export function normalizeProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildListProjects(status) {
  if (status && status !== 'all') {
    return {
      text: `select * from projects where status = $1 order by sort_order, name`,
      values: [status],
    };
  }
  return { text: `select * from projects order by sort_order, name`, values: [] };
}

export function buildCreateProject({ name, slug, status = 'active' }) {
  return {
    text: `
      insert into projects (name, slug, status)
      values ($1, $2, $3)
      returning *
    `,
    values: [name, slug, status],
  };
}

export function buildUpdateProject(id, fields) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) throw new Error('No project fields provided');
  const assignments = entries.map(([key], index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`);
  return {
    text: `
      update projects
      set ${assignments.join(', ')}, updated_at = now()
      where id = $1
      returning *
    `,
    values: [id, ...entries.map(([, value]) => value)],
  };
}

export function buildArchiveProject(id) {
  return {
    text: `update projects set status = 'archived', updated_at = now() where id = $1 returning *`,
    values: [id],
  };
}

export function buildCountProjectDependents(id) {
  return {
    text: `
      select (
        (select count(*) from tasks where project_id = $1)
        + (select count(*) from markdown_documents where project_id = $1)
      )::int as count
    `,
    values: [id],
  };
}

export function buildDeleteProject(id) {
  return {
    text: `delete from projects where id = $1 returning *`,
    values: [id],
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createProjectsRepository(db) {
  return {
    async listProjects(status) {
      const q = buildListProjects(status);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeProjectRow);
    },
    async createProject({ name, status }) {
      const existing = await db.query('select slug from projects');
      const slug = deriveSlug(name, existing.rows.map((r) => r.slug));
      const q = buildCreateProject({ name, slug, status });
      const result = await db.query(q.text, q.values);
      return normalizeProjectRow(result.rows[0]);
    },
    async updateProject(id, fields) {
      const q = buildUpdateProject(id, fields);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
    async archiveProject(id) {
      const q = buildArchiveProject(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
    async countProjectDependents(id) {
      const q = buildCountProjectDependents(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? result.rows[0].count : 0;
    },
    async deleteProject(id) {
      const q = buildDeleteProject(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
    async resolveProject(idOrSlug) {
      const column = isUuid(idOrSlug) ? 'id' : 'slug';
      const result = await db.query(`select * from projects where ${column} = $1 limit 1`, [idOrSlug]);
      return result.rows[0] ? normalizeProjectRow(result.rows[0]) : null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/backend/projectsRepository.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/projectsRepository.js tests/backend/projectsRepository.test.js
git commit -m "$(cat <<'EOF'
feat: add projects repository (CRUD + slug + dependents + resolve)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Projects routes (`server/projectsRoutes.js`)

**Files:**
- Create: `server/projectsRoutes.js`
- Modify: `server/index.js` (register the routes)
- Test: `tests/backend/projectsRoutes.test.js`

Routes follow the `libraryRoutes.js` pattern: a `registerProjectsRoutes(app, options)` that takes an injectable `options.projectsRepository`.

- [ ] **Step 1: Write the failing test (route validation + handlers with a fake repo)**

```javascript
// tests/backend/projectsRoutes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerProjectsRoutes } from '../../server/projectsRoutes.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function fakeRepository(overrides = {}) {
  return {
    async listProjects(status) { return [{ id: PROJECT_ID, name: 'Work', slug: 'work', status: status || 'active', sortOrder: 0 }]; },
    async createProject({ name }) { return { id: PROJECT_ID, name, slug: 'work', status: 'active', sortOrder: 0 }; },
    async updateProject(id, fields) { return id === PROJECT_ID ? { id, name: 'Work', slug: 'work', status: 'active', sortOrder: 0, ...fields } : null; },
    async archiveProject(id) { return id === PROJECT_ID ? { id, name: 'Work', slug: 'work', status: 'archived', sortOrder: 0 } : null; },
    async countProjectDependents() { return 0; },
    async deleteProject(id) { return id === PROJECT_ID ? { id, name: 'Work', slug: 'work', status: 'active', sortOrder: 0 } : null; },
    ...overrides,
  };
}

async function build(overrides) {
  const app = Fastify();
  await registerProjectsRoutes(app, { projectsRepository: fakeRepository(overrides) });
  return app;
}

test('GET /api/projects lists projects', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json()[0].slug, 'work');
});

test('POST /api/projects creates with 201; rejects empty name', async () => {
  const app = await build();
  const ok = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Work' } });
  assert.equal(ok.statusCode, 201);
  const bad = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '  ' } });
  assert.equal(bad.statusCode, 400);
});

test('POST rejects invalid status', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X', status: 'bogus' } });
  assert.equal(res.statusCode, 400);
});

test('PATCH updates; 404 for missing; 400 for bad uuid', async () => {
  const app = await build();
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${PROJECT_ID}`, payload: { status: 'on-hold' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/projects/not-a-uuid', payload: { status: 'on-hold' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/projects/22222222-2222-4222-8222-222222222222', payload: { status: 'on-hold' } })).statusCode, 404);
});

test('DELETE archives the project', async () => {
  const app = await build();
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'archived');
});

test('DELETE /permanent succeeds only when empty (409 otherwise)', async () => {
  const empty = await build();
  assert.equal((await empty.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}/permanent` })).statusCode, 200);

  const busy = await build({ async countProjectDependents() { return 3; } });
  assert.equal((await busy.inject({ method: 'DELETE', url: `/api/projects/${PROJECT_ID}/permanent` })).statusCode, 409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backend/projectsRoutes.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// server/projectsRoutes.js
import { createProjectsRepository } from './projectsRepository.js';

const STATUSES = new Set(['active', 'on-hold', 'completed', 'archived']);

function isValidUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function registerProjectsRoutes(app, options = {}) {
  const repository = options.projectsRepository || app.projectsRepository || createProjectsRepository(app.db);

  app.get('/api/projects', async (request) => {
    return repository.listProjects(request.query.status);
  });

  app.post('/api/projects', async (request, reply) => {
    const body = request.body;
    if (!isPlainObject(body) || typeof body.name !== 'string' || body.name.trim() === '') {
      reply.code(400);
      return { message: 'name is required' };
    }
    if (body.status !== undefined && !STATUSES.has(body.status)) {
      reply.code(400);
      return { message: 'status is invalid' };
    }
    reply.code(201);
    return repository.createProject({ name: body.name.trim(), status: body.status });
  });

  app.patch('/api/projects/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const body = request.body;
    if (!isPlainObject(body)) {
      reply.code(400);
      return { message: 'project update is invalid' };
    }
    const fields = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        reply.code(400);
        return { message: 'name is invalid' };
      }
      fields.name = body.name.trim();
    }
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) {
        reply.code(400);
        return { message: 'status is invalid' };
      }
      fields.status = body.status;
    }
    if (body.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder)) {
        reply.code(400);
        return { message: 'sortOrder is invalid' };
      }
      fields.sortOrder = body.sortOrder;
    }
    if (Object.keys(fields).length === 0) {
      reply.code(400);
      return { message: 'project update requires at least one field' };
    }
    const project = await repository.updateProject(request.params.id, fields);
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    return project;
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const project = await repository.archiveProject(request.params.id);
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    return project;
  });

  app.delete('/api/projects/:id/permanent', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const dependents = await repository.countProjectDependents(request.params.id);
    if (dependents > 0) {
      reply.code(409);
      return { message: 'project still has tasks or documents' };
    }
    const project = await repository.deleteProject(request.params.id);
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    return project;
  });
}
```

- [ ] **Step 4: Register the routes in `server/index.js`**

After the line `import { registerLibraryRoutes } from './libraryRoutes.js';` add:
```javascript
import { registerProjectsRoutes } from './projectsRoutes.js';
```
After the line `await registerLibraryRoutes(app, options);` add:
```javascript
  await registerProjectsRoutes(app, options);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/backend/projectsRoutes.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/projectsRoutes.js server/index.js tests/backend/projectsRoutes.test.js
git commit -m "$(cat <<'EOF'
feat: add projects CRUD routes (archive + empty-only permanent delete)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Switch tasks repository from `context` to `project_id`

**Files:**
- Modify: `server/tasksRepository.js`
- Modify: `tests/backend/tasksRepository.test.js`

- [ ] **Step 1: Update the failing expectations in `tests/backend/tasksRepository.test.js`**

Find every occurrence of `context` in this test file and change task fixtures/expectations to use `projectId` (camelCase, value a project UUID) instead of `context`, and expect the SQL column `project_id`. Specifically:
- In any expected `build*` SQL, `context` becomes `project_id`.
- In `normalizeTaskRow` expectations, `context: ...` becomes `projectId: ...` sourced from `row.project_id`.
- `buildReplaceContextTasks(context, ...)` calls become `buildReplaceProjectTasks(projectId, ...)` and the SQL `where context = $1` becomes `where project_id = $1`.

Run: `node --test tests/backend/tasksRepository.test.js`
Expected: FAIL (expectations now reference project_id which the implementation doesn't produce yet).

- [ ] **Step 2: Update `server/tasksRepository.js`**

Make these exact replacements:

`ALLOWED_CREATE_FIELDS`:
```javascript
const ALLOWED_CREATE_FIELDS = ['title', 'description', 'priority', 'status', 'projectId', 'dueDate', 'sortOrder'];
```
`IMPORT_FIELDS`:
```javascript
const IMPORT_FIELDS = ['title', 'description', 'priority', 'status', 'projectId', 'dueDate', 'sortOrder', 'archivedAt'];
```
`UPDATE_COLUMN_MAP` — replace `context: 'context',` with:
```javascript
  projectId: 'project_id',
```
`normalizeTaskRow` — replace `context: row.context,` with:
```javascript
    projectId: row.project_id,
```
`buildCreateTask` SQL columns — change `(title, description, priority, status, context, due_date, sort_order)` to `(title, description, priority, status, project_id, due_date, sort_order)`.
`buildImportTasks` SQL columns — change `context` to `project_id` in the column list.
Rename `buildReplaceContextTasks` to `buildReplaceProjectTasks(projectId, tasks)`; in its SQL, `where context = $1` becomes `where project_id = $1`; the column list `context` becomes `project_id`; keep the `values: [projectId, ...]`.
In `buildListTaskDocuments` SQL, change `select d.id, d.title, d.document_type, d.context` to `select d.id, d.title, d.document_type, d.project_id` and the result mapping in `listTaskDocuments` (in `createTasksRepository`) `context: row.context,` to `projectId: row.project_id,`.
In `createTasksRepository`:
- `listTasks` filter: replace the `if (filters.context) { ... context = $... }` block with:
```javascript
      if (filters.projectId) {
        values.push(filters.projectId);
        clauses.push(`project_id = $${values.length}`);
      }
```
- `listTasks` ordering: change `order by context, status, sort_order, created_at` to `order by project_id, status, sort_order, created_at`.
- Rename `replaceContextTasks(context, tasks)` to `replaceProjectTasks(projectId, tasks)` calling `buildReplaceProjectTasks`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `node --test tests/backend/tasksRepository.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/tasksRepository.js tests/backend/tasksRepository.test.js
git commit -m "$(cat <<'EOF'
refactor: tasks repository uses project_id instead of context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Switch tasks routes from `context` to `project` (slug-or-id resolution)

**Files:**
- Modify: `server/tasksRoutes.js`
- Modify: `tests/backend/tasksRoutes.test.js`

The routes accept `project` (slug-or-id) in payloads and `?project=` in queries, resolve it to a `projectId` via the projects repository, and validate existence. Add a `projectsRepository` to the route options (defaulting to one built from `app.db`).

- [ ] **Step 1: Update `tests/backend/tasksRoutes.test.js`**

- Add a fake projects repository to the test app wiring with a `resolveProject(value)` that returns `{ id: PROJECT_UUID, slug: 'homelab', status: 'active' }` for known values and `null` otherwise, and pass it as `options.projectsRepository`.
- Change task fixtures and POST/PATCH payloads from `context: 'homelab'` to `project: 'homelab'` (slug) and assert the repository receives `projectId: PROJECT_UUID`.
- Change list assertions from `?context=` to `?project=`.
- Add a test: POST with an unknown `project` → 400 `{ message: 'project is invalid' }`.

Run: `node --test tests/backend/tasksRoutes.test.js`
Expected: FAIL.

- [ ] **Step 2: Update `server/tasksRoutes.js`**

- Remove `const CONTEXTS = new Set([...]);`.
- Add near the other imports:
```javascript
import { createProjectsRepository } from './projectsRepository.js';
```
- In `registerTasksRoutes`, after the existing repository line, add:
```javascript
  const projectsRepository = options.projectsRepository || app.projectsRepository || createProjectsRepository(app.db);

  async function resolveProjectId(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const project = await projectsRepository.resolveProject(String(value));
    return project ? project.id : null; // null signals "given but not found"
  }
```
- In `validateTaskPayload` (the create validator), replace the line `if (!CONTEXTS.has(payload.context)) return 'context is invalid';` with a presence check only:
```javascript
  if (typeof payload.project !== 'string' || payload.project.trim() === '') return 'project is required';
```
- In `validateTaskPatchPayload`, replace the `context` block with:
```javascript
  if (
    Object.prototype.hasOwnProperty.call(payload, 'project') &&
    (typeof payload.project !== 'string' || payload.project.trim() === '')
  ) {
    return 'project is invalid';
  }
```
- In `cleanTaskPayload`, replace `context: payload.context,` with `projectId: payload.projectId,` (the handler sets `payload.projectId` after resolution — see below).
- In `cleanTaskPatchPayload`, the `PATCH_FIELDS` array (defined near the top of the file) currently contains `'context'`; change it to `'projectId'`. The handler maps the incoming `project` → `projectId` before cleaning (below).
- In `duplicateKeyForTask`, replace `String(task.context || '')` with `String(task.projectId || '')`.
- In the POST `/api/tasks` handler: after validation passes, resolve the project and inject `projectId`:
```javascript
    const resolvedId = await resolveProjectId(request.body.project);
    if (resolvedId === null) { reply.code(400); return { message: 'project is invalid' }; }
    request.body.projectId = resolvedId;
```
  (Place this before `cleanTaskPayload(request.body)`.)
- In the PATCH `/api/tasks/:id` handler: if `project` is present, resolve it and set `projectId` before cleaning:
```javascript
    if (Object.prototype.hasOwnProperty.call(request.body, 'project')) {
      const resolvedId = await resolveProjectId(request.body.project);
      if (resolvedId === null) { reply.code(400); return { message: 'project is invalid' }; }
      request.body.projectId = resolvedId;
    }
```
- In the GET `/api/tasks` list handler, map the `project` query param to `projectId` for the repository:
```javascript
  app.get('/api/tasks', async request => {
    const projectId = request.query.project && request.query.project !== 'all'
      ? (await projectsRepository.resolveProject(String(request.query.project)))?.id
      : undefined;
    return repository.listTasks({ ...request.query, projectId });
  });
```
- Export route (`GET /api/tasks/export`) and import handlers currently key on `context`. Update the export to accept `?project=` (slug-or-id resolved; `all` = no filter) and the import envelope field `context` → `project` (resolved to `projectId` per task before insert). For the replace-mode call, use the renamed `repository.replaceProjectTasks(projectId, tasks)`. Validation: `validateTaskImportPayload` should resolve and require a valid `project` on the envelope; per-task `context` becomes `projectId` after resolution in `cleanTaskImportPayload`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `node --test tests/backend/tasksRoutes.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/tasksRoutes.js tests/backend/tasksRoutes.test.js
git commit -m "$(cat <<'EOF'
refactor: tasks routes accept project (slug-or-id) instead of context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Switch library repository + routes from `context` to `project`

**Files:**
- Modify: `server/libraryRepository.js`
- Modify: `server/libraryRoutes.js`
- Modify: the library backend tests (`tests/backend/libraryRepository.test.js` and any library route tests present)

Apply the SAME transformation as Tasks 5–6, mirrored for documents:

- [ ] **Step 1: Update the library backend test expectations**

Change `context` → `projectId` (camelCase) / `project_id` (SQL) in document fixtures, `build*`/normalize expectations, and list-filter assertions. For routes, payloads use `project` (slug), the fake `projectsRepository.resolveProject` returns a known id, and an unknown `project` yields 400.

Run the relevant library backend test file(s); Expected: FAIL.

- [ ] **Step 2: Update `server/libraryRepository.js`**

- In `normalizeDocumentRow` (or equivalent), map `projectId: row.project_id` instead of `context: row.context`.
- In `listDocuments`, replace the `if (filters.context) { ... context = $... }` filter block with a `project_id = $n` filter driven by `filters.projectId`.
- In create/update column lists, `context` → `project_id`; the create payload field is `projectId`.

- [ ] **Step 3: Update `server/libraryRoutes.js`**

- Remove `const CONTEXTS = new Set([...]);`.
- Import `createProjectsRepository` and build a `projectsRepository` exactly as in Task 6, with the same `resolveProjectId` helper.
- In `validateDocumentPayload`, replace the context check with the same `project` presence check (`'project is required'` on create; `'project is invalid'` on patch).
- Replace `context` in `PATCH_FIELDS` / `cleanDocumentPayload` / `cleanDocumentPatchPayload` with `projectId`.
- In the POST and PATCH handlers, resolve `request.body.project` → `request.body.projectId` (400 on unknown), mirroring Task 6.
- In `GET /api/library/documents`, map `request.query.project` (slug-or-id; `all` = none) → `projectId` for `repository.listDocuments`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/backend/libraryRepository.test.js` (and any library route test file)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/libraryRepository.js server/libraryRoutes.js tests/backend/libraryRepository.test.js
git commit -m "$(cat <<'EOF'
refactor: library repository and routes use project instead of context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Demo server — in-memory projects store

**Files:**
- Modify: `scripts/demo-server.js`

The demo server builds in-memory repositories and registers the real routes. It must gain a projects repository and switch tasks/docs to `project_id`.

- [ ] **Step 1: Add a seeded in-memory projects repository**

Near the other in-memory repositories, add a `projects` array seeded with three records (mirroring the schema seed):
```javascript
const sharedProjects = [
  { id: PERSONAL_ID, name: 'Personal', slug: 'personal', status: 'active', sortOrder: 0, createdAt: now(), updatedAt: now() },
  { id: WORK_ID, name: 'Work', slug: 'work', status: 'active', sortOrder: 1, createdAt: now(), updatedAt: now() },
  { id: HOMELAB_ID, name: 'Homelab', slug: 'homelab', status: 'active', sortOrder: 2, createdAt: now(), updatedAt: now() },
];
```
(Use fixed UUID constants for the three ids and a `now()` helper consistent with the file's existing style. Reuse the same ids when seeding demo tasks/docs below.)

Add `createMemoryProjectsRepository(projects)` implementing the same methods as `createProjectsRepository` does (`listProjects`, `createProject` using `deriveSlug` imported from `../server/slug.js`, `updateProject`, `archiveProject`, `countProjectDependents` counting demo tasks+docs, `deleteProject`, `resolveProject` by id-or-slug).

- [ ] **Step 2: Switch demo tasks/docs to `projectId` and seed against the project ids**

- In the demo task/document seed objects, replace `context: 'homelab'` (etc.) with `projectId: HOMELAB_ID` (etc.).
- In the in-memory `listTasks` / `listDocuments`, replace the `context` filter with a `projectId` filter.
- In `listTaskDocuments`, return `projectId` instead of `context`.
- In `linkTaskDocument`/`unlinkTaskDocument` no change needed (they key on ids).

- [ ] **Step 3: Register the projects routes in the demo app**

Pass the new repository through `buildApp` options the same way the existing repositories are passed (`projectsRepository: createMemoryProjectsRepository(sharedProjects)`), so `registerProjectsRoutes` (already wired in `index.js`/`buildApp`) uses it. If the demo server constructs the app via `buildApp`, ensure the `projectsRepository` option is included.

- [ ] **Step 4: Verify the demo boots and serves projects**

Run:
```bash
npm run demo > /tmp/demo.log 2>&1 &
until curl -sf http://127.0.0.1:3100/healthz >/dev/null; do sleep 0.5; done
curl -s http://127.0.0.1:3100/api/projects | head -c 400; echo
curl -s "http://127.0.0.1:3100/api/tasks?project=homelab" | head -c 200; echo
pkill -f scripts/demo-server.js
```
Expected: `/api/projects` returns the three seeded projects; the task list returns homelab tasks with a `projectId` field.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-server.js
git commit -m "$(cat <<'EOF'
feat: demo server gains in-memory projects store and project filtering

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full backend verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite and the syntax check**

Run: `npm test && npm run check`
Expected: all tests pass (new `slug`, `projectsRepository`, `projectsRoutes` files + updated tasks/library backend tests); `npm run check` exits 0.

- [ ] **Step 2: Confirm no stray `context` remains in backend source**

Run: `grep -rn "context" server/ scripts/demo-server.js | grep -v "// " | head`
Expected: no references to the old task/document `context` field remain (matches in unrelated words/comments are fine; there should be no `context` columns, filters, or validators).

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/projects-model
```

---

## Self-Review

**1. Spec coverage (backend portions):**
- `projects` table + lifecycle + slug + FKs + seed → Task 1. ✔
- Projects CRUD API (list/create/patch/archive/permanent-when-empty) → Tasks 3–4. ✔
- Slug auto-derivation + uniqueness → Tasks 2–3. ✔
- tasks/docs use `project_id`; `project` slug-or-id resolution; `project=all` aggregate; `CONTEXTS` removed → Tasks 5–7. ✔
- Import/export keyed on `project` → Task 6 (tasks) and Task 7 (docs). ✔
- Demo-server parity → Task 8. ✔
- Backend tests for all of the above → within each task + Task 9. ✔
- Frontend and MCP are explicitly OUT of this phase (separate plans). ✔

**2. Placeholder scan:** New files (`slug.js`, `projectsRepository.js`, `projectsRoutes.js`) and their tests contain full code. Modification tasks (5–8) describe exact symbol-level edits against code shown here; the library/demo edits mirror the fully-shown task edits. No "TBD"/"add validation"-style placeholders.

**3. Type/name consistency:** The camelCase field is `projectId` everywhere (repos/routes/tests); the SQL column is `project_id`; the slug-or-id request field is `project`; the resolver is `projectsRepository.resolveProject` returning a normalized project (with `.id`); the renamed builder/method pair is `buildReplaceProjectTasks` / `replaceProjectTasks`. Project status enum is `active | on-hold | completed | archived` in the schema, repository tests, and route validator.
