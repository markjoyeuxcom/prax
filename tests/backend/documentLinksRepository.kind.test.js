import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListStaleDocuments,
  buildListOrphanDocuments,
  normalizeStaleRow,
} from '../../server/documentLinksRepository.js';

test('buildListStaleDocuments selects d.kind', () => {
  const q = buildListStaleDocuments();
  assert.match(q.text, /d\.kind/);
});

test('normalizeStaleRow exposes kind', () => {
  const row = {
    id: '1', title: 't', document_type: 'note', project_id: 'p',
    updated_by: 'user', kind: 'synthesized', stale_sources: [],
  };
  assert.equal(normalizeStaleRow(row).kind, 'synthesized');
});

test('buildListOrphanDocuments selects d.kind', () => {
  const q = buildListOrphanDocuments();
  assert.match(q.text, /d\.kind/);
});
