# Semantic search (embeddings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pgvector-backed semantic search over the library — paraphrased queries find topically-relevant docs — behind a clean multi-backend embedder interface, shipping the Ollama adapter (+ a deterministic `fake` test backend) in v0.13.0.

**Architecture:** A dimensionless `vector` column on `markdown_documents` (index-free brute-force cosine at single-user scale). A `server/embedder/` abstraction resolves the active backend from env. On-write async embedding + a manual reindex endpoint keep vectors current. A config-gated, runtime-toggled (`app_settings`) feature flag governs availability across HTTP, MCP, and UI. Retrieval-only — no generation.

**Tech Stack:** Node 20+ (global `fetch` for the embedder), Fastify, plain `pg` (vectors serialized as `$1::vector` literals — no new npm dep), pgvector Postgres extension, Node test runner, the Playwright e2e harness.

**Spec:** [`docs/superpowers/specs/2026-06-03-semantic-search-design.md`](../specs/2026-06-03-semantic-search-design.md)

**Target release:** v0.13.0. Follow-up v0.13.1 adds OpenAI / Gemini / Voyage adapters behind the same interface.

---

## File map

**Create:**
- `server/migrations/0005_add_embeddings.sql` — vector extension + embedding columns.
- `server/migrations/0006_add_app_settings.sql` — KV settings table.
- `server/embedder/index.js` — `createEmbedder(config)`.
- `server/embedder/fake.js` — deterministic test adapter.
- `server/embedder/ollama.js` — Ollama adapter.
- `server/embeddingService.js` — `embedDocument`, `reindex`.
- `server/appSettingsRepository.js` — KV get/put.
- `server/vectorLiteral.js` — `number[]` → `'[..]'` pgvector literal.
- `server/settingsRoutes.js` — `GET/PUT /api/settings/semantic-search`.
- `mcp/tools/semanticSearch.js` — `search_documents_semantic` tool.
- Tests for each (see tasks).

**Modify:**
- `server/config.js` — embedding env fields.
- `server/libraryRepository.js` — `setDocumentEmbedding`, `buildSearchDocumentsSemantic`, `buildListDocumentsNeedingEmbedding`, `countEmbeddings`. (NOT in `normalizeDocumentRow` — vectors never ride in doc responses.)
- `server/libraryRoutes.js` — semantic-search route, reindex route, on-write embed trigger.
- `server/index.js` — wire embedder + app-settings repo + settings routes.
- `mcp/moomoraClient.js` — `searchDocumentsSemantic`.
- `mcp/server.js` — register the new tool.
- `tests/contract/mcpToolContract.test.js` — lock `search_documents_semantic`.
- `public/js/libraryApi.js`, `public/js/main.js`, `public/js/state.js`, `public/js/renderAdminPanel.js`, `public/js/renderLibrary.js`, `public/styles.css` — UI.
- `scripts/demo-server.js` — unavailable mirror.
- `compose.yaml` — Postgres image → `pgvector/pgvector:pg18`.
- `docs/contract.md` — semantic surface.

**Vector serialization note:** the project uses plain `pg` with no pgvector npm helper, and adds NO new runtime dependency. Vectors are written/queried as the pgvector text literal `'[0.1,0.2,...]'` cast with `$n::vector`. Vectors are never read back into JS (we only need ranked refs), so no result parser is needed.

---

## Task 1 — Config, migrations, Compose image

**Files:**
- Modify: `server/config.js`
- Create: `server/migrations/0005_add_embeddings.sql`
- Create: `server/migrations/0006_add_app_settings.sql`
- Modify: `compose.yaml`
- Modify: `tests/backend/config.test.js` (or create if absent)

- [ ] **Step 1: Write a failing config test**

Find the existing config test. Run: `ls tests/backend/config.test.js 2>/dev/null || echo MISSING`.
If MISSING, create `tests/backend/config.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.js';

test('loadConfig exposes embedding defaults', () => {
  const c = loadConfig({});
  assert.equal(c.embeddingBackend, 'none');
  assert.equal(c.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(c.embeddingModel, '');
});

test('loadConfig reads embedding env overrides', () => {
  const c = loadConfig({ EMBEDDING_BACKEND: 'ollama', EMBEDDING_MODEL: 'nomic-embed-text', OLLAMA_URL: 'http://host:9999' });
  assert.equal(c.embeddingBackend, 'ollama');
  assert.equal(c.embeddingModel, 'nomic-embed-text');
  assert.equal(c.ollamaUrl, 'http://host:9999');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- tests/backend/config.test.js`
Expected: FAIL — `embeddingBackend` undefined.

- [ ] **Step 3: Extend `server/config.js`**

```javascript
export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || '',
    publicDir: env.PUBLIC_DIR || new URL('../public', import.meta.url).pathname,
    embeddingBackend: env.EMBEDDING_BACKEND || 'none',
    embeddingModel: env.EMBEDDING_MODEL || '',
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
  };
}
```

- [ ] **Step 4: Create migration `0005_add_embeddings.sql`**

```sql
create extension if not exists vector;

alter table markdown_documents
  add column if not exists embedding vector,
  add column if not exists embedding_backend text,
  add column if not exists embedding_model text,
  add column if not exists embedding_dim int,
  add column if not exists embedded_hash text,
  add column if not exists embedded_at timestamptz;
```

- [ ] **Step 5: Create migration `0006_add_app_settings.sql`**

```sql
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 6: Swap the Compose Postgres image**

In `compose.yaml`, change the `postgres` service `image:` from
`postgres:18-alpine` to `pgvector/pgvector:pg18`. Leave everything else
(env, ports, healthcheck, volume) unchanged — the pgvector image is built on
Postgres 18 and is on-disk compatible, so the existing volume is preserved.

- [ ] **Step 7: Run config tests + full suite**

Run: `npm test -- tests/backend/config.test.js` → PASS.
Run: `npm test` → full suite green (706 + new config tests).
Run: `npm run check` → PASS.

(The migrations are exercised in the Task 9 real-Postgres E2E.)

- [ ] **Step 8: Commit**

```bash
git add server/config.js server/migrations/0005_add_embeddings.sql \
        server/migrations/0006_add_app_settings.sql compose.yaml \
        tests/backend/config.test.js
git commit -m "Semantic search: config + migrations + pgvector image

Migration 0005 adds the dimensionless \`embedding\` vector column plus
backend/model/dim/hash/timestamp tracking; 0006 adds an app_settings
KV table. config.js gains embeddingBackend/embeddingModel/ollamaUrl
(defaults: none / '' / localhost:11434). Compose Postgres swaps to
pgvector/pgvector:pg18 (volume-compatible)."
```

---

## Task 2 — Embedder abstraction (`fake` + `ollama` + `createEmbedder`)

