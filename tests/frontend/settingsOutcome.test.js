import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsPatchMatchesStatus } from '../../public/js/settingsOutcome.js';

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
