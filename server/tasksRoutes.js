import { createHash } from 'node:crypto';
import { createTasksRepository, taskMatchesCreateFields } from './tasksRepository.js';
import { createProjectsRepository } from './projectsRepository.js';
import { createChecklistRepository, MAX_CHECKLIST_ITEMS_PER_TASK } from './checklistRepository.js';
import { isValidRecurrence, planTaskRecurrenceTransition } from './recurrence.js';
import { tasksToIcs } from './icsFeed.js';
import {
  cleanNlText, boundGrounding, buildNlCaptureMessages, coerceNlCaptureFields,
  buildNlFilterMessages, coerceNlFilterExpr, auditFilterExpr,
} from './nlParse.js';

const PRIORITIES = new Set(['high', 'medium', 'low']);
const STATUSES = new Set(['high-priority', 'in-progress', 'planned', 'completed', 'notes']);
// 'project' (slug-or-id) is the client-facing field; 'projectId' is resolved
// server-side and injected into the patch by the handler — never accepted raw.
const PATCH_FIELDS = ['title', 'description', 'notes', 'priority', 'status', 'project', 'dueDate', 'dueTime', 'deferredUntil', 'recurrence', 'labels', 'sortOrder'];

const MAX_LABELS = 25;

function isValidLabels(value) {
  if (value === undefined || value === null) return true;
  return Array.isArray(value) && value.length <= MAX_LABELS && value.every((l) => typeof l === 'string');
}

