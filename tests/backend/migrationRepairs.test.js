import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';

const SILENT = { info() {}, error() {} };

async function migratedDb() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const project = (await db.query("select id from projects where slug='inbox'")).rows[0].id;
  return { db, project };
}

// EXECUTED (2026-07-18 review, plan item 15): the archived-target supersession
// gap. 0012 kept a LIVE target coherent, but archive-target -> archive-
// superseder (trigger 3 flips the archived target to active) -> restore-
// superseder (trigger 4 skips archived targets) -> restore-target (nothing
// fired) stranded a live 'active' doc with a live supersedes edge. The 0018
// restore trigger recomputes the restored row's own status.
test('restoring a superseded target recomputes its status from live edges', async () => {
  const { db, project } = await migratedDb();
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id)
     values ('00000000-0000-4000-8000-00000000000a', 'Old runbook', 'v1', 'runbook', $1),
            ('00000000-0000-4000-8000-00000000000b', 'New runbook', 'v2', 'runbook', $1)`,
    [project],
  );
  await db.query(
    `insert into document_links (source_document_id, target_document_id, relation)
     values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a', 'supersedes')`,
  );
  const status = async (id) => (await db.query('select status, archived_at from markdown_documents where id = $1', [id])).rows[0];
  assert.equal((await status('00000000-0000-4000-8000-00000000000a')).status, 'superseded', '0012 insert trigger');

  // The exact stranding sequence from the review:
  await db.query("update markdown_documents set archived_at = '2026-07-01T00:00:00Z' where id = '00000000-0000-4000-8000-00000000000a'");
  await db.query("update markdown_documents set archived_at = '2026-07-02T00:00:00Z' where id = '00000000-0000-4000-8000-00000000000b'");
  await db.query("update markdown_documents set archived_at = null where id = '00000000-0000-4000-8000-00000000000b'");
  await db.query("update markdown_documents set archived_at = null where id = '00000000-0000-4000-8000-00000000000a'");

  const target = await status('00000000-0000-4000-8000-00000000000a');
  assert.equal(target.archived_at, null);
  assert.equal(target.status, 'superseded', 'the restored target recomputed from its live inbound edge');

  // And the mirror: restoring a target whose superseder is gone comes back active.
  await db.query("delete from document_links where relation = 'supersedes'");
  assert.equal((await status('00000000-0000-4000-8000-00000000000a')).status, 'active', '0012 delete trigger still owns edge removal');
});

test('0018 restore trigger never touches a deprecated document', async () => {
  const { db, project } = await migratedDb();
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id, status, archived_at)
     values ('00000000-0000-4000-8000-00000000000c', 'Deprecated note', 'x', 'note', $1, 'deprecated', '2026-07-01T00:00:00Z')`,
    [project],
  );
  await db.query("update markdown_documents set archived_at = null where id = '00000000-0000-4000-8000-00000000000c'");
  const row = (await db.query("select status from markdown_documents where id = '00000000-0000-4000-8000-00000000000c'")).rows[0];
  assert.equal(row.status, 'deprecated', 'manual lifecycle states are preserved on restore');
});

// EXECUTED (plan item 16): the 0013 backfill sequenced legacy step-checked
// events by runbook position while stamping created_at from checked_at,
// baking a false order into the ledger. The 0019 re-sequencing orders by
// created_at (tie-break original sequence) under the unique(run_id, sequence)
// constraint.
test('0019 re-sequences a position-ordered chronicle by check time', async () => {
  const { db, project } = await migratedDb();
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id)
     values ('00000000-0000-4000-8000-00000000000d', 'RB', '- [ ] a\n- [ ] b', 'runbook', $1)`,
    [project],
  );
  await db.query(
    `insert into runbook_runs (id, document_id, document_title, project_id, title, status, started_at, finished_at)
     values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000d', 'RB', $1, 'RB run', 'completed', '2026-07-01T09:00:00Z', '2026-07-01T10:00:00Z')`,
    [project],
  );
  // Mimic the 0013 backfill's wrong order: operator checked step 2 BEFORE
  // step 1, but position-ordered sequences say otherwise.
  await db.query(`
    insert into runbook_run_events (run_id, sequence, event_type, step_text, actor, created_at) values
      ('00000000-0000-4000-8000-0000000000e1', 0, 'started',      null,      'op', '2026-07-01T09:00:00Z'),
      ('00000000-0000-4000-8000-0000000000e1', 1, 'step-checked', 'step 1',  'op', '2026-07-01T09:45:00Z'),
      ('00000000-0000-4000-8000-0000000000e1', 2, 'step-checked', 'step 2',  'op', '2026-07-01T09:15:00Z'),
      ('00000000-0000-4000-8000-0000000000e1', 3, 'completed',    null,      'op', '2026-07-01T10:00:00Z')
  `);

  // The exact statements 0019 applied (a migrated db already ran them on
  // empty tables; re-run against this seeded state to prove the repair).
  await db.query(`
    update runbook_run_events set sequence = sequence + 1000000
    where run_id in (select run_id from runbook_run_events group by run_id having count(*) > 1)
  `);
  await db.query(`
    update runbook_run_events
    set sequence = (
      select count(*) from runbook_run_events peer
      where peer.run_id = runbook_run_events.run_id
        and (peer.created_at < runbook_run_events.created_at
          or (peer.created_at = runbook_run_events.created_at and peer.rowid < runbook_run_events.rowid))
    )
    where run_id in (select run_id from runbook_run_events group by run_id having count(*) > 1)
  `);

  const events = (await db.query(
    "select sequence, event_type, step_text, created_at from runbook_run_events where run_id = '00000000-0000-4000-8000-0000000000e1' order by sequence",
  )).rows;
  assert.deepEqual(events.map((e) => [e.sequence, e.event_type, e.step_text]), [
    [0, 'started', null],
    [1, 'step-checked', 'step 2'],
    [2, 'step-checked', 'step 1'],
    [3, 'completed', null],
  ], 'the ledger order now matches the timestamps it always carried');
});

