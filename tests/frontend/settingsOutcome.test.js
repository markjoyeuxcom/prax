import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsPatchMatchesStatus, chatSettingsDraftFrom } from '../../public/js/settingsOutcome.js';
import { renderSettingsHtml } from '../../public/js/renderSettings.js';

test('a failed answer-model save keeps the typed binary path in the draft and on screen', () => {
  const draft = chatSettingsDraftFrom('claude-cli', { model: 'sonnet', binaryPath: '/opt/homebrew/bin/claude' });
  assert.deepEqual(draft, { backend: 'claude-cli', model: 'sonnet', baseUrl: '', apiKey: '', binaryPath: '/opt/homebrew/bin/claude' });
  assert.equal('binaryPath' in chatSettingsDraftFrom('openai', { model: 'gpt' }), false, 'no binary input, no draft value');
  const html = renderSettingsHtml({
    settingsTab: 'intelligence',
    chatStatus: { backend: 'claude-cli', available: true, model: 'haiku', binaryPath: '' },
    chatSettingsDraft: draft,
  });
  assert.match(html, /data-ai-chat-binary value="\/opt\/homebrew\/bin\/claude"/);
  // A readback that did not store the path is not proof of success.
  assert.equal(settingsPatchMatchesStatus({ model: 'sonnet', binaryPath: '/opt/homebrew/bin/claude' }, { model: 'sonnet', binaryPath: '' }), false);
  assert.equal(settingsPatchMatchesStatus({ model: 'sonnet', binaryPath: ' /usr/bin/claude ' }, { model: 'sonnet', binaryPath: '/usr/bin/claude' }), true);
  assert.equal(settingsPatchMatchesStatus({ binaryPath: '' }, { binaryPath: '' }), true);
});

test('settings readback comparison covers provider, fields, toggle, and redacted keys', () => {
  const status = {
    backend: 'openai', model: 'embed-v2', baseUrl: 'https://api.example/v1',
    enabled: true, hasApiKey: true,
  };
  assert.equal(settingsPatchMatchesStatus({ backend: 'openai' }, status), true);
  assert.equal(settingsPatchMatchesStatus({ model: 'embed-v2', baseUrl: 'https://api.example/v1' }, status), true);
  assert.equal(settingsPatchMatchesStatus({ enabled: true }, status), true);
  assert.equal(settingsPatchMatchesStatus({ apiKey: 'secret' }, status), false, 'redacted key without prior state is not proof');
  assert.equal(settingsPatchMatchesStatus({ apiKey: 'secret' }, status, { hasApiKey: false }), true);
  assert.equal(settingsPatchMatchesStatus({ apiKey: 'replacement' }, status, { hasApiKey: true }), false, 'an existing different key is indistinguishable');
  assert.equal(settingsPatchMatchesStatus({ backend: 'ollama' }, status), false);
  assert.equal(settingsPatchMatchesStatus({ model: 'wrong' }, status), false);
  assert.equal(settingsPatchMatchesStatus({ enabled: false }, status), false);
  assert.equal(settingsPatchMatchesStatus({ apiKey: '' }, status), false);
  assert.equal(settingsPatchMatchesStatus({ apiKey: '' }, { ...status, hasApiKey: false }), true);
});
