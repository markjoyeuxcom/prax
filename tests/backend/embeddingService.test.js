import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingService } from '../../server/embeddingService.js';
import { createFakeEmbedder } from '../../server/embedder/fake.js';

function fakeRepo(docs) {
  const stored = [];
  return {
    stored,
    async getDocument(id) { return docs.find((d) => d.id === id) || null; },
    async setDocumentEmbedding(id, payload) { stored.push({ id, ...payload }); return id; },
    async listDocumentsNeedingEmbedding() { return docs.map((d) => ({ id: d.id, contentHash: d.contentHash })); },
  };
}

test('embedDocument stores a vector literal with tracking fields', async () => {
  const docs = [{ id: 'a', body: 'hello', contentHash: 'h1' }];
  const repo = fakeRepo(docs);
  const svc = createEmbeddingService({ repository: repo, embedder: createFakeEmbedder({ dim: 8 }) });
  await svc.embedDocument('a');
  assert.equal(repo.stored.length, 1);
  const s = repo.stored[0];
  assert.equal(s.id, 'a');
  assert.match(s.literal, /^\[.*\]$/);
  assert.equal(s.backend, 'fake');
  assert.equal(s.dim, 8);
  assert.equal(s.contentHash, 'h1');
});

test('embedDocument is a no-op when no embedder', async () => {
  const repo = fakeRepo([{ id: 'a', body: 'x', contentHash: 'h' }]);
  const svc = createEmbeddingService({ repository: repo, embedder: null });
  await svc.embedDocument('a');
  assert.equal(repo.stored.length, 0);
});

test('reindex embeds all docs needing it and returns counts', async () => {
  const docs = [
    { id: 'a', body: 'one', contentHash: 'h1' },
    { id: 'b', body: 'two', contentHash: 'h2' },
  ];
  const repo = fakeRepo(docs);
  const svc = createEmbeddingService({ repository: repo, embedder: createFakeEmbedder({ dim: 8 }) });
  const result = await svc.reindex();
  assert.equal(result.embedded, 2);
  assert.equal(repo.stored.length, 2);
});

test('reindex is a no-op without an embedder', async () => {
  const repo = fakeRepo([{ id: 'a', body: 'x', contentHash: 'h' }]);
  const svc = createEmbeddingService({ repository: repo, embedder: null });
  const result = await svc.reindex();
  assert.equal(result.embedded, 0);
});
