import { createTasksRepository } from './tasksRepository.js';

const PRIORITIES = new Set(['high', 'medium', 'low']);
const STATUSES = new Set(['high-priority', 'in-progress', 'planned', 'completed', 'notes']);
const CONTEXTS = new Set(['personal', 'work', 'homelab']);
const PATCH_FIELDS = ['title', 'description', 'priority', 'status', 'context', 'dueDate', 'sortOrder'];
const IMPORT_MODES = new Set(['append', 'skip', 'replace']);
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
  if (!CONTEXTS.has(payload.context)) return 'context is invalid';
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
  if (!CONTEXTS.has(payload.context)) return 'context is invalid';
  if (payload.mode !== undefined && !IMPORT_MODES.has(payload.mode)) return 'mode is invalid';

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
    context: payload.context,
    dueDate: task.dueDate || null,
    sortOrder: Number.isInteger(task.sortOrder) ? task.sortOrder : index,
    archivedAt: task.archivedAt || null,
  }));
}

function duplicateKeyForTask(task) {
  return [
    String(task.title || '').trim().toLowerCase(),
    String(task.context || '').trim().toLowerCase(),
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
    priority: payload.priority,
    status: payload.status,
    context: payload.context,
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
    Object.prototype.hasOwnProperty.call(payload, 'context') &&
    !CONTEXTS.has(payload.context)
  ) {
    return 'context is invalid';
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
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return fields;
    if (field === 'title' || field === 'description') {
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

  app.get('/api/tasks/export', async (request, reply) => {
    const exportContext = request.query.context;
    if (exportContext !== 'all' && !CONTEXTS.has(exportContext)) {
      reply.code(400);
      return { message: 'context is invalid' };
    }

    const filters = exportContext === 'all'
      ? { archived: 'all' }
      : { context: exportContext, archived: 'all' };
    const tasks = await repository.listTasks(filters);
    return {
      format: 'taskboard.tasks',
      version: 1,
      exportedAt: new Date().toISOString(),
      context: exportContext,
      tasks,
    };
  });

  app.get('/api/tasks', async request => {
    return repository.listTasks(request.query);
  });

  app.post('/api/tasks/import', async (request, reply) => {
    const validationError = validateTaskImportPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    const mode = cleanImportMode(request.body);
    const importCandidates = cleanTaskImportPayload(request.body);
    let skipped = 0;
    let tasksToImport = importCandidates;

    if (mode === 'skip') {
      const existingTasks = await repository.listTasks({
        context: request.body.context,
        archived: 'all',
      });
      const filtered = filterDuplicateTasks(importCandidates, existingTasks);
      tasksToImport = filtered.tasks;
      skipped = filtered.skipped;
    }

    const tasks = mode === 'replace'
      ? await repository.replaceContextTasks(request.body.context, importCandidates)
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
    reply.code(201);
    return repository.createTask(cleanTaskPayload(request.body));
  });

  app.patch('/api/tasks/reorder', async (request, reply) => {
    const validationError = validateTaskReorderPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    return repository.reorderTasks(cleanTaskReorderPayload(request.body));
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

    const task = await repository.updateTask(request.params.id, cleanTaskPatchPayload(request.body));
    if (!task) {
      reply.code(404);
      return { message: 'task not found' };
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
    return task;
  });
}
