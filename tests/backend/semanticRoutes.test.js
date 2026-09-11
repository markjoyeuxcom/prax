import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

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
      deleteDocument: async () => null,
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
    documentLinksRepository: { listDocumentLinks: async () => [], linkDocuments: async () => ({ linked: true }), unlinkDocuments: async () => true, listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
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

test('semantic-search paged mode returns exact metadata while default mode stays an array', async () => {
  let captured;
  const docs = [
    { id: 'd2', title: 'Second', documentType: 'note', projectId: PROJECT_ID, tags: [], body: 'b2', kind: 'synthesized', updatedBy: 'agent', verified: true, verifiedAt: '2026-07-13T12:00:00.000Z', verifiedBy: 'operator', stale: true, status: 'active' },
  ];
  const app = await makeApp({ available: true, enabled: true }, (f) => {
    f.library.searchDocumentsSemantic = async (_vector, _backend, opts) => {
      captured = opts;
      return opts.page ? { items: docs, total: 7 } : docs;
    };
  });

  const paged = await app.inject({
    method: 'GET',
    url: '/api/library/documents/semantic-search?q=restore&page=true&limit=1&offset=1',
  });
  assert.equal(paged.statusCode, 200);
  assert.equal(captured.page, true);
  assert.equal(captured.limit, 1);
  assert.equal(captured.offset, 1);
  assert.deepEqual(paged.json().page, {
    offset: 1, limit: 1, returned: 1, total: 7, hasMore: true, nextOffset: 2,
  });
  assert.equal(paged.json().items[0].title, 'Second');
  assert.equal(paged.json().items[0].kind, 'synthesized');
  assert.equal(paged.json().items[0].updatedBy, 'agent');
  assert.equal(paged.json().items[0].stale, true);
  assert.equal(paged.json().items[0].verified, true);
  assert.equal(paged.json().items[0].verifiedAt, '2026-07-13T12:00:00.000Z');
  assert.equal(paged.json().items[0].verifiedBy, 'operator');
  assert.ok(!('body' in paged.json().items[0]));
  assert.ok(!('embedding' in paged.json().items[0]));

  const legacy = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  assert.equal(Array.isArray(legacy.json()), true);
  assert.equal(captured.limit, Number.MAX_SAFE_INTEGER, 'legacy array mode is complete, not silently capped');
  await app.close();
});

test('semantic-search paged mode validates limit and offset', async () => {
  const app = await makeApp({ available: true, enabled: true });
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x&page=true&limit=0' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x&page=true&limit=51' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x&page=true&offset=-1' })).statusCode, 400);
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

test('PUT semantic settings 400s on an unknown backend (validated before any write)', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'quantum' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('GET semantic settings exposes the provider fields (never the key value)', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const body = (await app.inject({ method: 'GET', url: '/api/settings/semantic-search' })).json();
  assert.equal(typeof body.model, 'string');
  assert.equal(typeof body.baseUrl, 'string');
  assert.equal(typeof body.keyRequired, 'boolean');
  assert.equal(typeof body.ollamaUrl, 'string');
  assert.equal(typeof body.openaiBaseUrl, 'string');
  assert.equal(typeof body.hasApiKey, 'boolean');
  assert.ok(!('openaiApiKey' in body));
  assert.ok(!('apiKey' in body));
  await app.close();
});

test('PUT with a hosted backend reports keyRequired and its default baseUrl', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'gemini' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.keyRequired, true);
  assert.equal(body.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  await app.close();
});

test('PUT accepts the generic baseUrl/apiKey fields for the new backends', async () => {
  const app = await makeApp({ available: true, enabled: true });
  const res = await app.inject({
    method: 'PUT',
    url: '/api/settings/semantic-search',
    payload: { backend: 'voyage', baseUrl: 'http://proxy.local/v1', apiKey: 'vk' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.baseUrl, 'http://proxy.local/v1');
  assert.equal(body.hasApiKey, true);
  assert.ok(!JSON.stringify(body).includes('vk'), 'the key value never reaches the client');

  const bad = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'voyage', baseUrl: 'not a url' } });
  assert.equal(bad.statusCode, 400);
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

// --- the recall contract at the HTTP boundary ---------------------------------
//
// The library records WHEN a memory was last written and WHICH agent wrote it.
// The semantic ref used to drop both, so no client — including the recall
// skill — could weigh a fresh human note against a months-old synthesized one.
// A trust model the retrieval path discards is decoration.

test('a semantic ref carries updatedAt and the writing agent, not just verification', async () => {
  const app = await makeApp({}, (f) => {
    f.library.searchDocumentsSemantic = async () => [{
      id: 'd1', title: 'Restore', documentType: 'runbook', projectId: PROJECT_ID, tags: [], body: 'b',
      kind: 'synthesized', updatedBy: 'agent', updatedByAgent: 'codex',
      updatedAt: '2026-05-02T09:00:00.000Z', verified: false, status: 'active', similarity: 0.9,
    }];
  });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore&page=true' });
  assert.equal(res.statusCode, 200);
  const ref = res.json().items[0];
  assert.equal(ref.updatedAt, '2026-05-02T09:00:00.000Z');
  assert.equal(ref.updatedByAgent, 'codex');
  assert.equal(ref.updatedBy, 'agent');
  assert.equal(ref.kind, 'synthesized');
});

test('a ref for a human-written memory reports no writing agent rather than omitting the field', async () => {
  const app = await makeApp({}, (f) => {
    f.library.searchDocumentsSemantic = async () => [{
      id: 'd2', title: 'Hand-written runbook', documentType: 'runbook', projectId: PROJECT_ID, tags: [], body: 'b',
      kind: 'source', updatedBy: 'user', updatedByAgent: null,
      updatedAt: '2026-09-01T09:00:00.000Z', verified: true, verifiedBy: 'mark', status: 'active',
    }];
  });
  const ref = (await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=runbook&page=true' })).json().items[0];
  assert.equal(ref.updatedByAgent, null);
  assert.equal(ref.updatedBy, 'user');
  assert.equal(ref.verifiedBy, 'mark');
  assert.equal(ref.updatedAt, '2026-09-01T09:00:00.000Z');
});

// --- hybrid retrieval ----------------------------------------------------------
//
// mode=hybrid fuses the vector ranking with BM25 and weights by trust. It is
// opt-in at the HTTP boundary on purpose: the default ranking stays put until
// there is a semantic relevance harness to prove a change is an improvement.
// The memory path (recall) opts in; the UI's ranking is unchanged.

test('mode=hybrid routes to the fused ranker and passes the query text through', async () => {
  let captured = null;
  const app = await makeApp({}, (f) => {
    f.library.searchDocumentsHybrid = async (vector, text, backend, opts) => {
      captured = { vector, text, backend, opts };
      return { items: [{ id: 'h1', title: 'Fused', documentType: 'note', projectId: PROJECT_ID, tags: [], body: 'b', match: { semanticRank: 2, keywordRank: 1, score: 0.03 } }], total: 1 };
    };
  });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore+backup&page=true&mode=hybrid' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().items[0].id, 'h1');
  assert.equal(captured.text, 'restore backup', 'the raw query text reaches the FTS half');
  assert.deepEqual(captured.vector, [0.1]);
});

test('a hybrid ref explains why it matched, so a client can discount the ranking', async () => {
  const app = await makeApp({}, (f) => {
    f.library.searchDocumentsHybrid = async () => ({
      items: [{ id: 'h1', title: 'Fused', documentType: 'note', projectId: PROJECT_ID, tags: [], body: 'b', match: { semanticRank: null, keywordRank: 1, rrf: 0.016, trust: 1.25, score: 0.02 } }],
      total: 1,
    });
  });
  const ref = (await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x&page=true&mode=hybrid' })).json().items[0];
  assert.deepEqual(ref.match, { semanticRank: null, keywordRank: 1, rrf: 0.016, trust: 1.25, score: 0.02 });
});

test('the default mode is unchanged: pure cosine, no fused ranker call', async () => {
  let hybridCalled = false;
  const app = await makeApp({}, (f) => {
    f.library.searchDocumentsHybrid = async () => { hybridCalled = true; return { items: [], total: 0 }; };
  });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore&page=true' });
  assert.equal(res.statusCode, 200);
  assert.equal(hybridCalled, false);
});

test('an unknown mode is rejected rather than silently falling back', async () => {
  const app = await makeApp({});
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x&page=true&mode=magic' });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /mode/);
});

test('mode=hybrid degrades to the cosine ranker on a server that has no fused ranker', async () => {
  // An injected/extension repository predating hybrid must not 500.
  const app = await makeApp({}, (f) => { delete f.library.searchDocumentsHybrid; });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore&page=true&mode=hybrid' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().items[0].id, 'd1');
});

// --- per-backend relevance floor ------------------------------------------------

test("a backend's own relevance floor is used when the operator set none", async () => {
  let captured = null;
  const app = await makeApp({}, (f) => {
    f.embedder.minSimilarity = 0.33;
    f.library.searchDocumentsSemantic = async (v, b, opts) => { captured = opts; return { items: [], total: 0 }; };
  });
  await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x&page=true' });
  assert.equal(captured.minSimilarity, 0.33);
});

test('an explicitly configured floor still wins over the backend default', async () => {
  let captured = null;
  const f = fakes();
  f.embedder.minSimilarity = 0.33;
  f.library.searchDocumentsSemantic = async (v, b, opts) => { captured = opts; return { items: [], total: 0 }; };
  const app = buildApp({
    skipDb: true,
    libraryRepository: f.library,
    projectsRepository: { resolveProject: async () => ({ id: PROJECT_ID, slug: 'homelab' }) },
    documentLinksRepository: { listDocumentLinks: async () => [], linkDocuments: async () => ({ linked: true }), unlinkDocuments: async () => true, listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: f.appSettings,
    embedder: f.embedder,
    embeddingService: f.embeddingService,
    config: loadConfig({ EMBEDDING_SEARCH_MIN_SIMILARITY: '0.6' }),
  });
  await (await app).inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=x&page=true' });
  assert.equal(captured.minSimilarity, 0.6);
});
