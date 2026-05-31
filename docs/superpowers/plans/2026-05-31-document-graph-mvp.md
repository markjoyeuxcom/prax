# Document Graph MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed, directional document↔document links (`derived-from`, `supersedes`) + backlinks + detail-by-id routes, exposed over the HTTP API and MCP, with the in-memory demo mirror and tests.

**Architecture:** A new `document_links` table (mirroring `task_documents`, but directed + typed) with a dedicated `documentLinksRepository`; new library routes for detail-by-id and links; three new MCP tools + client methods; the demo server's in-memory mirror; and doc/regression updates. No export serialization, no maintenance loop, no UI.

**Tech Stack:** Node + Fastify + plain `pg`, Zod (MCP), `node --test`. No new dependencies.

---

## Conventions in this codebase (read once)

- **Repository pattern:** pure `build*(args) → { text, values }` functions + a `createXRepository(db)` that calls `db.query(text, values)` and maps rows. See `server/tasksRepository.js` (`buildLinkTaskDocument`, `createTasksRepository`).
- **Routes:** `register*Routes(app, options)`; repo resolved as `options.xRepository || app.xRepository || createXRepository(app.db)`. UUID guard via a local `isValidUuid`; errors are `reply.code(n); return { message: '...' }`.
- **`buildApp(options)`** (`server/index.js`) decorates repos from `options` and passes `options` to each `register*Routes`. Tests call `buildApp({ skipDb: true, ...fakeRepos })` and use `app.inject(...)`.
- **MCP tools:** factory `createXTools(client)` returning `[{ name, title, description, inputSchema (Zod map), annotations?, handler }]`; `handler` uses `withErrorHandling`, `isValidUuid`, `okResult`/`errorResult`, `capResults`. Registered in `mcp/server.js`. Client methods in `mcp/moomoraClient.js`.
- **Test runner:** `npm test` → `node --test` (auto-discovers `tests/**/*.test.js`). Run one file: `node --test tests/backend/<file>.test.js`. Full suite is currently **592 pass / 0 fail**; keep it green.
- **Relations** are validated in app code (no DB `CHECK`): the single source of truth is `DOCUMENT_LINK_RELATIONS` exported from `server/documentLinksRepository.js`.

---

## Task 1: `document_links` schema + repository

**Files:**
- Create: `server/migrations/0002_add_document_links.sql`
- Create: `server/documentLinksRepository.js`
- Create: `tests/backend/documentLinksRepository.test.js`

- [ ] **Step 1: Write the migration**

Create `server/migrations/0002_add_document_links.sql`:

```sql
create table if not exists document_links (
  source_document_id uuid not null references markdown_documents(id) on delete cascade,
  target_document_id uuid not null references markdown_documents(id) on delete cascade,
  relation text not null,
  created_at timestamptz not null default now(),
  primary key (source_document_id, target_document_id, relation),
  check (source_document_id <> target_document_id)
);

create index if not exists idx_document_links_target on document_links (target_document_id, relation);
```

- [ ] **Step 2: Write the failing repository tests**

