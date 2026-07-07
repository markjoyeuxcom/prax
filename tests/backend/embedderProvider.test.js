import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedderProvider, EMBEDDING_PROVIDER_KEY, isEmbedderSettingsError } from '../../server/embedderProvider.js';
import { loadConfig } from '../../server/config.js';

// In-memory stand-in for appSettingsRepository (same get/put contract; the
// real one JSON round-trips values, which is equivalent for plain objects).
function memSettings(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async getSetting(key, fallback = null) {
      return store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : fallback;
    },
    async putSetting(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
      return value;
    },
  };
}

function provider(env = {}, repo = memSettings()) {
  return { provider: createEmbedderProvider({ appSettingsRepository: repo, config: loadConfig(env) }), repo };
}

test('defaults come from env config; nothing stored means env behavior', async () => {
  const { provider: p } = provider({
    EMBEDDING_BACKEND: 'ollama',
    EMBEDDING_MODEL: 'nomic-embed-text',
    OLLAMA_URL: 'http://envhost:11434',
  });
  const s = await p.getSettings();
  assert.equal(s.backend, 'ollama');
  assert.equal(s.model, 'nomic-embed-text');
  assert.equal(s.baseUrl, 'http://envhost:11434');           // active backend's url
  assert.equal(s.keyRequired, false);
  assert.equal(s.ollamaUrl, 'http://envhost:11434');          // legacy alias, one release
  assert.equal(s.openaiBaseUrl, 'https://api.openai.com/v1'); // legacy alias, one release
  assert.equal(s.hasApiKey, false);
  assert.equal((await p.getEmbedder()).backend, 'ollama');
});

test('backend none (the shipped default) resolves a null embedder', async () => {
  const { provider: p } = provider({});
  assert.equal(await p.getEmbedder(), null);
  assert.equal((await p.getSettings()).backend, 'none');
});

test('putSettings persists to app_settings and round-trips through a fresh provider', async () => {
  const repo = memSettings();
  const { provider: p } = provider({}, repo);
  const out = await p.putSettings({ backend: 'ollama', model: 'mxbai-embed-large', ollamaUrl: 'http://box:11434' });
  assert.equal(out.backend, 'ollama');
  assert.equal(out.model, 'mxbai-embed-large');

  // Persisted as per-backend configs: the alias landed on ollama's config.
  const stored = repo.store.get(EMBEDDING_PROVIDER_KEY);
  assert.equal(stored.backend, 'ollama');
  assert.equal(stored.configs.ollama.baseUrl, 'http://box:11434');
  assert.equal(stored.configs.ollama.model, 'mxbai-embed-large');

  // A brand-new provider over the same repository resolves the same settings.
  const p2 = createEmbedderProvider({ appSettingsRepository: repo, config: loadConfig({}) });
  const s2 = await p2.getSettings();
  assert.equal(s2.backend, 'ollama');
  assert.equal(s2.model, 'mxbai-embed-large');
  assert.equal((await p2.getEmbedder()).backend, 'ollama');
});

test('getSettings never exposes the api key — only hasApiKey', async () => {
  const { provider: p } = provider({ EMBEDDING_BACKEND: 'openai', OPENAI_API_KEY: 'sk-secret' });
  const s = await p.getSettings();
  assert.equal(s.hasApiKey, true);
  assert.ok(!('openaiApiKey' in s), 'the key value must never leave the provider');
  assert.ok(!JSON.stringify(s).includes('sk-secret'));
});

test('empty-string apiKey clears it; undefined leaves it unchanged', async () => {
  const { provider: p } = provider({ EMBEDDING_BACKEND: 'openai', OPENAI_API_KEY: 'sk-env' });
  assert.equal((await p.getSettings()).hasApiKey, true);

  // Unrelated patch: key untouched.
  await p.putSettings({ model: 'text-embedding-3-large' });
  assert.equal((await p.getSettings()).hasApiKey, true);

  // New key.
  await p.putSettings({ openaiApiKey: 'sk-new' });
  assert.equal((await p.getSettings()).hasApiKey, true);

  // Explicit empty string clears.
  await p.putSettings({ openaiApiKey: '' });
  assert.equal((await p.getSettings()).hasApiKey, false);
});

