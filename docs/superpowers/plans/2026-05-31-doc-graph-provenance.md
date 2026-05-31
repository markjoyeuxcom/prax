# Document Graph Provenance (Trust + Stale Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add content-hash + path-stamped edit-origin to documents, snapshot the source hash on `derived-from` edges (refreshed on re-link), and expose stale/orphan detection via read-only MCP tools — so a client-side agent can safely groom the document graph.

**Architecture:** Extend `markdown_documents` (`content_hash`, `updated_by`) and `document_links` (`target_hash`) via migration `0003`. Hash + origin are stamped in the document write path; `derived-from` links upsert the target's hash; two new query builders + MCP tools surface stale/orphan documents. No `kind`, no export serialization, no UI.

**Tech Stack:** Node + Fastify + plain `pg`, `node:crypto` (sha-256), Zod (MCP), `node --test`. No new deps.

---

## Conventions & key facts (read once)

- Document write path: `server/libraryRepository.js` has `buildCreateDocument(document)` (inserts the `CREATE_FIELDS` columns) and `buildUpdateDocument(id, fields)` (sets `UPDATE_COLUMN_MAP`-mapped columns + `updated_at = now()`), plus `normalizeDocumentRow(row)`. The routes (`server/libraryRoutes.js`) call `repository.createDocument(cleanDocumentPayload(body))` and `repository.updateDocument(id, fields)`.
- Edge convention: `link_documents(sourceId, targetId, relation)` → row `(source_document_id=sourceId, target_document_id=targetId)`, meaning "sourceId **is** `relation` targetId". So **A derived-from B** → source=A (derived), target=B (origin). We snapshot **B's** hash → column `target_hash`.
- `documentLinksRepository.js` has `buildLinkDocuments`, `buildLinkExists`, `buildUnlinkDocuments`, `buildListDocumentLinks`, `normalizeLinkRow`, `createDocumentLinksRepository(db)`, and `DOCUMENT_LINK_RELATIONS = ['derived-from','supersedes']`.
- Tests: `npm test` → `node --test` (auto-discovers `tests/**/*.test.js`). Full suite is currently **611 pass / 0 fail**. Run one file: `node --test tests/backend/<f>.test.js`.
- The MCP client `request(method, path, { query, body })` builds headers internally; it has a `patchOrNull` and a `getOrNull` helper. `mcp/server.js` registers tool factories. `tests/mcp/server.test.js` asserts an exact tool count + names (currently 19 tools).

---

## Task 1: Migration `0003` + content-hash & updated_by in the write path

**Files:**
- Create: `server/migrations/0003_add_provenance.sql`
- Modify: `server/libraryRepository.js`
- Test: `tests/backend/libraryRepository.test.js` (append), `tests/contract/libraryFormat.test.js` (update frozen keys)

- [ ] **Step 1: Write the migration**

Create `server/migrations/0003_add_provenance.sql`:

```sql
alter table markdown_documents add column if not exists content_hash text;
alter table markdown_documents add column if not exists updated_by text not null default 'user';
alter table document_links add column if not exists target_hash text;
```

- [ ] **Step 2: Write the failing repository tests**

Append to `tests/backend/libraryRepository.test.js` (extend the existing import from `../../server/libraryRepository.js` to include `buildCreateDocument`, `buildUpdateDocument`, `normalizeDocumentRow` if not already imported — do not duplicate `import test`/`assert`):

