import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function fakes({ available = true, enabled = true } = {}) {
  return {
    library: {
      listDocuments: async () => [],
      getDocument: async () => null,
      createDocument: async (d) => ({ id: 'new', ...d }),
      updateDocument: async (id, f) => ({ id, ...f }),
      archiveDocument: async () => null,
      restoreDocument: async () => null,
      deleteArchivedDocument: async () => null,
      listActiveDocumentsForExport: async () => [],
      searchDocumentsSemantic: async () => [
        { id: 'd1', title: 'Restore', documentType: 'runbook', projectId: PROJECT_ID, tags: [], body: 'b', kind: 'source' },
      ],
      countEmbeddings: async () => ({ total: 3, embedded: 2 }),
    },
    appSettings: {
      _enabled: enabled,
      async getSetting(_k, fb) { return this._enabled ?? fb; },
      async putSetting(_k, v) { this._enabled = v; return v; },
    },
    embedder: available ? { backend: 'fake', async isAvailable() { return true; }, async embed() { return { vector: [0.1], model: 'fake', dim: 1 }; } } : null,
    embeddingService: { embedDocument: async () => true, reindex: async () => ({ embedded: 3, failed: 0 }) },
  };
}

async function makeApp(opts, mutate) {
  const f = fakes(opts);
  if (mutate) mutate(f);
  return buildApp({
    skipDb: true,
    libraryRepository: f.library,
    projectsRepository: { resolveProject: async () => ({ id: PROJECT_ID, slug: 'homelab' }) },
    documentLinksRepository: { listDocumentLinks: async () => [], linkDocuments: async () => ({ linked: true }), unlinkDocuments: async () => true, listStaleDocuments: async () => [], listOrphanDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: f.appSettings,
    embedder: f.embedder,
    embeddingService: f.embeddingService,
  });
}

test('GET /api/settings/semantic-search reports availability + counts', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'GET', url: '/api/settings/semantic-search' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.available, true);
  assert.equal(body.enabled, true);
  assert.equal(body.backend, 'fake');
  assert.equal(body.embeddedCount, 2);
  assert.equal(body.totalCount, 3);
  await app.close();
});

test('GET semantic settings shows unavailable when no embedder', async () => {
  const app = await makeApp({ available: false });
  const res = await app.inject({ method: 'GET', url: '/api/settings/semantic-search' });
  assert.equal(res.json().available, false);
  await app.close();
});

test('PUT /api/settings/semantic-search flips the toggle', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { enabled: false } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().enabled, false);
  await app.close();
});

test('semantic-search returns refs when enabled', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  assert.equal(res.statusCode, 200);
  const refs = res.json();
  assert.equal(refs[0].title, 'Restore');
  assert.ok('snippet' in refs[0]);   // ref shape, not full doc
  await app.close();
});

test('semantic-search 409s when disabled', async () => {
  const app = await makeApp({ available: true, enabled: false });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x' });
  assert.equal(res.statusCode, 409);
  await app.close();
});

test('semantic-search 409s when unavailable', async () => {
  const app = await makeApp({ available: false });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x' });
  assert.equal(res.statusCode, 409);
  await app.close();
});

test('reindex returns counts when available', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().embedded, 3);
  await app.close();
});

test('semantic-search 503s when a configured backend errors', async () => {
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embedder.embed = async () => { throw new Error('backend down'); };
  });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  assert.equal(res.statusCode, 503);
  // The raw error is never echoed to the client.
  assert.doesNotMatch(JSON.stringify(res.json()), /backend down/);
  await app.close();
});

test('semantic-search 400s when q is blank', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=%20%20' });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('PUT semantic settings 409s when not configured', async () => {
  const app = await makeApp({ available: false });
  const res = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { enabled: true } });
  assert.equal(res.statusCode, 409);
  await app.close();
});

test('creating a document fires a non-awaited embed when active', async () => {
  const embedded = [];
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embeddingService.embedDocument = async (id) => { embedded.push(id); return true; };
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: { title: 'T', body: 'hello', documentType: 'note', project: 'homelab' },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(embedded, ['new']);   // createDocument fake returns id 'new'
  await app.close();
});

test('patching without a body change does not fire an embed', async () => {
  const embedded = [];
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embeddingService.embedDocument = async (id) => { embedded.push(id); return true; };
  });
  const id = '00000000-0000-4000-8000-0000000000aa';
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/library/documents/${id}`,
    payload: { tags: ['x'] },   // neither title nor body -> no embed
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(embedded, []);
  await app.close();
});

test('semantic-search refs never expose similarity or embedding', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  const refs = res.json();
  assert.ok(refs.length > 0);
  for (const r of refs) {
    assert.ok(!('similarity' in r));
    assert.ok(!('embedding' in r));
  }
  await app.close();
});

test('patching with a body change fires a non-awaited embed', async () => {
  const embedded = [];
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embeddingService.embedDocument = async (docId) => { embedded.push(docId); return true; };
  });
  const id = '00000000-0000-4000-8000-0000000000aa';
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/library/documents/${id}`,
    payload: { body: 'new content' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(embedded, [id]);   // updateDocument fake echoes the id
  await app.close();
});

test('patching the title fires a non-awaited embed', async () => {
  const embedded = [];
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embeddingService.embedDocument = async (docId) => { embedded.push(docId); return true; };
  });
  const id = '00000000-0000-4000-8000-0000000000aa';
  const res = await app.inject({ method: 'PATCH', url: `/api/library/documents/${id}`, payload: { title: 'Renamed' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(embedded, [id]);
  await app.close();
});

test('reindex?force=true reaches the force path', async () => {
  let sawForce;
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.embeddingService.reindex = async (opts) => { sawForce = opts?.force; return { embedded: 9, failed: 0 }; };
  });
  const res = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex?force=true' });
  assert.equal(res.statusCode, 200);
  assert.equal(sawForce, true);
  await app.close();
});

test('semantic-search threads includeRetired from ?all=true', async () => {
  let capturedOpts;
  const appWithAll = await makeApp({ available: true, enabled: true }, (f) => {
    f.library.searchDocumentsSemantic = async (_vec, _backend, opts) => { capturedOpts = opts; return []; };
  });
  await appWithAll.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore&all=true' });
  assert.equal(capturedOpts.includeRetired, true);
  await appWithAll.close();

  let capturedOptsNoAll;
  const appNoAll = await makeApp({ available: true, enabled: true }, (f) => {
    f.library.searchDocumentsSemantic = async (_vec, _backend, opts) => { capturedOptsNoAll = opts; return []; };
  });
  await appNoAll.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  assert.ok(!capturedOptsNoAll.includeRetired);
  await appNoAll.close();
});