test('getEmbedder caches until settings change', async () => {
  const { provider: p } = provider({ EMBEDDING_BACKEND: 'fake' });
  const first = await p.getEmbedder();
  assert.equal(await p.getEmbedder(), first, 'same instance while settings are stable');

  await p.putSettings({ backend: 'ollama', ollamaUrl: 'http://box:11434' });
  const second = await p.getEmbedder();
  assert.notEqual(second, first, 'putSettings invalidates the cache');
  assert.equal(second.backend, 'ollama');

  await p.putSettings({ backend: 'none' });
  assert.equal(await p.getEmbedder(), null);
});

test('putSettings validates: unknown backend / bad urls / bad types are 400-able', async () => {
  const { provider: p } = provider({});
  for (const patch of [
    { backend: 'quantum' },
    { backend: 42 },
    { model: 42 },
    { baseUrl: 'not a url' },
    { baseUrl: 'ftp://nope' },
    { apiKey: 42 },
    { ollamaUrl: 'not a url' },
    { ollamaUrl: 'ftp://nope' },
    { openaiBaseUrl: '' },
    { openaiApiKey: 42 },
    null,
    'nope',
  ]) {
    await assert.rejects(p.putSettings(patch), (err) => {
      assert.equal(isEmbedderSettingsError(err), true, `expected a settings error for ${JSON.stringify(patch)}`);
      assert.equal(err.statusCode, 400);
      return true;
    });
  }
  // Nothing was persisted by the failed attempts.
  assert.equal((await p.getSettings()).backend, 'none');
});

test('fake backend is accepted (deterministic, useful for tests/offline)', async () => {
  const { provider: p } = provider({});
  await p.putSettings({ backend: 'fake' });
  const embedder = await p.getEmbedder();
  assert.equal(embedder.backend, 'fake');
  assert.equal(await embedder.isAvailable(), true);
});

test('garbage stored settings degrade to env defaults instead of breaking', async () => {
  const repo = memSettings({ [EMBEDDING_PROVIDER_KEY]: { backend: 'bogus', ollamaUrl: 'nope', model: 42 } });
  const { provider: p } = provider({ EMBEDDING_BACKEND: 'fake' }, repo);
  const s = await p.getSettings();
  assert.equal(s.backend, 'fake');                       // invalid stored backend ignored
  assert.equal(s.model, '');                             // invalid stored model ignored
  assert.equal(s.ollamaUrl, 'http://127.0.0.1:11434');   // invalid stored url ignored
  assert.equal((await p.getEmbedder()).backend, 'fake');
});

test('query prefix from env survives runtime reconfiguration (query vs doc embeddings differ)', async () => {
  const { provider: p } = provider({ EMBEDDING_QUERY_PREFIX: 'Q: ' });
  await p.putSettings({ backend: 'fake' });
  const embedder = await p.getEmbedder();
  const q = await embedder.embed('cat', { query: true });
  const d = await embedder.embed('cat');
  assert.notDeepEqual(q.vector, d.vector);
});

test('without a settings repository: env defaults work, writes fail loudly (not a 400)', async () => {
  const p = createEmbedderProvider({ config: loadConfig({ EMBEDDING_BACKEND: 'fake' }) });
  assert.equal((await p.getEmbedder()).backend, 'fake');
  await assert.rejects(p.putSettings({ backend: 'none' }), (err) => !isEmbedderSettingsError(err));
});

