import { z } from 'zod';
import { okResult, withErrorHandling } from '../toolResult.js';
import { pageEnvelope, paginationInput } from '../pagination.js';

export function createSemanticSearchTools(client) {
  return [
    {
      name: 'search_documents_semantic',
      title: 'Semantic document search',
      description:
        'Search the library by meaning (embedding similarity), not keywords — finds topically-relevant docs even when they share no words with the query. Returns a paginated collection envelope. Falls back with a clear message if semantic search is not enabled on the server (use search_documents instead).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().min(1).describe('Natural-language query matched by meaning.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
        ...paginationInput(),
      },
      handler: withErrorHandling(async ({ query, project, limit, offset }) => {
        try {
          const result = await client.searchDocumentsSemantic(query, project, { limit, offset });
          const refs = Array.isArray(result) ? result : result?.items;
          const total = Number.isInteger(result?.page?.total) ? result.page.total : (refs?.length ?? 0);
          return okResult(pageEnvelope(refs, total, { limit, offset }));
        } catch (err) {
          if (err && err.status === 409) {
            return okResult({ message: 'Semantic search is not enabled on this server. Use search_documents (keyword) instead.' });
          }
          throw err;
        }
      }),
    },
  ];
}
