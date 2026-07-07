import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchDocumentsSemantic,
  buildListDocumentsNeedingEmbedding,
  buildSetDocumentEmbedding,
  createLibraryRepository,
  normalizeDocumentRow,
  applyRelevanceCutoff,
  cosineSimilarity,
} from '../../server/libraryRepository.js';

// Semantic search on the embedded-SQLite build: the SQL fetches candidate
// rows (embedding included) and the cosine ranking happens in JS.
test('buildSearchDocumentsSemantic selects candidates with the pg-era filters + embedding', () => {
  const q = buildSearchDocumentsSemantic('fake', {});
  assert.match(q.text, /select id, title, document_type, project_id, tags, body, kind, verified, status, embedding/);
  assert.match(q.text, /archived_at is null/);
  assert.match(q.text, /embedding is not null/);
  assert.match(q.text, /embedding_backend = \$1/);
  assert.match(q.text, /status = 'active'/);
  assert.doesNotMatch(q.text, /<=>/, 'no pgvector operator on SQLite');
  assert.deepEqual(q.values, ['fake']);
});

test('buildSearchDocumentsSemantic threads includeRetired and projectId', () => {
  const retired = buildSearchDocumentsSemantic('fake', { includeRetired: true });
  assert.doesNotMatch(retired.text, /status = 'active'/);

  const scoped = buildSearchDocumentsSemantic('fake', { projectId: 'p1' });
  assert.match(scoped.text, /project_id = \$2/);
  assert.deepEqual(scoped.values, ['fake', 'p1']);
});

test('cosineSimilarity ranks aligned vectors above orthogonal ones and rejects junk', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), null);  // dim mismatch
  assert.equal(cosineSimilarity([0, 0], [1, 0]), null);     // zero vector
  assert.equal(cosineSimilarity([1], null), null);
  assert.equal(cosineSimilarity([], []), null);
});

test('cosineSimilarity rejects vectors with null/NaN/non-number entries instead of scoring them as 0', () => {
  // `null * null === 0` would otherwise yield a finite-but-wrong similarity that
  // ranks and passes the relevance cutoff normally.
  assert.equal(cosineSimilarity([0.1, null, 0.3], [0.1, 0.2, 0.3]), null);
  assert.equal(cosineSimilarity([0.1, 0.2, 0.3], [0.1, null, 0.3]), null);
  assert.equal(cosineSimilarity([0.1, NaN, 0.3], [0.1, 0.2, 0.3]), null);
  assert.equal(cosineSimilarity([0.1, undefined, 0.3], [0.1, 0.2, 0.3]), null);
  assert.equal(cosineSimilarity([0.1, '0.2', 0.3], [0.1, 0.2, 0.3]), null);
});

test('searchDocumentsSemantic ranks by cosine in JS, applies limit + cutoff, never leaks embeddings', async () => {
  const rows = [
    { id: 'near', title: 'Near', document_type: 'note', project_id: 'p1', tags: '["a"]', body: 'b', kind: 'source', verified: 1, status: 'active', embedding: JSON.stringify([1, 0]) },
    { id: 'far', title: 'Far', document_type: 'note', project_id: 'p1', tags: '[]', body: 'b', kind: 'source', verified: 0, status: 'active', embedding: JSON.stringify([0, 1]) },
    { id: 'close', title: 'Close', document_type: 'note', project_id: 'p1', tags: '[]', body: 'b', kind: 'source', verified: 0, status: 'active', embedding: JSON.stringify([0.9, 0.1]) },
    { id: 'broken', title: 'Broken', document_type: 'note', project_id: 'p1', tags: '[]', body: 'b', kind: 'source', verified: 0, status: 'active', embedding: 'not-json' },
  ];
  let seen;
  const db = { query: async (text, values) => { seen = { text, values }; return { rows }; } };
  const repo = createLibraryRepository(db);
  const docs = await repo.searchDocumentsSemantic([1, 0], 'fake', { minSimilarity: 0.45, topDrop: 0.20 });
  assert.deepEqual(seen.values, ['fake']);
  assert.deepEqual(docs.map((d) => d.id), ['near', 'close']);   // sorted desc, 'far'+'broken' dropped
  assert.ok(Math.abs(docs[0].similarity - 1) < 1e-9);           // similarity float rides along
  assert.deepEqual(docs[0].tags, ['a']);                        // tags parsed
  assert.equal(docs[0].verified, true);                         // 0/1 normalized
  for (const d of docs) {
    assert.ok(!('embedding' in d), 'embedding must never leave the repository');
  }
});

test('searchDocumentsSemantic honours the limit before the cutoff (pg parity)', async () => {
  const mk = (id, x, y) => ({ id, title: id, document_type: 'note', project_id: 'p1', tags: '[]', body: 'b', kind: 'source', verified: 0, status: 'active', embedding: JSON.stringify([x, y]) });
  const rows = [mk('a', 1, 0), mk('b', 0.99, 0.14), mk('c', 0.98, 0.2)];
  const db = { query: async () => ({ rows }) };
  const repo = createLibraryRepository(db);
  const docs = await repo.searchDocumentsSemantic([1, 0], 'fake', { limit: 2, minSimilarity: 0, topDrop: 1 });
  assert.deepEqual(docs.map((d) => d.id), ['a', 'b']);
});

test('buildListDocumentsNeedingEmbedding selects null/stale/mismatched rows', () => {
  const q = buildListDocumentsNeedingEmbedding('ollama');
  assert.match(q.text, /embedding is null/);
  assert.match(q.text, /embedded_hash is distinct from content_hash/);
  assert.match(q.text, /embedding_backend is distinct from \$1/);
  assert.match(q.text, /archived_at is null/);
  // No model given: the model clause is omitted so it can't compare against a
  // null and mark every row stale.
  assert.doesNotMatch(q.text, /embedding_model/);
  assert.deepEqual(q.values, ['ollama']);
});

