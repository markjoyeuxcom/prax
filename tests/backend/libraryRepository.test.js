import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArchiveDocument,
  buildCreateDocument,
  buildDeleteArchivedDocument,
  buildListActiveDocumentsForExport,
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

test('normalizeDocumentRow surfaces projectSlug only when the project_slug column is present', () => {
  const withoutSlug = normalizeDocumentRow({
    id: DOCUMENT_ID,
    title: 't',
    body: '',
    document_type: 'note',
    project_id: PROJECT_UUID,
    tags: [],
    source_filename: null,
    archived_at: null,
    created_at: 'now',
    updated_at: 'now',
  });
  assert.equal('projectSlug' in withoutSlug, false);

  const withNullSlug = normalizeDocumentRow({
    id: DOCUMENT_ID,
    title: 't',
    body: '',
    document_type: 'note',
    project_id: PROJECT_UUID,
    tags: [],
    source_filename: null,
    archived_at: null,
    created_at: 'now',
    updated_at: 'now',
    project_slug: null,
  });
  assert.equal(withNullSlug.projectSlug, null);
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

test('buildListActiveDocumentsForExport joins projects and filters archived', () => {
  const query = buildListActiveDocumentsForExport({});
  assert.match(query.text, /from markdown_documents d/);
  assert.match(query.text, /join projects p on p\.id = d\.project_id/);
  assert.match(query.text, /d\.archived_at is null/);
  assert.match(query.text, /order by p\.slug, d\.title/);
  assert.deepEqual(query.values, []);
});

test('buildListActiveDocumentsForExport scopes to a single project id', () => {
  const query = buildListActiveDocumentsForExport({ projectId: PROJECT_UUID });
  assert.match(query.text, /d\.project_id = \$1/);
  assert.deepEqual(query.values, [PROJECT_UUID]);
});

test('buildListActiveDocumentsForExport treats empty-string and null projectId as "all"', () => {
  for (const value of ['', null, undefined]) {
    const query = buildListActiveDocumentsForExport({ projectId: value });
    assert.doesNotMatch(query.text, /d\.project_id = \$/);
    assert.deepEqual(query.values, []);
  }
});

test('createLibraryRepository.listActiveDocumentsForExport normalizes rows with project_slug', async () => {
  const captured = [];
  const fakeDb = {
    async query(text, values) {
      captured.push({ text, values });
      return {
        rows: [{
          id: DOCUMENT_ID,
          title: 'Restore',
          body: '# Restore',
          document_type: 'runbook',
          project_id: PROJECT_UUID,
          tags: ['postgres'],
          source_filename: 'restore.md',
          archived_at: null,
          created_at: '2026-05-18T10:00:00.000Z',
          updated_at: '2026-05-18T10:00:00.000Z',
          project_slug: 'homelab',
        }],
      };
    },
  };
  const repository = createLibraryRepository(fakeDb);
  const rows = await repository.listActiveDocumentsForExport({ projectId: PROJECT_UUID });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].projectSlug, 'homelab');
  assert.equal(rows[0].title, 'Restore');
  assert.equal(rows[0].documentType, 'runbook');
  assert.equal(captured.length, 1);
  assert.match(captured[0].text, /join projects p on p\.id = d\.project_id/);
  assert.match(captured[0].text, /d\.archived_at is null/);
  assert.deepEqual(captured[0].values, [PROJECT_UUID]);
});
