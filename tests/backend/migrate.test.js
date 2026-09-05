import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrationBoundary,
  orderedMigrations,
  pendingMigrations,
  runMigrations,
} from '../../server/migrate.js';

const SILENT = { info() {}, error() {} };

function tmpMigrations(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prax-mig-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

// A fake db whose connect() returns a fake client recording SQL and simulating
// the schema_migrations table. Migration bodies run through db.exec (the raw
// multi-statement handle, matching the SQLite adapter); `failSql` makes any
// exec'd body containing it throw.
function makeFakeDb({ failSql = null } = {}) {
  const appliedVersions = [];
  const calls = [];
  const executed = [];
  const state = { released: false };
  const client = {
    async query(text, params = []) {
      const head = text.trim().split('\n')[0].trim();
      calls.push({ head, text, params });
      if (/^select version from schema_migrations/i.test(head)) {
        return { rows: appliedVersions.map(v => ({ version: v })) };
      }
      if (/^insert into schema_migrations/i.test(head)) {
        appliedVersions.push(params[0]);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { state.released = true; },
  };
  return {
    connect: async () => client,
    exec(sql) {
      executed.push(sql);
      if (failSql && sql.includes(failSql)) throw new Error('boom');
    },
    _appliedVersions: appliedVersions,
    _calls: calls,
    _executed: executed,
    _state: state,
  };
}

test('pendingMigrations sorts by numeric ordinal and excludes applied + non-matching files', () => {
  const files = ['0010_late.sql', '0002_b.sql', '0001_init.sql', 'README.md', 'notes.txt'];
  assert.deepEqual(pendingMigrations(files, []), ['0001_init.sql', '0002_b.sql', '0010_late.sql']);
  assert.deepEqual(pendingMigrations(files, ['0001_init.sql']), ['0002_b.sql', '0010_late.sql']);
  assert.deepEqual(pendingMigrations([], []), []);
});

test('migration boundaries resolve a declared real version and limit pending work', () => {
  const files = ['0010_late.sql', '0002_b.sql', '0001_init.sql', 'README.md'];
  assert.deepEqual(orderedMigrations(files), [
    { version: '0001_init.sql', ordinal: 1 },
    { version: '0002_b.sql', ordinal: 2 },
    { version: '0010_late.sql', ordinal: 10 },
  ]);
  assert.deepEqual(migrationBoundary(files, '0002'), { version: '0002_b.sql', ordinal: 2 });
  assert.deepEqual(migrationBoundary(files, '0002_b.sql'), { version: '0002_b.sql', ordinal: 2 });
  assert.deepEqual(migrationBoundary(files, 'current'), { version: '0010_late.sql', ordinal: 10 });
  assert.deepEqual(pendingMigrations(files, [], { through: '0002' }), ['0001_init.sql', '0002_b.sql']);
  assert.deepEqual(pendingMigrations(files, ['0001_init.sql'], { through: 2 }), ['0002_b.sql']);
});

test('migration boundaries reject unknown or malformed declared versions', () => {
  const files = ['0001_init.sql', '0002_b.sql'];
  assert.throws(() => migrationBoundary(files, '0003'), /Unknown migration boundary/);
  assert.throws(() => migrationBoundary(files, '0002_missing.sql'), /Unknown migration boundary/);
  assert.throws(() => migrationBoundary(files, 'latest-ish'), /Unknown migration boundary/);
});

test('runMigrations applies pending files in order, records each, releases the session', async () => {
  const dir = tmpMigrations({ '0001_init.sql': 'create table a(x);', '0002_more.sql': 'create table b(x);' });
  const db = makeFakeDb();
  const result = await runMigrations(db, { dir, logger: SILENT });
  assert.deepEqual(result.applied, ['0001_init.sql', '0002_more.sql']);
  assert.deepEqual(db._appliedVersions, ['0001_init.sql', '0002_more.sql']);
  // one write-locking transaction per migration, bodies run via exec
  assert.equal(db._calls.filter(c => c.head === 'begin immediate').length, 2);
  assert.equal(db._calls.filter(c => c.head === 'commit').length, 2);
  assert.equal(db._executed.length, 2);
  assert.equal(db._state.released, true);
});

test('runMigrations stops at the declared boundary and a later run resumes normally', async () => {
  const dir = tmpMigrations({
    '0001_init.sql': 'create table a(x);',
    '0002_more.sql': 'create table b(x);',
    '0003_latest.sql': 'create table c(x);',
  });
  const db = makeFakeDb();
  const historical = await runMigrations(db, { dir, logger: SILENT, through: '0002' });
  assert.deepEqual(historical.applied, ['0001_init.sql', '0002_more.sql']);
  const upgraded = await runMigrations(db, { dir, logger: SILENT });
  assert.deepEqual(upgraded.applied, ['0003_latest.sql']);
});

test('runMigrations is a no-op when everything is already applied', async () => {
  const dir = tmpMigrations({ '0001_init.sql': 'create table a(x);' });
  const db = makeFakeDb();
  db._appliedVersions.push('0001_init.sql');
  const result = await runMigrations(db, { dir, logger: SILENT });
  assert.deepEqual(result.applied, []);
  assert.equal(db._calls.filter(c => c.head === 'begin immediate').length, 0);
  assert.equal(db._state.released, true);
});

test('runMigrations aborts on a failing migration: rolls back, does not record it or run later ones', async () => {
  const dir = tmpMigrations({
    '0001_init.sql': 'create table a(x);',
    '0002_boom.sql': 'SELECT boom_marker;',
    '0003_after.sql': 'create table c(x);',
  });
  const db = makeFakeDb({ failSql: 'boom_marker' });
  await assert.rejects(() => runMigrations(db, { dir, logger: SILENT }), /0002_boom\.sql/);
  assert.deepEqual(db._appliedVersions, ['0001_init.sql']); // 0002 not recorded, 0003 never ran
  assert.equal(db._calls.filter(c => c.head === 'rollback').length, 1);
  assert.equal(db._state.released, true); // released even on failure
});

test('runMigrations applies the real consolidated schema against real SQLite', async () => {
  const { createDb } = await import('../../server/db.js');
  const db = createDb(':memory:');
  const result = await runMigrations(db, { logger: SILENT });
  assert.deepEqual(result.applied, ['0001_init.sql', '0002_add_inbox_project.sql', '0003_add_task_deferred_until.sql', '0004_add_project_oncall.sql', '0005_add_runbook_runs.sql', '0006_add_task_recurrence.sql', '0007_add_task_labels.sql', '0008_add_task_due_time.sql', '0009_add_project_repo_url.sql', '0010_document_type_taxonomy.sql', '0011_add_document_external_refs.sql', '0012_enforce_supersession_lifecycle.sql', '0013_add_durable_run_chronicle.sql', '0014_add_task_import_operations.sql', '0015_add_document_creation_receipts.sql', '0016_add_task_activity_actor.sql', '0017_clamp_task_recurrence_intervals.sql', '0018_reconcile_restored_supersession.sql', '0019_resequence_chronicle_by_time.sql', '0020_add_task_deferral_count.sql', '0021_add_task_planning.sql', '0022_add_project_area.sql', '0023_add_document_revision.sql', '0024_add_task_import_sessions.sql', '0025_assistant_write_receipts.sql']);
  const { rows } = await db.query('select slug from projects order by sort_order');
  assert.deepEqual(rows.map(r => r.slug), ['inbox', 'personal', 'work', 'homelab']);
  // idempotent second run
  const again = await runMigrations(db, { logger: SILENT });
  assert.deepEqual(again.applied, []);
  await db.close();
});

test('0012 reconciles pre-invariant supersession rows while upgrading', async () => {
  const { createDb } = await import('../../server/db.js');
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT, through: '0011' });
  const project = (await db.query("select id from projects where slug = 'homelab'")).rows[0];
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id, status)
     values ($1, 'Old', '', 'note', $4, 'active'),
            ($2, 'New', '', 'note', $4, 'active'),
            ($3, 'Orphaned status', '', 'note', $4, 'superseded')`,
    ['old', 'new', 'orphan', project.id],
  );
  await db.query(
    "insert into document_links (source_document_id, target_document_id, relation) values ('new', 'old', 'supersedes')",
  );
  assert.deepEqual(
    (await db.query("select id, status from markdown_documents where id in ('old', 'orphan') order by id")).rows.map(row => ({ ...row })),
    [{ id: 'old', status: 'active' }, { id: 'orphan', status: 'superseded' }],
  );

  assert.deepEqual((await runMigrations(db, { logger: SILENT, through: '0012' })).applied, ['0012_enforce_supersession_lifecycle.sql']);
  assert.deepEqual(
    (await db.query("select id, status from markdown_documents where id in ('old', 'orphan') order by id")).rows.map(row => ({ ...row })),
    [{ id: 'old', status: 'superseded' }, { id: 'orphan', status: 'active' }],
  );
  await db.close();
});

test('0013 preserves legacy runs and steps while backfilling source snapshots and recoverable events', async () => {
  const { createDb } = await import('../../server/db.js');
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT, through: '0012' });
  const project = (await db.query("select id from projects where slug = 'homelab'")).rows[0];
  const documentId = '10000000-0000-4000-8000-000000000001';
  const completedRunId = '20000000-0000-4000-8000-000000000001';
  const runningRunId = '20000000-0000-4000-8000-000000000002';
  const stepId = '30000000-0000-4000-8000-000000000001';
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id)
     values ($1, 'Legacy failover', '- [ ] Promote', 'runbook', $2)`,
    [documentId, project.id],
  );
  await db.query(
    `insert into runbook_runs (id, document_id, title, status, started_by, started_at, finished_at)
     values ($1, $3, 'Incident', 'completed', 'agent', '2026-07-01T10:00:00.000Z', '2026-07-01T10:05:00.000Z'),
            ($2, $3, '', 'running', 'user', '2026-07-02T10:00:00.000Z', null)`,
    [completedRunId, runningRunId, documentId],
  );
  await db.query(
    `insert into runbook_run_steps (id, run_id, position, text, checked_at, checked_by)
     values ($1, $2, 0, 'Promote', '2026-07-01T10:03:00.000Z', 'ada')`,
    [stepId, completedRunId],
  );

  assert.deepEqual(
    (await runMigrations(db, { logger: SILENT, through: '0013' })).applied,
    ['0013_add_durable_run_chronicle.sql'],
  );
  const run = (await db.query('select * from runbook_runs where id = $1', [completedRunId])).rows[0];
  assert.equal(run.document_title, 'Legacy failover');
  assert.equal(run.project_id, project.id);
  assert.equal(run.finished_by, null);
  assert.equal((await db.query('select count(*) as count from runbook_run_steps')).rows[0].count, 1);
  assert.deepEqual(
    (await db.query(
      'select sequence, event_type, actor from runbook_run_events where run_id = $1 order by sequence',
      [completedRunId],
    )).rows.map(row => ({ ...row })),
    [
      { sequence: 0, event_type: 'started', actor: 'agent' },
      { sequence: 1, event_type: 'step-checked', actor: 'ada' },
      { sequence: 2, event_type: 'completed', actor: 'unknown' },
    ],
  );
  assert.deepEqual(
    (await db.query(
      'select event_type from runbook_run_events where run_id = $1 order by sequence',
      [runningRunId],
    )).rows.map(row => row.event_type),
    ['started'],
  );

  await db.query('delete from markdown_documents where id = $1', [documentId]);
  const preserved = (await db.query('select document_id, document_title from runbook_runs order by id')).rows;
  assert.deepEqual(preserved.map(row => ({ ...row })), [
    { document_id: null, document_title: 'Legacy failover' },
    { document_id: null, document_title: 'Legacy failover' },
  ]);
  assert.equal((await db.query('PRAGMA foreign_key_check')).rows.length, 0);
  await db.close();
});
