# Document `kind` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, mutable `kind` column (`'source' | 'synthesized'`) to
`markdown_documents`, surface it on every read path, accept it on create/update, and lock the
shape via contract tests.

**Architecture:** Additive migration `0004`, default `'source'`, DB `check` constraint locks
the vocabulary. Repository and route layers thread `kind` through reads/writes. MCP tools
gain an optional enum input on `search_documents`, `create_document`, `update_document`. Stale
and orphan rows carry `kind` so grooming callers can prioritize. No inference from
`x-moomora-origin`; honor-system stays explicit.

**Tech Stack:** Postgres 18, Fastify, plain `pg`, Zod (MCP only), node:test, MCP SDK,
in-memory demo server mirrors all behavior.

**Spec:** [`docs/superpowers/specs/2026-06-02-document-kind-design.md`](../specs/2026-06-02-document-kind-design.md)

**Target release:** v0.10.0 (single PR).

---

## File map

**Create:**
- `server/migrations/0004_add_document_kind.sql` — additive idempotent migration.

**Modify:**
- `server/libraryRepository.js` — `CREATE_FIELDS`, `UPDATE_COLUMN_MAP`, `normalizeDocumentRow`,
  `buildCreateDocument`, `buildUpdateDocument`, `listDocuments` (`kind` filter).
- `server/libraryRoutes.js` — `PATCH_FIELDS`, `validateDocumentPayload`,
  `cleanDocumentPayload`, `cleanDocumentPatchPayload`, the `GET /api/library/documents`
  handler (kind filter).
- `server/documentLinksRepository.js` — `buildListStaleDocuments` + `normalizeStaleRow` +
  `buildListOrphanDocuments` + the orphan repository method (add `kind` to row payload).
- `mcp/tools/documents.js` — add optional `kind` to `search_documents`, `create_document`,
  `update_document`.
- `mcp/moomoraClient.js` — no signature change needed (passes payload through), but verify.
- `scripts/demo-server.js` — `createDocument` seed helper, memory library repository,
  memory document-links repository (stale/orphan kind).
- `tests/contract/libraryFormat.test.js` — `FROZEN_DOC_KEYS` gains `kind`.
- `tests/contract/mcpToolContract.test.js` — three tool rows gain optional `kind`; new
  `KIND` enum assertion.
- `docs/contract.md` — MCP tool rows + shared-enum line + provenance prose.

**New unit tests:**
- `tests/server/libraryRepository.kind.test.js` — pure builder tests for kind on
  create/update/list.
- `tests/server/libraryRoutes.kind.test.js` — route validation, filter, round-trip.
- `tests/server/documentLinksRepository.kind.test.js` — stale/orphan row includes kind.
- `tests/mcp/documentTools.kind.test.js` — Zod accepts/rejects.

