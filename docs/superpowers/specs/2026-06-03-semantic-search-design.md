# Semantic search (embeddings) design

**Status:** Approved
**Date:** 2026-06-03
**Target release:** v0.13.0
**Follow-up:** v0.13.1 — OpenAI / Gemini / Voyage embedder adapters behind the same interface

## Goal

Add semantic (embedding-based) search over the library so paraphrased queries
work — "how do I get back online after a DB crash?" finds the Postgres restore
runbook even when none of those words appear in it. This is a **retrieval**
feature, not generation: Moomora computes and stores embeddings and ranks by
vector similarity. It does NOT generate prose, so it stays true to the
project's "no embedded LLM generation" principle (embedding-for-search is a
better index, not an AI writing feature).

## Decisions locked in

- **Pipeline-first scope (Option B).** v0.13.0 builds the *entire* pipeline —
  pgvector infra, async embedding, reindex, semantic search query, HTTP route,
  MCP tool, settings toggle — behind a clean `EmbedderBackend` interface, but
  ships only the **Ollama** adapter (local, free, no API key, easiest to test)
  plus a deterministic **`fake`** test adapter. The OpenAI / Gemini / Voyage
  adapters are a small v0.13.1 follow-up: each is one new file + a config case
  + a test, with zero changes to the pipeline.
- **Four backends, designed-for, one shipped now.** The interface accommodates
  Ollama, OpenAI, Gemini, and Voyage. (Anthropic/Claude has NO embeddings
  endpoint — Claude is generation-only — so the "Anthropic-aligned" backend is
  **Voyage AI**, the provider Anthropic officially recommends.)
- **Index-free, dimensionless `vector` column.** The embedding column is typed
  `vector` (no fixed dimension) so any backend's vector fits. A single-user
  library is small enough for a brute-force sequential cosine scan
  (sub-millisecond), so no HNSW/IVF index is needed. This sidesteps the
  multi-backend dimension-mismatch problem entirely.
- **One active backend at a time.** Embeddings from different backends/models
  live in incompatible vector spaces and cannot be compared. The active
  backend is set by config; switching backends invalidates the index and
  requires a reindex (every row mismatches → all re-embed).
- **On-write async embedding + a manual reindex button.** Doc create/edit
  (when `content_hash` changes) fires a background embed; the response returns
  immediately. A "Reindex library" Admin button backfills existing docs and
  repairs after a backend switch.
- **Config gates, UI toggles.** Deploy-time env (`EMBEDDING_BACKEND`) decides
  availability + backend. When available, a server-side runtime toggle
  (`app_settings.semantic_search_enabled`) turns the feature on/off live,
  consistently across the UI and MCP. `EMBEDDING_BACKEND=none` (default) =
  feature fully unavailable.
- **Env-only config.** All backend config (URLs, model names, API keys) is set
  via env / compose, never through the no-auth web UI. The UI shows only
  read-only status + the on/off toggle. (An API key in a UI-writable settings
  table would be readable over the open HTTP API.)

## Non-goals

- **No generation.** Retrieval only. No summaries, no RAG chat, no auto-tagging.
- **The OpenAI / Gemini / Voyage adapters are v0.13.1**, not this release.
- **No hybrid keyword+semantic fusion ranking, no re-ranking.** Semantic mode
  is pure vector similarity; keyword search stays as-is and separate.
- **No multiple simultaneous backend indexes.** One active backend.
- **No automatic backend fallback.**
- **No semantic search in the demo server** (no pgvector; reports unavailable).
- **No index (HNSW/IVF).** Brute-force scan is sufficient at single-user scale;
  revisit only if a corpus ever grows past tens of thousands of docs.

## Infrastructure

### Postgres image

`postgres:18-alpine` does not bundle pgvector. Switch the Compose Postgres
image to **`pgvector/pgvector:pg18`** (official pgvector image, built on
Postgres 18 — identical on-disk format, so existing volumes are preserved
across the swap). The Kubernetes/CloudNativePG manifests get a note to use a
Postgres image that includes pgvector; that deployment update is out of scope
for this PR beyond documentation.

### Migration `0005_add_embeddings.sql`

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

`embedding` is dimensionless (no `vector(N)`), so any backend's output fits.

### Migration `0006_add_app_settings.sql`

