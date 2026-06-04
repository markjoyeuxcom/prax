# Shared AI Memory — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve `markdown_documents` with trust fields, add verify/supersede/context-pack routes with conservative unverified-retrieval defaults, and ship a thin `moomora` CLI so any shell-capable agent can pull project memory, write unverified memory, and let a human verify/supersede it.

**Architecture:** Reuse the existing document model — four additive columns (`verified`, `verified_at`, `verified_by`, `status`) on `markdown_documents`, supersession via the existing `document_links`, semantic search reused. Selection/formatting logic lives in a pure `server/contextPack.js`. The CLI is a thin HTTP client (`cli/`) with no duplicated business logic. The web UI gains read-only trust display only.

**Tech Stack:** Node 20+ (ESM), Fastify, PostgreSQL via `pg`, `node:test`, native `fetch` (no new runtime deps).

**Spec:** `docs/superpowers/specs/2026-06-04-shared-ai-memory-slice1-design.md`

**Branch:** `shared-ai-memory-slice1` (already created).

---

## File Structure

**New files:**
- `server/migrations/0007_add_memory_trust.sql` — additive columns + constraint + conservative backfill.
- `server/contextPack.js` — pure `buildContextPack` + `renderContextPackMarkdown`.
- `cli/moomora.js` — bin entry, arg dispatch (shebang).
- `cli/lib/detectProject.js` — pure project-detection resolver.
- `cli/lib/apiClient.js` — thin `fetch` wrapper over the HTTP API.
- `cli/lib/format.js` — output formatters (human / json).
- `tests/backend/libraryRepository.trust.test.js`
- `tests/backend/libraryRoutes.trust.test.js`
- `tests/backend/contextPack.test.js`
- `tests/cli/detectProject.test.js`
- `tests/cli/format.test.js`
- `docs/cli.md`

**Modified files:**
- `server/libraryRepository.js` — `normalizeDocumentRow` (+4 fields), new query builders + repo methods, semantic SELECT + status filter, `listDocuments` status filter.
- `server/libraryRoutes.js` — verify/supersede/context-pack routes, unlink status-recompute, `toRef` (+ trust).
- `tests/backend/libraryRepository.test.js` — update the `deepEqual` expectations for the four new fields.
- `tests/contract/libraryFormat.test.js` — extend `FROZEN_DOC_KEYS`.
- `scripts/demo-server.js` — in-memory mirror of the four fields + three repo methods + status filter.
- `public/js/renderLibrary.js` — read-only trust chips (rows + detail header).
- `public/styles.css` — trust chip styles.
- `package.json` — `bin` entry + `check` script adds the CLI.
- `docs/contract.md`, `README.md`, `CHANGELOG.md` — documentation.

**No change required:** `server/index.js` (context-pack registers inside `registerLibraryRoutes`, which already receives `embedder`/`appSettings`); `server/libraryExport.js` and its contract test (trust fields are runtime state, deliberately NOT part of the portable Markdown export).

---

## Task 1: Migration `0007` + trust fields in `normalizeDocumentRow`

**Files:**
- Create: `server/migrations/0007_add_memory_trust.sql`
- Modify: `server/libraryRepository.js` (`normalizeDocumentRow`, lines 26-44)
- Modify: `tests/backend/libraryRepository.test.js` (the `deepEqual` expectation, lines 36-51; and the `normalizeDocumentRow exposes contentHash and updatedBy` test)
- Modify: `tests/contract/libraryFormat.test.js` (`FROZEN_DOC_KEYS`, lines 13-16)

- [ ] **Step 1: Write the migration SQL**

Create `server/migrations/0007_add_memory_trust.sql`:

```sql
alter table markdown_documents
  add column if not exists verified     boolean not null default false,
  add column if not exists verified_at  timestamptz,
  add column if not exists verified_by  text,
  add column if not exists status       text not null default 'active';

alter table markdown_documents
  drop constraint if exists markdown_documents_status_check;
alter table markdown_documents
  add constraint markdown_documents_status_check
  check (status in ('active', 'superseded', 'deprecated'));

-- Backfill existing rows conservatively: human-authored memory is trusted,
-- agent-authored memory starts unverified.
update markdown_documents set verified = true  where updated_by = 'user';
update markdown_documents set verified = false where updated_by = 'agent';

-- Mark already-superseded docs (targets of a supersedes link) as superseded.
update markdown_documents d set status = 'superseded'
  where exists (
    select 1 from document_links l
    where l.target_document_id = d.id and l.relation = 'supersedes'
  );
```

(The `drop constraint if exists` before `add constraint` keeps the whole migration idempotent if a partial prior run left the columns but not the constraint.)

- [ ] **Step 2: Write the failing normalize test**

In `tests/backend/libraryRepository.test.js`, add a new test after the existing `normalizeDocumentRow exposes contentHash and updatedBy` test (around line 244):

```javascript
test('normalizeDocumentRow exposes trust fields with safe defaults', () => {
  const missing = normalizeDocumentRow({
    id: 'i', title: 't', body: 'b', document_type: 'note', project_id: 'p',
    tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u',
  });
  assert.equal(missing.verified, false);
  assert.equal(missing.verifiedAt, null);
  assert.equal(missing.verifiedBy, null);
  assert.equal(missing.status, 'active');

  const present = normalizeDocumentRow({
    id: 'i', title: 't', body: 'b', document_type: 'note', project_id: 'p',
    tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u',
    verified: true, verified_at: '2026-06-04T10:00:00.000Z', verified_by: 'mark', status: 'superseded',
  });
  assert.equal(present.verified, true);
  assert.equal(present.verifiedAt, '2026-06-04T10:00:00.000Z');
  assert.equal(present.verifiedBy, 'mark');
  assert.equal(present.status, 'superseded');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test tests/backend/libraryRepository.test.js`
Expected: FAIL — the new test fails (`verified` is `undefined`) AND the existing `normalizeDocumentRow maps database fields...` deepEqual test still passes (it will break in Step 5 once we add fields, so we fix it in Step 4).

- [ ] **Step 4: Add the trust fields to `normalizeDocumentRow`**

In `server/libraryRepository.js`, change `normalizeDocumentRow` (insert the four fields after `kind:` on line 40):

```javascript
export function normalizeDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    documentType: row.document_type,
    projectId: row.project_id,
    tags: row.tags || [],
    sourceFilename: row.source_filename,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    contentHash: row.content_hash ?? null,
    updatedBy: row.updated_by,
    kind: row.kind,
    verified: row.verified ?? false,
    verifiedAt: toIso(row.verified_at) ?? null,
    verifiedBy: row.verified_by ?? null,
    status: row.status ?? 'active',
    stale: row.stale ?? false,
    ...(row.project_slug !== undefined ? { projectSlug: row.project_slug } : {}),
  };
}
```

- [ ] **Step 5: Update the existing deepEqual expectation**

In `tests/backend/libraryRepository.test.js`, the `normalizeDocumentRow maps database fields to API document fields` test (lines 36-51) does a full `deepEqual`. Add the four fields to the expected object (after `kind: undefined,`):

```javascript
  assert.deepEqual(document, {
    id: DOCUMENT_ID,
    title: 'Restore CloudNativePG',
    body: '# Restore CloudNativePG',
    documentType: 'runbook',
    projectId: PROJECT_UUID,
    tags: ['postgres', 'backup'],
    sourceFilename: 'restore.md',
    archivedAt: null,
    createdAt: '2026-05-18T10:00:00.000Z',
    updatedAt: '2026-05-18T10:00:00.000Z',
    contentHash: null,
    updatedBy: undefined,
    kind: undefined,
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    status: 'active',
    stale: false,
  });
```

