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

test('listDocuments scopes by project when given and omits it otherwise', async () => {
  let captured;
  globalThis.fetch = async (url) => { captured = url; return jsonRes(200, []); };
  const client = createClient({ baseUrl: 'http://x' });
  await client.listDocuments('homelab');
  assert.match(captured, /\/api\/library\/documents\?project=homelab$/);
  await client.listDocuments();
  assert.match(captured, /\/api\/library\/documents$/);
});
