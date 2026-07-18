import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildArchiveDocument,
  buildCreateDocument,
  buildDeleteDocument,
  buildGetDocument,
  buildGetDocumentCreationReceipt,
  buildListActiveDocumentsForExport,
  buildRestoreDocument,
  buildSetDocumentEmbedding,
  buildUpdateDocument,
  createLibraryRepository,
  documentMatchesCreateFields,
  normalizeDocumentRow,
} from '../../server/libraryRepository.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

const PROJECT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const sha = (s) => createHash('sha256').update(String(s ?? '')).digest('hex');

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
    contentHash: null,
    updatedBy: undefined,
    kind: undefined,
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    status: 'active',
    stale: false,
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
    '["ingress"]',
    'ingress.md',
    sha('# Ingress Notes'),
    'user',
    'source',
    true,
  ]);
});

test('buildCreateDocument can use a caller id with an exact-once conflict guard', () => {
  const query = buildCreateDocument({
    id: DOCUMENT_ID,
    title: 'Imported note',
    body: '# Imported note',
    documentType: 'note',
    projectId: PROJECT_UUID,
    tags: ['imported'],
    sourceFilename: 'imported.md',
  }, { ignoreIdConflict: true });

  assert.match(query.text, /insert into markdown_documents \(id, title/);
  assert.match(query.text, /values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11\)/);
  assert.match(query.text, /on conflict\(id\) do nothing/);
  assert.deepEqual(query.values.slice(0, 7), [
    DOCUMENT_ID,
    'Imported note',
    '# Imported note',
    'note',
    PROJECT_UUID,
    '["imported"]',
    'imported.md',
  ]);
});

test('generated document creation persists an internal operation receipt', () => {
  const query = buildCreateDocument({
    id: DOCUMENT_ID,
    title: 'Generated',
    body: '# Generated',
    documentType: 'runbook',
    projectId: PROJECT_UUID,
    tags: ['draft'],
    updatedBy: 'agent',
    kind: 'synthesized',
    creationOperation: 'generate-runbook',
    creationIntentHash: 'abc123',
  }, { ignoreIdConflict: true });
  assert.match(query.text, /creation_operation, creation_intent_hash/);
  assert.deepEqual(query.values.slice(-2), ['generate-runbook', 'abc123']);
  assert.deepEqual(buildGetDocumentCreationReceipt(DOCUMENT_ID).values, [DOCUMENT_ID]);
});

test('documentMatchesCreateFields accepts an exact replay and rejects conflicting identity reuse', () => {
  const fields = {
    id: DOCUMENT_ID,
    title: 'Imported note',
    body: '# Imported note',
    documentType: 'note',
    projectId: PROJECT_UUID,
    tags: ['imported'],
    sourceFilename: 'imported.md',
    kind: 'source',
    updatedBy: 'user',
  };
  assert.equal(documentMatchesCreateFields({ ...fields }, fields), true);
  assert.equal(documentMatchesCreateFields({ ...fields, title: 'Different' }, fields), false);
  assert.equal(documentMatchesCreateFields({ ...fields, projectId: 'elsewhere' }, fields), false);
  assert.equal(documentMatchesCreateFields({ ...fields, tags: ['imported', 'extra'] }, fields), false);
});

test('buildUpdateDocument returns only provided document fields', () => {
  const query = buildUpdateDocument(DOCUMENT_ID, {
    title: 'Updated',
    tags: ['runbook'],
  });

  assert.match(query.text, /update markdown_documents/);
  assert.match(query.text, /title = \$2/);
  assert.match(query.text, /tags = \$3/);
  assert.match(query.text, /updated_at = strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/);
  assert.match(query.text, /where id = \$1 and archived_at is null/);
  assert.deepEqual(query.values, [DOCUMENT_ID, 'Updated', '["runbook"]', 'user']);
});

test('buildUpdateDocument rejects empty updates', () => {
  assert.throws(
    () => buildUpdateDocument(DOCUMENT_ID, {}),
    /No document fields provided/,
  );
});

test('archive and restore are archived-state scoped; permanent delete removes any document', () => {
  const archive = buildArchiveDocument(DOCUMENT_ID);
  const restore = buildRestoreDocument(DOCUMENT_ID);
  const remove = buildDeleteDocument(DOCUMENT_ID);

  assert.match(archive.text, /set archived_at = strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/);
  assert.match(archive.text, /where id = \$1 and archived_at is null/);
  assert.match(restore.text, /set archived_at = null/);
  assert.match(restore.text, /where id = \$1 and archived_at is not null/);
  assert.match(remove.text, /delete from markdown_documents/);
  // Delete is NOT archived-scoped — active documents can be deleted outright.
  assert.match(remove.text, /where id = \$1\s+returning/);
  assert.doesNotMatch(remove.text, /archived_at/);
  assert.deepEqual(archive.values, [DOCUMENT_ID]);
  assert.deepEqual(restore.values, [DOCUMENT_ID]);
  assert.deepEqual(remove.values, [DOCUMENT_ID]);
});

test('listDocuments uses FTS5 full-text search with prefix terms when q is present', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ q: 'cloud tunnel' });
  assert.match(captured.text, /join markdown_documents_fts on markdown_documents_fts\.rowid = d\.rowid/);
  assert.match(captured.text, /markdown_documents_fts match \$1/);
  assert.deepEqual(captured.values, ['cloud* tunnel*']);
});

test('listDocuments sanitizes q to alphanumeric prefix terms (injection-safe)', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ q: 'post; drop table--' });
  assert.deepEqual(captured.values, ['post* drop* table*']);
});

