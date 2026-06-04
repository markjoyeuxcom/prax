// Thin HTTP client over the Moomora API. No business logic — every method maps
// to one endpoint. Uses global fetch (Node 20+).
export function createClient({ baseUrl, token } = {}) {
  const base = (baseUrl || process.env.MOOMORA_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

  async function request(method, path, { body, agent = false, accept } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (agent) headers['x-moomora-origin'] = 'agent';
    if (accept) headers['accept'] = accept;
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const message = payload && payload.message ? payload.message : `HTTP ${res.status}`;
      throw new Error(message);
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
      return request('POST', '/api/library/documents', { body: doc, agent: true });
    },
    updateMemory(id, patch) {
      return request('PATCH', `/api/library/documents/${encodeURIComponent(id)}`, { body: patch, agent: true });
    },
    verify(id, { verified, as } = {}) {
      return request('POST', `/api/library/documents/${encodeURIComponent(id)}/verify`, { body: { verified, as } });
    },
    supersede(oldId, newId) {
      return request('POST', `/api/library/documents/${encodeURIComponent(oldId)}/supersede`, { body: { supersededBy: newId } });
    },
  };
}
