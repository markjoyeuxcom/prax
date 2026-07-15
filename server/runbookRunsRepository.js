import { toIso } from './columnTypes.js';

// Timestamp expression matching the migrations' defaults (UTC, ms precision).
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function normalizeRunRow(row) {
  return {
    id: row.id,
    documentId: row.document_id ?? null,
    documentTitle: row.document_title ?? '',
    projectId: row.project_id ?? null,
    title: row.title ?? '',
    status: row.status,
    startedBy: row.started_by ?? 'user',
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at) ?? null,
    finishedBy: row.finished_by ?? null,
  };
}

export function normalizeStepRow(row) {
  return {
    id: row.id,
    runId: row.run_id,
    position: row.position,
    text: row.text,
    checkedAt: toIso(row.checked_at) ?? null,
    checkedBy: row.checked_by ?? null,
  };
}

export function normalizeRunEventRow(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    type: row.event_type,
    stepId: row.step_id ?? null,
    stepText: row.step_text ?? null,
    actor: row.actor,
    createdAt: toIso(row.created_at),
  };
}

export class RunbookRunConflictError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'RunbookRunConflictError';
    this.code = 'RUNBOOK_RUN_CONFLICT';
    this.reason = reason;
  }
}

async function loadRun(queryable, runId) {
  const runRes = await queryable.query('select * from runbook_runs where id = $1 limit 1', [runId]);
  if (!runRes.rows[0]) return null;
  const stepsRes = await queryable.query(
    'select * from runbook_run_steps where run_id = $1 order by position, id',
    [runId],
  );
  const eventsRes = await queryable.query(
    'select * from runbook_run_events where run_id = $1 order by sequence',
    [runId],
  );
  return {
    ...normalizeRunRow(runRes.rows[0]),
    steps: stepsRes.rows.map(normalizeStepRow),
    events: eventsRes.rows.map(normalizeRunEventRow),
  };
}

async function appendRunEvent(client, {
  runId, type, actor, createdAt, stepId = null, stepText = null,
}) {
  const result = await client.query(
    `insert into runbook_run_events (
       run_id, sequence, event_type, step_id, step_text, actor, created_at
     ) values (
       $1,
       (select coalesce(max(sequence), -1) + 1 from runbook_run_events where run_id = $1),
       $2, $3, $4, $5, $6
     ) returning *`,
    [runId, type, stepId, stepText, actor || 'user', createdAt],
  );
  return normalizeRunEventRow(result.rows[0]);
}

async function currentTimestamp(client) {
  const result = await client.query(`select ${NOW} as value`);
  return result.rows[0].value;
}

