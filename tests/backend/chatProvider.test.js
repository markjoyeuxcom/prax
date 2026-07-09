import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatProvider, CHAT_PROVIDER_KEY, isChatSettingsError } from '../../server/chatProvider.js';

// In-memory app_settings stand-in (getSetting/putSetting), matching the real
// repository's contract closely enough for the provider.
function fakeSettings(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async getSetting(key, fallback = null) { return key in store ? store[key] : fallback; },
    async putSetting(key, value) { store[key] = value; },
  };
}

test('default backend comes from config; getChat builds it; none → null', async () => {
  const off = createChatProvider({ appSettingsRepository: fakeSettings(), config: {} });
  assert.equal(await off.getChat(), null);
  assert.equal((await off.getSettings()).backend, 'none');

  const fake = createChatProvider({ appSettingsRepository: fakeSettings(), config: { chatBackend: 'fake' } });
  assert.equal((await fake.getChat()).backend, 'fake');
});

test('CHAT_MODEL follows the env-selected backend', async () => {
  const p = createChatProvider({ appSettingsRepository: fakeSettings(), config: { chatBackend: 'openai', chatModel: 'gpt-4.1', openaiApiKey: 'sk' } });
  const s = await p.getSettings();
  assert.equal(s.backend, 'openai');
  assert.equal(s.model, 'gpt-4.1');
  assert.equal(s.hasApiKey, true);
  assert.equal(s.keyRequired, true);
});

test('getSettings redacts the api key to hasApiKey only', async () => {
  const settings = fakeSettings();
  const p = createChatProvider({ appSettingsRepository: settings, config: { chatBackend: 'anthropic' } });
  await p.putSettings({ apiKey: 'secret-key', model: 'claude-x' });
  const s = await p.getSettings();
  assert.equal(s.hasApiKey, true);
  assert.equal('apiKey' in s, false);                      // never serialized
  assert.equal(s.model, 'claude-x');
  // But the raw key is persisted for the provider's own use.
  assert.equal(settings.store[CHAT_PROVIDER_KEY].configs.anthropic.apiKey, 'secret-key');
});

test('putSettings persists per-backend config, switches backend, and invalidates the cache', async () => {
  const settings = fakeSettings();
  const p = createChatProvider({ appSettingsRepository: settings, config: { chatBackend: 'fake' } });
  assert.equal((await p.getChat()).backend, 'fake');        // primes the cache

  await p.putSettings({ backend: 'anthropic', apiKey: 'ak', model: 'claude-x' });
  const chat = await p.getChat();                           // cache was invalidated → rebuilt
  assert.equal(chat.backend, 'anthropic');
  assert.equal(chat.model, 'claude-x');

  // Switching away and back restores the per-backend config.
  await p.putSettings({ backend: 'openai', apiKey: 'sk' });
  await p.putSettings({ backend: 'anthropic' });
  assert.equal((await p.getSettings()).model, 'claude-x');
  assert.equal((await p.getSettings()).hasApiKey, true);
});

test('empty-string apiKey clears the key; undefined leaves it unchanged', async () => {
  const p = createChatProvider({ appSettingsRepository: fakeSettings(), config: { chatBackend: 'anthropic' } });
  await p.putSettings({ apiKey: 'ak' });
  assert.equal((await p.getSettings()).hasApiKey, true);
  await p.putSettings({ model: 'claude-y' });               // no apiKey field → unchanged
  assert.equal((await p.getSettings()).hasApiKey, true);
  await p.putSettings({ apiKey: '' });                      // explicit clear
  assert.equal((await p.getSettings()).hasApiKey, false);
});

test('validation throws ChatSettingsError (400) on bad input', async () => {
  const p = createChatProvider({ appSettingsRepository: fakeSettings(), config: {} });
  for (const bad of [{ backend: 'nope' }, { baseUrl: 'not-a-url' }, { model: 5 }, { apiKey: 5 }, null]) {
    const err = await p.putSettings(bad).then(() => null, (e) => e);
    assert.ok(err, `expected throw for ${JSON.stringify(bad)}`);
    assert.equal(isChatSettingsError(err), true);
    assert.equal(err.statusCode, 400);
  }
});

test('stored settings are sanitized on read (unknown keys dropped, bad backend ignored)', async () => {
  const settings = fakeSettings({ [CHAT_PROVIDER_KEY]: { backend: 'bogus', configs: { anthropic: { baseUrl: 'ftp://x', model: 'm', junk: 1 } } } });
  const p = createChatProvider({ appSettingsRepository: settings, config: { chatBackend: 'fake' } });
  const s = await p.getSettings();
  assert.equal(s.backend, 'fake');                          // invalid stored backend → default
});
