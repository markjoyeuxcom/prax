import { createTasksRepository } from './tasksRepository.js';
import { createProjectsRepository } from './projectsRepository.js';

const PRIORITIES = new Set(['high', 'medium', 'low']);
const STATUSES = new Set(['high-priority', 'in-progress', 'planned', 'completed', 'notes']);
// 'project' (slug-or-id) is the client-facing field; 'projectId' is resolved
// server-side and injected into the patch by the handler — never accepted raw.
const PATCH_FIELDS = ['title', 'description', 'notes', 'priority', 'status', 'project', 'dueDate', 'sortOrder'];
const IMPORT_MODES = new Set(['append', 'skip', 'replace']);
const TASK_EXPORT_FORMAT = 'moomora.tasks';
const MIN_SORT_ORDER = -2147483648;
const MAX_SORT_ORDER = 2147483647;
const MAX_IMPORT_TASKS = 500;

function isValidDateString(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isValidSortOrder(value) {
  return (
    value === undefined ||
    (Number.isInteger(value) && value >= MIN_SORT_ORDER && value <= MAX_SORT_ORDER)
  );
}

function isValidTimestampString(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  return !Number.isNaN(new Date(value).getTime());
}

function validateTaskPayload(payload) {
  if (!payload || typeof payload.title !== 'string' || payload.title.trim() === '') {
    return 'title is required';
  }
  if (!PRIORITIES.has(payload.priority)) return 'priority is invalid';
  if (!STATUSES.has(payload.status)) return 'status is invalid';
  if (typeof payload.project !== 'string' || payload.project.trim() === '') return 'project is required';
  if (!isValidDateString(payload.dueDate)) return 'dueDate is invalid';
  if (!isValidSortOrder(payload.sortOrder)) {
    return 'sortOrder is invalid';
  }
  return null;
}

function importTasksFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.tasks)) return payload.tasks;
  return null;
}

function validateTaskImportPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'tasks must include at least one task';
  if (typeof payload.project !== 'string' || payload.project.trim() === '') return 'project is required';
  if (payload.mode !== undefined && !IMPORT_MODES.has(payload.mode)) return 'mode is invalid';
  if (payload.format !== undefined && payload.format !== TASK_EXPORT_FORMAT) return 'format is invalid';

  const tasks = importTasksFromPayload(payload);
  if (!tasks || tasks.length === 0) return 'tasks must include at least one task';
  if (tasks.length > MAX_IMPORT_TASKS) return `tasks cannot exceed ${MAX_IMPORT_TASKS} records`;

  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return 'tasks must include valid task records';
    if (typeof task.title !== 'string' || task.title.trim() === '') return 'title is required';
    if (task.priority !== undefined && !PRIORITIES.has(task.priority)) return 'priority is invalid';
    if (task.status !== undefined && !STATUSES.has(task.status)) return 'status is invalid';
    if (task.dueDate !== undefined && !isValidDateString(task.dueDate)) return 'dueDate is invalid';
    if (!isValidSortOrder(task.sortOrder)) return 'sortOrder is invalid';
    if (!isValidTimestampString(task.archivedAt)) return 'archivedAt is invalid';
  }

  return null;
}

function cleanImportMode(payload) {
  return payload.mode || 'skip';
}

function cleanTaskImportPayload(payload) {
  return importTasksFromPayload(payload).map((task, index) => ({
    title: task.title.trim(),
    description: typeof task.description === 'string' ? task.description.trim() : '',
    priority: task.priority || 'medium',
    status: task.status || 'planned',
    projectId: payload.projectId,
    dueDate: task.dueDate || null,
    sortOrder: Number.isInteger(task.sortOrder) ? task.sortOrder : index,
    archivedAt: task.archivedAt || null,
  }));
}

function duplicateKeyForTask(task) {
  return [
    String(task.title || '').trim().toLowerCase(),
    String(task.projectId || '').trim().toLowerCase(),
    String(task.status || 'planned').trim().toLowerCase(),
    String(task.dueDate || '').trim(),
  ].join('\u001f');
}

function filterDuplicateTasks(importedTasks, existingTasks) {
  const existingKeys = new Set(existingTasks.map(duplicateKeyForTask));
  return importedTasks.reduce((result, task) => {
    const key = duplicateKeyForTask(task);
    if (existingKeys.has(key)) {
      result.skipped += 1;
      return result;
    }
    existingKeys.add(key);
    result.tasks.push(task);
    return result;
  }, { tasks: [], skipped: 0 });
}