```js
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(String(s ?? '')).digest('hex');

test('buildCreateDocument stamps content_hash(body) and updated_by', () => {
  const q = buildCreateDocument({ title: 't', body: 'hello', documentType: 'note', projectId: 'p', tags: [], sourceFilename: null, updatedBy: 'agent' });
  assert.match(q.text, /content_hash/);
  assert.match(q.text, /updated_by/);
  assert.equal(q.values[q.values.length - 2], sha('hello')); // content_hash
  assert.equal(q.values[q.values.length - 1], 'agent');       // updated_by
});

test('buildCreateDocument defaults updated_by to user', () => {
  const q = buildCreateDocument({ title: 't', body: 'x', documentType: 'note', projectId: 'p', tags: [], sourceFilename: null });
  assert.equal(q.values[q.values.length - 1], 'user');
});

test('buildUpdateDocument always stamps updated_by and recomputes hash only when body changes', () => {
  const withBody = buildUpdateDocument('id', { body: 'new body', updatedBy: 'agent' });
  assert.match(withBody.text, /updated_by = \$/);
  assert.match(withBody.text, /content_hash = \$/);
  assert.ok(withBody.values.includes(sha('new body')));
  assert.ok(withBody.values.includes('agent'));

  const noBody = buildUpdateDocument('id', { title: 'renamed', updatedBy: 'user' });
  assert.match(noBody.text, /updated_by = \$/);
  assert.doesNotMatch(noBody.text, /content_hash = \$/); // title-only edit doesn't rehash
});

test('normalizeDocumentRow exposes contentHash and updatedBy', () => {
  const out = normalizeDocumentRow({
    id: 'i', title: 't', body: 'b', document_type: 'note', project_id: 'p',
    tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'abc', updated_by: 'agent',
  });
  assert.equal(out.contentHash, 'abc');
  assert.equal(out.updatedBy, 'agent');
});
```

- [ ] **Step 3: Run to verify FAIL**

Run: `node --test tests/backend/libraryRepository.test.js`
Expected: FAIL (hash/updated_by not present).

- [ ] **Step 4: Implement in `server/libraryRepository.js`**

Add at the top of the file:

```js
import { createHash } from 'node:crypto';

function hashBody(body) {
  return createHash('sha256').update(String(body ?? '')).digest('hex');
}
```

Replace `buildCreateDocument` with:

```js
export function buildCreateDocument(document) {
  return {
    text: `
      insert into markdown_documents (title, body, document_type, project_id, tags, source_filename, content_hash, updated_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
    `,
    values: [...valuesFor(CREATE_FIELDS, document), hashBody(document.body), document.updatedBy || 'user'],
  };
}
```

Replace `buildUpdateDocument` with:

```js
export function buildUpdateDocument(id, fields) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) {
    throw new Error('No document fields provided');
  }
  const values = [id, ...entries.map(([, value]) => value)];
  const assignments = entries.map(([key], index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`);

  // Always stamp who wrote this row.
  values.push(fields.updatedBy || 'user');
  assignments.push(`updated_by = $${values.length}`);

  // Recompute the content hash only when the body changes.
  if (Object.prototype.hasOwnProperty.call(fields, 'body')) {
    values.push(hashBody(fields.body));
    assignments.push(`content_hash = $${values.length}`);
  }

  return {
    text: `
      update markdown_documents
      set ${assignments.join(', ')}, updated_at = now()
      where id = $1 and archived_at is null
      returning *
    `,
    values,
  };
}
```

In `normalizeDocumentRow`, add the two fields (before the `projectSlug` spread):

```js
    contentHash: row.content_hash ?? null,
    updatedBy: row.updated_by,
```

- [ ] **Step 5: Run to verify PASS**

Run: `node --test tests/backend/libraryRepository.test.js`
Expected: PASS.

- [ ] **Step 6: Update the document-shape contract regression**

In `tests/contract/libraryFormat.test.js`, the `FROZEN_DOC_KEYS` array lists the document base field set. Add `'contentHash'` and `'updatedBy'` to it (keep it sorted-or-`.sort()`ed as the file does). Run `node --test tests/contract/libraryFormat.test.js` → expect PASS (the normalizeDocumentRow tests there now include the two new keys).

- [ ] **Step 7: Run the full suite + check**

Run: `npm test && npm run check`
Expected: all pass (611 + new), check exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/0003_add_provenance.sql server/libraryRepository.js tests/backend/libraryRepository.test.js tests/contract/libraryFormat.test.js
git commit -m "feat: content-hash + updated_by on documents"
```

---

## Task 2: Edit-origin header wiring in routes