export function createRunbookRunsRepository(db) {
  return {
    // Snapshot the steps into a new run atomically (a session transaction), so a
    // run always has a consistent set of steps even if the doc is edited later.
    async createRun({
      id = null,
      documentId,
      documentTitle = '',
      projectId = null,
      title = '',
      startedBy = 'user',
      steps = [],
    }) {
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const cleanTitle = String(title || '');
          if (id) {
            const existing = await loadRun(client, id);
            if (existing) {
              if (existing.documentId !== documentId || existing.title !== cleanTitle) {
                throw new RunbookRunConflictError(
                  'run id is already used for a different start intent',
                  'run-id-reused',
                );
              }
              await client.query('commit');
              return { ...existing, alreadyStarted: true };
            }
          }

          const runRes = id
            ? await client.query(
              `insert into runbook_runs (
                 id, document_id, document_title, project_id, title, started_by
               ) values ($1, $2, $3, $4, $5, $6) returning *`,
              [id, documentId, String(documentTitle || ''), projectId, cleanTitle, startedBy || 'user'],
            )
            : await client.query(
              `insert into runbook_runs (
                 document_id, document_title, project_id, title, started_by
               ) values ($1, $2, $3, $4, $5) returning *`,
              [documentId, String(documentTitle || ''), projectId, cleanTitle, startedBy || 'user'],
            );
          const run = normalizeRunRow(runRes.rows[0]);
          const stepRows = [];
          for (let i = 0; i < steps.length; i += 1) {
            const text = String(steps[i]?.text ?? steps[i] ?? '').trim();
            const res = await client.query(
              'insert into runbook_run_steps (run_id, position, text) values ($1, $2, $3) returning *',
              [run.id, i, text],
            );
            stepRows.push(normalizeStepRow(res.rows[0]));
          }
          const startedEvent = await appendRunEvent(client, {
            runId: run.id,
            type: 'started',
            actor: run.startedBy,
            createdAt: run.startedAt,
          });
          await client.query('commit');
          return { ...run, steps: stepRows, events: [startedEvent], alreadyStarted: false };
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },

    async listRunsForDocument(documentId) {
      const res = await db.query(
        `select r.*,
           (select count(*) from runbook_run_steps s where s.run_id = r.id) as step_count,
           (select count(*) from runbook_run_steps s where s.run_id = r.id and s.checked_at is not null) as done_count
         from runbook_runs r
         where r.document_id = $1
         order by r.started_at desc`,
        [documentId],
      );
      return res.rows.map((row) => ({
        ...normalizeRunRow(row),
        stepCount: Number(row.step_count) || 0,
        doneCount: Number(row.done_count) || 0,
      }));
    },

    async getRun(runId) {
      return loadRun(db, runId);
    },

    // Current checkbox state is materialized for fast rendering; every actual
    // change appends an event in the same transaction. Same-state replay is a
    // side-effect-free success.
    async setStepChecked(runId, stepId, { checked, checkedBy = 'user' } = {}) {
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const runRes = await client.query('select * from runbook_runs where id = $1 limit 1', [runId]);
          if (!runRes.rows[0]) {
            await client.query('commit');
            return null;
          }
          const stepRes = await client.query(
            'select * from runbook_run_steps where id = $1 and run_id = $2 limit 1',
            [stepId, runId],
          );
          if (!stepRes.rows[0]) {
            await client.query('commit');
            return null;
          }
          const run = normalizeRunRow(runRes.rows[0]);
          if (run.status !== 'running') {
            throw new RunbookRunConflictError(
              `steps cannot change while a run is ${run.status}`,
              'run-not-running',
            );
          }
          const existing = normalizeStepRow(stepRes.rows[0]);
          if (Boolean(existing.checkedAt) === Boolean(checked)) {
            await client.query('commit');
            return existing;
          }

          const changedAt = await currentTimestamp(client);
          const actor = checkedBy || 'user';
          const updateRes = await client.query(
            `update runbook_run_steps
               set checked_at = $3, checked_by = $4
             where id = $1 and run_id = $2
             returning *`,
            [stepId, runId, checked ? changedAt : null, checked ? actor : null],
          );
          await appendRunEvent(client, {
            runId,
            type: checked ? 'step-checked' : 'step-unchecked',
            actor,
            createdAt: changedAt,
            stepId,
            stepText: existing.text,
          });
          await client.query('commit');
          return normalizeStepRow(updateRes.rows[0]);
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },

    async setRunStatus(runId, status, { changedBy = 'user' } = {}) {
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const runRes = await client.query('select * from runbook_runs where id = $1 limit 1', [runId]);
          if (!runRes.rows[0]) {
            await client.query('commit');
            return null;
          }
          const run = normalizeRunRow(runRes.rows[0]);
          if (run.status === status) {
            await client.query('commit');
            return run;
          }

          const allowed = (run.status === 'running' && ['completed', 'aborted'].includes(status))
            || (run.status === 'aborted' && status === 'running');
          if (!allowed) {
            throw new RunbookRunConflictError(
              `run cannot change from ${run.status} to ${status}`,
              'invalid-transition',
            );
          }

          const changedAt = await currentTimestamp(client);
          const actor = changedBy || 'user';
          const resumed = status === 'running';
          const updateRes = await client.query(
            `update runbook_runs
               set status = $2,
                   finished_at = $3,
                   finished_by = $4
             where id = $1
             returning *`,
            [runId, status, resumed ? null : changedAt, resumed ? null : actor],
          );
          await appendRunEvent(client, {
            runId,
            type: resumed ? 'resumed' : status,
            actor,
            createdAt: changedAt,
          });
          await client.query('commit');
          return normalizeRunRow(updateRes.rows[0]);
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      } finally {
        client.release();
      }
    },
  };
}
