import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDocumentsByTags, tagsForDocuments } from '../../public/js/libraryFilters.js';

const documents = [
  { id: 'doc-1', title: 'Cloudflare Tunnel', tags: ['Cloudflare', 'Tunnel', 'Homelab'] },
  { id: 'doc-2', title: 'Cloudflare Access', tags: ['cloudflare', 'Security'] },
  { id: 'doc-3', title: 'CNPG Restore', tags: ['postgres', 'homelab'] },
  { id: 'doc-4', title: 'Scratch', tags: [] },
];

test('tagsForDocuments returns normalized tag counts sorted by tag', () => {
  assert.deepEqual(tagsForDocuments(documents), [
    { tag: 'cloudflare', count: 2 },
    { tag: 'homelab', count: 2 },
    { tag: 'postgres', count: 1 },
    { tag: 'security', count: 1 },
    { tag: 'tunnel', count: 1 },
  ]);
});

test('filterDocumentsByTags returns documents matching every selected tag', () => {
  assert.deepEqual(
    filterDocumentsByTags(documents, ['cloudflare']).map(document => document.id),
    ['doc-1', 'doc-2'],
  );
  assert.deepEqual(
    filterDocumentsByTags(documents, ['cloudflare', 'tunnel']).map(document => document.id),
    ['doc-1'],
  );
});

test('filterDocumentsByTags returns all documents when no tags are selected', () => {
  assert.deepEqual(filterDocumentsByTags(documents, []).map(document => document.id), [
    'doc-1',
    'doc-2',
    'doc-3',
    'doc-4',
  ]);
});