Create `tests/backend/documentLinksRepository.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_LINK_RELATIONS,
  buildLinkDocuments,
  buildUnlinkDocuments,
  buildListDocumentLinks,
  normalizeLinkRow,
  createDocumentLinksRepository,
} from '../../server/documentLinksRepository.js';

const SRC = '11111111-1111-4111-8111-111111111111';
const TGT = '22222222-2222-4222-8222-222222222222';

test('DOCUMENT_LINK_RELATIONS is the frozen MVP set', () => {
  assert.deepEqual(DOCUMENT_LINK_RELATIONS, ['derived-from', 'supersedes']);
});

test('buildLinkDocuments guards both endpoints are live and is idempotent', () => {
  const q = buildLinkDocuments(SRC, TGT, 'derived-from');
  assert.match(q.text, /insert into document_links/);
  assert.match(q.text, /archived_at is null/);
  assert.match(q.text, /on conflict .* do nothing/);
  assert.deepEqual(q.values, [SRC, TGT, 'derived-from']);
});

test('buildListDocumentLinks selects outbound, inbound, or both', () => {
  assert.match(buildListDocumentLinks(SRC, 'outbound').text, /source_document_id = \$1/);
  assert.doesNotMatch(buildListDocumentLinks(SRC, 'outbound').text, /union all/);
  assert.match(buildListDocumentLinks(SRC, 'inbound').text, /target_document_id = \$1/);
  assert.match(buildListDocumentLinks(SRC, 'both').text, /union all/);
});

test('normalizeLinkRow maps a row to the public link shape', () => {
  const row = { id: TGT, title: 'Restore', document_type: 'runbook', project_id: 'pid', relation: 'derived-from', direction: 'outbound' };
  assert.deepEqual(normalizeLinkRow(row), {
    documentId: TGT, title: 'Restore', documentType: 'runbook', projectId: 'pid',
    relation: 'derived-from', direction: 'outbound',
  });
});

test('linkDocuments returns linked / alreadyLinked / not-linked', async () => {
  const inserted = { query: async () => ({ rows: [{ source_document_id: SRC }] }) };
  assert.deepEqual(await createDocumentLinksRepository(inserted).linkDocuments(SRC, TGT, 'derived-from'), { linked: true });

  let call = 0;
  const existing = { query: async () => (call++ === 0 ? { rows: [] } : { rows: [{ '?column?': 1 }] }) };
  assert.deepEqual(await createDocumentLinksRepository(existing).linkDocuments(SRC, TGT, 'derived-from'), { linked: true, alreadyLinked: true });

  const missing = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await createDocumentLinksRepository(missing).linkDocuments(SRC, TGT, 'derived-from'), { linked: false });
});

test('unlinkDocuments reports whether a row was removed', async () => {
  const removed = { query: async () => ({ rows: [{ source_document_id: SRC }] }) };
  assert.equal(await createDocumentLinksRepository(removed).unlinkDocuments(SRC, TGT, 'derived-from'), true);
  const none = { query: async () => ({ rows: [] }) };
  assert.equal(await createDocumentLinksRepository(none).unlinkDocuments(SRC, TGT, 'derived-from'), false);
});

test('listDocumentLinks maps rows and defaults direction to both', async () => {
  const calls = [];
  const db = { query: async (text, values) => { calls.push({ text, values }); return { rows: [{ id: TGT, title: 'R', document_type: 'note', project_id: 'p', relation: 'supersedes', direction: 'inbound' }] }; } };
  const out = await createDocumentLinksRepository(db).listDocumentLinks(SRC);
  assert.match(calls[0].text, /union all/); // default 'both'
  assert.deepEqual(out, [{ documentId: TGT, title: 'R', documentType: 'note', projectId: 'p', relation: 'supersedes', direction: 'inbound' }]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/backend/documentLinksRepository.test.js`
Expected: FAIL (module `server/documentLinksRepository.js` does not exist).

- [ ] **Step 4: Implement the repository**

Create `server/documentLinksRepository.js`:

```js
export const DOCUMENT_LINK_RELATIONS = ['derived-from', 'supersedes'];

export function buildLinkDocuments(sourceId, targetId, relation) {
  return {
    text: `
      insert into document_links (source_document_id, target_document_id, relation)
      select $1, $2, $3
      where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
        and exists (select 1 from markdown_documents where id = $2 and archived_at is null)
      on conflict (source_document_id, target_document_id, relation) do nothing
      returning source_document_id, target_document_id, relation
    `,
    values: [sourceId, targetId, relation],
  };
}

export function buildLinkExists(sourceId, targetId, relation) {
  return {
    text: `
      select 1
      from document_links dl
      join markdown_documents s on s.id = dl.source_document_id and s.archived_at is null
      join markdown_documents t on t.id = dl.target_document_id and t.archived_at is null
      where dl.source_document_id = $1 and dl.target_document_id = $2 and dl.relation = $3
    `,
    values: [sourceId, targetId, relation],
  };
}

export function buildUnlinkDocuments(sourceId, targetId, relation) {
  return {
    text: `delete from document_links where source_document_id = $1 and target_document_id = $2 and relation = $3 returning source_document_id`,
    values: [sourceId, targetId, relation],
  };
}

export function buildListDocumentLinks(documentId, direction = 'both') {
  const outbound = `
    select dl.relation, 'outbound' as direction, d.id, d.title, d.document_type, d.project_id
    from document_links dl
    join markdown_documents d on d.id = dl.target_document_id and d.archived_at is null
    where dl.source_document_id = $1`;
  const inbound = `
    select dl.relation, 'inbound' as direction, d.id, d.title, d.document_type, d.project_id
    from document_links dl
    join markdown_documents d on d.id = dl.source_document_id and d.archived_at is null
    where dl.target_document_id = $1`;
  let text;
  if (direction === 'outbound') text = outbound;
  else if (direction === 'inbound') text = inbound;
  else text = `${outbound}\n    union all${inbound}`;
  return { text: `${text}\n    order by relation, direction`, values: [documentId] };
}

export function normalizeLinkRow(row) {
  return {
    documentId: row.id,
    title: row.title,
    documentType: row.document_type,
    projectId: row.project_id,
    relation: row.relation,
    direction: row.direction,
  };
}

export function createDocumentLinksRepository(db) {
  return {
    async linkDocuments(sourceId, targetId, relation) {
      const query = buildLinkDocuments(sourceId, targetId, relation);
      const result = await db.query(query.text, query.values);
      if (result.rows.length > 0) return { linked: true };
      const existsQuery = buildLinkExists(sourceId, targetId, relation);
      const existsResult = await db.query(existsQuery.text, existsQuery.values);
      if (existsResult.rows.length > 0) return { linked: true, alreadyLinked: true };
      return { linked: false };
    },
    async unlinkDocuments(sourceId, targetId, relation) {
      const query = buildUnlinkDocuments(sourceId, targetId, relation);
      const result = await db.query(query.text, query.values);
      return result.rows.length > 0;
    },
    async listDocumentLinks(documentId, direction = 'both') {
      const query = buildListDocumentLinks(documentId, direction);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeLinkRow);
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/backend/documentLinksRepository.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Add the new module to `npm run check`**

In `package.json`, the `check` script chains `node --check` calls. Append ` && node --check server/documentLinksRepository.js` to the end of the `check` value. Then run `npm run check` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/0002_add_document_links.sql server/documentLinksRepository.js tests/backend/documentLinksRepository.test.js package.json
git commit -m "feat: document_links schema + repository"
```

