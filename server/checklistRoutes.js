import { createChecklistRepository, MAX_CHECKLIST_ITEMS_PER_TASK } from './checklistRepository.js';
import { createTasksRepository } from './tasksRepository.js';
import { agentFrom, originFrom } from './tasksRoutes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export async function registerChecklistRoutes(app, options = {}) {
  const repository = options.checklistRepository || app.checklistRepository || createChecklistRepository(app.db);
  const tasksRepository = options.tasksRepository || app.tasksRepository || (app.db ? createTasksRepository(app.db) : null);

  // Checklist changes belong in the task's chronicle, attributed like every
  // other task event (actor kind plus the agent id). Best-effort: a failed
  // log never fails the change it describes.
  const logActivity = async (request, taskId, eventType, message) => {
    try {
      if (typeof tasksRepository?.recordActivity === 'function') {
        await tasksRepository.recordActivity(taskId, eventType, message, originFrom(request), agentFrom(request));
      }
    } catch { /* activity logging is best-effort */ }
  };

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
    // Idempotent replays outrank the cap: replaying the create of an item
    // that already exists (including the one that FILLED the checklist) must
    // return its truthful 200, not a 400 claiming a committed write was
    // refused — the exact-once retry contract depends on it.
    if (itemId !== undefined) {
      const replayed = existing.find((item) => item.id === itemId);
      if (replayed) {
        if (replayed.label !== label) {
          reply.code(409); return { message: 'checklist item id was already used for different content' };
        }
        reply.code(200);
        return replayed;
      }
    }
    if (itemId === undefined && existing.length >= MAX_CHECKLIST_ITEMS_PER_TASK) {
      reply.code(400);
      return { message: `a task holds at most ${MAX_CHECKLIST_ITEMS_PER_TASK} checklist items` };
    }
    if (itemId !== undefined) {
      if (typeof repository.addChecklistItemIdempotent !== 'function') {
        reply.code(503); return { message: 'idempotent checklist creation is unavailable' };
      }
      const result = await repository.addChecklistItemIdempotent(request.params.id, label, itemId, { maxItems: MAX_CHECKLIST_ITEMS_PER_TASK });
      // The durable receipt outlives the item: a retry after it was deleted
      // must not bring it back.
      if (result.gone) {
        reply.code(410); return { message: 'this checklist item was already created and has since been deleted' };
      }
      if (result.capped) {
        reply.code(400); return { message: `a task holds at most ${MAX_CHECKLIST_ITEMS_PER_TASK} checklist items` };
      }
      if (result.conflict || !result.item || (!result.created && !result.replayed
        && (result.item.taskId !== request.params.id || result.item.label !== label))) {
        reply.code(409); return { message: 'checklist item id was already used for different content' };
      }
      reply.code(result.created ? 201 : 200);
      if (result.created) await logActivity(request, request.params.id, 'checklist', `Checklist item added: ${label}`);
      return result.item;
    }
    reply.code(201);
    const added = await repository.addChecklistItem(request.params.id, label);
    await logActivity(request, request.params.id, 'checklist', `Checklist item added: ${label}`);
    return added;
  });

  app.patch('/api/tasks/:taskId/checklist/:itemId', async (request, reply) => {
    if (!isValidUuid(request.params.taskId) || !isValidUuid(request.params.itemId)) { reply.code(400); return { message: 'id is invalid' }; }
    if (typeof request.body?.completed !== 'boolean') { reply.code(400); return { message: 'completed must be a boolean' }; }
    // The prior state decides whether this is a change worth a chronicle
    // entry: setting a value is idempotent, and a retried set is not news.
    const before = (await repository.listChecklist(request.params.taskId))
      .find((entry) => entry.id === request.params.itemId);
    const item = await repository.setChecklistItemCompleted(request.params.taskId, request.params.itemId, request.body.completed);
    if (!item) { reply.code(404); return { message: 'checklist item not found' }; }
    if (before && Boolean(before.completed) !== Boolean(item.completed)) {
      await logActivity(request, request.params.taskId, 'checklist', `${item.completed ? 'Checked' : 'Unchecked'}: ${item.label}`);
    }
    return item;
  });

  app.delete('/api/tasks/:taskId/checklist/:itemId', async (request, reply) => {
    if (!isValidUuid(request.params.taskId) || !isValidUuid(request.params.itemId)) { reply.code(400); return { message: 'id is invalid' }; }
    const before = (await repository.listChecklist(request.params.taskId))
      .find((entry) => entry.id === request.params.itemId);
    const removed = await repository.deleteChecklistItem(request.params.taskId, request.params.itemId);
    if (removed && before) await logActivity(request, request.params.taskId, 'checklist', `Checklist item removed: ${before.label}`);
    if (!removed && typeof tasksRepository?.getTask === 'function'
      && !(await tasksRepository.getTask(request.params.taskId))) {
      reply.code(404); return { message: 'task not found' };
    }
    return reply.code(204).send();
  });
}
