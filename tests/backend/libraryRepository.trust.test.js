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
  const hash = 'a'.repeat(64);
  const q = buildVerifyDocument(ID, { verified: true, verifiedBy: 'mark', contentHash: hash });
  assert.match(q.text, /set verified = 1, verified_at = strftime\('%Y-%m-%dT%H:%M:%fZ','now'\), verified_by = \$2/);
  assert.match(q.text, /where id = \$1 and archived_at is null and content_hash = \$3/);
  // Null-safe IS: a user-created doc is born verified with verified_by NULL,
  // and `verified_by = $2` is NULL under three-valued logic — the guard would
  // exclude the row and the explicit review would never be stamped.
  assert.match(q.text, /not \(verified = 1 and verified_by is \$2\)/);
  assert.match(q.text, /returning \*/);
  assert.deepEqual(q.values, [ID, 'mark', hash]);
});

test('buildVerifyDocument clears stamps when unverifying', () => {
  const q = buildVerifyDocument(ID, { verified: false });
  assert.match(q.text, /set verified = 0, verified_at = null, verified_by = null/);
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

test('buildSearchDocumentsSemantic hides retired docs unless includeRetired', () => {
  // JS-cosine path: the candidate SQL keeps the pg-era trust filters.
  const active = buildSearchDocumentsSemantic('fake', {});
  assert.match(active.text, /status = 'active'/);
  const all = buildSearchDocumentsSemantic('fake', { includeRetired: true });
  assert.doesNotMatch(all.text, /status = 'active'/);
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

// ---------------------------------------------------------------------------
// EXECUTED trust regressions (2026-07-18 review): these run the real SQL
// against a real migrated database — the prior tests only regex-matched the
// query text, which is exactly how the NULL-guard bug shipped green.
// ---------------------------------------------------------------------------

const SILENT = { info() {}, error() {} };

async function realRepo() {
  const { createDb } = await import('../../server/db.js');
  const { runMigrations } = await import('../../server/migrate.js');
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const project = (await db.query("select id from projects where slug='inbox'")).rows[0].id;
  return { db, repo: createLibraryRepository(db), project };
}

test('EXECUTED: explicit verification stamps a user-created (implicitly verified) document', async () => {
  const { db, repo, project } = await realRepo();
  const doc = await repo.createDocument({
    title: 'Runbook', body: 'steps', documentType: 'runbook', projectId: project, updatedBy: 'user',
  });
  assert.equal(doc.verified, true, 'user-created docs are born verified');

  const stamped = await repo.verifyDocument(doc.id, { verified: true, verifiedBy: 'mark' });
  assert.ok(stamped, 'the update must hit the row (NULL verified_by must not exclude it)');
  const row = (await db.query('select verified, verified_at, verified_by from markdown_documents where id = $1', [doc.id])).rows[0];
  assert.equal(row.verified, 1);
  assert.equal(row.verified_by, 'mark', 'the reviewer is recorded');
  assert.ok(row.verified_at, 'the review time is recorded');

  // Same-reviewer replay stays a no-op that preserves the first stamp.
  const replay = await repo.verifyDocument(doc.id, { verified: true, verifiedBy: 'mark' });
  assert.equal(replay, null, 'replay does not rewrite the stamp');
});

test('EXECUTED: agent metadata-only edit keeps verification; agent content change revokes it', async () => {
  const { db, repo, project } = await realRepo();
  const doc = await repo.createDocument({
    title: 'Decision', body: 'we chose X', documentType: 'decision', projectId: project, updatedBy: 'user',
  });
  await repo.verifyDocument(doc.id, { verified: true, verifiedBy: 'alice' });

  // Retag (no body) — verification untouched.
  await repo.updateDocument(doc.id, { tags: ['ops'], updatedBy: 'agent' });
  let row = (await db.query('select verified, verified_by from markdown_documents where id = $1', [doc.id])).rows[0];
  assert.equal(row.verified, 1, 'metadata-only agent edit keeps the badge');
  assert.equal(row.verified_by, 'alice');

  // Byte-identical body resent by an agent — verification untouched.
  await repo.updateDocument(doc.id, { body: 'we chose X', updatedBy: 'agent' });
  row = (await db.query('select verified, verified_by from markdown_documents where id = $1', [doc.id])).rows[0];
  assert.equal(row.verified, 1, 'byte-identical agent body keeps the badge');

  // Real content change by an agent — verification revoked.
  await repo.updateDocument(doc.id, { body: 'we chose Y', updatedBy: 'agent' });
  row = (await db.query('select verified, verified_at, verified_by from markdown_documents where id = $1', [doc.id])).rows[0];
  assert.equal(row.verified, 0, 'agent content change revokes the badge');
  assert.equal(row.verified_by, null);
  assert.equal(row.verified_at, null);
});

test('EXECUTED: an agent title-only change revokes verification; identical title keeps it', async () => {
  const { db, repo, project } = await realRepo();
  const doc = await repo.createDocument({
    title: 'Failover runbook', body: 'steps', documentType: 'runbook', projectId: project, updatedBy: 'user',
  });
  await repo.verifyDocument(doc.id, { verified: true, verifiedBy: 'alice' });

  // Re-sending the SAME title (e.g. alongside a retag) keeps the badge.
  await repo.updateDocument(doc.id, { title: 'Failover runbook', tags: ['ops'], updatedBy: 'agent' });
  let row = (await db.query('select verified from markdown_documents where id = $1', [doc.id])).rows[0];
  assert.equal(row.verified, 1, 'unchanged title is not a content change');

  // Retitling changes the document's identity — the badge must go.
  await repo.updateDocument(doc.id, { title: 'How to skip the failover checklist', updatedBy: 'agent' });
  row = (await db.query('select verified, verified_by from markdown_documents where id = $1', [doc.id])).rows[0];
  assert.equal(row.verified, 0, 'an agent retitle revokes verification');
  assert.equal(row.verified_by, null);
});
