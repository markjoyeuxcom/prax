import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListCodeRefs,
  buildAddCodeRef,
  buildRemoveCodeRef,
  normalizeCodeRefRow,
  createDocumentCodeRefsRepository,
} from '../../server/documentCodeRefsRepository.js';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';

const DOC = '11111111-1111-4111-8111-111111111111';
const SILENT = { info() {}, error() {} };

// A migrated in-memory database with one live document to cite.
async function seed() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const project = (await db.query("select id from projects where slug='inbox'")).rows[0].id;
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id) values ($1, 'Doc', 'body', 'note', $2)`,
    [DOC, project],
  );
  return db;
}

test('a row normalises to the citation shape the checker consumes', () => {
  const row = {
    id: 'r1', document_id: DOC, path: 'server/config.js',
    start_line: 12, end_line: 36, commit_sha: 'abc123', content_hash: 'f'.repeat(64),
    created_at: '2026-09-11T00:00:00.000Z',
  };
  assert.deepEqual(normalizeCodeRefRow(row), {
    id: 'r1', documentId: DOC, path: 'server/config.js',
    startLine: 12, endLine: 36, commitSha: 'abc123', contentHash: 'f'.repeat(64),
    createdAt: '2026-09-11T00:00:00.000Z',
  });
});

test('a whole-file citation normalises with null bounds, not zeroes', () => {
  const row = { id: 'r', document_id: DOC, path: 'a.js', start_line: null, end_line: null, content_hash: 'h', created_at: 't' };
  const n = normalizeCodeRefRow(row);
  assert.equal(n.startLine, null);
  assert.equal(n.endLine, null);
  assert.equal(n.commitSha, null);
});

test('adding a citation is idempotent per (document, path, range)', () => {
  const q = buildAddCodeRef(DOC, { path: 'a.js', startLine: 1, endLine: 2, commitSha: 'sha', contentHash: 'h' });
  assert.match(q.text, /insert into document_code_refs/);
  // Re-citing the same range after the code changed refreshes the pin rather
  // than erroring or accumulating duplicates.
  // The target is the NULL-safe index (0029), so a whole-file citation with
  // NULL bounds upserts too — a column-list target never matched it.
  assert.match(q.text, /on conflict \(document_id, path, coalesce\(start_line, 0\), coalesce\(end_line, 0\)\) do update/);
  assert.match(q.text, /content_hash = excluded\.content_hash/);
  assert.match(q.text, /commit_sha = excluded\.commit_sha/);
  // Never attach a citation to an archived document.
  assert.match(q.text, /archived_at is null/);
  assert.deepEqual(q.values, [DOC, 'a.js', 1, 2, 'sha', 'h']);
});

test('listing is ordered so output is stable across calls', () => {
  const q = buildListCodeRefs(DOC);
  assert.match(q.text, /where document_id = \$1/);
  assert.match(q.text, /order by path, start_line/);
  assert.deepEqual(q.values, [DOC]);
});

// Regression: SQLite treats NULLs as distinct in a UNIQUE constraint, so the
// 0028 key never fired for whole-file citations and every re-cite (or a
// retried POST) inserted another row. The claim "re-citing refreshes the pin"
// has to hold for BOTH shapes against a real database.
test('re-citing a whole file refreshes the one pin instead of adding a row', async () => {
  const db = await seed();
  const repo = createDocumentCodeRefsRepository(db);
  const first = await repo.addCodeRef(DOC, { path: 'server/config.js', contentHash: 'h1', commitSha: 'c1' });
  const second = await repo.addCodeRef(DOC, { path: 'server/config.js', contentHash: 'h2', commitSha: 'c2' });
  assert.equal(second.id, first.id, 'the same citation row was refreshed');
  const refs = await repo.listCodeRefs(DOC);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].contentHash, 'h2');
  assert.equal(refs[0].commitSha, 'c2');
  assert.equal(refs[0].startLine, null, 'whole-file bounds stay NULL in storage');
  await db.close();
});

test('re-citing a line range refreshes the one pin, and ranges stay distinct from the whole file', async () => {
  const db = await seed();
  const repo = createDocumentCodeRefsRepository(db);
  await repo.addCodeRef(DOC, { path: 'a.js', contentHash: 'whole' });
  await repo.addCodeRef(DOC, { path: 'a.js', startLine: 1, endLine: 5, contentHash: 'r1' });
  await repo.addCodeRef(DOC, { path: 'a.js', startLine: 1, endLine: 5, contentHash: 'r2' });
  const refs = await repo.listCodeRefs(DOC);
  assert.deepEqual(refs.map((r) => [r.startLine, r.endLine, r.contentHash]), [[null, null, 'whole'], [1, 5, 'r2']]);
  await db.close();
});

test('migration 0029 collapses duplicates left by the 0028 key to the newest pin', async () => {
  const db = createDb(':memory:');
  // Migrate to 0028, plant the duplicates that key allowed, then apply 0029.
  await runMigrations(db, { logger: SILENT, through: '0028' });
  const project = (await db.query("select id from projects where slug='inbox'")).rows[0].id;
  await db.query(`insert into markdown_documents (id, title, body, document_type, project_id) values ($1, 'Doc', 'b', 'note', $2)`, [DOC, project]);
  for (const hash of ['old', 'older', 'newest']) {
    await db.query('insert into document_code_refs (document_id, path, content_hash) values ($1, $2, $3)', [DOC, 'a.js', hash]);
  }
  assert.equal((await db.query('select count(*) as n from document_code_refs')).rows[0].n, 3);
  const { applied } = await runMigrations(db, { logger: SILENT });
  assert.deepEqual(applied, ['0029_document_code_refs_null_safe_key.sql', '0030_add_memory_system_project.sql', '0031_document_update_receipts.sql', '0032_restore_inbox_system_project.sql', '0033_inbox_action_receipts.sql', '0034_record_creation_receipts.sql', '0035_single_line_document_titles.sql', '0036_add_task_activity_agent.sql', '0037_add_task_recurrence_anchor_day.sql', '0038_repair_legacy_cycles_and_receipts.sql']);
  const rows = (await db.query('select content_hash from document_code_refs')).rows;
  assert.deepEqual(rows.map((r) => r.content_hash), ['newest']);
  await db.close();
});

test('removing a citation targets one document and id', () => {
  const q = buildRemoveCodeRef(DOC, 'r1');
  assert.match(q.text, /delete from document_code_refs/);
  assert.match(q.text, /where document_id = \$1 and id = \$2/);
  assert.deepEqual(q.values, [DOC, 'r1']);
});
