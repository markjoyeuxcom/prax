import { PraxApiError, PraxUnavailableError } from './errors.js';
import { randomUUID } from 'node:crypto';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 5000;

// PRAX_* are canonical; the MOOMORA_* fallbacks keep pre-rename setups working.
export function createPraxClient({
  baseUrl = process.env.PRAX_API_URL || process.env.MOOMORA_API_URL || DEFAULT_BASE_URL,
  token = process.env.PRAX_API_TOKEN || process.env.MOOMORA_API_TOKEN,
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // AbortSignal.timeout throws a synchronous TypeError for invalid delays
  // (negative/NaN/Infinity/out-of-range). Fail loudly as a config error here
  // rather than misclassifying it later as "API not reachable".
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError('timeoutMs must be a non-negative finite number');
  }

  const root = String(baseUrl).replace(/\/+$/, '');

  async function request(method, path, {
    query, body, headers: extraHeaders, retryUnavailable = false,
  } = {}) {
    const url = new URL(root + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (extraHeaders) Object.assign(headers, extraHeaders);

    let response;
    const attempts = retryUnavailable ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        // Requires native fetch (Node 17.3+). A non-native injected fetch may ignore `signal`, dropping the timeout.
        response = await fetch(url.toString(), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        break;
      } catch (err) {
        // A fetch rejection may follow a commit. Unreceipted writes retry only
        // proven pre-connection failures; receipt-backed writes can replay the
        // same operation. Timeouts retain the existing explicit-unknown path.
        const abortName = err?.name || err?.cause?.name;
        const timedOut = abortName === 'TimeoutError' || abortName === 'AbortError';
        const safeToRetry = retryUnavailable !== 'connect-only'
          || ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.cause?.code || err?.code);
        if (!timedOut && safeToRetry && attempt + 1 < attempts) continue;
        throw new PraxUnavailableError(timedOut
          ? `Prax API timed out after ${timeoutMs}ms — the request may still be processing; it was not re-sent. (${err.message})`
          : `${['GET', 'HEAD'].includes(method) ? '' : 'Write outcome unknown; reconcile before retrying. '}Prax API not reachable at ${root} — is the server running? (${err.message})`);
      }
    }

    if (response.status === 204) return null;

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      const message = (payload && payload.message) || `HTTP ${response.status}`;
      throw new PraxApiError(response.status, message);
    }
    return payload;
  }

  async function patchOrNull(path, patch, headers, retryUnavailable = false) {
    try {
      return await request('PATCH', path, { body: patch, headers, retryUnavailable });
    } catch (err) {
      if (err instanceof PraxApiError && err.status === 404) return null;
      throw err;
    }
  }

  async function getOrNull(path) {
    try {
      return await request('GET', path);
    } catch (err) {
      if (err instanceof PraxApiError && err.status === 404) return null;
      throw err;
    }
  }

  return {
    listDocuments: ({ q, project, documentType, kind, status } = {}) =>
      request('GET', '/api/library/documents', { query: { q, project, documentType, kind, status } }),

    searchDocumentsSemantic: (query, project, { limit, offset } = {}) =>
      request('GET', '/api/library/documents/semantic-search', {
        query: { q: query, project, page: true, limit, offset },
      }),

    // Query-scoped, library-wide context pack (Markdown). request() wraps the
    // non-JSON markdown body as { message }, so unwrap it to the raw string.
    contextPack: async ({ q, project, limit } = {}) => {
      const res = await request('GET', '/api/library/context-pack', { query: { q, project, limit } });
      return typeof res === 'string' ? res : (res?.message ?? '');
    },

    // Ask Prax: a grounded, cited answer synthesized from the context pack (or
    // the raw pack when no chat model is configured). Returns the JSON envelope
    // { query, answer, degraded, markdown, sources, model }.
    ask: ({ q, project, limit } = {}) =>
      request('POST', '/api/library/ask', { body: { q, project, limit } }),

    // Generate a post-mortem document from a runbook run's chronicle. Returns
    // { document, generated, model }. Agent-authored → stamped agent-written.
    generatePostMortem: (runId, documentId) =>
      request('POST', `/api/library/runs/${runId}/post-mortem`, {
        body: documentId ? { id: documentId } : {},
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(documentId),
      }),

    // Generate a runbook from an alert/incident description. Returns
    // { document, model }. Requires a chat model configured on the server.
    generateRunbook: ({ description, project, id } = {}) =>
      request('POST', '/api/library/runbooks/generate', {
        body: { description, project, ...(id ? { id } : {}) },
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(id),
      }),

    getDocument: (id) => getOrNull(`/api/library/documents/${id}`),

    createDocument: (payload) =>
      request('POST', '/api/library/documents', {
        body: payload,
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(payload?.id),
      }),

    async updateDocument(id, patch) {
      const operationId = patch?.operationId || randomUUID();
      const path = `/api/library/documents/${id}`;
      try {
        return await request('POST', `${path}/update`, {
          body: { ...patch, operationId }, headers: { 'x-prax-origin': 'agent' }, retryUnavailable: true,
        });
      } catch (error) {
        if (!(error instanceof PraxApiError) || error.status !== 404) {
          if (error instanceof PraxUnavailableError) error.message = `Update outcome unknown (operationId ${operationId}); reconcile before starting another update. ${error.message}`;
          throw error;
        }
      }
      const { operationId: _operationId, ...legacyPatch } = patch;
      try {
        return await patchOrNull(path, legacyPatch, { 'x-prax-origin': 'agent' });
      } catch (error) {
        if (error instanceof PraxUnavailableError) error.message = `Update outcome unknown on this older server; it was not re-sent. Check the document before retrying. ${error.message}`;
        throw error;
      }
    },

    listTasks: ({ q, project, status } = {}) =>
      request('GET', '/api/tasks', { query: { q, project, status } }),

    listProjects: () => request('GET', '/api/projects', {}),

    getTask: (id) => getOrNull(`/api/tasks/${id}`),

    createTask: (payload) =>
      request('POST', '/api/tasks', {
        body: payload,
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(payload?.id),
      }),

    updateTask: (id, patch) =>
      patchOrNull(`/api/tasks/${id}`, patch, { 'x-prax-origin': 'agent' }, 'connect-only'),

    listTaskDocuments: (taskId) =>
      request('GET', `/api/tasks/${taskId}/documents`, {}),

    linkTaskDocument: (taskId, documentId) =>
      request('POST', `/api/tasks/${taskId}/documents`, {
        body: { documentId }, headers: { 'x-prax-origin': 'agent' }, retryUnavailable: 'connect-only',
      }),

    unlinkTaskDocument: (taskId, documentId) =>
      request('DELETE', `/api/tasks/${taskId}/documents/${documentId}`, {
        headers: { 'x-prax-origin': 'agent' }, retryUnavailable: 'connect-only',
      }),

    listDocumentLinks: (documentId, direction) =>
      request('GET', `/api/library/documents/${documentId}/links`, { query: { direction } }),

    listStaleDocuments: (project) =>
      request('GET', '/api/library/maintenance/stale', { query: { project } }),

    linkDocuments: (sourceId, targetId, relation) =>
      request('POST', `/api/library/documents/${sourceId}/links`, {
        body: { targetId, relation }, headers: { 'x-prax-origin': 'agent' }, retryUnavailable: 'connect-only',
      }),

    unlinkDocuments: (sourceId, targetId, relation) =>
      request('DELETE', `/api/library/documents/${sourceId}/links/${targetId}`, {
        query: { relation }, headers: { 'x-prax-origin': 'agent' }, retryUnavailable: 'connect-only',
      }),

    listExternalRefs: (documentId) =>
      request('GET', `/api/library/documents/${documentId}/external-refs`),

    addExternalRef: (documentId, url, label) =>
      request('POST', `/api/library/documents/${documentId}/external-refs`, {
        body: { url, label },
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: 'connect-only',
      }),

    removeExternalRef: (documentId, refId) =>
      request('DELETE', `/api/library/documents/${documentId}/external-refs/${refId}`, {
        headers: { 'x-prax-origin': 'agent' }, retryUnavailable: 'connect-only',
      }),

    supersedeDocument: (id, supersededBy) =>
      request('POST', `/api/library/documents/${id}/supersede`, {
        body: { supersededBy },
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: 'connect-only',
      }),

    listChecklist: (taskId) =>
      request('GET', `/api/tasks/${taskId}/checklist`, {}),

    addChecklistItem: (taskId, label, itemId) =>
      request('POST', `/api/tasks/${taskId}/checklist`, {
        body: { label, ...(itemId ? { id: itemId } : {}) },
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(itemId),
      }),

    setChecklistItem: (taskId, itemId, completed) =>
      request('PATCH', `/api/tasks/${taskId}/checklist/${itemId}`, {
        body: { completed }, headers: { 'x-prax-origin': 'agent' }, retryUnavailable: 'connect-only',
      }),

    deleteChecklistItem: (taskId, itemId) =>
      request('DELETE', `/api/tasks/${taskId}/checklist/${itemId}`, {
        headers: { 'x-prax-origin': 'agent' }, retryUnavailable: 'connect-only',
      }),

    listTaskActivity: (taskId) =>
      request('GET', `/api/tasks/${taskId}/activity`, {}),

    // ---- Runbook execution (runs) ----
    // Writes stamp the agent as the actor via x-prax-origin; getRunbookRun /
    // setRunStep / setRunStatus null-coalesce a 404 so the tools can message it.
    startRunbookRun: (documentId, title, runId) =>
      request('POST', `/api/library/documents/${documentId}/runs`, {
        body: { title, ...(runId ? { id: runId } : {}) }, headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(runId),
      }),

    listRunbookRuns: (documentId) =>
      request('GET', `/api/library/documents/${documentId}/runs`, {}),

    getRunbookRun: (runId) => getOrNull(`/api/library/runs/${runId}`),

    setRunStep: (runId, stepId, checked) =>
      patchOrNull(`/api/library/runs/${runId}/steps/${stepId}`, { checked }, { 'x-prax-origin': 'agent' }, 'connect-only'),

    setRunStatus: (runId, status) =>
      patchOrNull(`/api/library/runs/${runId}`, { status }, { 'x-prax-origin': 'agent' }, 'connect-only'),
  };
}
