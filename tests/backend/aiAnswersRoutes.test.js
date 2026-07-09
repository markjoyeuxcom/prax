import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { CHAT_PROVIDER_KEY } from '../../server/chatProvider.js';

// In-memory app_settings so the real chatProvider persists across a PUT→GET.
function fakeSettings(initial = {}) {
  const store = { ...initial };
  return { store, async getSetting(k, fb = null) { return k in store ? store[k] : fb; }, async putSetting(k, v) { store[k] = v; } };
}

function makeApp({ config = {}, settings = fakeSettings() } = {}) {
  return buildApp({
    skipDb: true,
    config: { ...loadConfig(), ...config },
    libraryRepository: { listDocuments: async () => [], countEmbeddings: async () => ({ total: 0, embedded: 0 }) },
    appSettingsRepository: settings,
  });
}

test('GET /api/settings/ai-answers reports "none" when no chat model is configured', async () => {
  const app = await makeApp({ config: { chatBackend: 'none' } });
  const res = await app.inject({ method: 'GET', url: '/api/settings/ai-answers' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.available, false);
  assert.equal(body.backend, 'none');
  await app.close();
});

test('GET /api/settings/ai-answers reports an env-configured backend as available + connected', async () => {
  const app = await makeApp({ config: { chatBackend: 'fake' } });
  const body = (await app.inject({ method: 'GET', url: '/api/settings/ai-answers' })).json();
  assert.equal(body.available, true);
  assert.equal(body.backend, 'fake');
  assert.equal(body.connected, true);          // fake chat is always available
  await app.close();
});

test('PUT /api/settings/ai-answers configures a provider, persists it, and redacts the key', async () => {
  const settings = fakeSettings();
  const app = await makeApp({ config: { chatBackend: 'none' }, settings });
  const put = await app.inject({ method: 'PUT', url: '/api/settings/ai-answers', payload: { backend: 'anthropic', apiKey: 'ak-secret', model: 'claude-x' } });
  assert.equal(put.statusCode, 200);
  const body = put.json();
  assert.equal(body.backend, 'anthropic');
  assert.equal(body.model, 'claude-x');
  assert.equal(body.hasApiKey, true);
  assert.equal(body.keyRequired, true);
  assert.equal('apiKey' in body, false);        // never serialized
  // persisted for the provider's own use
  assert.equal(settings.store[CHAT_PROVIDER_KEY].configs.anthropic.apiKey, 'ak-secret');
  // survives a fresh GET
  const get = (await app.inject({ method: 'GET', url: '/api/settings/ai-answers' })).json();
  assert.equal(get.backend, 'anthropic');
  assert.equal(get.model, 'claude-x');
  await app.close();
});

test('PUT /api/settings/ai-answers rejects a bad backend (400) and an empty patch (400)', async () => {
  const app = await makeApp({ config: { chatBackend: 'none' } });
  assert.equal((await app.inject({ method: 'PUT', url: '/api/settings/ai-answers', payload: { backend: 'bogus' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/settings/ai-answers', payload: {} })).statusCode, 400);
  await app.close();
});
