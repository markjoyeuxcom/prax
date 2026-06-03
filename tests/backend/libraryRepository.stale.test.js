import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentRow } from '../../server/libraryRepository.js';

test('normalizeDocumentRow exposes stale=false when column absent', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'source',
  };
  assert.equal(normalizeDocumentRow(row).stale, false);
});

test('normalizeDocumentRow exposes stale=true when column true', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'source', stale: true,
  };
  assert.equal(normalizeDocumentRow(row).stale, true);
});

test('normalizeDocumentRow exposes stale=false when column false', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'h', updated_by: 'user', kind: 'source', stale: false,
  };
  assert.equal(normalizeDocumentRow(row).stale, false);
});
