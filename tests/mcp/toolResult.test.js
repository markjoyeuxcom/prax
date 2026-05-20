import test from 'node:test';
import assert from 'node:assert/strict';
import { okResult, errorResult, withErrorHandling } from '../../mcp/toolResult.js';
import { MoomoraApiError, MoomoraUnavailableError } from '../../mcp/errors.js';

test('okResult serializes data as JSON text', () => {
  const res = okResult({ a: 1 });
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].type, 'text');
  assert.deepEqual(JSON.parse(res.content[0].text), { a: 1 });
});

test('errorResult marks isError and carries the message', () => {
  const res = errorResult('boom');
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, 'boom');
});

test('withErrorHandling maps MoomoraApiError to an error result', async () => {
  const wrapped = withErrorHandling(async () => {
    throw new MoomoraApiError(404, 'document not found');
  });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, 'document not found');
});

test('withErrorHandling maps MoomoraUnavailableError to an error result', async () => {
  const wrapped = withErrorHandling(async () => {
    throw new MoomoraUnavailableError('api down');
  });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, 'api down');
});

test('withErrorHandling wraps unexpected errors', async () => {
  const wrapped = withErrorHandling(async () => {
    throw new Error('weird');
  });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Unexpected error: weird/);
});

test('withErrorHandling tolerates a non-Error throw', async () => {
  const wrapped = withErrorHandling(async () => { throw 'oops'; });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Unexpected error: oops/);
});

test('withErrorHandling tolerates a null throw', async () => {
  const wrapped = withErrorHandling(async () => { throw null; });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Unexpected error: null/);
});

test('withErrorHandling passes through successful results', async () => {
  const wrapped = withErrorHandling(async ({ n }) => okResult({ n }));
  const res = await wrapped({ n: 7 });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0].text), { n: 7 });
});
