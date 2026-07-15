import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { paginateResults, paginationInput } from '../pagination.js';
import { runStableMutation, stableMutationId } from '../stableMutation.js';

// Runbook execution tools — the agent path to the run lifecycle that the desktop
// UI drives. A run snapshots a runbook's checkbox steps into an independent,
// timestamped chronicle: checking steps records who/when without ever editing
// the source document. Writes are stamped as the agent via the praxClient.
const RUN_STATUS = z.enum(['running', 'completed', 'aborted']);

export function createRunTools(client) {
  return [
    {
      name: 'start_runbook_run',
      title: 'Start a runbook run',
      description:
        'Begin executing a runbook: snapshot its source context and checkbox lines into an independent timestamped run. Supply runId when retrying so the same intent returns the original run instead of creating a duplicate. Returns steps: [] when the runbook has no checkbox lines.',
      annotations: { idempotentHint: true, destructiveHint: false },
      inputSchema: {
        documentId: z.string().describe('UUID of the runbook document to run.'),
        title: z.string().optional().describe('Optional label for this run (e.g. an incident id); defaults to the document title in exports.'),
        runId: z.string().optional().describe('Optional caller-stable UUID. Reuse it when retrying the same start intent.'),
      },
      handler: withErrorHandling(async ({ documentId, title, runId }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        if (runId !== undefined && !isValidUuid(runId)) return errorResult('runId must be a valid UUID when provided.');
        const id = stableMutationId(runId);
        const run = await runStableMutation({ label: 'Run start', id, inputName: 'runId' }, () =>
          client.startRunbookRun(documentId, title || '', id));
        return okResult(run);
      }),
    },
    {
      name: 'list_runbook_runs',
      title: 'List runbook runs',
      description:
        'List the runs of a runbook, newest first — each with its status, start/finish times, and step/done counts (no step bodies). Returns a paginated collection envelope. Use get_runbook_run for a run\'s full step chronicle.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        documentId: z.string().describe('UUID of the runbook document.'),
        ...paginationInput(),
      },
      handler: withErrorHandling(async ({ documentId, limit, offset }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        const runs = await client.listRunbookRuns(documentId);
        return okResult(paginateResults(runs, { limit, offset }));
      }),
    },
    {
      name: 'get_runbook_run',
      title: 'Get a runbook run',
      description:
        'Fetch an independent run snapshot with ordered steps and append-only events for start, step changes, abort, resume, and completion, including actors and timestamps.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        runId: z.string().describe('UUID of the run.'),
      },
      handler: withErrorHandling(async ({ runId }) => {
        if (!isValidUuid(runId)) return errorResult('runId must be a valid UUID.');
        const run = await client.getRunbookRun(runId);
        if (!run) return errorResult(`No run with id ${runId}.`);
        return okResult(run);
      }),
    },
    {
      name: 'set_run_step',
      title: 'Check or uncheck a run step',
      description:
        'Mark a running run\'s step done or not-done. Each actual change appends an agent-attributed event; replaying the current value is idempotent. Completed or aborted runs reject step changes.',
      annotations: { idempotentHint: true, destructiveHint: false },
      inputSchema: {
        runId: z.string().describe('UUID of the run.'),
        stepId: z.string().describe('UUID of a step within that run (from start_runbook_run or get_runbook_run).'),
        checked: z.boolean().describe('true to mark done (stamps a timestamp), false to clear it.'),
      },
      handler: withErrorHandling(async ({ runId, stepId, checked }) => {
        if (!isValidUuid(runId) || !isValidUuid(stepId)) return errorResult('runId and stepId must be valid UUIDs.');
        const step = await client.setRunStep(runId, stepId, checked);
        if (!step) return errorResult(`No step ${stepId} in run ${runId}.`);
        return okResult(step);
      }),
    },
    {
      name: 'set_run_status',
      title: 'Finish or abort a run',
      description:
        'Set a running run to "completed" or "aborted", or set an aborted run to "running" to resume it. Completed runs are terminal; same-status replay is idempotent and preserves the first finish stamp.',
      annotations: { idempotentHint: true, destructiveHint: true },
      inputSchema: {
        runId: z.string().describe('UUID of the run.'),
        status: RUN_STATUS.describe('running | completed | aborted.'),
      },
      handler: withErrorHandling(async ({ runId, status }) => {
        if (!isValidUuid(runId)) return errorResult('runId must be a valid UUID.');
        const run = await client.setRunStatus(runId, status);
        if (!run) return errorResult(`No run with id ${runId}.`);
        return okResult(run);
      }),
    },
  ];
}
