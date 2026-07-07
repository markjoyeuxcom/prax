import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEmbedder } from '../../server/embedder/fake.js';
import { createOllamaEmbedder } from '../../server/embedder/ollama.js';
import { createEmbedder } from '../../server/embedder/index.js';
import { createOpenAiEmbedder } from '../../server/embedder/openai.js';
import { createGeminiEmbedder } from '../../server/embedder/gemini.js';
import { createVoyageEmbedder } from '../../server/embedder/voyage.js';

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

test('every embedder exposes .model equal to what embed() reports (for reindex-on-model-change)', async () => {
  // reindex compares the active embedder.model against each row's stored
  // embedding_model, so the property must match the model embed() records.
  const fake = createFakeEmbedder({ dim: 8 });
  assert.equal(fake.model, 'fake-8');
  assert.equal(fake.model, (await fake.embed('x')).model);

  assert.equal(createOllamaEmbedder({ model: 'nomic-embed-text', fetch: async () => ({ ok: true, json: async () => ({ embedding: [0] }) }) }).model, 'nomic-embed-text');
  assert.equal(createOpenAiEmbedder({ model: 'text-embedding-3-large' }).model, 'text-embedding-3-large');
  assert.equal(createOpenAiEmbedder({}).model, 'text-embedding-3-small');            // default
  assert.equal(createOpenAiEmbedder({ backend: 'llamacpp', defaultModel: '' }).model, ''); // server-default
  assert.equal(createGeminiEmbedder({ model: 'gemini-embedding-001' }).model, 'gemini-embedding-001');
  assert.equal(createVoyageEmbedder({}).model, 'voyage-3-large');                     // default
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

test('ollama strips a trailing /v1 from the base URL (native API lives at root, not /v1)', async () => {
  const urls = [];
  const fakeFetch = async (url) => { urls.push(url); return { ok: true, json: async () => ({ embedding: [0.1], models: [{ name: 'm' }] }) }; };
  const e = createOllamaEmbedder({ url: 'https://ollama.example/v1', model: 'm', fetch: fakeFetch });
  await e.embed('hi');
  await e.isAvailable();
  assert.equal(urls[0], 'https://ollama.example/api/embeddings');
  assert.equal(urls[1], 'https://ollama.example/api/tags');
  assert.doesNotMatch(urls.join(' '), /\/v1\//);
});

test('ollama isAvailable requires the configured model to be pulled, not just reachability', async () => {
  const tags = (models) => async () => ({ ok: true, json: async () => ({ models: models.map((name) => ({ name })) }) });

  // Reachable AND the model is pulled -> available.
  const present = createOllamaEmbedder({ url: 'http://x', model: 'qwen3-embedding:8b', fetch: tags(['qwen3-embedding:8b']) });
  assert.equal(await present.isAvailable(), true);

  // Reachable but the configured model is NOT pulled -> unavailable (the
  // "connected but embeds 404" trap). A bare name resolves to :latest.
  const missing = createOllamaEmbedder({ url: 'http://x', model: 'nomic-embed-text', fetch: tags(['qwen3-embedding:8b']) });
  assert.equal(await missing.isAvailable(), false);

  const bareToLatest = createOllamaEmbedder({ url: 'http://x', model: 'nomic-embed-text', fetch: tags(['nomic-embed-text:latest']) });
  assert.equal(await bareToLatest.isAvailable(), true);

  // Reachable but the tags list can't be read -> fall back to reachability.
  const unreadable = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }) });
  assert.equal(await unreadable.isAvailable(), true);

  // Not reachable at all -> unavailable.
  const down = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => { throw new Error('refused'); } });
  assert.equal(await down.isAvailable(), false);
  const notOk = createOllamaEmbedder({ url: 'http://x', model: 'm', fetch: async () => ({ ok: false }) });
  assert.equal(await notOk.isAvailable(), false);
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

test('gemini embed posts embedContent with the key header and document task type', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { embedding: { values: [0.1, 0.2] } }; } }; });
  const e = createGeminiEmbedder({ baseUrl: 'http://g/v1beta', apiKey: 'gk-1', model: 'gemini-embedding-001', fetch });
  const out = await e.embed('hello');
  assert.equal(e.backend, 'gemini');
  assert.deepEqual(out.vector, [0.1, 0.2]);
  assert.equal(out.model, 'gemini-embedding-001');
  assert.equal(out.dim, 2);
  assert.equal(seen.url, 'http://g/v1beta/models/gemini-embedding-001:embedContent');
  assert.equal(seen.init.headers['x-goog-api-key'], 'gk-1');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.content, { parts: [{ text: 'hello' }] });
  assert.equal(body.taskType, 'RETRIEVAL_DOCUMENT');
});

test('gemini flips to the query task type for query embeddings', async () => {
  let body;
  const fetch = fakeFetch((url, init) => { body = JSON.parse(init.body); return { ok: true, async json() { return { embedding: { values: [1] } }; } }; });
  const e = createGeminiEmbedder({ apiKey: 'gk', fetch });
  await e.embed('find me', { query: true });
  assert.equal(body.taskType, 'RETRIEVAL_QUERY');
});

test('gemini defaults to the public baseUrl and gemini-embedding-001', async () => {
  let url;
  const fetch = fakeFetch((u) => { url = u; return { ok: true, async json() { return { embedding: { values: [1] } }; } }; });
  await createGeminiEmbedder({ fetch }).embed('x');
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent');
});

