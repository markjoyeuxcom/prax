import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerifyDocument,
  buildMarkSuperseded,
  buildRevertSupersededIfOrphan,
  buildSearchDocumentsSemantic,
  createLibraryRepository,
} from '../../server/libraryRepository.js';

const ID = '11111111-1111-4111-8111-111111111111';

test('buildVerifyDocument sets verified + stamps when verifying', () => {
  const q = buildVerifyDocument(ID, { verified: true, verifiedBy: 'mark' });
  assert.match(q.text, /set verified = true, verified_at = now\(\), verified_by = \$2/);
  assert.match(q.text, /where id = \$1 and archived_at is null/);
  assert.match(q.text, /returning \*/);
  assert.deepEqual(q.values, [ID, 'mark']);
});

test('buildVerifyDocument clears stamps when unverifying', () => {
  const q = buildVerifyDocument(ID, { verified: false });
  assert.match(q.text, /set verified = false, verified_at = null, verified_by = null/);
  assert.deepEqual(q.values, [ID]);
});

test('buildMarkSuperseded only flips an active doc', () => {
  const q = buildMarkSuperseded(ID);
  assert.match(q.text, /set status = 'superseded'/);
  assert.match(q.text, /where id = \$1 and status = 'active'/);
  assert.deepEqual(q.values, [ID]);
});

test('buildRevertSupersededIfOrphan reverts only when no live supersedes link remains', () => {
  const q = buildRevertSupersededIfOrphan(ID);
  assert.match(q.text, /set status = 'active'/);
  assert.match(q.text, /status = 'superseded'/);
  assert.match(q.text, /not exists/);
  assert.match(q.text, /relation = 'supersedes'/);
  // Links from archived documents must not hold the target superseded.
  assert.match(q.text, /join markdown_documents src on src\.id = dl\.source_document_id/);
  assert.match(q.text, /src\.archived_at is null/);
  assert.deepEqual(q.values, [ID]);
});

test('buildSearchDocumentsSemantic selects trust fields and filters to active by default', () => {
  const q = buildSearchDocumentsSemantic('[0.1]', 'fake', {});
  assert.match(q.text, /verified, status/);
  assert.match(q.text, /and status = 'active'/);
});

test('buildSearchDocumentsSemantic includes retired rows when asked', () => {
  const q = buildSearchDocumentsSemantic('[0.1]', 'fake', { includeRetired: true });
  assert.doesNotMatch(q.text, /and status = 'active'/);
});

test('listDocuments applies a known status filter', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ status: 'active' });
  assert.match(captured.text, /d\.status = \$1/);
  assert.deepEqual(captured.values, ['active']);
});

test('listDocuments ignores an unknown status filter', async () => {
  let captured;
  const db = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  const repo = createLibraryRepository(db);
  await repo.listDocuments({ status: 'bogus' });
  assert.doesNotMatch(captured.text, /d\.status = \$/);
});

test('verifyDocument returns the normalized row', async () => {
  const db = { query: async () => ({ rows: [{ id: ID, title: 't', body: 'b', document_type: 'note', project_id: 'p', tags: [], source_filename: null, archived_at: null, created_at: 'c', updated_at: 'u', verified: true, status: 'active' }] }) };
  const repo = createLibraryRepository(db);
  const out = await repo.verifyDocument(ID, { verified: true, verifiedBy: 'mark' });
  assert.equal(out.verified, true);
});
