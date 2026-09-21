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
import { readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
// The server's hard cap for one semantic-search page.
export const SEMANTIC_PAGE_MAX = 50;
// Tauri bundle identifier — the desktop app's app-data directory is named after it.
const DESKTOP_IDENTIFIER = 'com.moomora.prax';
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function sanitizeAgentId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return AGENT_ID_RE.test(id) ? id : null;
}

// Which agent CLI is running this process. An explicit PRAX_AGENT wins; then
// the environment markers the CLIs set for their tool shells. Null when unknown
// — the server then records the write as an anonymous agent, never as a guess.
export function detectAgent(env = process.env) {
  if (env.PRAX_AGENT) return sanitizeAgentId(env.PRAX_AGENT);
  if (env.CLAUDECODE) return 'claude';
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return 'codex';
  if (env.COPILOT_CLI || env.COPILOT_AGENT_SESSION_ID) return 'copilot';
  if (env.ANTIGRAVITY_AGENT || env.ANTIGRAVITY_CONVERSATION_ID) return 'antigravity';
  return null;
}

// The desktop app picks a free loopback port on first launch and persists it in
// `webview-port` under Tauri's app_data_dir (see src-tauri/src/lib.rs).
export function desktopPortFile({ env = process.env, os = platform(), home = homedir() } = {}) {
  if (os === 'darwin') return join(home, 'Library', 'Application Support', DESKTOP_IDENTIFIER, 'webview-port');
  if (os === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), DESKTOP_IDENTIFIER, 'webview-port');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), DESKTOP_IDENTIFIER, 'webview-port');
}

export function readDesktopPort(file, read = readFileSync) {
  try {
    const port = Number(String(read(file, 'utf8')).trim());
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

// Candidate base URLs, most specific first. An explicit URL is authoritative
// (no fallback — a wrong URL must fail loudly, not silently hit another app).
export function resolveBaseUrls({ baseUrl, env = process.env, portFile, read } = {}) {
  // MOOMORA_API_URL is the pre-rename env var; still honoured so existing setups keep working.
  const explicit = baseUrl || env.PRAX_API_URL || env.MOOMORA_API_URL;
  if (explicit) return [String(explicit).replace(/\/$/, '')];
  const urls = [];
  const port = readDesktopPort(portFile || desktopPortFile({ env }), read);
  if (port) urls.push(`http://127.0.0.1:${port}`);
  urls.push(DEFAULT_BASE_URL);
  return urls;
}

export function createClient({ baseUrl, token, agent, env = process.env, bases } = {}) {
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
        await fetch(`${candidate}/readyz`, { method: 'GET' });
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
    const headers = {};
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
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        res = await fetch(`${target}${path}`, { method, headers, body: payload });
        break;
      } catch (err) {
        lastError = err;
        // Unreceipted setters/links may only retry a failure that proves no
        // request reached the server. ECONNRESET or a generic fetch failure
        // can mean the response was lost after a successful commit.
        if (retryUnavailable === 'connect-only'
          && !['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.cause?.code || err?.code)) break;
      }
    }
    if (!res) {
      const error = unreachable(lastError);
      if (!['GET', 'HEAD'].includes(method)) error.message = `Write outcome unknown; reconcile before retrying. ${error.message}`;
      throw error;
    }
    const ct = res.headers.get('content-type') || '';
    const parsed = ct.includes('application/json') ? await res.json() : await res.text();
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
