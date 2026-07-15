import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { paginateResults, paginationInput } from '../pagination.js';

const RELATION = z.enum(['derived-from', 'supersedes']);
const DIRECTION = z.enum(['outbound', 'inbound', 'both']);

export function createDocumentLinkTools(client) {
  return [
    {
      name: 'list_document_links',
      title: 'List document links',
      description:
        'List documents linked to a document. direction: outbound (this derives-from/supersedes those), inbound (those derive-from/supersede this), or both (default). Returns a paginated collection envelope.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        documentId: z.string().describe('Document UUID.'),
        direction: DIRECTION.optional().describe('outbound | inbound | both (default both).'),
        ...paginationInput(),
      },
      handler: withErrorHandling(async ({ documentId, direction, limit, offset }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        const links = await client.listDocumentLinks(documentId, direction);
        return okResult(paginateResults(links, { limit, offset }));
      }),
    },
    {
      name: 'link_documents',
      title: 'Link documents',
      description:
        'Create a typed, directional link from one document to another. relation: derived-from (source distilled from target) or supersedes (source replaces target and atomically retires it from default retrieval).',
      annotations: { idempotentHint: true, destructiveHint: true },
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
      description: 'Remove a typed link between two documents. Removing the last live supersedes edge atomically reactivates its target.',
      annotations: { idempotentHint: true, destructiveHint: true },
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
    {
      name: 'supersede_document',
      title: 'Supersede a document',
      description:
        'Retire a document in favour of a replacement: creates a supersedes link (new → old) AND ' +
        'sets the old document\'s status to "superseded" so it drops out of default retrieval. Use ' +
        'this intent-specific action when replacing a doc; generic link_documents enforces the same ' +
        'atomic lifecycle invariant. Note: verifying a document is a human ' +
        'action and is intentionally not available via MCP.',
      annotations: { idempotentHint: true, destructiveHint: true },
      inputSchema: {
        documentId: z.string().describe('UUID of the document being retired (superseded).'),
        supersededBy: z.string().describe('UUID of the newer document that replaces it.'),
      },
      handler: withErrorHandling(async ({ documentId, supersededBy }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        if (!isValidUuid(supersededBy)) return errorResult('supersededBy must be a valid UUID.');
        if (documentId === supersededBy) return errorResult('a document cannot supersede itself.');
        return okResult(await client.supersedeDocument(documentId, supersededBy));
      }),
    },
  ];
}