- [ ] **Step 6: Update the frozen contract key set**

In `tests/contract/libraryFormat.test.js`, extend `FROZEN_DOC_KEYS` (lines 13-16) to include the four new keys (keep it sorted as the test sorts both sides, but list them for clarity):

```javascript
const FROZEN_DOC_KEYS = [
  'archivedAt', 'body', 'contentHash', 'createdAt', 'documentType', 'id',
  'kind', 'projectId', 'sourceFilename', 'stale', 'status', 'tags', 'title',
  'updatedAt', 'updatedBy', 'verified', 'verifiedAt', 'verifiedBy',
];
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test tests/backend/libraryRepository.test.js tests/contract/libraryFormat.test.js`
Expected: PASS (all tests green).

- [ ] **Step 8: Commit**

```bash
git add server/migrations/0007_add_memory_trust.sql server/libraryRepository.js tests/backend/libraryRepository.test.js tests/contract/libraryFormat.test.js
git commit -m "feat(memory): add trust fields (verified/status) to documents

0007 migration adds verified/verified_at/verified_by/status to
markdown_documents with conservative backfill; normalizeDocumentRow
surfaces them while preserving the no-vector-leak allowlist."
```

---

## Task 2: Repository trust query builders, methods, and retrieval filtering

**Files:**
- Modify: `server/libraryRepository.js`
- Test: `tests/backend/libraryRepository.trust.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/libraryRepository.trust.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerifyDocument,
  buildMarkSuperseded,
  buildRevertSupersededIfOrphan,
  buildSearchDocumentsSemantic,
  createLibraryRepository,
} from '../../server/libraryRepository.js';

const ID = '11111111-1111-4111-8111-111111111111';

test('buildVerifyDocument sets verified + stamps when verifying', () => {
  const q = buildVerifyDocument(ID, { verified: true, verifiedBy: 'mark' });
  assert.match(q.text, /set verified = true, verified_at = now\(\), verified_by = \$2/);
  assert.match(q.text, /where id = \$1 and archived_at is null/);
  assert.match(q.text, /returning \*/);
  assert.deepEqual(q.values, [ID, 'mark']);
});

test('buildVerifyDocument clears stamps when unverifying', () => {
  const q = buildVerifyDocument(ID, { verified: false });
  assert.match(q.text, /set verified = false, verified_at = null, verified_by = null/);
  assert.deepEqual(q.values, [ID]);
});

test('buildMarkSuperseded only flips an active doc', () => {
  const q = buildMarkSuperseded(ID);
  assert.match(q.text, /set status = 'superseded'/);
  assert.match(q.text, /where id = \$1 and status = 'active'/);
  assert.deepEqual(q.values, [ID]);
});

test('buildRevertSupersededIfOrphan reverts only when no supersedes link remains', () => {
  const q = buildRevertSupersededIfOrphan(ID);
  assert.match(q.text, /set status = 'active'/);
  assert.match(q.text, /status = 'superseded'/);
  assert.match(q.text, /not exists/);
  assert.match(q.text, /relation = 'supersedes'/);
  assert.deepEqual(q.values, [ID]);
});

test('buildSearchDocumentsSemantic selects trust fields and filters to active by default', () => {
  const q = buildSearchDocumentsSemantic('[0.1]', 'fake', {});
  assert.match(q.text, /verified, status/);
  assert.match(q.text, /and status = 'active'/);
});

test('buildSearchDocumentsSemantic includes retired rows when asked', () => {
  const q = buildSearchDocumentsSemantic('[0.1]', 'fake', { includeRetired: true });
  assert.doesNotMatch(q.text, /and status = 'active'/);
});

test('listDocuments applies a known status filter', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ status: 'active' });
  assert.match(captured.text, /d\.status = \$1/);
  assert.deepEqual(captured.values, ['active']);
});

test('listDocuments ignores an unknown status filter', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ status: 'bogus' });
  assert.doesNotMatch(captured.text, /d\.status = \$/);
});

test('verifyDocument returns the normalized row', async () => {
  const db = { query: async () => ({ rows: [{ id: ID, title: 't', body: 'b', document_type: 'note', project_id: 'p', tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u', verified: true, status: 'active' }] }) };
  const repo = createLibraryRepository(db);
  const out = await repo.verifyDocument(ID, { verified: true, verifiedBy: 'mark' });
  assert.equal(out.verified, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test tests/backend/libraryRepository.trust.test.js`
Expected: FAIL — `buildVerifyDocument is not a function`.

- [ ] **Step 3: Add the query builders**

In `server/libraryRepository.js`, add after `buildGetDocument` (line 121):

```javascript
export function buildVerifyDocument(id, { verified, verifiedBy = null } = {}) {
  if (verified) {
    return {
      text: `
        update markdown_documents
        set verified = true, verified_at = now(), verified_by = $2
        where id = $1 and archived_at is null
        returning *
      `,
      values: [id, verifiedBy],
    };
  }
  return {
    text: `
      update markdown_documents
      set verified = false, verified_at = null, verified_by = null
      where id = $1 and archived_at is null
      returning *
    `,
    values: [id],
  };
}

export function buildMarkSuperseded(id) {
  return {
    text: `
      update markdown_documents
      set status = 'superseded', updated_at = now()
      where id = $1 and status = 'active'
      returning *
    `,
    values: [id],
  };
}

export function buildRevertSupersededIfOrphan(id) {
  return {
    text: `
      update markdown_documents
      set status = 'active', updated_at = now()
      where id = $1 and status = 'superseded'
        and not exists (
          select 1 from document_links
          where target_document_id = $1 and relation = 'supersedes'
        )
      returning *
    `,
    values: [id],
  };
}
```

- [ ] **Step 4: Add trust to the semantic SELECT and a status filter to `listDocuments`**

In `buildSearchDocumentsSemantic` (lines 159-178), add `verified, status` to the column list and an active-only filter unless `includeRetired`:

```javascript
export function buildSearchDocumentsSemantic(queryLiteral, backend, { projectId, limit = 20, includeRetired = false } = {}) {
  const values = [queryLiteral, backend];
  let where = `where archived_at is null and embedding is not null and embedding_backend = $2`;
  if (!includeRetired) {
    where += ` and status = 'active'`;
  }
  if (projectId) {
    values.push(projectId);
    where += ` and project_id = $${values.length}`;
  }
  values.push(limit);
  return {
    text: `
      select id, title, document_type, project_id, tags, body, kind, verified, status,
             1 - (embedding <=> $1::vector) as similarity
      from markdown_documents
      ${where}
      order by embedding <=> $1::vector
      limit $${values.length}
    `,
    values,
  };
}
```

In `createLibraryRepository`'s `listDocuments` (after the `kind` filter block, around line 236), add:

```javascript
      if (filters.status && ['active', 'superseded', 'deprecated'].includes(filters.status)) {
        values.push(filters.status);
        clauses.push(`d.status = $${values.length}`);
      }
```

