import { z } from 'zod';
import { okResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

export function createSemanticSearchTools(client) {
  return [
    {
      name: 'search_documents_semantic',
      title: 'Semantic document search',
      description:
        'Search the library by meaning (embedding similarity), not keywords — finds topically-relevant docs even when they share no words with the query. Falls back with a clear message if semantic search is not enabled on the server (use search_documents instead).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().min(1).describe('Natural-language query matched by meaning.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
      },
      handler: withErrorHandling(async ({ query, project }) => {
        try {
          const refs = await client.searchDocumentsSemantic(query, project);
          return okResult(capResults(refs ?? []));
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
