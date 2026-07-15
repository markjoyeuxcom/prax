import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { confirmDocumentVerification, verificationPhrase } from '../../cli/lib/verify.js';

const DOC = { id: '12345678-1234-4234-8234-123456789012', title: 'Reviewed' };

test('verification phrase is bound to the document id', () => {
  assert.equal(verificationPhrase(DOC.id), 'VERIFY 12345678');
});

test('verification refuses non-interactive streams and missing attribution', async () => {
  await assert.rejects(() => confirmDocumentVerification({
    document: DOC, actor: 'Maya', input: new PassThrough(), output: new PassThrough(),
  }), /attended interactive terminal/);

  const input = new PassThrough(); input.isTTY = true;
  const output = new PassThrough(); output.isTTY = true;
  await assert.rejects(() => confirmDocumentVerification({
    document: DOC, actor: '', input, output,
  }), /requires --as/);
});

test('verification requires the exact document-specific phrase', async () => {
  const input = new PassThrough(); input.isTTY = true;
  const output = new PassThrough(); output.isTTY = true;
  input.end('VERIFY 12345678\n');
  await confirmDocumentVerification({ document: DOC, actor: 'Maya', input, output });

  const wrong = new PassThrough(); wrong.isTTY = true;
  const output2 = new PassThrough(); output2.isTTY = true;
  wrong.end('verify\n');
  await assert.rejects(() => confirmDocumentVerification({
    document: DOC, actor: 'Maya', input: wrong, output: output2,
  }), /verification cancelled/);
});