test('gemini throws on non-ok and malformed responses', async () => {
  const bad = createGeminiEmbedder({ fetch: fakeFetch(() => ({ ok: false, status: 403 })) });
  await assert.rejects(bad.embed('x'), /gemini embed failed: 403/);
  const malformed = createGeminiEmbedder({ fetch: fakeFetch(() => ({ ok: true, async json() { return {}; } })) });
  await assert.rejects(malformed.embed('x'), /no embedding array/);
});

test('gemini isAvailable probes GET /models with the key header', async () => {
  let seen;
  const up = createGeminiEmbedder({ apiKey: 'gk', fetch: fakeFetch((url, init) => { seen = { url, init }; return { ok: true }; }) });
  assert.equal(await up.isAvailable(), true);
  assert.match(seen.url, /\/v1beta\/models$/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'gk');
  const down = createGeminiEmbedder({ fetch: fakeFetch(() => { throw new Error('down'); }) });
  assert.equal(await down.isAvailable(), false);
});

test('voyage embed posts model/input/input_type with the Bearer key', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { data: [{ embedding: [0.4, 0.5] }] }; } }; });
  const e = createVoyageEmbedder({ baseUrl: 'http://v/v1', apiKey: 'vk-1', model: 'voyage-3-large', fetch });
  const out = await e.embed('hello');
  assert.equal(e.backend, 'voyage');
  assert.deepEqual(out.vector, [0.4, 0.5]);
  assert.equal(out.model, 'voyage-3-large');
  assert.equal(seen.url, 'http://v/v1/embeddings');
  assert.equal(seen.init.headers.authorization, 'Bearer vk-1');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'voyage-3-large');
  assert.deepEqual(body.input, ['hello']);
  assert.equal(body.input_type, 'document');
});

test('voyage flips input_type for query embeddings', async () => {
  let body;
  const fetch = fakeFetch((url, init) => { body = JSON.parse(init.body); return { ok: true, async json() { return { data: [{ embedding: [1] }] }; } }; });
  const e = createVoyageEmbedder({ apiKey: 'vk', fetch });
  await e.embed('find me', { query: true });
  assert.equal(body.input_type, 'query');
});

test('voyage throws on non-ok and malformed responses', async () => {
  const bad = createVoyageEmbedder({ fetch: fakeFetch(() => ({ ok: false, status: 401 })) });
  await assert.rejects(bad.embed('x'), /voyage embed failed: 401/);
  const malformed = createVoyageEmbedder({ fetch: fakeFetch(() => ({ ok: true, async json() { return { data: [] }; } })) });
  await assert.rejects(malformed.embed('x'), /no embedding array/);
});

test('voyage isAvailable probes with a tiny embeddings POST (no cheap GET exists)', async () => {
  let seen;
  const up = createVoyageEmbedder({ apiKey: 'vk', fetch: fakeFetch((url, init) => { seen = { url, init }; return { ok: true }; }) });
  assert.equal(await up.isAvailable(), true);
  assert.equal(seen.url, 'https://api.voyageai.com/v1/embeddings');
  assert.equal(seen.init.method, 'POST');
  const down = createVoyageEmbedder({ fetch: fakeFetch(() => ({ ok: false, status: 401 })) });
  assert.equal(await down.isAvailable(), false);
});

test('llamacpp rides the openai client: keyless and modelless by default', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { data: [{ embedding: [1, 2] }] }; } }; });
  const e = createEmbedder({ embeddingBackend: 'llamacpp', fetch });
  assert.equal(e.backend, 'llamacpp');
  const out = await e.embed('hi');
  assert.deepEqual(out.vector, [1, 2]);
  assert.equal(seen.url, 'http://127.0.0.1:8080/v1/embeddings');
  assert.equal('authorization' in seen.init.headers, false);
  assert.equal('model' in JSON.parse(seen.init.body), false); // llama-server uses its loaded model
});

test('llamacpp sends the model field and Bearer key when configured', async () => {
  let seen;
  const fetch = fakeFetch((url, init) => { seen = { url, init }; return { ok: true, async json() { return { data: [{ embedding: [1] }] }; } }; });
  const e = createEmbedder({ embeddingBackend: 'llamacpp', baseUrl: 'http://box:8080/v1', apiKey: 'k', embeddingModel: 'nomic', fetch });
  await e.embed('hi');
  assert.equal(seen.url, 'http://box:8080/v1/embeddings');
  assert.equal(seen.init.headers.authorization, 'Bearer k');
  assert.equal(JSON.parse(seen.init.body).model, 'nomic');
});

test('llamacpp errors carry the llamacpp name, not openai', async () => {
  const e = createEmbedder({ embeddingBackend: 'llamacpp', fetch: fakeFetch(() => ({ ok: false, status: 500 })) });
  await assert.rejects(e.embed('x'), /llamacpp embed failed: 500/);
});

test('createEmbedder resolves the new backends', () => {
  assert.equal(createEmbedder({ embeddingBackend: 'gemini' }).backend, 'gemini');
  assert.equal(createEmbedder({ embeddingBackend: 'voyage' }).backend, 'voyage');
  assert.equal(createEmbedder({ embeddingBackend: 'llamacpp' }).backend, 'llamacpp');
});

test('query prefix forwards the query flag to backends with native task types', async () => {
  let body;
  const fetch = fakeFetch((url, init) => { body = JSON.parse(init.body); return { ok: true, async json() { return { embedding: { values: [1] } }; } }; });
  const e = createEmbedder({ embeddingBackend: 'gemini', apiKey: 'k', embeddingQueryPrefix: 'Q: ', fetch });
  await e.embed('cat', { query: true });
  assert.equal(body.taskType, 'RETRIEVAL_QUERY');           // flag still reaches the client
  assert.deepEqual(body.content.parts, [{ text: 'Q: cat' }]); // prefix applied on top
});