test('listDocuments adds no FTS clause when q has no alphanumeric terms', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ q: '!!!' });
  assert.doesNotMatch(captured.text, /markdown_documents_fts/);
  assert.doesNotMatch(captured.text, /match \$/);
});

test('listDocuments combines projectId and full-text search', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ projectId: PROJECT_UUID, q: 'restore' });
  assert.match(captured.text, /project_id = \$1/);
  assert.match(captured.text, /markdown_documents_fts match \$2/);
  assert.deepEqual(captured.values, [PROJECT_UUID, 'restore*']);
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

test('buildGetDocument selects a single document by id', () => {
  const q = buildGetDocument('22222222-2222-4222-8222-222222222222');
  assert.match(q.text, /select \* from markdown_documents where id = \$1/);
  assert.deepEqual(q.values, ['22222222-2222-4222-8222-222222222222']);
});

test('buildCreateDocument stamps content_hash(body) and updated_by', () => {
  const q = buildCreateDocument({ title: 't', body: 'hello', documentType: 'note', projectId: 'p', tags: [], sourceFilename: null, updatedBy: 'agent' });
  assert.match(q.text, /content_hash/);
  assert.match(q.text, /updated_by/);
  assert.equal(q.values[q.values.length - 4], sha('hello'));
  assert.equal(q.values[q.values.length - 3], 'agent');
  assert.equal(q.values[q.values.length - 1], false);
});

test('buildCreateDocument defaults updated_by to user', () => {
  const q = buildCreateDocument({ title: 't', body: 'x', documentType: 'note', projectId: 'p', tags: [], sourceFilename: null });
  assert.equal(q.values[q.values.length - 3], 'user');
});

test('buildCreateDocument sets verified by origin (agent=false, human=true, default=true)', () => {
  const base = { title: 't', body: 'b', documentType: 'note', projectId: 'p', tags: [], sourceFilename: null };
  const human = buildCreateDocument({ ...base, updatedBy: 'user' });
  const agent = buildCreateDocument({ ...base, updatedBy: 'agent' });
  const dflt = buildCreateDocument({ ...base });
  assert.match(human.text, /, verified\)/);
  assert.equal(human.values[human.values.length - 1], true);
  assert.equal(agent.values[agent.values.length - 1], false);
  assert.equal(dflt.values[dflt.values.length - 1], true);
});

test('buildUpdateDocument always stamps updated_by and recomputes hash only when body changes', () => {
  const withBody = buildUpdateDocument('id', { body: 'new body', updatedBy: 'agent' });
  assert.match(withBody.text, /updated_by = \$/);
  assert.match(withBody.text, /content_hash = \$/);
  // Agent revocation is conditional on the content ACTUALLY changing: the
  // stored hash is compared to the incoming body's hash, so a byte-identical
  // body keeps the human verification and a changed one loses it (QINV-04).
  assert.match(withBody.text, /verified = case when content_hash = \$\d+ then verified else 0 end/);
  assert.match(withBody.text, /verified_at = case when content_hash = \$\d+ then verified_at else null end/);
  assert.match(withBody.text, /verified_by = case when content_hash = \$\d+ then verified_by else null end/);
  assert.ok(withBody.values.includes(sha('new body')));
  assert.ok(withBody.values.includes('agent'));

  const noBody = buildUpdateDocument('id', { title: 'renamed', updatedBy: 'user' });
  assert.match(noBody.text, /updated_by = \$/);
  assert.doesNotMatch(noBody.text, /content_hash = \$/);
  assert.doesNotMatch(noBody.text, /verified/);

  // Agent metadata-only edits (retag, project move) never touch verification:
  // the content the human blessed did not change.
  const agentRetag = buildUpdateDocument('id', { tags: ['ops'], updatedBy: 'agent' });
  assert.doesNotMatch(agentRetag.text, /verified/);
});

test('buildSetDocumentEmbedding rejects a stale result when content changed in flight', () => {
  const q = buildSetDocumentEmbedding(DOCUMENT_ID, {
    vector: [0.1], backend: 'fake', model: 'm', dim: 1, contentHash: 'old-hash',
  });
  assert.match(q.text, /where id = \$1 and content_hash = \$6/);
  assert.equal(q.values[5], 'old-hash');
});

test('normalizeDocumentRow exposes contentHash and updatedBy', () => {
  const out = normalizeDocumentRow({
    id: 'i', title: 't', body: 'b', document_type: 'note', project_id: 'p',
    tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u',
    content_hash: 'abc', updated_by: 'agent',
  });
  assert.equal(out.contentHash, 'abc');
  assert.equal(out.updatedBy, 'agent');
});

test('normalizeDocumentRow exposes trust fields with safe defaults', () => {
  const missing = normalizeDocumentRow({
    id: 'i', title: 't', body: 'b', document_type: 'note', project_id: 'p',
    tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u',
  });
  assert.equal(missing.verified, false);
  assert.equal(missing.verifiedAt, null);
  assert.equal(missing.verifiedBy, null);
  assert.equal(missing.status, 'active');

  const present = normalizeDocumentRow({
    id: 'i', title: 't', body: 'b', document_type: 'note', project_id: 'p',
    tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u',
    verified: true, verified_at: '2026-06-04T10:00:00.000Z', verified_by: 'mark', status: 'superseded',
  });
  assert.equal(present.verified, true);
  assert.equal(present.verifiedAt, '2026-06-04T10:00:00.000Z');
  assert.equal(present.verifiedBy, 'mark');
  assert.equal(present.status, 'superseded');
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
