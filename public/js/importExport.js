export function tasksFromImportPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.tasks)) return payload.tasks;
  throw new Error('TaskBoard import file must contain a tasks array');
}

export function exportFilename(context, date = new Date()) {
  const safeContext = String(context || 'tasks')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tasks';
  const day = date.toISOString().slice(0, 10);
  return `taskboard-${safeContext}-${day}.json`;
}
