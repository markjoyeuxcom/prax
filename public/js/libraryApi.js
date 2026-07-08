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

export async function deleteDocumentPermanently(id) {
  const response = await fetch(`/api/library/documents/${id}/permanent`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete document');
  return response.json();
}

export async function fetchDocumentLinks(id, direction = 'both') {
  const response = await fetch(`/api/library/documents/${id}/links?direction=${encodeURIComponent(direction)}`);
  if (!response.ok) throw new Error('Failed to load document links');
  return response.json();
}

// Non-archived tasks that reference this document — [{ id, title, priority, projectId }].
export async function fetchDocumentTaskBacklinks(id) {
  const response = await fetch(`/api/library/documents/${id}/tasks`);
  if (!response.ok) throw new Error('Failed to load document task backlinks');
  return response.json();
}

// Documents most similar to this one by embedding (empty when semantic search
// is off or the document has no embedding) — [{ id, title, similarity, ... }].
export async function fetchSimilarDocuments(id) {
  const response = await fetch(`/api/library/documents/${id}/similar`);
  if (!response.ok) throw new Error('Failed to load similar documents');
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

export async function fetchSemanticStatus() {
  const res = await fetch('/api/settings/semantic-search');
  if (!res.ok) throw new Error('Failed to load semantic search status');
  return res.json();
}

// Update the semantic-search provider configuration (backend/model/urls/key);
// same endpoint as the enabled toggle — the server merges and returns the
// fresh status shape.
export async function putSemanticSettings(patch) {
  const response = await fetch('/api/settings/semantic-search', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch || {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || 'Failed to update semantic settings');
  }
  return response.json();
}

export async function setSemanticEnabled(enabled) {
  const res = await fetch('/api/settings/semantic-search', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to update semantic search');
  return res.json();
}

export async function reindexEmbeddings(force = false) {
  const res = await fetch(`/api/library/embeddings/reindex${force ? '?force=true' : ''}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reindex');
  return res.json();
}

export async function semanticSearch(query, project) {
  const params = new URLSearchParams({ q: query });
  if (project && project !== 'all') params.set('project', project);
  const res = await fetch(`/api/library/documents/semantic-search?${params.toString()}`);
  if (!res.ok) throw new Error('Semantic search failed');
  return res.json();
}

// A library-wide "what do we know about X?" brief — the same query-scoped
// context pack the ask_library MCP tool uses, returned as Markdown for humans.
export async function fetchContextPack(query, project = 'all') {
  const params = new URLSearchParams({ q: query });
  if (project && project !== 'all') params.set('project', project);
  const res = await fetch(`/api/library/context-pack?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to build brief');
  return res.text();
}

// ---- Runbook execution (runs) ----------------------------------------------

export async function startRun(documentId, title = '') {
  const res = await fetch(`/api/library/documents/${documentId}/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to start run');
  return res.json();
}

export async function fetchRuns(documentId) {
  const res = await fetch(`/api/library/documents/${documentId}/runs`);
  if (!res.ok) throw new Error('Failed to load runs');
  return res.json();
}

export async function fetchRun(runId) {
  const res = await fetch(`/api/library/runs/${runId}`);
  if (!res.ok) throw new Error('Failed to load run');
  return res.json();
}

export async function setRunStep(runId, stepId, checked) {
  const res = await fetch(`/api/library/runs/${runId}/steps/${stepId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checked }),
  });
  if (!res.ok) throw new Error('Failed to update step');
  return res.json();
}

export async function setRunStatus(runId, status) {
  const res = await fetch(`/api/library/runs/${runId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Failed to update run');
  return res.json();
}

export async function verifyDocument(id, verified, as = 'user') {
  const response = await fetch(`/api/library/documents/${id}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verified, as }),
  });
  if (!response.ok) throw new Error('Failed to update verification');
  return response.json();
}

export async function supersedeDocument(id, supersededBy) {
  const response = await fetch(`/api/library/documents/${id}/supersede`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ supersededBy }),
  });
  if (!response.ok) throw new Error('Failed to supersede document');
  return response.json();
}
