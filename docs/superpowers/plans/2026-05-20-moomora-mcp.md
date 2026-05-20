# Moomora MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local stdio MCP server (in `mcp/`) that wraps Moomora's HTTP API as read + create + edit + link tools, so Claude Code can operate on Moomora tasks and library documents on a Pro/Max subscription.

**Architecture:** A single HTTP boundary (`moomoraClient.js`) talks to Moomora's REST API. Pure helper modules (`validate.js`, `shape.js`, `toolResult.js`, `errors.js`) handle UUID validation, response shaping, MCP result envelopes, and typed errors. Domain tool modules (`tools/documents.js`, `tools/tasks.js`, `tools/links.js`) are factories that close over the client and export plain tool descriptors. `server.js` wires descriptors into an `McpServer` and connects stdio. Tools never touch HTTP directly; the client never knows about MCP — both are unit-testable in isolation.

**Tech Stack:** Node.js 20+ (ESM), `@modelcontextprotocol/sdk` `^1.29.0`, `zod` `^4.4.3`, Node's built-in test runner (`node:test` + `node:assert/strict`). Spec: `docs/superpowers/specs/2026-05-20-moomora-mcp-design.md`.

---

## Conventions for the executor

- **Commits:** conventional-commit messages. **Every commit MUST include both co-author trailers** (repo policy, `~/.claude/CLAUDE.md`):
  ```
  Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
  Commit examples below use a HEREDOC to include them.
- **Branch:** all work lands on `feat/mcp-server` (already created from the v0.2.0 `main`).
- **Run a single test file:** `node --test tests/mcp/<file>.test.js`
- **Run the whole suite:** `npm test`
- **Tests are auto-discovered:** any `tests/**/*.test.js` is picked up by `npm test`.

## File structure

```
mcp/
├── errors.js              MoomoraUnavailableError, MoomoraApiError
├── validate.js            isValidUuid
├── shape.js               snippet, toDocumentRef, toTaskRef, capResults
├── toolResult.js          okResult, errorResult, withErrorHandling
├── moomoraClient.js       createMoomoraClient(...) — the only HTTP boundary
├── tools/
│   ├── documents.js       createDocumentTools(client)
│   ├── tasks.js           createTaskTools(client)
│   └── links.js           createLinkTools(client)
├── server.js              buildServer(...), main()
└── README.md              registration command + smoke checklist

tests/mcp/
├── errors.test.js
├── validate.test.js
├── shape.test.js
├── toolResult.test.js
├── moomoraClient.test.js
├── documentsTools.test.js
├── tasksTools.test.js
├── linksTools.test.js
└── server.test.js
```

---

## Task 1: Add dependencies and update the check script

**Files:**
- Modify: `package.json` (add deps + extend `check` script)

- [ ] **Step 1: Install the runtime dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk@^1.29.0 zod@^4.4.3 --save
```
Expected: `package.json` gains both under `dependencies`; `package-lock.json` updates; "found 0 vulnerabilities".

- [ ] **Step 2: Verify the SDK imports resolve and zod is present**

Run:
```bash
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m=>console.log('McpServer', typeof m.McpServer)); import('@modelcontextprotocol/sdk/server/stdio.js').then(m=>console.log('Stdio', typeof m.StdioServerTransport)); import('zod').then(m=>console.log('zod', typeof m.z))"
```
Expected:
```
McpServer function
Stdio function
zod object
```

- [ ] **Step 3: Extend the `check` script to syntax-check the MCP entry point**

In `package.json`, change the `check` script from:
```json
"check": "node --check server/index.js && node --check scripts/demo-server.js && node --check public/js/main.js"
```
to:
```json
"check": "node --check server/index.js && node --check scripts/demo-server.js && node --check public/js/main.js && node --check mcp/server.js"
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: add MCP SDK + zod deps for the Moomora MCP server

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

Note: Step 3's `check` script now references `mcp/server.js`, which does not exist until Task 11. Do not run `npm run check` until then; `npm test` is unaffected.

---

## Task 2: Typed errors (`mcp/errors.js`)

**Files:**
- Create: `mcp/errors.js`
- Test: `tests/mcp/errors.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/errors.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MoomoraUnavailableError, MoomoraApiError } from '../../mcp/errors.js';

test('MoomoraUnavailableError carries a message and name', () => {
  const err = new MoomoraUnavailableError('api down');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'MoomoraUnavailableError');
  assert.equal(err.message, 'api down');
});

test('MoomoraApiError carries status and message', () => {
  const err = new MoomoraApiError(404, 'document not found');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'MoomoraApiError');
  assert.equal(err.status, 404);
  assert.equal(err.message, 'document not found');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/errors.test.js`
Expected: FAIL — `Cannot find module '../../mcp/errors.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/errors.js
export class MoomoraUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoomoraUnavailableError';
  }
}

export class MoomoraApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MoomoraApiError';
    this.status = status;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/errors.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/errors.js tests/mcp/errors.test.js
git commit -m "$(cat <<'EOF'
feat: add typed MCP client errors

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: UUID validation (`mcp/validate.js`)

