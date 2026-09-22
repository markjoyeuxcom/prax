import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPraxClient, longTimeoutFromEnv, DEFAULT_LONG_TIMEOUT_MS } from '../../mcp/praxClient.js';
import { PraxUnavailableError } from '../../mcp/errors.js';
import { createInsightTools } from '../../mcp/tools/insights.js';

// The MCP client finds the desktop app the way the CLI does, and gives the
// tools that wait on a chat model a timeout long enough for one (QINV-02/03).

const ok = (body) => ({ status: 200, ok: true, text: async () => JSON.stringify(body) });

function portFileWith(port) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-mcp-port-'));
  const file = join(dir, 'webview-port');
  writeFileSync(file, `${port}\n`);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('with no environment it finds the desktop app on its saved port, before the dev default', async () => {
  // A real listener on a random loopback port stands in for the desktop app.
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url === '/readyz' ? '{"status":"ready"}' : '[]');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { file, cleanup } = portFileWith(server.address().port);
  try {
    const client = createPraxClient({ env: {}, portFile: file });
    assert.deepEqual(await client.listTasks({}), []);
    assert.deepEqual(seen, ['GET /readyz', 'GET /api/tasks']);
  } finally {
    cleanup();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('discovery pins one instance: later requests never fail over to the other candidate', async () => {
  const { file, cleanup } = portFileWith(45999);
  try {
    const urls = [];
    let desktopUp = true;
    const fetch = async (url) => {
      urls.push(url);
      if (url.startsWith('http://127.0.0.1:45999') && !desktopUp) throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      return ok([]);
    };
    const client = createPraxClient({ env: {}, portFile: file, fetch });
    await client.listTasks({});
    desktopUp = false;
    await assert.rejects(() => client.createTask({ title: 'x', project: 'p', priority: 'low', status: 'planned' }), PraxUnavailableError);
    assert.ok(urls.every((u) => u.startsWith('http://127.0.0.1:45999')), urls.join(', '));
  } finally {
    cleanup();
  }
});

test('PRAX_API_URL disables discovery, and nothing answering is reported as unreachable', async () => {
  const urls = [];
  const client = createPraxClient({ env: { PRAX_API_URL: 'http://127.0.0.1:3100/' }, fetch: async (url) => { urls.push(url); return ok([]); } });
  await client.listTasks({});
  assert.deepEqual(urls, ['http://127.0.0.1:3100/api/tasks']);

  const { file, cleanup } = portFileWith(45998);
  try {
    const down = createPraxClient({ env: {}, portFile: file, fetch: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(() => down.listTasks({}), /not reachable at http:\/\/127\.0\.0\.1:45998 or http:\/\/127\.0\.0\.1:3000/);
  } finally {
    cleanup();
  }
});

// A fetch that answers after `ms`, honouring the abort signal like the real one.
const slowFetch = (ms) => (url, { signal } = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(ok({ document: { id: 'd' }, answer: 'a' })), ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); });
});

test('generation and ask get the long timeout; other requests keep the short one', async () => {
  // Scaled: a 60 ms "generation" against a 20 ms ordinary timeout.
  const client = createPraxClient({ baseUrl: 'http://x', fetch: slowFetch(60), timeoutMs: 20, longTimeoutMs: 2000 });
  assert.equal((await client.generateRunbook({ description: 'd', project: 'p', id: '11111111-1111-4111-8111-111111111111' })).document.id, 'd');
  assert.equal((await client.generatePostMortem('run', '11111111-1111-4111-8111-111111111111')).document.id, 'd');
  assert.equal((await client.ask({ q: 'x' })).answer, 'a');
  await assert.rejects(() => client.listTasks({}), (err) => err.timedOut === true && /did not answer within 20 ms/.test(err.message));
  assert.ok(DEFAULT_LONG_TIMEOUT_MS >= 120_000, 'at least the server\'s provider timeout');
});

test('PRAX_MCP_TIMEOUT_MS overrides the long timeout and a bad value is a configuration error', async () => {
  assert.equal(longTimeoutFromEnv({}), undefined);
  assert.equal(longTimeoutFromEnv({ PRAX_MCP_TIMEOUT_MS: '300000' }), 300000);
  for (const bad of ['0', '-5', 'soon', '1.5']) {
    assert.throws(() => longTimeoutFromEnv({ PRAX_MCP_TIMEOUT_MS: bad }), /PRAX_MCP_TIMEOUT_MS/);
  }
  const client = createPraxClient({ baseUrl: 'http://x', env: { PRAX_MCP_TIMEOUT_MS: '30' }, fetch: slowFetch(200) });
  await assert.rejects(() => client.ask({ q: 'x' }), /did not answer within 30 ms/);
});

test('a generation timeout says it may still be processing and names the id to retry with', async () => {
  const client = createPraxClient({ baseUrl: 'http://x', fetch: slowFetch(200), longTimeoutMs: 20 });
  const tool = createInsightTools(client).find((t) => t.name === 'generate_runbook');
  const id = '22222222-2222-4222-8222-222222222222';
  const res = await tool.handler({ description: 'd', project: 'p', documentId: id });
  assert.equal(res.isError, true);
  const text = res.content[0].text;
  assert.match(text, /may still be processing/);
  assert.doesNotMatch(text, /unreachable|not reachable/);
  assert.match(text, new RegExp(`documentId="${id}"`));
});

test('agent writes carry x-prax-agent; reads and the in-app client do not', async () => {
  const calls = [];
  const fetch = async (url, options) => { calls.push(options.headers); return ok({ id: 't' }); };
  const client = createPraxClient({ baseUrl: 'http://x', fetch, agent: 'codex' });
  await client.createTask({ id: '11111111-1111-4111-8111-111111111111', title: 't', project: 'p', priority: 'low', status: 'planned' });
  await client.listTasks({});
  assert.equal(calls[0]['x-prax-agent'], 'codex');
  assert.equal(calls[1]['x-prax-agent'], undefined);
  const anonymous = createPraxClient({ baseUrl: 'http://x', fetch, agent: null, env: { PRAX_AGENT: 'claude' } });
  await anonymous.createTask({ title: 't', project: 'p', priority: 'low', status: 'planned' });
  assert.equal(calls[2]['x-prax-agent'], undefined);
  const detected = createPraxClient({ baseUrl: 'http://x', fetch, env: { PRAX_AGENT: 'claude' } });
  await detected.createTask({ title: 't', project: 'p', priority: 'low', status: 'planned' });
  assert.equal(calls[3]['x-prax-agent'], 'claude');
});
