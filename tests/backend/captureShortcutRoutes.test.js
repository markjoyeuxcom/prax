import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

async function shortcutApp() {
  const { loadConfig } = await import('../../server/config.js');
  const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
  return buildApp({ config });
}

test('capture shortcut: default until stored, round-trips, empty disables, abuse rejected', async () => {
  const app = await shortcutApp();

  const initial = (await app.inject({ method: 'GET', url: '/api/settings/capture-shortcut' })).json();
  assert.equal(initial.shortcut, 'CmdOrCtrl+Shift+Space');
  assert.equal(initial.default, 'CmdOrCtrl+Shift+Space');

  const saved = (await app.inject({
    method: 'PUT', url: '/api/settings/capture-shortcut', payload: { shortcut: '  Alt+Space  ' },
  })).json();
  assert.equal(saved.shortcut, 'Alt+Space', 'stored trimmed');
  const reread = (await app.inject({ method: 'GET', url: '/api/settings/capture-shortcut' })).json();
  assert.equal(reread.shortcut, 'Alt+Space');

  // Empty means disabled — stored as '', NOT silently reset to the default.
  const disabled = (await app.inject({
    method: 'PUT', url: '/api/settings/capture-shortcut', payload: { shortcut: '' },
  })).json();
  assert.equal(disabled.shortcut, '');
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings/capture-shortcut' })).json().shortcut, '');

  const nonString = await app.inject({ method: 'PUT', url: '/api/settings/capture-shortcut', payload: { shortcut: 7 } });
  assert.equal(nonString.statusCode, 400);
  const tooLong = await app.inject({ method: 'PUT', url: '/api/settings/capture-shortcut', payload: { shortcut: 'x'.repeat(65) } });
  assert.equal(tooLong.statusCode, 400);

  await app.close();
});
