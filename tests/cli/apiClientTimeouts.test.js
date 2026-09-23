// The CLI client bounds every request (review 2026-09-22): a hung app used to
// stall an agent's call for undici's five-minute header timeout. Real loopback
// servers on random ports stand in for an app that accepts and never answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient, timeoutFromEnv, DEFAULT_TIMEOUT_MS, PROBE_TIMEOUT_MS } from '../../cli/lib/apiClient.js';

const CLI = fileURLToPath(new URL('../../cli/prax.js', import.meta.url));

// `handler(req, res)` may leave the response open to play a hung app.
async function withServer(handler, fn) {
  const seen = [];
  const server = createServer((req, res) => { seen.push(`${req.method} ${req.url}`); handler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const hang = () => {};
const json = (body) => (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

test('the defaults are bounded: 30 s per request, 2 s for the discovery probe', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  assert.equal(PROBE_TIMEOUT_MS, 2000);
});

test('a read that gets no answer fails within the bound and says so', async () => {
  await withServer(hang, async (url) => {
    const client = createClient({ baseUrl: url, env: {}, timeoutMs: 150 });
    const started = Date.now();
    await assert.rejects(client.getDocument('d1'), (err) => {
      assert.equal(err.timedOut, true);
      assert.match(err.message, new RegExp(`Prax at ${url} did not answer within 150 ms`));
      assert.match(err.message, /PRAX_TIMEOUT_MS/);
      assert.doesNotMatch(err.message, /Write outcome unknown/);
      return true;
    });
    assert.ok(Date.now() - started < 5000);
  });
});

test('a timed-out write is never re-sent, even one that may retry a lost connection', async () => {
  await withServer(hang, async (url, seen) => {
    const client = createClient({ baseUrl: url, env: {}, timeoutMs: 150 });
    await assert.rejects(
      client.createMemory({ id: '11111111-1111-4111-8111-111111111111', title: 'T', body: 'B' }),
      /^PraxUnavailableError: Write outcome unknown; reconcile before retrying\. .*did not answer within 150 ms — the request may still be processing; it was not re-sent/,
    );
    assert.deepEqual(seen, ['POST /api/library/documents']);
  });
});

test('a response whose body stalls past the deadline times out too', async () => {
  await withServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"id":'); }, async (url) => {
    const client = createClient({ baseUrl: url, env: {}, timeoutMs: 150 });
    await assert.rejects(client.getDocument('d1'), (err) => err.timedOut === true);
  });
});

test('a hung candidate fails its /readyz probe within the probe bound and discovery moves on', async () => {
  await withServer(hang, async (hung) => {
    await withServer(json([]), async (live, seen) => {
      const client = createClient({ bases: [hung, live], env: {}, probeTimeoutMs: 150 });
      assert.deepEqual(await client.listProjects(), []);
      assert.equal(client.base, live);
      assert.deepEqual(seen, ['GET /readyz', 'GET /api/projects']);
    });
  });
});

test('PRAX_TIMEOUT_MS sets the bound; a value that is not a positive integer is refused', async () => {
  assert.equal(timeoutFromEnv({}), undefined);
  assert.equal(timeoutFromEnv({ PRAX_TIMEOUT_MS: '' }), undefined);
  assert.equal(timeoutFromEnv({ PRAX_TIMEOUT_MS: '90000' }), 90_000);
  for (const bad of ['0', '-5', '1.5', 'soon', '1e3']) {
    assert.throws(() => timeoutFromEnv({ PRAX_TIMEOUT_MS: bad }), /PRAX_TIMEOUT_MS must be a positive number of milliseconds/, bad);
  }
  assert.throws(() => createClient({ baseUrl: 'http://x', timeoutMs: Number.NaN }), /timeoutMs must be a positive finite number/);
  await withServer(hang, async (url) => {
    const client = createClient({ baseUrl: url, env: { PRAX_TIMEOUT_MS: '120' } });
    await assert.rejects(client.getDocument('d1'), /did not answer within 120 ms/);
  });
  // The CLI reports a bad setting before contacting anything.
  const res = spawnSync(process.execPath, [CLI, 'get', 'x'], {
    encoding: 'utf8', env: { ...process.env, PRAX_API_URL: 'http://127.0.0.1:9', PRAX_TIMEOUT_MS: 'soon' },
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /PRAX_TIMEOUT_MS must be a positive number of milliseconds \(got "soon"\)/);
});
