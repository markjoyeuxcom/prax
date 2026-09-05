export async function fetchTasks(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const response = await fetch(`/api/tasks?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load tasks');
  return response.json();
}

export async function fetchTask(id) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('Failed to load task');
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
  if (!response.ok) {
    // Surface the status + server message: the capture retry flow must be
    // able to distinguish a permanent rejection (409 identity conflict,
    // 400 validation) from a transient failure where an unchanged retry is
    // genuinely safe.
    let message = 'Failed to create task';
    try {
      const payload = await response.json();
      if (payload?.message) message = payload.message;
    } catch { /* non-JSON error body */ }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// NL parsing (Tier-3 #8). Degraded results arrive as successful JSON with
// { degraded, reason } — callers branch on those; only transport errors throw.
// `signal` lets the caller abort (Esc / timeout) a slow model.
async function postNlParse(url, payload, { signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal,
  });
  if (!response.ok) {
    const p = await response.json().catch(() => null);
    throw new Error(p?.message || 'NL parse failed');
  }
  return response.json();
}

export function parseNlCapture(payload, opts) {
  return postNlParse('/api/tasks/nl-capture', payload, opts);
}

export function parseNlFilter(payload, opts) {
  return postNlParse('/api/tasks/nl-filter', payload, opts);
}

export async function importTasks({ project, mode = 'skip', tasks, format, version, requestId }) {
  const payload = {
    project,
    mode,
    tasks,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(version !== undefined ? { version } : {}),
  };
  async function send(url, method, data) {
    const response = await fetch(url, {method, headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const error = new Error(body?.message || 'Failed to import tasks');
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  const encoder = new TextEncoder();
  const threshold = 512 * 1024;
  if (!Array.isArray(tasks) || (tasks.length < 500 && encoder.encode(JSON.stringify(payload)).byteLength < threshold)) {
    return send('/api/tasks/import','POST',payload);
  }
  const id = requestId || globalThis.crypto.randomUUID();
  const root = '/api/tasks/import-sessions/' + encodeURIComponent(id);
  const chunks = [];
  let chunk = [], bytes = 12;
  for (const task of tasks) {
    const size = encoder.encode(JSON.stringify(task)).byteLength + 1;
    if (chunk.length && (chunk.length >= 200 || bytes + size > threshold)) {
      chunks.push(chunk); chunk = []; bytes = 12;
    }
    chunk.push(task); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  await send('/api/tasks/import-sessions','POST',{requestId:id,project,mode,...(format !== undefined ? {format} : {}),...(version !== undefined ? {version} : {})});
  // Replay every chunk even after a committed-session response. The server's
  // retained manifest must reject reuse of this identity with different data.
  for (let index=0; index<chunks.length; index++) await send(root + '/chunks/' + index,'PUT',{tasks:chunks[index]});
  return send(root + '/commit','POST',{chunkCount:chunks.length});
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

// Related-knowledge suggestions for the drawer. Advisory: always resolves
// ({ suggestions, degraded?, reason? }); the caller renders quiet degrade.
export async function fetchRelatedDocuments(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/related-documents`);
  if (!response.ok) return { suggestions: [], degraded: true, reason: 'search-failed' };
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

export async function fetchTaskChecklist(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/checklist`);
  if (!response.ok) throw new Error('Failed to load checklist');
  return response.json();
}

export async function fetchTaskActivity(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/activity`);
  if (!response.ok) throw new Error('Failed to load activity');
  return response.json();
}

export async function fetchTaskBoardExtras(taskIds = []) {
  const ids = [...new Set((Array.isArray(taskIds) ? taskIds : []).filter(Boolean))];
  if (!ids.length) return [];
  const params = new URLSearchParams({ ids: ids.join(',') });
  const response = await fetch(`/api/tasks/board-extras?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load board task summaries');
  return response.json();
}

export async function addChecklistItem(taskId, label) {
  const response = await fetch(`/api/tasks/${taskId}/checklist`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new Error('Failed to add checklist item');
  return response.json();
}

export async function setChecklistItem(taskId, itemId, completed) {
  const response = await fetch(`/api/tasks/${taskId}/checklist/${itemId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed }),
  });
  if (!response.ok) throw new Error('Failed to update checklist item');
  return response.json();
}

export async function deleteChecklistItem(taskId, itemId) {
  const response = await fetch(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete checklist item');
}
