import { z } from 'zod';
import { okResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

export function createGraphMaintenanceTools(client) {
  return [
    {
      name: 'list_stale_documents',
      title: 'List stale documents',
      description:
        'List documents whose derived-from source has changed since the link was created. Each result includes kind (so agents can refresh stale synthesized docs aggressively and leave stale source docs for human review) and updatedBy.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
      },
      handler: withErrorHandling(async ({ project }) => {
        const docs = await client.listStaleDocuments(project);
        return okResult(capResults(docs ?? []));
      }),
    },
    {
      name: 'list_orphan_documents',
      title: 'List orphan documents',
      description: 'List documents with no inbound or outbound links.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
      },
      handler: withErrorHandling(async ({ project }) => {
        const docs = await client.listOrphanDocuments(project);
        return okResult(capResults(docs ?? []));
      }),
    },
  ];
}