**Files:**
- Create: `server/embedder/fake.js`
- Create: `server/embedder/ollama.js`
- Create: `server/embedder/index.js`
- Create: `tests/backend/embedder.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/backend/embedder.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEmbedder } from '../../server/embedder/fake.js';
import { createOllamaEmbedder } from '../../server/embedder/ollama.js';
import { createEmbedder } from '../../server/embedder/index.js';

const ISOish = /^\d/;

test('fake embedder is deterministic and fixed-dimension', async () => {
  const e = createFakeEmbedder({ dim: 16 });
  const a = await e.embed('hello world');
  const b = await e.embed('hello world');
  const c = await e.embed('different');
  assert.equal(e.backend, 'fake');
  assert.equal(a.vector.length, 16);
  assert.equal(a.dim, 16);
  assert.deepEqual(a.vector, b.vector);          // same text -> same vector
  assert.notDeepEqual(a.vector, c.vector);       // different text -> different
});

test('fake embedder reports available', async () => {
  const e = createFakeEmbedder({ dim: 8 });
  assert.equal(await e.isAvailable(), true);
});

test('ollama embedder parses the embeddings response', async () => {
  const fakeFetch = async (url, opts) => {
    assert.match(url, /\/api\/embeddings$/);
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'nomic-embed-text');
    assert.equal(body.prompt, 'hi');
    return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
  };
  const e = createOllamaEmbedder({ url: 'http://x:11434', model: 'nomic-embed-text', fetch: fakeFetch });
  const out = await e.embed('hi');
  assert.equal(e.backend, 'ollama');
  assert.deepEqual(out.vector, [0.1, 0.2, 0.3]);
  assert.equal(out.model, 'nomic-embed-text');
  assert.equal(out.dim, 3);
});

test('ollama isAvailable maps reachability', async () => {
  const up = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => ({ ok: true }) });
  const down = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => { throw new Error('refused'); } });
  assert.equal(await up.isAvailable(), true);
  assert.equal(await down.isAvailable(), false);
});

test('createEmbedder resolves backends and null for none', () => {
  assert.equal(createEmbedder({ embeddingBackend: 'none' }), null);
  assert.equal(createEmbedder({ embeddingBackend: 'fake' }).backend, 'fake');
  assert.equal(createEmbedder({ embeddingBackend: 'ollama', ollamaUrl: 'http://x', embeddingModel: '' }).backend, 'ollama');
});

test('createEmbedder throws on unknown backend', () => {
  assert.throws(() => createEmbedder({ embeddingBackend: 'bogus' }), /unknown embedding backend/i);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/backend/embedder.test.js`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Create `server/embedder/fake.js`**

```javascript
import { createHash } from 'node:crypto';

// Deterministic, NON-semantic embedder for tests and offline dev.
// Maps text -> a fixed-dimension unit-ish vector seeded from sha-256(text),
// so identical text yields identical vectors (a doc is its own nearest
// neighbour) and the whole embed->store->rank pipeline is testable with no
// external service.
export function createFakeEmbedder({ dim = 64 } = {}) {
  return {
    backend: 'fake',
    async embed(text) {
      const vector = [];
      let i = 0;
      while (vector.length < dim) {
        const h = createHash('sha256').update(`${i}:${String(text ?? '')}`).digest();
        for (let b = 0; b < h.length && vector.length < dim; b += 1) {
          vector.push((h[b] / 255) * 2 - 1); // [-1, 1]
        }
        i += 1;
      }
      return { vector, model: `fake-${dim}`, dim };
    },
    async isAvailable() {
      return true;
    },
  };
}
```

- [ ] **Step 4: Create `server/embedder/ollama.js`**

```javascript
export function createOllamaEmbedder({ url, model, fetch = globalThis.fetch } = {}) {
  const base = String(url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const embedModel = model || 'nomic-embed-text';
  return {
    backend: 'ollama',
    async embed(text) {
      const res = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: embedModel, prompt: String(text ?? '') }),
      });
      if (!res.ok) throw new Error(`ollama embed failed: ${res.status}`);
      const data = await res.json();
      const vector = data.embedding;
      if (!Array.isArray(vector)) throw new Error('ollama returned no embedding array');
      return { vector, model: embedModel, dim: vector.length };
    },
    async isAvailable() {
      try {
        const res = await fetch(`${base}/api/tags`);
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 5: Create `server/embedder/index.js`**

```javascript
import { createFakeEmbedder } from './fake.js';
import { createOllamaEmbedder } from './ollama.js';

// Resolve the active embedder from config, or null when disabled.
// Adding openai/gemini/voyage (v0.13.1) = one import + one case here.
export function createEmbedder(config = {}) {
  const backend = config.embeddingBackend || 'none';
  switch (backend) {
    case 'none':
      return null;
    case 'fake':
      return createFakeEmbedder({ dim: config.embeddingDim || 64 });
    case 'ollama':
      return createOllamaEmbedder({ url: config.ollamaUrl, model: config.embeddingModel });
    default:
      throw new Error(`unknown embedding backend: ${backend}`);
  }
}
```

- [ ] **Step 6: Run tests green + full suite**

Run: `npm test -- tests/backend/embedder.test.js` → PASS (6 tests).
Run: `npm test` → green.

- [ ] **Step 7: Commit**

```bash
git add server/embedder/ tests/backend/embedder.test.js
git commit -m "Semantic search: embedder abstraction + ollama + fake adapters

createEmbedder(config) resolves the active backend (null when 'none').
The ollama adapter calls /api/embeddings; the fake adapter produces
deterministic sha-256-seeded vectors so the whole pipeline is testable
with no external service. Adding openai/gemini/voyage later is one
import + one switch case."
```

---

## Task 3 — Vector literal, app-settings repo, library repo embedding methods

**Files:**
- Create: `server/vectorLiteral.js`
- Create: `server/appSettingsRepository.js`
- Modify: `server/libraryRepository.js`
- Create: `tests/backend/vectorLiteral.test.js`
- Create: `tests/backend/appSettingsRepository.test.js`
- Create: `tests/backend/libraryRepository.embedding.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/backend/vectorLiteral.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { toVectorLiteral } from '../../server/vectorLiteral.js';

test('toVectorLiteral formats a pgvector literal', () => {
  assert.equal(toVectorLiteral([0.1, 0.2, -0.3]), '[0.1,0.2,-0.3]');
});

test('toVectorLiteral rejects non-arrays', () => {
  assert.throws(() => toVectorLiteral(null), /vector must be an array/);
  assert.throws(() => toVectorLiteral([1, 'x']), /vector must contain only finite numbers/);
});
```

Create `tests/backend/appSettingsRepository.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppSettingsRepository } from '../../server/appSettingsRepository.js';

test('getSetting returns the fallback when absent', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const repo = createAppSettingsRepository(db);
  assert.equal(await repo.getSetting('semantic_search_enabled', true), true);
});

test('getSetting returns the stored jsonb value', async () => {
  const db = { query: async () => ({ rows: [{ value: false }] }) };
  const repo = createAppSettingsRepository(db);
  assert.equal(await repo.getSetting('semantic_search_enabled', true), false);
});

