import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { isCrossSiteRequest, loadConfig } from '../../server/config.js';

// Cross-site request forgery: the Host check (hostHeader.test.js) cannot stop
// a page on evil.example from POSTing to http://127.0.0.1:<port> — that Host
// is honest. Browsers label such requests (Sec-Fetch-Site, Origin); a
// state-changing one from another site is refused before routing. CLI and MCP
// send neither header and must keep working.

const PROBE = '/api/__cross-site-probe'; // no such route: 404 = passed the gate, 403 = refused
const LOOPBACK = { host: '127.0.0.1:3000' };

async function status(app, method, headers, url = PROBE) {
  return (await app.inject({ method, url, headers })).statusCode;
}

test('a state-changing request a browser marks as cross-site or same-site is refused before routing', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(await status(app, method, { ...LOOPBACK, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), 403, method);
    // Another port on localhost is same-site but a different application.
    assert.equal(await status(app, method, { ...LOOPBACK, 'sec-fetch-site': 'same-site', origin: 'http://127.0.0.1:5173' }), 403, method);
  }
  const body = (await app.inject({ method: 'POST', url: PROBE, headers: { ...LOOPBACK, 'sec-fetch-site': 'cross-site' } })).json();
  assert.match(body.message, /Cross-site/);
  await app.close();
});

test('without Sec-Fetch-Site, a foreign, opaque or other-port Origin is refused', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3001', 'http://localhost:3000', 'file://', '']) {
    assert.equal(await status(app, 'POST', { ...LOOPBACK, origin }), 403, origin);
  }
  await app.close();
});