---

## Task 2: `libraryRepository.getDocument` (fetch-by-id)

**Files:**
- Modify: `server/libraryRepository.js`
- Test: `tests/backend/libraryRepository.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/backend/libraryRepository.test.js`:

```js
import { buildGetDocument } from '../../server/libraryRepository.js';

test('buildGetDocument selects a single document by id', () => {
  const q = buildGetDocument('22222222-2222-4222-8222-222222222222');
  assert.match(q.text, /select \* from markdown_documents where id = \$1/);
  assert.deepEqual(q.values, ['22222222-2222-4222-8222-222222222222']);
});
```

(If `tests/backend/libraryRepository.test.js` already imports `test`/`assert`, reuse those imports — do not redeclare. Add the `buildGetDocument` import to the existing import line from `../../server/libraryRepository.js` if one exists.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/backend/libraryRepository.test.js`
Expected: FAIL (`buildGetDocument` is not exported).

- [ ] **Step 3: Implement**

In `server/libraryRepository.js`, add the builder near the other `build*` exports:

```js
export function buildGetDocument(id) {
  return { text: 'select * from markdown_documents where id = $1 limit 1', values: [id] };
}
```

And add a `getDocument` method inside the object returned by `createLibraryRepository(db)` (alongside `listDocuments`):

```js
    async getDocument(id) {
      const query = buildGetDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },
```

(`normalizeDocumentRow` is already defined/exported in this file.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/backend/libraryRepository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/libraryRepository.js tests/backend/libraryRepository.test.js
git commit -m "feat: libraryRepository.getDocument fetch-by-id"
```

---

## Task 3: HTTP routes — detail-by-id + document links

**Files:**
- Modify: `server/index.js` (decorate `documentLinksRepository`)
- Modify: `server/libraryRoutes.js` (detail + link routes + repo wiring)
- Modify: `server/tasksRoutes.js` (task detail route)
- Create: `tests/backend/documentLinksRoutes.test.js`
- Create: `tests/backend/detailRoutes.test.js`

- [ ] **Step 1: Write the failing route tests**

Create `tests/backend/documentLinksRoutes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';

function createFakeDocumentLinksRepository() {
  const links = []; // { sourceId, targetId, relation }
  const live = new Set([DOC_A, DOC_B]);
  return {
    _links: links,
    async linkDocuments(sourceId, targetId, relation) {
      if (!live.has(sourceId) || !live.has(targetId)) return { linked: false };
      if (links.some(l => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation)) {
        return { linked: true, alreadyLinked: true };
      }
      links.push({ sourceId, targetId, relation });
      return { linked: true };
    },
    async unlinkDocuments(sourceId, targetId, relation) {
      const i = links.findIndex(l => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation);
      if (i < 0) return false;
      links.splice(i, 1);
      return true;
    },
    async listDocumentLinks(documentId, direction = 'both') {
      const out = [];
      if (direction !== 'inbound') {
        for (const l of links.filter(l => l.sourceId === documentId)) {
          out.push({ documentId: l.targetId, title: 't', documentType: 'note', projectId: 'p', relation: l.relation, direction: 'outbound' });
        }
      }
      if (direction !== 'outbound') {
        for (const l of links.filter(l => l.targetId === documentId)) {
          out.push({ documentId: l.sourceId, title: 't', documentType: 'note', projectId: 'p', relation: l.relation, direction: 'inbound' });
        }
      }
      return out;
    },
  };
}

function build() {
  return buildApp({
    skipDb: true,
    libraryRepository: { async getDocument() { return null; } },
    projectsRepository: { async resolveProject() { return null; } },
    documentLinksRepository: createFakeDocumentLinksRepository(),
  });
}

test('POST link returns 201 then 200 on repeat, and lists outbound', async () => {
  const app = await build();
  const first = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'derived-from' } });
  assert.equal(first.statusCode, 201);
  assert.deepEqual(first.json(), [{ documentId: DOC_B, title: 't', documentType: 'note', projectId: 'p', relation: 'derived-from', direction: 'outbound' }]);

  const again = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'derived-from' } });
  assert.equal(again.statusCode, 200);
  await app.close();
});

test('POST link rejects bad uuid, bad relation, and self-link', async () => {
  const app = await build();
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: 'bad', relation: 'derived-from' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'relates-to' } })).statusCode, 400);
  const selfLink = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_A, relation: 'derived-from' } });
  assert.equal(selfLink.statusCode, 400);
  assert.match(selfLink.json().message, /itself/);
  await app.close();
});

test('POST link returns 404 when an endpoint is missing', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: MISSING, relation: 'supersedes' } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().message, 'document not found');
  await app.close();
});

test('GET links honours direction and DELETE removes', async () => {
  const app = await build();
  await app.inject({ method: 'POST', url: `/api/library/documents/${DOC_A}/links`, payload: { targetId: DOC_B, relation: 'derived-from' } });

  const outbound = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_A}/links?direction=outbound` });
  assert.equal(outbound.json().length, 1);
  const inboundOnB = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_B}/links?direction=inbound` });
  assert.equal(inboundOnB.json()[0].direction, 'inbound');

  const badDir = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC_A}/links?direction=sideways` });
  assert.equal(badDir.statusCode, 400);

  const del = await app.inject({ method: 'DELETE', url: `/api/library/documents/${DOC_A}/links/${DOC_B}?relation=derived-from` });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.json(), []);
  const delAgain = await app.inject({ method: 'DELETE', url: `/api/library/documents/${DOC_A}/links/${DOC_B}?relation=derived-from` });
  assert.equal(delAgain.statusCode, 404);
  await app.close();
});
```

Create `tests/backend/detailRoutes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const ID = '11111111-1111-4111-8111-111111111111';
const MISSING = '22222222-2222-4222-8222-222222222222';

