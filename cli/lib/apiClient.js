// Thin HTTP client over the Prax API. No business logic — every method maps
// to one endpoint. Uses global fetch (Node 20+).
export function createClient({ baseUrl, token } = {}) {
  // MOOMORA_API_URL is the pre-rename env var; still honoured so existing setups keep working.
  const base = (baseUrl || process.env.PRAX_API_URL || process.env.MOOMORA_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

  async function request(method, path, {
    body, agent = false, accept, retryUnavailable = false,
  } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (agent) headers['x-prax-origin'] = 'agent';
    if (accept) headers['accept'] = accept;
    if (token) headers['authorization'] = `Bearer ${token}`;
    let res;
    const attempts = retryUnavailable ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        res = await fetch(`${base}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        break;
      } catch (err) {
        if (attempt + 1 < attempts) continue;
        throw new Error(`Prax not reachable at ${base} — is the app running? (${err.message})`);
      }
    }
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const message = payload && payload.message ? payload.message : `HTTP ${res.status}`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return payload;
  }

  return {
    base,
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
    semanticSearch(project, q, { all = false } = {}) {
      const params = new URLSearchParams({ q });
      if (project) params.set('project', project);
      if (all) params.set('all', 'true');
      return request('GET', `/api/library/documents/semantic-search?${params.toString()}`);
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
    updateMemory(id, patch) {
      return request('PATCH', `/api/library/documents/${encodeURIComponent(id)}`, {
        body: patch, agent: true, retryUnavailable: true,
      });
    },
    verify(id, { verified, as, revision, contentHash } = {}) {
      return request('POST', `/api/library/documents/${encodeURIComponent(id)}/verify`, {
        body: { verified, as, ...(revision ? { revision } : {}), ...(contentHash ? { contentHash } : {}) }, retryUnavailable: true,
      });
    },
    supersede(oldId, newId) {
      return request('POST', `/api/library/documents/${encodeURIComponent(oldId)}/supersede`, {
        body: { supersededBy: newId }, agent: true, retryUnavailable: true,
      });
    },
    listProjects() {
      return request('GET', '/api/projects');
    },
    addExternalRef(documentId, { url, label } = {}) {
      return request('POST', `/api/library/documents/${encodeURIComponent(documentId)}/external-refs`, {
        body: { url, label }, agent: true, retryUnavailable: true,
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
    listDocuments(project) {
      const qs = project && project !== 'all' ? `?project=${encodeURIComponent(project)}` : '';
      return request('GET', `/api/library/documents${qs}`);
    },
  };
}
