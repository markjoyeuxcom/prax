# Embedding Backends v2 Implementation Plan (v0.14.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenAI-compatible embedding backend (configurable base URL + optional key) and a
general `EMBEDDING_QUERY_PREFIX` applied to search-query embeddings only.

**Architecture:** New `server/embedder/openai.js` behind the existing `EmbedderBackend` interface;
`createEmbedder` gains an `openai` case and wraps the resolved embedder to prepend the query prefix
for `embed(text, { query: true })`. The search route opts in; the embedding service does not.

**Tech Stack:** plain `fetch`, no new dependency. Branch: `feature/embedding-backends-v2` (created).
Spec: `docs/superpowers/specs/2026-06-03-embedding-backends-v2-design.md`.

---

## Task 1 — OpenAI-compatible adapter + query-prefix wrapper + config + wiring

**Files:**
- Create: `server/embedder/openai.js`
- Modify: `server/config.js`, `server/embedder/index.js`, `server/libraryRoutes.js`
- Test: `tests/backend/config.test.js`, `tests/backend/embedder.test.js`

- [ ] **Step 1: Config — new env (all env-only)**

In `server/config.js` add to the returned object:

```javascript
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiApiKey: env.OPENAI_API_KEY || '',
    embeddingQueryPrefix: env.EMBEDDING_QUERY_PREFIX || '',
```

- [ ] **Step 2: Config tests**

In `tests/backend/config.test.js` add:

```javascript
test('openai + query-prefix config defaults and overrides', () => {
  const d = loadConfig({});
  assert.equal(d.openaiBaseUrl, 'https://api.openai.com/v1');
  assert.equal(d.openaiApiKey, '');
  assert.equal(d.embeddingQueryPrefix, '');
  const o = loadConfig({ OPENAI_BASE_URL: 'http://x/v1', OPENAI_API_KEY: 'sk-1', EMBEDDING_QUERY_PREFIX: 'search_query: ' });
  assert.equal(o.openaiBaseUrl, 'http://x/v1');
  assert.equal(o.openaiApiKey, 'sk-1');
  assert.equal(o.embeddingQueryPrefix, 'search_query: ');
});
```

- [ ] **Step 3: Create `server/embedder/openai.js`**

```javascript
// OpenAI-compatible embeddings (real OpenAI, llama.cpp, vLLM, LiteLLM, …).
// baseUrl includes /v1; the Authorization header is omitted when apiKey is empty
// so keyless local servers work. Mirrors the ollama adapter's shape + errors.
export function createOpenAiEmbedder({ baseUrl, apiKey, model, fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const embedModel = model || 'text-embedding-3-small';
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  return {
    backend: 'openai',
    async embed(text) {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ model: embedModel, input: String(text ?? '') }),
      });
      if (!res.ok) throw new Error(`openai embed failed: ${res.status}`);
      const data = await res.json();
      const vector = data && Array.isArray(data.data) ? data.data[0]?.embedding : undefined;
      if (!Array.isArray(vector)) throw new Error('openai returned no embedding array');
      return { vector, model: embedModel, dim: vector.length };
    },
    async isAvailable() {
      try {
        const res = await fetch(`${base}/models`, { headers: headers() });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 4: `createEmbedder` — openai case + query-prefix wrapper**

Rewrite `server/embedder/index.js`:

```javascript
import { createFakeEmbedder } from './fake.js';
import { createOllamaEmbedder } from './ollama.js';
import { createOpenAiEmbedder } from './openai.js';

// Prepend a query instruction to SEARCH-query embeddings only (opts.query), never
// to document embeddings. Pass-through when no prefix is configured. Model-agnostic:
// e.g. qwen3 "Instruct: …\nQuery:", nomic "search_query: ".
function withQueryPrefix(embedder, prefix) {
  if (!embedder || !prefix) return embedder;
  return {
    ...embedder,
    async embed(text, opts = {}) {
      const input = opts.query ? `${prefix}${text}` : text;
      return embedder.embed(input);
    },
  };
}

function resolveBackend(config) {
  const backend = config.embeddingBackend || 'none';
  switch (backend) {
    case 'none':
      return null;
    case 'fake':
      return createFakeEmbedder({ dim: 64 });
    case 'ollama':
      return createOllamaEmbedder({ url: config.ollamaUrl, model: config.embeddingModel });
    case 'openai':
      return createOpenAiEmbedder({ baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey, model: config.embeddingModel });
    default:
      throw new Error(`unknown embedding backend: ${backend}`);
  }
}

// Resolve the active embedder from config, or null when disabled.
export function createEmbedder(config = {}) {
  return withQueryPrefix(resolveBackend(config), config.embeddingQueryPrefix || '');
}
```

- [ ] **Step 5: Search route opts-in to the query prefix**

In `server/libraryRoutes.js`, the semantic-search handler currently does
`const { vector } = await embedder.embed(String(q));`. Change to:

```javascript
      const { vector } = await embedder.embed(String(q), { query: true });
```

(Leave the surrounding 503 try/catch intact. The embedding service's
`embedder.embed(doc.body || '')` stays unchanged — documents are embedded raw.)

- [ ] **Step 6: Embedder unit tests**

In `tests/backend/embedder.test.js` add (mock `fetch`; mirror the existing ollama tests):

```javascript
import { createOpenAiEmbedder } from '../../server/embedder/openai.js';
import { createEmbedder } from '../../server/embedder/index.js';

function fakeFetch(handler) { return async (url, init) => handler(url, init); }

