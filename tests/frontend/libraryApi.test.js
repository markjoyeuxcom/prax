import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveDocument,
  createDocument,
  deleteArchivedDocument,
  fetchDocuments,
  restoreDocument,
  updateDocument,
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
  await deleteArchivedDocument('doc-1');

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
