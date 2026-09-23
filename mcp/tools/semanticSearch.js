import { z } from 'zod';
import { okResult, withErrorHandling } from '../toolResult.js';
import { pageEnvelope, paginateResults, paginationInput } from '../pagination.js';
import { hiddenHarvestedNote } from '../../server/harvestedCandidates.js';

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
        includeHarvested: z.boolean().optional().describe('Include unreviewed harvested candidates (unverified Inbox proposals tagged harvested), which are left out by default.'),
        ...paginationInput(),
      },
      handler: withErrorHandling(async ({
        query, project, includeHarvested, limit, offset,
      }) => {
        try {
          const result = await client.searchDocumentsSemantic(query, project, {
            limit, offset, ...(includeHarvested ? { includeHarvested } : {}),
          });
          // A bare-array response means the server ignored the pagination
          // params (pre-envelope server) and returned EVERYTHING — slice it
          // here, or the "paginated" envelope carries an unbounded item list.
          if (Array.isArray(result)) {
            return okResult(paginateResults(result, { limit, offset }));
          }
          const refs = result?.items ?? [];
          const total = Number.isInteger(result?.page?.total) ? result.page.total : refs.length;
          const envelope = pageEnvelope(refs, total, { limit, offset });
          // Documents whose vector is stale or from another model are never
          // ranked; the server says how many. Pass that through verbatim so a
          // page that omits them is not mistaken for complete coverage.
          const index = result?.index && typeof result.index === 'object' ? result.index : null;
          if (index) {
            envelope.index = {
              total: Number(index.total) || 0,
              embedded: Number(index.embedded) || 0,
              pending: Number(index.pending) || 0,
            };
            envelope.degraded = Boolean(result.degraded);
            if (result.reason) envelope.reason = String(result.reason);
          }
          // Unreviewed harvested candidates the server left out, said rather
          // than silently missing (QINV-08).
          const hidden = Number(result?.hiddenHarvested) || 0;
          if (hidden > 0) {
            envelope.hiddenHarvested = hidden;
            envelope.note = `${hiddenHarvestedNote(hidden, { hint: 'includeHarvested: true' })}.`;
          }
          return okResult(envelope);
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
