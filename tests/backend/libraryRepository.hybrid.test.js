import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchDocumentsKeyword,
  ftsMatchExpression,
  createLibraryRepository,
} from '../../server/libraryRepository.js';

// --- the FTS half of the hybrid ------------------------------------------------

test('ftsMatchExpression ORs its terms so a natural-language query can match at all', () => {
  // AND is right for a listing filter and wrong for a ranking signal: under AND
  // "how do we publish a release" requires every word and matches nothing.
  assert.equal(ftsMatchExpression('restore backup'), '"restore"* OR "backup"*');
  // Non-Latin terms are terms (C15) — the tokenizer folds, the query must not drop them.
  assert.equal(ftsMatchExpression('バックアップ'), '"バックアップ"*');
  // A query with no usable term is not "match everything".
  assert.equal(ftsMatchExpression('  ??  '), null);
  assert.equal(ftsMatchExpression(''), null);
});

test('buildSearchDocumentsKeyword ranks by bm25 and applies the same lifecycle filters', () => {
  const q = buildSearchDocumentsKeyword('restore', {});
  assert.match(q.text, /join markdown_documents_fts on markdown_documents_fts\.rowid = d\.rowid/);
  assert.match(q.text, /markdown_documents_fts match \$1/);
  assert.match(q.text, /order by bm25\(markdown_documents_fts\)/);
  assert.match(q.text, /archived_at is null/);
  assert.match(q.text, /d\.status = 'active'/);
  // The ref contract travels on this path too.
  assert.match(q.text, /d\.updated_at/);
  assert.match(q.text, /d\.updated_by_agent/);
  assert.deepEqual(q.values, ['"restore"*']);
});

test('buildSearchDocumentsKeyword scopes to a project and can include retired rows', () => {
  const q = buildSearchDocumentsKeyword('restore', { projectId: 'p1', includeRetired: true });
  assert.doesNotMatch(q.text, /d\.status = 'active'/);
  assert.match(q.text, /d\.project_id = \$2/);
  assert.deepEqual(q.values, ['"restore"*', 'p1']);
});

test('buildSearchDocumentsKeyword returns null for a query with no usable term', () => {
  assert.equal(buildSearchDocumentsKeyword('???', {}), null);
});

// --- the fused repository method ----------------------------------------------

const row = (id, extra = {}) => ({
  id, title: id, body: 'b', document_type: 'note', project_id: 'p1', tags: '[]',
  kind: 'synthesized', updated_by: 'agent', updated_by_agent: 'codex',
  updated_at: '2026-09-10T00:00:00.000Z', verified: 0, status: 'active',
  revision: 'r', ...extra,
});

function fakeDb({ vectorRows = [], keywordRows = [] }) {
  const seen = [];
  return {
    db: {
      query: async (text) => {
        seen.push(text);
        if (/bm25/.test(text)) return { rows: keywordRows };
        if (/d\.embedding/.test(text)) return { rows: vectorRows };
        return { rows: [] };
      },
    },
    seen,
  };
}

test('searchDocumentsHybrid surfaces a keyword-only hit that has no usable vector', async () => {
  // The document the semantic path cannot see at all: no current embedding.
  const { db } = fakeDb({ vectorRows: [], keywordRows: [row('pending-vector')] });
  const repo = createLibraryRepository(db);
  const items = await repo.searchDocumentsHybrid([1, 0], 'restore', 'fake', { model: 'm' });
  assert.deepEqual(items.map((d) => d.id), ['pending-vector']);
  assert.equal(items[0].match.semanticRank, null);
  assert.equal(items[0].match.keywordRank, 1);
});

test('searchDocumentsHybrid prefers a document both rankings agree on', async () => {
  const { db } = fakeDb({
    vectorRows: [row('vec-only', { embedding: '[1,0]' }), row('agreed', { embedding: '[0.99,0.01]' })],
    keywordRows: [row('kw-only'), row('agreed')],
  });
  const repo = createLibraryRepository(db);
  const items = await repo.searchDocumentsHybrid([1, 0], 'restore', 'fake', { model: 'm' });
  assert.equal(items[0].id, 'agreed');
  assert.equal(items.length, 3);
});

test('searchDocumentsHybrid still works when the query has no usable FTS term', async () => {
  const { db, seen } = fakeDb({ vectorRows: [row('v', { embedding: '[1,0]' })], keywordRows: [row('never')] });
  const repo = createLibraryRepository(db);
  const items = await repo.searchDocumentsHybrid([1, 0], '???', 'fake', { model: 'm' });
  assert.deepEqual(items.map((d) => d.id), ['v']);
  assert.ok(!seen.some((t) => /bm25/.test(t)), 'no FTS query is issued for an unusable term');
});

test('searchDocumentsHybrid returns a paged envelope with the fused total', async () => {
  const { db } = fakeDb({
    vectorRows: [row('a', { embedding: '[1,0]' }), row('b', { embedding: '[0.9,0.1]' })],
    keywordRows: [row('c')],
  });
  const repo = createLibraryRepository(db);
  const res = await repo.searchDocumentsHybrid([1, 0], 'restore', 'fake', { model: 'm', page: true, limit: 2, offset: 0 });
  assert.equal(res.total, 3);
  assert.equal(res.items.length, 2);
});

// --- keyword relevance floor ---------------------------------------------------
//
// OR-matching admits every document containing "a". BM25 ranks them correctly
// (it weights by inverse document frequency), but recall must not present the
// tail of that ranking as a hit: a confidently wrong memory costs more than an
// honest miss. So the floor is a SCORE cutoff, not a term filter — a term
// filter cannot tell a rare function word from a rare content word.

test('keywordRelevanceCutoff keeps matches competitive with the best and drops the tail', () => {
  const repo = createLibraryRepository({ query: async () => ({ rows: [] }) });
  const rows = [
    { id: 'strong', bm25_score: -10 },
    { id: 'near', bm25_score: -8 },
    { id: 'weak', bm25_score: -1 },
  ];
  const kept = repo.keywordRelevanceCutoff(rows).map((r) => r.id);
  assert.deepEqual(kept, ['strong', 'near']);
});

test('keywordRelevanceCutoff passes rows through when no score is available', () => {
  const repo = createLibraryRepository({ query: async () => ({ rows: [] }) });
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(repo.keywordRelevanceCutoff(rows), rows);
});

test('keywordRelevanceCutoff is empty for no rows', () => {
  const repo = createLibraryRepository({ query: async () => ({ rows: [] }) });
  assert.deepEqual(repo.keywordRelevanceCutoff([]), []);
});

test('buildSearchDocumentsKeyword exposes the bm25 score it orders by', () => {
  const q = buildSearchDocumentsKeyword('restore', {});
  assert.match(q.text, /bm25\(markdown_documents_fts\) as bm25_score/);
});