**Files:**
- Modify: `server/libraryRoutes.js`
- Test: `tests/backend/libraryRoutes.test.js` (append) or a new `tests/backend/editOrigin.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/editOrigin.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC_ID = '11111111-1111-4111-8111-111111111111';

function fakes() {
  let stored = null;
  return {
    skipDb: true,
    projectsRepository: { async resolveProject(v) { return (v === 'homelab' || v === PROJECT_UUID) ? { id: PROJECT_UUID, slug: 'homelab' } : null; } },
    libraryRepository: {
      async createDocument(doc) { stored = doc; return { id: DOC_ID, ...doc, updatedBy: doc.updatedBy }; },
      async updateDocument(id, fields) { stored = fields; return { id, ...fields, updatedBy: fields.updatedBy }; },
      async getDocument() { return null; },
    },
    documentLinksRepository: { async listDocumentLinks() { return []; } },
    _seen: () => stored,
  };
}

test('POST document stamps updatedBy=agent from x-moomora-origin header', async () => {
  const f = fakes();
  const app = await buildApp(f);
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    headers: { 'x-moomora-origin': 'agent' },
    payload: { title: 'T', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(f._seen().updatedBy, 'agent');
  await app.close();
});

test('POST document defaults updatedBy=user without the header', async () => {
  const f = fakes();
  const app = await buildApp(f);
  await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 'T', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(f._seen().updatedBy, 'user');
  await app.close();
});

test('PATCH document threads updatedBy from the header', async () => {
  const f = fakes();
  const app = await buildApp(f);
  await app.inject({
    method: 'PATCH', url: `/api/library/documents/${DOC_ID}`,
    headers: { 'x-moomora-origin': 'agent' },
    payload: { title: 'renamed' },
  });
  assert.equal(f._seen().updatedBy, 'agent');
  await app.close();
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test tests/backend/editOrigin.test.js`
Expected: FAIL (updatedBy undefined).

- [ ] **Step 3: Implement in `server/libraryRoutes.js`**

Add a helper near the top of the file (after `isValidUuid`):

```js
function originFrom(request) {
  return request.headers['x-moomora-origin'] === 'agent' ? 'agent' : 'user';
}
```

In the `POST /api/library/documents` handler, change the create call to thread `updatedBy`:

```js
    reply.code(201);
    return repository.createDocument({ ...cleanDocumentPayload(request.body), updatedBy: originFrom(request) });
```

In the `PATCH /api/library/documents/:id` handler, where it builds `fields` and calls `repository.updateDocument(request.params.id, fields)`, set the origin on `fields` first:

```js
    fields.updatedBy = originFrom(request);
    const document = await repository.updateDocument(request.params.id, fields);
```

(`fields` is the object produced by `cleanDocumentPatchPayload` plus the resolved `projectId`. Adding `updatedBy` to it is safe — `buildUpdateDocument` reads `fields.updatedBy` directly and the `UPDATE_COLUMN_MAP` filter ignores it.)

- [ ] **Step 4: Run to verify PASS, then full suite**

Run: `node --test tests/backend/editOrigin.test.js` → PASS.
Run: `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add server/libraryRoutes.js tests/backend/editOrigin.test.js
git commit -m "feat: path-stamped edit-origin via x-moomora-origin header"
```

---

## Task 3: derived-from snapshot/refresh + stale/orphan query builders

**Files:**
- Modify: `server/documentLinksRepository.js`
- Test: `tests/backend/documentLinksRepository.test.js` (append/update)

- [ ] **Step 1: Update + add the failing tests**

In `tests/backend/documentLinksRepository.test.js`:

1. The existing test `buildLinkDocuments guards both endpoints are live and is idempotent` asserts `on conflict ... do nothing`. That is now only true for `supersedes`. **Update it** to test per-relation behavior, and add the new builders. Add these imports to the existing import line: `buildListStaleDocuments`, `buildListOrphanDocuments`, `normalizeStaleRow`. Replace that test and add new ones:

