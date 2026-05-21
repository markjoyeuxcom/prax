import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArchiveDocument,
  buildCreateDocument,
  buildDeleteArchivedDocument,
  buildRestoreDocument,
  buildUpdateDocument,
  createLibraryRepository,
  normalizeDocumentRow,
} from '../../server/libraryRepository.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('normalizeDocumentRow maps database fields to API document fields', () => {
  const document = normalizeDocumentRow({
    id: DOCUMENT_ID,
    title: 'Restore CloudNativePG',
    body: '# Restore CloudNativePG',
    document_type: 'runbook',
    project_id: PROJECT_UUID,
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
    projectId: PROJECT_UUID,
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
    projectId: PROJECT_UUID,
    tags: ['ingress'],
    sourceFilename: 'ingress.md',
  });

  assert.match(query.text, /insert into markdown_documents/);
  assert.match(query.text, /returning \*/);
  assert.deepEqual(query.values, [
    'Ingress Notes',
    '# Ingress Notes',
    'note',
    PROJECT_UUID,
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

test('listDocuments uses full-text search with prefix terms when q is present', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ q: 'cloud tunnel' });
  assert.match(captured.text, /to_tsvector\('english', coalesce\(title, ''\) \|\| ' ' \|\| coalesce\(body, ''\)\) @@ to_tsquery\('english', \$1\)/);
  assert.deepEqual(captured.values, ['cloud:* & tunnel:*']);
});

test('listDocuments sanitizes q to alphanumeric prefix terms (injection-safe)', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ q: 'post; drop table--' });
  assert.deepEqual(captured.values, ['post:* & drop:* & table:*']);
});

test('listDocuments adds no FTS clause when q has no alphanumeric terms', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ q: '!!!' });
  assert.doesNotMatch(captured.text, /to_tsquery/);
});

test('listDocuments combines projectId and full-text search', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ projectId: PROJECT_UUID, q: 'restore' });
  assert.match(captured.text, /project_id = \$1/);
  assert.match(captured.text, /to_tsquery\('english', \$2\)/);
  assert.deepEqual(captured.values, [PROJECT_UUID, 'restore:*']);
});
