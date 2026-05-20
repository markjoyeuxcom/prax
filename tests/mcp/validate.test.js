import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidUuid } from '../../mcp/validate.js';

test('accepts a valid v4 UUID', () => {
  assert.equal(isValidUuid('11111111-1111-4111-8111-111111111111'), true);
});

test('rejects malformed strings', () => {
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(isValidUuid(''), false);
  assert.equal(isValidUuid(undefined), false);
});

test('rejects a UUID with an out-of-range version nibble', () => {
  assert.equal(isValidUuid('11111111-1111-6111-8111-111111111111'), false);
});
