import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppSettingsRepository } from '../../server/appSettingsRepository.js';

test('getSetting returns the fallback when absent', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const repo = createAppSettingsRepository(db);
  assert.equal(await repo.getSetting('semantic_search_enabled', true), true);
});

test('getSetting returns the stored jsonb value', async () => {
  const db = { query: async () => ({ rows: [{ value: false }] }) };
  const repo = createAppSettingsRepository(db);
  assert.equal(await repo.getSetting('semantic_search_enabled', true), false);
});

test('putSetting upserts the value', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createAppSettingsRepository(db);
  await repo.putSetting('semantic_search_enabled', false);
  assert.match(captured.text, /insert into app_settings/i);
  assert.match(captured.text, /on conflict \(key\) do update/i);
  assert.equal(captured.values[0], 'semantic_search_enabled');
  assert.equal(captured.values[1], JSON.stringify(false));
});