test('GET /api/library/documents/:id returns the document or 404/400', async () => {
  const app = await buildApp({
    skipDb: true,
    libraryRepository: { async getDocument(id) { return id === ID ? { id, title: 'Doc' } : null; } },
    projectsRepository: { async resolveProject() { return null; } },
    documentLinksRepository: { async listDocumentLinks() { return []; } },
  });
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${ID}` })).json().title, 'Doc');
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${MISSING}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents/not-a-uuid' })).statusCode, 400);
  await app.close();
});

test('GET /api/tasks/:id returns the task or 404/400', async () => {
  const app = await buildApp({
    skipDb: true,
    tasksRepository: { async getTask(id) { return id === ID ? { id, title: 'Task' } : null; } },
    projectsRepository: { async resolveProject() { return null; } },
  });
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${ID}` })).json().title, 'Task');
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${MISSING}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/tasks/not-a-uuid' })).statusCode, 400);
  await app.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/backend/documentLinksRoutes.test.js tests/backend/detailRoutes.test.js`
Expected: FAIL (routes 404 / repository undefined).

- [ ] **Step 3: Wire the repository in `server/index.js`**

After the existing `app.decorate('checklistRepository', ...)` line, add:

```js
  app.decorate('documentLinksRepository', options.documentLinksRepository || null);
```

- [ ] **Step 4: Add the library routes**

In `server/libraryRoutes.js`, add the import at the top (next to the other repository imports):

```js
import { createDocumentLinksRepository, DOCUMENT_LINK_RELATIONS } from './documentLinksRepository.js';
```

Inside `registerLibraryRoutes(app, options)`, after the existing `projectsRepository` resolution line, add:

```js
  const documentLinksRepository = options.documentLinksRepository || app.documentLinksRepository || createDocumentLinksRepository(app.db);
