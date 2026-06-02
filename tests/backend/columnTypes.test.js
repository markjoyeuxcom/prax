import test from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../../server/columnTypes.js';

test('toIso converts a Date to an ISO 8601 string', () => {
  const out = toIso(new Date('2026-06-02T19:47:21.123Z'));
  assert.equal(out, '2026-06-02T19:47:21.123Z');
});

test('toIso passes null and undefined through unchanged', () => {
  assert.equal(toIso(null), null);
  assert.equal(toIso(undefined), undefined);
});

test('toIso passes a string through unchanged', () => {
  assert.equal(toIso('2026-04-12T10:33:21.000Z'), '2026-04-12T10:33:21.000Z');
  assert.equal(toIso('not even a date'), 'not even a date');
});
