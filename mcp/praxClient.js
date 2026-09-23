import { PraxApiError, PraxUnavailableError } from './errors.js';
import { randomUUID } from 'node:crypto';
import { detectAgent, resolveBaseUrls, sanitizeAgentId } from '../server/instanceDiscovery.js';
import { localDayHeaders } from '../server/localDay.js';

const DEFAULT_TIMEOUT_MS = 5000;
// Generation and ask tools wait on a chat provider, which the server allows
// 120 s (and a local CLI provider queues behind other calls). Their requests
// get this much longer bound; PRAX_MCP_TIMEOUT_MS overrides it.
export const DEFAULT_LONG_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 2000;

// PRAX_MCP_TIMEOUT_MS as milliseconds, or undefined when unset. A value that
// is not a positive integer is a configuration error, reported at startup
// rather than silently replaced by the default.
export function longTimeoutFromEnv(env = process.env) {
  const raw = env.PRAX_MCP_TIMEOUT_MS;
  if (raw === undefined || raw === '') return undefined;
  const ms = Number(raw);
  if (!/^\d+$/.test(String(raw).trim()) || !Number.isSafeInteger(ms) || ms < 1) {
    throw new TypeError(`PRAX_MCP_TIMEOUT_MS must be a positive number of milliseconds (got "${raw}")`);
  }
  return ms;
}

function formatDuration(ms) {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

// Finding the app is the CLI's discovery (server/instanceDiscovery.js): an explicit
// baseUrl, else PRAX_API_URL, else the desktop app's saved loopback port, else
// the dev default. The first candidate that answers a read-only /readyz probe
// is pinned for the life of this process and every request — above all a
// write — goes only there, so a lost response can never land the same write in
// a second workspace (QINV-02). Until something answers, discovery is retried.
// PRAX_* are canonical; the MOOMORA_* fallbacks keep pre-rename setups working.
export function createPraxClient({
  baseUrl,
  env = process.env,
  token = env.PRAX_API_TOKEN || env.PRAX_TOKEN || env.MOOMORA_API_TOKEN,
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
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
} = {}) {
  // AbortSignal.timeout throws a synchronous TypeError for invalid delays
  // (negative/NaN/Infinity/out-of-range). Fail loudly as a config error here
  // rather than misclassifying it later as "API not reachable".
  for (const [name, value] of [['timeoutMs', timeoutMs], ['longTimeoutMs', longTimeoutMs]]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative finite number`);
    }
  }

  const agentId = agent === undefined ? detectAgent(env) : (agent === null ? null : sanitizeAgentId(agent));
  const explicit = baseUrl ? String(baseUrl).replace(/\/+$/, '') : null;
  const candidatesNow = () => (explicit
    ? [explicit]
    : resolveBaseUrls({ env, portFile, read: readPortFile }).map((url) => url.replace(/\/+$/, '')));
  // One candidate needs no probe: it is the only place a request can go.
  const initialCandidates = candidatesNow();
  let root = initialCandidates.length === 1 ? initialCandidates[0] : null;
  let discovery = null;

  // Pin an instance with a read-only probe, trying candidates in order (the
  // desktop port is re-read each time, in case the app started since).
  async function probe() {
    const candidates = candidatesNow();
    let lastError;
    for (const candidate of candidates) {
      try {
        await fetch(`${candidate}/readyz`, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        root ??= candidate;
        return;
      } catch (err) {
        lastError = err;
      }
    }
    // Nothing answered, so nothing was sent: no write outcome is in doubt.
    throw new PraxUnavailableError(`Prax API not reachable at ${candidates.join(' or ')} — is the app running? (${lastError?.message || 'no candidate answered'})`);
  }

  function ensureRoot() {
    if (root) return Promise.resolve();
    discovery ??= probe().finally(() => { discovery = null; });
    return discovery;
  }

  async function request(method, path, {
    query, body, headers: extraHeaders, retryUnavailable = false, timeoutMs: requestTimeoutMs = timeoutMs,
  } = {}) {
    await ensureRoot();
    const url = new URL(root + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    // The caller's calendar day (server/localDay.js): this process runs on the
    // person's machine, so completing a recurring task rolls forward from
    // their today even when Prax is a UTC container.
    const headers = sendLocalDay ? localDayHeaders() : {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (extraHeaders) Object.assign(headers, extraHeaders);
    // Say which agent wrote, alongside the agent origin (as the CLI does).
    if (headers['x-prax-origin'] === 'agent' && agentId) headers['x-prax-agent'] = agentId;

    let response;
    const attempts = retryUnavailable ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        // Requires native fetch (Node 17.3+). A non-native injected fetch may ignore `signal`, dropping the timeout.
        response = await fetch(url.toString(), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        break;
      } catch (err) {
        // A fetch rejection may follow a commit. Unreceipted writes retry only
        // proven pre-connection failures; receipt-backed writes can replay the
        // same operation. A timeout is never re-sent: Prax answered nothing,
        // but it may still be processing the request.
        const abortName = err?.name || err?.cause?.name;
        const timedOut = abortName === 'TimeoutError' || abortName === 'AbortError';
        const safeToRetry = retryUnavailable !== 'connect-only'
          || ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.cause?.code || err?.code);
        if (!timedOut && safeToRetry && attempt + 1 < attempts) continue;
        const error = new PraxUnavailableError(timedOut
          ? `Prax did not answer within ${formatDuration(requestTimeoutMs)} — the request may still be processing; it was not re-sent. (${err.message})`
          : `${['GET', 'HEAD'].includes(method) ? '' : 'Write outcome unknown; reconcile before retrying. '}Prax API not reachable at ${root} — is the server running? (${err.message})`);
        error.timedOut = timedOut;
        error.timeoutMs = timedOut ? requestTimeoutMs : undefined;
        throw error;
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
    // Ask and the two generations wait on a chat model: they get the long
    // timeout (DEFAULT_LONG_TIMEOUT_MS, or PRAX_MCP_TIMEOUT_MS).
    ask: ({ q, project, limit } = {}) =>
      request('POST', '/api/library/ask', { body: { q, project, limit }, timeoutMs: longTimeoutMs }),

    // Generate a post-mortem document from a runbook run's chronicle. Returns
    // { document, generated, model }. Agent-authored → stamped agent-written.
    generatePostMortem: (runId, documentId) =>
      request('POST', `/api/library/runs/${runId}/post-mortem`, {
        body: documentId ? { id: documentId } : {},
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(documentId),
        timeoutMs: longTimeoutMs,
      }),

    // Generate a runbook from an alert/incident description. Returns
    // { document, model }. Requires a chat model configured on the server.
    generateRunbook: ({ description, project, id } = {}) =>
      request('POST', '/api/library/runbooks/generate', {
        body: { description, project, ...(id ? { id } : {}) },
        headers: { 'x-prax-origin': 'agent' },
        retryUnavailable: Boolean(id),
        timeoutMs: longTimeoutMs,
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