test('putSetting upserts the value', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createAppSettingsRepository(db);
  await repo.putSetting('semantic_search_enabled', false);
  assert.match(captured.text, /insert into app_settings/i);
  assert.match(captured.text, /on conflict \(key\) do update/i);
  assert.equal(captured.values[0], 'semantic_search_enabled');
  assert.equal(captured.values[1], JSON.stringify(false));
});
```

Create `tests/backend/libraryRepository.embedding.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchDocumentsSemantic,
  buildListDocumentsNeedingEmbedding,
} from '../../server/libraryRepository.js';

test('buildSearchDocumentsSemantic orders by cosine distance and filters by backend', () => {
  const q = buildSearchDocumentsSemantic('[0.1,0.2]', 'ollama', { limit: 5 });
  assert.match(q.text, /embedding <=> \$1/);          // cosine distance order
  assert.match(q.text, /embedding is not null/);
  assert.match(q.text, /embedding_backend = \$2/);
  assert.match(q.text, /archived_at is null/);
  assert.match(q.text, /limit/i);
  assert.deepEqual(q.values.slice(0, 2), ['[0.1,0.2]', 'ollama']);
});

test('buildSearchDocumentsSemantic adds a project filter when given', () => {
  const q = buildSearchDocumentsSemantic('[0]', 'ollama', { projectId: 'p1', limit: 3 });
  assert.match(q.text, /project_id = \$3/);
  assert.ok(q.values.includes('p1'));
});

test('buildListDocumentsNeedingEmbedding selects null/stale/mismatched rows', () => {
  const q = buildListDocumentsNeedingEmbedding('ollama');
  assert.match(q.text, /embedding is null/);
  assert.match(q.text, /embedded_hash is distinct from content_hash/);
  assert.match(q.text, /embedding_backend is distinct from \$1/);
  assert.match(q.text, /archived_at is null/);
  assert.deepEqual(q.values, ['ollama']);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/backend/vectorLiteral.test.js tests/backend/appSettingsRepository.test.js tests/backend/libraryRepository.embedding.test.js`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Create `server/vectorLiteral.js`**

```javascript
export function toVectorLiteral(vector) {
  if (!Array.isArray(vector)) throw new Error('vector must be an array');
  for (const n of vector) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new Error('vector must contain only finite numbers');
    }
  }
  return `[${vector.join(',')}]`;
}
```

- [ ] **Step 4: Create `server/appSettingsRepository.js`**

```javascript
export function buildGetSetting(key) {
  return { text: 'select value from app_settings where key = $1', values: [key] };
}

export function buildPutSetting(key, value) {
  return {
    text: `
      insert into app_settings (key, value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `,
    values: [key, JSON.stringify(value)],
  };
}

export function createAppSettingsRepository(db) {
  return {
    async getSetting(key, fallback = null) {
      const q = buildGetSetting(key);
      const result = await db.query(q.text, q.values);
      if (result.rows.length === 0) return fallback;
      return result.rows[0].value;
    },
    async putSetting(key, value) {
      const q = buildPutSetting(key, value);
      await db.query(q.text, q.values);
      return value;
    },
  };
}
```

- [ ] **Step 5: Add embedding methods to `server/libraryRepository.js`**

Add these exported builders (near the other `build*` functions). Do NOT touch
`normalizeDocumentRow` — the vector must never appear in doc responses.

```javascript
export function buildSetDocumentEmbedding(id, { literal, backend, model, dim, contentHash }) {
  return {
    text: `
      update markdown_documents
      set embedding = $2::vector,
          embedding_backend = $3,
          embedding_model = $4,
          embedding_dim = $5,
          embedded_hash = $6,
          embedded_at = now()
      where id = $1
      returning id
    `,
    values: [id, literal, backend, model, dim, contentHash],
  };
}

export function buildSearchDocumentsSemantic(queryLiteral, backend, { projectId, limit = 20 } = {}) {
  const values = [queryLiteral, backend];
  let where = `where archived_at is null and embedding is not null and embedding_backend = $2`;
  if (projectId) {
    values.push(projectId);
    where += ` and project_id = $${values.length}`;
  }
  values.push(limit);
  return {
    text: `
      select id, title, document_type, project_id, tags, body, kind
      from markdown_documents
      ${where}
      order by embedding <=> $1::vector
      limit $${values.length}
    `,
    values,
  };
}

export function buildListDocumentsNeedingEmbedding(backend) {
  return {
    text: `
      select id, content_hash
      from markdown_documents
      where archived_at is null
        and (
          embedding is null
          or embedded_hash is distinct from content_hash
          or embedding_backend is distinct from $1
        )
      order by updated_at desc
    `,
    values: [backend],
  };
}

export function buildCountEmbeddings(backend) {
  return {
    text: `
      select
        count(*) filter (where archived_at is null) as total,
        count(*) filter (where archived_at is null and embedding is not null and embedding_backend = $1 and embedded_hash = content_hash) as embedded
      from markdown_documents
    `,
    values: [backend],
  };
}
```

Add matching repository methods inside `createLibraryRepository`:

```javascript
    async setDocumentEmbedding(id, payload) {
      const q = buildSetDocumentEmbedding(id, payload);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? result.rows[0].id : null;
    },
    async searchDocumentsSemantic(queryLiteral, backend, opts = {}) {
      const q = buildSearchDocumentsSemantic(queryLiteral, backend, opts);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeDocumentRow);
    },
    async listDocumentsNeedingEmbedding(backend) {
      const q = buildListDocumentsNeedingEmbedding(backend);
      const result = await db.query(q.text, q.values);
      return result.rows.map((r) => ({ id: r.id, contentHash: r.content_hash }));
    },
    async countEmbeddings(backend) {
      const q = buildCountEmbeddings(backend);
      const result = await db.query(q.text, q.values);
      const row = result.rows[0] || {};
      return { total: Number(row.total || 0), embedded: Number(row.embedded || 0) };
    },
```

Note: `searchDocumentsSemantic` selects the same columns `normalizeDocumentRow`
consumes (it reuses the normalizer) — the embedding column is deliberately
excluded from the SELECT, so no vector reaches JS.

- [ ] **Step 6: Run tests green + full suite**

Run the three new test files → PASS.
Run: `npm test` → green.

- [ ] **Step 7: Commit**

```bash
git add server/vectorLiteral.js server/appSettingsRepository.js \
        server/libraryRepository.js \
        tests/backend/vectorLiteral.test.js \
        tests/backend/appSettingsRepository.test.js \
        tests/backend/libraryRepository.embedding.test.js
git commit -m "Semantic search: vector literal, app-settings repo, embedding queries

