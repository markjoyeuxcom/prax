const NULLABLE_FIELDS = new Set(['dueDate', 'dueTime', 'deferredUntil', 'recurrence', 'plannedFor']);
const OBSERVABLE_FIELDS = new Set([
  'title', 'description', 'notes', 'priority', 'status', 'dueDate', 'dueTime',
  'deferredUntil', 'recurrence', 'labels', 'sortOrder', 'project', 'plannedFor',
]);

function equivalent(field, observed, requested) {
  if (NULLABLE_FIELDS.has(field)) return (observed || null) === (requested || null);
  if (field === 'labels') {
    return Array.isArray(observed) && Array.isArray(requested)
      && observed.length === requested.length
      && observed.every((value, index) => value === requested[index]);
  }
  return observed === requested;
}

export function taskMatchesPatch(task, patch) {
  const entries = Object.entries(patch || {});
  return Boolean(task) && entries.length > 0 && entries.every(([field, requested]) => (
    OBSERVABLE_FIELDS.has(field)
      && equivalent(field, field === 'project' ? task.projectId : task[field], requested)
  ));
}