```js
test('buildLinkDocuments: derived-from upserts target_hash, supersedes stays do-nothing', () => {
  const derived = buildLinkDocuments(SRC, TGT, 'derived-from');
  assert.match(derived.text, /insert into document_links/);
  assert.match(derived.text, /target_hash/);
  assert.match(derived.text, /do update set target_hash = excluded\.target_hash/);
  assert.match(derived.text, /xmax = 0/); // distinguishes insert vs refresh
  assert.deepEqual(derived.values, [SRC, TGT, 'derived-from']);

  const sup = buildLinkDocuments(SRC, TGT, 'supersedes');
  assert.match(sup.text, /on conflict .* do nothing/);
  assert.doesNotMatch(sup.text, /target_hash/);
});

test('linkDocuments(derived-from) returns linked vs alreadyLinked via the inserted flag', async () => {
  const fresh = { query: async () => ({ rows: [{ source_document_id: SRC, inserted: true }] }) };
  assert.deepEqual(await createDocumentLinksRepository(fresh).linkDocuments(SRC, TGT, 'derived-from'), { linked: true });
  const refreshed = { query: async () => ({ rows: [{ source_document_id: SRC, inserted: false }] }) };
  assert.deepEqual(await createDocumentLinksRepository(refreshed).linkDocuments(SRC, TGT, 'derived-from'), { linked: true, alreadyLinked: true });
  const missing = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await createDocumentLinksRepository(missing).linkDocuments(SRC, TGT, 'derived-from'), { linked: false });
});

test('buildListStaleDocuments compares target.content_hash to the edge snapshot, optional project filter', () => {
  const all = buildListStaleDocuments();
  assert.match(all.text, /relation = 'derived-from'/);
  assert.match(all.text, /content_hash is distinct from/);
  assert.match(all.text, /target_hash is not null/);
  assert.deepEqual(all.values, []);
  const scoped = buildListStaleDocuments('pid');
  assert.match(scoped.text, /project_id = \$1/);
  assert.deepEqual(scoped.values, ['pid']);
});

test('buildListOrphanDocuments finds docs with no inbound or outbound links', () => {
  const q = buildListOrphanDocuments();
  assert.match(q.text, /not exists/);
  assert.match(q.text, /source_document_id = d\.id/);
  assert.match(q.text, /target_document_id = d\.id/);
});

test('normalizeStaleRow maps the aggregated row', () => {
  const row = { id: SRC, title: 'Derived', document_type: 'note', project_id: 'p', updated_by: 'user', stale_sources: [{ documentId: TGT, title: 'Source' }] };
  assert.deepEqual(normalizeStaleRow(row), {
    documentId: SRC, title: 'Derived', documentType: 'note', projectId: 'p', updatedBy: 'user',
    staleSources: [{ documentId: TGT, title: 'Source' }],
  });
});
```

(Keep the existing `supersedes`-relevant assertions; the `listDocumentLinks` / `unlinkDocuments` tests are unchanged.)

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test tests/backend/documentLinksRepository.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement in `server/documentLinksRepository.js`**

Replace `buildLinkDocuments` with a relation-branching version:

```js
export function buildLinkDocuments(sourceId, targetId, relation) {
  if (relation === 'derived-from') {
    return {
      text: `
        insert into document_links (source_document_id, target_document_id, relation, target_hash)
        select $1, $2, $3, (select content_hash from markdown_documents where id = $2)
        where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
          and exists (select 1 from markdown_documents where id = $2 and archived_at is null)
        on conflict (source_document_id, target_document_id, relation)
          do update set target_hash = excluded.target_hash
        returning source_document_id, (xmax = 0) as inserted
      `,
      values: [sourceId, targetId, relation],
    };
  }
  return {
    text: `
      insert into document_links (source_document_id, target_document_id, relation)
      select $1, $2, $3
      where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
        and exists (select 1 from markdown_documents where id = $2 and archived_at is null)
      on conflict (source_document_id, target_document_id, relation) do nothing
      returning source_document_id
    `,
    values: [sourceId, targetId, relation],
  };
}
```

Update the `linkDocuments` method in `createDocumentLinksRepository` to handle both shapes:

