export async function fetchDocuments(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const response = await fetch(`/api/library/documents?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load documents');
  return response.json();
}

export async function createDocument(document) {
  const response = await fetch('/api/library/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  });
  if (!response.ok) throw new Error('Failed to create document');
  return response.json();
}

export async function updateDocument(id, patch) {
  const response = await fetch(`/api/library/documents/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Failed to update document');
  return response.json();
}

export async function archiveDocument(id) {
  const response = await fetch(`/api/library/documents/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to archive document');
  return response.json();
}

export async function restoreDocument(id) {
  const response = await fetch(`/api/library/documents/${id}/restore`, {
    method: 'PATCH',
  });
  if (!response.ok) throw new Error('Failed to restore document');
  return response.json();
}

export async function deleteArchivedDocument(id) {
  const response = await fetch(`/api/library/documents/${id}/permanent`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete archived document');
  return response.json();
}

export async function fetchDocumentLinks(id, direction = 'both') {
  const response = await fetch(`/api/library/documents/${id}/links?direction=${encodeURIComponent(direction)}`);
  if (!response.ok) throw new Error('Failed to load document links');
  return response.json();
}

export async function fetchStaleDocuments(project = '') {
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';
  const response = await fetch(`/api/library/maintenance/stale${qs}`);
  if (!response.ok) throw new Error('Failed to load stale documents');
  return response.json();
}

export async function fetchOrphanDocuments(project = '') {
  const qs = project ? `?project=${encodeURIComponent(project)}` : '';
  const response = await fetch(`/api/library/maintenance/orphans${qs}`);
  if (!response.ok) throw new Error('Failed to load orphan documents');
  return response.json();
}
