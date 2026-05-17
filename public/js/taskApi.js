export async function fetchTasks(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const response = await fetch(`/api/tasks?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load tasks');
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

export async function updateTask(id, patch) {
  const response = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Failed to update task');
  return response.json();
}

export async function archiveTask(id) {
  const response = await fetch(`/api/tasks/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to archive task');
  return response.json();
}
