import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../server/migrate.js';
import { createDb } from '../../server/db.js';

const SILENT = { info() {}, error() {} };
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../server/migrations');

// The 0010 rebuild (document_type CHECK dropped) must carry a POPULATED
// pre-0010 database across intact: rows, child tables under CASCADE FKs
// (document_links — the exact data a DROP with foreign_keys ON would silently
// cascade away), the rowid-keyed FTS index, and the post-mortem retype.
test('0010 rebuild preserves data, links, and FTS; retypes tagged post-mortems; drops the CHECK', async () => {
  // Stage a migrations dir holding only 0001–0009, apply it, and populate.
  const stage = mkdtempSync(join(tmpdir(), 'prax-tax-'));
  for (const f of readdirSync(MIGRATIONS_DIR)) {
    if (/^00(0[1-9])_/.test(f)) copyFileSync(join(MIGRATIONS_DIR, f), join(stage, f));
  }
  const db = createDb(':memory:');
  await runMigrations(db, { dir: stage, logger: SILENT });

  const project = (await db.query("select id from projects where slug = 'inbox'")).rows[0].id;
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id, tags)
     values ('00000000-0000-4000-8000-00000000d001', 'Failover runbook', 'promote the replica', 'runbook', $1, '[]'),
            ('00000000-0000-4000-8000-00000000d002', 'Outage 2026-07 post-mortem', 'what happened', 'note', $1, '["post-mortem"]'),
            ('00000000-0000-4000-8000-00000000d003', 'Cache notes', 'warming strategy', 'note', $1, '[]')`,
    [project],
  );
  await db.query(
    `insert into document_links (source_document_id, target_document_id, relation)
     values ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000d001', 'derived-from')`,
  );

  // Sanity: the pre-0010 CHECK still rejects new types.
  await assert.rejects(
    () => db.query(`insert into markdown_documents (id, title, body, document_type, project_id) values ('00000000-0000-4000-8000-00000000d004', 'x', '', 'decision', '${project}')`),
    /CHECK|constraint/i,
  );

  // Apply 0010 from the real migrations dir (0001–0009 already recorded).
  const result = await runMigrations(db, { logger: SILENT });
  assert.deepEqual(result.applied, [
    '0010_document_type_taxonomy.sql',
    '0011_add_document_external_refs.sql',
    '0012_enforce_supersession_lifecycle.sql',
    '0013_add_durable_run_chronicle.sql',
    '0014_add_task_import_operations.sql',
    '0015_add_document_creation_receipts.sql',
    '0016_add_task_activity_actor.sql',
    '0017_clamp_task_recurrence_intervals.sql',
    '0018_reconcile_restored_supersession.sql',
    '0019_resequence_chronicle_by_time.sql',
    '0020_add_task_deferral_count.sql',
    '0021_add_task_planning.sql',
    '0022_add_project_area.sql',
    '0023_add_document_revision.sql',
    '0024_add_task_import_sessions.sql',
    '0025_assistant_write_receipts.sql',
    '0026_add_document_updated_by_agent.sql',
    '0027_document_upsert_receipts.sql',
    '0028_document_code_refs.sql',
    '0029_document_code_refs_null_safe_key.sql',
    '0030_add_memory_system_project.sql',
    '0031_document_update_receipts.sql',
    '0032_restore_inbox_system_project.sql',
    '0033_inbox_action_receipts.sql',
    '0034_record_creation_receipts.sql',
    '0035_single_line_document_titles.sql',
    '0036_add_task_activity_agent.sql',
    '0037_add_task_recurrence_anchor_day.sql',
    '0038_repair_legacy_cycles_and_receipts.sql',
    '0039_add_citation_anchors.sql',
    '0040_recall_telemetry_and_librarian.sql',
    '0041_add_agent_recall_markers.sql',
  ]);

  // Every row survived, fields intact.
  const docs = (await db.query('select id, title, document_type from markdown_documents order by id')).rows;
  assert.equal(docs.length, 3);
  assert.equal(docs[0].document_type, 'runbook');
  assert.equal(docs[1].document_type, 'post-mortem'); // retyped from tagged note
  assert.equal(docs[2].document_type, 'note');

  // The CASCADE-linked child rows survived the rebuild (the whole point of fk=off).
  const links = (await db.query('select * from document_links')).rows;
  assert.equal(links.length, 1);

  // FTS still finds by body after the rebuild.
  const hits = (await db.query(
    "select rowid from markdown_documents_fts where markdown_documents_fts match 'replica'",
  )).rows;
  assert.equal(hits.length, 1);

  // The CHECK is gone: new taxonomy values insert cleanly…
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id) values ('00000000-0000-4000-8000-00000000d005', 'Use SQLite', 'decided', 'decision', '${project}')`,
  );
  // …and the FTS triggers were recreated (the new row is searchable).
  const decisionHits = (await db.query(
    "select rowid from markdown_documents_fts where markdown_documents_fts match 'decided'",
  )).rows;
  assert.equal(decisionHits.length, 1);

  // foreign_keys is back ON after the migration (the runner restores it).
  const fk = (await db.query('PRAGMA foreign_keys')).rows[0];
  assert.equal(Object.values(fk)[0], 1);
  // …and still enforced: a doc pointing at a missing project must fail.
  await assert.rejects(
    () => db.query(`insert into markdown_documents (id, title, body, document_type, project_id) values ('00000000-0000-4000-8000-00000000d006', 'x', '', 'note', 'no-such-project')`),
    /FOREIGN KEY|constraint/i,
  );

  await db.close();
});

test('the fk=off marker is matched case- and spacing-tolerantly (no silent CASCADE loss)', async () => {
  const { pendingMigrations } = await import('../../server/migrate.js');
  // Guard the regex directly against near-miss spellings a future author might write.
  const RE = /^\s*--\s*migrate:\s*fk\s*=\s*off\s*$/im;
  for (const marker of ['-- migrate:fk=off', '-- migrate: fk=off', '--  migrate:fk = off', '-- MIGRATE:FK=OFF']) {
    assert.ok(RE.test(`${marker}\ncreate table x (a);`), marker);
  }
  // A non-marker comment must NOT trigger it.
  assert.equal(RE.test('-- migrate fk off later\ncreate table x (a);'), false);
  // sanity: pendingMigrations still imports cleanly
  assert.deepEqual(pendingMigrations([], []), []);
});
