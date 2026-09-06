import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../../cli/lib/apiClient.js';

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('request maps a network failure to a friendly not-reachable error', async () => {
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  const client = createClient({ baseUrl: 'http://x' });
  await assert.rejects(
    client.getDocument('d1'),
    /Prax not reachable at http:\/\/x — is the app running\? \(fetch failed\)/,
  );
});

test('request attaches the HTTP status to thrown errors', async () => {
  globalThis.fetch = async () => jsonRes(409, { message: 'semantic search is not enabled' });
  const client = createClient({ baseUrl: 'http://x' });
  await assert.rejects(client.semanticSearch(undefined, 'q', {}), (err) => {
    assert.equal(err.status, 409);
    assert.match(err.message, /semantic search is not enabled/);
    return true;
  });
});

test('ensureProject returns the slug of an existing project without creating', async () => {
  const methods = [];
  globalThis.fetch = async (url, opts) => {
    methods.push(opts?.method || 'GET');
    return jsonRes(200, [{ slug: 'memory', name: 'Memory' }]);
  };
  const client = createClient({ baseUrl: 'http://x' });
  assert.equal(await client.ensureProject('memory'), 'memory');
  assert.deepEqual(methods, ['GET']);
});

test('ensureProject creates the project when missing', async () => {
  const methods = [];
  globalThis.fetch = async (url, opts) => {
    const method = opts?.method || 'GET';
    methods.push(method);
    if (method === 'POST') return jsonRes(201, { slug: 'memory' });
    return jsonRes(200, []);
  };
  const client = createClient({ baseUrl: 'http://x' });
  assert.equal(await client.ensureProject('memory'), 'memory');
  assert.ok(methods.includes('POST'));
});

test('ensureProject reconciles a create whose response was lost', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, opts) => {
    calls += 1;
    if (calls === 1) return jsonRes(200, []);
    if (opts?.method === 'POST') throw new Error('response lost');
    return jsonRes(200, [{ slug: 'memory', name: 'Memory' }]);
  };
  const client = createClient({ baseUrl: 'http://x' });
  assert.equal(await client.ensureProject('memory'), 'memory');
  assert.equal(calls, 3);
});

test('createMemory retries one transport loss only when a stable id is present', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, opts) => {
    calls += 1;
    if (calls === 1) throw new Error('response lost');
    return jsonRes(200, JSON.parse(opts.body));
  };
  const client = createClient({ baseUrl: 'http://x' });
  const doc = { id: '11111111-1111-4111-8111-111111111111', title: 'Stable' };
  assert.deepEqual(await client.createMemory(doc), doc);
  assert.equal(calls, 2);
});

test('listDocuments scopes by project when given and omits it otherwise', async () => {
  let captured;
  globalThis.fetch = async (url) => { captured = url; return jsonRes(200, []); };
  const client = createClient({ baseUrl: 'http://x' });
  await client.listDocuments('homelab');
  assert.match(captured, /\/api\/library\/documents\?project=homelab$/);
  await client.listDocuments();
  assert.match(captured, /\/api\/library\/documents$/);
});

// --- agent identity, base-URL discovery, upsert ---------------------------------
import { resolveBaseUrls, detectAgent, desktopPortFile, sanitizeAgentId } from '../../cli/lib/apiClient.js';

test('detectAgent: PRAX_AGENT wins, then the Claude Code and Codex shell markers, else null', () => {
  assert.equal(detectAgent({ PRAX_AGENT: 'Aider', CLAUDECODE: '1' }), 'aider');
  assert.equal(detectAgent({ CLAUDECODE: '1' }), 'claude');
  assert.equal(detectAgent({ CODEX_THREAD_ID: 't' }), 'codex');
  assert.equal(detectAgent({ CODEX_SESSION_ID: 's' }), 'codex');
  assert.equal(detectAgent({}), null);
  assert.equal(detectAgent({ PRAX_AGENT: 'bad id!' }), null);
  assert.equal(sanitizeAgentId('  Claude.Code-1 '), 'claude.code-1');
});

test('desktopPortFile: the Tauri app-data location per platform', () => {
  assert.equal(desktopPortFile({ os: 'darwin', home: '/Users/me', env: {} }), '/Users/me/Library/Application Support/com.moomora.prax/webview-port');
  assert.equal(desktopPortFile({ os: 'linux', home: '/home/me', env: {} }), '/home/me/.local/share/com.moomora.prax/webview-port');
  assert.equal(desktopPortFile({ os: 'linux', home: '/home/me', env: { XDG_DATA_HOME: '/data' } }), '/data/com.moomora.prax/webview-port');
  assert.equal(desktopPortFile({ os: 'win32', home: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } }).endsWith('com.moomora.prax/webview-port'), true);
});

