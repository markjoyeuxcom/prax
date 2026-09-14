// The in-process ("local") embedder: embeddings with no daemon, no API key and
// no network after the first model fetch.
//
// Prax already has two local-ish backends, but both need a separate process
// running (ollama, llamacpp). This one runs inside the server, which is what
// makes semantic recall work on a laptop with no configuration at all.
//
// The runtime is NOT a dependency of Prax: onnxruntime alone is ~210MB and has
// per-platform binaries, which has no business in the default install or the
// desktop bundle. It is imported dynamically and absent means "unavailable
// with a reason", never a crash. These tests inject the loader, so they never
// touch the network or the real runtime.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalEmbedder, LOCAL_DEFAULT_MODEL } from '../../server/embedder/local.js';

// A stand-in for the transformers feature-extraction pipeline: returns a
// tensor-shaped object exactly as the real one does.
function fakeLoader({ dim = 4, calls = [], fail = null } = {}) {
  return async (model) => {
    if (fail) throw fail;
    calls.push({ model });
    return async (inputs, opts) => {
      calls.push({ inputs, opts });
      return { dims: [1, dim], data: Float32Array.from({ length: dim }, (_, i) => (i + 1) / 10) };
    };
  };
}

test('embeds text to a plain number array with the model and dimension reported', async () => {
  const embedder = createLocalEmbedder({ load: fakeLoader({ dim: 4 }) });
  const { vector, model, dim } = await embedder.embed('homelab postgres');
  assert.deepEqual(vector, [0.1, 0.2, 0.3, 0.4].map((n) => Math.fround(n)));
  assert.equal(dim, 4);
  assert.equal(model, LOCAL_DEFAULT_MODEL);
  assert.equal(embedder.backend, 'local');
});

test('asks the pipeline for mean pooling and normalisation', async () => {
  const calls = [];
  const embedder = createLocalEmbedder({ load: fakeLoader({ calls }) });
  await embedder.embed('x');
  const call = calls.find((c) => c.opts);
  assert.deepEqual(call.opts, { pooling: 'mean', normalize: true });
  // Batched API: the text goes in as a one-element array.
  assert.deepEqual(call.inputs, ['x']);
});

test('loads the model once and reuses it across embeds', async () => {
  const calls = [];
  const embedder = createLocalEmbedder({ load: fakeLoader({ calls }) });
  await embedder.embed('one');
  await embedder.embed('two');
  assert.equal(calls.filter((c) => c.model).length, 1, 'model loaded exactly once');
});

test('a concurrent first embed does not load the model twice', async () => {
  const calls = [];
  const embedder = createLocalEmbedder({ load: fakeLoader({ calls }) });
  await Promise.all([embedder.embed('a'), embedder.embed('b'), embedder.embed('c')]);
  assert.equal(calls.filter((c) => c.model).length, 1);
});

test('honours an explicitly configured model', async () => {
  const calls = [];
  const embedder = createLocalEmbedder({ model: 'Xenova/bge-small-en-v1.5', load: fakeLoader({ calls }) });
  await embedder.embed('x');
  assert.equal(calls[0].model, 'Xenova/bge-small-en-v1.5');
  assert.equal(embedder.model, 'Xenova/bge-small-en-v1.5');
});

// --- availability is honest ----------------------------------------------------

test('isAvailable is false when the runtime is not installed', async () => {
  const missing = Object.assign(new Error("Cannot find module '@huggingface/transformers'"), { code: 'ERR_MODULE_NOT_FOUND' });
  const embedder = createLocalEmbedder({ load: fakeLoader({ fail: missing }) });
  assert.equal(await embedder.isAvailable(), false);
});

test('a missing runtime fails an embed with an actionable message, not a module error', async () => {
  const missing = Object.assign(new Error("Cannot find module '@huggingface/transformers'"), { code: 'ERR_MODULE_NOT_FOUND' });
  const embedder = createLocalEmbedder({ load: fakeLoader({ fail: missing }) });
  await assert.rejects(embedder.embed('x'), (err) => {
    assert.match(err.message, /npm install @huggingface\/transformers/);
    return true;
  });
});

test('isAvailable proves the model actually loads, not merely that the package exists', async () => {
  // ollama.js sets the precedent: reachability alone reads as a misleading
  // "connected" when embeds would still fail.
  const embedder = createLocalEmbedder({ load: fakeLoader({}) });
  assert.equal(await embedder.isAvailable(), true);
  const broken = createLocalEmbedder({ load: fakeLoader({ fail: new Error('corrupt model file') }) });
  assert.equal(await broken.isAvailable(), false);
});

test('a failed load is retried rather than cached as permanently broken', async () => {
  let attempt = 0;
  const load = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('transient network failure');
    return async () => ({ dims: [1, 2], data: Float32Array.from([0.5, 0.5]) });
  };
  const embedder = createLocalEmbedder({ load });
  await assert.rejects(embedder.embed('x'));
  const { vector } = await embedder.embed('x');
  assert.deepEqual(vector, [0.5, 0.5]);
});

test('a pipeline returning no usable tensor is an error, never a silent empty vector', async () => {
  const embedder = createLocalEmbedder({ load: async () => async () => ({ dims: [1, 0], data: null }) });
  await assert.rejects(embedder.embed('x'), /no embedding/i);
});

// --- registration --------------------------------------------------------------

test("createEmbedder resolves backend 'local' and passes the configured model", async () => {
  const { createEmbedder } = await import('../../server/embedder/index.js');
  const embedder = createEmbedder({ embeddingBackend: 'local' });
  assert.equal(embedder.backend, 'local');
  assert.equal(embedder.model, LOCAL_DEFAULT_MODEL);

  const custom = createEmbedder({ embeddingBackend: 'local', embeddingModel: 'Xenova/bge-small-en-v1.5' });
  assert.equal(custom.model, 'Xenova/bge-small-en-v1.5');
});

test("the provider accepts 'local' and needs no API key for it", async () => {
  const { createEmbedderProvider } = await import('../../server/embedderProvider.js');
  const { loadConfig } = await import('../../server/config.js');
  const store = new Map();
  const repo = {
    async getSetting(key, fallback = null) { return store.has(key) ? store.get(key) : fallback; },
    async putSetting(key, value) { store.set(key, value); return value; },
  };
  const p = createEmbedderProvider({ appSettingsRepository: repo, config: loadConfig({}) });
  const saved = await p.putSettings({ backend: 'local' });
  assert.equal(saved.backend, 'local');
  // Hosted backends refuse anonymous calls and are gated on a key; this one is
  // keyless by construction, so it must not be gated.
  const embedder = await p.getEmbedder();
  assert.equal(embedder.backend, 'local');
});

// --- model-specific relevance threshold ----------------------------------------
//
// Cosine distributions are a property of the MODEL, not of search. The global
// 0.45 floor was calibrated on OpenAI vectors; on all-MiniLM-L6-v2 the correct
// answers for real queries score 0.400 / 0.450 / 0.563 while the best noise
// scores 0.287 — so 0.45 discards most true positives. A backend therefore
// declares the floor its own vectors need.

test('the local backend declares a relevance floor suited to its own vectors', () => {
  const embedder = createLocalEmbedder({ load: fakeLoader({}) });
  assert.ok(embedder.minSimilarity > 0.28, 'above the measured noise band');
  assert.ok(embedder.minSimilarity < 0.40, 'below the weakest measured true positive');
});
