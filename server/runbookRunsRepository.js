import { toIso } from './columnTypes.js';

// Timestamp expression matching the migrations' defaults (UTC, ms precision).
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function normalizeRunRow(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title ?? '',
    status: row.status,
    startedBy: row.started_by ?? 'user',
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at) ?? null,
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

export function createRunbookRunsRepository(db) {
  return {
    // Snapshot the steps into a new run atomically (a session transaction), so a
    // run always has a consistent set of steps even if the doc is edited later.
    async createRun({ documentId, title = '', startedBy = 'user', steps = [] }) {
      const client = await db.connect();
      try {
        await client.query('begin immediate');
        try {
          const runRes = await client.query(
            'insert into runbook_runs (document_id, title, started_by) values ($1, $2, $3) returning *',
            [documentId, String(title || ''), startedBy || 'user'],
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
          await client.query('commit');
          return { ...run, steps: stepRows };
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
      const runRes = await db.query('select * from runbook_runs where id = $1 limit 1', [runId]);
      if (!runRes.rows[0]) return null;
      const stepsRes = await db.query('select * from runbook_run_steps where run_id = $1 order by position', [runId]);
      return { ...normalizeRunRow(runRes.rows[0]), steps: stepsRes.rows.map(normalizeStepRow) };
    },

    // Check/uncheck one step; checking stamps checked_at + checked_by, unchecking
    // clears both. Scoped by run_id so a stray step id can't be flipped.
    async setStepChecked(runId, stepId, { checked, checkedBy = 'user' } = {}) {
      const res = await db.query(
        `update runbook_run_steps
           set checked_at = ${checked ? NOW : 'null'}, checked_by = $3
         where id = $1 and run_id = $2
         returning *`,
        [stepId, runId, checked ? (checkedBy || 'user') : null],
      );
      return res.rows[0] ? normalizeStepRow(res.rows[0]) : null;
    },

    // Complete/abort stamps finished_at; reopening ('running') clears it.
    async setRunStatus(runId, status) {
      const finished = status === 'completed' || status === 'aborted';
      const res = await db.query(
        `update runbook_runs
           set status = $2, finished_at = ${finished ? NOW : 'null'}
         where id = $1
         returning *`,
        [runId, status],
      );
      return res.rows[0] ? normalizeRunRow(res.rows[0]) : null;
    },
  };
}