test('resolveBaseUrls: an explicit URL is the only candidate; otherwise desktop port then 3000', () => {
  assert.deepEqual(resolveBaseUrls({ env: { PRAX_API_URL: 'http://x:9/' }, read: () => '51623' }), ['http://x:9']);
  assert.deepEqual(resolveBaseUrls({ env: { MOOMORA_API_URL: 'http://old' }, read: () => '51623' }), ['http://old']);
  assert.deepEqual(resolveBaseUrls({ env: {}, portFile: '/p', read: () => '51623\n' }), ['http://127.0.0.1:51623', 'http://127.0.0.1:3000']);
  assert.deepEqual(resolveBaseUrls({ env: {}, portFile: '/p', read: () => 'garbage' }), ['http://127.0.0.1:3000']);
  assert.deepEqual(resolveBaseUrls({ env: {}, portFile: '/p', read: () => { throw new Error('ENOENT'); } }), ['http://127.0.0.1:3000']);
});

test('a read discovers with one /readyz probe per candidate and pins the first that answers', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (url.startsWith('http://desktop')) throw new Error('ECONNREFUSED');
    return jsonRes(200, { id: 'd1' });
  };
  const client = createClient({ bases: ['http://desktop', 'http://dev'], env: {} });
  assert.deepEqual(await client.getDocument('d1'), { id: 'd1' });
  assert.equal(client.base, 'http://dev');
  await client.getDocument('d1');
  assert.deepEqual(urls, ['http://desktop/readyz', 'http://dev/readyz', 'http://dev/api/library/documents/d1', 'http://dev/api/library/documents/d1']);
});

test('request reports every candidate when none answers', async () => {
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  const client = createClient({ bases: ['http://a', 'http://b'], env: {} });
  await assert.rejects(client.getDocument('d1'), /Prax not reachable at http:\/\/a or http:\/\/b/);
});

test('agent writes carry x-prax-origin and, when known, x-prax-agent; reads carry neither', async () => {
  const seen = [];
  globalThis.fetch = async (url, opts) => { seen.push({ url, headers: opts.headers }); return jsonRes(200, { document: { id: 'm' }, created: true }); };
  const client = createClient({ baseUrl: 'http://x', env: { CLAUDECODE: '1' } });
  await client.upsertMemory({ id: '11111111-1111-4111-8111-111111111111', title: 'T', body: 'B', project: 'memory' });
  assert.match(seen[0].url, /\/api\/library\/documents\/upsert-by-title$/);
  assert.equal(seen[0].headers['x-prax-origin'], 'agent');
  assert.equal(seen[0].headers['x-prax-agent'], 'claude');
  await client.getDocument('m');
  assert.equal(seen[1].headers['x-prax-origin'], undefined);
  assert.equal(seen[1].headers['x-prax-agent'], undefined);
  const anonymous = createClient({ baseUrl: 'http://x', env: {} });
  await anonymous.createMemory({ title: 'T' });
  assert.equal(seen[2].headers['x-prax-origin'], 'agent');
  assert.equal('x-prax-agent' in seen[2].headers, false);
  const explicit = createClient({ baseUrl: 'http://x', env: { CLAUDECODE: '1' }, agent: 'codex' });
  await explicit.createMemory({ title: 'T' });
  assert.equal(seen[3].headers['x-prax-agent'], 'codex');
});

test('listDocuments forwards a status filter', async () => {
  let captured;
  globalThis.fetch = async (url) => { captured = url; return jsonRes(200, []); };
  const client = createClient({ baseUrl: 'http://x', env: {} });
  await client.listDocuments('memory', { status: 'active' });
  assert.match(captured, /\/api\/library\/documents\?project=memory&status=active$/);
});

// --- instance binding: a write never fails over to another Prax --------------------

test('a write before pinning probes /readyz, pins the first instance that answers, and never fails over', async () => {
  const seen = [];
  let desktopPosts = 0;
  globalThis.fetch = async (url, opts) => {
    seen.push(`${opts?.method || 'GET'} ${url}`);
    if (url === 'http://desktop/readyz') return jsonRes(200, { status: 'ready' });
    if (url.startsWith('http://desktop/')) {
      desktopPosts += 1;
      // The first POST commits on the server but its response is lost.
      if (desktopPosts === 1) throw new Error('socket hang up');
      return jsonRes(200, { document: { id: 'm' }, created: false, replayed: true });
    }
    // The fallback instance would happily accept the same write — it must never be asked.
    return jsonRes(201, { document: { id: 'wrong-workspace' }, created: true });
  };
  const client = createClient({ bases: ['http://desktop', 'http://dev'], env: {} });
  const result = await client.upsertMemory({ id: '11111111-1111-4111-8111-111111111111', title: 'T', body: 'B', project: 'memory' });
  assert.equal(result.document.id, 'm');
  assert.equal(client.base, 'http://desktop');
  assert.deepEqual(seen, [
    'GET http://desktop/readyz',
    'POST http://desktop/api/library/documents/upsert-by-title',
    'POST http://desktop/api/library/documents/upsert-by-title',
  ]);
});

test('once pinned by a read, a later connection failure reports that instance instead of trying another', async () => {
  const seen = [];
  let calls = 0;
  globalThis.fetch = async (url) => {
    seen.push(url);
    calls += 1;
    // The probe and the first read succeed; then the instance goes away.
    if (calls <= 2) return jsonRes(200, { id: 'd1' });
    throw new Error('ECONNREFUSED');
  };
  const client = createClient({ bases: ['http://desktop', 'http://dev'], env: {} });
  await client.getDocument('d1');
  await assert.rejects(client.getDocument('d2'), /Prax not reachable at http:\/\/desktop — is the app running\?/);
  assert.deepEqual(seen, ['http://desktop/readyz', 'http://desktop/api/library/documents/d1', 'http://desktop/api/library/documents/d2']);
});

