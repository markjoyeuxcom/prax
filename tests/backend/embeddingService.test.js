import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingService, embeddableText } from '../../server/embeddingService.js';
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

test('embedDocument never throws when a dependency rejects, returns false', async () => {
  const repo = fakeRepo([{ id: 'a', body: 'boom', contentHash: 'h1' }]);
  const throwingEmbedder = {
    backend: 'fake',
    async embed() { throw new Error('embed exploded'); },
    async isAvailable() { return true; },
  };
  const errors = [];
  const svc = createEmbeddingService({
    repository: repo,
    embedder: throwingEmbedder,
    logger: { error: (...args) => errors.push(args) },
  });
  const result = await svc.embedDocument('a');
  assert.equal(result, false);
  assert.equal(repo.stored.length, 0);
  assert.equal(errors.length, 1);
});

test('embeddableText joins title + body and tolerates missing parts', () => {
  assert.equal(embeddableText({ title: 'T', body: 'B' }), 'T\n\nB');
  assert.equal(embeddableText({ body: 'B' }), 'B');
  assert.equal(embeddableText({ title: 'T' }), 'T');
  assert.equal(embeddableText({}), '');
});

test('embedOne embeds the title + body, not just the body', async () => {
  const seen = [];
  const recordingEmbedder = {
    backend: 'rec',
    async embed(text) { seen.push(text); return { vector: [0.1], model: 'rec', dim: 1 }; },
    async isAvailable() { return true; },
  };
  const docs = [{ id: 'a', title: 'Postgres restore', body: 'replay WAL', contentHash: 'h1' }];
  const repo = fakeRepo(docs);
  const svc = createEmbeddingService({ repository: repo, embedder: recordingEmbedder });
  await svc.embedDocument('a');
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Postgres restore/);
  assert.match(seen[0], /replay WAL/);
});

test('reindex force embeds all docs (listDocuments), not just the needs set', async () => {
  const docs = [
    { id: 'a', title: 'A', body: 'one', contentHash: 'h1' },
    { id: 'b', title: 'B', body: 'two', contentHash: 'h2' },
  ];
  const repo = {
    ...fakeRepo(docs),
    listDocumentsNeedingEmbedding: async () => [],
    listDocuments: async () => docs,
  };
  const svc = createEmbeddingService({ repository: repo, embedder: createFakeEmbedder({ dim: 8 }) });
  assert.equal((await svc.reindex()).embedded, 0);
  assert.equal((await svc.reindex({ force: true })).embedded, 2);
});

test('reindex isolates failures: one bad doc counts as failed, the rest embed', async () => {
  const docs = [
    { id: 'a', body: 'one', contentHash: 'h1' },
    { id: 'b', body: 'two', contentHash: 'h2' },
  ];
  const repo = fakeRepo(docs);
  const fake = createFakeEmbedder({ dim: 8 });
  const flakyEmbedder = {
    backend: 'fake',
    async embed(text) {
      if (text === 'two') throw new Error('embed exploded');
      return fake.embed(text);
    },
    async isAvailable() { return true; },
  };
  const errors = [];
  const svc = createEmbeddingService({
    repository: repo,
    embedder: flakyEmbedder,
    logger: { error: (...args) => errors.push(args) },
  });
  const result = await svc.reindex();
  assert.equal(result.embedded, 1);
  assert.equal(result.failed, 1);
  assert.equal(repo.stored.length, 1);
  assert.equal(repo.stored[0].id, 'a');
  assert.equal(errors.length, 1);
});
