import { createChecklistRepository } from './checklistRepository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export async function registerChecklistRoutes(app, options = {}) {
  const repository = options.checklistRepository || app.checklistRepository || createChecklistRepository(app.db);

  app.get('/api/tasks/:id/checklist', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    return repository.listChecklist(request.params.id);
  });

  app.post('/api/tasks/:id/checklist', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    const label = typeof request.body?.label === 'string' ? request.body.label.trim() : '';
    if (!label) { reply.code(400); return { message: 'label is required' }; }
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
    if (!removed) { reply.code(404); return { message: 'checklist item not found' }; }
    return reply.code(204).send();
  });
}
