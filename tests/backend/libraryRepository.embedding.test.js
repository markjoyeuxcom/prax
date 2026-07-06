import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchDocumentsSemantic,
  buildListDocumentsNeedingEmbedding,
  buildSetDocumentEmbedding,
  createLibraryRepository,
  normalizeDocumentRow,
  applyRelevanceCutoff,
} from '../../server/libraryRepository.js';

// The embedded-SQLite build has no vector operator: the semantic-search SQL
// builder is a stub that must throw before emitting any SQL. The routes map
// this to their existing 409/503 "unavailable" degradation.
test('buildSearchDocumentsSemantic throws — no vector backend in the SQLite build', () => {
  assert.throws(
    () => buildSearchDocumentsSemantic('[0.1,0.2]', 'ollama', { limit: 5 }),
    /semantic search requires a vector backend/,
  );
});

test('searchDocumentsSemantic (repository) surfaces the unavailable signal without touching the db', async () => {
  let queried = false;
  const db = { query: async () => { queried = true; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await assert.rejects(
    () => repo.searchDocumentsSemantic('[0.1]', 'ollama', {}),
    /semantic search requires a vector backend/,
  );
  assert.equal(queried, false, 'must throw before issuing SQL');
});

test('buildListDocumentsNeedingEmbedding selects null/stale/mismatched rows', () => {
  const q = buildListDocumentsNeedingEmbedding('ollama');
  assert.match(q.text, /embedding is null/);
  assert.match(q.text, /embedded_hash is distinct from content_hash/);
  assert.match(q.text, /embedding_backend is distinct from \$1/);
  assert.match(q.text, /archived_at is null/);
  assert.deepEqual(q.values, ['ollama']);
});

test('buildSetDocumentEmbedding stores the vector as plain text (no pg cast)', () => {
  const q = buildSetDocumentEmbedding('d1', { literal: '[0.1,0.2]', backend: 'fake', model: 'm', dim: 2, contentHash: 'h' });
  assert.doesNotMatch(q.text, /::vector/);
  assert.match(q.text, /set embedding = \$2,/);
  assert.match(q.text, /embedded_at = strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/);
  assert.deepEqual(q.values, ['d1', '[0.1,0.2]', 'fake', 'm', 2, 'h']);
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
