import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { toTaskRef, capResults } from '../shape.js';

const STATUS = z.enum(['high-priority', 'in-progress', 'planned', 'completed', 'notes']);
const PRIORITY = z.enum(['high', 'medium', 'low']);

export function createTaskTools(client) {
  return [
    {
      name: 'search_tasks',
      title: 'Search tasks',
      description:
        'Search active Moomora tasks. Returns summaries (id, title, status, priority, projectId, dueDate). Call get_task for the full record.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe('Text matched against task title.'),
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
        status: STATUS.optional().describe('Limit to one status.'),
      },
      handler: withErrorHandling(async ({ query, project, status }) => {
        const tasks = await client.listTasks({ q: query, project, status });
        const refs = (Array.isArray(tasks) ? tasks : []).map(toTaskRef);
        return okResult(capResults(refs));
      }),
    },
    {
      name: 'get_task',
      title: 'Get task',
      description: 'Fetch a full task record by id.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string().describe('Task UUID.'),
      },
      handler: withErrorHandling(async ({ id }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        const task = await client.getTask(id);
        if (!task) return errorResult(`No task with id ${id} (it may be archived or deleted).`);
        return okResult(task);
      }),
    },
    {
      name: 'create_task',
      title: 'Create task',
      description: 'Create a new task. priority defaults to medium and status to planned if omitted.',
      inputSchema: {
        title: z.string().min(1).describe('Task title.'),
        project: z.string().describe('Project slug or id.'),
        description: z.string().optional(),
        priority: PRIORITY.optional(),
        status: STATUS.optional(),
        dueDate: z.string().optional().describe('ISO date (YYYY-MM-DD) or empty.'),
      },
      handler: withErrorHandling(async (args) => {
        // The API requires priority and status on create; apply the documented
        // defaults here so callers can omit them (args override these).
        const task = await client.createTask({ priority: 'medium', status: 'planned', ...args });
        return okResult(task);
      }),
    },
    {
      name: 'update_task',
      title: 'Update task',
      description: 'Update one or more fields of an existing task.',
      inputSchema: {
        id: z.string().describe('Task UUID.'),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        notes: z.string().optional().describe('Free-form operational notes / handoff context for the task.'),
        priority: PRIORITY.optional(),
        status: STATUS.optional(),
        project: z.string().optional().describe('Project slug or id.'),
        dueDate: z.string().optional(),
      },
      handler: withErrorHandling(async ({ id, ...patch }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        if (Object.keys(patch).length === 0) {
          return errorResult('Provide at least one field to update.');
        }
        const task = await client.updateTask(id, patch);
        if (!task) return errorResult(`No task with id ${id}.`);
        return okResult(task);
      }),
    },
  ];
}
