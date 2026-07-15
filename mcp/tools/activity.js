import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { paginateResults, paginationInput } from '../pagination.js';

export function createActivityTools(client) {
  return [
    {
      name: 'list_task_activity',
      title: 'List task activity',
      description: 'List the activity events on a task, newest first. Returns a paginated collection envelope.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        ...paginationInput(),
      },
      handler: withErrorHandling(async ({ taskId, limit, offset }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        const events = await client.listTaskActivity(taskId);
        return okResult(paginateResults(events, { limit, offset }));
      }),
    },
  ];
}