**Files:**
- Create: `mcp/validate.js`
- Test: `tests/mcp/validate.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/validate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidUuid } from '../../mcp/validate.js';

test('accepts a valid v4 UUID', () => {
  assert.equal(isValidUuid('11111111-1111-4111-8111-111111111111'), true);
});

test('rejects malformed strings', () => {
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(isValidUuid(''), false);
  assert.equal(isValidUuid(undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/validate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/validate.js
// Mirrors the UUID check used by server/libraryRoutes.js and server/tasksRoutes.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/validate.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/validate.js tests/mcp/validate.test.js
git commit -m "$(cat <<'EOF'
feat: add UUID validation helper for MCP tools

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Response shaping helpers (`mcp/shape.js`)

**Files:**
- Create: `mcp/shape.js`
- Test: `tests/mcp/shape.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/shape.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { snippet, toDocumentRef, toTaskRef, capResults } from '../../mcp/shape.js';

test('snippet collapses whitespace and truncates to max length', () => {
  const body = 'line one\n\n   line two   with   spaces';
  assert.equal(snippet(body, 12), 'line one lin');
  assert.equal(snippet('', 200), '');
  assert.equal(snippet(undefined, 200), '');
});

test('toDocumentRef drops the body and adds a snippet', () => {
  const doc = {
    id: 'd1', title: 'Runbook', body: 'full body text here',
    documentType: 'runbook', context: 'homelab', tags: ['k8s'], extra: 'ignored',
  };
  const ref = toDocumentRef(doc);
  assert.deepEqual(ref, {
    id: 'd1', title: 'Runbook', documentType: 'runbook',
    context: 'homelab', tags: ['k8s'], snippet: 'full body text here',
  });
  assert.equal('body' in ref, false);
});

test('toTaskRef keeps summary fields only', () => {
  const task = {
    id: 't1', title: 'Backup', description: 'long', status: 'planned',
    priority: 'high', context: 'homelab', dueDate: '2026-05-12', sortOrder: 3,
  };
  assert.deepEqual(toTaskRef(task), {
    id: 't1', title: 'Backup', status: 'planned',
    priority: 'high', context: 'homelab', dueDate: '2026-05-12',
  });
});

