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

export async function importTasks({ context, tasks }) {
  const response = await fetch('/api/tasks/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context, tasks }),
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