test('per-backend configs are retained across backend switches', async () => {
  const { provider: p } = provider({});
  await p.putSettings({ backend: 'gemini', apiKey: 'g-key', model: 'gemini-embedding-001' });
  await p.putSettings({ backend: 'voyage', apiKey: 'v-key', baseUrl: 'http://proxy.local/v1' });
  const voyage = await p.getSettings();
  assert.equal(voyage.backend, 'voyage');
  assert.equal(voyage.baseUrl, 'http://proxy.local/v1');
  assert.equal(voyage.hasApiKey, true);

  // Switching back restores gemini's own config, untouched by the voyage edits.
  const gemini = await p.putSettings({ backend: 'gemini' });
  assert.equal(gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(gemini.model, 'gemini-embedding-001');
  assert.equal(gemini.hasApiKey, true, 'gemini key survives the round trip');

  // And voyage's config also survived the trip away.
  const voyage2 = await p.putSettings({ backend: 'voyage' });
  assert.equal(voyage2.baseUrl, 'http://proxy.local/v1');
  assert.equal(voyage2.hasApiKey, true);
});

test('legacy flat stored shape is migrated transparently on read', async () => {
  const repo = memSettings({ [EMBEDDING_PROVIDER_KEY]: {
    backend: 'openai',
    model: 'text-embedding-3-large',
    ollamaUrl: 'http://box:11434',
    openaiBaseUrl: 'http://proxy/v1',
    openaiApiKey: 'sk-legacy',
  } });
  const { provider: p } = provider({}, repo);
  const s = await p.getSettings();
  assert.equal(s.backend, 'openai');
  assert.equal(s.baseUrl, 'http://proxy/v1');
  assert.equal(s.model, 'text-embedding-3-large'); // the shared model stuck to its active backend
  assert.equal(s.hasApiKey, true);
  assert.equal(s.keyRequired, true);
  assert.equal(s.ollamaUrl, 'http://box:11434');   // migrated into the ollama config
  assert.equal((await p.getEmbedder()).backend, 'openai');

  // Switching to ollama surfaces its migrated url; openai's key is retained.
  const o = await p.putSettings({ backend: 'ollama' });
  assert.equal(o.baseUrl, 'http://box:11434');
  assert.equal(o.model, 'nomic-embed-text');
  assert.equal(o.hasApiKey, false);
  assert.equal((await p.putSettings({ backend: 'openai' })).hasApiKey, true);
});

test('keyRequired flags hosted backends only', async () => {
  const { provider: p } = provider({});
  const expectations = { none: false, fake: false, ollama: false, llamacpp: false, openai: true, gemini: true, voyage: true };
  for (const [backend, required] of Object.entries(expectations)) {
    assert.equal((await p.putSettings({ backend })).keyRequired, required, backend);
  }
});

test('legacy aliases patch their own backend regardless of the active one', async () => {
  const { provider: p } = provider({});
  await p.putSettings({ backend: 'gemini', ollamaUrl: 'http://nas:11434', openaiBaseUrl: 'http://proxy/v1', openaiApiKey: 'sk-x' });
  const s = await p.getSettings();
  assert.equal(s.backend, 'gemini');
  assert.equal(s.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(s.hasApiKey, false, 'the alias key belongs to openai, not the active gemini');
  assert.equal(s.ollamaUrl, 'http://nas:11434');
  assert.equal(s.openaiBaseUrl, 'http://proxy/v1');
  assert.equal((await p.putSettings({ backend: 'openai' })).hasApiKey, true);
  assert.equal((await p.putSettings({ backend: 'ollama' })).baseUrl, 'http://nas:11434');
});

test('new backends ship their documented defaults', async () => {
  const { provider: p } = provider({});
  const g = await p.putSettings({ backend: 'gemini' });
  assert.equal(g.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(g.model, 'gemini-embedding-001');
  const v = await p.putSettings({ backend: 'voyage' });
  assert.equal(v.baseUrl, 'https://api.voyageai.com/v1');
  assert.equal(v.model, 'voyage-3-large');
  const l = await p.putSettings({ backend: 'llamacpp' });
  assert.equal(l.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(l.model, '');
  assert.equal((await p.getEmbedder()).backend, 'llamacpp');
});

test('garbage per-backend config values degrade to defaults', async () => {
  const repo = memSettings({ [EMBEDDING_PROVIDER_KEY]: {
    backend: 'gemini',
    configs: { gemini: { baseUrl: 'nope', model: 42, apiKey: 7 }, voyage: 'lol' },
  } });
  const { provider: p } = provider({}, repo);
  const s = await p.getSettings();
  assert.equal(s.backend, 'gemini');
  assert.equal(s.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(s.model, 'gemini-embedding-001');
  assert.equal(s.hasApiKey, false);
});

test('gemini/voyage api keys never leave the provider either', async () => {
  const { provider: p } = provider({});
  await p.putSettings({ backend: 'voyage', apiKey: 'vk-secret' });
  await p.putSettings({ backend: 'gemini', apiKey: 'gk-secret' });
  const s = await p.getSettings();
  assert.equal(s.hasApiKey, true);
  assert.ok(!('apiKey' in s) && !('configs' in s));
  assert.ok(!JSON.stringify(s).includes('secret'));
});
