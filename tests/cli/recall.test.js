import test from 'node:test';
import assert from 'node:assert/strict';
import { recall, formatRecall, coverageNote, trustLabel } from '../../cli/lib/recall.js';

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
  assert.deepEqual(result, { kind: 'empty', query: 'nope', note: null, degraded: false, reason: null, index: null });
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
  const client = fakeClient({ semanticSearch: async () => { throw new Error('Prax not reachable at http://x'); } });
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
  assert.match(formatRecall(result), /Most recent 2 active document\(s\):/);
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
  assert.match(out, /## Top {2}\(note · t · unverified\)/);
  assert.match(out, /Related:/);
  assert.match(out, /- R1 — r1/);
});

// --- honesty: incomplete index, active-only recent, trust labels ----------------------

test('recall passes the limit to the paged semantic route and reads the object shape', async () => {
  let captured;
  const client = fakeClient({
    semanticSearch: async (project, q, opts) => { captured = { project, q, opts }; return { items: [{ id: 't', title: 'Top', verified: true, status: 'active' }], page: { returned: 1, total: 1, hasMore: false }, index: { total: 3, embedded: 3, pending: 0 }, degraded: false, reason: null }; },
    getDocument: async () => ({ id: 't', body: 'B', verified: true, status: 'active' }),
  });
  const result = await recall(client, { query: 'x', limit: 3 });
  assert.deepEqual(captured, { project: undefined, q: 'x', opts: { limit: 3 } });
  assert.equal(result.kind, 'hit');
  assert.equal(result.degraded, false);
  assert.equal(coverageNote(result), '');
  assert.match(formatRecall(result), /## Top {2}\(note · t · verified\)/);
});

test('an empty result on an incomplete index is disclosed, never presented as an honest miss', async () => {
  const client = fakeClient({
    semanticSearch: async () => ({ items: [], page: { returned: 0, total: 0, hasMore: false }, index: { total: 4, embedded: 1, pending: 3 }, degraded: true, reason: 'index-incomplete' }),
  });
  const result = await recall(client, { query: 'restore' });
  assert.equal(result.kind, 'empty');
  assert.equal(result.degraded, true);
  assert.equal(result.reason, 'index-incomplete');
  assert.deepEqual(result.index, { total: 4, embedded: 1, pending: 3 });
  assert.equal(
    formatRecall(result),
    'No relevant memory found for: "restore" (index incomplete: 3 of 4 documents have no current embedding — this may not be a true miss)',
  );
});

test('a hit on an incomplete index carries the coverage note above the block', async () => {
  const client = fakeClient({
    semanticSearch: async () => ({ items: [{ id: 't', title: 'Top' }], page: null, index: { total: 4, embedded: 3, pending: 1 }, degraded: true, reason: 'index-incomplete' }),
    getDocument: async () => ({ id: 't', body: 'B', verified: false, status: 'active' }),
  });
  const out = formatRecall(await recall(client, { query: 'x' }));
  assert.match(out, /^\(index incomplete: 1 of 4 documents have no current embedding — results may be missing\)\n## Top/);
});

test('recall --recent asks for active documents only and drops any retired row that slips through', async () => {
  let captured;
  const client = fakeClient({
    listDocuments: async (project, opts) => {
      captured = { project, opts };
      return [
        { id: 'old', title: 'Retired instruction', updatedAt: '2026-05-01', status: 'superseded', body: 'do the old thing' },
        { id: 'new', title: 'Current replacement', updatedAt: '2026-04-01', status: 'active', verified: true, body: 'do the new thing' },
      ];
    },
  });
  const result = await recall(client, { recent: true, project: 'memory' });
  assert.deepEqual(captured, { project: 'memory', opts: { status: 'active' } });
  assert.deepEqual(result.items.map((i) => i.id), ['new']);
  assert.match(formatRecall(result), /- Current replacement — new \(verified\) — do the new thing/);
});

test('trustLabel names verification and any non-active lifecycle status', () => {
  assert.equal(trustLabel({ verified: true, status: 'active' }), 'verified');
  assert.equal(trustLabel({ verified: false }), 'unverified');
  assert.equal(trustLabel({ verified: true, status: 'superseded' }), 'verified, superseded');
  assert.equal(trustLabel(null), '');
});
