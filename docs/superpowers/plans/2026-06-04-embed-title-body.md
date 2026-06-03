# Embed title+body + recall --recent — Plan (v0.14.1)

> Use superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-04-embed-title-body-design.md`.

Branch: `feature/embed-title-body`.

## Task 1 — embed title+body + force reindex + title-edit trigger (backend)

**Files:** `server/embeddingService.js`, `server/libraryRoutes.js`,
`tests/backend/embeddingService.test.js`, `tests/backend/semanticRoutes.test.js`.

- [ ] **embeddingService.js** — add the exported helper and use it; add `force` to reindex:

```javascript
import { toVectorLiteral } from './vectorLiteral.js';

// The text we embed for a document: title + body together, so a query matching
// the title (high-signal, especially for short notes) retrieves it. Trims and
// drops empty parts.
export function embeddableText(doc) {
  return [doc?.title, doc?.body]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}
```

In `embedOne`, change `await embedder.embed(doc.body || '')` to `await embedder.embed(embeddableText(doc))`.

Change `async reindex() {` to `async reindex({ force = false } = {}) {` and the pending-set line to:

```javascript
      const pending = force
        ? await repository.listDocuments({})
        : await repository.listDocumentsNeedingEmbedding(embedder.backend);
```

(Both yield rows with `id` + `contentHash`; the rest of the batching loop and `embedOne(d.id, d.contentHash)` are unchanged.)

- [ ] **libraryRoutes.js** — reindex route honors `?force=true`; PATCH trigger fires on title or body:

Reindex route body becomes:
```javascript
    if (!embedder) { reply.code(409); return { message: 'semantic search is not configured' }; }
    if (!embeddingService) { reply.code(409); return { message: 'semantic search is not configured' }; }
    const force = request.query.force === 'true' || request.query.force === true;
    const result = await embeddingService.reindex({ force });
    return result;
```

PATCH trigger condition changes from `Object.prototype.hasOwnProperty.call(request.body, 'body')` to:
```javascript
    if ((Object.prototype.hasOwnProperty.call(request.body, 'title') || Object.prototype.hasOwnProperty.call(request.body, 'body')) && embeddingService && embedder && await semanticActive()) {
```

- [ ] **embeddingService.test.js** — add (import `embeddableText`):

```javascript
test('embeddableText joins title + body and tolerates missing parts', () => {
  assert.equal(embeddableText({ title: 'T', body: 'B' }), 'T\n\nB');
  assert.equal(embeddableText({ body: 'B' }), 'B');
  assert.equal(embeddableText({ title: 'T' }), 'T');
  assert.equal(embeddableText({}), '');
});

test('embedOne embeds the title + body, not just the body', async () => {
  const seen = [];
  const recordingEmbedder = {
    backend: 'rec',
    async embed(text) { seen.push(text); return { vector: [0.1], model: 'rec', dim: 1 }; },
    async isAvailable() { return true; },
  };
  const docs = [{ id: 'a', title: 'Postgres restore', body: 'replay WAL', contentHash: 'h1' }];
  const repo = fakeRepo(docs);
  const svc = createEmbeddingService({ repository: repo, embedder: recordingEmbedder });
  await svc.embedDocument('a');
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Postgres restore/);   // title is in the embedded text
  assert.match(seen[0], /replay WAL/);          // body too
});

test('reindex force embeds all docs (listDocuments), not just the needs set', async () => {
  const docs = [
    { id: 'a', title: 'A', body: 'one', contentHash: 'h1' },
    { id: 'b', title: 'B', body: 'two', contentHash: 'h2' },
  ];
  // listDocumentsNeedingEmbedding returns nothing (all "current"); force must still embed via listDocuments.
  const repo = {
    ...fakeRepo(docs),
    listDocumentsNeedingEmbedding: async () => [],
    listDocuments: async () => docs,
  };
  const svc = createEmbeddingService({ repository: repo, embedder: createFakeEmbedder({ dim: 8 }) });
  assert.equal((await svc.reindex()).embedded, 0);            // default: needs-set empty
  assert.equal((await svc.reindex({ force: true })).embedded, 2);  // force: all
});
```

(Confirm `fakeRepo` in this file accepts the docs and exposes `listDocuments`; if `fakeRepo` lacks `listDocuments`, add `listDocuments: async () => docs` to its returned object so the force test and any future use work. The `embedOne` change reads `doc.title`, so add `title` to the existing `fakeRepo` docs where helpful — the existing tests pass titles or tolerate undefined via `embeddableText`.)

- [ ] **semanticRoutes.test.js** — the fake `library.updateDocument` echoes the patch; update the no-fire test and add a title-fires + force test:

Replace the body of `test('patching without a body change does not fire an embed', …)` so it patches **tags only** (no title/body) and asserts no embed:
```javascript
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/library/documents/${id}`,
    payload: { tags: ['x'] },   // neither title nor body -> no embed
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(embedded, []);
```

Add:
```javascript
test('patching the title fires a non-awaited embed', async () => {
  const embedded = [];
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embeddingService.embedDocument = async (docId) => { embedded.push(docId); return true; };
  });
  const id = '00000000-0000-4000-8000-0000000000aa';
  const res = await app.inject({ method: 'PATCH', url: `/api/library/documents/${id}`, payload: { title: 'Renamed' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(embedded, [id]);
  await app.close();
});

test('reindex?force=true reaches the force path', async () => {
  let sawForce;
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embeddingService.reindex = async (opts) => { sawForce = opts?.force; return { embedded: 9, failed: 0 }; };
  });
  const res = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex?force=true' });
  assert.equal(res.statusCode, 200);
  assert.equal(sawForce, true);
  await app.close();
});
```

- [ ] `npm test` green; `npm run check` PASS. Commit:
```bash
git add server/embeddingService.js server/libraryRoutes.js tests/backend/embeddingService.test.js tests/backend/semanticRoutes.test.js
git commit -m "Semantic search: embed title + body, with title-edit reembed + force reindex

embedOne now embeds embeddableText(doc) = title + body (was body only), so
title-matching queries retrieve a doc — titles are high-signal, especially
for short notes. The PATCH on-write trigger fires on a title OR body change.
POST /api/library/embeddings/reindex?force=true re-embeds all active docs
(migration / full rebuild); the default stays staleness-based. embedded_hash
remains the body content_hash, so the staleness SQL, counts, and the export
contract are unchanged."
```

## Task 2 — recall --recent + docs + verify + release

**Files:** `.claude/skills/moomora-recall/recall.mjs`, `.claude/skills/moomora-recall/SKILL.md`,
`docs/agent-memory.md`, `docs/contract.md`, `CHANGELOG.md`.

- [ ] **recall.mjs** — add a `--recent [N]` mode that lists recent docs chronologically (sort by
  `updatedAt` desc) from `GET /api/library/documents[?project=]`, printing `title — id` + a short
  snippet, bypassing semantic search. Respect `--project`. Update arg parsing + add a branch before
  the semantic path.
- [ ] **SKILL.md** + **docs/agent-memory.md** — document `--recent` ("list my recent notes").
- [ ] **docs/contract.md** — note embeddings cover **title + body**, and the `?force=true` reindex
  option.
- [ ] **CHANGELOG** `[Unreleased]` (or roll into the v0.14.1 release): title+body embedding,
  `--recent`, force reindex.
- [ ] Verify on the running local-Ollama stack: `reindex?force=true`, then a **title query**
  ("test note") finds the memory note; `--recent` lists it. `npm test` + `check` + e2e green. Final
  review. PR.
- [ ] Release v0.14.1 post-merge (branch, `npm version 0.14.1`, bump compose.image.yaml + README
  tag, CHANGELOG, tag, watch workflow).
