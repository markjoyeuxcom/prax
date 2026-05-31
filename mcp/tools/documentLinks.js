import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

const RELATION = z.enum(['derived-from', 'supersedes']);
const DIRECTION = z.enum(['outbound', 'inbound', 'both']);

export function createDocumentLinkTools(client) {
  return [
    {
      name: 'list_document_links',
      title: 'List document links',
      description:
        'List documents linked to a document. direction: outbound (this derives-from/supersedes those), inbound (those derive-from/supersede this), or both (default).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        documentId: z.string().describe('Document UUID.'),
        direction: DIRECTION.optional().describe('outbound | inbound | both (default both).'),
      },
      handler: withErrorHandling(async ({ documentId, direction }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        const links = await client.listDocumentLinks(documentId, direction);
        return okResult(capResults(links ?? []));
      }),
    },
    {
      name: 'link_documents',
      title: 'Link documents',
      description:
        'Create a typed, directional link from one document to another. relation: derived-from (source distilled from target) or supersedes (source replaces target).',
      inputSchema: {
        sourceId: z.string().describe('Source document UUID.'),
        targetId: z.string().describe('Target document UUID.'),
        relation: RELATION,
      },
      handler: withErrorHandling(async ({ sourceId, targetId, relation }) => {
        if (!isValidUuid(sourceId)) return errorResult('sourceId must be a valid UUID.');
        if (!isValidUuid(targetId)) return errorResult('targetId must be a valid UUID.');
        const result = await client.linkDocuments(sourceId, targetId, relation);
        return okResult({
          linked: true,
          sourceId,
          targetId,
          relation,
          links: Array.isArray(result) ? result : [],
        });
      }),
    },
    {
      name: 'unlink_documents',
      title: 'Unlink documents',
      description: 'Remove a typed link between two documents.',
      inputSchema: {
        sourceId: z.string().describe('Source document UUID.'),
        targetId: z.string().describe('Target document UUID.'),
        relation: RELATION,
      },
      handler: withErrorHandling(async ({ sourceId, targetId, relation }) => {
        if (!isValidUuid(sourceId)) return errorResult('sourceId must be a valid UUID.');
        if (!isValidUuid(targetId)) return errorResult('targetId must be a valid UUID.');
        await client.unlinkDocuments(sourceId, targetId, relation);
        return okResult({ unlinked: true, sourceId, targetId, relation });
      }),
    },
  ];
}