```sql
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

A general key-value settings store. First (and only, for now) key:
`semantic_search_enabled`.

## Data model semantics

An embedding is **current** when `embedding is not null AND embedded_hash =
content_hash AND embedding_backend = <active backend>`. It is **stale / needs
(re)embedding** otherwise:
- `embedding is null` — never embedded.
- `embedded_hash != content_hash` — the body changed since embedding (reuses
  the same content-hash staleness trick as derived-from links).
- `embedding_backend != <active>` — a backend switch invalidated it.

Reindex targets exactly the "needs (re)embedding" set.

## Embedder abstraction

New module `server/embedder/`:

```
server/embedder/
  index.js     — createEmbedder(config) → active adapter | null
  ollama.js    — Ollama adapter (v0.13.0)
  fake.js      — deterministic test adapter (v0.13.0)
  // openai.js, gemini.js, voyage.js — v0.13.1
```

### Adapter interface

Every adapter exposes:

```js
{
  backend: 'ollama',                              // identifier string
  async embed(text) { return { vector, model, dim }; },  // vector: number[]
  async isAvailable() { return true|false; },     // can we reach the backend?
}
```

`createEmbedder(config)` returns the adapter matching `config.backend`, or
`null` when `backend === 'none'`. Adding a backend = one new file + one switch
case; the pipeline, routes, repository, and search never change.

### Ollama adapter

- `embed(text)`: `POST {OLLAMA_URL}/api/embeddings` with `{ model, prompt: text }`;
  returns `{ vector: response.embedding, model, dim: vector.length }`.
- `isAvailable()`: `GET {OLLAMA_URL}/api/tags`, true on 200.
- Default model: `nomic-embed-text` (768-dim).

### `fake` adapter (test enabler)

A deterministic adapter that maps text → a fixed-dimension pseudo-vector seeded
from the SHA-256 of the text (e.g. expand the 32 hash bytes into a normalized
N-dim float vector). NOT semantically meaningful, but:
- Same text always produces the same vector → a doc matches its own text
  exactly, identical docs rank identically.
- Lets the *entire pipeline* (embed → store → cosine-rank → return) be tested
  deterministically with zero external services.
- Usable as `EMBEDDING_BACKEND=fake` in tests and offline dev.

### Config (env)

- `EMBEDDING_BACKEND` = `none` (default) | `ollama` | `fake` | (later
  `openai` / `gemini` / `voyage`)
- `EMBEDDING_MODEL` — optional model-name override
- `OLLAMA_URL` — default `http://127.0.0.1:11434`
- (v0.13.1) `OPENAI_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY`

## Embedding pipeline

### `server/embeddingService.js`

`embedDocument(id)`:
1. Load the doc; if no active embedder, return (no-op).
2. `const { vector, model, dim } = await embedder.embed(doc.body)`.
3. Store `embedding`, `embedding_backend = embedder.backend`,
   `embedding_model = model`, `embedding_dim = dim`,
   `embedded_hash = doc.content_hash`, `embedded_at = now()`.

Storing a vector through `pg`: pgvector accepts the string form
`'[0.1,0.2,...]'`; the repository serializes `number[]` to that literal for the
parameterized insert.

### On-write trigger

In the `POST /api/library/documents` and `PATCH /api/library/documents/:id`
handlers, after a successful write where the body changed (content_hash
differs), call `embedDocument(doc.id)` **without awaiting**. Errors are caught
and logged; the HTTP response is unaffected. If the process restarts mid-embed,
the row is simply content-stale and the next reindex repairs it.

The feature is dormant when `EMBEDDING_BACKEND=none` or the runtime toggle is
off — `embedDocument` becomes a no-op.

### Reindex

`POST /api/library/embeddings/reindex`:
- Selects all docs in the "needs (re)embedding" set (see Data model
  semantics).
- Embeds them serially with a small concurrency cap (e.g. 4) so a burst
  doesn't hammer the backend.
- Returns `{ embedded: <count>, total: <count>, skipped: <count> }`.

## Search surface

### Repository

`searchDocumentsSemantic(queryVector, { projectId, limit })`:

```sql
select <ref columns>
from markdown_documents
where archived_at is null
  and embedding is not null
  and embedding_backend = $activeBackend
  ${projectId ? 'and project_id = $n' : ''}
order by embedding <=> $queryVector   -- cosine distance
limit $limit
```

The query vector is serialized to the pgvector literal form. `<=>` is cosine
distance (smaller = more similar).

### HTTP route