toVectorLiteral serializes number[] to the pgvector text form. The
app_settings KV repo backs the runtime toggle. Library repo gains
setDocumentEmbedding, searchDocumentsSemantic (cosine <=> order, backend
filter, optional project), listDocumentsNeedingEmbedding (null/content-
stale/backend-mismatch), and countEmbeddings. normalizeDocumentRow is
untouched — the vector never rides in a doc response."
```

---

## Task 4 — Embedding service (embed + reindex)

**Files:**
- Create: `server/embeddingService.js`
- Create: `tests/backend/embeddingService.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/backend/embeddingService.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingService } from '../../server/embeddingService.js';
import { createFakeEmbedder } from '../../server/embedder/fake.js';

function fakeRepo(docs) {
  const stored = [];
  return {
    stored,
    async getDocument(id) { return docs.find((d) => d.id === id) || null; },
    async setDocumentEmbedding(id, payload) { stored.push({ id, ...payload }); return id; },
    async listDocumentsNeedingEmbedding() { return docs.map((d) => ({ id: d.id, contentHash: d.contentHash })); },
  };
}

test('embedDocument stores a vector literal with tracking fields', async () => {
  const docs = [{ id: 'a', body: 'hello', contentHash: 'h1' }];
  const repo = fakeRepo(docs);
  const svc = createEmbeddingService({ repository: repo, embedder: createFakeEmbedder({ dim: 8 }) });
  await svc.embedDocument('a');
  assert.equal(repo.stored.length, 1);
  const s = repo.stored[0];
  assert.equal(s.id, 'a');
  assert.match(s.literal, /^\[.*\]$/);
  assert.equal(s.backend, 'fake');
  assert.equal(s.dim, 8);
  assert.equal(s.contentHash, 'h1');
});

test('embedDocument is a no-op when no embedder', async () => {
  const repo = fakeRepo([{ id: 'a', body: 'x', contentHash: 'h' }]);
  const svc = createEmbeddingService({ repository: repo, embedder: null });
  await svc.embedDocument('a');
  assert.equal(repo.stored.length, 0);
});

test('reindex embeds all docs needing it and returns counts', async () => {
  const docs = [
    { id: 'a', body: 'one', contentHash: 'h1' },
    { id: 'b', body: 'two', contentHash: 'h2' },
  ];
  const repo = fakeRepo(docs);
  const svc = createEmbeddingService({ repository: repo, embedder: createFakeEmbedder({ dim: 8 }) });
  const result = await svc.reindex();
  assert.equal(result.embedded, 2);
  assert.equal(repo.stored.length, 2);
});

test('reindex is a no-op without an embedder', async () => {
  const repo = fakeRepo([{ id: 'a', body: 'x', contentHash: 'h' }]);
  const svc = createEmbeddingService({ repository: repo, embedder: null });
  const result = await svc.reindex();
  assert.equal(result.embedded, 0);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/backend/embeddingService.test.js`
Expected: FAIL.

- [ ] **Step 3: Create `server/embeddingService.js`**

```javascript
import { toVectorLiteral } from './vectorLiteral.js';

export function createEmbeddingService({ repository, embedder, concurrency = 4, logger = console }) {
  async function embedOne(id, knownContentHash) {
    if (!embedder) return false;
    const doc = await repository.getDocument(id);
    if (!doc) return false;
    const { vector, model, dim } = await embedder.embed(doc.body || '');
    await repository.setDocumentEmbedding(id, {
      literal: toVectorLiteral(vector),
      backend: embedder.backend,
      model,
      dim,
      contentHash: knownContentHash ?? doc.contentHash,
    });
    return true;
  }

  return {
    // Fire-and-forget friendly: callers await or not. Errors are swallowed +
    // logged so a write path never fails on an embedding error.
    async embedDocument(id) {
      try {
        return await embedOne(id);
      } catch (err) {
        logger.error('embedDocument failed', { id, err: String(err) });
        return false;
      }
    },
    async reindex() {
      if (!embedder) return { embedded: 0, failed: 0 };
      const pending = await repository.listDocumentsNeedingEmbedding(embedder.backend);
      let embedded = 0;
      let failed = 0;
      for (let i = 0; i < pending.length; i += concurrency) {
        const batch = pending.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          batch.map((d) => embedOne(d.id, d.contentHash)),
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) embedded += 1;
          else failed += 1;
        }
      }
      return { embedded, failed };
    },
  };
}
```

- [ ] **Step 4: Run tests green + full suite**

Run the new test file → PASS (4 tests). `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add server/embeddingService.js tests/backend/embeddingService.test.js
git commit -m "Semantic search: embedding service (embed + reindex)

embedDocument(id) computes + stores one doc's vector (errors logged,
never thrown — the write path can't fail on embedding). reindex()
batches the needs-embedding set through the active embedder with a
small concurrency cap and returns {embedded, failed}. Both no-op when
no embedder is configured."
```

---

## Task 5 — Routes: settings, semantic-search, reindex, on-write trigger

**Files:**
- Create: `server/settingsRoutes.js`
- Modify: `server/libraryRoutes.js`
- Modify: `server/index.js`
- Create: `tests/backend/semanticRoutes.test.js`

- [ ] **Step 1: Read the wiring points**

Run: `sed -n '1,60p' server/index.js` — see how repositories/routes are
constructed and registered, and how `buildApp(options)` accepts injected
repositories (the test harness uses `buildApp({ skipDb: true, ... })`).

- [ ] **Step 2: Write failing route tests**

Create `tests/backend/semanticRoutes.test.js`. Follow the `buildApp({ skipDb:
true, ... })` pattern used by `tests/backend/libraryRoutes.kind.test.js`. Inject
a fake library repository, a fake app-settings repository, and a fake embedding
service + embedder. Cover:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function fakes({ available = true, enabled = true } = {}) {
  return {
    library: {
      listDocuments: async () => [],
      getDocument: async () => null,
      createDocument: async (d) => ({ id: 'new', ...d }),
      updateDocument: async (id, f) => ({ id, ...f }),
      archiveDocument: async () => null,
      restoreDocument: async () => null,
      deleteArchivedDocument: async () => null,
      listActiveDocumentsForExport: async () => [],
      searchDocumentsSemantic: async () => [
        { id: 'd1', title: 'Restore', documentType: 'runbook', projectId: PROJECT_ID, tags: [], body: 'b', kind: 'source' },
      ],
      countEmbeddings: async () => ({ total: 3, embedded: 2 }),
    },
    appSettings: {
      _enabled: enabled,
      async getSetting(_k, fb) { return this._enabled ?? fb; },
      async putSetting(_k, v) { this._enabled = v; return v; },
    },
    embedder: available ? { backend: 'fake', async isAvailable() { return true; }, async embed() { return { vector: [0.1], model: 'fake', dim: 1 }; } } : null,
    embeddingService: { embedDocument: async () => true, reindex: async () => ({ embedded: 3, failed: 0 }) },
  };
}

async function makeApp(opts) {
  const f = fakes(opts);
  return buildApp({
    skipDb: true,
    libraryRepository: f.library,
    projectsRepository: { resolveProject: async () => ({ id: PROJECT_ID, slug: 'homelab' }) },
    documentLinksRepository: { listDocumentLinks: async () => [], linkDocuments: async () => ({ linked: true }), unlinkDocuments: async () => true, listStaleDocuments: async () => [], listOrphanDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: f.appSettings,
    embedder: f.embedder,
    embeddingService: f.embeddingService,
  });
}

test('GET /api/settings/semantic-search reports availability + counts', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'GET', url: '/api/settings/semantic-search' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.available, true);
  assert.equal(body.enabled, true);
  assert.equal(body.backend, 'fake');
  assert.equal(body.embeddedCount, 2);
  assert.equal(body.totalCount, 3);
  await app.close();
});

test('GET semantic settings shows unavailable when no embedder', async () => {
  const app = await makeApp({ available: false });
  const res = await app.inject({ method: 'GET', url: '/api/settings/semantic-search' });
  assert.equal(res.json().available, false);
  await app.close();
});

test('PUT /api/settings/semantic-search flips the toggle', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { enabled: false } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().enabled, false);
  await app.close();
});

test('semantic-search returns refs when enabled', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  assert.equal(res.statusCode, 200);
  const refs = res.json();
  assert.equal(refs[0].title, 'Restore');
  assert.ok('snippet' in refs[0]);   // ref shape, not full doc
  await app.close();
});

test('semantic-search 409s when disabled', async () => {
  const app = await makeApp({ available: true, enabled: false });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x' });
  assert.equal(res.statusCode, 409);
  await app.close();
});

test('semantic-search 409s when unavailable', async () => {
  const app = await makeApp({ available: false });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x' });
  assert.equal(res.statusCode, 409);
  await app.close();
});

test('reindex returns counts when available', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().embedded, 3);
  await app.close();
});
```

