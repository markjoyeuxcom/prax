// The CLI and MCP clients share one transport (server/praxTransport.js): the
// same token precedence, error classes, wording and timeout handling. Each
// assertion runs against both clients so they cannot drift apart again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createClient } from '../../cli/lib/apiClient.js';
import { createPraxClient } from '../../mcp/praxClient.js';
import {
  PraxApiError, PraxUnavailableError, createTransport, tokenFromEnv, MCP_TIMEOUT_MS,
} from '../../server/praxTransport.js';

const json = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// Both clients, each with a read and a write, over an injected fetch.
const clients = {
  cli: (options) => {
    const client = createClient(options);
    return { read: () => client.getDocument('d1'), write: () => client.importTasks({ tasks: [] }) };
  },
  mcp: (options) => {
    const client = createPraxClient(options);
    return { read: () => client.listTasks({}), write: () => client.createTask({ title: 't' }) };
  },
};

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('token precedence: an explicit token, then PRAX_API_TOKEN, then PRAX_TOKEN, then MOOMORA_API_TOKEN', async () => {
  assert.equal(tokenFromEnv({ PRAX_API_TOKEN: 'a', PRAX_TOKEN: 'b', MOOMORA_API_TOKEN: 'c' }), 'a');
  assert.equal(tokenFromEnv({ PRAX_API_TOKEN: '', PRAX_TOKEN: 'b', MOOMORA_API_TOKEN: 'c' }), 'b');
  assert.equal(tokenFromEnv({ MOOMORA_API_TOKEN: 'c' }), 'c');
  assert.equal(tokenFromEnv({}), undefined);
  for (const [name, make] of Object.entries(clients)) {
    const seen = [];
    const fetch = async (_url, opts) => { seen.push(opts.headers.authorization); return json(200, []); };
    await make({ baseUrl: 'http://x', fetch, env: { PRAX_API_TOKEN: 'api', PRAX_TOKEN: 'plain' } }).read();
    await make({ baseUrl: 'http://x', fetch, env: { PRAX_TOKEN: 'plain' } }).read();
    await make({ baseUrl: 'http://x', fetch, env: { PRAX_TOKEN: 'plain' }, token: 'explicit' }).read();
    await make({ baseUrl: 'http://x', fetch, env: {} }).read();
    assert.deepEqual(seen, ['Bearer api', 'Bearer plain', 'Bearer explicit', undefined], name);
  }
});

test('both clients classify failures with the same classes and wording', async () => {
  for (const [name, make] of Object.entries(clients)) {
    if (name === 'mcp') {
      // The MCP client has no `bases`; its candidates come from discovery.
      await assert.rejects(
        createPraxClient({ env: {}, portFile: '/nonexistent', fetch: async () => { throw new TypeError('fetch failed'); } }).listTasks({}),
        (err) => err instanceof PraxUnavailableError && err.kind === 'unreachable' && err.timedOut === false
          && /^Prax not reachable at http:\/\/127\.0\.0\.1:3000 — is the app running\? \(fetch failed\)$/.test(err.message),
      );
    } else {
      const down = make({ bases: ['http://a', 'http://b'], env: {}, fetch: async () => { throw new TypeError('fetch failed'); } });
      await assert.rejects(down.read(), (err) => err instanceof PraxUnavailableError
        && err.message === 'Prax not reachable at http://a or http://b — is the app running? (fetch failed)');
    }
    // A pinned instance that drops the connection: a write's outcome is unknown.
    const lost = make({ baseUrl: 'http://x', env: {}, fetch: async () => { throw new TypeError('socket hang up'); } });
    await assert.rejects(lost.write(), (err) => err instanceof PraxUnavailableError
      && err.message === 'Write outcome unknown; reconcile before retrying. Prax not reachable at http://x — is the app running? (socket hang up)', name);
    await assert.rejects(lost.read(), (err) => err instanceof PraxUnavailableError
      && err.message === 'Prax not reachable at http://x — is the app running? (socket hang up)', name);
    const refused = make({ baseUrl: 'http://x', env: {}, fetch: async () => json(422, { message: 'title is required' }) });
    await assert.rejects(refused.write(), (err) => err instanceof PraxApiError && err.status === 422
      && err.kind === 'http' && err.message === 'title is required', name);
  }
});

