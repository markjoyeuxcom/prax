import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

// DNS rebinding: a page on attacker.example whose name resolves to 127.0.0.1
// is same-origin with itself, so the browser sends its requests to the
// unauthenticated loopback API with `Host: attacker.example`. On a loopback
// bind that Host is never legitimate, so it is refused before routing.

async function status(app, host) {
  const res = await app.inject({ method: 'GET', url: '/healthz', headers: host === undefined ? {} : { host } });
  return res.statusCode;
}

test('a loopback bind refuses a Host header that names another origin', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  assert.equal(await status(app, 'attacker.example'), 403);
  assert.equal(await status(app, 'attacker.example:3000'), 403);
  assert.equal(await status(app, '10.0.0.5:3000'), 403);
  const body = (await app.inject({ method: 'GET', url: '/healthz', headers: { host: 'attacker.example' } })).json();
  assert.match(body.message, /loopback/);
  await app.close();
});

test('a loopback bind accepts every loopback spelling, with or without a port', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  for (const host of ['127.0.0.1', '127.0.0.1:3000', 'localhost', 'localhost:58231', '[::1]', '[::1]:3000', '127.1.2.3']) {
    assert.equal(await status(app, host), 200, host);
  }
  await app.close();
});

test('the refusal happens before routing, so it covers the API and static files alike', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  for (const url of ['/api/settings/deployment', '/api/tasks', '/index.html', '/readyz']) {
    const res = await app.inject({ method: 'GET', url, headers: { host: 'attacker.example' } });
    assert.equal(res.statusCode, 403, url);
  }
  await app.close();
});

test('an acknowledged network deployment sees the Host names its proxy or clients use', async () => {
  // HOST=0.0.0.0: reachable by design, Host is whatever the client typed.
  const network = await buildApp({ skipDb: true, config: loadConfig({ HOST: '0.0.0.0', PRAX_ALLOW_UNAUTHENTICATED_NETWORK: 'true' }) });
  assert.equal(await status(network, 'prax.homelab:3000'), 200);
  await network.close();
  // A loopback bind behind a local reverse proxy forwards the public name; the
  // same acknowledgement lifts the check there.
  const proxied = await buildApp({ skipDb: true, config: loadConfig({ HOST: '127.0.0.1', PRAX_ALLOW_UNAUTHENTICATED_NETWORK: 'true' }) });
  assert.equal(await status(proxied, 'prax.example.com'), 200);
  await proxied.close();
});

// The container image listens on 0.0.0.0 (a loopback bind inside a container
// black-holes published ports) but Compose publishes it on 127.0.0.1 only. The
// bind acknowledgement must not also switch off the rebinding guard there.
const COMPOSE_ENV = { HOST: '0.0.0.0', PRAX_ALLOW_UNAUTHENTICATED_NETWORK: 'true', PORT: '3000', PRAX_ALLOWED_HOSTS: 'localhost' };

test('the Compose environment refuses a rebound hostname and accepts loopback names and IP literals', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig(COMPOSE_ENV) });
  assert.equal(await status(app, 'attacker.example:3100'), 403);
  assert.equal(await status(app, 'attacker.example.'), 403);
  for (const host of ['127.0.0.1:3100', 'localhost:3100', '[::1]:3100', '172.18.0.2:3000', '[fd00::2]:3000']) {
    assert.equal(await status(app, host), 200, host);
  }
  await app.close();
});

test('PRAX_ALLOWED_HOSTS lists a proxy name, case- and trailing-dot-insensitively, and * turns the check off', async () => {
  const proxied = await buildApp({ skipDb: true, config: loadConfig({ ...COMPOSE_ENV, PRAX_ALLOWED_HOSTS: 'Prax.Home.Lan:443, other.example' }) });
  assert.equal(await status(proxied, 'prax.home.lan'), 200);
  assert.equal(await status(proxied, 'PRAX.HOME.LAN.:8443'), 200);
  assert.equal(await status(proxied, 'other.example'), 200);
  assert.equal(await status(proxied, 'attacker.example'), 403);
  await proxied.close();
  const open = await buildApp({ skipDb: true, config: loadConfig({ ...COMPOSE_ENV, PRAX_ALLOWED_HOSTS: '*' }) });
  assert.equal(await status(open, 'anything.example'), 200);
  await open.close();
});

test('PRAX_ALLOWED_HOSTS also narrows an acknowledged loopback bind behind a local proxy', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({ HOST: '127.0.0.1', PRAX_ALLOW_UNAUTHENTICATED_NETWORK: 'true', PRAX_ALLOWED_HOSTS: 'prax.example.com' }) });
  assert.equal(await status(app, 'prax.example.com'), 200);
  assert.equal(await status(app, 'attacker.example'), 403);
  await app.close();
});
