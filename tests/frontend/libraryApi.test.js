import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveDocument,
  createDocument,
  deleteDocumentPermanently,
  fetchDocumentLinks,
  fetchDocuments,
  fetchOrphanDocuments,
  fetchStaleDocuments,
  restoreDocument,
  supersedeDocument,
  updateDocument,
  verifyDocument,
  putSemanticSettings,
} from '../../public/js/libraryApi.js';

function jsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

test('fetchDocuments loads Markdown documents with filters', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse([{ id: 'doc-1' }]);
  };

  const documents = await fetchDocuments({ context: 'homelab', archived: true });

  assert.deepEqual(documents, [{ id: 'doc-1' }]);
  assert.equal(calls[0][0], '/api/library/documents?context=homelab&archived=true');
});

test('createDocument posts Markdown document payloads', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'doc-1', title: 'Runbook' });
  };

  const document = await createDocument({ title: 'Runbook', body: '# Runbook' });

  assert.deepEqual(document, { id: 'doc-1', title: 'Runbook' });
  assert.equal(calls[0][0], '/api/library/documents');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(calls[0][1].headers, { 'content-type': 'application/json' });
  assert.equal(calls[0][1].body, JSON.stringify({ title: 'Runbook', body: '# Runbook' }));
});

test('updateDocument patches Markdown document fields', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'doc-1', title: 'Updated' });
  };

  await updateDocument('doc-1', { title: 'Updated' });

  assert.equal(calls[0][0], '/api/library/documents/doc-1');
  assert.equal(calls[0][1].method, 'PATCH');
  assert.equal(calls[0][1].body, JSON.stringify({ title: 'Updated' }));
});

test('archive restore and delete call document lifecycle endpoints', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'doc-1' });
  };

  await archiveDocument('doc-1');
  await restoreDocument('doc-1');
  await deleteDocumentPermanently('doc-1');

  assert.deepEqual(calls.map(call => [call[0], call[1].method]), [
    ['/api/library/documents/doc-1', 'DELETE'],
    ['/api/library/documents/doc-1/restore', 'PATCH'],
    ['/api/library/documents/doc-1/permanent', 'DELETE'],
  ]);
});

test('library API helpers throw when requests fail', async () => {
  globalThis.fetch = async () => jsonResponse({ message: 'nope' }, false);

  await assert.rejects(
    () => fetchDocuments(),
    /Failed to load documents/,
  );
  await assert.rejects(
    () => createDocument({}),
    /Failed to create document/,
  );
});

test('fetchDocumentLinks calls the links endpoint with direction', async () => {
  let capturedUrl, capturedOpts;
  globalThis.fetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, json: async () => [] }; };
  await fetchDocumentLinks('doc-1', 'both');
  assert.equal(capturedUrl, '/api/library/documents/doc-1/links?direction=both');
  assert.equal(capturedOpts, undefined);
});

test('fetchStaleDocuments calls the maintenance endpoint with project', async () => {
  let capturedUrl, capturedOpts;
  globalThis.fetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, json: async () => [] }; };
  await fetchStaleDocuments('homelab');
  assert.equal(capturedUrl, '/api/library/maintenance/stale?project=homelab');
  assert.equal(capturedOpts, undefined);
});

test('fetchOrphanDocuments omits empty project', async () => {
  let capturedUrl, capturedOpts;
  globalThis.fetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, json: async () => [] }; };
  await fetchOrphanDocuments('');
  assert.equal(capturedUrl, '/api/library/maintenance/orphans');
  assert.equal(capturedOpts, undefined);
});

test('fetchDocumentLinks defaults to direction=both when no direction given', async () => {
  let capturedUrl, capturedOpts;
  globalThis.fetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, json: async () => [] }; };
  await fetchDocumentLinks('doc-1');
  assert.ok(capturedUrl.endsWith('?direction=both'), `expected URL to end with ?direction=both, got: ${capturedUrl}`);
  assert.equal(capturedOpts, undefined);
});

test('new library API helpers throw when requests fail', async () => {
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(fetchDocumentLinks('x', 'both'), /Failed to load document links/);
  await assert.rejects(fetchStaleDocuments('homelab'), /Failed to load stale documents/);
  await assert.rejects(fetchOrphanDocuments(''), /Failed to load orphan documents/);
});

test('verifyDocument posts verified:true with as:user to the verify route', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse({ id: 'doc-1', verified: true }); };

  const result = await verifyDocument('doc-1', true);

  assert.deepEqual(result, { id: 'doc-1', verified: true });
  assert.equal(calls[0][0], '/api/library/documents/doc-1/verify');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { verified: true, as: 'user' });
});

test('verifyDocument posts verified:false on the unverify path', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse({ id: 'doc-1', verified: false }); };

  await verifyDocument('doc-1', false);

  assert.deepEqual(JSON.parse(calls[0][1].body), { verified: false, as: 'user' });
});

test('supersedeDocument posts supersededBy to the supersede route', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse({ id: 'old', status: 'superseded' }); };

  const result = await supersedeDocument('old', 'new');

  assert.deepEqual(result, { id: 'old', status: 'superseded' });
  assert.equal(calls[0][0], '/api/library/documents/old/supersede');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { supersededBy: 'new' });
});

test('putSemanticSettings PUTs provider config and returns the fresh status', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({ available: true, backend: 'ollama', hasApiKey: false }) };
  };
  const status = await putSemanticSettings({ backend: 'ollama', model: 'nomic-embed-text' });
  assert.equal(calls[0][0], '/api/settings/semantic-search');
  assert.equal(calls[0][1].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0][1].body), { backend: 'ollama', model: 'nomic-embed-text' });
  assert.equal(status.backend, 'ollama');
});

test('putSemanticSettings surfaces the server message on failure', async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: 'backend is invalid' }) });
  await assert.rejects(() => putSemanticSettings({ backend: 'nope' }), /backend is invalid/);
});
