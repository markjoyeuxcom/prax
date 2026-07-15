import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDocumentDraftRecovery,
  documentDraftIsDirty,
  loadDocumentDraftRecovery,
  normalizeDocumentDraftTitle,
  resolveDocumentDraftRecovery,
  storeDocumentDraftRecovery,
} from '../../public/js/documentDraftRecovery.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

const document = { id: 'doc-1', title: 'Saved title', body: '# Saved' };

test('normalizes blank document titles to the API-safe title', () => {
  assert.equal(normalizeDocumentDraftTitle('  '), 'Untitled');
  assert.equal(normalizeDocumentDraftTitle('  Kept  '), 'Kept');
});

test('dirty comparison treats title and body as one draft', () => {
  assert.equal(documentDraftIsDirty(document, { title: ' Saved title ', body: '# Saved' }), false);
  assert.equal(documentDraftIsDirty(document, { title: 'Changed', body: '# Saved' }), true);
  assert.equal(documentDraftIsDirty(document, { title: 'Saved title', body: '# Changed' }), true);
});

test('stores and reloads the persisted base plus the exact local draft', () => {
  const storage = memoryStorage();
  assert.equal(storeDocumentDraftRecovery(storage, {
    document,
    title: '  Local title  ',
    body: '# Local',
  }), true);
  assert.deepEqual(loadDocumentDraftRecovery(storage, document.id), {
    schemaVersion: 1,
    documentId: 'doc-1',
    baseTitle: 'Saved title',
    baseBody: '# Saved',
    draftTitle: '  Local title  ',
    draftBody: '# Local',
  });
});

test('safe recovery restores the draft when the saved base is unchanged', () => {
  const storage = memoryStorage();
  storeDocumentDraftRecovery(storage, { document, title: 'Local title', body: '# Local' });
  const recovery = loadDocumentDraftRecovery(storage, document.id);
  assert.deepEqual(resolveDocumentDraftRecovery(document, recovery), {
    kind: 'recovered',
    clear: false,
    title: 'Local title',
    body: '# Local',
    isDirty: true,
    status: 'Recovered draft',
  });
});

test('recovery is obsolete when the server already has the sent draft', () => {
  const storage = memoryStorage();
  storeDocumentDraftRecovery(storage, { document, title: 'Local title', body: '# Local' });
  const recovery = loadDocumentDraftRecovery(storage, document.id);
  assert.deepEqual(resolveDocumentDraftRecovery(
    { ...document, title: 'Local title', body: '# Local' },
    recovery,
  ), {
    kind: 'obsolete', clear: true,
    title: 'Local title', body: '# Local', isDirty: false, status: 'Saved',
  });
});

test('recovery reports a conflict when both saved and local copies changed', () => {
  const storage = memoryStorage();
  storeDocumentDraftRecovery(storage, { document, title: 'Local title', body: '# Local' });
  const recovery = loadDocumentDraftRecovery(storage, document.id);
  assert.deepEqual(resolveDocumentDraftRecovery(
    { ...document, title: 'Remote title', body: '# Remote' },
    recovery,
  ), {
    kind: 'conflict',
    clear: false,
    title: 'Local title',
    body: '# Local',
    isDirty: true,
    status: 'Recovered draft — saved copy changed',
  });
});

test('conditional clear cannot delete a newer local draft', () => {
  const storage = memoryStorage();
  storeDocumentDraftRecovery(storage, { document, title: 'Newest', body: '# Newest' });

  assert.equal(clearDocumentDraftRecovery(storage, document.id, {
    title: 'Older', body: '# Older',
  }), false);
  assert.equal(loadDocumentDraftRecovery(storage, document.id).draftTitle, 'Newest');

  assert.equal(clearDocumentDraftRecovery(storage, document.id, {
    title: 'Newest', body: '# Newest',
  }), true);
  assert.equal(loadDocumentDraftRecovery(storage, document.id), null);
});

test('malformed recovery records are removed instead of being applied', () => {
  const storage = memoryStorage();
  storage.setItem('prax.documentDraftRecovery.v1.doc-1', '{"schemaVersion":1}');
  assert.equal(loadDocumentDraftRecovery(storage, document.id), null);
  assert.equal(storage.values.size, 0);
});