(If these directories don't exist yet, place tests next to existing same-area tests.)

---

## Task 1 — Migration + Repository

**Files:**
- Create: `server/migrations/0004_add_document_kind.sql`
- Modify: `server/libraryRepository.js`
- Modify: `tests/contract/libraryFormat.test.js`
- Create: `tests/server/libraryRepository.kind.test.js`

- [ ] **Step 1: Write the failing contract test update**

Edit `tests/contract/libraryFormat.test.js`. Add `'kind'` to `FROZEN_DOC_KEYS`:

```javascript
const FROZEN_DOC_KEYS = [
  'archivedAt', 'body', 'contentHash', 'createdAt', 'documentType', 'id',
  'kind', 'projectId', 'sourceFilename', 'tags', 'title', 'updatedAt', 'updatedBy',
].sort();
```

- [ ] **Step 2: Write the failing repository unit test**

Create `tests/server/libraryRepository.kind.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateDocument,
  buildUpdateDocument,
  normalizeDocumentRow,
} from '../../server/libraryRepository.js';

test('normalizeDocumentRow exposes kind', () => {
  const row = {
    id: '1', title: 't', body: 'b', document_type: 'note',
    project_id: 'p', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'synthesized',
  };
  assert.equal(normalizeDocumentRow(row).kind, 'synthesized');
});

test('buildCreateDocument defaults kind to source', () => {
  const q = buildCreateDocument({ title: 't', body: 'b', documentType: 'note', projectId: 'p', tags: [] });
  assert.ok(q.text.includes('kind'), 'sql mentions kind column');
  assert.equal(q.values[q.values.length - 1], 'source');
});

test('buildCreateDocument accepts explicit synthesized', () => {
  const q = buildCreateDocument({ title: 't', body: 'b', documentType: 'note', projectId: 'p', tags: [], kind: 'synthesized' });
  assert.equal(q.values[q.values.length - 1], 'synthesized');
});

test('buildUpdateDocument appends kind assignment when present', () => {
  const q = buildUpdateDocument('id-1', { title: 'new', kind: 'source' });
  assert.match(q.text, /kind = \$\d+/);
  assert.ok(q.values.includes('source'));
});

test('buildUpdateDocument omits kind assignment when not present', () => {
  const q = buildUpdateDocument('id-1', { title: 'new' });
  assert.doesNotMatch(q.text, /kind = \$/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='kind'`
Expected: FAIL (`buildCreateDocument` does not include `kind`).

- [ ] **Step 4: Create migration 0004**

Write `server/migrations/0004_add_document_kind.sql`:

```sql
alter table markdown_documents
  add column if not exists kind text not null default 'source';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'markdown_documents_kind_check'
  ) then
    alter table markdown_documents
      add constraint markdown_documents_kind_check
      check (kind in ('source', 'synthesized'));
  end if;
end $$;
```

Idempotent: `add column if not exists` is safe; the DO block guards the check constraint
since Postgres does not support `add constraint if not exists`.

- [ ] **Step 5: Update libraryRepository.js**

Edit `server/libraryRepository.js`:

```javascript
const CREATE_FIELDS = ['title', 'body', 'documentType', 'projectId', 'tags', 'sourceFilename'];
const UPDATE_COLUMN_MAP = {
  title: 'title',
  body: 'body',
  documentType: 'document_type',
  projectId: 'project_id',
  tags: 'tags',
  sourceFilename: 'source_filename',
  kind: 'kind',
};

export function normalizeDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    documentType: row.document_type,
    projectId: row.project_id,
    tags: row.tags || [],
    sourceFilename: row.source_filename,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentHash: row.content_hash ?? null,
    updatedBy: row.updated_by,
    kind: row.kind,
    ...(row.project_slug !== undefined ? { projectSlug: row.project_slug } : {}),
  };
}

export function buildCreateDocument(document) {
  return {
    text: `
      insert into markdown_documents (title, body, document_type, project_id, tags, source_filename, content_hash, updated_by, kind)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *
    `,
    values: [
      ...valuesFor(CREATE_FIELDS, document),
      hashBody(document.body),
      document.updatedBy || 'user',
      document.kind || 'source',
    ],
  };
}
```

`buildUpdateDocument`: no structural change — the existing `UPDATE_COLUMN_MAP`-driven loop
already appends `kind = $N` automatically once `kind` is in the map.

Add `kind` filter to `listDocuments` in `createLibraryRepository`:

```javascript
async listDocuments(filters = {}) {
  const clauses = [];
  const values = [];

  if (filters.projectId) {
    values.push(filters.projectId);
    clauses.push(`project_id = $${values.length}`);
  }
  if (filters.documentType) {
    values.push(filters.documentType);
    clauses.push(`document_type = $${values.length}`);
  }
  if (filters.kind) {
    values.push(filters.kind);
    clauses.push(`kind = $${values.length}`);
  }
  if (filters.q) {
    const terms = String(filters.q).toLowerCase().match(/[a-z0-9]+/g) || [];
    if (terms.length) {
      values.push(terms.map(term => `${term}:*`).join(' & '));
      clauses.push(`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ to_tsquery('english', $${values.length})`);
    }
  }
  if (filters.archived === true || filters.archived === 'true') {
    clauses.push('archived_at is not null');
  } else if (filters.archived !== 'all') {
    clauses.push('archived_at is null');
  }
  // …rest unchanged…
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern='kind'`
Expected: PASS.

Run: `npm test`
Expected: full suite PASS (the `FROZEN_DOC_KEYS` shape lock now passes because
`normalizeDocumentRow` returns `kind`).

- [ ] **Step 7: Commit**

```bash
git add server/migrations/0004_add_document_kind.sql \
        server/libraryRepository.js \
        tests/contract/libraryFormat.test.js \
        tests/server/libraryRepository.kind.test.js
git commit -m "Add document kind column (migration + repository)

Migration 0004 introduces a not-null \`kind\` column on markdown_documents
defaulting to 'source' with a DB-side check constraint locking the
('source','synthesized') vocabulary. Repository builders thread \`kind\`
through create, update, list (new filter), and normalization. Contract
lock for the document field set is extended.
"
```

---

## Task 2 — HTTP routes

**Files:**
- Modify: `server/libraryRoutes.js`
- Create: `tests/server/libraryRoutes.kind.test.js`

- [ ] **Step 1: Write failing route tests**

Create `tests/server/libraryRoutes.kind.test.js`. This is an integration-flavored test that
stubs the repositories and only exercises the route layer's validation and patch threading
behavior. Use Fastify's `inject` API.

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerLibraryRoutes } from '../../server/libraryRoutes.js';

