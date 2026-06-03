# Semantic Search UX Fixes Implementation Plan (v0.13.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three v0.13.0 semantic-search issues: relevance cutoff, auto-focus the top hit, and
the oversized keyword/semantic switch buttons.

**Architecture:** Backend gains an env-tunable gap-based relevance cutoff (pure helper applied
after the cosine query); frontend auto-selects the top result and the library browser becomes a
flex column so the switch renders as small pills.

**Tech Stack:** Fastify + plain `pg`; Node built-in test runner; plain-JS browser modules.

Branch: `feature/semantic-search-ux` (already created). Spec:
`docs/superpowers/specs/2026-06-03-semantic-search-ux-design.md`.

---

## Task 1 — Backend relevance cutoff

**Files:**
- Modify: `server/config.js`
- Modify: `server/libraryRepository.js`
- Modify: `server/libraryRoutes.js`
- Modify: `server/index.js`
- Test: `tests/backend/config.test.js`, `tests/backend/libraryRepository.embedding.test.js`,
  `tests/backend/semanticRoutes.test.js`

- [ ] **Step 1: Config — add two env-tunable thresholds (guard empty string)**

In `server/config.js`, add to the returned object (note the `?` guard so an empty string falls
back to the default rather than `Number("") === 0`):

```javascript
    embeddingSearchMinSimilarity: env.EMBEDDING_SEARCH_MIN_SIMILARITY ? Number(env.EMBEDDING_SEARCH_MIN_SIMILARITY) : 0.45,
    embeddingSearchTopDrop: env.EMBEDDING_SEARCH_TOP_DROP ? Number(env.EMBEDDING_SEARCH_TOP_DROP) : 0.20,
```

- [ ] **Step 2: Config test**

Add to `tests/backend/config.test.js`:

```javascript
test('embedding search thresholds default and override', () => {
  const d = loadConfig({});
  assert.equal(d.embeddingSearchMinSimilarity, 0.45);
  assert.equal(d.embeddingSearchTopDrop, 0.20);
  const o = loadConfig({ EMBEDDING_SEARCH_MIN_SIMILARITY: '0.6', EMBEDDING_SEARCH_TOP_DROP: '0.1' });
  assert.equal(o.embeddingSearchMinSimilarity, 0.6);
  assert.equal(o.embeddingSearchTopDrop, 0.1);
  // empty string must NOT become 0
  assert.equal(loadConfig({ EMBEDDING_SEARCH_MIN_SIMILARITY: '' }).embeddingSearchMinSimilarity, 0.45);
});
```

(Confirm `tests/backend/config.test.js` imports `loadConfig`; it does.)

- [ ] **Step 3: Repository — similarity column + pure cutoff helper + apply in method**

In `server/libraryRepository.js`:

(a) Add module-level defaults near the top (after the existing imports):

```javascript
const DEFAULT_MIN_SIMILARITY = 0.45;
const DEFAULT_TOP_DROP = 0.20;
```

(b) Add `similarity` to the SELECT in `buildSearchDocumentsSemantic` (keep everything else):

```javascript
    text: `
      select id, title, document_type, project_id, tags, body, kind,
             1 - (embedding <=> $1::vector) as similarity
      from markdown_documents
      ${where}
      order by embedding <=> $1::vector
      limit $${values.length}
    `,
```

(c) Add the pure exported helper (place it just above `createLibraryRepository`):

```javascript
// Gap-based relevance cutoff: keep rows within DROP of the best similarity, but
// never below an absolute FLOOR (kills nonsense queries). Rows arrive ordered by
// similarity desc (the SQL orders by cosine distance asc). Pure + side-effect free.
export function applyRelevanceCutoff(rows, { minSimilarity = DEFAULT_MIN_SIMILARITY, topDrop = DEFAULT_TOP_DROP } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const top = Number(rows[0].similarity);
  const threshold = Math.max(minSimilarity, top - topDrop);
  return rows.filter((r) => Number(r.similarity) >= threshold);
}
```

(d) Update the `searchDocumentsSemantic` repository method to apply it:

```javascript
    async searchDocumentsSemantic(queryLiteral, backend, opts = {}) {
      const q = buildSearchDocumentsSemantic(queryLiteral, backend, opts);
      const result = await db.query(q.text, q.values);
      const kept = applyRelevanceCutoff(result.rows, { minSimilarity: opts.minSimilarity, topDrop: opts.topDrop });
      return kept.map(normalizeDocumentRow);
    },
```

