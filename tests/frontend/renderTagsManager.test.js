import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTagsManagerHtml, buildTagsManagerModel, TAG_TABLE_LIMIT } from '../../public/js/renderTagsManager.js';

const documents = [
  { id: '1', tags: ['postgres', 'backup'], updatedAt: '2026-10-01T00:00:00Z' },
  { id: '2', tags: ['postgresql'], updatedAt: '2026-10-07T00:00:00Z', updatedBy: 'agent' },
  { id: '3', tags: ['backups', '<b>x</b>'], updatedAt: '2026-10-03T00:00:00Z', updatedBy: 'agent' },
];

test('the Tags page lists usage, suggests merges, and offers the filters with counts', () => {
  const html = renderTagsManagerHtml({ documents, tagsFilter: 'all' });
  assert.match(html, /<h1 class="page-head__title">Tags<\/h1>/);
  assert.match(html, /data-action="merge-tags" data-into="postgres" data-from="postgresql"/);
  assert.match(html, /data-action="merge-tags" data-into="backup" data-from="backups"/);
  assert.match(html, /data-action="set-tags-filter" data-filter="duplicates" aria-pressed="false">Possible duplicates <span class="tag-filter__n">4</);
  assert.match(html, /data-action="filter-by-tag" data-tag="postgres"/);
  assert.match(html, /normalised on save/);
  assert.doesNotMatch(html, /<b>x<\/b>/, 'tag text is escaped');
});

test('filters and the find box narrow the table; long tables fold', () => {
  const once = buildTagsManagerModel({ documents, tagsFilter: 'once' });
  assert.ok(once.rows.every((row) => row.count === 1));
  const found = buildTagsManagerModel({ documents, tagsQuery: '#post' });
  assert.deepEqual(found.rows.map((row) => row.tag).sort(), ['postgres', 'postgresql']);
  const many = Array.from({ length: TAG_TABLE_LIMIT + 5 }, (_, i) => ({ id: `d${i}`, tags: [`tag-${i}`] }));
  const folded = buildTagsManagerModel({ documents: many });
  assert.equal(folded.rows.length, TAG_TABLE_LIMIT);
  assert.equal(folded.hiddenRows, 5);
  assert.match(renderTagsManagerHtml({ documents: many }), /data-action="tags-show-all">Show 5 more/);
  assert.equal(buildTagsManagerModel({ documents: many, tagsShowAll: true }).rows.length, TAG_TABLE_LIMIT + 5);
});
