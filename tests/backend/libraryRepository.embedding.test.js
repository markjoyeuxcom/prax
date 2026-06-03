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
