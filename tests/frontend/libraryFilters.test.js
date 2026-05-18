import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDocumentsByTags, tagsForDocuments, visibleTagsForFilter } from '../../public/js/libraryFilters.js';

const documents = [
  { id: 'doc-1', title: 'Cloudflare Tunnel', tags: ['Cloudflare', 'Tunnel', 'Homelab'] },
  { id: 'doc-2', title: 'Cloudflare Access', tags: ['cloudflare', 'Security'] },
  { id: 'doc-3', title: 'CNPG Restore', tags: ['postgres', 'homelab'] },
  { id: 'doc-4', title: 'Scratch', tags: [] },
];

test('tagsForDocuments returns normalized tag counts sorted by usage then tag', () => {
  assert.deepEqual(tagsForDocuments(documents), [
    { tag: 'cloudflare', count: 2 },
    { tag: 'homelab', count: 2 },
    { tag: 'postgres', count: 1 },
    { tag: 'security', count: 1 },
    { tag: 'tunnel', count: 1 },
  ]);
});

test('tagsForDocuments sorts higher usage before alphabetical order', () => {
  assert.deepEqual(tagsForDocuments([
    { tags: ['zeta'] },
    { tags: ['alpha'] },
    { tags: ['zeta'] },
  ]), [
    { tag: 'zeta', count: 2 },
    { tag: 'alpha', count: 1 },
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

test('visibleTagsForFilter searches tags and keeps selected tags pinned', () => {
  const tags = [
    { tag: 'cloudflare', count: 8 },
    { tag: 'kubernetes', count: 5 },
    { tag: 'postgres', count: 3 },
  ];

  assert.deepEqual(visibleTagsForFilter(tags, ['postgres'], 'cloud'), {
    hiddenCount: 0,
    visibleTags: [
      { tag: 'postgres', count: 3, isPinned: true },
      { tag: 'cloudflare', count: 8, isPinned: false },
    ],
  });
});

test('visibleTagsForFilter collapses long tag sets until expanded', () => {
  const tags = Array.from({ length: 14 }, (_, index) => ({
    tag: `tag-${String(index + 1).padStart(2, '0')}`,
    count: 1,
  }));

  assert.deepEqual(visibleTagsForFilter(tags, [], '', { limit: 12, isExpanded: false }), {
    hiddenCount: 2,
    visibleTags: tags.slice(0, 12).map(tag => ({ ...tag, isPinned: false })),
  });
  assert.deepEqual(visibleTagsForFilter(tags, [], '', { limit: 12, isExpanded: true }), {
    hiddenCount: 0,
    visibleTags: tags.map(tag => ({ ...tag, isPinned: false })),
  });
});