Also thread `includeRetired` through `searchDocumentsSemantic` (line 319-324) by passing the whole `opts` (it already spreads via `opts`), so no change needed there beyond confirming `opts.includeRetired` reaches the builder — it does, because `searchDocumentsSemantic(queryLiteral, backend, opts)` calls `buildSearchDocumentsSemantic(queryLiteral, backend, opts)`.

- [ ] **Step 5: Add the repository methods**

In `createLibraryRepository`, add after `getDocument` (line 311):

```javascript
    async verifyDocument(id, payload) {
      const q = buildVerifyDocument(id, payload);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async markDocumentSuperseded(id) {
      const q = buildMarkSuperseded(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async revertSupersededIfOrphan(id) {
      const q = buildRevertSupersededIfOrphan(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test tests/backend/libraryRepository.trust.test.js tests/backend/libraryRepository.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/libraryRepository.js tests/backend/libraryRepository.trust.test.js
git commit -m "feat(memory): repository verify/supersede builders + active-only retrieval"
```

---

## Task 3: Verify, supersede, and unlink-recompute routes

**Files:**
- Modify: `server/libraryRoutes.js`
- Test: `tests/backend/libraryRoutes.trust.test.js` (new)

- [ ] **Step 1: Write the failing route tests**

Create `tests/backend/libraryRoutes.trust.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const ID = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

async function build(overrides = {}) {
  const calls = { verify: [], superseded: [], reverted: [], links: [], unlinks: [] };
  const app = await buildApp({
    skipDb: true,
    libraryRepository: {
      async verifyDocument(id, payload) { calls.verify.push({ id, payload }); return { id, verified: payload.verified, verifiedBy: payload.verifiedBy ?? null, status: 'active' }; },
      async markDocumentSuperseded(id) { calls.superseded.push(id); return { id, status: 'superseded' }; },
      async revertSupersededIfOrphan(id) { calls.reverted.push(id); return { id, status: 'active' }; },
      async getDocument(id) { return { id, title: 't', status: 'active' }; },
      ...overrides.library,
    },
    documentLinksRepository: {
      async linkDocuments(s, t, r) { calls.links.push({ s, t, r }); return { linked: true }; },
      async unlinkDocuments(s, t, r) { calls.unlinks.push({ s, t, r }); return true; },
      async listDocumentLinks() { return []; },
      ...overrides.links,
    },
    projectsRepository: { async resolveProject() { return null; } },
  });
  app._calls = calls;
  return app;
}

test('POST verify sets verified true with actor', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: true, as: 'mark' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().verified, true);
  assert.deepEqual(app._calls.verify[0], { id: ID, payload: { verified: true, verifiedBy: 'mark' } });
  await app.close();
});

test('POST verify defaults actor to "user" and supports unverify', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/verify`, payload: { verified: false } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.verify[0], { id: ID, payload: { verified: false, verifiedBy: 'user' } });
  await app.close();
});

test('POST verify rejects a bad id', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: '/api/library/documents/not-a-uuid/verify', payload: { verified: true } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST supersede links new->old and marks old superseded', async () => {
  const app = await build();
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: NEW } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.links[0], { s: NEW, t: ID, r: 'supersedes' });
  assert.deepEqual(app._calls.superseded, [ID]);
  await app.close();
});

