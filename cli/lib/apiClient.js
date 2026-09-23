// Thin HTTP client over the Prax API. No business logic — every method maps
// to one endpoint. Used by the prax CLI, the skill scripts and the bundled
// skill pack.
//
// How a request reaches Prax — discovery and pinning (no write failover), the
// token, agent and local-day headers, timeouts, error classes and the retry-
// safety rule — is the shared transport in server/praxTransport.js, which the
// MCP client builds on too, so the machine clients cannot drift apart. What
// stays here is the endpoint map and this client's response shape: a JSON
// body parsed as JSON, anything else (a Markdown context pack) as text.
import { randomUUID } from 'node:crypto';
import {
  createTransport, timeoutFromEnv, DEFAULT_TIMEOUT_MS, PROBE_TIMEOUT_MS,
} from '../../server/praxTransport.js';

export {
  DEFAULT_BASE_URL, desktopPortFile, detectAgent, readDesktopPort, resolveBaseUrls, sanitizeAgentId,
} from '../../server/instanceDiscovery.js';
export {
  DEFAULT_TIMEOUT_MS, PROBE_TIMEOUT_MS, PraxApiError, PraxUnavailableError, timeoutFromEnv, tokenFromEnv,
} from '../../server/praxTransport.js';
// The server's hard cap for one semantic-search page.
export const SEMANTIC_PAGE_MAX = 50;
// Paths per citation lookup. The server accepts up to 200; 50 keeps the
// request line well inside Node's 16 KiB header limit for long paths.
export const CODE_REF_PATHS_PER_REQUEST = 50;

// Retrieval sources the server's recall telemetry accepts. A read that names
// one is recorded (locally, in that workspace) with the agent id; one that
// names none is not. See docs/superpowers/specs/2026-09-23-librarian-design.md.
export const QUERY_SOURCES = Object.freeze(['recall', 'search', 'context']);

function querySourceHeaders(source) {
  return QUERY_SOURCES.includes(source)
    ? { 'x-prax-query-source': source, 'x-prax-origin': 'agent' }
    : undefined;
}

const parseResponse = (res) => ((res.headers.get('content-type') || '').includes('application/json')
  ? res.json()
  : res.text());

