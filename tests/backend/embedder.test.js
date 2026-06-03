import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEmbedder } from '../../server/embedder/fake.js';
import { createOllamaEmbedder } from '../../server/embedder/ollama.js';
import { createEmbedder } from '../../server/embedder/index.js';

const ISOish = /^\d/;

test('fake embedder is deterministic and fixed-dimension', async () => {
  const e = createFakeEmbedder({ dim: 16 });
  const a = await e.embed('hello world');
  const b = await e.embed('hello world');
  const c = await e.embed('different');
  assert.equal(e.backend, 'fake');
  assert.equal(a.vector.length, 16);
  assert.equal(a.dim, 16);
  assert.deepEqual(a.vector, b.vector);          // same text -> same vector
  assert.notDeepEqual(a.vector, c.vector);       // different text -> different
});

test('fake embedder reports available', async () => {
  const e = createFakeEmbedder({ dim: 8 });
  assert.equal(await e.isAvailable(), true);
});

test('ollama embedder parses the embeddings response', async () => {
  const fakeFetch = async (url, opts) => {
    assert.match(url, /\/api\/embeddings$/);
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'nomic-embed-text');
    assert.equal(body.prompt, 'hi');
    return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
  };
  const e = createOllamaEmbedder({ url: 'http://x:11434', model: 'nomic-embed-text', fetch: fakeFetch });
  const out = await e.embed('hi');
  assert.equal(e.backend, 'ollama');
  assert.deepEqual(out.vector, [0.1, 0.2, 0.3]);
  assert.equal(out.model, 'nomic-embed-text');
  assert.equal(out.dim, 3);
});

test('ollama isAvailable maps reachability', async () => {
  const up = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => ({ ok: true }) });
  const down = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => { throw new Error('refused'); } });
  assert.equal(await up.isAvailable(), true);
  assert.equal(await down.isAvailable(), false);
});

test('createEmbedder resolves backends and null for none', () => {
  assert.equal(createEmbedder({ embeddingBackend: 'none' }), null);
  assert.equal(createEmbedder({ embeddingBackend: 'fake' }).backend, 'fake');
  assert.equal(createEmbedder({ embeddingBackend: 'ollama', ollamaUrl: 'http://x', embeddingModel: '' }).backend, 'ollama');
});

test('createEmbedder throws on unknown backend', () => {
  assert.throws(() => createEmbedder({ embeddingBackend: 'bogus' }), /unknown embedding backend/i);
});