- [ ] **Step 3: Confirm failure**

Run: `npm test -- tests/backend/semanticRoutes.test.js`
Expected: FAIL — routes don't exist; `buildApp` doesn't accept the new injected deps.

- [ ] **Step 4: Create `server/settingsRoutes.js`**

```javascript
const SETTING_KEY = 'semantic_search_enabled';

export async function registerSettingsRoutes(app, options = {}) {
  const appSettings = options.appSettingsRepository || app.appSettingsRepository;
  const embedder = options.embedder ?? app.embedder ?? null;
  const library = options.libraryRepository || app.libraryRepository;

  async function semanticStatus() {
    const available = Boolean(embedder);
    const enabled = available ? Boolean(await appSettings.getSetting(SETTING_KEY, true)) : false;
    let connected = false;
    let counts = { total: 0, embedded: 0 };
    if (available) {
      connected = await embedder.isAvailable().catch(() => false);
      if (library.countEmbeddings) counts = await library.countEmbeddings(embedder.backend).catch(() => counts);
    }
    return {
      available,
      enabled,
      backend: available ? embedder.backend : null,
      connected,
      embeddedCount: counts.embedded,
      totalCount: counts.total,
    };
  }

  app.get('/api/settings/semantic-search', async () => semanticStatus());

  app.put('/api/settings/semantic-search', async (request, reply) => {
    if (!embedder) { reply.code(409); return { message: 'semantic search is not configured' }; }
    const enabled = Boolean(request.body && request.body.enabled);
    await appSettings.putSetting(SETTING_KEY, enabled);
    return semanticStatus();
  });

  // Expose for other routes to gate on.
  app.decorate('semanticEnabled', async () => {
    if (!embedder) return false;
    return Boolean(await appSettings.getSetting(SETTING_KEY, true));
  });
}
```

- [ ] **Step 5: Add semantic-search + reindex to `server/libraryRoutes.js`**

Extend `registerLibraryRoutes` to accept `options.embedder`,
`options.embeddingService`, `options.appSettingsRepository`. Add a local gate
helper and two routes. Use `toDocumentRef`-style ref shaping consistent with
how keyword search returns refs (id, title, documentType, projectId, tags,
snippet). Add a small `toRef` if the file doesn't already expose one; the
snippet is `body.slice(0, 200)`.

Add a top-level static import at the top of `server/libraryRoutes.js`:
`import { toVectorLiteral } from './vectorLiteral.js';` (alongside the existing
`libraryExport.js` import).

```javascript
// near the top of registerLibraryRoutes:
const embedder = options.embedder ?? app.embedder ?? null;
const embeddingService = options.embeddingService ?? app.embeddingService ?? null;
const appSettings = options.appSettingsRepository || app.appSettingsRepository;

async function semanticActive() {
  if (!embedder || !appSettings) return false;
  return Boolean(await appSettings.getSetting('semantic_search_enabled', true));
}

function toRef(doc) {
  return {
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    projectId: doc.projectId,
    tags: doc.tags || [],
    snippet: String(doc.body || '').slice(0, 200),
  };
}

app.get('/api/library/documents/semantic-search', async (request, reply) => {
  if (!(await semanticActive())) {
    reply.code(409);
    return { message: 'semantic search is not enabled' };
  }
  const q = request.query.q;
  if (!q || !String(q).trim()) { reply.code(400); return { message: 'q is required' }; }

  let projectId;
  if (request.query.project && request.query.project !== 'all') {
    projectId = await resolveProjectId(request.query.project);
    if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
  }

  const { vector } = await embedder.embed(String(q));
  const docs = await repository.searchDocumentsSemantic(toVectorLiteral(vector), embedder.backend, { projectId, limit: 20 });
  return docs.map(toRef);
});

app.post('/api/library/embeddings/reindex', async (request, reply) => {
  if (!embedder) { reply.code(409); return { message: 'semantic search is not configured' }; }
  if (!embeddingService) { reply.code(409); return { message: 'semantic search is not configured' }; }
  const result = await embeddingService.reindex();
  return result;
});
```

Then add the **on-write trigger**. In the existing POST handler, after the
`createDocument` result is obtained, fire-and-forget an embed if a service is
present:

```javascript
reply.code(201);
const created = await repository.createDocument({ ...cleanDocumentPayload(request.body), updatedBy: originFrom(request) });
if (embeddingService && embedder && await semanticActive()) {
  embeddingService.embedDocument(created.id);  // not awaited
}
return created;
```

And in the PATCH handler, after a successful `updateDocument` where `body` was
in the patch:

```javascript
const document = await repository.updateDocument(request.params.id, fields);
if (!document) { reply.code(404); return { message: 'document not found' }; }
if (Object.prototype.hasOwnProperty.call(request.body, 'body') && embeddingService && embedder && await semanticActive()) {
  embeddingService.embedDocument(document.id);  // not awaited
}
return document;
```

- [ ] **Step 6: Wire `server/index.js`**

