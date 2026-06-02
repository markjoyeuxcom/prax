import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateDocument,
  buildUpdateDocument,
  normalizeDocumentRow,
} from '../../server/libraryRepository.js';

test('normalizeDocumentRow exposes kind', () => {
  const row = {
    id: '1', title: 't', body: 'b', document_type: 'note',
    project_id: 'p', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'synthesized',
  };
  assert.equal(normalizeDocumentRow(row).kind, 'synthesized');
});

test('buildCreateDocument defaults kind to source', () => {
  const q = buildCreateDocument({ title: 't', body: 'b', documentType: 'note', projectId: 'p', tags: [] });
  assert.ok(q.text.includes('kind'), 'sql mentions kind column');
  assert.equal(q.values[q.values.length - 1], 'source');
});

test('buildCreateDocument accepts explicit synthesized', () => {
  const q = buildCreateDocument({ title: 't', body: 'b', documentType: 'note', projectId: 'p', tags: [], kind: 'synthesized' });
  assert.equal(q.values[q.values.length - 1], 'synthesized');
});

test('buildUpdateDocument appends kind assignment when present', () => {
  const q = buildUpdateDocument('id-1', { title: 'new', kind: 'source' });
  assert.match(q.text, /kind = \$\d+/);
  assert.ok(q.values.includes('source'));
});

test('buildUpdateDocument omits kind assignment when not present', () => {
  const q = buildUpdateDocument('id-1', { title: 'new' });
  assert.doesNotMatch(q.text, /kind = \$/);
});
