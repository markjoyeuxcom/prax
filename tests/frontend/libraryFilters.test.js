import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDocumentsByTags, filterDocumentsByType, groupDocumentsByType, sortDocuments, tagsForDocuments, visibleTagsForFilter } from '../../public/js/libraryFilters.js';

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

const typedDocuments = [
  { id: 'r1', title: 'Alpha Runbook', documentType: 'runbook', updatedAt: '2026-01-03T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', tags: [] },
  { id: 'n1', title: 'Beta Note', documentType: 'note', updatedAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-02T00:00:00.000Z', tags: [] },
  { id: 'n2', title: 'Charlie Note', documentType: 'note', updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-03T00:00:00.000Z', tags: [] },
];

test('filterDocumentsByType returns all documents when type is all', () => {
  assert.deepEqual(filterDocumentsByType(typedDocuments, 'all').map(d => d.id), ['r1', 'n1', 'n2']);
});

test('filterDocumentsByType filters to runbooks only', () => {
  assert.deepEqual(filterDocumentsByType(typedDocuments, 'runbook').map(d => d.id), ['r1']);
});

test('filterDocumentsByType filters to notes only', () => {
  assert.deepEqual(filterDocumentsByType(typedDocuments, 'note').map(d => d.id), ['n1', 'n2']);
});

test('filterDocumentsByType treats unknown documentType as note', () => {
  const mixed = [{ id: 'x1', documentType: undefined, tags: [] }];
  assert.deepEqual(filterDocumentsByType(mixed, 'note').map(d => d.id), ['x1']);
  assert.deepEqual(filterDocumentsByType(mixed, 'runbook').map(d => d.id), []);
});

test('sortDocuments sorts by title ascending', () => {
  assert.deepEqual(sortDocuments(typedDocuments, 'title').map(d => d.id), ['r1', 'n1', 'n2']);
});

test('sortDocuments sorts by updated descending (newest first)', () => {
  assert.deepEqual(sortDocuments(typedDocuments, 'updated').map(d => d.id), ['r1', 'n1', 'n2']);
});

test('sortDocuments sorts by created descending (newest first)', () => {
  assert.deepEqual(sortDocuments(typedDocuments, 'created').map(d => d.id), ['n2', 'n1', 'r1']);
});

test('sortDocuments sorts by type then title', () => {
  assert.deepEqual(sortDocuments(typedDocuments, 'type').map(d => d.id), ['n1', 'n2', 'r1']);
});

test('sortDocuments does not mutate the original array', () => {
  const original = [...typedDocuments];
  sortDocuments(typedDocuments, 'title');
  assert.deepEqual(typedDocuments.map(d => d.id), original.map(d => d.id));
});

test('groupDocumentsByType groups into runbooks and notes preserving order', () => {
  const groups = groupDocumentsByType(typedDocuments);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].type, 'runbook');
  assert.deepEqual(groups[0].docs.map(d => d.id), ['r1']);
  assert.equal(groups[1].type, 'note');
  assert.deepEqual(groups[1].docs.map(d => d.id), ['n1', 'n2']);
});

test('groupDocumentsByType drops empty groups', () => {
  const onlyNotes = typedDocuments.filter(d => d.documentType === 'note');
  const groups = groupDocumentsByType(onlyNotes);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, 'note');
});

test('groupDocumentsByType treats unknown documentType as note', () => {
  const docs = [{ id: 'u1', documentType: undefined, tags: [] }];
  const groups = groupDocumentsByType(docs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, 'note');
});