In `buildApp(options)`:
- Construct the embedder: `const embedder = options.embedder ?? createEmbedder(config);` (import `createEmbedder`).
- Construct the app-settings repo: `const appSettingsRepository = options.appSettingsRepository || (app.db ? createAppSettingsRepository(app.db) : null);` (import it). For `skipDb` test mode it's injected.
- Construct the embedding service: `const embeddingService = options.embeddingService ?? (embedder && libraryRepository ? createEmbeddingService({ repository: libraryRepository, embedder }) : null);`
- Decorate the app: `app.decorate('embedder', embedder); app.decorate('appSettingsRepository', appSettingsRepository); app.decorate('embeddingService', embeddingService);`
- Pass them into `registerLibraryRoutes(app, { ..., embedder, embeddingService, appSettingsRepository })`.
- Register settings routes: `await registerSettingsRoutes(app, { appSettingsRepository, embedder, libraryRepository });` (import `registerSettingsRoutes`).

Read the existing `buildApp` to match exactly how repositories are currently
constructed and threaded, and follow that style.

- [ ] **Step 7: Run route tests green + full suite**

Run: `npm test -- tests/backend/semanticRoutes.test.js` → PASS (7 tests).
Run: `npm test` → green.
Run: `npm run check` → PASS (add `server/settingsRoutes.js` to the check
script if the project lists route files there — check `package.json`'s `check`;
if it enumerates files, append `&& node --check server/settingsRoutes.js`).

- [ ] **Step 8: Commit**

```bash
git add server/settingsRoutes.js server/libraryRoutes.js server/index.js \
        tests/backend/semanticRoutes.test.js package.json
git commit -m "Semantic search: settings, search, reindex routes + on-write embed

GET/PUT /api/settings/semantic-search expose availability+toggle+counts.
GET /api/library/documents/semantic-search embeds the query and ranks by
cosine distance (409 when unavailable/disabled). POST
/api/library/embeddings/reindex rebuilds the index. POST/PATCH document
writes fire a non-awaited embedDocument when the feature is active.
index.js wires the embedder, app-settings repo, and embedding service."
```

---

## Task 6 — MCP tool + client + contract lock

**Files:**
- Create: `mcp/tools/semanticSearch.js`
- Modify: `mcp/moomoraClient.js`
- Modify: `mcp/server.js`
- Modify: `tests/contract/mcpToolContract.test.js`
- Create: `tests/mcp/semanticSearch.test.js`

- [ ] **Step 1: Update the contract lock + write the tool test**

Edit `tests/contract/mcpToolContract.test.js`: add to `FROZEN_TOOLS`:

```javascript
  search_documents_semantic: { required: ['query'], optional: ['project'] },
```

…and add `createSemanticSearchTools` to the imports + the `allTools(client)`
aggregation.

Create `tests/mcp/semanticSearch.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticSearchTools } from '../../mcp/tools/semanticSearch.js';

test('search_documents_semantic requires query, optional project', () => {
  const tool = createSemanticSearchTools({}).find((t) => t.name === 'search_documents_semantic');
  assert.ok(tool);
  assert.equal(tool.inputSchema.query.safeParse(undefined).success, false);
  assert.equal(tool.inputSchema.project.safeParse(undefined).success, true);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('handler returns refs from the client', async () => {
  const client = { searchDocumentsSemantic: async () => [{ id: 'a', title: 't' }] };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const res = await tool.handler({ query: 'restore' });
  assert.match(res.content[0].text, /"title": ?"t"/);
});

test('handler surfaces the not-enabled message gracefully', async () => {
  const client = { searchDocumentsSemantic: async () => { const e = new Error('semantic search is not enabled'); e.status = 409; throw e; } };
  const tool = createSemanticSearchTools(client).find((t) => t.name === 'search_documents_semantic');
  const res = await tool.handler({ query: 'x' });
  assert.match(res.content[0].text, /not enabled/i);
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- tests/mcp/semanticSearch.test.js tests/contract/mcpToolContract.test.js`
Expected: FAIL.

- [ ] **Step 3: Create `mcp/tools/semanticSearch.js`**

Mirror `mcp/tools/graphMaintenance.js`'s structure. The handler must convert a
409 "not enabled" into a friendly text result (so the agent can fall back to
keyword search) rather than an error.

```javascript
import { z } from 'zod';
import { okResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

export function createSemanticSearchTools(client) {
  return [
    {
      name: 'search_documents_semantic',
      title: 'Semantic document search',
      description:
        'Search the library by meaning (embedding similarity), not keywords — finds topically-relevant docs even when they share no words with the query. Falls back with a clear message if semantic search is not enabled on the server (use search_documents instead).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().min(1).describe('Natural-language query matched by meaning.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
      },
      handler: withErrorHandling(async ({ query, project }) => {
        try {
          const refs = await client.searchDocumentsSemantic(query, project);
          return okResult(capResults(refs ?? []));
        } catch (err) {
          if (err && err.status === 409) {
            return okResult({ message: 'Semantic search is not enabled on this server. Use search_documents (keyword) instead.' });
          }
          throw err;
        }
      }),
    },
  ];
}
```

- [ ] **Step 4: Add the client method**

In `mcp/moomoraClient.js`, add near `listDocuments`:

```javascript
    searchDocumentsSemantic: (query, project) =>
      request('GET', '/api/library/documents/semantic-search', { query: { q: query, project } }),
```

(The existing `request` helper throws `MoomoraApiError` with `.status` on
non-2xx, so the tool's 409 branch works.)

- [ ] **Step 5: Register the tool in `mcp/server.js`**

Add `import { createSemanticSearchTools } from './tools/semanticSearch.js';`
and include `...createSemanticSearchTools(apiClient)` in the `tools` array.

- [ ] **Step 6: Run tests green + full suite**

Run the new + contract tests → PASS. `npm test` → green.

- [ ] **Step 7: Commit**

```bash
git add mcp/tools/semanticSearch.js mcp/moomoraClient.js mcp/server.js \
        tests/contract/mcpToolContract.test.js tests/mcp/semanticSearch.test.js
git commit -m "Semantic search: search_documents_semantic MCP tool

New read-only tool (query, project?) that ranks by embedding similarity.
On a 409 'not enabled' it returns a friendly fallback message rather than
an error so the agent can switch to keyword search_documents. Client
method + server registration + contract lock added."
```

---

## Task 7 — UI: Admin section + library search mode switch

**Files:**
- Modify: `public/js/libraryApi.js`, `public/js/state.js`, `public/js/main.js`, `public/js/renderAdminPanel.js`, `public/js/renderLibrary.js`, `public/styles.css`
- Create: `tests/frontend/renderAdminPanel.semantic.test.js`

- [ ] **Step 1: Write failing render tests**

Create `tests/frontend/renderAdminPanel.semantic.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminPanelHtml } from '../../public/js/renderAdminPanel.js';

test('semantic section shows unavailable status', () => {
  const html = renderAdminPanelHtml({ semanticStatus: { available: false } });
  assert.ok(html.includes('Semantic Search'));
  assert.ok(html.includes('unavailable'));
});

test('semantic section shows backend + counts + toggle + reindex when available', () => {
  const html = renderAdminPanelHtml({
    semanticStatus: { available: true, enabled: true, backend: 'ollama', connected: true, embeddedCount: 9, totalCount: 10 },
  });
  assert.ok(html.includes('ollama'));
  assert.ok(html.includes('9'));
  assert.ok(html.includes('10'));
  assert.ok(html.match(/data-action="toggle-semantic-search"/));
  assert.ok(html.match(/data-action="reindex-embeddings"/));
});
```

- [ ] **Step 2: Confirm failure → implement the Admin section**

Run the test → FAIL. Then edit `renderAdminPanelHtml` to accept
`semanticStatus = { available: false }` and render a "Semantic Search" admin
section: when `available === false`, a status line "unavailable (no backend
configured)"; when available, a status line showing backend, connected state,
and `embeddedCount/totalCount`, a toggle button `data-action="toggle-semantic-search"`
reflecting `enabled`, and a `data-action="reindex-embeddings"` button. Reuse
the existing `.admin-section` / `.admin-help` styles.

