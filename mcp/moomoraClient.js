import { MoomoraApiError, MoomoraUnavailableError } from './errors.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 5000;

export function createMoomoraClient({
  baseUrl = process.env.MOOMORA_API_URL || DEFAULT_BASE_URL,
  token = process.env.MOOMORA_API_TOKEN,
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

  async function request(method, path, { query, body } = {}) {
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

    let response;
    try {
      // Requires native fetch (Node 17.3+). A non-native injected fetch may ignore `signal`, dropping the timeout.
      response = await fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new MoomoraUnavailableError(
        `Moomora API not reachable at ${root} — is the server running? (${err.message})`,
      );
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
      throw new MoomoraApiError(response.status, message);
    }
    return payload;
  }

  async function patchOrNull(path, patch) {
    try {
      return await request('PATCH', path, { body: patch });
    } catch (err) {
      if (err instanceof MoomoraApiError && err.status === 404) return null;
      throw err;
    }
  }

  return {
    listDocuments: ({ q, project, documentType } = {}) =>
      request('GET', '/api/library/documents', { query: { q, project, documentType } }),

    getDocument: async (id) => {
      const docs = await request('GET', '/api/library/documents');
      return (Array.isArray(docs) ? docs : []).find((doc) => doc.id === id) || null;
    },

    createDocument: (payload) =>
      request('POST', '/api/library/documents', { body: payload }),

    updateDocument: (id, patch) =>
      patchOrNull(`/api/library/documents/${id}`, patch),

    listTasks: ({ q, project, status } = {}) =>
      request('GET', '/api/tasks', { query: { q, project, status } }),

    getTask: async (id) => {
      const tasks = await request('GET', '/api/tasks');
      return (Array.isArray(tasks) ? tasks : []).find((task) => task.id === id) || null;
    },

    createTask: (payload) =>
      request('POST', '/api/tasks', { body: payload }),

    updateTask: (id, patch) =>
      patchOrNull(`/api/tasks/${id}`, patch),

    listTaskDocuments: (taskId) =>
      request('GET', `/api/tasks/${taskId}/documents`, {}),

    linkTaskDocument: (taskId, documentId) =>
      request('POST', `/api/tasks/${taskId}/documents`, { body: { documentId } }),

    unlinkTaskDocument: (taskId, documentId) =>
      request('DELETE', `/api/tasks/${taskId}/documents/${documentId}`, {}),

    listChecklist: (taskId) =>
      request('GET', `/api/tasks/${taskId}/checklist`, {}),

    addChecklistItem: (taskId, label) =>
      request('POST', `/api/tasks/${taskId}/checklist`, { body: { label } }),

    setChecklistItem: (taskId, itemId, completed) =>
      request('PATCH', `/api/tasks/${taskId}/checklist/${itemId}`, { body: { completed } }),

    deleteChecklistItem: (taskId, itemId) =>
      request('DELETE', `/api/tasks/${taskId}/checklist/${itemId}`, {}),

    listTaskActivity: (taskId) =>
      request('GET', `/api/tasks/${taskId}/activity`, {}),
  };
}
