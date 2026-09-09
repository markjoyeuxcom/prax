export async function fetchDocuments(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const response = await fetch(`/api/library/documents?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load documents');
  return response.json();
}

export async function fetchDocument(id) {
  const response = await fetch(`/api/library/documents/${id}`);
  if (!response.ok) {
    const error = new Error('Failed to load document');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function createDocument(document) {
  const response = await fetch('/api/library/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || 'Failed to create document');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function updateDocument(id, patch) {
  const response = await fetch(`/api/library/documents/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || 'Failed to update document');
    error.status = response.status;
    error.reason = payload?.reason;
    error.document = payload?.document;
    throw error;
  }
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

export async function unlinkDocuments(sourceId, targetId, relation) {
  const response = await fetch(`/api/library/documents/${sourceId}/links/${targetId}?relation=${encodeURIComponent(relation)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to unlink documents');
  return response.json();
}

// External references — [{ id, documentId, url, label, createdAt }].
export async function fetchExternalRefs(id) {
  const response = await fetch(`/api/library/documents/${id}/external-refs`);
  if (!response.ok) throw new Error('Failed to load external references');
  return response.json();
}

export async function addExternalRef(id, { url, label }) {
  const response = await fetch(`/api/library/documents/${id}/external-refs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, label }),
  });
  if (!response.ok) { const p = await response.json().catch(() => null); throw new Error(p?.message || 'Failed to add reference'); }
  return response.json();
}

export async function removeExternalRef(id, refId) {
  const response = await fetch(`/api/library/documents/${id}/external-refs/${refId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to remove reference');
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

export async function fetchDeploymentStatus() {
  const response = await fetch('/api/settings/deployment');
  if (!response.ok) throw new Error('Failed to load deployment security status');
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
    const error = new Error(payload?.message || 'Failed to update semantic settings');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// Chat (AI-answers) provider status + configuration — the generation-side twin
// of the semantic-search settings.
export async function fetchChatStatus() {
  const res = await fetch('/api/settings/ai-answers');
  if (!res.ok) throw new Error('Failed to load AI answers status');
  return res.json();
}

export async function putChatSettings(patch) {
  const response = await fetch('/api/settings/ai-answers', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch || {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || 'Failed to update AI answers settings');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// Google Calendar integration — status / settings / connect / sync / disconnect.
// Desktop capture shortcut: stored server-side (app_settings) so it travels
// with backups; the shell re-registers live via IPC after a save.
export async function fetchCaptureShortcut() {
  const response = await fetch('/api/settings/capture-shortcut');
  if (!response.ok) throw new Error('could not load the capture shortcut');
  return response.json();
}

export async function saveCaptureShortcut(shortcut) {
  const response = await fetch('/api/settings/capture-shortcut', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shortcut }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || 'could not save the capture shortcut');
  }
  return response.json();
}

// Weekly review: compiles the week into an idempotent Library doc. Returns
// { documentId, created|updated, weekId, stats } or { degraded, reason }.
export async function generateWeeklyReview(options = {}) {
  const response = await fetch('/api/library/weekly-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) throw new Error('weekly review failed');
  return response.json();
}

// Status is { configured, connected, calendarId, accountEmail, lastSyncAt,
// lastSyncSummary, hasClientSecret } — the client secret is write-only and
// never returned. Sync failures come back 200 { degraded, reason, message }.
export async function fetchGoogleCalendarStatus() {
  const res = await fetch('/api/integrations/google-calendar');
  if (!res.ok) throw new Error('Failed to load Google Calendar status');
  return res.json();
}

export async function putGoogleCalendarSettings(patch) {
  const response = await fetch('/api/integrations/google-calendar/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch || {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || 'Failed to update Google Calendar settings');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// Begins the OAuth consent flow: returns { authUrl } to open in a browser tab.
// 409 (not configured yet) throws with the server's actionable message.
export async function connectGoogleCalendar() {
  const response = await fetch('/api/integrations/google-calendar/connect', { method: 'POST' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || 'Failed to start the Google sign-in');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// One-way push of open dated tasks. Returns { pushed, removed, failed,
// failures, summary, degraded?, reason?, message? } — partial failure is
// reported as degraded, never as clean success.
export async function syncGoogleCalendar() {
  const res = await fetch('/api/integrations/google-calendar/sync', { method: 'POST' });
  if (!res.ok) throw new Error('Google Calendar sync failed');
  return res.json();
}

export async function disconnectGoogleCalendar() {
  const res = await fetch('/api/integrations/google-calendar/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to disconnect Google Calendar');
  return res.json();
}

export async function setSemanticEnabled(enabled) {
  const res = await fetch('/api/settings/semantic-search', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const error = new Error(payload?.message || 'Failed to update semantic search');
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function reindexEmbeddings(force = false) {
  const res = await fetch(`/api/library/embeddings/reindex${force ? '?force=true' : ''}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reindex');
  return res.json();
}

export async function semanticSearch(query, project, { limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ q: query });
  if (project && project !== 'all') params.set('project', project);
  params.set('page', 'true');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const res = await fetch(`/api/library/documents/semantic-search?${params.toString()}`);
  if (!res.ok) throw new Error('Semantic search failed');
  return res.json();
}

// Ask Prax: a grounded, cited answer over the library. Returns the JSON envelope
// { query, answer, degraded, reason, markdown, sources, model } — answer is null
// (degraded) when no chat model is configured or generation failed, in which
// case `markdown` carries the retrieved context pack instead.
export async function askPrax(query, project = 'all') {
  const body = { q: query };
  if (project && project !== 'all') body.project = project;
  const res = await fetch('/api/library/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to get an answer');
  return res.json();
}

