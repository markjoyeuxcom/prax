import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { capResults } from '../shape.js';

export function createChecklistTools(client) {
  return [
    {
      name: 'list_task_checklist',
      title: 'List task checklist',
      description: 'List the checklist items on a task.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
      },
      handler: withErrorHandling(async ({ taskId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        const items = await client.listChecklist(taskId);
        return okResult(capResults(items ?? []));
      }),
    },
    {
      name: 'add_checklist_item',
      title: 'Add checklist item',
      description: 'Add a checklist item to a task.',
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        label: z.string().min(1).describe('Checklist item label.'),
      },
      handler: withErrorHandling(async ({ taskId, label }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        const item = await client.addChecklistItem(taskId, label);
        return okResult(item);
      }),
    },
    {
      name: 'set_checklist_item',
      title: 'Set checklist item completion',
      description: 'Mark a checklist item complete or incomplete.',
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        itemId: z.string().describe('Checklist item UUID.'),
        completed: z.boolean().describe('Whether the item is complete.'),
      },
      handler: withErrorHandling(async ({ taskId, itemId, completed }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        if (!isValidUuid(itemId)) return errorResult('itemId must be a valid UUID.');
        const item = await client.setChecklistItem(taskId, itemId, completed);
        if (!item) return errorResult(`No checklist item with id ${itemId} on task ${taskId}.`);
        return okResult(item);
      }),
    },
    {
      name: 'delete_checklist_item',
      title: 'Delete checklist item',
      description: 'Remove a checklist item from a task.',
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        itemId: z.string().describe('Checklist item UUID.'),
      },
      handler: withErrorHandling(async ({ taskId, itemId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        if (!isValidUuid(itemId)) return errorResult('itemId must be a valid UUID.');
        await client.deleteChecklistItem(taskId, itemId);
        return okResult({ deleted: true, taskId, itemId });
      }),
    },
  ];
}
