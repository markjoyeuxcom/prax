import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveDocument,
  createDocument,
  deleteDocumentPermanently,
  fetchDocument,
  fetchDocumentLinks,
  fetchDeploymentStatus,
  fetchDocuments,
  fetchStaleDocuments,
  fetchRun,
  restoreDocument,
  unlinkDocuments,
  supersedeDocument,
  updateDocument,
  verifyDocument,
  putSemanticSettings,
  semanticSearch,
  setRunStatus,
  setRunStep,
  startRun,
} from '../../public/js/libraryApi.js';

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
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

test('fetchDocument reads the canonical document used for save reconciliation', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'doc-1', title: 'Saved', body: '# Saved' });
  };

  assert.deepEqual(await fetchDocument('doc-1'), { id: 'doc-1', title: 'Saved', body: '# Saved' });
  assert.equal(calls[0][0], '/api/library/documents/doc-1');
  assert.equal(calls[0][1], undefined);
});

test('fetchDocument preserves HTTP status for lifecycle absence reconciliation', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => fetchDocument('gone'),
    error => error.message === 'Failed to load document' && error.status === 404,
  );
});

test('fetchDeploymentStatus reads the non-secret bind and authentication boundary', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ authentication: 'none', bindHost: '127.0.0.1', networkScope: 'local' });
  };

  assert.deepEqual(await fetchDeploymentStatus(), {
    authentication: 'none', bindHost: '127.0.0.1', networkScope: 'local',
  });
  assert.equal(calls[0][0], '/api/settings/deployment');
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

test('createDocument preserves the server message and status for conflicting exact-once identities', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ message: 'document id was already used for different content' }),
  });

  await assert.rejects(
    () => createDocument({ id: 'same-id' }),
    error => error.status === 409 && error.message === 'document id was already used for different content',
  );
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
    () => fetchDocument('doc-1'),
    /Failed to load document/,
  );
  await assert.rejects(
    () => createDocument({}),
    /nope/,
  );
});

test('fetchDocumentLinks calls the links endpoint with direction', async () => {
  let capturedUrl, capturedOpts;
  globalThis.fetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, json: async () => [] }; };
  await fetchDocumentLinks('doc-1', 'both');
  assert.equal(capturedUrl, '/api/library/documents/doc-1/links?direction=both');
  assert.equal(capturedOpts, undefined);
});

test('unlinkDocuments deletes one exact typed document link', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse([]); };
  await unlinkDocuments('new', 'old', 'supersedes');
  assert.equal(calls[0][0], '/api/library/documents/new/links/old?relation=supersedes');
  assert.equal(calls[0][1].method, 'DELETE');
});

test('fetchStaleDocuments calls the maintenance endpoint with project', async () => {
  let capturedUrl, capturedOpts;
  globalThis.fetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, json: async () => [] }; };
  await fetchStaleDocuments('homelab');
  assert.equal(capturedUrl, '/api/library/maintenance/stale?project=homelab');
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
});

test('verifyDocument posts verified:true with actor and reviewed revision', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse({ id: 'doc-1', verified: true }); };

  const result = await verifyDocument('doc-1', true, 'user', 'a'.repeat(64));

  assert.deepEqual(result, { id: 'doc-1', verified: true });
  assert.equal(calls[0][0], '/api/library/documents/doc-1/verify');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { verified: true, as: 'user', revision: 'a'.repeat(64) });
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

test('semanticSearch requests an exact paged envelope', async () => {
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return jsonResponse({ items: [], page: { offset: 20, limit: 10, returned: 0, total: 20, hasMore: false, nextOffset: null } });
  };
  const result = await semanticSearch('database recovery', 'homelab', { limit: 10, offset: 20 });
  const url = new URL(capturedUrl, 'http://prax.local');
  assert.equal(url.pathname, '/api/library/documents/semantic-search');
  assert.equal(url.searchParams.get('q'), 'database recovery');
  assert.equal(url.searchParams.get('project'), 'homelab');
  assert.equal(url.searchParams.get('page'), 'true');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('offset'), '20');
  // A person's Library search shows unreviewed harvested candidates.
  assert.equal(url.searchParams.get('includeHarvested'), 'true');
  assert.equal(result.page.total, 20);
});

test('run API uses caller-stable start identity and preserves conflict details for reconciliation', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return jsonResponse({ id: 'run-1', status: 'running', events: [] });
  };
  await startRun('doc-1', 'Incident', 'run-1');
  assert.equal(calls[0][0], '/api/library/documents/doc-1/runs');
  assert.deepEqual(JSON.parse(calls[0][1].body), { title: 'Incident', id: 'run-1' });

  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ message: 'run is completed', reason: 'run-not-running' }),
  });
  await assert.rejects(
    () => setRunStep('run-1', 'step-1', true),
    error => error.status === 409 && error.reason === 'run-not-running' && error.message === 'run is completed',
  );
  await assert.rejects(
    () => setRunStatus('run-1', 'running'),
    error => error.status === 409 && error.reason === 'run-not-running',
  );
  await assert.rejects(
    () => fetchRun('run-1'),
    error => error.status === 409 && error.message === 'run is completed',
  );
});
