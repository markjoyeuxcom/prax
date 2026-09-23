// The Prax API as the MCP tools (and the in-app assistant, through
// server/assistant/injectClient.js) see it. Every method maps to one endpoint.
//
// How a request reaches Prax — discovery and pinning (no write failover), the
// token, agent and local-day headers, timeouts, error classes and the retry-
// safety rule — is the shared transport in server/praxTransport.js, which the
// prax CLI and the skills build on too, so the machine clients cannot drift
// apart. What stays here is the endpoint map and this client's response shape:
// 204 is null, a JSON body is parsed, any other body becomes { message }.
import { randomUUID } from 'node:crypto';
import { PraxApiError, PraxUnavailableError } from './errors.js';
import {
  createTransport, longTimeoutFromEnv, timeoutFromEnv, DEFAULT_LONG_TIMEOUT_MS, MCP_TIMEOUT_MS,
} from '../server/praxTransport.js';

export { DEFAULT_LONG_TIMEOUT_MS, longTimeoutFromEnv } from '../server/praxTransport.js';

async function parseResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

// Ordinary requests time out after MCP_TIMEOUT_MS (5 s, or PRAX_TIMEOUT_MS);
// Ask and the two generations wait on a chat model and get the long bound
// (DEFAULT_LONG_TIMEOUT_MS, or PRAX_MCP_TIMEOUT_MS). A bad setting is a
// configuration error reported at startup.
export function createPraxClient({
  baseUrl,
  env = process.env,
  // Unset: PRAX_API_TOKEN, then PRAX_TOKEN, then MOOMORA_API_TOKEN.
  token,
  fetch = globalThis.fetch,
  timeoutMs = timeoutFromEnv(env) ?? MCP_TIMEOUT_MS,
  longTimeoutMs = longTimeoutFromEnv(env) ?? DEFAULT_LONG_TIMEOUT_MS,
  // Which agent CLI runs this server (PRAX_AGENT or the CLIs' markers), sent
  // as x-prax-agent on agent writes; null for none (the in-app assistant).
  agent,
  portFile,
  readPortFile,
  // Send this process's calendar day (x-prax-local-date / x-prax-time-zone).
  // Off for the in-app assistant (server/assistant/injectClient.js): it runs
  // in the server, whose clock is not the user's, and forwards the
  // requester's own day instead.
  sendLocalDay = true,
  // Names this client's retrievals for the server's local recall telemetry
  // (librarian spec 2026-09-23): 'mcp' for the MCP server, 'assistant' for
  // the in-app assistant; null records nothing.
  querySource = 'mcp',
} = {}) {
  const transport = createTransport({
    baseUrl, env, portFile, readPortFile, token, agent, fetch, sendLocalDay, timeoutMs, longTimeoutMs,
  });

  // `headers: { 'x-prax-origin': 'agent' }` marks an agent write (the
  // transport adds x-prax-agent when known); `long` selects the chat-model
  // bound; `retryUnavailable` is the transport's retry rule.
  const request = (method, path, {
    query, body, headers, retryUnavailable = false, long = false,
  } = {}) => transport.request(method, path, {
    query, body, headers, long, retry: retryUnavailable, parse: parseResponse,
  });

  // Retrieval reads carry the source (and the agent origin, so the server
  // can attribute the query to the agent id); every other read does not.
  const retrievalHeaders = querySource
    ? { 'x-prax-query-source': querySource, 'x-prax-origin': 'agent' }
    : undefined;

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
      request('GET', '/api/library/documents', {
        query: { q, project, documentType, kind, status },
        ...(q ? { headers: retrievalHeaders } : {}),
      }),

    searchDocumentsSemantic: (query, project, { limit, offset } = {}) =>
      request('GET', '/api/library/documents/semantic-search', {
        query: { q: query, project, page: true, limit, offset }, headers: retrievalHeaders,
      }),

    // Query-scoped, library-wide context pack (Markdown). request() wraps the
    // non-JSON markdown body as { message }, so unwrap it to the raw string.
    contextPack: async ({ q, project, limit } = {}) => {
      const res = await request('GET', '/api/library/context-pack', { query: { q, project, limit }, headers: retrievalHeaders });
      return typeof res === 'string' ? res : (res?.message ?? '');
    },

    // Ask Prax: a grounded, cited answer synthesized from the context pack (or
    // the raw pack when no chat model is configured). Returns the JSON envelope
    // { query, answer, degraded, markdown, sources, model }.
    // Ask and the two generations wait on a chat model: they get the long
    // timeout (DEFAULT_LONG_TIMEOUT_MS, or PRAX_MCP_TIMEOUT_MS).
    ask: ({ q, project, limit } = {}) =>
      request('POST', '/api/library/ask', { body: { q, project, limit }, long: true }),

    // Generate a post-mortem document from a runbook run's chronicle. Returns
    // { document, generated, model }. Agent-authored → stamped agent-written.
    generatePostMortem: (runId, documentId) =>
      request('POST', `/api/library/runs/${runId}/post-mortem`, {
        body: documentId ? { id: documentId } : {},
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(documentId),
        long: true,
      }),

    // Generate a runbook from an alert/incident description. Returns
    // { document, model }. Requires a chat model configured on the server.
    generateRunbook: ({ description, project, id } = {}) =>
      request('POST', '/api/library/runbooks/generate', {
        body: { description, project, ...(id ? { id } : {}) },
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(id),
        long: true,
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