`GET /api/library/documents/semantic-search?q=...&project=...`:
1. If the feature is unavailable (backend `none`) or the toggle is off →
   `409`/`400` with `{ message: 'semantic search is not enabled' }`.
2. Embed `q` with the active backend.
3. Run `searchDocumentsSemantic`.
4. Return the same lightweight refs as keyword search (id, title, type,
   projectId, tags, snippet).

### MCP tool

New `search_documents_semantic` tool (`query`, `project?`), kept separate from
keyword `search_documents` so the agent chooses explicitly. When the feature is
off/unconfigured it returns a clear "semantic search is not enabled" message
(not an error result, so the agent can fall back to keyword search).

### Runtime toggle

- `GET /api/settings/semantic-search` → `{ available: bool, enabled: bool,
  backend: string|null, model: string|null, connected: bool, embeddedCount,
  totalCount }`.
- `PUT /api/settings/semantic-search` `{ enabled: bool }` → writes
  `app_settings.semantic_search_enabled`.
- `available` is config-derived (a backend is configured); `enabled` is the
  runtime flag. The feature is active only when `available && enabled`. The
  Admin toggle and the MCP tool both honor this.

## UI

### Library search

When the feature is active, the search control gains a small **keyword /
semantic** mode switch. Semantic mode calls `semantic-search`; keyword mode is
unchanged. When unavailable/disabled, no switch is shown — keyword only,
exactly as today.

### Admin → Semantic Search section

- Read-only status line: `backend: ollama @ <url> · connected · 142/150
  embedded` (or `unavailable (no backend configured)`).
- On/off **toggle** (writes the runtime flag).
- **Reindex library** button with a result summary.

## Demo server

The in-memory demo (`scripts/demo-server.js`) has no pgvector and no embedding
backend. It reports semantic search as **unavailable**:
- `GET /api/settings/semantic-search` → `{ available: false, ... }`.
- `semantic-search` route and reindex → `{ message: 'semantic search is not
  enabled' }` (no-op).
- The Admin status shows "unavailable"; the library search mode switch is
  hidden.

The demo remains a pure UI sandbox; real semantic ranking is a Postgres-only
capability.

## Testing strategy

### Unit

- `server/embedder/ollama.js` — mocked HTTP: `embed` parses the response into
  `{ vector, model, dim }`; `isAvailable` maps 200→true, error→false.
- `server/embedder/fake.js` — determinism: same text → same vector; different
  text → different vector; correct configured dimension.
- `createEmbedder` — returns the right adapter per `backend`, `null` for
  `none`.
- `searchDocumentsSemantic` builder — SQL contains the cosine `<=>` order,
  the `embedding is not null` + active-backend filter, optional project filter,
  limit.
- Reindex selection — the "needs (re)embedding" predicate covers null /
  content-stale / backend-mismatch and excludes current rows.
- `app_settings` repo — get/put round-trip, default when absent.
- Settings route — `available`/`enabled` composition.

### The `fake` backend carries the pipeline tests

Deterministic vectors mean a doc's own text is its nearest neighbor, so ranking
order is assertable with no external services.

### Real-Postgres E2E

- Bring up the `pgvector/pgvector:pg18` stack, apply migrations (incl. `vector`
  extension + `app_settings`).
- `EMBEDDING_BACKEND=fake`.
- Seed several docs; `POST .../embeddings/reindex`; confirm the embedded count.
- `GET .../semantic-search?q=<exact text of doc A>` → assert doc A ranks first.
- Toggle off via `PUT /api/settings/semantic-search` → semantic-search returns
  "not enabled".
- Confirm migration idempotency (re-run migrate; extension + columns once).

### Playwright e2e (demo, feature unavailable)

- Assert the library search shows no semantic mode switch (feature
  unavailable) and the Admin status line reads "unavailable". Uses the existing
  harness.

### Contract / docs

- `docs/contract.md` gains the `search_documents_semantic` MCP tool row, the
  `semantic-search` + settings + reindex routes, and a note that semantic
  search is a Postgres-only, config-gated, retrieval-only feature.

## Release

**v0.13.0** (minor — additive feature). Notable: the Compose Postgres image
swap to `pgvector/pgvector:pg18` (volume-compatible) and the new optional
Ollama dependency. Default `EMBEDDING_BACKEND=none` means a stock deploy is
unchanged until an operator opts in.

## Open questions

None.
