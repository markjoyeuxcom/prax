import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

// External references: a document points at outside material (a PR, a dashboard,
// an upstream bug) without copying it. Distinct from document links, whose
// targets are other Prax documents.
export function createExternalRefTools(client) {
  return [
    {
      name: 'list_external_refs',
      title: 'List external references',
      description: 'List the external URLs a document points at — [{ id, url, label }].',
      annotations: { readOnlyHint: true },
      inputSchema: {
        documentId: z.string().describe('Document UUID.'),
      },
      handler: withErrorHandling(async ({ documentId }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        return okResult(capResults(await client.listExternalRefs(documentId) ?? []));
      }),
    },
    {
      name: 'add_external_ref',
      title: 'Add an external reference',
      description:
        'Attach an external URL to a document (e.g. the PR that implemented a decision, the '
        + 'dashboard a runbook watches, the upstream bug a known-issue tracks). Idempotent per '
        + 'URL — re-adding updates the label. Does NOT copy the linked content.',
      inputSchema: {
        documentId: z.string().describe('Document UUID.'),
        url: z.string().describe('The external URL.'),
        label: z.string().optional().describe('Optional human label (e.g. "PR #42").'),
      },
      handler: withErrorHandling(async ({ documentId, url, label }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        if (typeof url !== 'string' || !url.trim()) return errorResult('url is required.');
        const refs = await client.addExternalRef(documentId, url.trim(), label);
        return okResult({ added: true, documentId, refs: Array.isArray(refs) ? refs : [] });
      }),
    },
    {
      name: 'remove_external_ref',
      title: 'Remove an external reference',
      description: 'Detach an external reference from a document by its ref id.',
      inputSchema: {
        documentId: z.string().describe('Document UUID.'),
        refId: z.string().describe('The external-reference id (from list_external_refs).'),
      },
      handler: withErrorHandling(async ({ documentId, refId }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        if (!isValidUuid(refId)) return errorResult('refId must be a valid UUID.');
        await client.removeExternalRef(documentId, refId);
        return okResult({ removed: true, documentId, refId });
      }),
    },
  ];
}
