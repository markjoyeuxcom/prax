import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLibrary, describeRetrieval } from '../../cli/lib/search.js';

test('search returns a versioned semantic envelope on success', async () => {
  const result = await searchLibrary({
    semanticSearch: async () => [{ id: 'd1' }],
  }, { project: 'p', query: 'restore' });
  assert.deepEqual(result, {
    schemaVersion: 1,
    retrieval: { mode: 'semantic', degraded: false, reason: null, index: null, page: null },
    items: [{ id: 'd1' }],
  });
});

test('search explicitly falls back only for semantic-not-configured (409)', async () => {
  let keywordCalls = 0;
  const unavailable = Object.assign(new Error('not configured'), { status: 409 });
  const result = await searchLibrary({
    semanticSearch: async () => { throw unavailable; },
    keywordSearch: async () => { keywordCalls += 1; return [{ id: 'd2' }]; },
  }, { project: 'p', query: 'restore', all: true });
  assert.equal(keywordCalls, 1);
  assert.deepEqual(result.retrieval, {
    mode: 'keyword', degraded: true, reason: 'semantic-not-configured', index: null, page: null,
  });

  const outage = Object.assign(new Error('backend down'), { status: 503 });
  await assert.rejects(() => searchLibrary({
    semanticSearch: async () => { throw outage; },
    keywordSearch: async () => { throw new Error('must not run'); },
  }, { query: 'x' }), /backend down/);
});

test('search preserves index coverage and page bounds from the paged semantic response', async () => {
  const result = await searchLibrary({
    semanticSearch: async () => ({
      items: [{ id: 'd1' }],
      page: { offset: 0, limit: 50, returned: 1, total: 60, hasMore: true, nextOffset: 1 },
      index: { total: 10, embedded: 8, pending: 2 },
      degraded: true,
      reason: 'index-incomplete',
    }),
  }, { project: 'p', query: 'restore' });
  assert.equal(result.retrieval.mode, 'semantic');
  assert.equal(result.retrieval.degraded, true);
  assert.equal(result.retrieval.reason, 'index-incomplete');
  assert.deepEqual(result.retrieval.index, { total: 10, embedded: 8, pending: 2 });
  assert.equal(result.retrieval.page.hasMore, true);
  assert.equal(
    describeRetrieval(result.retrieval),
    'Note: the semantic index is incomplete (2 of 10 documents have no current embedding); results may be missing.\n'
    + 'Note: showing the first 1 of 60 matches.',
  );
  assert.equal(describeRetrieval({ mode: 'semantic', degraded: false, reason: null, index: null, page: null }), '');
  assert.equal(describeRetrieval({ mode: 'keyword', degraded: true, reason: 'semantic-not-configured' }), 'Note: semantic search is not configured; showing keyword results.');
});
