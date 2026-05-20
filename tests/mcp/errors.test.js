import test from 'node:test';
import assert from 'node:assert/strict';
import { MoomoraUnavailableError, MoomoraApiError } from '../../mcp/errors.js';

test('MoomoraUnavailableError carries a message and name', () => {
  const err = new MoomoraUnavailableError('api down');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'MoomoraUnavailableError');
  assert.equal(err.message, 'api down');
});

test('MoomoraApiError carries status and message', () => {
  const err = new MoomoraApiError(404, 'document not found');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'MoomoraApiError');
  assert.equal(err.status, 404);
  assert.equal(err.message, 'document not found');
});