function makeRepoStub() {
  const calls = { create: [], update: [], list: [] };
  const repo = {
    listDocuments: async (filters) => { calls.list.push(filters); return []; },
    createDocument: async (doc) => { calls.create.push(doc); return { id: 'new', ...doc, kind: doc.kind || 'source' }; },
    updateDocument: async (id, fields) => { calls.update.push({ id, fields }); return { id, ...fields }; },
    getDocument: async () => null,
    archiveDocument: async () => null,
    restoreDocument: async () => null,
    deleteArchivedDocument: async () => null,
    listActiveDocumentsForExport: async () => [],
  };
  return { repo, calls };
}

const projectsStub = {
  resolveProject: async (value) =>
    value === 'homelab' ? { id: '00000000-0000-4000-8000-000000000001', slug: 'homelab' } : null,
};
const linksStub = {
  listDocumentLinks: async () => [],
  linkDocuments: async () => ({ linked: true }),
  unlinkDocuments: async () => true,
  listStaleDocuments: async () => [],
  listOrphanDocuments: async () => [],
};

async function buildApp(libraryRepo) {
  const app = Fastify({ logger: false });
  await registerLibraryRoutes(app, {
    libraryRepository: libraryRepo,
    projectsRepository: projectsStub,
    documentLinksRepository: linksStub,
  });
  return app;
}

test('POST /api/library/documents accepts valid kind', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab', kind: 'synthesized' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(calls.create[0].kind, 'synthesized');
});

test('POST /api/library/documents rejects invalid kind', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp(repo);
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab', kind: 'bogus' },
  });
  assert.equal(res.statusCode, 400);
});

test('POST /api/library/documents defaults kind when omitted', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 't', body: 'b', documentType: 'note', project: 'homelab' },
  });
  assert.equal(calls.create[0].kind, undefined, 'route forwards undefined; repo applies default');
});

test('PATCH /api/library/documents/:id accepts kind', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await app.inject({
    method: 'PATCH', url: `/api/library/documents/${id}`,
    payload: { kind: 'source' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.update[0].fields.kind, 'source');
});

test('PATCH /api/library/documents/:id rejects invalid kind', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp(repo);
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await app.inject({
    method: 'PATCH', url: `/api/library/documents/${id}`,
    payload: { kind: 'bogus' },
  });
  assert.equal(res.statusCode, 400);
});

test('GET /api/library/documents passes kind filter', async () => {
  const { repo, calls } = makeRepoStub();
  const app = await buildApp(repo);
  await app.inject({ method: 'GET', url: '/api/library/documents?kind=source' });
  assert.equal(calls.list[0].kind, 'source');
});

