import { normalizeLabels } from './labels.js';

function nullable(value) {
  return value === '' || value === undefined || value === null ? null : value;
}

export function canonicalTaskCreatePayload(payload = {}) {
  return {
    ...(payload.id ? { id: String(payload.id) } : {}),
    title: String(payload.title ?? '').trim(),
    description: String(payload.description ?? '').trim(),
    notes: String(payload.notes ?? '').trim(),
    priority: payload.priority,
    status: payload.status,
    project: String(payload.project ?? ''),
    dueDate: nullable(payload.dueDate),
    dueTime: nullable(payload.dueTime),
    recurrence: nullable(payload.recurrence),
    labels: normalizeLabels(payload.labels),
    sortOrder: Number.isInteger(payload.sortOrder) ? payload.sortOrder : 0,
  };
}

export function taskMatchesCreatePayload(task, payload) {
  if (!task || !payload) return false;
  const expected = canonicalTaskCreatePayload(payload);
  return (!expected.id || task.id === expected.id)
    && task.title === expected.title
    && (task.description || '') === expected.description
    && (task.notes || '') === expected.notes
    && task.priority === expected.priority
    && task.status === expected.status
    && task.projectId === expected.project
    && (task.dueDate || null) === expected.dueDate
    && (task.dueTime || null) === expected.dueTime
    && (task.recurrence || null) === expected.recurrence
    && Array.isArray(task.labels)
    && task.labels.length === expected.labels.length
    && task.labels.every((label, index) => label === expected.labels[index])
    && task.sortOrder === expected.sortOrder;
}