test('openai embed posts input and returns the vector', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { data: [{ embedding: [0.1, 0.2, 0.3] }] }; } }; });
  const e = createOpenAiEmbedder({ baseUrl: 'http://x/v1', apiKey: 'sk-1', model: 'm', fetch });
  const out = await e.embed('hello');
  assert.deepEqual(out.vector, [0.1, 0.2, 0.3]);
  assert.equal(out.dim, 3);
  assert.equal(out.model, 'm');
  assert.match(seen.url, /\/v1\/embeddings$/);
  assert.equal(seen.init.headers.authorization, 'Bearer sk-1');
  assert.match(seen.init.body, /"input":"hello"/);
});

test('openai omits the Authorization header when keyless', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = init; return { ok: true, async json() { return { data: [{ embedding: [0] }] }; } }; });
  const e = createOpenAiEmbedder({ baseUrl: 'http://local/v1', apiKey: '', model: 'm', fetch });
  await e.embed('x');
  assert.equal('authorization' in seen.headers, false);
});

test('openai throws on non-ok and on malformed response', async () => {
  const bad = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => ({ ok: false, status: 500 })) });
  await assert.rejects(bad.embed('x'), /openai embed failed: 500/);
  const malformed = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => ({ ok: true, async json() { return { data: [] }; } })) });
  await assert.rejects(malformed.embed('x'), /no embedding array/);
});

test('openai isAvailable hits /models', async () => {
  const up = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch((url) => ({ ok: /\/v1\/models$/.test(url) })) });
  assert.equal(await up.isAvailable(), true);
  const down = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => { throw new Error('down'); }) });
  assert.equal(await down.isAvailable(), false);
});

test('createEmbedder resolves openai', () => {
  const e = createEmbedder({ embeddingBackend: 'openai', openaiBaseUrl: 'http://x/v1', embeddingModel: 'm' });
  assert.equal(e.backend, 'openai');
});

test('query prefix is applied to query embeddings only', async () => {
  // The deterministic `fake` backend embeds its input, so a prefixed query
  // yields a different vector than the raw document path — proving the prefix
  // hits queries (opts.query) but not documents.
  const e = createEmbedder({ embeddingBackend: 'fake', embeddingQueryPrefix: 'Q: ' });
  const q = await e.embed('cat', { query: true });
  const d = await e.embed('cat');
  assert.notDeepEqual(q.vector, d.vector);
});

test('no prefix → createEmbedder returns the base embedder unwrapped', () => {
  const e = createEmbedder({ embeddingBackend: 'fake' });
  assert.equal(e.backend, 'fake');
});
```

- [ ] **Step 7: Run + commit**

`npm test` → green. `npm run check` → PASS.

```bash
git add server/embedder/openai.js server/embedder/index.js server/config.js server/libraryRoutes.js \
        tests/backend/config.test.js tests/backend/embedder.test.js
git commit -m "Embedding: OpenAI-compatible backend + query-instruction prefix

New 'openai' backend (OPENAI_BASE_URL incl. /v1 + optional OPENAI_API_KEY;
Authorization omitted when keyless) covers real OpenAI, llama.cpp, vLLM,
LiteLLM, etc. EMBEDDING_QUERY_PREFIX is prepended to SEARCH-query
embeddings only (model-agnostic; e.g. qwen3 Instruct/Query, nomic
search_query:) via a pass-through wrapper in createEmbedder; document
embeddings stay raw, so a prefix change needs no reindex. Keys are
env-only and never leave the server."
```

---

## Task 2 — Docs + verify + final review + PR + release

**Files:** Modify `README.md`, `docs/contract.md`.

- [ ] **Step 1: README env documentation**

Add `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `EMBEDDING_QUERY_PREFIX` to the README's environment/Run
section near the existing `EMBEDDING_BACKEND` docs (if absent, add a short "Semantic search
configuration" note listing `EMBEDDING_BACKEND` (`none`/`fake`/`ollama`/`openai`), `EMBEDDING_MODEL`,
`OLLAMA_URL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `EMBEDDING_QUERY_PREFIX`, and the existing
`EMBEDDING_SEARCH_*` thresholds — all env-only).

- [ ] **Step 2: contract.md note**

In the "Semantic search" paragraph, update the backend list to include `openai` (OpenAI-compatible:
real OpenAI, llama.cpp, vLLM, LiteLLM, via `OPENAI_BASE_URL`/`OPENAI_API_KEY`) and note
`EMBEDDING_QUERY_PREFIX` is applied to queries only.

- [ ] **Step 3: Verify**

`npm test` green, `npm run check` PASS, `npm run test:e2e` green. If a live OpenAI-compatible
endpoint is available (the user's llama.cpp with `--embeddings`, or real OpenAI), smoke the full
pipeline (`EMBEDDING_BACKEND=openai`, `OPENAI_BASE_URL=…`, set `EMBEDDING_QUERY_PREFIX` for qwen3);
otherwise the mocked-fetch unit pass + the prior `fake` end-to-end smoke cover it.

- [ ] **Step 4: Commit, final review, PR**

```bash
git add README.md docs/contract.md
git commit -m "docs: document the openai embedding backend + query prefix env vars"
```

Dispatch a final reviewer (spec compliance + the no-key-leak invariant + the query/document
asymmetry). Push and open a PR titled `Embedding backends v2: OpenAI-compatible + query prefix (v0.14.0)`.

- [ ] **Step 5: Release v0.14.0 (post-merge)**

Branch `release-v0.14.0`, `npm version 0.14.0 --no-git-tag-version`, bump `compose.image.yaml` +
README image tag to `v0.14.0`, roll CHANGELOG `### Added` (openai backend + query prefix) + compare
link, PR, merge, tag `v0.14.0`, watch the release workflow.
