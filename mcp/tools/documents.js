import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { toDocumentRef, capResults } from '../shape.js';

const DOCUMENT_TYPE = z.enum(['runbook', 'note']);

export function createDocumentTools(client) {
  return [
    {
      name: 'search_documents',
      title: 'Search documents',
      description:
        'Full-text search the Moomora library. Returns lightweight references (id, title, type, projectId, tags, snippet) without bodies. Call get_document to read a full document.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe('Search text matched against title, body, and tags. Omit to browse by project/tags alone.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit to search all.'),
        documentType: DOCUMENT_TYPE.optional().describe('Limit to runbooks or notes.'),
        tags: z.array(z.string()).optional().describe('Require all of these tags.'),
      },
      handler: withErrorHandling(async ({ query, project, documentType, tags }) => {
        const docs = await client.listDocuments({ q: query, project, documentType });
        let refs = (Array.isArray(docs) ? docs : []).map(toDocumentRef);
        if (Array.isArray(tags) && tags.length > 0) {
          refs = refs.filter((ref) => tags.every((tag) => ref.tags.includes(tag)));
        }
        // Cap AFTER tag filtering so the cap bounds what reaches the model, not the pre-filter set.
        return okResult(capResults(refs));
      }),
    },
    {
      name: 'get_document',
      title: 'Get document',
      description: 'Fetch a full library document (including its Markdown body) by id.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string().describe('Document UUID.'),
      },
      handler: withErrorHandling(async ({ id }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        const doc = await client.getDocument(id);
        if (!doc) return errorResult(`No document with id ${id} (it may be archived or deleted).`);
        return okResult(doc);
      }),
    },
    {
      name: 'create_document',
      title: 'Create document',
      description: 'Create a new library runbook or note.',
      inputSchema: {
        title: z.string().min(1).describe('Document title.'),
        body: z.string().describe('Markdown body.'),
        documentType: DOCUMENT_TYPE,
        project: z.string().describe('Project slug or id.'),
        tags: z.array(z.string()).optional(),
      },
      handler: withErrorHandling(async (args) => {
        const doc = await client.createDocument(args);
        return okResult(doc);
      }),
    },
    {
      name: 'update_document',
      title: 'Update document',
      description: 'Update one or more fields of an existing library document.',
      inputSchema: {
        id: z.string().describe('Document UUID.'),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        documentType: DOCUMENT_TYPE.optional(),
        project: z.string().optional().describe('Project slug or id.'),
        tags: z.array(z.string()).optional(),
      },
      handler: withErrorHandling(async ({ id, ...patch }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        if (Object.keys(patch).length === 0) {
          return errorResult('Provide at least one field to update.');
        }
        const doc = await client.updateDocument(id, patch);
        if (!doc) return errorResult(`No document with id ${id}.`);
        return okResult(doc);
      }),
    },
  ];
}
