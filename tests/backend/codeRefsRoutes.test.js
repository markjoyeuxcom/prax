import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';

const DOC = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);

function makeApp({ doc = { id: DOC, title: 'T' }, refs = [] } = {}) {
  const store = [...refs];
  return buildApp({
    skipDb: true,
    libraryRepository: {
      listDocuments: async () => [], getDocument: async (id) => (id === DOC ? doc : null),
      createDocument: async (d) => d, updateDocument: async (id, f) => ({ id, ...f }),
      archiveDocument: async () => null, restoreDocument: async () => null, deleteDocument: async () => null,
      listActiveDocumentsForExport: async () => [],
    },
    projectsRepository: { resolveProject: async () => ({ id: 'p', slug: 's' }) },
    documentLinksRepository: { listDocumentLinks: async () => [], linkDocuments: async () => ({ linked: true }), unlinkDocuments: async () => true, listStaleDocuments: async () => [], listOutboundLinksForDocuments: async () => new Map() },
    documentCodeRefsRepository: {
      listCodeRefs: async () => store,
      addCodeRef: async (id, c) => { if (id !== DOC) return null; const r = { id: 'r1', documentId: id, ...c }; store.push(r); return r; },
      removeCodeRef: async (id, refId) => { const i = store.findIndex((r) => r.id === refId); if (i < 0) return false; store.splice(i, 1); return true; },
    },
  });
}

test('a citation can be pinned to a document and read back', async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${DOC}/code-refs`,
    payload: { path: 'server/config.js', startLine: 12, endLine: 36, contentHash: HASH, commitSha: 'abc1234' },
  });
  assert.equal(res.statusCode, 201);
  const list = res.json();
  assert.equal(list[0].path, 'server/config.js');
  assert.equal(list[0].contentHash, HASH);
});

test('a whole-file citation needs no line range', async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${DOC}/code-refs`,
    payload: { path: 'server/config.js', contentHash: HASH },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json()[0].startLine, null);
});

test('a citation without a content hash is refused — an unpinned citation cannot go stale', async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${DOC}/code-refs`,
    payload: { path: 'server/config.js' },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /contentHash/);
});

test('an absolute or escaping path is refused', async () => {
  const app = await makeApp();
  for (const path of ['/etc/passwd', '../../secrets.env']) {
    const res = await app.inject({
      method: 'POST', url: `/api/library/documents/${DOC}/code-refs`,
      payload: { path, contentHash: HASH },
    });
    assert.equal(res.statusCode, 400, path);
    assert.match(res.json().message, /relative/);
  }
});

test('an end line without a start line is refused — it is not a range', async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${DOC}/code-refs`,
    payload: { path: 'a.js', endLine: 9, contentHash: HASH },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /startLine/);
});

test('an inverted line range is refused', async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: 'POST', url: `/api/library/documents/${DOC}/code-refs`,
    payload: { path: 'a.js', startLine: 9, endLine: 3, contentHash: HASH },
  });
  assert.equal(res.statusCode, 400);
});

test('citing an unknown document is a 404, not a silent success', async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: 'POST', url: '/api/library/documents/22222222-2222-4222-8222-222222222222/code-refs',
    payload: { path: 'a.js', contentHash: HASH },
  });
  assert.equal(res.statusCode, 404);
});

test('citations are listed and can be removed', async () => {
  const app = await makeApp({ refs: [{ id: 'r1', documentId: DOC, path: 'a.js', contentHash: HASH }] });
  const list = await app.inject({ method: 'GET', url: `/api/library/documents/${DOC}/code-refs` });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);
  const del = await app.inject({ method: 'DELETE', url: `/api/library/documents/${DOC}/code-refs/r1` });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.json(), []);
});
