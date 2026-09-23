// Thin HTTP client over the Prax API. No business logic — every method maps
// to one endpoint. Uses global fetch (Node 20+).
//
// Two things live here besides the endpoint map, because every caller (the
// prax CLI, the skill scripts, the bundled skill pack) needs them identically:
//   - finding the app: PRAX_API_URL, else the desktop app's saved loopback
//     port, else the dev default — tried in that order on connection failure;
//   - saying who is writing: x-prax-origin: agent on every memory write plus
//     x-prax-agent: <id> when the calling CLI is known (PRAX_AGENT, or the
//     markers Claude Code and Codex set in their shells).
// Both are the shared implementation in server/instanceDiscovery.js, which the
// MCP server uses too, so the machine clients cannot drift apart. Every request
// also carries the caller's calendar day (server/localDay.js), so completing a
// recurring task rolls forward from the person's today, not a UTC container's.
import { randomUUID } from 'node:crypto';
import { detectAgent, resolveBaseUrls, sanitizeAgentId } from '../../server/instanceDiscovery.js';
import { localDayHeaders } from '../../server/localDay.js';

export {
  DEFAULT_BASE_URL, desktopPortFile, detectAgent, readDesktopPort, resolveBaseUrls, sanitizeAgentId,
} from '../../server/instanceDiscovery.js';
// The server's hard cap for one semantic-search page.
export const SEMANTIC_PAGE_MAX = 50;
// Without a bound, a hung app stalls an agent's call for undici's five-minute
// header timeout. Nothing the CLI calls waits on a chat model (the MCP server's
// ask and generation tools do, and get its long timeout), but recall, search
// and context embed the query, and a local embedding model can take several
// seconds to load cold — hence 30 s rather than the MCP server's 5 s.
// PRAX_TIMEOUT_MS overrides it. The /readyz probe only has to be answered.
export const DEFAULT_TIMEOUT_MS = 30_000;
export const PROBE_TIMEOUT_MS = 2000;

// PRAX_TIMEOUT_MS as milliseconds, or undefined when unset. A value that is
// not a positive integer is a configuration error, reported rather than
// silently replaced by the default.
export function timeoutFromEnv(env = process.env) {
  const raw = env.PRAX_TIMEOUT_MS;
  if (raw === undefined || raw === '') return undefined;
  const ms = Number(raw);
  if (!/^\d+$/.test(String(raw).trim()) || !Number.isSafeInteger(ms) || ms < 1) {
    throw new TypeError(`PRAX_TIMEOUT_MS must be a positive number of milliseconds (got "${raw}")`);
  }
  return ms;
}