// Closing-review regression: two events sharing created_at must not collide
// on the unique(run_id, sequence) constraint — the tie-break is rowid, which
// is stable while the UPDATE mutates sequences row by row.
test('0019 re-sequencing survives created_at ties without unique collisions', async () => {
  const { db, project } = await migratedDb();
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id)
     values ('00000000-0000-4000-8000-00000000000e', 'RB2', '- [ ] a', 'runbook', $1)`,
    [project],
  );
  await db.query(
    `insert into runbook_runs (id, document_id, document_title, project_id, title, status, started_at)
     values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000e', 'RB2', $1, 'RB2 run', 'completed', '2026-07-01T09:00:00Z')`,
    [project],
  );
  // Three events, two sharing the same timestamp, inserted out of final order.
  await db.query(`
    insert into runbook_run_events (run_id, sequence, event_type, step_text, actor, created_at) values
      ('00000000-0000-4000-8000-0000000000e2', 0, 'started',      null,     'op', '2026-07-01T09:00:00Z'),
      ('00000000-0000-4000-8000-0000000000e2', 1, 'step-checked', 'tie-a',  'op', '2026-07-01T09:30:00Z'),
      ('00000000-0000-4000-8000-0000000000e2', 2, 'step-checked', 'tie-b',  'op', '2026-07-01T09:30:00Z')
  `);
  await db.query(`
    update runbook_run_events set sequence = sequence + 1000000
    where run_id in (select run_id from runbook_run_events group by run_id having count(*) > 1)
  `);
  await db.query(`
    update runbook_run_events
    set sequence = (
      select count(*) from runbook_run_events peer
      where peer.run_id = runbook_run_events.run_id
        and (peer.created_at < runbook_run_events.created_at
          or (peer.created_at = runbook_run_events.created_at and peer.rowid < runbook_run_events.rowid))
    )
    where run_id in (select run_id from runbook_run_events group by run_id having count(*) > 1)
  `);
  const rows = (await db.query(
    "select sequence, step_text from runbook_run_events where run_id = '00000000-0000-4000-8000-0000000000e2' order by sequence",
  )).rows;
  assert.deepEqual(rows.map((r) => r.sequence), [0, 1, 2], 'unique, gapless sequences despite the tie');
  assert.deepEqual(rows.map((r) => r.step_text), [null, 'tie-a', 'tie-b'], 'ties keep insert order');
});

// Closing-review regression: RETURNING does not see AFTER-trigger writes, so
// restoreDocument must re-read — the restore response's status has to match
// what is actually stored.
test('restoreDocument returns the post-trigger status', async () => {
  const { db, project } = await migratedDb();
  const { createLibraryRepository } = await import('../../server/libraryRepository.js');
  const repo = createLibraryRepository(db);
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id)
     values ('00000000-0000-4000-8000-00000000000f', 'Old', 'v1', 'runbook', $1),
            ('00000000-0000-4000-8000-000000000010', 'New', 'v2', 'runbook', $1)`,
    [project],
  );
  await db.query(
    `insert into document_links (source_document_id, target_document_id, relation)
     values ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000f', 'supersedes')`,
  );
  // Strand: archive target, archive superseder (flips archived target active),
  // restore superseder — then restore the target via the REPOSITORY.
  await db.query("update markdown_documents set archived_at = '2026-07-01T00:00:00Z' where id = '00000000-0000-4000-8000-00000000000f'");
  await db.query("update markdown_documents set archived_at = '2026-07-02T00:00:00Z' where id = '00000000-0000-4000-8000-000000000010'");
  await db.query("update markdown_documents set archived_at = null where id = '00000000-0000-4000-8000-000000000010'");
  const restored = await repo.restoreDocument('00000000-0000-4000-8000-00000000000f');
  assert.equal(restored.status, 'superseded', 'the response reflects the trigger-recomputed status');
});