test('capResults limits array length', () => {
  const arr = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(capResults(arr).length, 20);
  assert.equal(capResults(arr, 5).length, 5);
  assert.deepEqual(capResults([1, 2], 20), [1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/shape.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/shape.js
const DEFAULT_SNIPPET = 200;
const DEFAULT_CAP = 20;

export function snippet(body, max = DEFAULT_SNIPPET) {
  return String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function toDocumentRef(doc) {
  return {
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    context: doc.context,
    tags: doc.tags ?? [],
    snippet: snippet(doc.body),
  };
}

export function toTaskRef(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    context: task.context,
    dueDate: task.dueDate ?? null,
  };
}

export function capResults(items, max = DEFAULT_CAP) {
  return Array.isArray(items) ? items.slice(0, max) : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/shape.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/shape.js tests/mcp/shape.test.js
git commit -m "$(cat <<'EOF'
feat: add MCP response shaping helpers (refs, snippet, cap)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: MCP result envelopes (`mcp/toolResult.js`)

**Files:**
- Create: `mcp/toolResult.js`
- Test: `tests/mcp/toolResult.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/toolResult.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { okResult, errorResult, withErrorHandling } from '../../mcp/toolResult.js';
import { MoomoraApiError, MoomoraUnavailableError } from '../../mcp/errors.js';

test('okResult serializes data as JSON text', () => {
  const res = okResult({ a: 1 });
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].type, 'text');
  assert.deepEqual(JSON.parse(res.content[0].text), { a: 1 });
});

test('errorResult marks isError and carries the message', () => {
  const res = errorResult('boom');
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, 'boom');
});

test('withErrorHandling maps MoomoraApiError to an error result', async () => {
  const wrapped = withErrorHandling(async () => {
    throw new MoomoraApiError(404, 'document not found');
  });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, 'document not found');
});

test('withErrorHandling maps MoomoraUnavailableError to an error result', async () => {
  const wrapped = withErrorHandling(async () => {
    throw new MoomoraUnavailableError('api down');
  });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, 'api down');
});

test('withErrorHandling wraps unexpected errors', async () => {
  const wrapped = withErrorHandling(async () => {
    throw new Error('weird');
  });
  const res = await wrapped({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Unexpected error: weird/);
});

test('withErrorHandling passes through successful results', async () => {
  const wrapped = withErrorHandling(async ({ n }) => okResult({ n }));
  const res = await wrapped({ n: 7 });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0].text), { n: 7 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/toolResult.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/toolResult.js
import { MoomoraApiError, MoomoraUnavailableError } from './errors.js';

export function okResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function withErrorHandling(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof MoomoraApiError || err instanceof MoomoraUnavailableError) {
        return errorResult(err.message);
      }
      return errorResult(`Unexpected error: ${err.message}`);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/toolResult.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/toolResult.js tests/mcp/toolResult.test.js
git commit -m "$(cat <<'EOF'
feat: add MCP tool result envelopes and error wrapper

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: HTTP client (`mcp/moomoraClient.js`)

**Files:**
- Create: `mcp/moomoraClient.js`
- Test: `tests/mcp/moomoraClient.test.js`

The client is the only module that talks HTTP. `fetch` is injectable for testing. A fake `fetch` records the request and returns a `Response`-like object.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/moomoraClient.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoomoraClient } from '../../mcp/moomoraClient.js';
import { MoomoraApiError, MoomoraUnavailableError } from '../../mcp/errors.js';

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function recordingFetch(response) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    if (typeof response === 'function') return response(url, options);
    return response;
  };
  fn.calls = calls;
  return fn;
}

const BASE = 'http://127.0.0.1:3000';

test('listDocuments builds query string and omits empty params', async () => {
  const fetch = recordingFetch(jsonResponse(200, [{ id: 'd1' }]));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  const docs = await client.listDocuments({ q: 'backup', context: 'homelab', documentType: undefined });
  assert.deepEqual(docs, [{ id: 'd1' }]);
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, '/api/library/documents');
  assert.equal(url.searchParams.get('q'), 'backup');
  assert.equal(url.searchParams.get('context'), 'homelab');
  assert.equal(url.searchParams.has('documentType'), false);
  assert.equal(fetch.calls[0].options.method, 'GET');
});

test('adds Authorization header only when a token is set', async () => {
  const withToken = recordingFetch(jsonResponse(200, []));
  await createMoomoraClient({ baseUrl: BASE, token: 'secret', fetch: withToken }).listTasks({});
  assert.equal(withToken.calls[0].options.headers.authorization, 'Bearer secret');

  const noToken = recordingFetch(jsonResponse(200, []));
  await createMoomoraClient({ baseUrl: BASE, fetch: noToken }).listTasks({});
  assert.equal(noToken.calls[0].options.headers.authorization, undefined);
});

test('createDocument POSTs a JSON body and returns the created doc', async () => {
  const fetch = recordingFetch(jsonResponse(201, { id: 'd9', title: 'New' }));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  const doc = await client.createDocument({ title: 'New', body: 'b', documentType: 'note', context: 'work' });
  assert.deepEqual(doc, { id: 'd9', title: 'New' });
  assert.equal(fetch.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetch.calls[0].options.body), {
    title: 'New', body: 'b', documentType: 'note', context: 'work',
  });
});

test('getDocument lists then finds by id, returning null when absent', async () => {
  const fetch = recordingFetch(jsonResponse(200, [{ id: 'a' }, { id: 'b' }]));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  assert.deepEqual(await client.getDocument('b'), { id: 'b' });

  const fetch2 = recordingFetch(jsonResponse(200, [{ id: 'a' }]));
  const client2 = createMoomoraClient({ baseUrl: BASE, fetch: fetch2 });
  assert.equal(await client2.getDocument('zzz'), null);
});

test('updateDocument returns null on 404', async () => {
  const fetch = recordingFetch(jsonResponse(404, { message: 'document not found' }));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  assert.equal(await client.updateDocument('x', { title: 'y' }), null);
});

test('linkTaskDocument posts documentId in the body', async () => {
  const fetch = recordingFetch(jsonResponse(201, { linked: true }));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  await client.linkTaskDocument('t1', 'd1');
  const call = fetch.calls[0];
  assert.match(new URL(call.url).pathname, /\/api\/tasks\/t1\/documents$/);
  assert.deepEqual(JSON.parse(call.options.body), { documentId: 'd1' });
});

test('unlinkTaskDocument issues DELETE and tolerates 204 (null body)', async () => {
  const fetch = recordingFetch(jsonResponse(204, undefined));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  const res = await client.unlinkTaskDocument('t1', 'd1');
  assert.equal(res, null);
  assert.equal(fetch.calls[0].options.method, 'DELETE');
});

test('non-2xx (non-404) responses throw MoomoraApiError with status and message', async () => {
  const fetch = recordingFetch(jsonResponse(400, { message: 'title is required' }));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  await assert.rejects(
    () => client.createDocument({}),
    (err) => err instanceof MoomoraApiError && err.status === 400 && err.message === 'title is required',
  );
});

test('fetch rejection maps to MoomoraUnavailableError', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  await assert.rejects(
    () => client.listTasks({}),
    (err) => err instanceof MoomoraUnavailableError && /not reachable/.test(err.message),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/moomoraClient.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/moomoraClient.js
import { MoomoraApiError, MoomoraUnavailableError } from './errors.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 5000;

export function createMoomoraClient({
  baseUrl = process.env.MOOMORA_API_URL || DEFAULT_BASE_URL,
  token = process.env.MOOMORA_API_TOKEN,
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
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

    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;

    let response;
    try {
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
    listDocuments: ({ q, context, documentType } = {}) =>
      request('GET', '/api/library/documents', { query: { q, context, documentType } }),

    getDocument: async (id) => {
      const docs = await request('GET', '/api/library/documents', {});
      return (Array.isArray(docs) ? docs : []).find((doc) => doc.id === id) || null;
    },

    createDocument: (payload) =>
      request('POST', '/api/library/documents', { body: payload }),

    updateDocument: (id, patch) =>
      patchOrNull(`/api/library/documents/${id}`, patch),

    listTasks: ({ q, context, status } = {}) =>
      request('GET', '/api/tasks', { query: { q, context, status } }),

    getTask: async (id) => {
      const tasks = await request('GET', '/api/tasks', {});
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
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/moomoraClient.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/moomoraClient.js tests/mcp/moomoraClient.test.js
git commit -m "$(cat <<'EOF'
feat: add Moomora HTTP client for the MCP server

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Document tools (`mcp/tools/documents.js`)

**Files:**
- Create: `mcp/tools/documents.js`
- Test: `tests/mcp/documentsTools.test.js`

Each tool module is a factory returning an array of descriptors:
`{ name, title, description, inputSchema, annotations?, handler }`. `inputSchema` is a raw Zod shape (object of zod validators). `handler` is `async (args) => CallToolResult`. Tests call handlers directly with a stub client.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/documentsTools.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentTools } from '../../mcp/tools/documents.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const SAMPLE_DOC = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'k8s upgrade', body: 'long runbook body',
  documentType: 'runbook', context: 'homelab', tags: ['k8s', 'upgrade'],
};

test('exposes the four document tools', () => {
  const names = createDocumentTools({}).map((t) => t.name);
  assert.deepEqual(
    names.sort(),
    ['create_document', 'get_document', 'search_documents', 'update_document'],
  );
});

test('search_documents maps args to listDocuments and returns refs without bodies', async () => {
  let received;
  const client = {
    listDocuments: async (filters) => { received = filters; return [SAMPLE_DOC]; },
  };
  const tool = byName(createDocumentTools(client), 'search_documents');
  const res = await tool.handler({ query: 'upgrade', context: 'homelab' });
  assert.deepEqual(received, { q: 'upgrade', context: 'homelab', documentType: undefined });
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.length, 1);
  assert.equal('body' in data[0], false);
  assert.equal(data[0].snippet, 'long runbook body');
});

test('search_documents filters by tags client-side', async () => {
  const client = { listDocuments: async () => [SAMPLE_DOC] };
  const tool = byName(createDocumentTools(client), 'search_documents');
  const hit = JSON.parse((await tool.handler({ query: 'x', tags: ['k8s'] })).content[0].text);
  assert.equal(hit.length, 1);
  const miss = JSON.parse((await tool.handler({ query: 'x', tags: ['absent'] })).content[0].text);
  assert.equal(miss.length, 0);
});

test('get_document rejects a bad UUID before calling the client', async () => {
  let called = false;
  const client = { getDocument: async () => { called = true; } };
  const tool = byName(createDocumentTools(client), 'get_document');
  const res = await tool.handler({ id: 'nope' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /valid UUID/);
  assert.equal(called, false);
});

test('get_document returns a friendly message when missing', async () => {
  const client = { getDocument: async () => null };
  const tool = byName(createDocumentTools(client), 'get_document');
  const res = await tool.handler({ id: SAMPLE_DOC.id });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No document with id/);
});

test('get_document returns the full document when found', async () => {
  const client = { getDocument: async () => SAMPLE_DOC };
  const tool = byName(createDocumentTools(client), 'get_document');
  const res = await tool.handler({ id: SAMPLE_DOC.id });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0].text), SAMPLE_DOC);
});

test('create_document forwards args to the client', async () => {
  let received;
  const client = { createDocument: async (p) => { received = p; return { id: 'new', ...p }; } };
  const tool = byName(createDocumentTools(client), 'create_document');
  const payload = { title: 'New', body: 'b', documentType: 'note', context: 'work', tags: ['x'] };
  const res = await tool.handler(payload);
  assert.deepEqual(received, payload);
  assert.equal(JSON.parse(res.content[0].text).id, 'new');
});

test('update_document rejects empty patches and bad UUIDs', async () => {
  const client = { updateDocument: async () => ({}) };
  const tools = createDocumentTools(client);
  const tool = byName(tools, 'update_document');
  assert.match((await tool.handler({ id: 'bad', title: 'x' })).content[0].text, /valid UUID/);
  assert.match((await tool.handler({ id: SAMPLE_DOC.id })).content[0].text, /at least one field/);
});

test('update_document returns missing message on null result', async () => {
  const client = { updateDocument: async () => null };
  const tool = byName(createDocumentTools(client), 'update_document');
  const res = await tool.handler({ id: SAMPLE_DOC.id, title: 'x' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No document with id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/documentsTools.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/tools/documents.js
import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { toDocumentRef, capResults } from '../shape.js';

const CONTEXT = z.enum(['personal', 'work', 'homelab']);
const DOCUMENT_TYPE = z.enum(['runbook', 'note']);

export function createDocumentTools(client) {
  return [
    {
      name: 'search_documents',
      title: 'Search documents',
      description:
        'Full-text search the Moomora library. Returns lightweight references (id, title, type, context, tags, snippet) without bodies. Call get_document to read a full document.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().describe('Search text matched against title, body, and tags.'),
        context: CONTEXT.optional().describe('Limit to one context; omit to search all.'),
        documentType: DOCUMENT_TYPE.optional().describe('Limit to runbooks or notes.'),
        tags: z.array(z.string()).optional().describe('Require all of these tags.'),
      },
      handler: withErrorHandling(async ({ query, context, documentType, tags }) => {
        const docs = await client.listDocuments({ q: query, context, documentType });
        let refs = (Array.isArray(docs) ? docs : []).map(toDocumentRef);
        if (Array.isArray(tags) && tags.length > 0) {
          refs = refs.filter((ref) => tags.every((tag) => ref.tags.includes(tag)));
        }
        return okResult(capResults(refs));
      }),
    },
    {
      name: 'get_document',
      title: 'Get document',
      description: 'Fetch a full library document (including its Markdown body) by id.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string().describe('Document UUID.'),
      },
      handler: withErrorHandling(async ({ id }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        const doc = await client.getDocument(id);
        if (!doc) return errorResult(`No document with id ${id} (it may be archived or deleted).`);
        return okResult(doc);
      }),
    },
    {
      name: 'create_document',
      title: 'Create document',
      description: 'Create a new library runbook or note.',
      inputSchema: {
        title: z.string().min(1).describe('Document title.'),
        body: z.string().describe('Markdown body.'),
        documentType: DOCUMENT_TYPE,
        context: CONTEXT,
        tags: z.array(z.string()).optional(),
      },
      handler: withErrorHandling(async (args) => {
        const doc = await client.createDocument(args);
        return okResult(doc);
      }),
    },
    {
      name: 'update_document',
      title: 'Update document',
      description: 'Update one or more fields of an existing library document.',
      inputSchema: {
        id: z.string().describe('Document UUID.'),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        documentType: DOCUMENT_TYPE.optional(),
        context: CONTEXT.optional(),
        tags: z.array(z.string()).optional(),
      },
      handler: withErrorHandling(async ({ id, ...patch }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        if (Object.keys(patch).length === 0) {
          return errorResult('Provide at least one field to update.');
        }
        const doc = await client.updateDocument(id, patch);
        if (!doc) return errorResult(`No document with id ${id}.`);
        return okResult(doc);
      }),
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/documentsTools.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/tools/documents.js tests/mcp/documentsTools.test.js
git commit -m "$(cat <<'EOF'
feat: add MCP document tools (search/get/create/update)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Task tools (`mcp/tools/tasks.js`)

**Files:**
- Create: `mcp/tools/tasks.js`
- Test: `tests/mcp/tasksTools.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/tasksTools.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskTools } from '../../mcp/tools/tasks.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_TASK = {
  id: TASK_ID, title: 'Backup CNPG', description: 'details',
  status: 'planned', priority: 'high', context: 'homelab',
  dueDate: '2026-05-12', sortOrder: 0,
};

test('exposes the four task tools', () => {
  const names = createTaskTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['create_task', 'get_task', 'search_tasks', 'update_task']);
});

test('search_tasks maps args and returns task summaries', async () => {
  let received;
  const client = { listTasks: async (f) => { received = f; return [SAMPLE_TASK]; } };
  const tool = byName(createTaskTools(client), 'search_tasks');
  const res = await tool.handler({ query: 'backup', context: 'homelab', status: 'planned' });
  assert.deepEqual(received, { q: 'backup', context: 'homelab', status: 'planned' });
  const data = JSON.parse(res.content[0].text);
  assert.equal('description' in data[0], false);
  assert.equal(data[0].priority, 'high');
});

test('get_task validates UUID and handles missing', async () => {
  const present = { getTask: async () => SAMPLE_TASK };
  const tools = createTaskTools(present);
  const tool = byName(tools, 'get_task');
  assert.match((await tool.handler({ id: 'bad' })).content[0].text, /valid UUID/);
  assert.deepEqual(JSON.parse((await tool.handler({ id: TASK_ID })).content[0].text), SAMPLE_TASK);

  const absent = createTaskTools({ getTask: async () => null });
  const res = await byName(absent, 'get_task').handler({ id: TASK_ID });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No task with id/);
});

test('create_task forwards args to the client', async () => {
  let received;
  const client = { createTask: async (p) => { received = p; return { id: 'new', ...p }; } };
  const tool = byName(createTaskTools(client), 'create_task');
  const payload = { title: 'New', context: 'work', priority: 'medium', status: 'planned' };
  await tool.handler(payload);
  assert.deepEqual(received, payload);
});

test('update_task rejects empty patch and bad UUID, maps missing to error', async () => {
  const ok = { updateTask: async (id, patch) => ({ id, ...patch }) };
  const tool = byName(createTaskTools(ok), 'update_task');
  assert.match((await tool.handler({ id: 'bad', title: 'x' })).content[0].text, /valid UUID/);
  assert.match((await tool.handler({ id: TASK_ID })).content[0].text, /at least one field/);
  assert.equal(JSON.parse((await tool.handler({ id: TASK_ID, status: 'completed' })).content[0].text).status, 'completed');

  const missing = createTaskTools({ updateTask: async () => null });
  const res = await byName(missing, 'update_task').handler({ id: TASK_ID, status: 'completed' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No task with id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/tasksTools.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/tools/tasks.js
import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';
import { toTaskRef, capResults } from '../shape.js';

const CONTEXT = z.enum(['personal', 'work', 'homelab']);
const STATUS = z.enum(['high-priority', 'in-progress', 'planned', 'completed', 'notes']);
const PRIORITY = z.enum(['high', 'medium', 'low']);

export function createTaskTools(client) {
  return [
    {
      name: 'search_tasks',
      title: 'Search tasks',
      description:
        'Search active Moomora tasks. Returns summaries (id, title, status, priority, context, dueDate). Call get_task for the full record.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe('Text matched against task title.'),
        context: CONTEXT.optional().describe('Limit to one context; omit for all.'),
        status: STATUS.optional().describe('Limit to one status.'),
      },
      handler: withErrorHandling(async ({ query, context, status }) => {
        const tasks = await client.listTasks({ q: query, context, status });
        const refs = (Array.isArray(tasks) ? tasks : []).map(toTaskRef);
        return okResult(capResults(refs));
      }),
    },
    {
      name: 'get_task',
      title: 'Get task',
      description: 'Fetch a full task record by id.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string().describe('Task UUID.'),
      },
      handler: withErrorHandling(async ({ id }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        const task = await client.getTask(id);
        if (!task) return errorResult(`No task with id ${id} (it may be archived or deleted).`);
        return okResult(task);
      }),
    },
    {
      name: 'create_task',
      title: 'Create task',
      description: 'Create a new task. priority defaults to medium and status to planned if omitted.',
      inputSchema: {
        title: z.string().min(1).describe('Task title.'),
        context: CONTEXT,
        description: z.string().optional(),
        priority: PRIORITY.optional(),
        status: STATUS.optional(),
        dueDate: z.string().optional().describe('ISO date (YYYY-MM-DD) or empty.'),
      },
      handler: withErrorHandling(async (args) => {
        const task = await client.createTask(args);
        return okResult(task);
      }),
    },
    {
      name: 'update_task',
      title: 'Update task',
      description: 'Update one or more fields of an existing task.',
      inputSchema: {
        id: z.string().describe('Task UUID.'),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        priority: PRIORITY.optional(),
        status: STATUS.optional(),
        context: CONTEXT.optional(),
        dueDate: z.string().optional(),
      },
      handler: withErrorHandling(async ({ id, ...patch }) => {
        if (!isValidUuid(id)) return errorResult('id must be a valid UUID.');
        if (Object.keys(patch).length === 0) {
          return errorResult('Provide at least one field to update.');
        }
        const task = await client.updateTask(id, patch);
        if (!task) return errorResult(`No task with id ${id}.`);
        return okResult(task);
      }),
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/tasksTools.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/tools/tasks.js tests/mcp/tasksTools.test.js
git commit -m "$(cat <<'EOF'
feat: add MCP task tools (search/get/create/update)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Link tools (`mcp/tools/links.js`)

**Files:**
- Create: `mcp/tools/links.js`
- Test: `tests/mcp/linksTools.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/linksTools.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkTools } from '../../mcp/tools/links.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

test('exposes the three link tools', () => {
  const names = createLinkTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['link_task_document', 'list_task_documents', 'unlink_task_document']);
});

test('list_task_documents validates the task UUID', async () => {
  let called = false;
  const client = { listTaskDocuments: async () => { called = true; return []; } };
  const tool = byName(createLinkTools(client), 'list_task_documents');
  const res = await tool.handler({ taskId: 'bad' });
  assert.equal(res.isError, true);
  assert.equal(called, false);
});

test('list_task_documents returns the linked docs', async () => {
  const client = { listTaskDocuments: async () => [{ id: DOC_ID, title: 'Runbook' }] };
  const tool = byName(createLinkTools(client), 'list_task_documents');
  const res = await tool.handler({ taskId: TASK_ID });
  assert.deepEqual(JSON.parse(res.content[0].text), [{ id: DOC_ID, title: 'Runbook' }]);
});

test('link_task_document validates both UUIDs then calls the client', async () => {
  let received;
  const client = { linkTaskDocument: async (t, d) => { received = [t, d]; return { linked: true }; } };
  const tool = byName(createLinkTools(client), 'link_task_document');
  assert.match((await tool.handler({ taskId: 'bad', documentId: DOC_ID })).content[0].text, /valid UUID/);
  assert.match((await tool.handler({ taskId: TASK_ID, documentId: 'bad' })).content[0].text, /valid UUID/);
  await tool.handler({ taskId: TASK_ID, documentId: DOC_ID });
  assert.deepEqual(received, [TASK_ID, DOC_ID]);
});

test('unlink_task_document validates UUIDs and reports success', async () => {
  let received;
  const client = { unlinkTaskDocument: async (t, d) => { received = [t, d]; return null; } };
  const tool = byName(createLinkTools(client), 'unlink_task_document');
  assert.match((await tool.handler({ taskId: 'bad', documentId: DOC_ID })).content[0].text, /valid UUID/);
  const res = await tool.handler({ taskId: TASK_ID, documentId: DOC_ID });
  assert.deepEqual(received, [TASK_ID, DOC_ID]);
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /unlinked|removed|ok/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/linksTools.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/tools/links.js
import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, withErrorHandling } from '../toolResult.js';

export function createLinkTools(client) {
  return [
    {
      name: 'list_task_documents',
      title: 'List linked documents',
      description: 'List the library documents linked to a task.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
      },
      handler: withErrorHandling(async ({ taskId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        const docs = await client.listTaskDocuments(taskId);
        return okResult(docs ?? []);
      }),
    },
    {
      name: 'link_task_document',
      title: 'Link document to task',
      description: 'Link a library document to a task. Idempotent — re-linking is a no-op.',
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        documentId: z.string().describe('Document UUID.'),
      },
      handler: withErrorHandling(async ({ taskId, documentId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        const result = await client.linkTaskDocument(taskId, documentId);
        return okResult(result ?? { linked: true, taskId, documentId });
      }),
    },
    {
      name: 'unlink_task_document',
      title: 'Unlink document from task',
      description: 'Remove the link between a task and a document.',
      inputSchema: {
        taskId: z.string().describe('Task UUID.'),
        documentId: z.string().describe('Document UUID.'),
      },
      handler: withErrorHandling(async ({ taskId, documentId }) => {
        if (!isValidUuid(taskId)) return errorResult('taskId must be a valid UUID.');
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        await client.unlinkTaskDocument(taskId, documentId);
        return okResult({ unlinked: true, taskId, documentId });
      }),
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/linksTools.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/tools/links.js tests/mcp/linksTools.test.js
git commit -m "$(cat <<'EOF'
feat: add MCP link tools (list/link/unlink task documents)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Server wiring (`mcp/server.js`)

**Files:**
- Create: `mcp/server.js`
- Test: `tests/mcp/server.test.js`

`buildServer` accepts injectable `server` and `client` for testing. When run as the main module it builds from env and connects stdio.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/mcp/server.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../mcp/server.js';

test('registers all 11 tools with unique names', () => {
  const registered = [];
  const fakeServer = {
    registerTool: (name, config, handler) => {
      registered.push({ name, config, handler });
    },
  };
  buildServer({ server: fakeServer, client: {} });

  const names = registered.map((r) => r.name);
  assert.equal(names.length, 11);
  assert.equal(new Set(names).size, 11, 'tool names must be unique');
  for (const expected of [
    'search_documents', 'get_document', 'create_document', 'update_document',
    'search_tasks', 'get_task', 'create_task', 'update_task',
    'list_task_documents', 'link_task_document', 'unlink_task_document',
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
});

test('each registered tool has a title, description, inputSchema, and handler', () => {
  const registered = [];
  const fakeServer = { registerTool: (name, config, handler) => registered.push({ name, config, handler }) };
  buildServer({ server: fakeServer, client: {} });

  for (const { config, handler } of registered) {
    assert.equal(typeof config.title, 'string');
    assert.equal(typeof config.description, 'string');
    assert.equal(typeof config.inputSchema, 'object');
    assert.equal(typeof handler, 'function');
  }
});

test('returns the server instance', () => {
  const fakeServer = { registerTool: () => {} };
  assert.equal(buildServer({ server: fakeServer, client: {} }), fakeServer);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/server.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mcp/server.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMoomoraClient } from './moomoraClient.js';
import { createDocumentTools } from './tools/documents.js';
import { createTaskTools } from './tools/tasks.js';
import { createLinkTools } from './tools/links.js';

export function buildServer({ server, client } = {}) {
  const mcp = server || new McpServer({ name: 'moomora-console', version: '0.2.0' });
  const apiClient = client || createMoomoraClient();

  const tools = [
    ...createDocumentTools(apiClient),
    ...createTaskTools(apiClient),
    ...createLinkTools(apiClient),
  ];

  for (const tool of tools) {
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      tool.handler,
    );
  }

  return mcp;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — log to stderr only.
  console.error('Moomora MCP server running on stdio');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp/server.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the entry point syntax-checks and the full suite is green**

Run: `npm run check && npm test`
Expected: `npm run check` exits 0 (now includes `mcp/server.js`); `npm test` passes with all MCP tests plus the existing backend/frontend suites.

- [ ] **Step 6: Commit**

```bash
git add mcp/server.js tests/mcp/server.test.js
git commit -m "$(cat <<'EOF'
feat: wire MCP server (stdio transport, tool registration)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Documentation (`mcp/README.md` + root README pointer)

**Files:**
- Create: `mcp/README.md`
- Modify: `README.md` (add a short "MCP server" pointer under Scripts or Project Direction)

- [ ] **Step 1: Write `mcp/README.md`**

```markdown
# Moomora MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
Moomora's HTTP API to Claude Code as tools, so you can search, read, create, edit, and
cross-link tasks and library documents interactively — running on your Claude Pro/Max
subscription rather than the Anthropic API.

Design spec: `docs/superpowers/specs/2026-05-20-moomora-mcp-design.md`.

## Prerequisites

- Node.js 20+
- A running Moomora server (the in-memory demo is enough): `npm run demo`
  (serves the API on `http://127.0.0.1:3100`) or `npm start` (defaults to
  `http://0.0.0.0:3000`).

## Configuration

The server reads two environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `MOOMORA_API_URL` | `http://127.0.0.1:3000` | Base URL of the Moomora API. Use `http://127.0.0.1:3100` for the demo server. |
| `MOOMORA_API_TOKEN` | _(unset)_ | If set, sent as `Authorization: Bearer <token>` (for a future authenticated ingress). |

## Register with Claude Code

```bash
claude mcp add moomora \
  --env MOOMORA_API_URL=http://127.0.0.1:3100 \
  -- node /ABSOLUTE/PATH/TO/repo/mcp/server.js
```

Replace `/ABSOLUTE/PATH/TO/repo` with the absolute path to this repository. Verify the
registration with `claude mcp list`. (Confirm the exact `claude mcp add` flag syntax with
`claude mcp add --help` for your installed Claude Code version.)

## Tools

Reads: `search_documents`, `get_document`, `search_tasks`, `get_task`,
`list_task_documents`.
Writes: `create_document`, `update_document`, `create_task`, `update_task`,
`link_task_document`, `unlink_task_document`.

No archive, delete, reorder, or import tools are exposed.

## Smoke test (manual)

1. Start Moomora: `npm run demo` (API on `:3100`).
2. Register the server (above) with `MOOMORA_API_URL=http://127.0.0.1:3100`.
3. In Claude Code, confirm the round-trip:
   - "search documents for <a term you know exists>" → returns refs.
   - "get document <id from the search>" → returns the full body.
   - "create a note titled 'mcp smoke' in the work context with body 'hello'" → returns
     the new document; confirm it appears in the Library UI.
   - "link document <id> to task <id>" then "list documents for task <id>" → shows the link.
```

- [ ] **Step 2: Add a pointer in the root `README.md`**

Under the `## Scripts` section (after the existing bullet list), add:

```markdown
An optional local MCP server lives in `mcp/` — it exposes the Moomora API to Claude Code so
you can query and edit tasks and documents interactively on a Claude subscription. See
[mcp/README.md](mcp/README.md).
```

- [ ] **Step 3: Verify the docs reference real paths**

Run: `ls mcp/server.js docs/superpowers/specs/2026-05-20-moomora-mcp-design.md`
Expected: both paths exist.

- [ ] **Step 4: Commit**

```bash
git add mcp/README.md README.md
git commit -m "$(cat <<'EOF'
docs: document the Moomora MCP server (config, registration, smoke test)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Final verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite and syntax check**

Run: `npm test && npm run check`
Expected: all tests pass (existing backend/frontend + the 9 new `tests/mcp/*` files); `npm run check` exits 0.

- [ ] **Step 2: Manual end-to-end smoke (documented, not automated)**

Follow the smoke checklist in `mcp/README.md` against a running `npm run demo` server. Confirm a `search_documents` → `get_document` → `create_document` → `link_task_document` → `list_task_documents` round-trip works through Claude Code. This step requires interactive Claude Code and is not part of `npm test`.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/mcp-server
```

---

## Self-Review

**1. Spec coverage:**

- Architecture (`mcp/` layout, stdio, single HTTP boundary, domain tool modules) → Tasks 6–10. ✔
- `moomoraClient.js` env config (`MOOMORA_API_URL`, optional `MOOMORA_API_TOKEN` bearer) → Task 6 + README Task 11. ✔
- All 11 tools with the spec's exact args/enums → Tasks 7–9; enums (`context`, `documentType`, `status`, `priority`) match the API. ✔
- No destructive tools (archive/delete/reorder/import) → none defined. ✔
- Optional `context` filter defaulting to all → `context` is `.optional()` in search tools; client omits empty query params. ✔
- Two-tier search/get (refs without bodies, then full) → `toDocumentRef`/`toTaskRef` + `capResults` in Task 4, applied in Tasks 7–8. ✔
- Snippet sourcing trims bodies in the MCP layer, API unchanged → `snippet()` in Task 4; no server/ changes anywhere in the plan. ✔
- Error handling (typed client errors → friendly `isError` results; up-front UUID validation; 404 → friendly message; no write retries; ~5s timeout) → Tasks 2, 5, 6, 7–9. ✔
- Testing (handler unit tests with stub client; client tests with mocked fetch; manual smoke) → every module has a test task; smoke in Tasks 11–12. ✔
- Registration command + smoke checklist → Task 11. ✔

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step contains full code; every run step has an expected result. ✔

**3. Type consistency:** Client method names (`listDocuments`, `getDocument`, `createDocument`, `updateDocument`, `listTasks`, `getTask`, `createTask`, `updateTask`, `listTaskDocuments`, `linkTaskDocument`, `unlinkTaskDocument`) are identical in Task 6 and in the tool factories (Tasks 7–9) and their stub clients. Helper names (`isValidUuid`, `snippet`, `toDocumentRef`, `toTaskRef`, `capResults`, `okResult`, `errorResult`, `withErrorHandling`) are defined once (Tasks 3–5) and imported consistently. Result envelope shape (`content[0].text`, `isError`) is asserted identically across all tool tests. ✔

One known design limitation (documented, intentional): `getDocument`/`getTask` fetch the list endpoint and filter by id, because the API has no `GET /:id` detail route. This is acceptable at homelab scale and keeps the API unchanged; a dedicated detail endpoint is a possible future optimization.