test('buildListDocumentsNeedingEmbedding also re-embeds on a model change within a backend', () => {
  const q = buildListDocumentsNeedingEmbedding('openai', 'text-embedding-3-large');
  assert.match(q.text, /embedding_backend is distinct from \$1/);
  assert.match(q.text, /embedding_model is distinct from \$2/);
  assert.deepEqual(q.values, ['openai', 'text-embedding-3-large']);
});

test('buildListDocumentsNeedingEmbedding treats an empty model (llama.cpp default) as a real value to compare', () => {
  const q = buildListDocumentsNeedingEmbedding('llamacpp', '');
  assert.match(q.text, /embedding_model is distinct from \$2/);
  assert.deepEqual(q.values, ['llamacpp', '']);
});

test('buildSetDocumentEmbedding stores the vector as JSON text (no pg cast)', () => {
  const q = buildSetDocumentEmbedding('d1', { vector: [0.1, 0.2], backend: 'fake', model: 'm', dim: 2, contentHash: 'h' });
  assert.doesNotMatch(q.text, /::vector/);
  assert.match(q.text, /set embedding = \$2,/);
  assert.match(q.text, /embedded_at = strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/);
  assert.deepEqual(q.values, ['d1', JSON.stringify([0.1, 0.2]), 'fake', 'm', 2, 'h']);
  assert.deepEqual(JSON.parse(q.values[1]), [0.1, 0.2], 'stored text round-trips through JSON.parse');
});

test('buildSetDocumentEmbedding rejects non-finite or non-array vectors', () => {
  assert.throws(() => buildSetDocumentEmbedding('d1', { vector: '[0.1]', backend: 'fake', model: 'm', dim: 1, contentHash: 'h' }), /finite numbers/);
  assert.throws(() => buildSetDocumentEmbedding('d1', { vector: [0.1, NaN], backend: 'fake', model: 'm', dim: 2, contentHash: 'h' }), /finite numbers/);
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
    { id: 'b', similarity: 0.62 },
    { id: 'c', similarity: 0.40 },
  ];
  assert.deepEqual(applyRelevanceCutoff(rows, { minSimilarity: 0.45, topDrop: 0.20 }).map((r) => r.id), ['a', 'b']);
});

test('applyRelevanceCutoff handles empty input', () => {
  assert.deepEqual(applyRelevanceCutoff([], {}), []);
  assert.deepEqual(applyRelevanceCutoff(undefined, {}), []);
});

// Load-bearing security invariant: the embedding vector must NEVER reach a
// client. `buildGetDocument` (GET /api/library/documents/:id) is `select *`, so
// normalizeDocumentRow's explicit allowlist is the SOLE guard stripping the
// vector + embedding-tracking columns from every full-record read path. Lock it.
test('normalizeDocumentRow never leaks the embedding vector or tracking columns', () => {
  const row = {
    id: 'd1',
    title: 'Doc',
    body: 'body',
    document_type: 'note',
    project_id: 'p1',
    tags: ['a'],
    content_hash: 'h1',
    updated_by: 'user',
    kind: 'source',
    // columns that must never surface in a response:
    embedding: '[0.1,0.2,0.3]',
    embedding_backend: 'fake',
    embedding_model: 'fake-64',
    embedding_dim: 64,
    embedded_hash: 'h1',
    embedded_at: new Date('2026-06-03T00:00:00Z'),
  };
  const out = normalizeDocumentRow(row);
  const keys = Object.keys(out);
  for (const forbidden of ['embedding', 'embedding_backend', 'embedding_model', 'embedding_dim', 'embedded_hash', 'embedded_at']) {
    assert.ok(!(forbidden in out), `normalized row must not expose ${forbidden}`);
  }
  // No key contains the substring "embed" at all (camelCase or snake_case).
  assert.equal(keys.filter((k) => /embed/i.test(k)).length, 0, 'no embedding-related key may surface');
  // Sanity: the real document fields still come through.
  assert.equal(out.id, 'd1');
  assert.equal(out.body, 'body');
});

test('findSimilarDocuments ranks other docs by the target doc\'s own embedding, excluding self', async () => {
  const mk = (id, x, y) => ({ id, title: id, document_type: 'note', project_id: 'p1', tags: '[]', body: 'b', kind: 'source', verified: 0, status: 'active', embedding: JSON.stringify([x, y]) });
  const rows = [mk('self', 1, 0), mk('near', 0.95, 0.05), mk('far', 0, 1), mk('mid', 0.7, 0.3)];
  const db = { query: async () => ({ rows }) };
  const repo = createLibraryRepository(db);
  const docs = await repo.findSimilarDocuments('self', 'fake', { minSimilarity: 0.5, topDrop: 1, limit: 5 });
  assert.equal(docs.find((d) => d.id === 'self'), undefined);   // never suggests itself
  assert.deepEqual(docs.map((d) => d.id), ['near', 'mid']);      // ranked desc; 'far' below cutoff
  assert.ok(docs[0].similarity > docs[1].similarity);
  for (const d of docs) assert.ok(!('embedding' in d));
});

test('findSimilarDocuments returns [] when the target document has no embedding', async () => {
  const rows = [
    { id: 'other', title: 'Other', document_type: 'note', project_id: 'p1', tags: '[]', body: 'b', kind: 'source', verified: 0, status: 'active', embedding: JSON.stringify([1, 0]) },
  ];
  const db = { query: async () => ({ rows }) };
  const repo = createLibraryRepository(db);
  const docs = await repo.findSimilarDocuments('missing-id', 'fake', {});
  assert.deepEqual(docs, []);
});
