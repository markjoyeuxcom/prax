import test from 'node:test';
import assert from 'node:assert/strict';
import { recall, formatRecall } from '../../cli/lib/recall.js';

const fakeClient = (overrides = {}) => ({
  semanticSearch: async () => [],
  keywordSearch: async () => [],
  getDocument: async () => ({}),
  listDocuments: async () => [],
  ...overrides,
});

test('recall returns a hit with the top body fetched and related preserved', async () => {
  const refs = [
    { id: 't', title: 'Top', documentType: 'note' },
    { id: 'r1', title: 'R1' }, { id: 'r2', title: 'R2' },
  ];
  const client = fakeClient({
    semanticSearch: async (project) => { assert.equal(project, undefined); return refs; },
    getDocument: async (id) => { assert.equal(id, 't'); return { id: 't', body: 'FULL BODY' }; },
  });
  const result = await recall(client, { query: 'x', limit: 5 });
  assert.equal(result.kind, 'hit');
  assert.equal(result.top.body, 'FULL BODY');
  assert.deepEqual(result.related.map((r) => r.id), ['r1', 'r2']);
});

test('recall reports an honest miss on empty semantic results', async () => {
  const result = await recall(fakeClient(), { query: 'nope' });
  assert.deepEqual(result, { kind: 'empty', query: 'nope', note: null });
  assert.equal(formatRecall(result), 'No relevant memory found for: "nope"');
});

test('recall falls back to keyword search on a 409 (semantic disabled)', async () => {
  const client = fakeClient({
    semanticSearch: async () => { const e = new Error('semantic search is not enabled'); e.status = 409; throw e; },
    keywordSearch: async () => [{ id: 'k', title: 'Kw', documentType: 'runbook', body: 'b' }],
  });
  const result = await recall(client, { query: 'x' });
  assert.equal(result.kind, 'hit');
  assert.equal(result.note, 'semantic search disabled — keyword results');
  assert.match(formatRecall(result), /\(semantic search disabled — keyword results\)/);
});

test('recall rethrows non-409 errors (e.g. not reachable)', async () => {
  const client = fakeClient({ semanticSearch: async () => { throw new Error('Moomora not reachable at http://x'); } });
  await assert.rejects(recall(client, { query: 'x' }), /not reachable/);
});

test('recall --recent lists most-recent docs sorted by updatedAt desc', async () => {
  const client = fakeClient({
    listDocuments: async () => [
      { id: 'a', title: 'A', updatedAt: '2026-01-01', body: 'aa' },
      { id: 'b', title: 'B', updatedAt: '2026-03-01', body: 'bb' },
    ],
  });
  const result = await recall(client, { recent: true, limit: 5 });
  assert.equal(result.kind, 'recent');
  assert.deepEqual(result.items.map((i) => i.id), ['b', 'a']);
  assert.match(formatRecall(result), /Most recent 2 document\(s\):/);
});

test('formatRecall trims the hit body to 800 chars with an ellipsis', () => {
  const big = 'x'.repeat(900);
  const out = formatRecall({ kind: 'hit', note: null, top: { id: 't', title: 'T', documentType: 'note', body: big }, related: [] });
  assert.ok(out.includes('…'));
  assert.ok(out.length < 900);
});

test('formatRecall renders the Related list for hits', () => {
  const out = formatRecall({
    kind: 'hit', note: null,
    top: { id: 't', title: 'Top', documentType: 'note', body: 'b' },
    related: [{ id: 'r1', title: 'R1' }],
  });
  assert.match(out, /## Top {2}\(note · t\)/);
  assert.match(out, /Related:/);
  assert.match(out, /- R1 — r1/);
});