// Normalize labels to lowercase slugs: trim, strip a leading '@', lowercase,
// drop empties, dedupe, cap. Shared by the create and patch paths so a filter's
// @label matches a task regardless of how the label was typed.
function normalizeLabels(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim().replace(/^@+/, '').toLowerCase();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

// Snooze target: '' (or null) clears it; otherwise any string a Date can parse
// (the client sends an ISO timestamp).
function isValidDeferredUntil(value) {
  if (value === '' || value === null || value === undefined) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
const IMPORT_MODES = new Set(['append', 'skip', 'replace']);
const TASK_EXPORT_FORMAT = 'moomora.tasks';
const TASK_EXPORT_VERSION = 1;
const MIN_SORT_ORDER = -2147483648;
const MAX_SORT_ORDER = 2147483647;
// The app must always be able to restore its own export — and "its own"
// includes databases populated BEFORE any creation-side cap existed, so the
// import bound is deliberately decoupled from (and far above) the creation
// route's MAX_CHECKLIST_ITEMS_PER_TASK. The creation cap prevents new
// accumulation; import must accept whatever a legal database ever held.
const MAX_IMPORT_TASKS = 5000;
const MAX_IMPORT_CHECKLIST_ITEMS_PER_TASK = 10000;
const MAX_BOARD_EXTRA_TASKS = 200;

function isValidDateString(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// An optional wall-clock time as 'HH:MM' (24-hour). Empty/null clears it.
function isValidTimeString(value) {
  if (value === null || value === undefined || value === '') return true;
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function originFrom(request) {
  const origin = request.headers['x-prax-origin'] ?? request.headers['x-moomora-origin'];
  return origin === 'agent' ? 'agent' : 'user';
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
  if (payload.id !== undefined && !isValidUuid(payload.id)) return 'id is invalid';
  if (!PRIORITIES.has(payload.priority)) return 'priority is invalid';
  if (!STATUSES.has(payload.status)) return 'status is invalid';
  if (typeof payload.project !== 'string' || payload.project.trim() === '') return 'project is required';
  if (!isValidDateString(payload.dueDate)) return 'dueDate is invalid';
  if (!isValidTimeString(payload.dueTime)) return 'dueTime is invalid';
  if (!isValidLabels(payload.labels)) return 'labels is invalid';
  if (!isValidRecurrence(payload.recurrence)) return 'recurrence is invalid';
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
  if (payload.version !== undefined && payload.version !== TASK_EXPORT_VERSION) return 'version is invalid';
  if (payload.requestId !== undefined && !isValidUuid(payload.requestId)) return 'requestId is invalid';

  const tasks = importTasksFromPayload(payload);
  if (!tasks || tasks.length === 0) return 'tasks must include at least one task';
  if (tasks.length > MAX_IMPORT_TASKS) return `tasks cannot exceed ${MAX_IMPORT_TASKS} records`;

  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return 'tasks must include valid task records';
    if (typeof task.title !== 'string' || task.title.trim() === '') return 'title is required';
    if (task.priority !== undefined && !PRIORITIES.has(task.priority)) return 'priority is invalid';
    if (task.status !== undefined && !STATUSES.has(task.status)) return 'status is invalid';
    if (task.dueDate !== undefined && !isValidDateString(task.dueDate)) return 'dueDate is invalid';
    if (task.dueTime !== undefined && !isValidTimeString(task.dueTime)) return 'dueTime is invalid';
    if (task.deferredUntil !== undefined && !isValidDeferredUntil(task.deferredUntil)) return 'deferredUntil is invalid';
    if (task.recurrence !== undefined && !isValidRecurrence(task.recurrence)) return 'recurrence is invalid';
    if (!isValidLabels(task.labels)) return 'labels is invalid';
    if (task.description !== undefined && typeof task.description !== 'string') return 'description is invalid';
    if (task.notes !== undefined && typeof task.notes !== 'string') return 'notes is invalid';
    if (task.checklist !== undefined) {
      if (!Array.isArray(task.checklist)) return 'checklist is invalid';
      // Per-task DoS bound only — NOT the creation cap: a pre-cap database
      // can legally hold more than the creation route now allows, and its
      // export must remain restorable.
      if (task.checklist.length > MAX_IMPORT_CHECKLIST_ITEMS_PER_TASK) {
        return `checklist cannot exceed ${MAX_IMPORT_CHECKLIST_ITEMS_PER_TASK} items per task`;
      }
      if (task.checklist.some((item) => !item || typeof item.label !== 'string' || !item.label.trim()
        || (item.completed !== undefined && typeof item.completed !== 'boolean'))) return 'checklist is invalid';
    }
    if (!isValidSortOrder(task.sortOrder)) return 'sortOrder is invalid';
    if (!isValidTimestampString(task.archivedAt)) return 'archivedAt is invalid';
  }

  return null;
}

function taskImportPayloadHash({ projectId, mode, tasks }) {
  return createHash('sha256')
    .update(JSON.stringify({ projectId, mode, tasks }))
    .digest('hex');
}

function cleanImportMode(payload) {
  return payload.mode || 'skip';
}

function cleanTaskImportPayload(payload) {
  return importTasksFromPayload(payload).map((task, index) => ({
    title: task.title.trim(),
    description: typeof task.description === 'string' ? task.description : '',
    notes: typeof task.notes === 'string' ? task.notes : '',
    priority: task.priority || 'medium',
    status: task.status || 'planned',
    projectId: payload.projectId,
    dueDate: task.dueDate || null,
    dueTime: task.dueTime || null,
    deferredUntil: task.deferredUntil || null,
    recurrence: task.recurrence || null,
    labels: normalizeLabels(task.labels),
    sortOrder: Number.isInteger(task.sortOrder) ? task.sortOrder : index,
    archivedAt: task.archivedAt || null,
    checklist: Array.isArray(task.checklist)
      ? task.checklist.map((item) => ({ label: item.label.trim(), completed: Boolean(item.completed) }))
      : [],
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

// Mirrors filterTaskImportDuplicates in tasksRepository.js: skip-mode
// compares incoming tasks against the TARGET only — deduping within the
// batch dropped distinct tasks that share the lossy key on restore.
function filterDuplicateTasks(importedTasks, existingTasks) {
  const existingKeys = new Set(existingTasks.map(duplicateKeyForTask));
  return importedTasks.reduce((result, task) => {
    if (existingKeys.has(duplicateKeyForTask(task))) {
      result.skipped += 1;
      return result;
    }
    result.tasks.push(task);
    return result;
  }, { tasks: [], skipped: 0 });
}

function cleanTaskPayload(payload) {
  return {
    ...(payload.id ? { id: payload.id } : {}),
    title: payload.title.trim(),
    description: typeof payload.description === 'string' ? payload.description.trim() : '',
    notes: typeof payload.notes === 'string' ? payload.notes.trim() : '',
    priority: payload.priority,
    status: payload.status,
    projectId: payload.projectId,
    dueDate: payload.dueDate || null,
    dueTime: payload.dueTime || null,
    recurrence: payload.recurrence || null,
    labels: normalizeLabels(payload.labels),
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
    Object.prototype.hasOwnProperty.call(payload, 'dueTime') &&
    !isValidTimeString(payload.dueTime)
  ) {
    return 'dueTime is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'deferredUntil') &&
    !isValidDeferredUntil(payload.deferredUntil)
  ) {
    return 'deferredUntil is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'recurrence') &&
    !isValidRecurrence(payload.recurrence)
  ) {
    return 'recurrence is invalid';
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'labels') &&
    !isValidLabels(payload.labels)
  ) {
    return 'labels is invalid';
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
    if ((field === 'dueDate' || field === 'dueTime' || field === 'deferredUntil' || field === 'recurrence') && payload[field] === '') {
      fields[field] = null;
      return fields;
    }
    if (field === 'labels') {
      fields.labels = normalizeLabels(payload.labels);
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

function taskIdsFromQuery(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .flatMap(item => String(item || '').split(','))
    .map(item => item.trim())
    .filter(Boolean))];
}

export async function registerTasksRoutes(app, options = {}) {
  const repository = options.tasksRepository || app.tasksRepository || createTasksRepository(app.db);
  const projectsRepository = options.projectsRepository || app.projectsRepository || createProjectsRepository(app.db);
  const checklistRepository = options.checklistRepository || app.checklistRepository
    || (app.db ? createChecklistRepository(app.db) : null);

  async function restoreImportedChecklists(tasks, candidates) {
    if (!checklistRepository) return;
    for (let index = 0; index < tasks.length; index += 1) {
      for (const item of candidates[index]?.checklist || []) {
        const created = await checklistRepository.addChecklistItem(tasks[index].id, item.label);
        if (item.completed) {
          await checklistRepository.setChecklistItemCompleted(tasks[index].id, created.id, true);
        }
      }
    }
  }

  // The active chat model for the NL-parse routes, mirroring libraryRoutes:
  // injected wins, then the runtime provider, else null (feature degrades).
  const chatProvider = options.chatProvider ?? app.chatProvider ?? null;
  const injectedChat = options.chat ?? null;
  async function resolveChat() {
    if (injectedChat) return injectedChat;
    if (chatProvider) {
      try { return await chatProvider.getChat(); } catch { return null; }
    }
    return null;
  }

  const logActivity = async (taskId, eventType, message, actor = 'user') => {
    try { if (repository.recordActivity) await repository.recordActivity(taskId, eventType, message, actor); }
    catch { /* activity logging is best-effort; never fail the mutation */ }
  };

  async function resolveProjectId(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const project = await projectsRepository.resolveProject(String(value));
    return project ? project.id : null; // null signals "given but not found"
  }

  const planLifecycle = (prior, fields) => planTaskRecurrenceTransition(prior, fields);

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
    const tasksWithChecklist = await Promise.all(tasks.map(async (task) => ({
      ...task,
      checklist: checklistRepository ? await checklistRepository.listChecklist(task.id) : [],
    })));
    return {
      format: TASK_EXPORT_FORMAT,
      version: TASK_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      project: exportProject || 'all',
      tasks: tasksWithChecklist,
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

  // iCalendar feed of open dated tasks — subscribe from Apple Calendar,
  // Thunderbird, or anything that takes a URL (Google Calendar's "from URL"
  // needs the address to be reachable from Google's servers, so it only works
  // when Prax is exposed beyond localhost). Optional ?project=<slug|id> scopes
  // the feed and names the calendar after the project.
  app.get('/api/calendar.ics', async (request, reply) => {
    let projectId;
    if (request.query.project && request.query.project !== 'all') {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    const tasks = await repository.listTasks(projectId ? { projectId } : {});
    // Same inclusion rule as the in-app calendar grid (isOpen && !snoozed):
    // completed is done, 'notes' is the design-vocab backlog, and a snoozed
    // task (deferredUntil in the future) is hidden everywhere in the app — the
    // subscribed calendar must not resurface what the user just deferred.
    // Archived is already excluded by listTasks' default.
    const feedNow = new Date();
    const dated = (tasks || []).filter((task) => task.dueDate
      && task.status !== 'completed' && task.status !== 'notes'
      && !(task.deferredUntil && new Date(task.deferredUntil) > feedNow));
    const projects = await projectsRepository.listProjects();
    const names = new Map((projects || []).map((p) => [p.id, p.name]));
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    reply.header('Content-Disposition', 'inline; filename="prax.ics"');
    return tasksToIcs(dated, {
      calendarName: projectId && names.get(projectId) ? `Prax — ${names.get(projectId)}` : 'Prax',
      projectNamesById: names,
      now: new Date().toISOString(),
    });
  });

  app.get('/api/tasks/board-extras', async (request, reply) => {
    const taskIds = taskIdsFromQuery(request.query.ids);
    if (taskIds.length === 0) return [];
    if (taskIds.length > MAX_BOARD_EXTRA_TASKS || taskIds.some(id => !isValidUuid(id))) {
      reply.code(400);
      return { message: 'task ids are invalid' };
    }
    return repository.listTaskBoardExtras ? repository.listTaskBoardExtras(taskIds) : [];
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
    const requestId = request.body.requestId;
    const payloadHash = requestId
      ? taskImportPayloadHash({ projectId: resolvedProjectId, mode, tasks: importCandidates })
      : null;
    if (requestId) {
      if (typeof repository.importTasksExactlyOnce !== 'function') {
        reply.code(503);
        return { message: 'exact-once task import is unavailable' };
      }
      const result = await repository.importTasksExactlyOnce(importCandidates, {
        requestId,
        payloadHash,
        mode,
        projectId: resolvedProjectId,
        replaceProjectId: mode === 'replace' ? resolvedProjectId : null,
      });
      if (result.conflict) {
        reply.code(409);
        return { message: 'requestId was already used for a different task import' };
      }
      reply.code(result.replayed ? 200 : (result.imported ? 201 : 200));
      return result;
    }
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

    const candidates = mode === 'replace' ? importCandidates : tasksToImport;
    const hasAtomicImport = typeof repository.importTasksWithChecklists === 'function';
    const tasks = candidates.length
      ? hasAtomicImport
        ? await repository.importTasksWithChecklists(candidates, {
          replaceProjectId: mode === 'replace' ? resolvedProjectId : null,
        })
        : mode === 'replace'
          ? await repository.replaceProjectTasks(resolvedProjectId, importCandidates)
          : await repository.importTasks(tasksToImport)
      : [];
    if (!hasAtomicImport) await restoreImportedChecklists(tasks, candidates);
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
    const candidate = cleanTaskPayload({ ...request.body, projectId: resolvedId });
    if (candidate.id) {
      if (typeof repository.createTaskIdempotent !== 'function') {
        reply.code(503);
        return { message: 'idempotent task creation is unavailable' };
      }
      const result = await repository.createTaskIdempotent(candidate);
      if (!result.task || (!result.created && !taskMatchesCreateFields(result.task, candidate))) {
        reply.code(409);
        // A replay that matches an ARCHIVED row must not report success for a
        // task no view shows — but it deserves a truthful, distinct message.
        if (result.task?.archivedAt) {
          return { message: 'this capture was already created and has since been archived' };
        }
        return { message: 'task id was already used for different content' };
      }
      reply.code(result.created ? 201 : 200);
      if (result.created) await logActivity(result.task.id, 'created', 'Task created', originFrom(request));
      return result.task;
    }
    const created = await repository.createTask(candidate);
    reply.code(201);
    await logActivity(created.id, 'created', 'Task created', originFrom(request));
    return created;
  });

  app.patch('/api/tasks/reorder', async (request, reply) => {
    const validationError = validateTaskReorderPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    const updates = cleanTaskReorderPayload(request.body);
    const priors = new Map();
    if (repository.getTask) {
      for (const update of updates) {
        const prior = await repository.getTask(update.id);
        if (prior) priors.set(update.id, prior);
      }
    }

    let lifecycleResults = null;
    let reordered;
    if (repository.reorderTasksWithLifecycle) {
      lifecycleResults = await repository.reorderTasksWithLifecycle(updates, planLifecycle);
      reordered = lifecycleResults.map(result => result.task);
    } else {
      const requiresLifecycle = updates.some((update) => {
        const prior = priors.get(update.id);
        if (!prior) return false;
        const transition = planLifecycle(prior, { status: update.status, sortOrder: update.sortOrder });
        return Boolean(transition.nextTask || transition.reopenedAsOneOff);
      });
      if (requiresLifecycle) {
        reply.code(503);
        return { message: 'atomic recurring task transition is unavailable' };
      }
      reordered = await repository.reorderTasks(updates);
    }

    for (const task of reordered) {
      if (!task) continue;
      const priorStatus = (lifecycleResults?.find(result => result.task.id === task.id)?.prior || priors.get(task.id))?.status;
      if (priorStatus !== undefined && priorStatus !== task.status) {
        await logActivity(task.id, 'status', `Status → ${task.status}`, originFrom(request));
      }
      const nextTask = lifecycleResults?.find(result => result.task.id === task.id)?.nextTask;
      if (nextTask) await logActivity(nextTask.id, 'created', 'Recurring task created', originFrom(request));
    }

    return reordered;
  });

  app.get('/api/tasks/:id/documents', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }
    if (typeof repository.getTask === 'function' && !(await repository.getTask(request.params.id))) {
      reply.code(404);
      return { message: 'task not found' };
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
    if (!removed && typeof repository.getTask === 'function' && !(await repository.getTask(id))) {
      reply.code(404);
      return { message: 'task not found' };
    }
    return repository.listTaskDocuments(id);
  });

  app.get('/api/tasks/:id/activity', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'task id is invalid' };
    }
    if (typeof repository.getTask === 'function' && !(await repository.getTask(request.params.id))) {
      reply.code(404);
      return { message: 'task not found' };
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
    await logActivity(task.id, 'restored', 'Task restored', originFrom(request));
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

  app.get('/api/tasks/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'task id is invalid' }; }
    const task = await repository.getTask(request.params.id);
    if (!task) { reply.code(404); return { message: 'task not found' }; }
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
    let result = null;
    let task;
    if (repository.updateTaskLifecycle) {
      result = await repository.updateTaskLifecycle(request.params.id, fields, planLifecycle);
      task = result.task;
    } else {
      const transition = planLifecycle(prior, fields);
      if (transition.nextTask || transition.reopenedAsOneOff) {
        reply.code(503);
        return { message: 'atomic recurring task transition is unavailable' };
      }
      task = await repository.updateTask(request.params.id, transition.fields);
    }
    if (!task) {
      reply.code(404);
      return { message: 'task not found' };
    }
    const authoritativePrior = result?.prior || prior;
    if (authoritativePrior && authoritativePrior.status !== task.status) {
      await logActivity(task.id, 'status', `Status → ${task.status}`, originFrom(request));
    }
    if (result?.nextTask) {
      await logActivity(result.nextTask.id, 'created', 'Recurring task created', originFrom(request));
      // Additive: lets the client derive the "next occurrence scheduled"
      // toast from the OUTCOME instead of inferring it from the recurrence
      // token being truthy (which lied whenever no successor was spawned).
      return { ...task, nextOccurrenceTaskId: result.nextTask.id };
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
    await logActivity(task.id, 'archived', 'Task archived', originFrom(request));
    return task;
  });

  // ---- NL parsing (Tier-3 #8) -----------------------------------------------
  // Stateless parse-and-return: the client previews the result and creates the
  // task (or applies the filter) through the normal endpoints. Both routes
  // follow the advisory-AI regime — they NEVER 500 on the AI path; every
  // failure is a 200 { degraded, reason } the UI renders a message from.
  // Grounding (projects/labels) is client-sent and bounded in nlParse.js.

  // NL → capture fields. { text, date?, projects?, labels? } →
  // { fields|null, dropped[], degraded, reason?, model }.
  app.post('/api/tasks/nl-capture', async (request, reply) => {
    const b = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const text = cleanNlText(b.text);
    if (!text) { reply.code(400); return { message: 'text is required' }; }
    const { projects, labels } = boundGrounding(b.projects, b.labels);
    const chat = await resolveChat();
    if (!chat) return { fields: null, dropped: [], degraded: true, reason: 'no-chat-model', model: null };
    try {
      const messages = buildNlCaptureMessages({ text, date: typeof b.date === 'string' ? b.date : null, projects, labels });
      const { text: out, model } = await chat.complete(messages, { temperature: 0, maxTokens: 300 });
      const parsed = coerceNlCaptureFields(out, { projectSlugs: projects.map((p) => p.slug), knownLabels: labels, rawText: text });
      if (!parsed) {
        request.log?.info?.({ reason: 'generation-failed' }, 'nl-capture degraded');
        return { fields: null, dropped: [], degraded: true, reason: 'generation-failed', model: model || chat.model || null };
      }
      return { fields: parsed.fields, dropped: parsed.dropped, degraded: false, model: model || chat.model || null };
    } catch (err) {
      request.log?.error?.({ err }, 'nl-capture failed');
      return { fields: null, dropped: [], degraded: true, reason: 'generation-failed', model: chat.model || null };
    }
  });

  // NL → filter expression. { text, date?, projects?, labels? } →
  // { expr|null, valid, parseError, warnings[], degraded, reason?, model }.
  // An extracted-but-invalid expr is still returned (valid:false) — it lands in
  // the filter input where the existing error hint explains it; hand-fixing a
  // near-miss beats silently discarding it.
  app.post('/api/tasks/nl-filter', async (request, reply) => {
    const b = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const text = cleanNlText(b.text);
    if (!text) { reply.code(400); return { message: 'text is required' }; }
    const { projects, labels } = boundGrounding(b.projects, b.labels);
    const chat = await resolveChat();
    if (!chat) return { expr: null, valid: false, parseError: null, warnings: [], degraded: true, reason: 'no-chat-model', model: null };
    try {
      const messages = buildNlFilterMessages({ text, date: typeof b.date === 'string' ? b.date : null, projects, labels });
      const { text: out, model } = await chat.complete(messages, { temperature: 0, maxTokens: 200 });
      const expr = coerceNlFilterExpr(out);
      if (!expr) {
        request.log?.info?.({ reason: 'generation-failed' }, 'nl-filter degraded');
        return { expr: null, valid: false, parseError: null, warnings: [], degraded: true, reason: 'generation-failed', model: model || chat.model || null };
      }
      const audit = auditFilterExpr(expr, { projects, labels });
      return { expr, valid: audit.ok, parseError: audit.parseError, warnings: audit.warnings, degraded: false, model: model || chat.model || null };
    } catch (err) {
      request.log?.error?.({ err }, 'nl-filter failed');
      return { expr: null, valid: false, parseError: null, warnings: [], degraded: true, reason: 'generation-failed', model: chat.model || null };
    }
  });
}