```

Then add these route handlers (after the existing document routes, before the closing of the function):

```js
  app.get('/api/library/documents/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const document = await repository.getDocument(request.params.id);
    if (!document) { reply.code(404); return { message: 'document not found' }; }
    return document;
  });

  app.get('/api/library/documents/:id/links', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const direction = request.query.direction || 'both';
    if (!['outbound', 'inbound', 'both'].includes(direction)) { reply.code(400); return { message: 'direction is invalid' }; }
    return documentLinksRepository.listDocumentLinks(request.params.id, direction);
  });

  app.post('/api/library/documents/:id/links', async (request, reply) => {
    const sourceId = request.params.id;
    const { targetId, relation } = request.body || {};
    if (!isValidUuid(sourceId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(targetId)) { reply.code(400); return { message: 'targetId is invalid' }; }
    if (!DOCUMENT_LINK_RELATIONS.includes(relation)) { reply.code(400); return { message: 'relation is invalid' }; }
    if (sourceId === targetId) { reply.code(400); return { message: 'a document cannot link to itself' }; }
    const result = await documentLinksRepository.linkDocuments(sourceId, targetId, relation);
    if (!result.linked) { reply.code(404); return { message: 'document not found' }; }
    reply.code(result.alreadyLinked ? 200 : 201);
    return documentLinksRepository.listDocumentLinks(sourceId, 'outbound');
  });

  app.delete('/api/library/documents/:id/links/:targetId', async (request, reply) => {
    const sourceId = request.params.id;
    const { targetId } = request.params;
    const relation = request.query.relation;
    if (!isValidUuid(sourceId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(targetId)) { reply.code(400); return { message: 'targetId is invalid' }; }
    if (!DOCUMENT_LINK_RELATIONS.includes(relation)) { reply.code(400); return { message: 'relation is invalid' }; }
    const removed = await documentLinksRepository.unlinkDocuments(sourceId, targetId, relation);
    if (!removed) { reply.code(404); return { message: 'link not found' }; }
    return documentLinksRepository.listDocumentLinks(sourceId, 'outbound');
  });
```

- [ ] **Step 5: Add the task detail route**

In `server/tasksRoutes.js`, inside `registerTasksRoutes`, add (the file already has a local `isValidUuid` and resolves `repository` with a `getTask` method):

```js
  app.get('/api/tasks/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    const task = await repository.getTask(request.params.id);
    if (!task) { reply.code(404); return { message: 'task not found' }; }
    return task;
  });
```

Note: Fastify routes static paths (`/api/tasks/export`, `/api/tasks/board-extras`) ahead of the parametric `/api/tasks/:id`, so existing routes are unaffected.

- [ ] **Step 6: Run to verify they pass**

Run: `node --test tests/backend/documentLinksRoutes.test.js tests/backend/detailRoutes.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full backend suite (no regressions)**

Run: `npm test`
Expected: all pass (previous 592 + the new tests).

- [ ] **Step 8: Commit**

```bash
git add server/index.js server/libraryRoutes.js server/tasksRoutes.js tests/backend/documentLinksRoutes.test.js tests/backend/detailRoutes.test.js
git commit -m "feat: detail-by-id and document-link HTTP routes"
```

---

## Task 4: MCP tools + client

**Files:**
- Create: `mcp/tools/documentLinks.js`
- Modify: `mcp/server.js`
- Modify: `mcp/moomoraClient.js`
- Create: `tests/mcp/documentLinksTools.test.js`
- Modify: `tests/mcp/moomoraClient.test.js` (update `getDocument`/`getTask` expectations)

- [ ] **Step 1: Write the failing MCP tool tests**

Create `tests/mcp/documentLinksTools.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentLinkTools } from '../../mcp/tools/documentLinks.js';

function byName(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} should exist`);
  return t;
}

const SRC = '11111111-1111-4111-8111-111111111111';
const TGT = '22222222-2222-4222-8222-222222222222';

test('exposes the three document-link tools', () => {
  const names = createDocumentLinkTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['link_documents', 'list_document_links', 'unlink_documents']);
});

test('list_document_links validates uuid, passes direction, caps at 20', async () => {
  let received;
  const many = Array.from({ length: 25 }, (_, i) => ({ documentId: `d-${i}` }));
  const client = { listDocumentLinks: async (id, dir) => { received = [id, dir]; return many; } };
  const tool = byName(createDocumentLinkTools(client), 'list_document_links');
  assert.equal((await tool.handler({ documentId: 'bad' })).isError, true);
  const res = await tool.handler({ documentId: SRC, direction: 'inbound' });
  assert.deepEqual(received, [SRC, 'inbound']);
  assert.equal(JSON.parse(res.content[0].text).length, 20);
});

test('link_documents validates both uuids then returns a stable shape', async () => {
  let received;
  const client = { linkDocuments: async (s, t, r) => { received = [s, t, r]; return [{ documentId: TGT }]; } };
  const tool = byName(createDocumentLinkTools(client), 'link_documents');
  assert.match((await tool.handler({ sourceId: 'bad', targetId: TGT, relation: 'derived-from' })).content[0].text, /valid UUID/);
  const res = await tool.handler({ sourceId: SRC, targetId: TGT, relation: 'derived-from' });
  assert.deepEqual(received, [SRC, TGT, 'derived-from']);
  assert.deepEqual(JSON.parse(res.content[0].text), {
    linked: true, sourceId: SRC, targetId: TGT, relation: 'derived-from', links: [{ documentId: TGT }],
  });
});

