import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchDocumentsSemantic,
  buildListDocumentsNeedingEmbedding,
  normalizeDocumentRow,
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