function cleanTaskPayload(payload) {
  return {
    title: payload.title.trim(),
    description: typeof payload.description === 'string' ? payload.description.trim() : '',
    notes: typeof payload.notes === 'string' ? payload.notes.trim() : '',
    priority: payload.priority,
    status: payload.status,
    projectId: payload.projectId,
    dueDate: payload.dueDate || null,
    sortOrder: Number.isFinite(payload.sortOrder) ? payload.sortOrder : 0,
  };
}

function validateTaskPatchPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'task update requires at least one field';
  }

  const hasAllowedField = PATCH_FIELDS.some(field =>
    Object.prototype.hasOwnProperty.call(payload, field),
  );
  if (!hasAllowedField) return 'task update requires at least one field';

  if (
    Object.prototype.hasOwnProperty.call(payload, 'title') &&
    (typeof payload.title !== 'string' || payload.title.trim() === '')
  ) {
    return 'title is required';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'description') &&
    typeof payload.description !== 'string'
  ) {
    return 'description is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'notes') &&
    typeof payload.notes !== 'string'
  ) {
    return 'notes is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'priority') &&
    !PRIORITIES.has(payload.priority)
  ) {
    return 'priority is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'status') &&
    !STATUSES.has(payload.status)
  ) {
    return 'status is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'project') &&
    (typeof payload.project !== 'string' || payload.project.trim() === '')
  ) {
    return 'project is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'dueDate') &&
    !isValidDateString(payload.dueDate)
  ) {
    return 'dueDate is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'sortOrder') &&
    !isValidSortOrder(payload.sortOrder)
  ) {
    return 'sortOrder is invalid';
  }

  return null;
}

function cleanTaskPatchPayload(payload) {
  return PATCH_FIELDS.reduce((fields, field) => {
    if (field === 'project') return fields; // slug only — projectId is resolved separately
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return fields;
    if (field === 'title' || field === 'description' || field === 'notes') {
      fields[field] = payload[field].trim();
      return fields;
    }
    if (field === 'dueDate' && payload[field] === '') {
      fields[field] = null;
      return fields;
    }
    fields[field] = payload[field];
    return fields;
  }, {});
}

function validateTaskReorderPayload(payload) {
  if (!payload || !Array.isArray(payload.tasks) || payload.tasks.length === 0) {
    return 'tasks must include at least one task update';
  }

  for (const task of payload.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      return 'tasks must include valid task updates';
    }
    if (!isValidUuid(task.id)) return 'task id is invalid';
    if (!STATUSES.has(task.status)) return 'status is invalid';
    if (!isValidSortOrder(task.sortOrder)) return 'sortOrder is invalid';
  }

  return null;
}

function cleanTaskReorderPayload(payload) {
  return payload.tasks.map(task => ({
    id: task.id,
    status: task.status,
    sortOrder: task.sortOrder,
  }));
}

