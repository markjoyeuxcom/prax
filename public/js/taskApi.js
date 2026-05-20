export async function fetchTasks(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const response = await fetch(`/api/tasks?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load tasks');
  return response.json();
}

export async function exportTasks(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const response = await fetch(`/api/tasks/export?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to export tasks');
  return response.json();
}

export async function createTask(task) {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(task),
  });
  if (!response.ok) throw new Error('Failed to create task');
  return response.json();
}

export async function importTasks({ context, mode = 'skip', tasks }) {
  const response = await fetch('/api/tasks/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context, mode, tasks }),
  });
  if (!response.ok) throw new Error('Failed to import tasks');
  return response.json();
}

export async function updateTask(id, patch) {
  const response = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Failed to update task');
  return response.json();
}

export async function reorderTasks(tasks) {
  const response = await fetch('/api/tasks/reorder', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tasks }),
  });
  if (!response.ok) throw new Error('Failed to reorder tasks');
  return response.json();
}

export async function archiveTask(id) {
  const response = await fetch(`/api/tasks/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to archive task');
  return response.json();
}

export async function restoreTask(id) {
  const response = await fetch(`/api/tasks/${id}/restore`, {
    method: 'PATCH',
  });
  if (!response.ok) throw new Error('Failed to restore task');
  return response.json();
}

export async function deleteArchivedTask(id) {
  const response = await fetch(`/api/tasks/${id}/permanent`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete archived task');
  return response.json();
}

export async function fetchTaskDocuments(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/documents`);
  if (!response.ok) throw new Error('Failed to load linked documents');
  return response.json();
}

export async function linkTaskDocument(taskId, documentId) {
  const response = await fetch(`/api/tasks/${taskId}/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documentId }),
  });
  if (!response.ok) throw new Error('Failed to link document');
  return response.json();
}

export async function unlinkTaskDocument(taskId, documentId) {
  const response = await fetch(`/api/tasks/${taskId}/documents/${documentId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to unlink document');
  return response.json();
}
