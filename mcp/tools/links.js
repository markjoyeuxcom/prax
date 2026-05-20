import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

export function createLinkTools(client) {
  return [
    {
      name: 'list_task_documents',
      title: 'List linked documents',
      description: 'List the library documents linked to a task.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
      },
      handler: withErrorHandling(async ({ taskId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        const docs = await client.listTaskDocuments(taskId);
        return okResult(capResults(docs ?? []));
      }),
    },
    {
      name: 'link_task_document',
      title: 'Link document to task',
      description: 'Link a library document to a task. Idempotent — re-linking is a no-op.',
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        documentId: z.string().describe('Document UUID.'),
      },
      handler: withErrorHandling(async ({ taskId, documentId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        // The API returns the updated linked-document list on success. Always
        // return a stable confirmation shape, with that list under `documents`.
        const result = await client.linkTaskDocument(taskId, documentId);
        return okResult({
          linked: true,
          taskId,
          documentId,
          documents: Array.isArray(result) ? result : [],
        });
      }),
    },
    {
      name: 'unlink_task_document',
      title: 'Unlink document from task',
      description: 'Remove the link between a task and a document.',
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        documentId: z.string().describe('Document UUID.'),
      },
      handler: withErrorHandling(async ({ taskId, documentId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        await client.unlinkTaskDocument(taskId, documentId);
        return okResult({ unlinked: true, taskId, documentId });
      }),
    },
  ];
}
