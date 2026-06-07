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
    {
      name: 'supersede_document',
      title: 'Supersede a document',
      description:
        'Retire a document in favour of a replacement: creates a supersedes link (new → old) AND ' +
        'sets the old document\'s status to "superseded" so it drops out of default retrieval. Use ' +
        'this instead of link_documents when replacing a doc. Note: verifying a document is a human ' +
        'action and is intentionally not available via MCP.',
      inputSchema: {
        documentId: z.string().describe('UUID of the document being retired (superseded).'),
        supersededBy: z.string().describe('UUID of the newer document that replaces it.'),
      },
      handler: withErrorHandling(async ({ documentId, supersededBy }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        if (!isValidUuid(supersededBy)) return errorResult('supersededBy must be a valid UUID.');
        if (documentId === supersededBy) return errorResult('a document cannot supersede itself.');
        const doc = await client.supersedeDocument(documentId, supersededBy);
        if (!doc) return errorResult('document not found.');
        return okResult(doc);
      }),
    },
  ];
}
