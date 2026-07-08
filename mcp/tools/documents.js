import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, textResult, withErrorHandling } from '../toolResult.js';
import { toDocumentRef, capResults } from '../shape.js';

const DOCUMENT_TYPE = z.enum(['runbook', 'note']);
const DOCUMENT_KIND = z.enum(['source', 'synthesized']);

export function createDocumentTools(client) {
  return [
    {
      name: 'search_documents',
      title: 'Search documents',
      description:
        'Full-text search the Prax library. Returns lightweight references (id, title, type, projectId, tags, snippet) without bodies. Active documents only by default — pass status to see superseded/deprecated memory. Call get_document to read a full document.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe('Search text matched against title, body, and tags. Omit to browse by project/tags alone.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit to search all.'),
        documentType: DOCUMENT_TYPE.optional().describe('Limit to runbooks or notes.'),
        tags: z.array(z.string()).optional().describe('Require all of these tags.'),
        kind: DOCUMENT_KIND.optional().describe('Limit to hand-authored sources or agent-synthesized derivations.'),
        status: z.enum(['active', 'superseded', 'deprecated', 'all']).optional()
          .describe("Trust-status filter. Defaults to 'active' (retrieval is active-only); pass 'all' to include superseded/deprecated memory, e.g. for curation."),
      },
      handler: withErrorHandling(async ({ query, project, documentType, tags, kind, status }) => {
        const effectiveStatus = status || 'active';
        const docs = await client.listDocuments({
          q: query,
          project,
          documentType,
          kind,
          ...(effectiveStatus === 'all' ? {} : { status: effectiveStatus }),
        });
        let refs = (Array.isArray(docs) ? docs : []).map(toDocumentRef);
        if (Array.isArray(tags) && tags.length > 0) {
          refs = refs.filter((ref) => tags.every((tag) => ref.tags.includes(tag)));
        }
        // Cap AFTER tag filtering so the cap bounds what reaches the model, not the pre-filter set.
        return okResult(capResults(refs));
      }),
    },
    {
      name: 'ask_library',
      title: 'Ask the library',
      description:
        'Gather a context pack for a question WITHOUT needing document ids: retrieves the most relevant library documents and returns their content as a bounded, trust-aware Markdown pack (semantic ranking when a provider is configured, keyword search otherwise). Use this to answer "what do we know about X?". Use search_documents for a bare id/title list, or get_document to read one full document.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().min(1).describe('The question or topic to gather context for.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit for the whole library.'),
        limit: z.number().int().positive().optional().describe('Max documents in the pack (default 12, capped at 50).'),
      },
      handler: withErrorHandling(async ({ query, project, limit }) => {
        const markdown = await client.contextPack({ q: query, project, limit });
        return textResult(markdown);
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
      description: 'Create a new library runbook or note. Pass kind: "synthesized" for agent-generated derivations.',
      inputSchema: {
        title: z.string().min(1).describe('Document title.'),
        body: z.string().describe('Markdown body.'),
        documentType: DOCUMENT_TYPE,
        project: z.string().describe('Project slug or id.'),
        tags: z.array(z.string()).optional(),
        kind: DOCUMENT_KIND.optional().describe('"source" (default) for hand-authored, "synthesized" for agent-generated.'),
      },
      handler: withErrorHandling(async (args) => {
        const doc = await client.createDocument(args);
        return okResult(doc);
      }),
    },
    {
      name: 'update_document',
      title: 'Update document',
      description: 'Update one or more fields of an existing library document. Set kind to promote/demote.',
      inputSchema: {
        id: z.string().describe('Document UUID.'),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        documentType: DOCUMENT_TYPE.optional(),
        project: z.string().optional().describe('Project slug or id.'),
        tags: z.array(z.string()).optional(),
        kind: DOCUMENT_KIND.optional().describe('Promote synthesized → source or vice versa.'),
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
