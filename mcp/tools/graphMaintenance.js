import { z } from 'zod';
import { okResult, withErrorHandling } from '../toolResult.js';
import { paginateResults, paginationInput } from '../pagination.js';

export function createGraphMaintenanceTools(client) {
  return [
    {
      name: 'list_stale_documents',
      title: 'List stale documents',
      description:
        'List documents whose derived-from source has changed since the link was created. Each result includes kind (so agents can refresh stale synthesized docs aggressively and leave stale source docs for human review) and updatedBy. Returns a paginated collection envelope.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
        ...paginationInput(),
      },
      handler: withErrorHandling(async ({ project, limit, offset }) => {
        const docs = await client.listStaleDocuments(project);
        return okResult(paginateResults(docs, { limit, offset }));
      }),
    },
  ];
}