test('same-origin browser requests, CLI/MCP requests and safe methods pass', async () => {
  const app = await buildApp({ skipDb: true, config: loadConfig({}) });
  // Same-origin browser request, with and without Sec-Fetch-Site (older Safari).
  assert.equal(await status(app, 'POST', { ...LOOPBACK, 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3000' }), 404);
  assert.equal(await status(app, 'PATCH', { ...LOOPBACK, origin: 'http://127.0.0.1:3000' }), 404);
  assert.equal(await status(app, 'DELETE', { host: 'LOCALHOST:3000', origin: 'http://localhost:3000' }), 404);
  // A default port is spelled either way.
  assert.equal(await status(app, 'POST', { host: 'localhost:80', origin: 'http://localhost' }), 404);
  // CLI / MCP / curl: no Origin, no Sec-Fetch-Site.
  assert.equal(await status(app, 'POST', LOOPBACK), 404);
  // A user-typed navigation.
  assert.equal(await status(app, 'POST', { ...LOOPBACK, 'sec-fetch-site': 'none' }), 404);
  // Reads are never refused by this gate (cross-site pages cannot read the answer).
  assert.equal(await status(app, 'GET', { ...LOOPBACK, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, '/healthz'), 200);
  assert.equal(await status(app, 'HEAD', { ...LOOPBACK, 'sec-fetch-site': 'cross-site' }, '/healthz'), 200);
  await app.close();
});

test('a proxy that rewrites Host keeps working: Sec-Fetch-Site same-origin, or an Origin in PRAX_ALLOWED_HOSTS', async () => {
  const env = { HOST: '127.0.0.1', PRAX_ALLOW_UNAUTHENTICATED_NETWORK: 'true' };
  const proxied = { host: '127.0.0.1:3000', origin: 'https://prax.example.com' };
  const plain = await buildApp({ skipDb: true, config: loadConfig(env) });
  // Current browsers send Sec-Fetch-Site, which a page cannot forge.
  assert.equal(await status(plain, 'POST', { ...proxied, 'sec-fetch-site': 'same-origin' }), 404);
  // Without it the Origin must match the (rewritten) Host — it does not.
  assert.equal(await status(plain, 'POST', proxied), 403);
  await plain.close();

  const named = await buildApp({ skipDb: true, config: loadConfig({ ...env, PRAX_ALLOWED_HOSTS: 'prax.example.com' }) });
  assert.equal(await status(named, 'POST', proxied), 404);
  assert.equal(await status(named, 'POST', { ...proxied, origin: 'https://evil.example' }), 403);
  assert.equal(await status(named, 'POST', { host: 'prax.example.com', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), 403);
  await named.close();

  // `*` turns the Host check off, not the cross-site gate: it guards the user's browser.
  const open = await buildApp({ skipDb: true, config: loadConfig({ ...env, PRAX_ALLOWED_HOSTS: '*' }) });
  assert.equal(await status(open, 'POST', { host: 'anything.example', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), 403);
  assert.equal(await status(open, 'POST', { host: 'anything.example', origin: 'https://evil.example' }), 403);
  assert.equal(await status(open, 'POST', { host: 'anything.example', origin: 'https://anything.example' }), 404);
  await open.close();
});

test('isCrossSiteRequest is a pure function of method and headers', () => {
  const config = loadConfig({});
  assert.equal(isCrossSiteRequest({ method: 'post', headers: { 'sec-fetch-site': 'cross-site' } }, config), true);
  assert.equal(isCrossSiteRequest({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }, config), false);
  assert.equal(isCrossSiteRequest({ method: 'POST', headers: {} }, config), false);
  assert.equal(isCrossSiteRequest({ method: 'POST', headers: { host: '[::1]:3000', origin: 'http://[::1]:3000' } }, config), false);
  assert.equal(isCrossSiteRequest({ method: 'POST', headers: { host: '[::1]:3000', origin: 'http://[::1]:3001' } }, config), true);
});

// ---- the bodiless routes the review reproduced ------------------------------

async function realApp() {
  const calls = [];
  const googleFetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }), googleFetch });
  return { app, calls };
}

test('a cross-site page can no longer disconnect Google Calendar or create a task', async () => {
  const { app, calls } = await realApp();
  const evil = { ...LOOPBACK, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
  const disconnect = await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/disconnect', headers: evil });
  assert.equal(disconnect.statusCode, 403);
  assert.equal(calls.some((c) => c.url.includes('revoke')), false, 'nothing reached Google');
  const created = await app.inject({
    method: 'POST', url: '/api/tasks', headers: { ...LOOPBACK, origin: 'https://evil.example' },
    payload: { title: 'Planted', project: 'inbox', priority: 'medium', status: 'planned' },
  });
  assert.equal(created.statusCode, 403);
  const weekly = await app.inject({ method: 'POST', url: '/api/library/weekly-review', headers: { ...evil, 'content-type': 'text/plain' }, payload: 'x' });
  assert.equal(weekly.statusCode, 403);

  // The same requests from the app's own page, and from the CLI, still work.
  const own = await app.inject({
    method: 'POST', url: '/api/tasks', headers: { ...LOOPBACK, origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' },
    payload: { title: 'Mine', project: 'inbox', priority: 'medium', status: 'planned' },
  });
  assert.equal(own.statusCode, 201);
  const cli = await app.inject({
    method: 'POST', url: '/api/tasks', headers: LOOPBACK,
    payload: { title: 'From the CLI', project: 'inbox', priority: 'medium', status: 'planned' },
  });
  assert.equal(cli.statusCode, 201);
  await app.close();
});

test('pending Google OAuth states are bounded: repeated Connect evicts the oldest', async () => {
  const { app } = await realApp();
  await app.inject({
    method: 'PUT', url: '/api/integrations/google-calendar/settings',
    payload: { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shhh' },
  });
  const states = [];
  for (let i = 0; i < 40; i += 1) {
    const res = await app.inject({ method: 'POST', url: '/api/integrations/google-calendar/connect', headers: LOOPBACK });
    assert.equal(res.statusCode, 200);
    states.push(new URL(res.json().authUrl).searchParams.get('state'));
  }
  // The oldest consent was evicted; the newest is still redeemable (it only
  // fails later, at the stubbed token exchange, not as an unknown state).
  const oldest = await app.inject({ method: 'GET', url: `/api/integrations/google-calendar/callback?code=c&state=${states[0]}` });
  assert.equal(oldest.statusCode, 400);
  assert.match(oldest.body, /expired or was already used/);
  const newest = await app.inject({ method: 'GET', url: `/api/integrations/google-calendar/callback?code=c&state=${states.at(-1)}` });
  assert.doesNotMatch(newest.body, /expired or was already used/);
  await app.close();
});