```js
    async linkDocuments(sourceId, targetId, relation) {
      const query = buildLinkDocuments(sourceId, targetId, relation);
      const result = await db.query(query.text, query.values);
      if (relation === 'derived-from') {
        if (result.rows.length === 0) return { linked: false };
        return result.rows[0].inserted ? { linked: true } : { linked: true, alreadyLinked: true };
      }
      // supersedes: do-nothing insert; probe to distinguish already-linked from missing
      if (result.rows.length > 0) return { linked: true };
      const existsQuery = buildLinkExists(sourceId, targetId, relation);
      const existsResult = await db.query(existsQuery.text, existsQuery.values);
      if (existsResult.rows.length > 0) return { linked: true, alreadyLinked: true };
      return { linked: false };
    },
```

Add the stale + orphan builders and a normalizer (near the other exports):

```js
export function buildListStaleDocuments(projectId) {
  const filter = projectId ? 'and d.project_id = $1' : '';
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id, d.updated_by,
             json_agg(json_build_object('documentId', tgt.id, 'title', tgt.title)) as stale_sources
      from document_links dl
      join markdown_documents d on d.id = dl.source_document_id and d.archived_at is null
      join markdown_documents tgt on tgt.id = dl.target_document_id and tgt.archived_at is null
      where dl.relation = 'derived-from'
        and dl.target_hash is not null
        and tgt.content_hash is distinct from dl.target_hash
        ${filter}
      group by d.id, d.title, d.document_type, d.project_id, d.updated_by
      order by d.title
    `,
    values: projectId ? [projectId] : [],
  };
}

