import { createChecklistRepository, MAX_CHECKLIST_ITEMS_PER_TASK } from './checklistRepository.js';
import { createTasksRepository } from './tasksRepository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export async function registerChecklistRoutes(app, options = {}) {
  const repository = options.checklistRepository || app.checklistRepository || createChecklistRepository(app.db);
  const tasksRepository = options.tasksRepository || app.tasksRepository || (app.db ? createTasksRepository(app.db) : null);

  app.get('/api/tasks/:id/checklist', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    if (typeof tasksRepository?.getTask === 'function' && !(await tasksRepository.getTask(request.params.id))) {
      reply.code(404); return { message: 'task not found' };
    }
    return repository.listChecklist(request.params.id);
  });

  app.post('/api/tasks/:id/checklist', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    const label = typeof request.body?.label === 'string' ? request.body.label.trim() : '';
    if (!label) { reply.code(400); return { message: 'label is required' }; }
    const itemId = request.body?.id;
    if (itemId !== undefined && !isValidUuid(itemId)) { reply.code(400); return { message: 'id is invalid' }; }
    if (typeof tasksRepository?.getTask === 'function') {
      const task = await tasksRepository.getTask(request.params.id);
      if (!task || task.archivedAt) { reply.code(404); return { message: 'task not found' }; }
    }
    const existing = await repository.listChecklist(request.params.id);
    if (existing.length >= MAX_CHECKLIST_ITEMS_PER_TASK) {
      reply.code(400);
      return { message: `a task holds at most ${MAX_CHECKLIST_ITEMS_PER_TASK} checklist items` };
    }
    if (itemId !== undefined) {
      if (typeof repository.addChecklistItemIdempotent !== 'function') {
        reply.code(503); return { message: 'idempotent checklist creation is unavailable' };
      }
      const result = await repository.addChecklistItemIdempotent(request.params.id, label, itemId);
      if (!result.item || (!result.created && (result.item.taskId !== request.params.id || result.item.label !== label))) {
        reply.code(409); return { message: 'checklist item id was already used for different content' };
      }
      reply.code(result.created ? 201 : 200);
      return result.item;
    }
    reply.code(201);
    return repository.addChecklistItem(request.params.id, label);
  });

  app.patch('/api/tasks/:taskId/checklist/:itemId', async (request, reply) => {
    if (!isValidUuid(request.params.taskId) || !isValidUuid(request.params.itemId)) { reply.code(400); return { message: 'id is invalid' }; }
    if (typeof request.body?.completed !== 'boolean') { reply.code(400); return { message: 'completed must be a boolean' }; }
    const item = await repository.setChecklistItemCompleted(request.params.taskId, request.params.itemId, request.body.completed);
    if (!item) { reply.code(404); return { message: 'checklist item not found' }; }
    return item;
  });

  app.delete('/api/tasks/:taskId/checklist/:itemId', async (request, reply) => {
    if (!isValidUuid(request.params.taskId) || !isValidUuid(request.params.itemId)) { reply.code(400); return { message: 'id is invalid' }; }
    const removed = await repository.deleteChecklistItem(request.params.taskId, request.params.itemId);
    if (!removed && typeof tasksRepository?.getTask === 'function'
      && !(await tasksRepository.getTask(request.params.taskId))) {
      reply.code(404); return { message: 'task not found' };
    }
    return reply.code(204).send();
  });
}
