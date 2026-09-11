// Recall tells an agent when a memory's cited code has moved on.
//
// This is the point of code-pinned memory: not that a citation is stored, but
// that retrieval can say "this claim was written about code that has since
// changed" without anyone having noticed. Checking happens client-side because
// only a working tree can answer it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { recall, formatRecall } from '../../cli/lib/recall.js';
import { hashCitation } from '../../cli/lib/codeRefs.js';

const NOW = new Date('2026-09-11T12:00:00Z');
const CODE = ['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n');

const client = ({ citations = [], ...over } = {}) => ({
  semanticSearch: async () => ({ items: [{ id: 't', title: 'Bind rule', documentType: 'decision' }], page: null, index: null, degraded: false, reason: null }),
  getDocument: async () => ({ id: 't', body: 'A non-loopback bind needs acknowledgement.', verified: false, status: 'active', updatedAt: '2026-09-10T12:00:00Z' }),
  keywordSearch: async () => [],
  listDocuments: async () => [],
  listCodeRefs: async () => citations,
  ...over,
});

test('a memory whose cited code is unchanged carries no warning', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 2, contentHash: hashCitation('const a = 1;\nconst b = 2;') }];
  const result = await recall(client({ citations }), { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations.map((c) => c.status), ['current']);
  assert.doesNotMatch(formatRecall(result, NOW), /changed since/);
});

test('a memory whose cited code changed is flagged in the hit header', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 2, contentHash: hashCitation('WHAT IT USED TO SAY') }];
  const result = await recall(client({ citations }), { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations.map((c) => c.status), ['changed']);
  assert.match(formatRecall(result, NOW), /server\/config\.js changed since this was written/);
});

test('code that merely moved is reported without crying stale', async () => {
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, contentHash: hashCitation('const c = 3;') }];
  const out = formatRecall(await recall(client({ citations }), { query: 'bind', readFile: () => CODE }), NOW);
  assert.match(out, /moved to server\/config\.js:3-3/);
  assert.doesNotMatch(out, /changed since/);
});

test('a deleted cited file is reported as gone', async () => {
  const citations = [{ id: 'r', path: 'server/gone.js', startLine: 1, endLine: 1, contentHash: hashCitation('x') }];
  const out = formatRecall(await recall(client({ citations }), { query: 'bind', readFile: () => null }), NOW);
  assert.match(out, /server\/gone\.js is gone/);
});

test('with no working tree to check against, nothing is claimed either way', async () => {
  // Recalling from outside the repository must not imply the memory is fine,
  // and must not imply it has rotted.
  const citations = [{ id: 'r', path: 'server/config.js', startLine: 1, endLine: 1, contentHash: hashCitation('x') }];
  const result = await recall(client({ citations }), { query: 'bind' }); // no readFile
  assert.deepEqual(result.top.citations, []);
  assert.doesNotMatch(formatRecall(result, NOW), /changed since|is gone/);
});

test('a memory with no citations behaves exactly as before', async () => {
  const result = await recall(client({ citations: [] }), { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations, []);
  assert.match(formatRecall(result, NOW), /## Bind rule/);
});

test('a server with no citation support does not break recall', async () => {
  const c = client({ listCodeRefs: async () => { throw Object.assign(new Error('not found'), { status: 404 }); } });
  const result = await recall(c, { query: 'bind', readFile: () => CODE });
  assert.deepEqual(result.top.citations, []);
  assert.equal(result.kind, 'hit');
});
