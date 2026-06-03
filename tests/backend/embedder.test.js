import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEmbedder } from '../../server/embedder/fake.js';
import { createOllamaEmbedder } from '../../server/embedder/ollama.js';
import { createEmbedder } from '../../server/embedder/index.js';
import { createOpenAiEmbedder } from '../../server/embedder/openai.js';

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

test('ollama embed throws on a non-ok response', async () => {
  const e = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(e.embed('hi'), /ollama embed failed: 500/);
});

test('ollama embed throws on a malformed response (no embedding array)', async () => {
  const e = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(e.embed('hi'), /no embedding array/);
});

test('fake embedder produces the exact dim for non-multiple-of-32 sizes', async () => {
  const e = createFakeEmbedder({ dim: 100 });
  const out = await e.embed('boundary');
  assert.equal(out.vector.length, 100);
  assert.ok(out.vector.every((n) => n >= -1 && n <= 1));
});

function fakeFetch(handler) { return async (url, init) => handler(url, init); }

test('openai embed posts input and returns the vector', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { data: [{ embedding: [0.1, 0.2, 0.3] }] }; } }; });
  const e = createOpenAiEmbedder({ baseUrl: 'http://x/v1', apiKey: 'sk-1', model: 'm', fetch });
  const out = await e.embed('hello');
  assert.deepEqual(out.vector, [0.1, 0.2, 0.3]);
  assert.equal(out.dim, 3);
  assert.equal(out.model, 'm');
  assert.match(seen.url, /\/v1\/embeddings$/);
  assert.equal(seen.init.headers.authorization, 'Bearer sk-1');
  assert.match(seen.init.body, /"input":"hello"/);
});

test('openai omits the Authorization header when keyless', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = init; return { ok: true, async json() { return { data: [{ embedding: [0] }] }; } }; });
  const e = createOpenAiEmbedder({ baseUrl: 'http://local/v1', apiKey: '', model: 'm', fetch });
  await e.embed('x');
  assert.equal('authorization' in seen.headers, false);
});

test('openai throws on non-ok and on malformed response', async () => {
  const bad = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => ({ ok: false, status: 500 })) });
  await assert.rejects(bad.embed('x'), /openai embed failed: 500/);
  const malformed = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => ({ ok: true, async json() { return { data: [] }; } })) });
  await assert.rejects(malformed.embed('x'), /no embedding array/);
});

test('openai isAvailable hits /models', async () => {
  const up = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch((url) => ({ ok: /\/v1\/models$/.test(url) })) });
  assert.equal(await up.isAvailable(), true);
  const down = createOpenAiEmbedder({ baseUrl: 'http://x/v1', fetch: fakeFetch(() => { throw new Error('down'); }) });
  assert.equal(await down.isAvailable(), false);
});

test('createEmbedder resolves openai', () => {
  const e = createEmbedder({ embeddingBackend: 'openai', openaiBaseUrl: 'http://x/v1', embeddingModel: 'm' });
  assert.equal(e.backend, 'openai');
});

test('query prefix is applied to query embeddings only', async () => {
  const e = createEmbedder({ embeddingBackend: 'fake', embeddingQueryPrefix: 'Q: ' });
  const q = await e.embed('cat', { query: true });
  const d = await e.embed('cat');
  assert.notDeepEqual(q.vector, d.vector);
});

test('no prefix → createEmbedder returns the base embedder unwrapped', () => {
  const e = createEmbedder({ embeddingBackend: 'fake' });
  assert.equal(e.backend, 'fake');
});
