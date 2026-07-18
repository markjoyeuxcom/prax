import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PAGE_SIZE,
  pageEnvelope,
  paginateResults,
  paginationInput,
} from '../../mcp/pagination.js';

test('paginateResults returns the default first page with exact continuation metadata', () => {
  const result = paginateResults(Array.from({ length: 25 }, (_, i) => i));
  assert.deepEqual(result.items, Array.from({ length: 20 }, (_, i) => i));
  assert.deepEqual(result.page, {
    offset: 0, limit: 20, returned: 20, total: 25, hasMore: true, nextOffset: 20,
  });
  assert.equal(result.schemaVersion, 1);
});

test('paginateResults returns later and final pages without overlap', () => {
  const values = Array.from({ length: 25 }, (_, i) => i);
  const middle = paginateResults(values, { limit: 7, offset: 14 });
  assert.deepEqual(middle.items, [14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(middle.page, {
    offset: 14, limit: 7, returned: 7, total: 25, hasMore: true, nextOffset: 21,
  });

  const final = paginateResults(values, { limit: 7, offset: middle.page.nextOffset });
  assert.deepEqual(final.items, [21, 22, 23, 24]);
  assert.deepEqual(final.page, {
    offset: 21, limit: 7, returned: 4, total: 25, hasMore: false, nextOffset: null,
  });
});

test('pagination is bounded defensively and non-arrays become an honest empty page', () => {
  const values = Array.from({ length: 75 }, (_, i) => i);
  const bounded = paginateResults(values, { limit: 500, offset: -5 });
  assert.equal(bounded.items.length, MAX_PAGE_SIZE);
  assert.equal(bounded.page.limit, MAX_PAGE_SIZE);
  assert.equal(bounded.page.offset, 0);

  assert.deepEqual(paginateResults(null), pageEnvelope([], 0));
});

test('pagination input schemas enforce integer bounds', () => {
  const schema = paginationInput();
  assert.equal(schema.limit.safeParse(undefined).success, true);
  assert.equal(schema.limit.safeParse(1).success, true);
  assert.equal(schema.limit.safeParse(MAX_PAGE_SIZE).success, true);
  assert.equal(schema.limit.safeParse(0).success, false);
  assert.equal(schema.limit.safeParse(MAX_PAGE_SIZE + 1).success, false);
  assert.equal(schema.offset.safeParse(0).success, true);
  assert.equal(schema.offset.safeParse(-1).success, false);
  assert.equal(schema.offset.safeParse(1.5).success, false);
});

// Regressions (2026-07-18 review): the cursor contract.
test('an empty page never advances the cursor (no infinite loop for agents)', () => {
  const page = pageEnvelope([], 50, { limit: 20, offset: 10 });
  assert.equal(page.page.hasMore, false);
  assert.equal(page.page.nextOffset, null);
});
