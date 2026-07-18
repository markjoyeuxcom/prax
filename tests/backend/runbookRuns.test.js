import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { parseRunbookSteps } from '../../server/runbookSteps.js';
import {
  createRunbookRunsRepository,
  RunbookRunConflictError,
} from '../../server/runbookRunsRepository.js';

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
  return { db, repo: createRunbookRunsRepository(db), documentId: doc.rows[0].id, projectId };
}

test('createRun snapshots source context and steps, then appends an attributed start event', async () => {
  const { repo, documentId, projectId } = await freshRepo();
  const run = await repo.createRun({
    documentId,
    documentTitle: 'Restore',
    projectId,
    title: 'Prod incident',
    startedBy: 'ada',
    steps: [{ text: 'Stop writes' }, { text: 'Promote replica' }],
  });
  assert.equal(run.documentId, documentId);
  assert.equal(run.documentTitle, 'Restore');
  assert.equal(run.projectId, projectId);
  assert.equal(run.status, 'running');
  assert.equal(run.finishedAt, null);
  assert.equal(run.finishedBy, null);
  assert.match(run.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(run.steps.length, 2);
  assert.deepEqual(run.steps.map((s) => [s.position, s.text, s.checkedAt]), [
    [0, 'Stop writes', null],
    [1, 'Promote replica', null],
  ]);
  assert.deepEqual(run.events.map((event) => [event.sequence, event.type, event.actor]), [
    [0, 'started', 'ada'],
  ]);
  assert.equal(run.alreadyStarted, false);
});

test('createRun replays one caller-stable start id and rejects conflicting reuse', async () => {
  const { repo, documentId, projectId } = await freshRepo();
  const id = '10000000-0000-4000-8000-000000000001';
  const input = {
    id,
    documentId,
    documentTitle: 'Restore',
    projectId,
    title: 'Incident 42',
    steps: [{ text: 'A' }],
  };
  const first = await repo.createRun(input);
  const replay = await repo.createRun({ ...input, steps: [{ text: 'changed after start' }] });
  assert.equal(first.id, id);
  assert.equal(replay.id, id);
  assert.equal(replay.alreadyStarted, true);
  assert.deepEqual(replay.steps.map((step) => step.text), ['A']);
  assert.deepEqual(replay.events.map((event) => event.type), ['started']);

  await assert.rejects(
    repo.createRun({ ...input, title: 'A different intent' }),
    (error) => error instanceof RunbookRunConflictError && error.reason === 'run-id-reused',
  );
});

test('setStepChecked appends check/uncheck history and same-state replay is side-effect free', async () => {
  const { repo, documentId } = await freshRepo();
  const run = await repo.createRun({ documentId, steps: [{ text: 'A' }, { text: 'B' }] });
  const stepA = run.steps[0];

  const checked = await repo.setStepChecked(run.id, stepA.id, { checked: true, checkedBy: 'ada' });
  assert.match(checked.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(checked.checkedBy, 'ada');
  const replay = await repo.setStepChecked(run.id, stepA.id, { checked: true, checkedBy: 'other' });
  assert.equal(replay.checkedAt, checked.checkedAt);
  assert.equal(replay.checkedBy, 'ada');

  const unchecked = await repo.setStepChecked(run.id, stepA.id, { checked: false, checkedBy: 'grace' });
  assert.equal(unchecked.checkedAt, null);
  assert.equal(unchecked.checkedBy, null);

  const fetched = await repo.getRun(run.id);
  assert.deepEqual(fetched.events.map((event) => [event.type, event.actor, event.stepText]), [
    ['started', 'user', null],
    ['step-checked', 'ada', 'A'],
    ['step-unchecked', 'grace', 'A'],
  ]);

  // A step id from a different run must not be flippable via this run.
  assert.equal(await repo.setStepChecked('no-such-run', stepA.id, { checked: true }), null);
});

test('status transitions preserve interruption history, completion is terminal, and replays are idempotent', async () => {
  const { repo, documentId } = await freshRepo();
  const run = await repo.createRun({ documentId, steps: [{ text: 'One' }, { text: 'Two' }] });

  const aborted = await repo.setRunStatus(run.id, 'aborted', { changedBy: 'ada' });
  assert.equal(aborted.status, 'aborted');
  assert.equal(aborted.finishedBy, 'ada');
  assert.match(aborted.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  const abortReplay = await repo.setRunStatus(run.id, 'aborted', { changedBy: 'other' });
  assert.equal(abortReplay.finishedAt, aborted.finishedAt);
  assert.equal(abortReplay.finishedBy, 'ada');

  await assert.rejects(
    repo.setStepChecked(run.id, run.steps[0].id, { checked: true }),
    (error) => error instanceof RunbookRunConflictError && error.reason === 'run-not-running',
  );
  await assert.rejects(
    repo.setRunStatus(run.id, 'completed'),
    (error) => error instanceof RunbookRunConflictError && error.reason === 'invalid-transition',
  );

  const resumed = await repo.setRunStatus(run.id, 'running', { changedBy: 'grace' });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.finishedAt, null);
  assert.equal(resumed.finishedBy, null);
  await repo.setStepChecked(run.id, run.steps[0].id, { checked: true, checkedBy: 'grace' });

  const done = await repo.setRunStatus(run.id, 'completed', { changedBy: 'grace' });
  assert.equal(done.status, 'completed');
  assert.match(done.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(done.finishedBy, 'grace');
  const doneReplay = await repo.setRunStatus(run.id, 'completed', { changedBy: 'other' });
  assert.equal(doneReplay.finishedAt, done.finishedAt);
  assert.equal(doneReplay.finishedBy, 'grace');
  await assert.rejects(
    repo.setRunStatus(run.id, 'running'),
    (error) => error instanceof RunbookRunConflictError && error.reason === 'invalid-transition',
  );

  const fetched = await repo.getRun(run.id);
  assert.equal(fetched.status, 'completed');
  assert.deepEqual(fetched.steps.map((s) => s.position), [0, 1]);
  assert.deepEqual(fetched.events.map((event) => event.type), [
    'started', 'aborted', 'resumed', 'step-checked', 'completed',
  ]);
  assert.equal(await repo.getRun('missing'), null);
});

test('source deletion preserves the independent run snapshot, steps, and chronicle', async () => {
  const { db, repo, documentId, projectId } = await freshRepo();
  const run = await repo.createRun({
    documentId,
    documentTitle: 'Restore',
    projectId,
    title: 'Deletion drill',
    steps: [{ text: 'Preserve me' }],
  });
  await repo.setStepChecked(run.id, run.steps[0].id, { checked: true, checkedBy: 'ada' });
  await repo.setRunStatus(run.id, 'completed', { changedBy: 'ada' });

  await db.query('delete from markdown_documents where id = $1', [documentId]);
  const preserved = await repo.getRun(run.id);
  assert.equal(preserved.documentId, null);
  assert.equal(preserved.documentTitle, 'Restore');
  assert.equal(preserved.projectId, projectId);
  assert.deepEqual(preserved.steps.map((step) => step.text), ['Preserve me']);
  assert.deepEqual(preserved.events.map((event) => event.type), ['started', 'step-checked', 'completed']);
});

test('getRun reads run, steps, and events as one snapshot despite a concurrent write', async () => {
  const { db, repo, documentId } = await freshRepo();
  const run = await repo.createRun({ documentId, steps: [{ text: 'A' }, { text: 'B' }] });

  // Queue a destructive write immediately behind the read. Without a
  // transaction the delete lands between the run-row read and the steps read
  // (each top-level query re-acquires the db gate), yielding a "running run
  // with zero steps" — a state that never existed. The transaction holds the
  // session gate across all three reads, so the write waits for the snapshot.
  const snapshotPromise = repo.getRun(run.id);
  const deletePromise = db.query('delete from runbook_run_steps where run_id = $1', [run.id]);
  const snapshot = await snapshotPromise;
  await deletePromise;
  assert.deepEqual(snapshot.steps.map((step) => step.text), ['A', 'B']);
  assert.deepEqual(snapshot.events.map((event) => event.type), ['started']);

  // The guard orders the write after the snapshot — it does not lose it.
  const after = await repo.getRun(run.id);
  assert.deepEqual(after.steps, []);
});

test('listDetachedRuns lists only runs whose source document was deleted, with snapshot context', async () => {
  const { db, repo, documentId, projectId } = await freshRepo();
  await repo.createRun({ documentId, documentTitle: 'Restore', projectId, title: 'Still attached', steps: [{ text: 'A' }] });
  const doomedDoc = await db.query(
    "insert into markdown_documents (title, document_type, project_id, body) values ('Doomed', 'runbook', $1, '# Doomed') returning id",
    [projectId],
  );
  const doomed = await repo.createRun({
    documentId: doomedDoc.rows[0].id,
    documentTitle: 'Doomed',
    projectId,
    title: 'Deletion drill',
    steps: [{ text: 'B' }, { text: 'C' }],
  });
  await repo.setStepChecked(doomed.id, doomed.steps[0].id, { checked: true, checkedBy: 'ada' });

  assert.deepEqual(await repo.listDetachedRuns(), []);
  await db.query('delete from markdown_documents where id = $1', [doomedDoc.rows[0].id]);
  const detached = await repo.listDetachedRuns();
  assert.deepEqual(detached.map((run) => run.id), [doomed.id]);
  assert.equal(detached[0].documentId, null);
  assert.equal(detached[0].documentTitle, 'Doomed');
  assert.equal(detached[0].title, 'Deletion drill');
  assert.equal(detached[0].stepCount, 2);
  assert.equal(detached[0].doneCount, 1);
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
