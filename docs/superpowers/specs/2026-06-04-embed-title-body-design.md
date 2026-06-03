# Embed title + body + recall --recent — Design (v0.14.1)

**Goal:** Improve semantic-search recall by embedding a document's **title + body** (not body
alone), and add a chronological **`--recent`** mode to `moomora-recall` for "what did I note
earlier" style intents.

**Motivation:** Live testing showed a memory note titled "Test note" (body "something durable
worth recalling") was found by a body-matching query but **not** by the title ("test note") — the
title was never embedded. Titles are high-signal, especially for short notes.

---

## Extra 1 — embed title + body

### Approach (keeps `content_hash` body-only per the export contract; no re-embed loop)

- A pure helper `embeddableText(doc)` returns `title` + `body` joined (blank line between), trimming
  and dropping empty parts. `embedOne` embeds `embeddableText(doc)` instead of `doc.body || ''`.
- **`embedded_hash` is unchanged** — still the body `content_hash`. So the staleness SQL
  (`embedded_hash is distinct from content_hash`), `countEmbeddings`, and the documented
  `content_hash` (= SHA-256 of the body) are all untouched, and there is no infinite re-embed loop.
- **Title edits re-embed live:** the PATCH on-write trigger currently fires only when `body` is in
  the patch; change it to fire when **`title` or `body`** is in the patch. So editing a title
  through the UI/API re-embeds with the new title.
- **Migration / full rebuild:** existing embeddings are body-only and look "current" to the
  staleness check (their `embedded_hash` still equals `content_hash`), so a normal reindex won't
  re-embed them. Add a **force** mode to reindex: `POST /api/library/embeddings/reindex?force=true`
  re-embeds *all* active documents (via `repository.listDocuments({})`); the default
  (`?force` absent) stays staleness-based. Run force once after upgrading.

### Honest trade-off

A title-only edit made **outside** the app (direct DB write, bulk import that bypasses the trigger)
won't be auto-flagged by the staleness scan, because `content_hash` (body) didn't change. Live
UI/API title edits re-embed via the trigger, and `?force=true` repairs anything. This keeps the
change small and avoids adding a `pgcrypto` dependency or decoupling `embedded_hash` from
`content_hash`.

### Changes

- `server/embeddingService.js`: export pure `embeddableText(doc)`; `embedOne` embeds it;
  `reindex({ force = false } = {})` selects `repository.listDocuments({})` when `force` else
  `repository.listDocumentsNeedingEmbedding(backend)` (both yield rows with `id` + `contentHash`).
- `server/libraryRoutes.js`: reindex route parses `force` from the query and passes
  `{ force }`; the PATCH trigger fires on `title` **or** `body`.
- No change to the repository builders, `countEmbeddings`, migrations, or the export contract.

### Tests

- `embeddableText`: title+body join; missing title → body only; missing body → title only; both
  empty → `''`.
- `embedOne` embeds the title+body text (recording embedder asserts the embedded input contains the
  title).
- `reindex({ force: true })` embeds **all** docs (uses `listDocuments`), vs. default which uses the
  needs-embedding set.
- Routes: PATCH a **title-only** change fires the embed; a patch touching **neither** title nor body
  (e.g. tags only) does **not**; `?force=true` reaches `reindex({force:true})`. (Update the existing
  "patching without a body change does not fire" test, whose `{title}` payload now legitimately
  fires.)

---

## Extra 2 — `moomora-recall --recent [N]`

Semantic search matches *content meaning*; "what did I note earlier" is a chronological list need,
not a similarity need. Add a mode to `recall.mjs`:

- `node recall.mjs --recent [N] [--project <slug>]` → `GET /api/library/documents[?project=]`, sort
  by `updatedAt` desc, print the top `N` (default 5) as `title — id` (with a one-line snippet),
  skipping the semantic path entirely. Respects `--project` (e.g. `--project memory`).
- Update `SKILL.md` (and `docs/agent-memory.md`) to mention `--recent` for "list my recent notes".

No app change for Extra 2 (skill only).

## Rollout

- Docs: `docs/contract.md` notes embeddings cover **title + body** and the `?force=true` reindex
  option; `docs/agent-memory.md` mentions `--recent`. CHANGELOG.
- Ship as **v0.14.1** (the title+body embedding is the app change; the skill rides along). **After
  upgrading, run `POST /api/library/embeddings/reindex?force=true` once** to re-embed existing docs
  as title+body. Verified against the running local-Ollama stack (the "test note" title query should
  then find it).
