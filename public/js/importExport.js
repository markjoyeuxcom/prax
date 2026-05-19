export function tasksFromImportPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.tasks)) return payload.tasks;
  throw new Error('Moomora Console import file must contain a tasks array');
}

export function normalizeImportMode(value) {
  const mode = String(value || 'skip').trim().toLowerCase();
  if (mode === '' || mode === 'skip') return 'skip';
  if (mode === 'append') return 'append';
  if (mode === 'replace') return 'replace';
  throw new Error('Import mode must be append, skip, or replace');
}

export function duplicateKeyForTask(task) {
  return [
    String(task?.title || '').trim().toLowerCase(),
    String(task?.context || '').trim().toLowerCase(),
    String(task?.status || 'planned').trim().toLowerCase(),
    String(task?.dueDate || '').trim(),
  ].join('\u001f');
}

export function openTaskImportFilePicker({ documentRef = document, handleFile }) {
  const input = documentRef.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) handleFile(file);
  });
  input.click();
  return input;
}

export function exportFilename(context, date = new Date()) {
  const safeContext = String(context || 'tasks')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tasks';
  const day = date.toISOString().slice(0, 10);
  return `moomora-console-${safeContext}-${day}.json`;
}