export function buildListOrphanDocuments(projectId) {
  const filter = projectId ? 'and d.project_id = $1' : '';
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id
      from markdown_documents d
      where d.archived_at is null
        and not exists (select 1 from document_links dl where dl.source_document_id = d.id)
        and not exists (select 1 from document_links dl where dl.target_document_id = d.id)
        ${filter}
      order by d.title
    `,
    values: projectId ? [projectId] : [],
  };
}

export function normalizeStaleRow(row) {
  return {
    documentId: row.id,
    title: row.title,
    documentType: row.document_type,
    projectId: row.project_id,
    updatedBy: row.updated_by,
    staleSources: row.stale_sources || [],
  };
}
```

Add the two repository methods inside `createDocumentLinksRepository`:

```js
    async listStaleDocuments(projectId) {
      const query = buildListStaleDocuments(projectId);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeStaleRow);
    },
    async listOrphanDocuments(projectId) {
      const query = buildListOrphanDocuments(projectId);
      const result = await db.query(query.text, query.values);
      return result.rows.map((row) => ({
        documentId: row.id, title: row.title, documentType: row.document_type, projectId: row.project_id,
      }));
    },
```

- [ ] **Step 4: Run to verify PASS**

Run: `node --test tests/backend/documentLinksRepository.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/documentLinksRepository.js tests/backend/documentLinksRepository.test.js
git commit -m "feat: derived-from snapshot/refresh + stale/orphan queries"
```

---

## Task 4: Maintenance HTTP routes

**Files:**
- Modify: `server/libraryRoutes.js`
- Test: `tests/backend/maintenanceRoutes.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/maintenanceRoutes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const D = '11111111-1111-4111-8111-111111111111';

function build(overrides = {}) {
  return buildApp({
    skipDb: true,
    libraryRepository: { async getDocument() { return null; } },
    projectsRepository: { async resolveProject(v) { return (v === 'homelab' || v === PROJECT_UUID) ? { id: PROJECT_UUID, slug: 'homelab' } : null; } },
    documentLinksRepository: {
      async listStaleDocuments(projectId) { return [{ documentId: D, title: 'Derived', documentType: 'note', projectId: projectId || null, updatedBy: 'user', staleSources: [] }]; },
      async listOrphanDocuments() { return [{ documentId: D, title: 'Lonely', documentType: 'note', projectId: null }]; },
      ...overrides,
    },
  });
}

test('GET /api/library/maintenance/stale returns stale docs', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json()[0].documentId, D);
  assert.equal(res.json()[0].updatedBy, 'user');
  await app.close();
});

test('GET stale resolves project slug to id, rejects unknown project', async () => {
  let seen;
  const app = await build({ async listStaleDocuments(projectId) { seen = projectId; return []; } });
  const ok = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale?project=homelab' });
  assert.equal(ok.statusCode, 200);
  assert.equal(seen, PROJECT_UUID);
  const bad = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale?project=nope' });
  assert.equal(bad.statusCode, 400);
  await app.close();
});

test('GET /api/library/maintenance/orphans returns orphans', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/api/library/maintenance/orphans' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json()[0].title, 'Lonely');
  await app.close();
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test tests/backend/maintenanceRoutes.test.js` → FAIL (routes 404).

- [ ] **Step 3: Implement in `server/libraryRoutes.js`**

Inside `registerLibraryRoutes`, after the document-link routes, add (these reuse the existing `resolveProjectId` helper and `documentLinksRepository`):

```js
  app.get('/api/library/maintenance/stale', async (request, reply) => {
    let projectId;
    if (request.query.project) {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    return documentLinksRepository.listStaleDocuments(projectId);
  });

  app.get('/api/library/maintenance/orphans', async (request, reply) => {
    let projectId;
    if (request.query.project) {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    return documentLinksRepository.listOrphanDocuments(projectId);
  });
```

- [ ] **Step 4: Run to verify PASS, then full suite**

Run: `node --test tests/backend/maintenanceRoutes.test.js` → PASS. Then `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add server/libraryRoutes.js tests/backend/maintenanceRoutes.test.js
git commit -m "feat: stale/orphan maintenance HTTP routes"
```

---

## Task 5: MCP tools + client

**Files:**
- Create: `mcp/tools/graphMaintenance.js`
- Modify: `mcp/server.js`, `mcp/moomoraClient.js`
- Test: `tests/mcp/graphMaintenanceTools.test.js`, update `tests/mcp/server.test.js`, `tests/mcp/moomoraClient.test.js`

- [ ] **Step 1: Write the failing MCP tool tests**

Create `tests/mcp/graphMaintenanceTools.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphMaintenanceTools } from '../../mcp/tools/graphMaintenance.js';

function byName(tools, name) { const t = tools.find((x) => x.name === name); assert.ok(t, name); return t; }
const D = '11111111-1111-4111-8111-111111111111';

test('exposes the two maintenance tools', () => {
  assert.deepEqual(createGraphMaintenanceTools({}).map((t) => t.name).sort(), ['list_orphan_documents', 'list_stale_documents']);
});

test('list_stale_documents passes project and caps at 20', async () => {
  let seen; const many = Array.from({ length: 25 }, (_, i) => ({ documentId: `d-${i}` }));
  const client = { listStaleDocuments: async (p) => { seen = p; return many; } };
  const tool = byName(createGraphMaintenanceTools(client), 'list_stale_documents');
  const res = await tool.handler({ project: 'homelab' });
  assert.equal(seen, 'homelab');
  assert.equal(JSON.parse(res.content[0].text).length, 20);
});

test('list_orphan_documents returns the orphan list', async () => {
  const client = { listOrphanDocuments: async () => [{ documentId: D, title: 'Lonely' }] };
  const tool = byName(createGraphMaintenanceTools(client), 'list_orphan_documents');
  const res = await tool.handler({});
  assert.deepEqual(JSON.parse(res.content[0].text), [{ documentId: D, title: 'Lonely' }]);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test tests/mcp/graphMaintenanceTools.test.js` → FAIL.

- [ ] **Step 3: Implement `mcp/tools/graphMaintenance.js`**

```js
import { z } from 'zod';
import { okResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

export function createGraphMaintenanceTools(client) {
  return [
    {
      name: 'list_stale_documents',
      title: 'List stale documents',
      description:
        'List synthesized documents whose derived-from source changed since synthesis. Each result includes updatedBy (skip ones a human hand-edited) and the changed sources.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
      },
      handler: withErrorHandling(async ({ project }) => {
        const docs = await client.listStaleDocuments(project);
        return okResult(capResults(docs ?? []));
      }),
    },
    {
      name: 'list_orphan_documents',
      title: 'List orphan documents',
      description: 'List documents with no inbound or outbound links.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
      },
      handler: withErrorHandling(async ({ project }) => {
        const docs = await client.listOrphanDocuments(project);
        return okResult(capResults(docs ?? []));
      }),
    },
  ];
}
```

- [ ] **Step 4: Register in `mcp/server.js`**

Add the import and spread (after `createDocumentLinkTools`):

```js
import { createGraphMaintenanceTools } from './tools/graphMaintenance.js';
```
```js
    ...createGraphMaintenanceTools(apiClient),
```

- [ ] **Step 5: Client — header on writes + new query methods (`mcp/moomoraClient.js`)**

Add a `headers` option to `request` so write calls can stamp the origin. Change the signature and merge:

```js
  async function request(method, path, { query, body, headers: extraHeaders } = {}) {
```
and where headers are built, after the existing `content-type` line:
```js
    if (extraHeaders) Object.assign(headers, extraHeaders);
```

Make `createDocument`/`updateDocument` send the agent origin (the model never sees this):

```js
    createDocument: (payload) =>
      request('POST', '/api/library/documents', { body: payload, headers: { 'x-moomora-origin': 'agent' } }),
```

For `updateDocument`, it currently delegates to `patchOrNull(path, patch)`. Add a `headers` param to `patchOrNull`:

```js
  async function patchOrNull(path, patch, headers) {
    try {
      return await request('PATCH', path, { body: patch, headers });
    } catch (err) {
      if (err instanceof MoomoraApiError && err.status === 404) return null;
      throw err;
    }
  }
```
and call it with the origin header:
```js
    updateDocument: (id, patch) =>
      patchOrNull(`/api/library/documents/${id}`, patch, { 'x-moomora-origin': 'agent' }),
```

Add the two query methods (near `listDocumentLinks`):

```js
    listStaleDocuments: (project) =>
      request('GET', '/api/library/maintenance/stale', { query: { project } }),
    listOrphanDocuments: (project) =>
      request('GET', '/api/library/maintenance/orphans', { query: { project } }),
```

- [ ] **Step 6: Update `tests/mcp/server.test.js` and `tests/mcp/moomoraClient.test.js`**

- `server.test.js`: the expected tool count and name list. Bump the count from 19 to **21** and add `list_stale_documents`, `list_orphan_documents` to the expected-names set. (Read the file; match its exact constant/assertion style.)
- `moomoraClient.test.js`: add a test that `createDocument` sends `x-moomora-origin: agent` (assert the stubbed `fetch` received that header) — mirror the file's existing fetch-stub style. If the file's stub doesn't expose headers, extend the stub minimally to capture them.

- [ ] **Step 7: Run MCP tests + full suite + check**

Run: `node --test tests/mcp/graphMaintenanceTools.test.js tests/mcp/server.test.js tests/mcp/moomoraClient.test.js` → PASS.
Run: `npm test && npm run check` → all pass, exit 0.

- [ ] **Step 8: Commit**

```bash
git add mcp/tools/graphMaintenance.js mcp/server.js mcp/moomoraClient.js tests/mcp/graphMaintenanceTools.test.js tests/mcp/server.test.js tests/mcp/moomoraClient.test.js
git commit -m "feat: MCP stale/orphan tools + agent-origin write header"
```

---

## Task 6: Demo mirror + docs + contract regression + final verification

**Files:**
- Modify: `scripts/demo-server.js`, `docs/contract.md`, `mcp/README.md`, `tests/contract/mcpToolContract.test.js`

- [ ] **Step 1: Demo mirror — `scripts/demo-server.js`**

In `createMemoryLibraryRepository(documents)`:
- import/define a hash helper at the top of the file: `import { createHash } from 'node:crypto';` and `const hashBody = (b) => createHash('sha256').update(String(b ?? '')).digest('hex');`
- in `createDocument(doc)`: set `contentHash: hashBody(doc.body)` and `updatedBy: doc.updatedBy || 'user'` on the stored object, and return them.
- in `updateDocument(id, fields)`: set `updatedBy: fields.updatedBy || 'user'`; if `'body' in fields`, set `contentHash: hashBody(fields.body)`.
- in `getDocument(id)`: ensure the returned copy includes `contentHash` and `updatedBy`.

In `createMemoryDocumentLinksRepository(documentsRef)`:
- store `targetHash` on a `derived-from` link = the target doc's current `contentHash` at link time; on re-link of a `derived-from` pair, refresh `targetHash` (and return `{linked:true}` first time, `{linked:true, alreadyLinked:true}` on refresh). `supersedes` stays idempotent (`do nothing`), `targetHash` undefined.
- add `async listStaleDocuments(projectId)`: for each `derived-from` link whose target doc's current `contentHash !== link.targetHash` (and `targetHash` set), group by the source (derived) doc → `{ documentId, title, documentType, projectId, updatedBy, staleSources: [{documentId,title}] }`, filtered by `projectId` when provided.
- add `async listOrphanDocuments(projectId)`: live docs with no link referencing them as source or target, optionally project-filtered → `{documentId,title,documentType,projectId}`.

Verify with `npm run check` (exit 0) and a quick demo boot + curl of `/api/library/maintenance/orphans` returning `200`.

- [ ] **Step 2: Contract regression — `tests/contract/mcpToolContract.test.js`**

Add `import { createGraphMaintenanceTools } from '../../mcp/tools/graphMaintenance.js';`, spread it into `allTools()`, and add to `FROZEN_TOOLS`:

```js
  list_stale_documents: { required: [], optional: ['project'] },
  list_orphan_documents: { required: [], optional: ['project'] },
```

Run `node --test tests/contract/mcpToolContract.test.js` → PASS.

- [ ] **Step 3: `docs/contract.md`**

In the MCP tools table add two rows after the document-graph tools:

```
| `list_stale_documents` | `project?` | yes |
| `list_orphan_documents` | `project?` | yes |
```

Update the document-record field list / the "Document graph" note to mention: documents now expose `contentHash` and `updatedBy` (`user`|`agent`); writes stamp `updated_by` from the `x-moomora-origin` header (MCP sends `agent`); `derived-from` links snapshot the source's content hash and refresh it on re-link; `list_stale_documents`/`list_orphan_documents` drive a client-side groom loop.

- [ ] **Step 4: `mcp/README.md`**

Add `list_stale_documents` and `list_orphan_documents` to the reads list and the document-graph section with one-line descriptions.

- [ ] **Step 5: Full verification**

Run: `npm test && npm run check` → all pass (611 + new), exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/demo-server.js docs/contract.md mcp/README.md tests/contract/mcpToolContract.test.js
git commit -m "feat: demo mirror + docs + contract lock for provenance/stale tools"
```

---

## Self-review notes (for the implementer)

- **Task order:** 1 (columns + write path) → 2 (route header) → 3 (link snapshot + queries) → 4 (maintenance routes) → 5 (MCP) → 6 (demo + docs). Tasks 1/3 each touch a regression test (document keys; link idempotency) — update them in-task to keep the suite green.
- **`xmax = 0`** is a Postgres trick: true for a fresh insert, false for an `on conflict do update`. It distinguishes "newly linked" from "refreshed" in one query for `derived-from`. The demo/fakes model this with plain JS (track existence).
- **Content hash is body-only**; a title/tags edit must NOT rehash (Task 1's `buildUpdateDocument` only adds `content_hash` when `body` is in the patch).
- **`updated_by` is stamped on every write**; `x-moomora-origin` is read from the header, never a tool input (un-forgeable by the model).
- **No `kind` column, no export serialization, no UI** — all deferred.
- The controller will run a real-Postgres E2E smoke after Task 6 (write source+derived, link, edit source, confirm `list_stale_documents` flags it, re-link to clear, confirm orphan).