test('a write with no reachable instance names every candidate and sends nothing', async () => {
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(url); throw new Error('ECONNREFUSED'); };
  const client = createClient({ bases: ['http://desktop', 'http://dev'], env: {} });
  await assert.rejects(client.upsertMemory({ title: 'T' }), /Prax not reachable at http:\/\/desktop or http:\/\/dev/);
  assert.deepEqual(seen, ['http://desktop/readyz', 'http://dev/readyz']);
});

test('semanticSearch asks for the paged route with a bounded limit and normalises both response shapes', async () => {
  let captured;
  globalThis.fetch = async (url) => {
    captured = url;
    return jsonRes(200, { items: [{ id: 'a' }], page: { returned: 1, total: 1, hasMore: false }, index: { total: 2, embedded: 1, pending: 1 }, degraded: true, reason: 'index-incomplete' });
  };
  const client = createClient({ baseUrl: 'http://x', env: {} });
  const paged = await client.semanticSearch('memory', 'q', { limit: 500 });
  assert.match(captured, /semantic-search\?q=q&page=true&project=memory&limit=50$/);
  assert.equal(paged.degraded, true);
  assert.equal(paged.reason, 'index-incomplete');
  assert.deepEqual(paged.index, { total: 2, embedded: 1, pending: 1 });
  assert.deepEqual(paged.items, [{ id: 'a' }]);

  globalThis.fetch = async () => jsonRes(200, [{ id: 'legacy' }]);
  const legacy = await client.semanticSearch(undefined, 'q', { limit: 3 });
  assert.deepEqual(legacy, { items: [{ id: 'legacy' }], page: null, index: null, degraded: false, reason: 'coverage-unknown', legacy: true });
});

// --- discovery is shared and the pin is immutable (Codex F1) --------------------------

test('concurrent first writes share one discovery and land on the same instance, even when a probe completes late', async () => {
  const seen = [];
  let readyProbes = 0;
  globalThis.fetch = async (url, opts) => {
    seen.push(`${opts?.method || 'GET'} ${url}`);
    if (url === 'http://desktop/readyz') {
      readyProbes += 1;
      // The first probe is slow; a naive client would start a second discovery meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonRes(200, { status: 'ready' });
    }
    if (url.startsWith('http://desktop/')) return jsonRes(200, { document: { id: 'desktop-doc' }, created: true });
    return jsonRes(200, { document: { id: 'WRONG' }, created: true });
  };
  const client = createClient({ bases: ['http://desktop', 'http://dev'], env: {} });
  const doc = { id: '22222222-2222-4222-8222-222222222222', title: 'T', body: 'B', project: 'memory' };
  const [a, b, read] = await Promise.all([client.upsertMemory(doc), client.upsertMemory(doc), client.getDocument('x')]);
  assert.equal(a.document.id, 'desktop-doc');
  assert.equal(b.document.id, 'desktop-doc');
  assert.equal(read.document.id, 'desktop-doc');
  assert.equal(readyProbes, 1, 'exactly one discovery probe for the whole process');
  assert.equal(seen.filter((s) => s.includes('http://dev')).length, 0, 'the fallback instance is never contacted');
  assert.equal(client.base, 'http://desktop');
});

test('a late-finishing read cannot re-pin the client after a write has bound it', async () => {
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push(`${opts?.method || 'GET'} ${url}`);
    if (url === 'http://desktop/readyz') return jsonRes(200, { status: 'ready' });
    if (url === 'http://desktop/api/library/documents/slow') {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonRes(200, { id: 'slow' });
    }
    if (url.startsWith('http://desktop/')) return jsonRes(200, { document: { id: 'm' }, created: true });
    throw new Error('dev must never be contacted');
  };
  const client = createClient({ bases: ['http://desktop', 'http://dev'], env: {} });
  const slowRead = client.getDocument('slow');
  await client.upsertMemory({ id: '33333333-3333-4333-8333-333333333333', title: 'T', body: 'B', project: 'memory' });
  assert.equal(client.base, 'http://desktop');
  await slowRead;
  assert.equal(client.base, 'http://desktop');
  assert.equal(seen.filter((s) => s.includes('/readyz')).length, 1);
  assert.equal(seen.some((s) => s.includes('http://dev')), false);
});

test('a failed discovery is retried by the next request rather than cached forever', async () => {
  let up = false;
  globalThis.fetch = async () => {
    if (!up) throw new Error('ECONNREFUSED');
    return jsonRes(200, { id: 'd' });
  };
  const client = createClient({ bases: ['http://desktop', 'http://dev'], env: {} });
  await assert.rejects(client.getDocument('d'), /not reachable at http:\/\/desktop or http:\/\/dev/);
  up = true;
  assert.deepEqual(await client.getDocument('d'), { id: 'd' });
  assert.equal(client.base, 'http://desktop');
});
