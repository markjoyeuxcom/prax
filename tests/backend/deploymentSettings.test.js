import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

test('deployment settings report the safe default without claiming authentication', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  const response = await app.inject({ method: 'GET', url: '/api/settings/deployment' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    authentication: 'none',
    bindHost: '127.0.0.1',
    networkScope: 'local',
    networkAcknowledged: false,
  });
  await app.close();
});

test('deployment settings describe an acknowledged network bind as unauthenticated', async () => {
  const config = loadConfig({
    HOST: '0.0.0.0',
    PRAX_ALLOW_UNAUTHENTICATED_NETWORK: 'true',
  });
  const app = await buildApp({ skipDb: true, config });
  const response = await app.inject({ method: 'GET', url: '/api/settings/deployment' });

  assert.deepEqual(response.json(), {
    authentication: 'none',
    bindHost: '0.0.0.0',
    networkScope: 'network',
    networkAcknowledged: true,
  });
  await app.close();
});