export async function registerTasksRoutes(app, options = {}) {
  const repository = options.tasksRepository || app.tasksRepository || createTasksRepository(app.db);
  const projectsRepository = options.projectsRepository || app.projectsRepository || createProjectsRepository(app.db);

  const logActivity = async (taskId, eventType, message) => {
    try { if (repository.recordActivity) await repository.recordActivity(taskId, eventType, message); }
    catch { /* activity logging is best-effort; never fail the mutation */ }
  };

  async function resolveProjectId(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const project = await projectsRepository.resolveProject(String(value));
    return project ? project.id : null; // null signals "given but not found"
  }

  app.get('/api/tasks/export', async (request, reply) => {
    const exportProject = request.query.project;

    let projectId;
    if (exportProject && exportProject !== 'all') {
      projectId = await resolveProjectId(exportProject);
      if (projectId === null) {
        reply.code(400);
        return { message: 'project is invalid' };
      }
    }

    const filters = projectId
      ? { projectId, archived: 'all' }
      : { archived: 'all' };
    const tasks = await repository.listTasks(filters);
    return {
      format: TASK_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      project: exportProject || 'all',
      tasks,
    };
  });

  app.get('/api/tasks', async (request, reply) => {
    let projectId;
    if (request.query.project && request.query.project !== 'all') {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    return repository.listTasks({ ...request.query, projectId });
  });

  app.post('/api/tasks/import', async (request, reply) => {
    const validationError = validateTaskImportPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    const resolvedProjectId = await resolveProjectId(request.body.project);
    if (resolvedProjectId === null) {
      reply.code(400);
      return { message: 'project is invalid' };
    }

    // Attach resolved projectId to payload for cleanTaskImportPayload
    const enrichedBody = { ...request.body, projectId: resolvedProjectId };

    const mode = cleanImportMode(enrichedBody);
    const importCandidates = cleanTaskImportPayload(enrichedBody);
    let skipped = 0;
    let tasksToImport = importCandidates;

    if (mode === 'skip') {
      const existingTasks = await repository.listTasks({
        projectId: resolvedProjectId,
        archived: 'all',
      });
      const filtered = filterDuplicateTasks(importCandidates, existingTasks);
      tasksToImport = filtered.tasks;
      skipped = filtered.skipped;
    }

    const tasks = mode === 'replace'
      ? await repository.replaceProjectTasks(resolvedProjectId, importCandidates)
      : tasksToImport.length
        ? await repository.importTasks(tasksToImport)
        : [];
    reply.code(tasks.length ? 201 : 200);
    return {
      mode,
      imported: tasks.length,
      skipped,
      tasks,
    };
  });

  app.post('/api/tasks', async (request, reply) => {
    const validationError = validateTaskPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }
    const resolvedId = await resolveProjectId(request.body.project);
    if (resolvedId === null) { reply.code(400); return { message: 'project is invalid' }; }
    request.body.projectId = resolvedId;
    reply.code(201);
    const created = await repository.createTask(cleanTaskPayload(request.body));
    await logActivity(created.id, 'created', 'Task created');
    return created;
  });

  app.patch('/api/tasks/reorder', async (request, reply) => {
    const validationError = validateTaskReorderPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    const updates = cleanTaskReorderPayload(request.body);
    const priorStatuses = new Map();
    if (repository.getTask) {
      for (const update of updates) {
        const prior = await repository.getTask(update.id);
        if (prior) priorStatuses.set(update.id, prior.status);
      }
    }

    const reordered = await repository.reorderTasks(updates);

    for (const task of reordered) {
      if (!task) continue;
      const priorStatus = priorStatuses.get(task.id);
      if (priorStatus !== undefined && priorStatus !== task.status) {
        await logActivity(task.id, 'status', `Status → ${task.status}`);
      }
    }

    return reordered;
  });

  app.get('/api/tasks/:id/documents', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }
    return repository.listTaskDocuments(request.params.id);
  });

  app.post('/api/tasks/:id/documents', async (request, reply) => {
    const id = request.params.id;
    if (!isValidUuid(id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }
    const { documentId } = request.body || {};
    if (!isValidUuid(documentId)) {
      reply.code(400);
      return { message: 'documentId is invalid' };
    }
    const result = await repository.linkTaskDocument(id, documentId);
    if (!result.linked) {
      reply.code(404);
      return { message: 'task or document not found' };
    }
    reply.code(result.alreadyLinked ? 200 : 201);
    return repository.listTaskDocuments(id);
  });

  app.delete('/api/tasks/:id/documents/:documentId', async (request, reply) => {
    const { id, documentId } = request.params;
    if (!isValidUuid(id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }
    if (!isValidUuid(documentId)) {
      reply.code(400);
      return { message: 'documentId is invalid' };
    }
    const removed = await repository.unlinkTaskDocument(id, documentId);
    if (!removed) {
      reply.code(404);
      return { message: 'link not found' };
    }
    return repository.listTaskDocuments(id);
  });

  app.get('/api/tasks/:id/activity', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }
    return repository.listTaskActivity ? repository.listTaskActivity(request.params.id) : [];
  });

  app.patch('/api/tasks/:id/restore', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }

    const task = await repository.restoreTask(request.params.id);
    if (!task) {
      reply.code(404);
      return { message: 'task not found' };
    }
    await logActivity(task.id, 'restored', 'Task restored');
    return task;
  });

  app.delete('/api/tasks/:id/permanent', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }

    const task = await repository.deleteArchivedTask(request.params.id);
    if (!task) {
      reply.code(404);
      return { message: 'task not found' };
    }
    return task;
  });

  app.patch('/api/tasks/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }

    const validationError = validateTaskPatchPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    const fields = cleanTaskPatchPayload(request.body);
    if (Object.prototype.hasOwnProperty.call(request.body, 'project')) {
      const resolvedId = await resolveProjectId(request.body.project);
      if (resolvedId === null) { reply.code(400); return { message: 'project is invalid' }; }
      fields.projectId = resolvedId;
    }

    const prior = repository.getTask ? await repository.getTask(request.params.id) : null;

    const task = await repository.updateTask(request.params.id, fields);
    if (!task) {
      reply.code(404);
      return { message: 'task not found' };
    }
    if (prior && prior.status !== task.status) {
      await logActivity(task.id, 'status', `Status → ${task.status}`);
    }
    return task;
  });

  app.delete('/api/tasks/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }

    const task = await repository.archiveTask(request.params.id);
    if (!task) {
      reply.code(404);
      return { message: 'task not found' };
    }
    await logActivity(task.id, 'archived', 'Task archived');
    return task;
  });
}
