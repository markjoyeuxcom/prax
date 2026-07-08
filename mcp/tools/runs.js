import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';

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
        'Begin executing a runbook: snapshot its checkbox lines into a new timestamped run and return the run with its steps. The run is an independent chronicle — checking steps never edits the source document, and later edits to the runbook do not change past runs. Returns steps: [] when the runbook has no "- [ ] " checkbox lines.',
      inputSchema: {
        documentId: z.string().describe('UUID of the runbook document to run.'),
        title: z.string().optional().describe('Optional label for this run (e.g. an incident id); defaults to the document title in exports.'),
      },
      handler: withErrorHandling(async ({ documentId, title }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        const run = await client.startRunbookRun(documentId, title || '');
        return okResult(run);
      }),
    },
    {
      name: 'list_runbook_runs',
      title: 'List runbook runs',
      description:
        'List the runs of a runbook, newest first — each with its status, start/finish times, and step/done counts (no step bodies). Use get_runbook_run for a run\'s full step chronicle.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        documentId: z.string().describe('UUID of the runbook document.'),
      },
      handler: withErrorHandling(async ({ documentId }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        const runs = await client.listRunbookRuns(documentId);
        return okResult(Array.isArray(runs) ? runs : []);
      }),
    },
    {
      name: 'get_runbook_run',
      title: 'Get a runbook run',
      description:
        'Fetch a run with its ordered steps and per-step timestamps — the timestamped chronicle of who did what and when, independent of the source document. Use this to write a post-incident summary.',
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
        'Mark a step of a run done or not-done. Checking stamps the step with the current time and the agent as the actor; unchecking clears both. Returns the updated step.',
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
        'Set a run\'s status: "completed" or "aborted" to finish it (stamping a finish time), or "running" to reopen. The step chronicle is preserved either way.',
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