test('GET /api/library/documents rejects invalid kind filter', async () => {
  const { repo } = makeRepoStub();
  const app = await buildApp(repo);
  const res = await app.inject({ method: 'GET', url: '/api/library/documents?kind=bogus' });
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='kind' tests/server/libraryRoutes.kind.test.js`
Expected: FAIL — route currently accepts/ignores `kind` and does not validate.

- [ ] **Step 3: Update libraryRoutes.js**

Edit `server/libraryRoutes.js`:

```javascript
const DOCUMENT_TYPES = new Set(['runbook', 'note']);
const DOCUMENT_KINDS = new Set(['source', 'synthesized']);
const PATCH_FIELDS = ['title', 'body', 'documentType', 'project', 'tags', 'sourceFilename', 'kind'];
```

Extend `validateDocumentPayload`:

```javascript
function validateDocumentPayload(payload, { partial = false } = {}) {
  if (!isPlainObject(payload)) return 'document payload is invalid';
  if (!partial || payload.title !== undefined) {
    if (typeof payload.title !== 'string' || payload.title.trim().length === 0) return 'title is required';
  }
  if (!partial || payload.body !== undefined) {
    if (typeof payload.body !== 'string') return 'body is required';
  }
  if (!partial || payload.documentType !== undefined) {
    if (!DOCUMENT_TYPES.has(payload.documentType)) return 'documentType is invalid';
  }
  if (!partial) {
    if (typeof payload.project !== 'string' || payload.project.trim().length === 0) return 'project is required';
  } else if (payload.project !== undefined) {
    if (typeof payload.project !== 'string' || payload.project.trim().length === 0) return 'project is invalid';
  }
  if (!isValidTags(payload.tags)) return 'tags are invalid';
  if (payload.sourceFilename !== undefined && payload.sourceFilename !== null && typeof payload.sourceFilename !== 'string') {
    return 'sourceFilename is invalid';
  }
  if (payload.kind !== undefined && !DOCUMENT_KINDS.has(payload.kind)) return 'kind is invalid';
  if (partial && !PATCH_FIELDS.some(field => payload[field] !== undefined)) return 'document update is empty';
  return null;
}
```

Extend `cleanDocumentPayload` and `cleanDocumentPatchPayload`:

```javascript
function cleanDocumentPayload(payload) {
  return {
    title: payload.title.trim(),
    body: payload.body,
    documentType: payload.documentType,
    projectId: payload.projectId,
    tags: cleanTags(payload.tags),
    sourceFilename: payload.sourceFilename ? payload.sourceFilename.trim() : null,
    ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
  };
}

function cleanDocumentPatchPayload(payload) {
  return PATCH_FIELDS.reduce((patch, field) => {
    if (field === 'project') return patch;
    if (payload[field] === undefined) return patch;
    if (field === 'title') patch.title = payload.title.trim();
    else if (field === 'tags') patch.tags = cleanTags(payload.tags);
    else if (field === 'sourceFilename') patch.sourceFilename = payload.sourceFilename ? payload.sourceFilename.trim() : null;
    else patch[field] = payload[field];
    return patch;
  }, {});
}
```

Validate the `GET /api/library/documents` `kind` filter:

```javascript
app.get('/api/library/documents', async (request, reply) => {
  let projectId;
  if (request.query.project && request.query.project !== 'all') {
    projectId = await resolveProjectId(request.query.project);
    if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
  }
  if (request.query.kind !== undefined && !DOCUMENT_KINDS.has(request.query.kind)) {
    reply.code(400);
    return { message: 'kind is invalid' };
  }
  return repository.listDocuments({ ...request.query, projectId });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/server/libraryRoutes.kind.test.js`
Expected: PASS (all 7 tests).

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add server/libraryRoutes.js tests/server/libraryRoutes.kind.test.js
git commit -m "Thread document kind through HTTP routes

Accept optional kind on POST and PATCH (validated against the
('source','synthesized') vocabulary), forward it to the repository, and
add an optional kind query parameter to GET /api/library/documents with
matching validation.
"
```

---

## Task 3 — MCP tools

**Files:**
- Modify: `mcp/tools/documents.js`
- Modify: `tests/contract/mcpToolContract.test.js`
- Create: `tests/mcp/documentTools.kind.test.js`

- [ ] **Step 1: Update mcpToolContract.test.js (shape lock)**

Edit `tests/contract/mcpToolContract.test.js`:

```javascript
const FROZEN_TOOLS = {
  // …unchanged rows…
  search_documents: { required: [], optional: ['query', 'project', 'documentType', 'tags', 'kind'] },
  // …
  create_document: { required: ['title', 'body', 'documentType', 'project'], optional: ['tags', 'kind'] },
  update_document: { required: ['id'], optional: ['title', 'body', 'documentType', 'project', 'tags', 'kind'] },
  // …rest unchanged…
};
```

And in the existing enum-assertion test, add:

```javascript
const KIND = ['source', 'synthesized'];
assertEnum(get('search_documents', 'kind'), KIND);
assertEnum(get('create_document', 'kind'), KIND);
assertEnum(get('update_document', 'kind'), KIND);
```

- [ ] **Step 2: Write the failing tool-builder test**

Create `tests/mcp/documentTools.kind.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createDocumentTools } from '../../mcp/tools/documents.js';

function tool(name) {
  return createDocumentTools({}).find(t => t.name === name);
}

test('search_documents accepts optional kind', () => {
  const s = tool('search_documents').inputSchema.kind;
  assert.equal(s.safeParse('source').success, true);
  assert.equal(s.safeParse('synthesized').success, true);
  assert.equal(s.safeParse('bogus').success, false);
  assert.equal(s.safeParse(undefined).success, true);
});

test('create_document accepts optional kind', () => {
  const s = tool('create_document').inputSchema.kind;
  assert.equal(s.safeParse('source').success, true);
  assert.equal(s.safeParse(undefined).success, true);
  assert.equal(s.safeParse('bogus').success, false);
});

test('update_document accepts optional kind', () => {
  const s = tool('update_document').inputSchema.kind;
  assert.equal(s.safeParse('source').success, true);
  assert.equal(s.safeParse(undefined).success, true);
  assert.equal(s.safeParse('bogus').success, false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/mcp/documentTools.kind.test.js tests/contract/mcpToolContract.test.js`
Expected: FAIL (kind not in input schemas yet; FROZEN_TOOLS asserts new key absent).

- [ ] **Step 4: Update mcp/tools/documents.js**

Edit `mcp/tools/documents.js`:

```javascript
const DOCUMENT_TYPE = z.enum(['runbook', 'note']);
const DOCUMENT_KIND = z.enum(['source', 'synthesized']);

export function createDocumentTools(client) {
  return [
    {
      name: 'search_documents',
      // …unchanged metadata…
      inputSchema: {
        query: z.string().optional().describe('Search text matched against title, body, and tags. Omit to browse by project/tags alone.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit to search all.'),
        documentType: DOCUMENT_TYPE.optional().describe('Limit to runbooks or notes.'),
        tags: z.array(z.string()).optional().describe('Require all of these tags.'),
        kind: DOCUMENT_KIND.optional().describe('Limit to hand-authored sources or agent-synthesized derivations.'),
      },
      handler: withErrorHandling(async ({ query, project, documentType, tags, kind }) => {
        const docs = await client.listDocuments({ q: query, project, documentType, kind });
        let refs = (Array.isArray(docs) ? docs : []).map(toDocumentRef);
        if (Array.isArray(tags) && tags.length > 0) {
          refs = refs.filter((ref) => tags.every((tag) => ref.tags.includes(tag)));
        }
        return okResult(capResults(refs));
      }),
    },
    // get_document unchanged…
    {
      name: 'create_document',
      title: 'Create document',
      description: 'Create a new library runbook or note. Pass kind: "synthesized" for agent-generated derivations.',
      inputSchema: {
        title: z.string().min(1).describe('Document title.'),
        body: z.string().describe('Markdown body.'),
        documentType: DOCUMENT_TYPE,
        project: z.string().describe('Project slug or id.'),
        tags: z.array(z.string()).optional(),
        kind: DOCUMENT_KIND.optional().describe('"source" (default) for hand-authored, "synthesized" for agent-generated.'),
      },
      handler: withErrorHandling(async (args) => {
        const doc = await client.createDocument(args);
        return okResult(doc);
      }),
    },
    {
      name: 'update_document',
      title: 'Update document',
      description: 'Update one or more fields of an existing library document. Set kind to promote/demote.',
      inputSchema: {
        id: z.string().describe('Document UUID.'),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        documentType: DOCUMENT_TYPE.optional(),
        project: z.string().optional().describe('Project slug or id.'),
        tags: z.array(z.string()).optional(),
        kind: DOCUMENT_KIND.optional().describe('Promote synthesized → source or vice versa.'),
      },
      handler: withErrorHandling(async ({ id, ...patch }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        if (Object.keys(patch).length === 0) {
          return errorResult('Provide at least one field to update.');
        }
        const doc = await client.updateDocument(id, patch);
        if (!doc) return errorResult(`No document with id ${id}.`);
        return okResult(doc);
      }),
    },
  ];
}
```

- [ ] **Step 5: Thread `kind` through the MCP client**

Edit `mcp/moomoraClient.js`. The existing `listDocuments` signature must accept `kind`:

```javascript
listDocuments: ({ q, project, documentType, kind } = {}) =>
  request('GET', '/api/library/documents', { query: { q, project, documentType, kind } }),
```

`createDocument` and `updateDocument` already forward the whole payload, so they need no
change. (Verify by inspection — see Step 6.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/mcp/documentTools.kind.test.js tests/contract/mcpToolContract.test.js`
Expected: PASS.

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/tools/documents.js mcp/moomoraClient.js \
        tests/contract/mcpToolContract.test.js \
        tests/mcp/documentTools.kind.test.js
git commit -m "Surface document kind on MCP tools

search_documents, create_document, and update_document gain an optional
\`kind\` input. The MCP client forwards kind on list and passes through
the create/update payload unchanged. Contract lock and a Zod schema test
cover the additions.
"
```

---

## Task 4 — Stale + orphan rows expose `kind`

**Files:**
- Modify: `server/documentLinksRepository.js`
- Create: `tests/server/documentLinksRepository.kind.test.js`

- [ ] **Step 1: Write failing builder/normalizer tests**

Create `tests/server/documentLinksRepository.kind.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListStaleDocuments,
  buildListOrphanDocuments,
  normalizeStaleRow,
} from '../../server/documentLinksRepository.js';

test('buildListStaleDocuments selects d.kind', () => {
  const q = buildListStaleDocuments();
  assert.match(q.text, /d\.kind/);
});

test('normalizeStaleRow exposes kind', () => {
  const row = {
    id: '1', title: 't', document_type: 'note', project_id: 'p',
    updated_by: 'user', kind: 'synthesized', stale_sources: [],
  };
  assert.equal(normalizeStaleRow(row).kind, 'synthesized');
});

test('buildListOrphanDocuments selects d.kind', () => {
  const q = buildListOrphanDocuments();
  assert.match(q.text, /d\.kind/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/server/documentLinksRepository.kind.test.js`
Expected: FAIL.

- [ ] **Step 3: Update documentLinksRepository.js**

Add `d.kind` to both queries' select lists and group-by, and to the normalizers.

```javascript
export function buildListStaleDocuments(projectId) {
  const filter = projectId ? 'and d.project_id = $1' : '';
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id, d.updated_by, d.kind,
             json_agg(json_build_object('documentId', tgt.id, 'title', tgt.title)) as stale_sources
      from document_links dl
      join markdown_documents d on d.id = dl.source_document_id and d.archived_at is null
      join markdown_documents tgt on tgt.id = dl.target_document_id and tgt.archived_at is null
      where dl.relation = 'derived-from'
        and dl.target_hash is not null
        and tgt.content_hash is distinct from dl.target_hash
        ${filter}
      group by d.id, d.title, d.document_type, d.project_id, d.updated_by, d.kind
      order by d.title
    `,
    values: projectId ? [projectId] : [],
  };
}

export function buildListOrphanDocuments(projectId) {
  const filter = projectId ? 'and d.project_id = $1' : '';
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id, d.kind
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
    kind: row.kind,
    staleSources: row.stale_sources || [],
  };
}
```

Update the orphan-listing method to include `kind`:

```javascript
async listOrphanDocuments(projectId) {
  const query = buildListOrphanDocuments(projectId);
  const result = await db.query(query.text, query.values);
  return result.rows.map((row) => ({
    documentId: row.id,
    title: row.title,
    documentType: row.document_type,
    projectId: row.project_id,
    kind: row.kind,
  }));
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/server/documentLinksRepository.kind.test.js`
Expected: PASS.

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add server/documentLinksRepository.js tests/server/documentLinksRepository.kind.test.js
git commit -m "Include document kind on stale and orphan rows

Stale and orphan listings carry \`kind\` so grooming callers can
prioritize: agents may refresh stale synthesized docs aggressively and
leave stale source docs for human review.
"
```

---

## Task 5 — Demo server mirror

**Files:**
- Modify: `scripts/demo-server.js`

(Manual smoke is sufficient here; the in-memory path is not unit-tested directly.)

- [ ] **Step 1: Update seed helper and library repo**

Edit `scripts/demo-server.js`:

```javascript
function createDocument(seed) {
  const body = seed.body || '';
  return {
    id: randomUUID(),
    title: seed.title,
    body,
    documentType: seed.documentType || 'note',
    projectId: seed.projectId || PROJECT_ID_HOMELAB,
    tags: seed.tags || [],
    sourceFilename: seed.sourceFilename || null,
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now,
    archivedAt: seed.archivedAt || null,
    contentHash: hashBody(body),
    updatedBy: seed.updatedBy || 'user',
    kind: seed.kind || 'source',
  };
}
```

In `createMemoryLibraryRepository`:

```javascript
async listDocuments(filters = {}) {
  return documents.filter((document) => {
    if (filters.projectId && document.projectId !== filters.projectId) return false;
    if (filters.documentType && document.documentType !== filters.documentType) return false;
    if (filters.kind && document.kind !== filters.kind) return false;
    if (!matchesArchived(document, filters.archived)) return false;
    if (filters.q) {
      const query = String(filters.q).toLowerCase();
      return `${document.title} ${document.body}`.toLowerCase().includes(query);
    }
    return true;
  });
},

async createDocument(document) {
  const created = createDocument(document);
  created.contentHash = hashBody(document.body);
  created.updatedBy = document.updatedBy || 'user';
  created.kind = document.kind || 'source';
  documents.push(created);
  return created;
},

async updateDocument(id, fields) {
  const document = documents.find(item => item.id === id && !item.archivedAt);
  if (!document) return null;
  Object.assign(document, fields, { updatedAt: new Date().toISOString() });
  document.updatedBy = fields.updatedBy || 'user';
  if (Object.prototype.hasOwnProperty.call(fields, 'body')) {
    document.contentHash = hashBody(fields.body);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'kind')) {
    document.kind = fields.kind;
  }
  return document;
},
```

In `createMemoryDocumentLinksRepository`:

- `listStaleDocuments` already returns a row object — add `kind: doc.kind` to it.
- `listOrphanDocuments` map() — add `kind: d.kind` to each row.

- [ ] **Step 2: Smoke the demo path**

Run: `npm run demo` (background).
Run: `curl -s 'http://127.0.0.1:3100/api/library/documents' | head -c 500`
Expected: each document object contains `"kind":"source"`.

Stop demo: kill it.

- [ ] **Step 3: Commit**

```bash
git add scripts/demo-server.js
git commit -m "Mirror document kind in the demo server"
```

---

## Task 6 — Contract docs

**Files:**
- Modify: `docs/contract.md`

- [ ] **Step 1: Update `docs/contract.md`**

Edit the shared-enum line under "Format 3 — MCP tools" to add `KIND`:

```markdown
Shared enums: `STATUS` (`high-priority`, `in-progress`, `planned`, `completed`, `notes`),
`PRIORITY` (`high`, `medium`, `low`), `DOCUMENT_TYPE` (`runbook`, `note`),
`KIND` (`source`, `synthesized`).
```

Edit the three affected tool rows:

```markdown
| `search_documents` | `query?`, `project?`, `documentType?:DOCUMENT_TYPE`, `tags?`, `kind?:KIND` | yes |
| `create_document` | `title`, `body`, `documentType:DOCUMENT_TYPE`, `project`, `tags?`, `kind?:KIND` | — |
| `update_document` | `id`, `title?`, `body?`, `documentType?:DOCUMENT_TYPE`, `project?`, `tags?`, `kind?:KIND` | — |
```

Append a short paragraph after the provenance prose (after the
`list_orphan_documents` paragraph):

```markdown
Document `kind` distinguishes hand-authored documents (`"source"`) from agent-synthesized
derivations (`"synthesized"`). It is set explicitly by callers (defaulting to `"source"`),
mutable via `update_document`, and independent of `derived-from` edges and the
`x-moomora-origin` edit-origin header. Read paths (`get_document`, search rows, stale/orphan
rows) include `kind`; the create/update tools accept it as an optional input.
```

- [ ] **Step 2: Verify the doc reads cleanly**

Run: `git diff docs/contract.md` and proof the diff.
Expected: only the three additions above; no whitespace damage to surrounding rows.

- [ ] **Step 3: Commit**

```bash
git add docs/contract.md
git commit -m "Document kind in docs/contract.md"
```

---

## Task 7 — End-to-end verification + final review

**Files:** none (verification + commit-free unless issues found).

- [ ] **Step 1: Run the full suite green**

Run: `npm test`
Expected: PASS (every test).

Run: `npm run check`
Expected: PASS.

- [ ] **Step 2: Boot real Postgres and apply migrations from scratch**

Run: `docker compose down -v` (resets the local DB volume).
Run: `docker compose up -d --build` (background).
Wait ~10s for Postgres ready.

Apply migrations on a fresh DB:
Run: `docker compose logs app | grep -i 'migration\|migrate' | tail -20`
Expected: see migration 0004 in the applied list.

Verify the column:

```bash
docker compose exec postgres psql -U postgres -d postgres -c \
  "\d markdown_documents" | grep -i kind
```

Expected: `kind | text | not null default 'source'`.

- [ ] **Step 3: Verify migration idempotency and check constraint**

Apply migration 0004 a second time — it must succeed without error and without re-adding the
check constraint:

```bash
docker compose exec app npm run migrate
docker compose exec postgres psql -U postgres -d postgres -c \
  "select conname from pg_constraint where conname = 'markdown_documents_kind_check'"
```

Expected: the second migrate run reports nothing to apply (or applies idempotently with no
error). The constraint appears exactly once.

Verify the check rejects unknown values:

```bash
docker compose exec postgres psql -U postgres -d postgres -c \
  "insert into markdown_documents (title, body, document_type, project_id, kind)
   select 'bad', '', 'note', id, 'bogus' from projects limit 1"
```

Expected: error `new row for relation "markdown_documents" violates check constraint
"markdown_documents_kind_check"`.

- [ ] **Step 4: Verify backfill against pre-existing data**

Stop the app, downgrade locally to the 0.9.0 image, seed one document via the UI/API, then
re-deploy this branch and reapply the migration. Confirm the existing document now has
`kind: 'source'`.

Alternative (faster): create a row with the `kind` column dropped (via psql) and run the
migration:

```bash
docker compose exec postgres psql -U postgres -d postgres <<'SQL'
alter table markdown_documents drop column kind;
insert into markdown_documents (title, body, document_type, project_id)
  select 'backfill test', 'body', 'note', id from projects limit 1;
SQL
```

Then restart the app (which reapplies migrations) and check:

```bash
docker compose exec postgres psql -U postgres -d postgres -c \
  "select title, kind from markdown_documents where title = 'backfill test'"
```

Expected: `kind = 'source'`.

- [ ] **Step 5: HTTP round-trip**

```bash
# create source (default kind)
curl -s -X POST http://127.0.0.1:3100/api/library/documents \
  -H 'content-type: application/json' \
  -d '{"title":"src","body":"hello","documentType":"note","project":"homelab"}' | jq .kind

# create synthesized
curl -s -X POST http://127.0.0.1:3100/api/library/documents \
  -H 'content-type: application/json' \
  -d '{"title":"syn","body":"derived","documentType":"note","project":"homelab","kind":"synthesized"}' | jq .kind

# filter
curl -s 'http://127.0.0.1:3100/api/library/documents?kind=synthesized' | jq '.[].title'

# promote
SYN_ID=$(curl -s 'http://127.0.0.1:3100/api/library/documents?kind=synthesized' | jq -r '.[0].id')
curl -s -X PATCH "http://127.0.0.1:3100/api/library/documents/$SYN_ID" \
  -H 'content-type: application/json' \
  -d '{"kind":"source"}' | jq .kind

# invalid
curl -s -X POST http://127.0.0.1:3100/api/library/documents \
  -H 'content-type: application/json' \
  -d '{"title":"x","body":"x","documentType":"note","project":"homelab","kind":"bogus"}' \
  -w '\n%{http_code}\n'
```

Expected, in order: `"source"`, `"synthesized"`, `"syn"`, `"source"`, then a 400.

- [ ] **Step 6: MCP round-trip**

Either via Claude Code with the MCP server registered, or via a small Node harness that
imports `createDocumentTools` and exercises a handler against a stub client. Confirm:

- `search_documents { kind: 'source' }` returns only sources.
- `create_document { ..., kind: 'synthesized' }` produces a synthesized doc.
- `update_document { id, kind: 'source' }` flips the doc to source.

- [ ] **Step 7: Stale/orphan rows include `kind`**

Create a derived link between two docs (one source, one synthesized), then edit the source
to break the snapshot. Hit:

```bash
curl -s http://127.0.0.1:3100/api/library/maintenance/stale | jq '.[].kind'
curl -s http://127.0.0.1:3100/api/library/maintenance/orphans | jq '.[].kind'
```

Expected: each row exposes `kind`.

- [ ] **Step 8: Spawn a final Opus reviewer subagent**

Dispatch a code-review subagent (Opus, per `subagent-model-routing.md`) covering the whole
branch diff. Ask for spec compliance (every section of
`docs/superpowers/specs/2026-06-02-document-kind-design.md` implemented) and code quality.
Address any **important** findings before opening the PR.

- [ ] **Step 9: Push branch and open PR**

```bash
git push -u origin feature/document-kind
gh pr create --title "Add document kind (source vs synthesized)" --body "$(cat <<'EOF'
## Summary

- Adds a `kind` column (`'source' | 'synthesized'`) to `markdown_documents`, default
  `'source'`, with a DB check constraint locking the vocabulary.
- Threads `kind` through the repository, HTTP routes (POST/PATCH validation + GET filter),
  and MCP tools (`search_documents`, `create_document`, `update_document`).
- Stale and orphan rows expose `kind` so grooming callers can prioritize refreshing
  synthesized docs and leave source docs for human review.
- No inference from `x-moomora-origin`. Callers set `kind` explicitly.

Spec: `docs/superpowers/specs/2026-06-02-document-kind-design.md`.

## Test plan

- [ ] `npm test` green
- [ ] `npm run check` green
- [ ] Fresh `docker compose up -d --build`: migration 0004 applied, column present, default
      backfills existing rows
- [ ] HTTP round-trip: create source, create synthesized, filter, promote, reject invalid
- [ ] MCP round-trip: search/create/update with `kind`
- [ ] Stale and orphan rows include `kind`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Release (post-merge)

Cuts as **v0.10.0**. Follow the release ritual:

1. Branch `release-v0.10.0` from `main`.
2. `npm version 0.10.0 --no-git-tag-version`.
3. Update `compose.image.yaml` image ref to `:v0.10.0`.
4. Update README image-tag callout to `v0.10.0`.
5. Roll `[Unreleased]` to `[0.10.0] - <today>` in `CHANGELOG.md` with an `### Added` entry:
   "Document `kind` (`source` / `synthesized`) distinguishing hand-authored from agent-
   synthesized documents, exposed on reads and accepted as an optional input on create/
   update and as a search filter. (#<PR>)"
6. Add the `v0.9.0...v0.10.0` compare link.
7. Commit, PR, merge, `git tag -a v0.10.0 -m "v0.10.0" && git push origin v0.10.0`.
8. Watch the release workflow.