- [ ] **Step 3: Library API client methods**

In `public/js/libraryApi.js` add:

```javascript
export async function fetchSemanticStatus() {
  const res = await fetch('/api/settings/semantic-search');
  if (!res.ok) throw new Error('Failed to load semantic search status');
  return res.json();
}

export async function setSemanticEnabled(enabled) {
  const res = await fetch('/api/settings/semantic-search', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to update semantic search');
  return res.json();
}

export async function reindexEmbeddings() {
  const res = await fetch('/api/library/embeddings/reindex', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reindex');
  return res.json();
}

export async function semanticSearch(query, project) {
  const params = new URLSearchParams({ q: query });
  if (project && project !== 'all') params.set('project', project);
  const res = await fetch(`/api/library/documents/semantic-search?${params.toString()}`);
  if (!res.ok) throw new Error('Semantic search failed');
  return res.json();
}
```

- [ ] **Step 4: State + main.js wiring**

- `state.js`: add `semanticStatus: { available: false }` and
  `librarySearchMode: 'keyword'` to defaults.
- `main.js`:
  - On admin-panel open, also `fetchSemanticStatus()` → `setState({ semanticStatus })` → re-render admin. Pass `semanticStatus: state.semanticStatus` into the `renderAdminPanelHtml` options.
  - Handler for `[data-action="toggle-semantic-search"]`: `setSemanticEnabled(!state.semanticStatus.enabled)` → update state → re-render.
  - Handler for `[data-action="reindex-embeddings"]`: call `reindexEmbeddings()`, then refresh status, show the returned count (reuse whatever notification/inline-status pattern admin uses; if none, update the status line text).
  - On app init (or first library view), `fetchSemanticStatus()` so the library search switch knows whether to show.
  - Library search mode switch (only when `state.semanticStatus.available && state.semanticStatus.enabled`): a small control in the library search area toggling `state.librarySearchMode` between `keyword` and `semantic`. When `semantic`, the search action calls `semanticSearch(query, state.activeProject)` and renders the returned refs as the document list (read-only result view — clicking a result opens it via the existing open-library-doc flow). When `keyword`, behavior is unchanged.

  Keep the semantic results rendering minimal: reuse the existing document-list
  row renderer with the returned refs (they carry id/title/type/tags). If the
  refs lack fields the row renderer needs, map them to the shape it expects.

- [ ] **Step 5: Styles**

Add minimal styles for the search-mode switch + the semantic admin status line
in `public/styles.css`, reusing existing tokens (`--accent`, `--text-dim`,
`--border`). No new color semantics.

- [ ] **Step 6: Run tests + manual smoke**

Run: `npm test` → green (the new admin render test + everything else).
Manual smoke (demo, feature unavailable): `npm run demo`, open Admin → confirm
"Semantic Search: unavailable". Confirm the library has no semantic switch.
Stop demo.

- [ ] **Step 7: Commit**

```bash
git add public/js/libraryApi.js public/js/state.js public/js/main.js \
        public/js/renderAdminPanel.js public/js/renderLibrary.js public/styles.css \
        tests/frontend/renderAdminPanel.semantic.test.js
git commit -m "Semantic search UI: admin status/toggle/reindex + library mode switch

Admin gains a Semantic Search section (read-only status: backend,
connected, embedded/total; on-off toggle; reindex button). The library
search control gains a keyword/semantic mode switch when the feature is
available + enabled; semantic mode queries the new endpoint and lists the
ranked refs. All config stays read-only in the UI per the no-auth model."
```

---

## Task 8 — Demo server mirror (unavailable)

**Files:**
- Modify: `scripts/demo-server.js`

- [ ] **Step 1: Make the demo report unavailable**

The demo uses `buildApp({ skipDb: true, ... })`. To keep semantic search cleanly
"unavailable" without pgvector:
- Pass `embedder: null`, `embeddingService: null`, and an in-memory
  `appSettingsRepository` stub to `buildApp` (so the settings route resolves
  and returns `available: false`).
- Add the in-memory app-settings stub:

```javascript
function createMemoryAppSettingsRepository() {
  const store = new Map();
  return {
    async getSetting(key, fallback = null) { return store.has(key) ? store.get(key) : fallback; },
    async putSetting(key, value) { store.set(key, value); return value; },
  };
}
```

- In the `buildApp({ ... })` call, add:
  `appSettingsRepository: createMemoryAppSettingsRepository(), embedder: null, embeddingService: null,`

With `embedder: null`, `GET /api/settings/semantic-search` returns
`available: false`, the semantic-search + reindex routes 409, and the on-write
trigger is skipped — exactly the intended demo behavior.

- [ ] **Step 2: Smoke**

Run: `npm run demo &` ; `sleep 3`
Run: `curl -s http://127.0.0.1:3100/api/settings/semantic-search`
Expected: `{"available":false,...}`.
Run: `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3100/api/library/documents/semantic-search?q=x'`
Expected: `409`.
Stop the demo.

- [ ] **Step 3: Commit**

```bash
git add scripts/demo-server.js
git commit -m "Semantic search: demo server reports the feature unavailable

The in-memory demo has no pgvector, so it wires embedder: null + an
in-memory app-settings stub into buildApp. Settings report available:
false; semantic-search and reindex 409; on-write embedding is skipped."
```

---

## Task 9 — Contract docs + real-Postgres E2E + final review + PR

- [ ] **Step 1: Update `docs/contract.md`**

In the MCP tools table add:

```markdown
| `search_documents_semantic` | `query`, `project?` | yes |
```

Add a short "Semantic search" prose paragraph: Postgres-only (requires pgvector
+ a configured `EMBEDDING_BACKEND`), retrieval-only, config-gated +
runtime-toggleable, returns the same ref shape as keyword search; the
`/api/library/documents/semantic-search`, `/api/library/embeddings/reindex`,
and `/api/settings/semantic-search` routes are HTTP-only.

