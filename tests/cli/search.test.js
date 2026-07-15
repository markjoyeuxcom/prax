import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLibrary } from '../../cli/lib/search.js';

test('search returns a versioned semantic envelope on success', async () => {
  const result = await searchLibrary({
    semanticSearch: async () => [{ id: 'd1' }],
  }, { project: 'p', query: 'restore' });
  assert.deepEqual(result, {
    schemaVersion: 1,
    retrieval: { mode: 'semantic', degraded: false, reason: null },
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
    mode: 'keyword', degraded: true, reason: 'semantic-not-configured',
  });

  const outage = Object.assign(new Error('backend down'), { status: 503 });
  await assert.rejects(() => searchLibrary({
    semanticSearch: async () => { throw outage; },
    keywordSearch: async () => { throw new Error('must not run'); },
  }, { query: 'x' }), /backend down/);
});