(`normalizeDocumentRow`'s allowlist already excludes `similarity`, so it does not reach the ref.)

- [ ] **Step 4: Repository tests**

Add to `tests/backend/libraryRepository.embedding.test.js` (import `applyRelevanceCutoff` and
`buildSearchDocumentsSemantic`):

```javascript
test('buildSearchDocumentsSemantic selects similarity (a scalar, not the vector)', () => {
  const q = buildSearchDocumentsSemantic('[0.1]', 'ollama', { limit: 5 });
  assert.match(q.text, /1 - \(embedding <=> \$1::vector\) as similarity/);
  // The select list projects only the explicit ref columns + similarity; the
  // raw vector is never a selected column. (No-leak is further locked by the
  // normalizeDocumentRow allowlist test and the route ref-shape test.)
  assert.match(q.text, /select id, title, document_type, project_id, tags, body, kind,/);
});

test('applyRelevanceCutoff keeps only the strong hit (calibration: graphics query)', () => {
  const rows = [
    { id: 'proxmox', similarity: 0.751 },
    { id: 'restic', similarity: 0.377 },
    { id: 'vlan', similarity: 0.376 },
    { id: 'espresso', similarity: 0.333 },
  ];
  const kept = applyRelevanceCutoff(rows, { minSimilarity: 0.45, topDrop: 0.20 });
  assert.deepEqual(kept.map((r) => r.id), ['proxmox']);
});

test('applyRelevanceCutoff drops everything for a nonsense query (all below floor)', () => {
  const rows = [
    { id: 'a', similarity: 0.283 },
    { id: 'b', similarity: 0.282 },
    { id: 'c', similarity: 0.243 },
  ];
  assert.deepEqual(applyRelevanceCutoff(rows, { minSimilarity: 0.45, topDrop: 0.20 }), []);
});

test('applyRelevanceCutoff keeps a close cluster above the floor', () => {
  const rows = [
    { id: 'a', similarity: 0.70 },
    { id: 'b', similarity: 0.62 },   // within 0.20 of top and above floor
    { id: 'c', similarity: 0.40 },   // below top-0.20 (0.50) -> drop
  ];
  assert.deepEqual(applyRelevanceCutoff(rows, { minSimilarity: 0.45, topDrop: 0.20 }).map((r) => r.id), ['a', 'b']);
});

test('applyRelevanceCutoff handles empty input', () => {
  assert.deepEqual(applyRelevanceCutoff([], {}), []);
  assert.deepEqual(applyRelevanceCutoff(undefined, {}), []);
});
```

- [ ] **Step 5: Wire thresholds config → app → route**

In `server/index.js` `buildApp`, after the existing `app.decorate('embedder', embedder);` block,
add:

```javascript
  app.decorate('embeddingSearch', {
    minSimilarity: config.embeddingSearchMinSimilarity,
    topDrop: config.embeddingSearchTopDrop,
  });
```

In `server/libraryRoutes.js`, in the `semantic-search` route handler, pass the thresholds into the
repository call. Change:

```javascript
    const docs = await repository.searchDocumentsSemantic(toVectorLiteral(vector), embedder.backend, { projectId, limit: 20 });
```

to:

```javascript
    const search = app.embeddingSearch || {};
    const docs = await repository.searchDocumentsSemantic(toVectorLiteral(vector), embedder.backend, {
      projectId,
      limit: 20,
      minSimilarity: search.minSimilarity,
      topDrop: search.topDrop,
    });
```

(`searchDocumentsSemantic` already defaults the thresholds when `undefined`, so route tests that
don't decorate `embeddingSearch` still pass.)

- [ ] **Step 6: Route test — cutoff applied, ref shape unchanged**

In `tests/backend/semanticRoutes.test.js`, the fake `searchDocumentsSemantic` returns refs without
`similarity` (the repo strips it), so the existing "returns refs when enabled" test still holds.
Add one assertion there (or a new test) that the returned objects have **no** `similarity` or
`embedding` key:

```javascript
test('semantic-search refs never expose similarity or embedding', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  const refs = res.json();
  assert.ok(refs.length > 0);
  for (const r of refs) {
    assert.ok(!('similarity' in r));
    assert.ok(!('embedding' in r));
  }
  await app.close();
});
```

- [ ] **Step 7: Run + commit**

Run: `npm test` → green. Run: `npm run check` → PASS.

```bash
git add server/config.js server/libraryRepository.js server/libraryRoutes.js server/index.js \
        tests/backend/config.test.js tests/backend/libraryRepository.embedding.test.js \
        tests/backend/semanticRoutes.test.js
git commit -m "Semantic search: gap-based relevance cutoff for search results

Filter ranked results to keep only those within EMBEDDING_SEARCH_TOP_DROP
(0.20) of the best similarity and at least EMBEDDING_SEARCH_MIN_SIMILARITY
(0.45) — defaults calibrated against qwen3-embedding:0.6b, env-overridable.
A nonsense query (best hit below the floor) returns nothing; a strong hit
returns just the relevant cluster. Pure applyRelevanceCutoff helper; the
similarity scalar never reaches the ref (normalizeDocumentRow allowlist).
Applies to HTTP and MCP."
```

---

## Task 2 — Frontend: auto-focus top hit + fix switch CSS

**Files:**
- Modify: `public/js/main.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Auto-focus the top result in the Enter handler**

In `public/js/main.js`, the semantic-search `keydown` handler (the block guarded by
`event.key === 'Enter'` and `state.librarySearchMode === 'semantic'`) currently does:

```javascript
    try {
      const refs = await semanticSearch(q, state.activeProject);
      setState({ semanticResults: refs });
      renderWorkspace();
    } catch (error) {
      console.error('Semantic search failed', error);
      setState({ semanticResults: [] });
      renderWorkspace();
    }
```

Replace the `try` body with selection of the top hit:

```javascript
    try {
      const refs = await semanticSearch(q, state.activeProject);
      const patch = { semanticResults: refs };
      if (refs.length) {
        const top = state.documents.find((d) => d.id === refs[0].id);
        patch.selectedDocumentId = refs[0].id;
        patch.documentDraftId = top?.id || null;
        patch.documentDraftBody = top?.body || '';
        patch.isDocumentDirty = false;
        patch.documentLinks = null;
      } else {
        patch.selectedDocumentId = null;
      }
      setState(patch);
      renderWorkspace();
      if (refs.length) loadDocumentLinks(refs[0].id);
    } catch (error) {
      console.error('Semantic search failed', error);
      setState({ semanticResults: [] });
      renderWorkspace();
    }
```

(`loadDocumentLinks` is already defined and used by the row-click handler.)

- [ ] **Step 2: Fix `.library-browser` layout so the switch is small**

In `public/styles.css`, change the `.library-browser` rule from the grid to a flex column:

```css
.library-browser {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 0;
}
```

And update the two rules so the list grows/scrolls and the switch stays content-height. Change
`.library-search-mode` (add `flex` + `align-items`):

```css
.library-search-mode {
  display: flex;
  gap: 4px;
  padding: 8px 14px 4px;
  border-top: 1px solid var(--border);
  flex: 0 0 auto;
  align-items: center;
}
```

And `.document-list` (add `flex: 1; min-height: 0;` so it fills remaining height and scrolls):

```css
.document-list {
  display: grid;
  align-content: start;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 3: Check + visual verify on the running stack**

Run: `npm run check` → PASS (parses `public/js/main.js`).

The reviewer/controller redeploys the running compose stack with the rebuilt source (or the
controller verifies via the live stack) and confirms in the browser: the `keyword | semantic`
buttons are small inline pills; the list scrolls; a semantic query focuses the top hit; a nonsense
query shows the empty state.

- [ ] **Step 4: Commit**

```bash
git add public/js/main.js public/styles.css
git commit -m "Semantic search UI: focus the top hit + fix switch button sizing

After an Enter-triggered semantic search, open the #1 ranked result in the
detail pane (load its links); zero results clears the selection. Convert
.library-browser from a fixed 4-row grid to a flex column so the
conditionally-rendered keyword/semantic switch renders as small pills
instead of stretching into the list's 1fr row, with .document-list as the
sole growing/scrolling child."
```

---

## Task 3 — Docs + real-Postgres re-verify + final review + release

**Files:**
- Modify: `docs/contract.md`

- [ ] **Step 1: Document the cutoff + env vars**

In `docs/contract.md`, in the "Semantic search" paragraph (added in v0.13.0), append a sentence:

```markdown
Results are filtered by a gap-based relevance cutoff: only documents scoring within
`EMBEDDING_SEARCH_TOP_DROP` (default 0.20) of the best match and at least
`EMBEDDING_SEARCH_MIN_SIMILARITY` (default 0.45) cosine similarity are returned, so an unrelated
query can return few or no results rather than the whole ranked library. Both thresholds are
env-tunable (defaults calibrated for `qwen3-embedding:0.6b`).
```

Commit:

```bash
git add docs/contract.md
git commit -m "docs: document the semantic search relevance cutoff + env vars"
```

- [ ] **Step 2: Full local suite**

Run: `npm test` → green. Run: `npm run check` → PASS. Run: `npm run test:e2e` → green.

- [ ] **Step 3: Real-Postgres re-verify (controller, on the running stack)**

The controller redeploys the running compose stack (published image rebuilt from this branch, or
source) pointed at the real Ollama, and confirms end-to-end:
- A strong paraphrase query returns ONLY the relevant doc(s) and focuses the top hit.
- A nonsense query (e.g. "what is the meaning of life") returns an empty result set (HTTP 200, `[]`).
- The switch renders as small pills.
- Status/toggle/reindex unchanged; no vector leak in responses.

- [ ] **Step 4: Final review + PR**

Dispatch a final reviewer over the branch (spec compliance + quality + the no-leak invariant still
holds with the new `similarity` column). Then push and open a PR titled
`Semantic search UX: relevance cutoff, top-hit focus, switch sizing (v0.13.1)`.

- [ ] **Step 5: Release v0.13.1 (post-merge)**

After merge: branch `release-v0.13.1`, `npm version 0.13.1 --no-git-tag-version`, bump
`compose.image.yaml` + README image tag to `v0.13.1`, roll CHANGELOG with a `### Fixed` /
`### Changed` entry (relevance cutoff + env vars, top-hit focus, switch sizing) + compare link, PR,
merge, tag `v0.13.1`, watch the release workflow.
