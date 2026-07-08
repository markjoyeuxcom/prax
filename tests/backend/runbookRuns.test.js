import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { parseRunbookSteps } from '../../server/runbookSteps.js';
import { createRunbookRunsRepository } from '../../server/runbookRunsRepository.js';

const SILENT = { info() {}, error() {} };

// ---- parseRunbookSteps -------------------------------------------------------

test('parseRunbookSteps extracts checkbox lines as ordered steps, tolerating bullets/indent', () => {
  const md = [
    '# Restore drill',
    'Intro paragraph — not a step.',
    '- [ ] Stop writes to the primary',
    '  * [ ] Drain PgBouncer',
    '+ [x] Promote the replica',
    '- not a checkbox',
    '- [ ]   ', // empty step, skipped
  ].join('\n');
  assert.deepEqual(parseRunbookSteps(md), [
    { position: 0, text: 'Stop writes to the primary', initiallyChecked: false },
    { position: 1, text: 'Drain PgBouncer', initiallyChecked: false },
    { position: 2, text: 'Promote the replica', initiallyChecked: true },
  ]);
});

test('parseRunbookSteps returns [] for a runbook with no checkboxes', () => {
  assert.deepEqual(parseRunbookSteps('# Notes\n\nJust prose.\n\n1. ordered item'), []);
  assert.deepEqual(parseRunbookSteps(''), []);
  assert.deepEqual(parseRunbookSteps(null), []);
});

// ---- repository (real in-memory SQLite) --------------------------------------

async function freshRepo() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const projectId = (await db.query('select id from projects limit 1')).rows[0].id;
  const doc = await db.query(
    "insert into markdown_documents (title, document_type, project_id, body) values ('Restore', 'runbook', $1, '# Restore') returning id",
    [projectId],
  );
  return { db, repo: createRunbookRunsRepository(db), documentId: doc.rows[0].id };
}

test('createRun snapshots steps and starts them all unchecked, status running', async () => {
  const { repo, documentId } = await freshRepo();
  const run = await repo.createRun({
    documentId,
    title: 'Prod incident',
    steps: [{ text: 'Stop writes' }, { text: 'Promote replica' }],
  });
  assert.equal(run.documentId, documentId);
  assert.equal(run.status, 'running');
  assert.equal(run.finishedAt, null);
  assert.match(run.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(run.steps.length, 2);
  assert.deepEqual(run.steps.map((s) => [s.position, s.text, s.checkedAt]), [
    [0, 'Stop writes', null],
    [1, 'Promote replica', null],
  ]);
});

test('setStepChecked stamps checked_at + checked_by; unchecking clears both', async () => {
  const { repo, documentId } = await freshRepo();
  const run = await repo.createRun({ documentId, steps: [{ text: 'A' }, { text: 'B' }] });
  const stepA = run.steps[0];

  const checked = await repo.setStepChecked(run.id, stepA.id, { checked: true, checkedBy: 'ada' });
  assert.match(checked.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(checked.checkedBy, 'ada');

  const unchecked = await repo.setStepChecked(run.id, stepA.id, { checked: false });
  assert.equal(unchecked.checkedAt, null);
  assert.equal(unchecked.checkedBy, null);

  // A step id from a different run must not be flippable via this run.
  assert.equal(await repo.setStepChecked('no-such-run', stepA.id, { checked: true }), null);
});

test('setRunStatus completes/aborts with a finished_at, and getRun returns steps in order', async () => {
  const { repo, documentId } = await freshRepo();
  const run = await repo.createRun({ documentId, steps: [{ text: 'One' }, { text: 'Two' }] });

  const done = await repo.setRunStatus(run.id, 'completed');
  assert.equal(done.status, 'completed');
  assert.match(done.finishedAt, /^\d{4}-\d{2}-\d{2}T/);

  const fetched = await repo.getRun(run.id);
  assert.equal(fetched.status, 'completed');
  assert.deepEqual(fetched.steps.map((s) => s.position), [0, 1]);
  assert.equal(await repo.getRun('missing'), null);
});

test('listRunsForDocument returns runs newest-first with step + done counts', async () => {
  const { repo, documentId } = await freshRepo();
  const run = await repo.createRun({ documentId, steps: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] });
  await repo.setStepChecked(run.id, run.steps[0].id, { checked: true });

  const runs = await repo.listRunsForDocument(documentId);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].stepCount, 3);
  assert.equal(runs[0].doneCount, 1);
  assert.equal(runs[0].steps, undefined); // list is lightweight (no step bodies)
});