test('unlink_documents validates uuids and reports success', async () => {
  let received;
  const client = { unlinkDocuments: async (s, t, r) => { received = [s, t, r]; return null; } };
  const tool = byName(createDocumentLinkTools(client), 'unlink_documents');
  assert.match((await tool.handler({ sourceId: 'bad', targetId: TGT, relation: 'supersedes' })).content[0].text, /valid UUID/);
  const res = await tool.handler({ sourceId: SRC, targetId: TGT, relation: 'supersedes' });
  assert.deepEqual(received, [SRC, TGT, 'supersedes']);
  assert.deepEqual(JSON.parse(res.content[0].text), { unlinked: true, sourceId: SRC, targetId: TGT, relation: 'supersedes' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/mcp/documentLinksTools.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the MCP tools**

Create `mcp/tools/documentLinks.js`:

```js
import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

const RELATION = z.enum(['derived-from', 'supersedes']);
const DIRECTION = z.enum(['outbound', 'inbound', 'both']);

export function createDocumentLinkTools(client) {
  return [
    {
      name: 'list_document_links',
      title: 'List document links',
      description:
        'List documents linked to a document. direction: outbound (this derives-from/supersedes those), inbound (those derive-from/supersede this), or both (default).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        documentId: z.string().describe('Document UUID.'),
        direction: DIRECTION.optional().describe('outbound | inbound | both (default both).'),
      },
      handler: withErrorHandling(async ({ documentId, direction }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        const links = await client.listDocumentLinks(documentId, direction);
        return okResult(capResults(links ?? []));
      }),
    },
    {
      name: 'link_documents',
      title: 'Link documents',
      description:
        'Create a typed, directional link from one document to another. relation: derived-from (source distilled from target) or supersedes (source replaces target).',
      inputSchema: {
        sourceId: z.string().describe('Source document UUID.'),
        targetId: z.string().describe('Target document UUID.'),
        relation: RELATION,
      },
      handler: withErrorHandling(async ({ sourceId, targetId, relation }) => {
        if (!isValidUuid(sourceId)) return errorResult('sourceId must be a valid UUID.');
        if (!isValidUuid(targetId)) return errorResult('targetId must be a valid UUID.');
        const result = await client.linkDocuments(sourceId, targetId, relation);
        return okResult({
          linked: true,
          sourceId,
          targetId,
          relation,
          links: Array.isArray(result) ? result : [],
        });
      }),
    },
    {
      name: 'unlink_documents',
      title: 'Unlink documents',
      description: 'Remove a typed link between two documents.',
      inputSchema: {
        sourceId: z.string().describe('Source document UUID.'),
        targetId: z.string().describe('Target document UUID.'),
        relation: RELATION,
      },
      handler: withErrorHandling(async ({ sourceId, targetId, relation }) => {
        if (!isValidUuid(sourceId)) return errorResult('sourceId must be a valid UUID.');
        if (!isValidUuid(targetId)) return errorResult('targetId must be a valid UUID.');
        await client.unlinkDocuments(sourceId, targetId, relation);
        return okResult({ unlinked: true, sourceId, targetId, relation });
      }),
    },
  ];
}
```

- [ ] **Step 4: Register the tools in `mcp/server.js`**

Add the import next to the other tool imports:

```js
import { createDocumentLinkTools } from './tools/documentLinks.js';
```

And add to the `tools` array (after `...createLinkTools(apiClient),`):

```js
    ...createDocumentLinkTools(apiClient),
```

- [ ] **Step 5: Add client methods + `getOrNull`, and switch `getDocument`/`getTask`**

In `mcp/moomoraClient.js`, add a `getOrNull` helper right after the `patchOrNull` function:

```js
  async function getOrNull(path) {
    try {
      return await request('GET', path);
    } catch (err) {
      if (err instanceof MoomoraApiError && err.status === 404) return null;
      throw err;
    }
  }
```

Replace the existing `getDocument` and `getTask` methods (the list-and-filter versions) with:

```js
    getDocument: (id) => getOrNull(`/api/library/documents/${id}`),
```
```js
    getTask: (id) => getOrNull(`/api/tasks/${id}`),
```

And add these three methods to the returned object (next to `listTaskDocuments`/`linkTaskDocument`):

```js
    listDocumentLinks: (documentId, direction) =>
      request('GET', `/api/library/documents/${documentId}/links`, { query: { direction } }),

    linkDocuments: (sourceId, targetId, relation) =>
      request('POST', `/api/library/documents/${sourceId}/links`, { body: { targetId, relation } }),

    unlinkDocuments: (sourceId, targetId, relation) =>
      request('DELETE', `/api/library/documents/${sourceId}/links/${targetId}`, { query: { relation } }),
```

- [ ] **Step 6: Update `tests/mcp/moomoraClient.test.js`**

Open `tests/mcp/moomoraClient.test.js`. Find any test asserting that `getDocument`/`getTask` fetch the **list** (`/api/library/documents` or `/api/tasks` with no id) and filter in memory. Update those to expect a direct `GET /api/library/documents/<id>` / `GET /api/tasks/<id>` and a `null` return on a 404. Concretely, a stub `fetch` should now be asserted to receive the id-suffixed path. If the existing tests only exercise other methods, add this test:

```js
test('getDocument and getTask fetch by id and return null on 404', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/api/library/documents/' + ID)) return new Response(JSON.stringify({ id: ID }), { status: 200 });
    return new Response('', { status: 404 });
  };
  const client = createMoomoraClient({ baseUrl: 'http://x', fetch });
  assert.deepEqual(await client.getDocument(ID), { id: ID });
  assert.equal(await client.getTask(ID), null);
  assert.ok(calls.some((u) => u.endsWith('/api/library/documents/' + ID)));
});
```

(Match the file's existing helpers/constants — reuse its `createMoomoraClient` import, its `ID` constant or define one, and its `Response`/fetch-stub style. If it stubs fetch differently, mirror that style rather than the above verbatim.)

- [ ] **Step 7: Run the MCP tests**

Run: `node --test tests/mcp/documentLinksTools.test.js tests/mcp/moomoraClient.test.js tests/mcp/server.test.js`
Expected: PASS. (`server.test.js` confirms the registry still builds with the new tools.)

- [ ] **Step 8: Commit**

```bash
git add mcp/tools/documentLinks.js mcp/server.js mcp/moomoraClient.js tests/mcp/documentLinksTools.test.js tests/mcp/moomoraClient.test.js
git commit -m "feat: MCP document-link tools + fetch-by-id client"
```

---

## Task 5: Demo server in-memory mirror

**Files:**
- Modify: `scripts/demo-server.js`

- [ ] **Step 1: Add a `getDocument` to the in-memory library repo**

In `scripts/demo-server.js`, inside `createMemoryLibraryRepository(documents)`'s returned object, add:

```js
    async getDocument(id) {
      const doc = documents.find((d) => d.id === id);
      return doc ? { ...doc } : null;
    },
```

- [ ] **Step 2: Add an in-memory document-links repository**

Add this factory near the other `createMemory*Repository` functions:

```js
function createMemoryDocumentLinksRepository(documentsRef) {
  const links = []; // { sourceId, targetId, relation }
  const isLive = (id) => documentsRef.some((d) => d.id === id && !d.archivedAt);
  const toRef = (id, relation, direction) => {
    const d = documentsRef.find((doc) => doc.id === id && !doc.archivedAt);
    if (!d) return null;
    return { documentId: d.id, title: d.title, documentType: d.documentType, projectId: d.projectId, relation, direction };
  };
  return {
    async linkDocuments(sourceId, targetId, relation) {
      if (!isLive(sourceId) || !isLive(targetId)) return { linked: false };
      if (links.some((l) => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation)) {
        return { linked: true, alreadyLinked: true };
      }
      links.push({ sourceId, targetId, relation });
      return { linked: true };
    },
    async unlinkDocuments(sourceId, targetId, relation) {
      const i = links.findIndex((l) => l.sourceId === sourceId && l.targetId === targetId && l.relation === relation);
      if (i < 0) return false;
      links.splice(i, 1);
      return true;
    },
    async listDocumentLinks(documentId, direction = 'both') {
      const out = [];
      if (direction !== 'inbound') {
        for (const l of links.filter((l) => l.sourceId === documentId)) {
          const ref = toRef(l.targetId, l.relation, 'outbound');
          if (ref) out.push(ref);
        }
      }
      if (direction !== 'outbound') {
        for (const l of links.filter((l) => l.targetId === documentId)) {
          const ref = toRef(l.sourceId, l.relation, 'inbound');
          if (ref) out.push(ref);
        }
      }
      return out;
    },
  };
}
```

- [ ] **Step 3: Wire it into `buildApp`**

In the `buildApp({ ... })` call near the bottom of `scripts/demo-server.js`, add:

```js
  documentLinksRepository: createMemoryDocumentLinksRepository(sharedDocuments),
```

- [ ] **Step 4: Verify the demo serves the routes**

Run the demo and probe a route (it should not 404 the new path):

```bash
node scripts/demo-server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3100/api/library/documents/11111111-1111-4111-8111-111111111111/links"
kill %1
```

Expected: `200` (an unknown id returns an empty list `[]`, not 404, because list does not require the doc to exist). Also `npm run check` still exits 0 (`scripts/demo-server.js` is in the check list).

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-server.js
git commit -m "feat: demo server mirror for document links + getDocument"
```

---

## Task 6: Reference docs + contract regression + final verification

**Files:**
- Modify: `docs/contract.md`
- Modify: `mcp/README.md`
- Modify: `tests/contract/mcpToolContract.test.js`

- [ ] **Step 1: Extend the contract regression test (write first)**

In `tests/contract/mcpToolContract.test.js`:

1. Add the import:
```js
import { createDocumentLinkTools } from '../../mcp/tools/documentLinks.js';
```
2. Add the three tools to `FROZEN_TOOLS`:
```js
  list_document_links: { required: ['documentId'], optional: ['direction'] },
  link_documents: { required: ['sourceId', 'targetId', 'relation'], optional: [] },
  unlink_documents: { required: ['sourceId', 'targetId', 'relation'], optional: [] },
```
3. Add the factory to `allTools()`:
```js
    ...createDocumentLinkTools(client),
```
4. In the enum test (`SHAPE: tool enums expose exactly the documented option sets`), add:
```js
  const RELATION = ['derived-from', 'supersedes'];
  const DIRECTION = ['outbound', 'inbound', 'both'];
  assertEnum(get('link_documents', 'relation'), RELATION);
  assertEnum(get('unlink_documents', 'relation'), RELATION);
  assertEnum(get('list_document_links', 'direction'), DIRECTION);
```

- [ ] **Step 2: Run to verify it fails, then passes after the doc edits are independent**

Run: `node --test tests/contract/mcpToolContract.test.js`
Expected: PASS once the tools exist (they do, from Task 4). If it FAILS, the failure message identifies the mismatch — fix the test table to match the real tool, not the reverse, unless the tool is genuinely wrong.

- [ ] **Step 3: Update `docs/contract.md`**

In the MCP tools table (under "Format 3 — MCP tools"), add three rows after `list_task_activity`:

```
| `list_document_links` | `documentId`, `direction?:{outbound\|inbound\|both}` | yes |
| `link_documents` | `sourceId`, `targetId`, `relation:{derived-from\|supersedes}` | — |
| `unlink_documents` | `sourceId`, `targetId`, `relation:{derived-from\|supersedes}` | — |
```

And under the same section, add a short note after the "Operations intentionally not exposed" paragraph:

```markdown
Document graph: `document_links` are directed, typed edges (`derived-from`, `supersedes`)
between documents, created/removed/listed via the tools above and the
`/api/library/documents/:id/links` endpoints. `GET /api/library/documents/:id` and
`GET /api/tasks/:id` fetch a single record by id (returning archived records too). Link
serialization into exported `.md` is not yet implemented.
```

- [ ] **Step 4: Update `mcp/README.md`**

In the `## Tools` section, add the three new tools to the list with one-line descriptions matching the others' style (e.g. "`link_documents` — create a typed directional link (derived-from/supersedes) between two documents"; "`unlink_documents` — remove a typed link"; "`list_document_links` — list a document's links/backlinks").

- [ ] **Step 5: Full verification**

Run: `npm test && npm run check`
Expected: all tests pass (592 + new), check exits 0.

- [ ] **Step 6: Commit**

```bash
git add docs/contract.md mcp/README.md tests/contract/mcpToolContract.test.js
git commit -m "docs: document the document-graph tools + endpoints; lock the new tool shapes"
```

---

## Self-review notes (for the implementer)

- **Task order matters:** Task 1 (repository) → Task 3 (routes use it) → Task 4 (MCP uses the routes) → Task 5 (demo mirrors) → Task 6 (docs/regression reference the tools). Task 2 (getDocument) is needed by the Task 3 detail route.
- **Relations live in one place:** `DOCUMENT_LINK_RELATIONS` (repository) is the source of truth for the HTTP layer; the MCP `RELATION` Zod enum and the contract test must list the same two values. If you ever change them, change all three.
- **No DB `CHECK` on relation** is deliberate (additive-friendly) — do not add one.
- **Archive semantics:** linking requires live endpoints; `listDocumentLinks` hides archived ends; detail-by-id returns archived records. The fakes in tests model this.
- Do not add a UI, export serialization, content-hash, `kind`, or maintenance queries — all explicitly out of scope.
