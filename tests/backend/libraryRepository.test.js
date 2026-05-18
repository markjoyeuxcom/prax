import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArchiveDocument,
  buildCreateDocument,
  buildDeleteArchivedDocument,
  buildRestoreDocument,
  buildUpdateDocument,
  normalizeDocumentRow,
} from '../../server/libraryRepository.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

test('normalizeDocumentRow maps database fields to API document fields', () => {
  const document = normalizeDocumentRow({
    id: DOCUMENT_ID,
    title: 'Restore CloudNativePG',
    body: '# Restore CloudNativePG',
    document_type: 'runbook',
    context: 'homelab',
    tags: ['postgres', 'backup'],
    source_filename: 'restore.md',
    archived_at: null,
    created_at: '2026-05-18T10:00:00.000Z',
    updated_at: '2026-05-18T10:00:00.000Z',
  });

  assert.deepEqual(document, {
    id: DOCUMENT_ID,
    title: 'Restore CloudNativePG',
    body: '# Restore CloudNativePG',
    documentType: 'runbook',
    context: 'homelab',
    tags: ['postgres', 'backup'],
    sourceFilename: 'restore.md',
    archivedAt: null,
    createdAt: '2026-05-18T10:00:00.000Z',
    updatedAt: '2026-05-18T10:00:00.000Z',
  });
});

test('buildCreateDocument returns a parameterized insert query', () => {
  const query = buildCreateDocument({
    title: 'Ingress Notes',
    body: '# Ingress Notes',
    documentType: 'note',
    context: 'homelab',
    tags: ['ingress'],
    sourceFilename: 'ingress.md',
  });

  assert.match(query.text, /insert into markdown_documents/);
  assert.match(query.text, /returning \*/);
  assert.deepEqual(query.values, [
    'Ingress Notes',
    '# Ingress Notes',
    'note',
    'homelab',
    ['ingress'],
    'ingress.md',
  ]);
});

test('buildUpdateDocument returns only provided document fields', () => {
  const query = buildUpdateDocument(DOCUMENT_ID, {
    title: 'Updated',
    tags: ['runbook'],
  });

  assert.match(query.text, /update markdown_documents/);
  assert.match(query.text, /title = \$2/);
  assert.match(query.text, /tags = \$3/);
  assert.match(query.text, /updated_at = now\(\)/);
  assert.match(query.text, /where id = \$1 and archived_at is null/);
  assert.deepEqual(query.values, [DOCUMENT_ID, 'Updated', ['runbook']]);
});

test('buildUpdateDocument rejects empty updates', () => {
  assert.throws(
    () => buildUpdateDocument(DOCUMENT_ID, {}),
    /No document fields provided/,
  );
});

test('archive restore and permanent delete are archived-state scoped', () => {
  const archive = buildArchiveDocument(DOCUMENT_ID);
  const restore = buildRestoreDocument(DOCUMENT_ID);
  const remove = buildDeleteArchivedDocument(DOCUMENT_ID);

  assert.match(archive.text, /set archived_at = now\(\)/);
  assert.match(archive.text, /where id = \$1 and archived_at is null/);
  assert.match(restore.text, /set archived_at = null/);
  assert.match(restore.text, /where id = \$1 and archived_at is not null/);
  assert.match(remove.text, /delete from markdown_documents/);
  assert.match(remove.text, /where id = \$1 and archived_at is not null/);
  assert.deepEqual(archive.values, [DOCUMENT_ID]);
  assert.deepEqual(restore.values, [DOCUMENT_ID]);
  assert.deepEqual(remove.values, [DOCUMENT_ID]);
});