// Every request is bounded (DEFAULT_TIMEOUT_MS, 30 s, or PRAX_TIMEOUT_MS):
// nothing the CLI calls waits on a chat model, but recall, search and context
// embed the query and a local embedding model can take seconds to load cold.
export function createClient({
  baseUrl, token, agent, env = process.env, bases, fetch,
  timeoutMs = timeoutFromEnv(env) ?? DEFAULT_TIMEOUT_MS, probeTimeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const transport = createTransport({
    baseUrl, bases, env, token, agent, fetch, timeoutMs, probeTimeoutMs,
  });
  // `agent: true` marks an agent write (x-prax-origin, plus x-prax-agent when
  // known); `retryUnavailable` is the transport's retry rule (true for a
  // receipted operation, 'connect-only' for an idempotent unreceipted setter).
  const request = (method, path, {
    body, agent: agentWrite = false, accept, retryUnavailable = false, headers,
  } = {}) => transport.request(method, path, {
    body, agentWrite, accept, headers, retry: retryUnavailable, parse: parseResponse,
  });

  return {
    get base() { return transport.base; },
    candidates: transport.candidates,
    agent: transport.agent,
    contextPack(project, { query, format = 'md', limit, source } = {}) {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (format === 'json') params.set('format', 'json');
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return request('GET', `/api/projects/${encodeURIComponent(project)}/context-pack${qs ? `?${qs}` : ''}`,
        { accept: format === 'json' ? 'application/json' : 'text/markdown', headers: querySourceHeaders(source) });
    },
    keywordSearch(project, q, { all = false, source } = {}) {
      const params = new URLSearchParams({ q });
      if (project) params.set('project', project);
      if (!all) params.set('status', 'active');
      return request('GET', `/api/library/documents?${params.toString()}`, { headers: querySourceHeaders(source) });
    },
    // Paged mode so the response carries index coverage (`index`, `degraded`,
    // `reason: 'index-incomplete'`): the legacy array cannot say that pending
    // vectors were skipped, and a miss on an incomplete index is not an honest
    // miss. Older servers ignore `page` and return the array; normalise both.
    async semanticSearch(project, q, {
      all = false, limit = SEMANTIC_PAGE_MAX, offset = 0, mode, source,
    } = {}) {
      const params = new URLSearchParams({ q, page: 'true' });
      // Older servers have no `mode` and ignore the parameter, so asking for
      // hybrid is safe against any instance: it either fuses or it does not.
      if (mode) params.set('mode', String(mode));
      if (project) params.set('project', project);
      if (all) params.set('all', 'true');
      params.set('limit', String(Math.min(Math.max(Number(limit) || SEMANTIC_PAGE_MAX, 1), SEMANTIC_PAGE_MAX)));
      if (Number(offset) > 0) params.set('offset', String(Math.trunc(Number(offset))));
      const res = await request('GET', `/api/library/documents/semantic-search?${params.toString()}`, {
        headers: querySourceHeaders(source),
      });
      // A bare array is an older server that reports no coverage at all: that is
      // "unknown", and the label must survive normalisation so recall and search
      // never present such a miss as a complete one.
      if (Array.isArray(res)) return { items: res, page: null, index: null, degraded: false, reason: 'coverage-unknown', legacy: true };
      return {
        items: Array.isArray(res?.items) ? res.items : [],
        page: res?.page || null,
        index: res?.index || null,
        degraded: Boolean(res?.degraded),
        reason: res?.reason || null,
      };
    },
    getDocument(id) {
      return request('GET', `/api/library/documents/${encodeURIComponent(id)}`);
    },
    findByTitle(project, title) {
      const params = new URLSearchParams({ q: title });
      if (project) params.set('project', project);
      return request('GET', `/api/library/documents?${params.toString()}`);
    },
    createMemory(doc) {
      return request('POST', '/api/library/documents', {
        body: doc, agent: true, retryUnavailable: Boolean(doc?.id),
      });
    },
    // Atomic create-or-update by exact title within the project (server-side,
    // one transaction). Retry-safe when the caller supplies a stable id.
    upsertMemory(doc) {
      return request('POST', '/api/library/documents/upsert-by-title', {
        body: doc, agent: true, retryUnavailable: Boolean(doc?.id),
      });
    },
    async updateMemory(id, patch) {
      const operationId = patch?.operationId || randomUUID();
      const path = `/api/library/documents/${encodeURIComponent(id)}`;
      try {
        return await request('POST', `${path}/update`, {
          body: { ...patch, operationId }, agent: true, retryUnavailable: true,
        });
      } catch (error) {
        if (error.status !== 404) {
          if (!error.status) {
            error.message = `Update outcome unknown (operationId ${operationId}); reconcile before starting another update. ${error.message}`;
            error.operationId = operationId;
          }
          throw error;
        }
      }
      // A legacy server has no receipt endpoint. One PATCH only: a fetch
      // rejection can occur after commit, so it cannot authorize a resend.
      const { operationId: _operationId, ...legacyPatch } = patch;
      try {
        return await request('PATCH', path, { body: legacyPatch, agent: true });
      } catch (error) {
        if (!error.status) error.message = `Update outcome unknown on this older server; it was not re-sent. Check the document before retrying. ${error.message}`;
        throw error;
      }
    },
    verify(id, { verified, as, revision, contentHash } = {}) {
      return request('POST', `/api/library/documents/${encodeURIComponent(id)}/verify`, {
        body: { verified, as, ...(revision ? { revision } : {}), ...(contentHash ? { contentHash } : {}) }, retryUnavailable: 'connect-only',
      });
    },
    supersede(oldId, newId) {
      return request('POST', `/api/library/documents/${encodeURIComponent(oldId)}/supersede`, {
        body: { supersededBy: newId }, agent: true, retryUnavailable: 'connect-only',
      });
    },
    listProjects() {
      return request('GET', '/api/projects');
    },
    listCodeRefs(documentId) {
      return request('GET', `/api/library/documents/${encodeURIComponent(documentId)}/code-refs`);
    },
    addCodeRef(documentId, citation) {
      return request('POST', `/api/library/documents/${encodeURIComponent(documentId)}/code-refs`, {
        body: citation, agent: true, retryUnavailable: 'connect-only',
      });
    },
    // Citations on any of `paths` from live active documents (prax check),
    // batched CODE_REF_PATHS_PER_REQUEST at a time.
    async listCodeRefsByPath(paths, { project } = {}) {
      const unique = [...new Set(paths)];
      const items = [];
      for (let at = 0; at < unique.length; at += CODE_REF_PATHS_PER_REQUEST) {
        const params = new URLSearchParams();
        for (const path of unique.slice(at, at + CODE_REF_PATHS_PER_REQUEST)) params.append('path', path);
        if (project) params.set('project', project);
        const res = await request('GET', `/api/library/code-refs?${params.toString()}`);
        items.push(...(Array.isArray(res?.items) ? res.items : []));
      }
      return items;
    },
    // Lazy anchor backfill for a pre-0039 citation. Compare-and-set on the
    // server, so a retry that proves nothing reached it is safe.
    backfillCodeRefAnchors(documentId, refId, anchors) {
      return request('POST', `/api/library/documents/${encodeURIComponent(documentId)}/code-refs/${encodeURIComponent(refId)}/anchors`, {
        body: anchors, agent: true, retryUnavailable: 'connect-only',
      });
    },
    addExternalRef(documentId, { url, label } = {}) {
      return request('POST', `/api/library/documents/${encodeURIComponent(documentId)}/external-refs`, {
        body: { url, label }, agent: true, retryUnavailable: 'connect-only',
      });
    },
    updateProject(id, patch) {
      return request('PATCH', `/api/projects/${encodeURIComponent(id)}`, { body: patch });
    },
    async ensureProject(target) {
      const projects = await this.listProjects();
      const match = (Array.isArray(projects) ? projects : []).find(
        (p) => p.slug === target || (p.name && p.name.toLowerCase() === String(target).toLowerCase()),
      );
      if (match) return match.slug;
      try {
        const created = await request('POST', '/api/projects', { body: { name: target }, agent: true });
        return created.slug;
      } catch (error) {
        // A project name/slug is unique. If the create committed but its response
        // was lost (or another caller won the race), reconcile from the canonical list.
        try {
          const refreshed = await this.listProjects();
          const reconciled = (Array.isArray(refreshed) ? refreshed : []).find(
            (p) => p.slug === target || (p.name && p.name.toLowerCase() === String(target).toLowerCase()),
          );
          if (reconciled) return reconciled.slug;
        } catch { /* preserve the original, more relevant create error below */ }
        throw error;
      }
    },
    // ---- tasks (prax task …) ----------------------------------------------
    listTasks({ project, status, q } = {}) {
      const params = new URLSearchParams();
      if (project && project !== 'all') params.set('project', project);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const qs = params.toString();
      return request('GET', `/api/tasks${qs ? `?${qs}` : ''}`);
    },
    getTask(id) {
      return request('GET', `/api/tasks/${encodeURIComponent(id)}`);
    },
    // Exact-once when the payload carries a requestId: the server records the
    // result under it and replays it, so one lost response is safe to retry.
    importTasks(payload) {
      return request('POST', '/api/tasks/import', {
        body: payload, agent: true, retryUnavailable: Boolean(payload?.requestId),
      });
    },
    // No receipt on this route: one attempt unless the caller says the value
    // being set is idempotent ('connect-only' — a retry only when no request
    // provably reached the server).
    async patchTask(id, patch, { retryUnavailable = false } = {}) {
      try {
        return await request('PATCH', `/api/tasks/${encodeURIComponent(id)}`, {
          body: patch, agent: true, retryUnavailable,
        });
      } catch (error) {
        if (!error.status) error.message = `Task update outcome unknown; inspect the task before retrying. ${error.message}`;
        throw error;
      }
    },
    listChecklist(taskId) {
      return request('GET', `/api/tasks/${encodeURIComponent(taskId)}/checklist`);
    },
    setChecklistItem(taskId, itemId, completed) {
      return request('PATCH', `/api/tasks/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`, {
        body: { completed: Boolean(completed) }, agent: true, retryUnavailable: 'connect-only',
      });
    },
    // The Library export as rendered Markdown v3 in JSON (`prax mirror`).
    exportLibrary(project, { format = 'json', layout = 'mirror' } = {}) {
      const params = new URLSearchParams({ project, format, layout });
      return request('GET', `/api/library/export?${params.toString()}`, { accept: 'application/json' });
    },
    listTaskDocuments(taskId) {
      return request('GET', `/api/tasks/${encodeURIComponent(taskId)}/documents`);
    },
    // Advisory: always 200, `{ suggestions, degraded?, reason? }`.
    relatedTaskDocuments(taskId) {
      return request('GET', `/api/tasks/${encodeURIComponent(taskId)}/related-documents`);
    },
    // ---- the since-last-session delta ------------------------------------
    // Sent as an agent request so the server knows WHOSE marker to read; a
    // read, so it is never retried after it may have reached the server.
    memoryChanges({ since, sinceLastSession = false, project, limit } = {}) {
      const params = new URLSearchParams();
      if (sinceLastSession) params.set('sinceLastSession', 'true');
      else if (since) params.set('since', since);
      if (project) params.set('project', project);
      if (limit) params.set('limit', String(limit));
      return request('GET', `/api/library/changes?${params.toString()}`, { agent: true });
    },
    // A monotonic setter (the server keeps max(stored, at)), so it is retried
    // when no request provably reached the server.
    advanceRecallMarker({ project, at } = {}) {
      return request('PUT', '/api/library/recall-marker', {
        body: { at, ...(project ? { project } : {}) }, agent: true, retryUnavailable: 'connect-only',
      });
    },
    // ---- librarian (prax used / doctor / telemetry) -------------------------
    // A used signal is a setter of "this happened": re-sending it after a
    // lost response would count the use twice, so retry only when no request
    // reached the server.
    markUsed(documentId) {
      return request('POST', '/api/library/telemetry/used', {
        body: { documentId, source: 'cli' }, agent: true, retryUnavailable: 'connect-only',
      });
    },
    telemetryStatus() {
      return request('GET', '/api/library/telemetry');
    },
    clearTelemetry() {
      return request('DELETE', '/api/library/telemetry', { retryUnavailable: 'connect-only' });
    },
    librarianReport(project) {
      const qs = project ? `?${new URLSearchParams({ project }).toString()}` : '';
      return request('GET', `/api/library/librarian/report${qs}`);
    },
    listDocuments(project, { status } = {}) {
      const params = new URLSearchParams();
      if (project && project !== 'all') params.set('project', project);
      if (status) params.set('status', status);
      const qs = params.toString();
      return request('GET', `/api/library/documents${qs ? `?${qs}` : ''}`);
    },
  };
}