function formatDuration(ms) {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

function isTimeout(err) {
  const name = err?.name || err?.cause?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export function createClient({
  baseUrl, token, agent, env = process.env, bases,
  timeoutMs = timeoutFromEnv(env) ?? DEFAULT_TIMEOUT_MS, probeTimeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  // AbortSignal.timeout throws a synchronous TypeError for an invalid delay;
  // say which setting is wrong instead of reporting "not reachable" later.
  for (const [name, value] of [['timeoutMs', timeoutMs], ['probeTimeoutMs', probeTimeoutMs]]) {
    if (!Number.isFinite(value) || value < 1) throw new TypeError(`${name} must be a positive finite number`);
  }
  const candidates = bases || resolveBaseUrls({ baseUrl, env });
  let base = candidates[0];
  // Discovery binds this process to ONE instance. Until something has answered,
  // a read may probe every candidate; once pinned, every request — above all a
  // write — goes only there. A write never fails over: with the desktop app
  // gone and a dev server on :3000, silently landing the same remember in a
  // second workspace is worse than an honest "not reachable" (QINV-02).
  let pinned = candidates.length === 1;
  // One discovery for the whole process: every request that arrives before
  // the pin awaits the same probe, so concurrent first requests cannot each
  // discover a different instance, and nothing ever reassigns `base` once it
  // is set (a late probe completion cannot re-pin behind an in-flight write).
  let discovery = null;
  const agentId = agent === undefined ? detectAgent(env) : sanitizeAgentId(agent);
  const bearer = token ?? env.PRAX_TOKEN;

  function unreachable(lastError) {
    const where = pinned ? base : candidates.join(' or ');
    return new Error(`Prax not reachable at ${where} — is the app running? (${lastError.message})`);
  }

  // Pin an instance with a read-only probe, trying candidates in order.
  async function probe() {
    let lastError;
    for (const candidate of candidates) {
      try {
        await fetch(`${candidate}/readyz`, { method: 'GET', signal: AbortSignal.timeout(probeTimeoutMs) });
        if (!pinned) {
          base = candidate;
          pinned = true;
        }
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw unreachable(lastError);
  }

  function ensurePinned() {
    if (pinned) return Promise.resolve();
    if (!discovery) {
      discovery = probe().catch((err) => {
        discovery = null; // a failed discovery may be retried by a later request
        throw err;
      });
    }
    return discovery;
  }

  async function request(method, path, {
    body, agent: agentWrite = false, accept, retryUnavailable = false,
  } = {}) {
    const headers = localDayHeaders();
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (agentWrite) {
      headers['x-prax-origin'] = 'agent';
      if (agentId) headers['x-prax-agent'] = agentId;
    }
    if (accept) headers['accept'] = accept;
    if (bearer) headers['authorization'] = `Bearer ${bearer}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    await ensurePinned();
    // Only the pinned instance is ever contacted; a retry is a retry of the
    // SAME instance, never a search for another one.
    const target = base;
    let res; let lastError;
    const attempts = retryUnavailable ? 2 : 1;
    // One deadline covers the whole exchange, body included.
    const signal = AbortSignal.timeout(timeoutMs);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        res = await fetch(`${target}${path}`, { method, headers, body: payload, signal });
        break;
      } catch (err) {
        lastError = err;
        // A timeout is never re-sent: Prax answered nothing, but it may still
        // be processing the request.
        if (isTimeout(err)) break;
        // Unreceipted setters/links may only retry a failure that proves no
        // request reached the server. ECONNRESET or a generic fetch failure
        // can mean the response was lost after a successful commit.
        if (retryUnavailable === 'connect-only'
          && !['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.cause?.code || err?.code)) break;
      }
    }
    const write = !['GET', 'HEAD'].includes(method);
    const timedOut = (err) => {
      const error = new Error(`${write ? 'Write outcome unknown; reconcile before retrying. ' : ''}Prax at ${target} did not answer within ${formatDuration(timeoutMs)} — the request may still be processing; it was not re-sent. Set PRAX_TIMEOUT_MS to wait longer. (${err.message})`);
      error.timedOut = true;
      return error;
    };
    if (!res) {
      if (isTimeout(lastError)) throw timedOut(lastError);
      const error = unreachable(lastError);
      if (write) error.message = `Write outcome unknown; reconcile before retrying. ${error.message}`;
      throw error;
    }
    const ct = res.headers.get('content-type') || '';
    let parsed;
    try {
      parsed = ct.includes('application/json') ? await res.json() : await res.text();
    } catch (err) {
      // The status line arrived but the body stalled past the deadline.
      if (isTimeout(err)) throw timedOut(err);
      throw err;
    }
    if (!res.ok) {
      const message = parsed && parsed.message ? parsed.message : `HTTP ${res.status}`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return parsed;
  }

  return {
    get base() { return base; },
    candidates,
    agent: agentId,
    contextPack(project, { query, format = 'md', limit } = {}) {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (format === 'json') params.set('format', 'json');
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return request('GET', `/api/projects/${encodeURIComponent(project)}/context-pack${qs ? `?${qs}` : ''}`,
        { accept: format === 'json' ? 'application/json' : 'text/markdown' });
    },
    keywordSearch(project, q, { all = false } = {}) {
      const params = new URLSearchParams({ q });
      if (project) params.set('project', project);
      if (!all) params.set('status', 'active');
      return request('GET', `/api/library/documents?${params.toString()}`);
    },
    // Paged mode so the response carries index coverage (`index`, `degraded`,
    // `reason: 'index-incomplete'`): the legacy array cannot say that pending
    // vectors were skipped, and a miss on an incomplete index is not an honest
    // miss. Older servers ignore `page` and return the array; normalise both.
    async semanticSearch(project, q, { all = false, limit = SEMANTIC_PAGE_MAX, offset = 0, mode } = {}) {
      const params = new URLSearchParams({ q, page: 'true' });
      // Older servers have no `mode` and ignore the parameter, so asking for
      // hybrid is safe against any instance: it either fuses or it does not.
      if (mode) params.set('mode', String(mode));
      if (project) params.set('project', project);
      if (all) params.set('all', 'true');
      params.set('limit', String(Math.min(Math.max(Number(limit) || SEMANTIC_PAGE_MAX, 1), SEMANTIC_PAGE_MAX)));
      if (Number(offset) > 0) params.set('offset', String(Math.trunc(Number(offset))));
      const res = await request('GET', `/api/library/documents/semantic-search?${params.toString()}`);
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
    listDocuments(project, { status } = {}) {
      const params = new URLSearchParams();
      if (project && project !== 'all') params.set('project', project);
      if (status) params.set('status', status);
      const qs = params.toString();
      return request('GET', `/api/library/documents${qs ? `?${qs}` : ''}`);
    },
  };
}