test('a timed-out write says its outcome is unknown and names the setting; a stalled body times out too', async () => {
  const hang = () => {};
  await withServer(hang, async (url) => {
    for (const [name, make] of Object.entries(clients)) {
      await assert.rejects(make({ baseUrl: url, env: {}, timeoutMs: 100 }).write(), (err) => {
        assert.ok(err instanceof PraxUnavailableError, name);
        assert.equal(err.kind, 'timeout');
        assert.equal(err.timedOut, true);
        assert.equal(err.timeoutMs, 100);
        assert.match(err.message, new RegExp(`^Write outcome unknown; reconcile before retrying\\. Prax at ${url} did not answer within 100 ms — the request may still be processing; it was not re-sent\\. Set PRAX_TIMEOUT_MS to wait longer\\.`));
        return true;
      });
    }
  });
  const stall = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"id":'); };
  await withServer(stall, async (url) => {
    for (const make of Object.values(clients)) {
      await assert.rejects(make({ baseUrl: url, env: {}, timeoutMs: 100 }).read(), (err) => err instanceof PraxUnavailableError && err.timedOut);
    }
  });
  // A long request names the long setting.
  await withServer(hang, async (url) => {
    const client = createPraxClient({ baseUrl: url, env: {}, longTimeoutMs: 100 });
    await assert.rejects(client.ask({ q: 'x' }), /did not answer within 100 ms .*Set PRAX_MCP_TIMEOUT_MS to wait longer/);
  });
});

test('PRAX_TIMEOUT_MS bounds the MCP client\'s ordinary requests too; its default stays 5 s', async () => {
  assert.equal(MCP_TIMEOUT_MS, 5000);
  await withServer(() => {}, async (url) => {
    await assert.rejects(createPraxClient({ baseUrl: url, env: { PRAX_TIMEOUT_MS: '80' } }).listTasks({}), /did not answer within 80 ms/);
  });
  assert.throws(() => createPraxClient({ baseUrl: 'http://x', env: { PRAX_TIMEOUT_MS: 'soon' } }), /PRAX_TIMEOUT_MS must be a positive number of milliseconds/);
});

test('a retry happens only when the caller allows it, and connect-only only for a proven pre-connection failure', async () => {
  const cases = [
    [false, 'ECONNREFUSED', 1],
    [true, 'ECONNRESET', 2],
    ['connect-only', 'ECONNREFUSED', 2],
    ['connect-only', 'ENOTFOUND', 2],
    ['connect-only', 'ECONNRESET', 1],
    ['connect-only', undefined, 1],
  ];
  for (const [retry, code, expected] of cases) {
    let calls = 0;
    const transport = createTransport({ baseUrl: 'http://x', env: {}, fetch: async () => {
      calls += 1;
      throw new TypeError('fetch failed', code ? { cause: { code } } : undefined);
    } });
    await assert.rejects(transport.request('POST', '/w', { body: {}, retry, parse: async () => null }), PraxUnavailableError);
    assert.equal(calls, expected, `retry=${retry} code=${code}`);
  }
  // A timeout is never re-sent, whatever the caller allows.
  let calls = 0;
  const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  const transport = createTransport({ baseUrl: 'http://x', env: {}, fetch: async () => { calls += 1; throw timeout; } });
  await assert.rejects(transport.request('POST', '/w', { body: {}, retry: true, parse: async () => null }), (err) => err.timedOut);
  assert.equal(calls, 1);
});

test('agent writes carry the origin and agent id; reads and an agent-less client do not', async () => {
  const seen = [];
  const fetch = async (_url, opts) => { seen.push(opts.headers); return json(200, {}); };
  const transport = createTransport({ baseUrl: 'http://x', env: { CLAUDECODE: '1' }, fetch });
  await transport.request('POST', '/w', { body: {}, agentWrite: true, parse: async () => null });
  await transport.request('GET', '/r', { parse: async () => null });
  await createTransport({ baseUrl: 'http://x', env: { CLAUDECODE: '1' }, agent: null, fetch })
    .request('POST', '/w', { body: {}, agentWrite: true, parse: async () => null });
  assert.equal(seen[0]['x-prax-origin'], 'agent');
  assert.equal(seen[0]['x-prax-agent'], 'claude');
  assert.equal('x-prax-origin' in seen[1], false);
  assert.equal('x-prax-agent' in seen[1], false);
  assert.equal(seen[2]['x-prax-origin'], 'agent');
  assert.equal('x-prax-agent' in seen[2], false);
});

test('invalid bounds are configuration errors in both clients', () => {
  for (const bad of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => createClient({ baseUrl: 'http://x', timeoutMs: bad }), /timeoutMs must be a positive finite number/);
    assert.throws(() => createPraxClient({ baseUrl: 'http://x', timeoutMs: bad }), /timeoutMs must be a positive finite number/);
    assert.throws(() => createPraxClient({ baseUrl: 'http://x', longTimeoutMs: bad }), /longTimeoutMs must be a positive finite number/);
  }
});