test('POST supersede 404s when the link target/source is missing', async () => {
  const app = await build({ links: { async linkDocuments() { return { linked: false }; } } });
  const res = await app.inject({ method: 'POST', url: `/api/library/documents/${ID}/supersede`, payload: { supersededBy: NEW } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('DELETE supersedes link reverts the target status', async () => {
  const app = await build();
  const res = await app.inject({ method: 'DELETE', url: `/api/library/documents/${NEW}/links/${ID}?relation=supersedes` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(app._calls.reverted, [ID]);
  await app.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test tests/backend/libraryRoutes.trust.test.js`
Expected: FAIL — verify route returns 404 (route not registered).

- [ ] **Step 3: Add the verify and supersede routes**

In `server/libraryRoutes.js`, add inside `registerLibraryRoutes` after the existing `app.get('/api/library/documents/:id/links', ...)` block (around line 338):

```javascript
  app.post('/api/library/documents/:id/verify', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const body = isPlainObject(request.body) ? request.body : {};
    if (typeof body.verified !== 'boolean') { reply.code(400); return { message: 'verified must be a boolean' }; }
    const verifiedBy = body.verified ? (typeof body.as === 'string' && body.as.trim() ? body.as.trim() : 'user') : null;
    const document = await repository.verifyDocument(request.params.id, { verified: body.verified, verifiedBy });
    if (!document) { reply.code(404); return { message: 'document not found' }; }
    return document;
  });

  app.post('/api/library/documents/:id/supersede', async (request, reply) => {
    const oldId = request.params.id;
    const newId = isPlainObject(request.body) ? request.body.supersededBy : undefined;
    if (!isValidUuid(oldId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(newId)) { reply.code(400); return { message: 'supersededBy is invalid' }; }
    if (oldId === newId) { reply.code(400); return { message: 'a document cannot supersede itself' }; }
    const link = await documentLinksRepository.linkDocuments(newId, oldId, 'supersedes');
    if (!link.linked) { reply.code(404); return { message: 'document not found' }; }
    await repository.markDocumentSuperseded(oldId);
    return repository.getDocument(oldId);
  });
```

- [ ] **Step 4: Make unlink recompute status for supersedes**

In `server/libraryRoutes.js`, modify the existing `app.delete('/api/library/documents/:id/links/:targetId', ...)` handler (lines 375-385) so that removing a `supersedes` link reverts the (now-orphaned) target. Replace its body with:

```javascript
  app.delete('/api/library/documents/:id/links/:targetId', async (request, reply) => {
    const sourceId = request.params.id;
    const { targetId } = request.params;
    const relation = request.query.relation;
    if (!isValidUuid(sourceId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(targetId)) { reply.code(400); return { message: 'targetId is invalid' }; }
    if (!DOCUMENT_LINK_RELATIONS.includes(relation)) { reply.code(400); return { message: 'relation is invalid' }; }
    const removed = await documentLinksRepository.unlinkDocuments(sourceId, targetId, relation);
    if (!removed) { reply.code(404); return { message: 'link not found' }; }
    if (relation === 'supersedes') {
      await repository.revertSupersededIfOrphan(targetId);
    }
    return documentLinksRepository.listDocumentLinks(sourceId, 'outbound');
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test tests/backend/libraryRoutes.trust.test.js tests/backend/documentLinksRoutes.test.js`
Expected: PASS (new trust tests + existing link-route tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add server/libraryRoutes.js tests/backend/libraryRoutes.trust.test.js
git commit -m "feat(memory): verify + supersede routes; unlink reverts superseded status"
```

---

## Task 4: Pure `contextPack` module

**Files:**
- Create: `server/contextPack.js`
- Test: `tests/backend/contextPack.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/backend/contextPack.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextPack, renderContextPackMarkdown } from '../../server/contextPack.js';

const project = { id: 'p1', slug: 'demo', name: 'Demo', status: 'active' };

const docs = [
  { id: 'c', title: 'Project card', body: 'Overview body', documentType: 'note', tags: ['project-card'], verified: true, status: 'active' },
  { id: 'r', title: 'Restore runbook', body: 'steps', documentType: 'runbook', tags: [], verified: true, status: 'active' },
  { id: 'm', title: 'A decision', body: 'we chose X', documentType: 'note', tags: [], verified: true, status: 'active' },
  { id: 'u', title: 'Agent note', body: 'maybe Y', documentType: 'note', tags: [], verified: false, status: 'active' },
  { id: 's', title: 'Old', body: 'gone', documentType: 'note', tags: [], verified: true, status: 'superseded' },
];

test('buildContextPack quarantines unverified, excludes superseded, sorts sections', () => {
  const pack = buildContextPack(docs, { project, query: 'how do we restore', limit: 12 });
  const kinds = pack.sections.map((s) => s.kind);
  assert.deepEqual(kinds, ['overview', 'relevant', 'runbooks', 'unverified']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'overview').items.map((i) => i.id), ['c']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'runbooks').items.map((i) => i.id), ['r']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'relevant').items.map((i) => i.id), ['m']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'unverified').items.map((i) => i.id), ['u']);
  // superseded 's' appears nowhere
  const allIds = pack.sections.flatMap((s) => s.items.map((i) => i.id));
  assert.ok(!allIds.includes('s'));
});

test('buildContextPack omits empty sections and respects limit', () => {
  const pack = buildContextPack(
    [{ id: 'm1', title: 'm1', body: 'b', documentType: 'note', tags: [], verified: true, status: 'active' },
     { id: 'm2', title: 'm2', body: 'b', documentType: 'note', tags: [], verified: true, status: 'active' }],
    { project, query: '', limit: 1 },
  );
  assert.deepEqual(pack.sections.map((s) => s.kind), ['relevant']);
  assert.equal(pack.sections[0].items.length, 1);
  assert.equal(pack.sections[0].title, 'Recent memory');
});

test('renderContextPackMarkdown renders header, query, and unverified marker', () => {
  const pack = buildContextPack(docs, { project, query: 'restore', limit: 12 });
  const md = renderContextPackMarkdown(pack);
  assert.match(md, /^# Context: Demo \(active\)/);
  assert.match(md, /_Query: restore_/);
  assert.match(md, /## ⚠ Unverified — pending human review/);
  assert.match(md, /### Agent note — _unverified_/);
  assert.match(md, /\(runbook · r\)/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test tests/backend/contextPack.test.js`
Expected: FAIL — `Cannot find module '../../server/contextPack.js'`.

- [ ] **Step 3: Implement the module**

Create `server/contextPack.js`:

```javascript
const DEFAULT_LIMIT = 12;
const SNIPPET_LEN = 280;

function snippet(body) {
  return String(body || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
}

function hasTag(doc, tag) {
  return (doc.tags || []).map((t) => String(t || '').toLowerCase()).includes(tag);
}

function toItem(doc, { full = false } = {}) {
  return {
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    verified: Boolean(doc.verified),
    text: full ? String(doc.body || '') : snippet(doc.body),
  };
}

// Pure: select + classify documents into a bounded, trust-aware context pack.
// Input `docs` arrive pre-ordered by the caller (similarity when a query is
// given, recency otherwise); order is preserved within each section.
export function buildContextPack(docs, { project = null, query = '', limit = DEFAULT_LIMIT } = {}) {
  const active = (Array.isArray(docs) ? docs : []).filter((d) => (d.status || 'active') === 'active');
  const cards = active.filter((d) => d.verified && hasTag(d, 'project-card'));
  const runbooks = active.filter((d) => d.verified && d.documentType === 'runbook' && !cards.includes(d));
  const relevant = active
    .filter((d) => d.verified && !cards.includes(d) && !runbooks.includes(d))
    .slice(0, limit);
  const unverified = active.filter((d) => !d.verified).slice(0, limit);

  const sections = [
    { kind: 'overview', title: 'Project overview', items: cards.map((d) => toItem(d, { full: true })) },
    { kind: 'relevant', title: query ? 'Relevant memory' : 'Recent memory', items: relevant.map((d) => toItem(d)) },
    { kind: 'runbooks', title: 'Active runbooks', items: runbooks.map((d) => toItem(d)) },
    { kind: 'unverified', title: '⚠ Unverified — pending human review', items: unverified.map((d) => toItem(d)) },
  ].filter((s) => s.items.length > 0);

  return {
    project: project ? { id: project.id, slug: project.slug, name: project.name, status: project.status } : null,
    query: query || null,
    sections,
  };
}

export function renderContextPackMarkdown(pack) {
  const lines = [];
  const p = pack.project;
  lines.push(`# Context: ${p ? p.name : 'Unknown project'}${p && p.status ? ` (${p.status})` : ''}`);
  if (pack.query) lines.push(`\n_Query: ${pack.query}_`);
  for (const section of pack.sections) {
    lines.push(`\n## ${section.title}`);
    for (const it of section.items) {
      lines.push(`\n### ${it.title}${it.verified ? '' : ' — _unverified_'}`);
      if (section.kind === 'runbooks') lines.push(`(runbook · ${it.id})`);
      else if (it.text) lines.push(it.text);
    }
  }
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test tests/backend/contextPack.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/contextPack.js tests/backend/contextPack.test.js
git commit -m "feat(memory): pure contextPack builder + markdown renderer"
```

---

## Task 5: Context-pack route

**Files:**
- Modify: `server/libraryRoutes.js` (imports + new route)
- Test: `tests/backend/libraryRoutes.trust.test.js` (append context-pack cases)

- [ ] **Step 1: Write the failing tests**

Append to `tests/backend/libraryRoutes.trust.test.js`:

```javascript
function buildPack(overrides = {}) {
  return buildApp({
    skipDb: true,
    libraryRepository: {
      async listDocuments(filters) {
        buildPack._lastFilters = filters;
        return [
          { id: 'm', title: 'Decision', body: 'chose X', documentType: 'note', tags: [], verified: true, status: 'active' },
          { id: 'u', title: 'Agent note', body: 'maybe Y', documentType: 'note', tags: [], verified: false, status: 'active' },
        ];
      },
      ...overrides.library,
    },
    projectsRepository: { async resolveProject(v) { return v === 'demo' ? { id: 'p1', slug: 'demo', name: 'Demo', status: 'active' } : null; } },
    embedder: null,
  });
}

test('GET context-pack returns markdown by default', async () => {
  const app = await buildPack();
  const res = await app.inject({ method: 'GET', url: '/api/projects/demo/context-pack' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
  assert.match(res.body, /# Context: Demo/);
  assert.match(res.body, /## ⚠ Unverified/);
  assert.deepEqual(buildPack._lastFilters, { projectId: 'p1', status: 'active' });
  await app.close();
});

test('GET context-pack returns json when asked', async () => {
  const app = await buildPack();
  const res = await app.inject({ method: 'GET', url: '/api/projects/demo/context-pack?format=json' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().project.slug, 'demo');
  await app.close();
});

test('GET context-pack 404s on unknown project', async () => {
  const app = await buildPack();
  const res = await app.inject({ method: 'GET', url: '/api/projects/nope/context-pack' });
  assert.equal(res.statusCode, 404);
  await app.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test tests/backend/libraryRoutes.trust.test.js`
Expected: FAIL — context-pack returns 404 (route not registered).

- [ ] **Step 3: Add the import**

In `server/libraryRoutes.js`, add to the imports at the top (after the `libraryExport.js` import block, line 11):

```javascript
import { buildContextPack, renderContextPackMarkdown } from './contextPack.js';
```

- [ ] **Step 4: Add the route**

In `server/libraryRoutes.js`, add inside `registerLibraryRoutes` after the supersede route (from Task 3):

```javascript
  app.get('/api/projects/:idOrSlug/context-pack', async (request, reply) => {
    const project = await projectsRepository.resolveProject(String(request.params.idOrSlug));
    if (!project) { reply.code(404); return { message: 'project not found' }; }

    const rawLimit = Number(request.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 12;
    const query = request.query.query ? String(request.query.query) : '';

    let docs = [];
    if (query && embedder && await semanticActive()) {
      try {
        const { vector } = await embedder.embed(query, { query: true });
        const search = app.embeddingSearch || {};
        docs = await repository.searchDocumentsSemantic(toVectorLiteral(vector), embedder.backend, {
          projectId: project.id,
          limit: 50,
          minSimilarity: search.minSimilarity,
          topDrop: search.topDrop,
        });
      } catch (err) {
        // Degrade to recency rather than fail — keyword/recency always works.
        request.log.error({ err }, 'context-pack semantic embed failed');
        docs = [];
      }
    }
    if (docs.length === 0) {
      docs = await repository.listDocuments({ projectId: project.id, status: 'active' });
    }

    const pack = buildContextPack(docs, { project, query, limit });
    if (request.query.format === 'json') return pack;
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    return renderContextPackMarkdown(pack);
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test tests/backend/libraryRoutes.trust.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/libraryRoutes.js tests/backend/libraryRoutes.trust.test.js
git commit -m "feat(memory): GET /api/projects/:id/context-pack (semantic with recency fallback)"
```

---

## Task 6: `toRef` trust + demo server mirror

**Files:**
- Modify: `server/libraryRoutes.js` (`toRef`, lines 108-117)
- Modify: `scripts/demo-server.js` (in-memory doc fields + repo methods)

- [ ] **Step 1: Add trust to the semantic-search `toRef`**

In `server/libraryRoutes.js`, update `toRef` so semantic results carry trust state:

```javascript
  function toRef(doc) {
    return {
      id: doc.id,
      title: doc.title,
      documentType: doc.documentType,
      projectId: doc.projectId,
      tags: doc.tags || [],
      verified: Boolean(doc.verified),
      status: doc.status || 'active',
      snippet: String(doc.body || '').slice(0, 200),
    };
  }
```

- [ ] **Step 2: Verify the existing semantic route test still passes**

Run: `npm test tests/backend/semanticRoutes.test.js`
Expected: PASS — if a test asserts the exact `toRef` key set, update it to include `verified` and `status` (mirror the change). Re-run until green.

- [ ] **Step 3: Mirror the four fields on demo documents**

In `scripts/demo-server.js`, the document factory (around line 143-152, `createDocument(seed)`) sets `updatedBy`/`kind`. Add the trust fields right after `kind` so seed docs and created docs carry them:

```javascript
    updatedBy: seed.updatedBy || 'user',
    kind: seed.kind || 'source',
    verified: seed.verified ?? ((seed.updatedBy || 'user') === 'agent' ? false : true),
    verifiedAt: seed.verifiedAt ?? null,
    verifiedBy: seed.verifiedBy ?? null,
    status: seed.docStatus || 'active',
```

(Use `docStatus` for the seed key to avoid colliding with task/project `status`; documents default to `'active'`.)

- [ ] **Step 4: Set trust on demo create + add the three repo methods + status filter**

In `createMemoryLibraryRepository` (around line 388), in `createDocument` (line 416-423) set origin-based trust after the existing assignments:

```javascript
      created.verified = (document.updatedBy || 'user') === 'agent' ? false : true;
      created.verifiedAt = null;
      created.verifiedBy = null;
      created.status = 'active';
```

In `listDocuments` (line 391), add a status filter alongside the existing ones:

```javascript
        if (filters.status && document.status && document.status !== filters.status) return false;
```

Add three methods to the returned repository object (next to `getDocument`):

```javascript
    async verifyDocument(id, { verified, verifiedBy = null } = {}) {
      const document = documents.find((d) => d.id === id && !d.archivedAt);
      if (!document) return null;
      document.verified = Boolean(verified);
      document.verifiedAt = verified ? new Date().toISOString() : null;
      document.verifiedBy = verified ? verifiedBy : null;
      return document;
    },
    async markDocumentSuperseded(id) {
      const document = documents.find((d) => d.id === id && !d.archivedAt);
      if (!document || document.status !== 'active') return document || null;
      document.status = 'superseded';
      return document;
    },
    async revertSupersededIfOrphan(id) {
      const document = documents.find((d) => d.id === id && !d.archivedAt);
      if (!document || document.status !== 'superseded') return document || null;
      const stillSuperseded = (linksRef || []).some((l) => l.targetId === id && l.relation === 'supersedes');
      if (!stillSuperseded) document.status = 'active';
      return document;
    },
```

> Note for the implementer: confirm the in-memory links collection name and shape by reading `createMemoryLibraryRepository` and its `linksRef` usage near line 388-414 (the existing Links feature already stores `{ sourceId, targetId, relation }`-style records). If `revertSupersededIfOrphan` cannot see a links array, have it revert unconditionally (the demo has no real link lifecycle guarantees) and leave a one-line comment saying so — do NOT invent a new links store.

- [ ] **Step 5: Smoke-test the demo server**

Run:
```bash
node scripts/demo-server.js &
sleep 1
curl -s "http://127.0.0.1:3100/api/projects/homelab/context-pack" | head -5
curl -s "http://127.0.0.1:3100/api/library/documents" | node -e "process.stdin.on('data',d=>{const a=JSON.parse(d);console.log('verified' in a[0], 'status' in a[0]);})"
kill %1
```
Expected: the context-pack curl prints a `# Context:` Markdown header; the second prints `true true`. (If the demo seeds no docs for `homelab`, use a project slug that has seed documents — check the seed data near lines 343-380.)

- [ ] **Step 6: Run the full backend test suite**

Run: `npm test tests/backend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/libraryRoutes.js scripts/demo-server.js tests/backend/semanticRoutes.test.js
git commit -m "feat(memory): semantic refs carry trust; demo server mirrors trust + new routes"
```

---

## Task 7: CLI project-detection resolver (pure)

**Files:**
- Create: `cli/lib/detectProject.js`
- Test: `tests/cli/detectProject.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/detectProject.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProject } from '../../cli/lib/detectProject.js';

test('flag wins over everything', () => {
  const out = detectProject({ flag: 'explicit', env: 'envproj', cwd: '/work/repo', readFile: () => '{"project":"fromfile"}' });
  assert.deepEqual(out, { project: 'explicit', source: 'flag' });
});

test('env wins over file and folder', () => {
  const out = detectProject({ env: 'envproj', cwd: '/work/repo', readFile: () => '{"project":"fromfile"}' });
  assert.deepEqual(out, { project: 'envproj', source: 'env' });
});

test('reads .moomora/project.json walking up from cwd', () => {
  const files = { '/work/repo/sub/.moomora/project.json': null, '/work/repo/.moomora/project.json': '{"project":"fromfile"}' };
  const out = detectProject({ cwd: '/work/repo/sub', readFile: (p) => { if (!(p in files) || files[p] === null) throw new Error('nope'); return files[p]; } });
  assert.deepEqual(out, { project: 'fromfile', source: 'file' });
});

test('falls back to cwd folder name', () => {
  const out = detectProject({ cwd: '/work/my-repo', readFile: () => { throw new Error('nope'); } });
  assert.deepEqual(out, { project: 'my-repo', source: 'folder' });
});

test('returns null project when cwd is root and nothing else resolves', () => {
  const out = detectProject({ cwd: '/', readFile: () => { throw new Error('nope'); } });
  assert.equal(out.project, null);
  assert.equal(out.source, 'none');
});

test('ignores a malformed project.json and keeps walking', () => {
  const out = detectProject({ cwd: '/work/repo', readFile: (p) => (p === '/work/repo/.moomora/project.json' ? 'not json' : (() => { throw new Error('nope'); })()) });
  assert.deepEqual(out, { project: 'repo', source: 'folder' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test tests/cli/detectProject.test.js`
Expected: FAIL — `Cannot find module '../../cli/lib/detectProject.js'`.

- [ ] **Step 3: Implement the resolver**

Create `cli/lib/detectProject.js`:

```javascript
import { readFileSync } from 'node:fs';
import { dirname, basename, sep } from 'node:path';

// Pure resolver: precedence flag > env > .moomora/project.json (walking up) >
// cwd folder name > none. `readFile` is injected for testability (defaults to
// synchronous fs read).
export function detectProject({ flag, env, cwd = process.cwd(), readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  if (flag && String(flag).trim()) return { project: String(flag).trim(), source: 'flag' };
  if (env && String(env).trim()) return { project: String(env).trim(), source: 'env' };

  let dir = cwd;
  while (true) {
    const candidate = `${dir}${dir.endsWith(sep) ? '' : sep}.moomora${sep}project.json`;
    try {
      const parsed = JSON.parse(readFile(candidate));
      if (parsed && typeof parsed.project === 'string' && parsed.project.trim()) {
        return { project: parsed.project.trim(), source: 'file' };
      }
    } catch {
      // not found / not readable / malformed — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const folder = basename(cwd);
  if (folder && folder !== sep && folder !== '') return { project: folder, source: 'folder' };
  return { project: null, source: 'none' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test tests/cli/detectProject.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/detectProject.js tests/cli/detectProject.test.js
git commit -m "feat(cli): pure project-detection resolver (flag>env>file>folder)"
```

---

## Task 8: CLI API client + formatters

**Files:**
- Create: `cli/lib/apiClient.js`
- Create: `cli/lib/format.js`
- Test: `tests/cli/format.test.js` (new)

- [ ] **Step 1: Write the failing formatter tests**

Create `tests/cli/format.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSearchResults, formatDocument, trustTag } from '../../cli/lib/format.js';

test('trustTag reflects verified + status', () => {
  assert.equal(trustTag({ verified: true, status: 'active' }), '[verified]');
  assert.equal(trustTag({ verified: false, status: 'active' }), '[unverified]');
  assert.equal(trustTag({ verified: true, status: 'superseded' }), '[superseded]');
});

test('formatSearchResults lists title, trust, and snippet', () => {
  const out = formatSearchResults([
    { id: 'a', title: 'Alpha', verified: true, status: 'active', snippet: 'hello' },
    { id: 'b', title: 'Beta', verified: false, status: 'active', snippet: 'world' },
  ]);
  assert.match(out, /Alpha \[verified\]/);
  assert.match(out, /Beta \[unverified\]/);
  assert.match(out, /hello/);
});

test('formatSearchResults handles empty', () => {
  assert.match(formatSearchResults([]), /No results/);
});

test('formatDocument shows trust header and body', () => {
  const out = formatDocument({ id: 'a', title: 'Alpha', verified: false, status: 'active', updatedBy: 'agent', body: '# Body' });
  assert.match(out, /Alpha \[unverified\]/);
  assert.match(out, /updated by agent/);
  assert.match(out, /# Body/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test tests/cli/format.test.js`
Expected: FAIL — `Cannot find module '../../cli/lib/format.js'`.

- [ ] **Step 3: Implement the formatters**

Create `cli/lib/format.js`:

```javascript
export function trustTag(doc) {
  if ((doc.status || 'active') === 'superseded') return '[superseded]';
  if ((doc.status || 'active') === 'deprecated') return '[deprecated]';
  return doc.verified ? '[verified]' : '[unverified]';
}

export function formatSearchResults(results) {
  if (!Array.isArray(results) || results.length === 0) return 'No results.';
  return results
    .map((r) => {
      const head = `• ${r.title || 'Untitled'} ${trustTag(r)}  (${r.id})`;
      const snip = r.snippet ? `\n    ${String(r.snippet).replace(/\s+/g, ' ').trim()}` : '';
      return head + snip;
    })
    .join('\n');
}

export function formatDocument(doc) {
  if (!doc) return 'Document not found.';
  const lines = [
    `${doc.title || 'Untitled'} ${trustTag(doc)}`,
    `updated by ${doc.updatedBy || 'user'}${doc.verifiedBy ? ` · verified by ${doc.verifiedBy}` : ''}`,
    '',
    String(doc.body || ''),
  ];
  return lines.join('\n');
}
```

- [ ] **Step 4: Implement the API client (no test — thin I/O wrapper, covered by the smoke test in Task 9)**

Create `cli/lib/apiClient.js`:

```javascript
// Thin HTTP client over the Moomora API. No business logic — every method maps
// to one endpoint. Uses global fetch (Node 20+).
export function createClient({ baseUrl, token } = {}) {
  const base = (baseUrl || process.env.MOOMORA_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

  async function request(method, path, { body, agent = false, accept } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (agent) headers['x-moomora-origin'] = 'agent';
    if (accept) headers['accept'] = accept;
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const message = payload && payload.message ? payload.message : `HTTP ${res.status}`;
      throw new Error(message);
    }
    return payload;
  }

  return {
    base,
    contextPack(project, { query, format = 'md', limit } = {}) {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (format === 'json') params.set('format', 'json');
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return request('GET', `/api/projects/${encodeURIComponent(project)}/context-pack${qs ? `?${qs}` : ''}`,
        { accept: format === 'json' ? 'application/json' : 'text/markdown' });
    },
    keywordSearch(project, q, { all = false } = {}) {
      const params = new URLSearchParams({ q });
      if (project) params.set('project', project);
      if (!all) params.set('status', 'active');
      return request('GET', `/api/library/documents?${params.toString()}`);
    },
    semanticSearch(project, q, { all = false } = {}) {
      const params = new URLSearchParams({ q });
      if (project) params.set('project', project);
      if (all) params.set('all', 'true');
      return request('GET', `/api/library/documents/semantic-search?${params.toString()}`);
    },
    getDocument(id) {
      return request('GET', `/api/library/documents/${encodeURIComponent(id)}`);
    },
    findByTitle(project, title) {
      const params = new URLSearchParams({ q: title });
      if (project) params.set('project', project);
      return request('GET', `/api/library/documents?${params.toString()}`);
    },
    createMemory(doc) {
      return request('POST', '/api/library/documents', { body: doc, agent: true });
    },
    updateMemory(id, patch) {
      return request('PATCH', `/api/library/documents/${encodeURIComponent(id)}`, { body: patch, agent: true });
    },
    verify(id, { verified, as } = {}) {
      return request('POST', `/api/library/documents/${encodeURIComponent(id)}/verify`, { body: { verified, as } });
    },
    supersede(oldId, newId) {
      return request('POST', `/api/library/documents/${encodeURIComponent(oldId)}/supersede`, { body: { supersededBy: newId } });
    },
  };
}
```

- [ ] **Step 5: Run the formatter tests to verify they pass**

Run: `npm test tests/cli/format.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/lib/apiClient.js cli/lib/format.js tests/cli/format.test.js
git commit -m "feat(cli): thin API client + trust-aware output formatters"
```

---

## Task 9: CLI entry point, commands, and bin wiring

**Files:**
- Create: `cli/moomora.js`
- Modify: `package.json` (`bin` + `check` script)
- Create: `.moomora/project.json` (dogfood this repo)

- [ ] **Step 1: Implement the CLI entry point**

Create `cli/moomora.js`:

```javascript
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from './lib/detectProject.js';
import { createClient } from './lib/apiClient.js';
import { formatSearchResults, formatDocument } from './lib/format.js';

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function resolveProjectName(flags) {
  const { project, source } = detectProject({ flag: flags.project, env: process.env.MOOMORA_PROJECT });
  if (!project) {
    throw new Error('No project detected. Pass --project <slug>, set MOOMORA_PROJECT, or run `moomora init`.');
  }
  return { project, source };
}

const HELP = `moomora — shared project memory CLI

Usage:
  moomora init [--project <slug>]
  moomora context [query...] [--json] [--limit <n>]
  moomora search <query> [--all] [--json]
  moomora get <id> [--json]
  moomora remember <title> [--body <text>] [--type runbook|note] [--tag <t>]
  moomora verify <id> [--as <name>]
  moomora unverify <id>
  moomora supersede <oldId> --with <newId>

Global flags: --project <slug>  --url <baseUrl>  --json
Env: MOOMORA_API_URL  MOOMORA_PROJECT  MOOMORA_TOKEN`;

async function main(argv) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const client = createClient({ baseUrl: flags.url, token: process.env.MOOMORA_TOKEN });
  const out = (text) => process.stdout.write(`${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}\n`);

  if (!command || command === 'help' || flags.help) { out(HELP); return; }

  if (command === 'init') {
    const project = flags.project || detectProject({}).project;
    if (!project) throw new Error('Cannot infer a project name; pass --project <slug>.');
    mkdirSync('.moomora', { recursive: true });
    writeFileSync(join('.moomora', 'project.json'), `${JSON.stringify({ project }, null, 2)}\n`);
    out(`Wrote .moomora/project.json (project: ${project}).`);
    return;
  }

  if (command === 'context') {
    const { project } = resolveProjectName(flags);
    const query = positionals.slice(1).join(' ');
    const format = flags.json ? 'json' : 'md';
    const pack = await client.contextPack(project, { query, format, limit: flags.limit });
    out(pack);
    return;
  }

  if (command === 'search') {
    const { project } = resolveProjectName(flags);
    const query = positionals.slice(1).join(' ');
    if (!query) throw new Error('search requires a query.');
    let results;
    try {
      results = await client.semanticSearch(project, query, { all: Boolean(flags.all) });
    } catch {
      results = await client.keywordSearch(project, query, { all: Boolean(flags.all) });
    }
    out(flags.json ? results : formatSearchResults(results));
    return;
  }

  if (command === 'get') {
    const id = positionals[1];
    if (!id) throw new Error('get requires a document id.');
    const doc = await client.getDocument(id);
    out(flags.json ? doc : formatDocument(doc));
    return;
  }

  if (command === 'remember') {
    const { project } = resolveProjectName(flags);
    const title = positionals[1];
    if (!title) throw new Error('remember requires a title.');
    const body = flags.body !== undefined && flags.body !== true ? String(flags.body) : '';
    const documentType = flags.type === 'runbook' ? 'runbook' : 'note';
    const tags = flags.tag ? [String(flags.tag)] : [];
    const existing = (await client.findByTitle(project, title)).find((d) => d.title === title);
    const saved = existing
      ? await client.updateMemory(existing.id, { title, body, documentType, tags })
      : await client.createMemory({ title, body, documentType, project, tags });
    out(flags.json ? saved : `${existing ? 'Updated' : 'Remembered'} "${saved.title}" (${saved.id}) — unverified.`);
    return;
  }

  if (command === 'verify' || command === 'unverify') {
    const id = positionals[1];
    if (!id) throw new Error(`${command} requires a document id.`);
    const doc = await client.verify(id, { verified: command === 'verify', as: flags.as || 'cli' });
    out(flags.json ? doc : `${command === 'verify' ? 'Verified' : 'Unverified'} ${id}.`);
    return;
  }

  if (command === 'supersede') {
    const oldId = positionals[1];
    const newId = flags.with;
    if (!oldId || !newId || newId === true) throw new Error('supersede requires <oldId> --with <newId>.');
    const doc = await client.supersede(oldId, String(newId));
    out(flags.json ? doc : `Superseded ${oldId} with ${newId}.`);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`moomora: ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the bin entry and check target**

In `package.json`, add a top-level `bin` field and extend `check`:

```json
  "bin": {
    "moomora": "cli/moomora.js"
  },
```

And append to the `check` script (after `mcp/server.js`):

```
&& node --check cli/moomora.js && node --check cli/lib/detectProject.js && node --check cli/lib/apiClient.js && node --check cli/lib/format.js
```

- [ ] **Step 3: Make the entry executable + write the dogfood config**

Run:
```bash
chmod +x cli/moomora.js
mkdir -p .moomora
printf '{\n  "project": "moomora-console"\n}\n' > .moomora/project.json
```

- [ ] **Step 4: Smoke-test the CLI against the demo server**

Run:
```bash
node scripts/demo-server.js &
sleep 1
MOOMORA_API_URL=http://127.0.0.1:3100 node cli/moomora.js context --project homelab | head -5
MOOMORA_API_URL=http://127.0.0.1:3100 node cli/moomora.js search runbook --project homelab | head -5
kill %1
```
Expected: `context` prints a `# Context:` Markdown header; `search` prints either results or `No results.` without crashing. (Use a project slug that has demo seed docs.)

- [ ] **Step 5: Run check + cli tests**

Run: `npm run check && npm test tests/cli`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/moomora.js package.json .moomora/project.json
git commit -m "feat(cli): moomora entry point (init/context/search/get/remember/verify/supersede)"
```

---

## Task 10: Read-only trust display in the web UI

**Files:**
- Modify: `public/js/renderLibrary.js` (`renderDocumentRows`, `renderDocumentDetail` header)
- Modify: `public/styles.css` (trust chip styles)

- [ ] **Step 1: Add a trust-chip helper and use it in list rows**

In `public/js/renderLibrary.js`, add a helper near `renderKindBadge` (line 284):

```javascript
function renderTrustChips(document) {
  const chips = [];
  if (document.verified === true) {
    chips.push('<span class="chip chip-verified" aria-label="Verified by a human">VERIFIED</span>');
  }
  if (document.status === 'superseded') {
    chips.push('<span class="chip chip-superseded" aria-label="Superseded by a newer document">SUPERSEDED</span>');
  }
  return chips.join('');
}
```

Then in `renderDocumentRows` (lines 165-178), append the trust chips after the existing SYNTH/STALE chips inside the `<strong>`:

```javascript
function renderDocumentRows(documents, activeDocumentId) {
  return documents.map((document) => {
    const isSelected = document.id === activeDocumentId;
    const isSynthesized = document.kind === 'synthesized';
    const isStale = document.stale === true;
    const isSuperseded = document.status === 'superseded';
    return `
      <button class="document-row${isSelected ? ' is-selected' : ''}${isSuperseded ? ' is-superseded' : ''}" type="button" data-library-document-id="${escapeHtml(document.id)}"${isSelected ? ' aria-current="true"' : ''}>
        <span>
          <strong>${escapeHtml(document.title || 'Untitled document')}${isSynthesized ? ' <span class="chip chip-synth" aria-label="Agent synthesized">SYNTH</span>' : ''}${isStale ? ' <span class="chip chip-stale" aria-label="Derived source has changed">STALE</span>' : ''}${renderTrustChips(document)}</strong>
          <small>${escapeHtml(labelFromValue(document.documentType || 'note'))} &middot; ${escapeHtml(document.sourceFilename || 'Created in Moomora Console')}</small>
        </span>
        <span class="document-tags">${renderTags(document.tags)}</span>
      </button>`;
  }).join('');
}
```

- [ ] **Step 2: Show trust in the detail header**

In `renderDocumentDetail` (line 348-350), add the trust chips next to the kind badge and a verified-by line:

```javascript
        <h2 id="selected-document-title">${escapeHtml(document.title || 'Untitled document')} ${renderKindBadge(document.kind)}${renderTrustChips(document)}</h2>
        <p>${escapeHtml(document.sourceFilename || 'Created in Moomora Console')}</p>
        <p class="library-detail-meta">Updated by ${escapeHtml(document.updatedBy || 'user')}${document.verified ? ` · verified${document.verifiedBy ? ` by ${escapeHtml(document.verifiedBy)}` : ''}` : ' · unverified'}</p>
```

- [ ] **Step 3: Add chip styles**

In `public/styles.css`, find the existing `.chip-synth` / `.chip-stale` rules (search for `chip-stale`) and add alongside them:

```css
.chip-verified {
  background: rgba(46, 160, 67, 0.16);
  color: #2ea043;
  border: 1px solid rgba(46, 160, 67, 0.4);
}

.chip-superseded {
  background: rgba(139, 148, 158, 0.16);
  color: #8b949e;
  border: 1px solid rgba(139, 148, 158, 0.4);
}

.document-row.is-superseded {
  opacity: 0.55;
}
```

(Match the existing chip rule shape — if `.chip-synth` defines padding/font-size on a shared `.chip` selector, these inherit it; only colour/opacity is added here.)

- [ ] **Step 4: Verify the syntax check passes**

Run: `npm run check`
Expected: PASS (`node --check public/js/main.js` covers the module graph; `renderLibrary.js` is imported by it).

- [ ] **Step 5: Visual smoke test**

Run:
```bash
node scripts/demo-server.js &
sleep 1
echo "Open http://127.0.0.1:3100 → Library. Confirm a VERIFIED chip on human docs and no crash."
# kill %1 when done
```
Expected: Library list renders; human-authored demo docs show `VERIFIED`; agent docs show none; no console errors. Kill the server when done.

- [ ] **Step 6: Commit**

```bash
git add public/js/renderLibrary.js public/styles.css
git commit -m "feat(ui): read-only trust display (VERIFIED/SUPERSEDED chips + meta)"
```

---

## Task 11: Documentation, CHANGELOG, and final verification

**Files:**
- Create: `docs/cli.md`
- Modify: `docs/contract.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the CLI documentation**

Create `docs/cli.md` documenting: install (`npm link` → `moomora`), the detection order, `.moomora/project.json`, every command with an example, the env vars (`MOOMORA_API_URL`, `MOOMORA_PROJECT`, `MOOMORA_TOKEN`), and the trust model (agent writes are unverified; humans verify/supersede; "verified" is a workflow signal, not access control, under the no-auth model). Include a short "context pack" example showing the Markdown output shape.

- [ ] **Step 2: Update the contract doc**

In `docs/contract.md`, in the library document section, document the four new fields (`verified`, `verifiedAt`, `verifiedBy`, `status` with values `active`/`superseded`/`deprecated`) and note they are runtime trust state — **not** part of the portable `.md` export front-matter. Document the three new endpoints (`POST …/verify`, `POST …/supersede`, `GET /api/projects/:id/context-pack`).

- [ ] **Step 3: Update the README**

In `README.md`, add a short "Shared memory CLI" subsection under or near the MCP/semantic-search sections: one paragraph on what `moomora` does (pull a context pack, search/read/write memory, verify/supersede), a pointer to `docs/cli.md`, and a one-line example:

```bash
moomora context "how do we restore postgres"
```

- [ ] **Step 4: Add a CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```markdown
### Added
- Shared memory trust model: documents now carry `verified` / `status`
  (active/superseded/deprecated). Agent-written memory is unverified by default;
  humans verify or supersede it. Retrieval is active-only and quarantines
  unverified memory.
- `GET /api/projects/:id/context-pack` — a bounded, trust-aware Markdown (or
  JSON) briefing assembled from project memory, with semantic ranking when
  embeddings are on and a recency fallback otherwise.
- `POST /api/library/documents/:id/verify` and `.../supersede`.
- A thin `moomora` CLI (`cli/`) so any shell-capable agent can pull a context
  pack and read/write/verify project memory. See `docs/cli.md`.
- Read-only trust display (VERIFIED / SUPERSEDED) in the Library UI.
```

- [ ] **Step 5: Run the full test suite + check**

Run: `npm test && npm run check`
Expected: PASS (backend, contract, cli, frontend suites all green; all `--check` targets parse).

- [ ] **Step 6: Migration sanity (if a local Postgres is available)**

If a local Postgres + `DATABASE_URL` is available, run `npm run migrate` against a scratch database and confirm `0007` applies cleanly and is idempotent (run it twice). If no database is available, note this as a manual verification step for the reviewer and rely on the SQL review.

- [ ] **Step 7: Commit**

```bash
git add docs/cli.md docs/contract.md README.md CHANGELOG.md
git commit -m "docs(memory): CLI guide, contract fields/endpoints, README, CHANGELOG"
```

---

## Self-Review Checklist (run before opening the PR)

- **Spec coverage:** Every spec section maps to a task — data model (T1), trust workflow (T2/T3), context pack (T4/T5), CLI (T7/T8/T9), conservative retrieval (T2 filter + T5 fallback + T4 quarantine), read-only UI (T10), demo+contract mirror (T1/T6), testing throughout, docs (T11). ✓
- **No-vector-leak invariant:** T1 keeps `normalizeDocumentRow` an explicit allowlist (no spread); semantic SELECT adds only `verified`/`status` scalars; `toRef` re-narrows. ✓
- **Export contract intact:** no change to `libraryExport.js`; trust fields are explicitly excluded from the portable `.md` front-matter (T11 documents this). ✓
- **Name consistency:** `verifyDocument` / `markDocumentSuperseded` / `revertSupersededIfOrphan`; builders `buildVerifyDocument` / `buildMarkSuperseded` / `buildRevertSupersededIfOrphan`; `buildContextPack` / `renderContextPackMarkdown`; CLI `detectProject` / `createClient`. Used identically across tasks. ✓
- **No-auth honesty:** verify has no access control; documented as a workflow signal (T11). ✓
- **Deferred scope respected:** no `memory_type` column, no external refs, no repo-URL detection, no RAG, no verify/supersede UI actions, no new MCP tools. ✓
