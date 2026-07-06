import test from 'node:test';
import assert from 'node:assert/strict';
import { PraxUnavailableError, PraxApiError } from '../../mcp/errors.js';

test('PraxUnavailableError carries a message and name', () => {
  const err = new PraxUnavailableError('api down');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'PraxUnavailableError');
  assert.equal(err.message, 'api down');
});

test('PraxApiError carries status and message', () => {
  const err = new PraxApiError(404, 'document not found');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'PraxApiError');
  assert.equal(err.status, 404);
  assert.equal(err.message, 'document not found');
});