Commit:

```bash
git add docs/contract.md
git commit -m "docs: document the semantic search surface"
```

- [ ] **Step 2: Full local suite**

Run: `npm test` → green.
Run: `npm run check` → PASS.
Run: `npm run test:e2e` → 10 passed (the harness runs against the demo, where
semantic search is unavailable; if you added an e2e assertion for the
unavailable admin state, count rises accordingly — optional).

- [ ] **Step 3: Real-Postgres E2E with the `fake` backend**

```bash
docker compose down -v
docker compose up -d --build
sleep 10
# confirm pgvector + migrations
docker compose exec -T postgres psql -U moomora -d moomora_console -c "select extname from pg_extension where extname='vector'"
docker compose exec -T postgres psql -U moomora -d moomora_console -c "select version from schema_migrations order by version"
```

Expected: `vector` present; migrations include `0005_add_embeddings.sql` and
`0006_add_app_settings.sql`.

Now restart the app with the fake backend so embeddings actually compute:

```bash
docker compose stop app
# run the app with EMBEDDING_BACKEND=fake against the same DB
docker compose run --rm -e EMBEDDING_BACKEND=fake -e PORT=3000 -p 3100:3000 app &
sleep 6
```

(If `docker compose run` port mapping is awkward, alternatively add
`EMBEDDING_BACKEND: fake` to the app service env in `compose.yaml` temporarily
for this smoke, then revert — do NOT commit that.)

Seed + reindex + search:

```bash
PROJECT_ID=$(docker compose exec -T postgres psql -U moomora -d moomora_console -t -A -c "select id from projects where slug='homelab'")
curl -s -X POST 'http://127.0.0.1:3100/api/library/documents' -H 'content-type: application/json' \
  -d "{\"title\":\"Alpha\",\"body\":\"postgres restore disaster recovery\",\"documentType\":\"runbook\",\"project\":\"$PROJECT_ID\"}" > /dev/null
curl -s -X POST 'http://127.0.0.1:3100/api/library/documents' -H 'content-type: application/json' \
  -d "{\"title\":\"Beta\",\"body\":\"unrelated meeting notes about widgets\",\"documentType\":\"note\",\"project\":\"$PROJECT_ID\"}" > /dev/null

curl -s -X POST 'http://127.0.0.1:3100/api/library/embeddings/reindex'
echo
curl -s 'http://127.0.0.1:3100/api/settings/semantic-search'
echo
# exact-text query should rank Alpha first (fake = a doc is its own nearest neighbour)
curl -s 'http://127.0.0.1:3100/api/library/documents/semantic-search?q=postgres%20restore%20disaster%20recovery' \
  | python3 -c 'import json,sys; print([d["title"] for d in json.load(sys.stdin)])'
```

Expected: reindex returns `{"embedded":2,...}` (plus any pre-seeded docs); the
status shows `available:true, backend:"fake"`; the search lists `Alpha` first.

Toggle off + confirm 409:

```bash
curl -s -X PUT 'http://127.0.0.1:3100/api/settings/semantic-search' -H 'content-type: application/json' -d '{"enabled":false}'
echo
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3100/api/library/documents/semantic-search?q=x'  # 409
```

Tear down: `docker compose down -v`. Revert any temporary `compose.yaml` env edit.

- [ ] **Step 4: Dispatch a final Opus reviewer subagent**

Per `subagent-model-routing.md`: Opus reviewer over the whole branch. Spec
compliance (every spec section) + code quality. Confirm the vector never leaks
into doc responses, the feature is fully no-op when `EMBEDDING_BACKEND=none`,
and the real-Postgres smoke evidence is sound. Address Important findings before
the PR.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feature/semantic-search
gh pr create --title "Semantic search (pgvector) — Ollama + fake backends" --body "$(cat <<'EOF'
## Summary

Adds pgvector-backed semantic (embedding) search over the library — paraphrased queries find topically-relevant docs. Retrieval-only; no generation, staying true to the no-embedded-LLM-generation principle.

- **Infra:** Compose Postgres → `pgvector/pgvector:pg18` (volume-compatible). Migration 0005 adds a dimensionless `embedding vector` column + backend/model/dim/hash/timestamp tracking; 0006 adds an `app_settings` KV table. Index-free brute-force cosine — correct at single-user scale, and it sidesteps the multi-backend dimension problem.
- **Embedder abstraction:** `server/embedder/` resolves the active backend from env. Ships the **Ollama** adapter + a deterministic **`fake`** test adapter; OpenAI / Gemini / Voyage follow in v0.13.1 behind the same interface. (Anthropic has no embeddings API — the "Claude" backend is Voyage.)
- **Pipeline:** on-write async embedding (non-awaited; the write path never fails on an embedding error) + a manual reindex endpoint/button that repairs after edits or a backend switch.
- **Surface:** `GET /api/library/documents/semantic-search` (cosine-ranked refs), `POST /api/library/embeddings/reindex`, `GET/PUT /api/settings/semantic-search`, and a `search_documents_semantic` MCP tool that falls back gracefully when disabled.
- **Control:** config-gated (`EMBEDDING_BACKEND=none` default → feature absent) + a server-side runtime toggle (`app_settings`) consistent across UI + MCP. All secrets/config are env-only (no-auth model); the UI shows read-only status + the toggle.
- **Demo:** reports the feature unavailable (no pgvector).

## Test plan

- [x] `npm test` green (unit: embedder, fake, vector literal, app-settings, embedding queries, embedding service, routes, MCP tool, admin render)
- [x] `npm run check` green
- [x] `npm run test:e2e` green
- [x] Real-Postgres smoke with `EMBEDDING_BACKEND=fake`: pgvector + migrations applied; reindex embeds; exact-text query ranks the matching doc first; toggle-off returns 409
- [x] `EMBEDDING_BACKEND=none` → feature fully absent (settings report unavailable, routes 409, no embedding on write)

Spec: `docs/superpowers/specs/2026-06-03-semantic-search-design.md`. OpenAI/Gemini/Voyage adapters are the v0.13.1 follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Release (post-merge)

Cuts as **v0.13.0** (minor). Ritual: branch `release-v0.13.0`, `npm version
0.13.0`, update `compose.image.yaml` + README image tag to `v0.13.0`, roll
CHANGELOG with an `### Added` entry (pgvector semantic search, Ollama + fake
backends, config-gated + runtime toggle; note the Postgres image change and the
v0.13.1 adapter follow-up), add the compare link, PR, merge, tag `v0.13.0`,
watch the release workflow.

**Heads-up for the release:** the `release.yml`-built application image must run
against a pgvector-capable Postgres. The Compose `compose.yaml` change covers
local/published-image testing; the Kubernetes manifests need a pgvector-capable
Postgres image too (documentation note in this release; manifest change can be a
follow-up).
