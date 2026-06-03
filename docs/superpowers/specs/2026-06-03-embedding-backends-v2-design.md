# Embedding Backends v2 — OpenAI-compatible adapter + query prefix (v0.14.0)

**Goal:** Add an **OpenAI-compatible** embedding backend (configurable base URL + optional key) and
a general, model-agnostic **query-instruction prefix** applied to search queries only.

**Why this scope:** A single OpenAI-compatible adapter (with a base URL) covers real OpenAI, the
user's llama.cpp homelab (`/v1/embeddings`), and any other OpenAI-compatible server (vLLM, LiteLLM,
…). Gemini and Voyage have distinct APIs and remain deferred until needed. The query prefix lets
instruct-tuned models (e.g. `qwen3-embedding`) reach peak retrieval quality.

**Tech:** plain `fetch`, no new dependency. Behind the existing `EmbedderBackend` interface, so the
embedding service, routes, MCP tool, UI, and runtime toggle all work unchanged.

---

## Piece 1 — OpenAI-compatible embedder

`server/embedder/openai.js`: `createOpenAiEmbedder({ baseUrl, apiKey, model, fetch })` returning
`{ backend: 'openai', async embed(text), async isAvailable() }`.

- **`embed(text)`** — `POST ${base}/embeddings` with `{ model, input: String(text ?? '') }` and
  `content-type: application/json`. Add `Authorization: Bearer ${apiKey}` **only when `apiKey` is
  non-empty** (so it works against keyless local servers like llama.cpp). Throw
  `openai embed failed: ${status}` on `!res.ok`. Parse `{ data: [{ embedding }] }`; throw
  `openai returned no embedding array` if `data[0].embedding` isn't an array. Return
  `{ vector, model, dim: vector.length }`.
- **`isAvailable()`** — `GET ${base}/models` (with the same optional auth header); return
  `res.ok`; catch → `false`. (llama.cpp and OpenAI both serve `/v1/models`.)
- `base` = `String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')` — the base **includes
  `/v1`**, so the path is `${base}/embeddings`.

**Config** (`server/config.js`, all env-only — never UI-writable, same security model as v0.13.0):
- `openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1'`
- `openaiApiKey: env.OPENAI_API_KEY || ''`
- (reuses `EMBEDDING_MODEL`)

**`createEmbedder`** (`server/embedder/index.js`): add
`case 'openai': return createOpenAiEmbedder({ baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey, model: config.embeddingModel });`

## Piece 2 — General query-instruction prefix

`EMBEDDING_QUERY_PREFIX` (env, default `''`): a literal string prepended to **search-query**
embeddings only — never to document embeddings.

- **Config:** `embeddingQueryPrefix: env.EMBEDDING_QUERY_PREFIX || ''`.
- **Interface:** `embed(text, opts = {})`; the only consumer of `opts` is the prefix wrapper, which
  prepends the prefix when `opts.query === true`. Base adapters keep `embed(text)` (extra arg
  ignored) — backward compatible.
- **Wrapper in `createEmbedder`:** after resolving the base embedder (and for `none` → still null),
  wrap it so `embed(text, { query })` calls `base.embed(query && prefix ? prefix + text : text)`.
  When `prefix` is empty the base embedder is returned unwrapped (pure pass-through).
- **Call sites:**
  - Search route (`server/libraryRoutes.js`): `embedder.embed(String(q), { query: true })`.
  - Embedding service (`server/embeddingService.js`, `embedOne`): unchanged —
    `embedder.embed(doc.body || '')` (document path, no prefix).
- **Examples:** qwen3 →
  `EMBEDDING_QUERY_PREFIX="Instruct: Given a search query, retrieve relevant documents\nQuery:"`;
  nomic → `"search_query: "`; default empty → today's behavior.
- **Property:** changing the query prefix does **not** invalidate stored embeddings (documents are
  always embedded raw), so no reindex is needed on a prefix change. Only switching *backend*
  invalidates — already handled by the `embedding_backend` filter + reindex.

## Security

- `OPENAI_API_KEY` is env-only; the settings status response exposes only the backend *name*
  (`'openai'`), never the key/base URL — confirmed no leak path. The no-auth UI never reads or
  writes any backend config.

## Testing

- **Unit** (`tests/backend/embedder.test.js` or a sibling): OpenAI adapter happy path (mock `fetch`
  → `{data:[{embedding:[…]}]}`), non-ok status throws, malformed response throws, **keyless →
  no `Authorization` header sent**, with-key → header sent, `isAvailable` ok/throw.
- **Query-prefix wrapper:** `embed(q,{query:true})` prepends the prefix; `embed(doc)` (document)
  does not; empty prefix → pass-through (and the base is returned unwrapped).
- **Config:** new env defaults + overrides.
- **`createEmbedder`:** resolves `openai`; unknown still throws; `none` still null.
- Existing suite stays green (no behavior change when `EMBEDDING_QUERY_PREFIX` unset and backend ≠ openai).

## Rollout

- Docs: `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `EMBEDDING_QUERY_PREFIX` in README (env table) and a
  note in `docs/contract.md` (the embedding-backend list). No migration.
- Ship as **v0.14.0** (new backend = minor bump). Verify against a live OpenAI-compatible endpoint
  if available (the user's llama.cpp with `--embeddings`, or real OpenAI), else a mocked-fetch unit
  pass + the `fake`-backend end-to-end smoke already covered.
