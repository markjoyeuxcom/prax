export async function fetchProjects(status) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`/api/projects${qs}`);
  if (!response.ok) throw new Error('Failed to load projects');
  return response.json();
}

export async function createProject(name) {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error('Failed to create project');
  return response.json();
}

export async function updateProject(id, patch) {
  const response = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Failed to update project');
  return response.json();
}

export async function archiveProject(id) {
  const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to archive project');
  return response.json();
}

// Deletes the project and everything filed under it. A refusal carries the
// server's reason (e.g. the protected Memory project) so the UI can show it.
export async function deleteProjectPermanent(id) {
  const response = await fetch(`/api/projects/${id}/permanent`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || 'Failed to delete project');
  }
  return response.json();
}