// ---- Runbook execution (runs) ----------------------------------------------

async function throwRunApiError(response, fallback) {
  const payload = await response.json().catch(() => null);
  const error = new Error(payload?.message || fallback);
  error.status = response.status;
  error.reason = payload?.reason || null;
  throw error;
}

export async function startRun(documentId, title = '', id = null) {
  const body = { title };
  if (id) body.id = id;
  const res = await fetch(`/api/library/documents/${documentId}/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) return throwRunApiError(res, 'Failed to start run');
  return res.json();
}

export async function fetchRuns(documentId) {
  const res = await fetch(`/api/library/documents/${documentId}/runs`);
  if (!res.ok) throw new Error('Failed to load runs');
  return res.json();
}

export async function fetchRun(runId) {
  const res = await fetch(`/api/library/runs/${runId}`);
  if (!res.ok) return throwRunApiError(res, 'Failed to load run');
  return res.json();
}

export async function setRunStep(runId, stepId, checked) {
  const res = await fetch(`/api/library/runs/${runId}/steps/${stepId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checked }),
  });
  if (!res.ok) return throwRunApiError(res, 'Failed to update step');
  return res.json();
}

export async function setRunStatus(runId, status) {
  const res = await fetch(`/api/library/runs/${runId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
  });
  if (!res.ok) return throwRunApiError(res, 'Failed to update run');
  return res.json();
}

// Generate a post-mortem doc from a run's chronicle (agent-written, unverified).
// Returns { document, generated, model } — generated=false means the fallback
// template was used (no chat model configured or generation failed).
export async function createPostMortem(runId) {
  const res = await fetch(`/api/library/runs/${runId}/post-mortem`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to generate the post-mortem');
  return res.json();
}

// Generate a runbook from an incident/alert description. Returns { document,
// model }. Throws with the server's message (e.g. "no AI model is configured")
// so the panel can surface why it failed.
// Narrate a structured daily brief into a stand-up. Returns { narrative, model,
// degraded } — narrative is null (degraded) when no chat model is configured.
export async function narrateBrief(text) {
  const res = await fetch('/api/brief/narrate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error('Failed to narrate the brief');
  return res.json();
}

// Library health: docs needing attention (needsReview / empty / stale + counts).
export async function fetchHealth(project = '') {
  const params = project && project !== 'all' ? `?project=${encodeURIComponent(project)}` : '';
  const res = await fetch(`/api/library/health${params}`);
  if (!res.ok) throw new Error('Failed to load library health');
  return res.json();
}

// Auto wiki-link suggestions: plain-text title mentions that aren't yet linked.
export async function fetchLinkSuggestions(project = '') {
  const params = project && project !== 'all' ? `?project=${encodeURIComponent(project)}` : '';
  const res = await fetch(`/api/library/health/link-suggestions${params}`);
  if (!res.ok) throw new Error('Failed to load link suggestions');
  return res.json();
}

// On-demand AI review of the library: contradiction + coverage-gap scan. Returns
// the advisory envelope { contradictions, gaps, contradictionScan, gapScan, model,
// degraded, reason, stats }. Never 409/500 on the AI path — only a 400 for a bad
// project throws here.
export async function runAiReview(project = '') {
  const body = project && project !== 'all' ? { project } : {};
  const res = await fetch('/api/library/health/ai-review', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to run AI review');
  return res.json();
}

// Editor writing action (draft/summarize/rewrite/checklist). Stateless text
// transform — returns { text, model, degraded, reason }. Never mutates a doc.
export async function runWritingAction(payload) {
  const res = await fetch('/api/library/writing-action', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const p = await res.json().catch(() => null);
    throw new Error(p?.message || 'Writing action failed');
  }
  return res.json();
}

// Accept a suggestion: link the first plain mention of `title` in the doc's body.
export async function applyWikiLink(documentId, title) {
  const res = await fetch(`/api/library/documents/${documentId}/wiki-link`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.message || 'Failed to add the link');
  }
  return res.json();
}

export async function generateRunbook(description, project) {
  const res = await fetch('/api/library/runbooks/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description, project }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.message || 'Failed to generate the runbook');
  }
  return res.json();
}

// ---- AI assistant (agentic tool-calling chat) ------------------------------

// Provider status for the assistant: { available, model, backend, supportsTools, toolCount }.
export async function fetchAssistantStatus() {
  const res = await fetch('/api/assistant/status');
  if (!res.ok) throw new Error('Failed to load assistant status');
  return res.json();
}

// Drive one assistant turn. `messages` is the full canonical conversation
// (user/assistant/tool turns); `decisions` (optional) approves/declines the
// writes proposed in a suspended tail turn. Returns the envelope
// { status, messages, answer?/pending?, model, degraded?, reason? } where status
// is 'done' | 'awaiting_confirmation' | 'no_model' | 'error'.
export async function assistantChat(messages, decisions = null) {
  const body = { messages };
  if (decisions) body.decisions = decisions;
  const res = await fetch('/api/assistant/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.message || 'The assistant request failed');
  }
  return res.json();
}

export async function verifyDocument(id, verified, as = 'user', revision = null) {
  const response = await fetch(`/api/library/documents/${id}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verified, as, ...(verified && revision ? { revision } : {}) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || 'Failed to update verification');
    error.status = response.status;
    throw error;
  }
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
