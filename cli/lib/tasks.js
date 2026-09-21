// cli/lib/tasks.js — the `prax task` subcommands: create, list, read, update,
// complete and tick tasks over the HTTP API. The CALLER resolves the project
// slug (the same precedence `remember` uses) and passes parsed flags; this
// module shapes payloads, chooses the retry-safe route and formats output.
//
// Creation goes through the exact-once import route in `append` mode with a
// caller-stable requestId: the task and its checklist commit in ONE
// transaction, and a lost response can be retried without a duplicate — the
// server replays the recorded result. `append`, not `skip`: an explicit add
// must never be silently dropped because an older task shares its title.
//
// Updates are one PATCH with no automatic retry. That route has no operation
// receipt, so an uncertain transport outcome is reported as unknown rather
// than re-sent over a possibly newer edit (the same rule as the legacy
// document PATCH in apiClient.updateMemory).
import { randomUUID } from 'node:crypto';

export const TASK_PRIORITIES = ['high', 'medium', 'low'];
export const TASK_STATUSES = ['high-priority', 'in-progress', 'planned', 'completed', 'notes'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isTaskId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Mirrors the server/browser label normaliser (public/js/labels.js): trim,
// strip a leading '@', lowercase, de-duplicate. Kept inline so the skill
// bundles stay dependency-free.
export function parseLabels(value) {
  if (value === undefined || value === true || value === null) return undefined;
  const seen = new Set();
  const out = [];
  for (const raw of String(value).split(',')) {
    const label = raw.trim().replace(/^@+/, '').toLowerCase();
    if (label && !seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}

function optionalString(value) {
  return value === undefined || value === true ? undefined : String(value);
}

function validateEnum(name, value, allowed) {
  if (value === undefined) return undefined;
  const v = String(value);
  if (!allowed.includes(v)) throw new Error(`Unknown --${name} "${v}". Values: ${allowed.join(', ')}.`);
  return v;
}

function validateDate(name, value) {
  if (value === undefined) return undefined;
  const v = String(value);
  if (v === '') return null; // an explicit empty value clears the date on update
  if (!DATE_RE.test(v)) throw new Error(`--${name} must be YYYY-MM-DD (got "${v}").`);
  return v;
}

// One task record in the import contract (docs/contract.md, Format 1) from
// parsed flags. `checks` is the list of --check labels in order.
export function buildTaskRecord({ title, flags = {}, checks = [] } = {}) {
  const t = String(title ?? '').trim();
  if (!t) throw new Error('task add requires a title.');
  const record = {
    title: t,
    priority: validateEnum('priority', optionalString(flags.priority), TASK_PRIORITIES) || 'medium',
    status: validateEnum('status', optionalString(flags.status), TASK_STATUSES) || 'planned',
  };
  const description = optionalString(flags.description);
  if (description !== undefined) record.description = description;
  const notes = optionalString(flags.notes);
  if (notes !== undefined) record.notes = notes;
  const due = validateDate('due', optionalString(flags.due));
  if (due) record.dueDate = due;
  const planned = validateDate('planned', optionalString(flags.planned));
  if (planned) record.plannedFor = planned;
  const labels = parseLabels(flags.label);
  if (labels) record.labels = labels;
  const checklist = checks.map((label) => String(label).trim()).filter(Boolean)
    .map((label) => ({ label, completed: false }));
  if (checklist.length) record.checklist = checklist;
  return record;
}

// Returns { task, replayed }. `requestId` is generated per call unless the
// caller passes one (a script that wants to retry an identical add later).
export async function createTask(client, { project, record, requestId } = {}) {
  if (!project) throw new Error('task add requires a project.');
  const slug = await client.ensureProject(project);
  const id = requestId || randomUUID();
  const result = await client.importTasks({
    format: 'moomora.tasks', version: 1, project: slug, mode: 'append', requestId: id, tasks: [record],
  });
  const task = Array.isArray(result?.tasks) ? result.tasks[0] : null;
  if (!task) throw new Error(`task add: the server reported no created task (requestId ${id}).`);
  return { task, replayed: Boolean(result?.replayed), requestId: id, project: slug };
}

// A PATCH body from update flags. Empty --due / --planned clear the date.
export function buildTaskPatch(flags = {}) {
  const patch = {};
  const title = optionalString(flags.title);
  if (title !== undefined) {
    if (!title.trim()) throw new Error('--title cannot be empty.');
    patch.title = title;
  }
  const status = validateEnum('status', optionalString(flags.status), TASK_STATUSES);
  if (status !== undefined) patch.status = status;
  const priority = validateEnum('priority', optionalString(flags.priority), TASK_PRIORITIES);
  if (priority !== undefined) patch.priority = priority;
  const description = optionalString(flags.description);
  if (description !== undefined) patch.description = description;
  const notes = optionalString(flags.notes);
  if (notes !== undefined) patch.notes = notes;
  const due = validateDate('due', optionalString(flags.due));
  if (due !== undefined) patch.dueDate = due;
  const planned = validateDate('planned', optionalString(flags.planned));
  if (planned !== undefined) patch.plannedFor = planned;
  const labels = parseLabels(flags.label);
  if (labels) patch.labels = labels;
  return patch;
}

export function appendNotes(existing, addition) {
  const base = String(existing ?? '').replace(/\s+$/, '');
  const extra = String(addition ?? '').trim();
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

// One PATCH. `appendNotes` reads the task first; the read-then-write window
// is the documented limitation (the route carries no revision precondition).
export async function updateTask(client, id, { patch = {}, appendNotes: addition } = {}) {
  if (!isTaskId(id)) throw new Error(`task update requires a task uuid (got "${id}").`);
  const body = { ...patch };
  if (addition !== undefined) {
    if (body.notes !== undefined) throw new Error('pass either --notes or --append-notes, not both.');
    const current = await client.getTask(id);
    if (!current) throw new Error(`task ${id} not found.`);
    body.notes = appendNotes(current.notes, addition);
  }
  if (Object.keys(body).length === 0) throw new Error('task update requires at least one field to change.');
  return client.patchTask(id, body);
}

export async function completeTask(client, id) {
  if (!isTaskId(id)) throw new Error(`task done requires a task uuid (got "${id}").`);
  return client.patchTask(id, { status: 'completed' }, { retryUnavailable: 'connect-only' });
}

// A checklist item by 1-based position or exact (case-insensitive) label.
export function resolveChecklistItem(items, selector) {
  const list = Array.isArray(items) ? items : [];
  const raw = String(selector ?? '').trim();
  if (!raw) throw new Error('name the checklist item by number or label.');
  if (/^\d+$/.test(raw)) {
    const index = Number(raw);
    if (index < 1 || index > list.length) throw new Error(`checklist item ${index} does not exist (the task has ${list.length}).`);
    return list[index - 1];
  }
  const matches = list.filter((item) => String(item.label).trim().toLowerCase() === raw.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`"${raw}" matches ${matches.length} checklist items; use its number.`);
  throw new Error(`no checklist item labelled "${raw}".`);
}

export async function setChecklistItem(client, taskId, selector, completed) {
  if (!isTaskId(taskId)) throw new Error(`task check requires a task uuid (got "${taskId}").`);
  const items = await client.listChecklist(taskId);
  const item = resolveChecklistItem(items, selector);
  const updated = await client.setChecklistItem(taskId, item.id, completed);
  return { item: updated, index: items.indexOf(item) + 1 };
}

// ---- output ---------------------------------------------------------------

function due(task) {
  if (!task.dueDate) return '';
  return task.dueTime ? `due ${task.dueDate} ${task.dueTime}` : `due ${task.dueDate}`;
}

export function formatTaskLine(task, { projectNames } = {}) {
  const bits = [`[${task.status}]`, task.title];
  const meta = [task.priority];
  if (task.plannedFor) meta.push(`planned ${task.plannedFor}`);
  if (due(task)) meta.push(due(task));
  if (Array.isArray(task.labels) && task.labels.length) meta.push(task.labels.map((l) => `@${l}`).join(' '));
  const project = projectNames?.get?.(task.projectId);
  if (project) meta.push(`#${project}`);
  return `${bits.join(' ')}  (${task.id})\n    ${meta.filter(Boolean).join(' · ')}`;
}

export function formatTaskList(tasks, opts) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 'No tasks.';
  return tasks.map((t) => formatTaskLine(t, opts)).join('\n');
}

export function formatTask(task, checklist = []) {
  if (!task) return 'Task not found.';
  const lines = [formatTaskLine(task)];
  if (task.description) lines.push('', task.description);
  if (Array.isArray(checklist) && checklist.length) {
    lines.push('', 'Checklist:');
    checklist.forEach((item, i) => lines.push(`  ${i + 1}. [${item.completed ? 'x' : ' '}] ${item.label}`));
  }
  if (task.notes) lines.push('', 'Notes:', task.notes);
  return lines.join('\n');
}
