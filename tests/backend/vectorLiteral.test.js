import test from 'node:test';
import assert from 'node:assert/strict';
import { toVectorLiteral } from '../../server/vectorLiteral.js';

test('toVectorLiteral formats a pgvector literal', () => {
  assert.equal(toVectorLiteral([0.1, 0.2, -0.3]), '[0.1,0.2,-0.3]');
});

test('toVectorLiteral rejects non-arrays', () => {
  assert.throws(() => toVectorLiteral(null), /vector must be an array/);
  assert.throws(() => toVectorLiteral([1, 'x']), /vector must contain only finite numbers/);
});
