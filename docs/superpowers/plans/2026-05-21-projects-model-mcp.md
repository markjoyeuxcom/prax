# Projects Model — MCP (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the MCP server from the removed fixed `context` to the project model so the tools work against the project-based API: rename the `context` tool argument to `project` (a slug-or-id string the API resolves), emit `projectId` in search refs, and send `project` (not `context`) in list filters and create/update payloads.

**Architecture:** The MCP tools pass a `project` string straight through to the HTTP client; the backend (Phase 1) resolves slug-or-id and validates existence, so no MCP-side resolution is needed. `shape.js` ref builders return `projectId` (documents/tasks now carry `projectId`, not `context`). The HTTP client's list methods send `?project=` instead of `?context=`.

**Tech Stack:** Node.js (ESM), `@modelcontextprotocol/sdk`, `zod`, Node's built-in test runner. The tool descriptors are pure factories tested with a stubbed client; the client is tested with a stubbed fetch.

Spec: `docs/superpowers/specs/2026-05-20-projects-model-design.md` (MCP section). This is **Phase 3 of 3** — the final slice; after it the `feat/projects-model` branch is ready for a final review + PR. (Dedicated `list_projects`/`create_project` MCP tools remain a separate future slice, per the spec.)

---

## Conventions for the executor

- **Commits:** conventional-commit; **every commit MUST include both co-author trailers**:
  ```
  Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- **Branch:** `feat/projects-model` (holds Phases 1, 2a, 2b).
- **Tests:** `node --test tests/mcp/<file>.test.js`; whole suite `npm test`; `npm run check`.
- **TDD:** update the test expectations (context→project) first, see them fail, edit source, see them pass, commit.

## Why this is needed (current breakage)

After Phase 1, the API dropped `context`: list endpoints filter on `?project=`, and create/update require `project`. The MCP tools still send `context` (a `z.enum`), so today: `create_document`/`create_task` POST `context` → the API rejects with "project is required"; list filters send `?context=` → ignored (cross-project); and `search_*` refs surface `context: undefined` because documents/tasks now carry `projectId`. This phase fixes all three.

## File structure

```
mcp/
├── shape.js               MODIFY  toDocumentRef/toTaskRef emit projectId (not context)
├── moomoraClient.js       MODIFY  listDocuments/listTasks send ?project= (not ?context=)
├── tools/documents.js     MODIFY  context arg -> project (slug-or-id string); drop CONTEXT enum
├── tools/tasks.js         MODIFY  context arg -> project; drop CONTEXT enum
└── README.md              MODIFY  tool descriptions reference project, not context
tests/mcp/
├── shape.test.js          MODIFY
├── moomoraClient.test.js  MODIFY
├── documentsTools.test.js MODIFY
└── tasksTools.test.js     MODIFY
```

---

## Task 1: `shape.js` refs emit `projectId`

**Files:**
- Modify: `mcp/shape.js`
- Modify: `tests/mcp/shape.test.js`

- [ ] **Step 1: Update `tests/mcp/shape.test.js`**

Read it. In the `toDocumentRef` test, the sample doc currently has `context: 'homelab'` and the expected ref has `context: 'homelab'`; change BOTH to `projectId: 'homelab'` (i.e. the input doc carries `projectId` and the ref echoes it). In the `toTaskRef` test, the sample task's `context: 'homelab'` and the expected ref's `context` likewise become `projectId: 'homelab'`. Leave the other asserted fields unchanged.

Run: `node --test tests/mcp/shape.test.js`
Expected: FAIL (refs still emit `context`).

- [ ] **Step 2: Edit `mcp/shape.js`**

In `toDocumentRef`, replace the line `    context: doc.context,` with:
```javascript
    projectId: doc.projectId,
```
In `toTaskRef`, replace `    context: task.context,` with:
```javascript
    projectId: task.projectId,
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test tests/mcp/shape.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp/shape.js tests/mcp/shape.test.js
git commit -m "$(cat <<'EOF'
refactor: MCP refs emit projectId instead of context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: HTTP client list filters use `project`

**Files:**
- Modify: `mcp/moomoraClient.js`
- Modify: `tests/mcp/moomoraClient.test.js`

- [ ] **Step 1: Update `tests/mcp/moomoraClient.test.js`**

Read it. In the `listDocuments` test, change the call argument and the asserted query param from `context` to `project`: e.g. `client.listDocuments({ q: 'backup', context: 'homelab', documentType: undefined })` → `{ q: 'backup', project: 'homelab', documentType: undefined }`, and `url.searchParams.get('context')` → `url.searchParams.get('project')` (expecting `'homelab'`). Any `listTasks` filter that passes `context` likewise becomes `project`. (The auth-header test that calls `listTasks({})` needs no change.)

Run: `node --test tests/mcp/moomoraClient.test.js`
Expected: FAIL.

- [ ] **Step 2: Edit `mcp/moomoraClient.js`**

Replace the `listDocuments` method:
```javascript
    listDocuments: ({ q, context, documentType } = {}) =>
      request('GET', '/api/library/documents', { query: { q, context, documentType } }),
```
with:
```javascript
    listDocuments: ({ q, project, documentType } = {}) =>
      request('GET', '/api/library/documents', { query: { q, project, documentType } }),
```
Replace the `listTasks` method:
```javascript
    listTasks: ({ q, context, status } = {}) =>
      request('GET', '/api/tasks', { query: { q, context, status } }),
```
with:
```javascript
    listTasks: ({ q, project, status } = {}) =>
      request('GET', '/api/tasks', { query: { q, project, status } }),
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test tests/mcp/moomoraClient.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp/moomoraClient.js tests/mcp/moomoraClient.test.js
git commit -m "$(cat <<'EOF'
refactor: MCP client list filters send project instead of context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Document tools use `project`

**Files:**
- Modify: `mcp/tools/documents.js`
- Modify: `tests/mcp/documentsTools.test.js`

- [ ] **Step 1: Update `tests/mcp/documentsTools.test.js`**

Read it. Apply these changes:
- `SAMPLE_DOC` currently has `context: 'homelab'`; change to `projectId: 'homelab'`.
- The `search_documents` test that asserts the client received `{ q: 'upgrade', context: 'homelab', documentType: undefined }` → change to `{ q: 'upgrade', project: 'homelab', documentType: undefined }`, and change the handler call `tool.handler({ query: 'upgrade', context: 'homelab' })` → `{ query: 'upgrade', project: 'homelab' }`.
- The `search_documents allows an omitted query` test (if present) asserting `{ q: undefined, context: 'homelab', documentType: undefined }` → `{ q: undefined, project: 'homelab', documentType: undefined }`, with the handler call `{ context: 'homelab' }` → `{ project: 'homelab' }`.
- The `create_document` test payload `{ title, body, documentType, context: 'work', tags }` → replace `context: 'work'` with `project: 'work'` and assert the client received `project: 'work'`.
- Any ref-shape assertion expecting `body` absent stays; if a test asserts `data[0].context`, change to `data[0].projectId`.

Run: `node --test tests/mcp/documentsTools.test.js`
Expected: FAIL.

- [ ] **Step 2: Edit `mcp/tools/documents.js`**

- Delete the line `const CONTEXT = z.enum(['personal', 'work', 'homelab']);`.
- `search_documents`:
  - In the description string, change "...without bodies. Call get_document..." part that reads "id, title, type, context, tags, snippet" to "id, title, type, project, tags, snippet".
  - Replace the inputSchema line `context: CONTEXT.optional().describe('Limit to one context; omit to search all.'),` with:
    ```javascript
        project: z.string().optional().describe('Limit to one project (slug or id); omit to search all.'),
    ```
  - Change the `query` describe text "Omit to browse by context/tags alone." to "Omit to browse by project/tags alone."
  - Change the handler signature `async ({ query, context, documentType, tags })` to `async ({ query, project, documentType, tags })`.
  - Change `const docs = await client.listDocuments({ q: query, context, documentType });` to `({ q: query, project, documentType })`.
- `create_document`: replace `context: CONTEXT,` with:
  ```javascript
        project: z.string().describe('Project slug or id.'),
  ```
- `update_document`: replace `context: CONTEXT.optional(),` with:
  ```javascript
        project: z.string().optional().describe('Project slug or id.'),
  ```
  (The create/update handlers pass `args`/`patch` straight to the client, so `project` flows into the payload automatically.)

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test tests/mcp/documentsTools.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp/tools/documents.js tests/mcp/documentsTools.test.js
git commit -m "$(cat <<'EOF'
refactor: MCP document tools accept project (slug-or-id) not context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Task tools use `project`

**Files:**
- Modify: `mcp/tools/tasks.js`
- Modify: `tests/mcp/tasksTools.test.js`

- [ ] **Step 1: Update `tests/mcp/tasksTools.test.js`**

Read it. Apply these changes:
- `SAMPLE_TASK` currently has `context: 'homelab'`; change to `projectId: 'homelab'`.
- The `search_tasks` test asserting the client received `{ q: 'backup', context: 'homelab', status: 'planned' }` → `{ q: 'backup', project: 'homelab', status: 'planned' }`, and the handler call `{ query: 'backup', context: 'homelab', status: 'planned' }` → `{ query: 'backup', project: 'homelab', status: 'planned' }`.
- The `create_task` tests: payloads `{ title, context: 'work', ... }` → replace `context: 'work'` with `project: 'work'`; the minimal-defaults test `{ title: 'Minimal', context: 'homelab' }` → `{ title: 'Minimal', project: 'homelab' }`, and its expected `received` deepEqual `{ priority:'medium', status:'planned', title:'Minimal', context:'homelab' }` → `{ priority:'medium', status:'planned', title:'Minimal', project:'homelab' }`. The override test `{ title:'X', context:'work', priority:'high', status:'in-progress' }` → `context`→`project`.
- Any ref-shape assertion expecting `data[0].context` → `data[0].projectId`; `'description' in data[0]` stays.

Run: `node --test tests/mcp/tasksTools.test.js`
Expected: FAIL.

- [ ] **Step 2: Edit `mcp/tools/tasks.js`**

- Delete the line `const CONTEXT = z.enum(['personal', 'work', 'homelab']);`.
- `search_tasks`:
  - In the description string, change "id, title, status, priority, context, dueDate" to "id, title, status, priority, project, dueDate".
  - Replace `context: CONTEXT.optional().describe('Limit to one context; omit for all.'),` with:
    ```javascript
        project: z.string().optional().describe('Limit to one project (slug or id); omit for all.'),
    ```
  - Change the handler signature `async ({ query, context, status })` to `async ({ query, project, status })`.
  - Change `const tasks = await client.listTasks({ q: query, context, status });` to `({ q: query, project, status })`.
- `create_task`: replace `context: CONTEXT,` with:
  ```javascript
        project: z.string().describe('Project slug or id.'),
  ```
- `update_task`: replace `context: CONTEXT.optional(),` with:
  ```javascript
        project: z.string().optional().describe('Project slug or id.'),
  ```
  (The create handler's `{ priority: 'medium', status: 'planned', ...args }` spread and the update handler's `...patch` pass `project` through unchanged.)

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test tests/mcp/tasksTools.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp/tools/tasks.js tests/mcp/tasksTools.test.js
git commit -m "$(cat <<'EOF'
refactor: MCP task tools accept project (slug-or-id) not context

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Docs + full verification + smoke + push

**Files:**
- Modify: `mcp/README.md`

- [ ] **Step 1: Update `mcp/README.md`**

Read it. Replace any tool argument/description references to "context" (the old personal/work/homelab field) with "project (slug or id)". In particular, if the README documents tool arguments or includes a "context handling" note, reword it to describe the optional `project` filter (slug-or-id; omit for all projects). Do not change unrelated prose.

- [ ] **Step 2: Confirm no stray `context` argument remains in the MCP tool surface**

Run: `grep -rn "CONTEXT\|context:" mcp/tools/ mcp/moomoraClient.js mcp/shape.js`
Expected: no matches (the only acceptable remaining "context" would be in unrelated prose/comments, not as a tool arg, enum, query key, or ref field).

- [ ] **Step 3: Full suite + check**

Run: `npm test && npm run check`
Expected: all tests pass; `npm run check` exits 0.

- [ ] **Step 4: End-to-end MCP smoke against the demo server**

Create a temporary smoke script `_mcp_smoke.mjs` at the repo root:
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const parse = (res) => JSON.parse(res.content[0].text);
const transport = new StdioClientTransport({
  command: 'node',
  args: ['mcp/server.js'],
  env: { ...process.env, MOOMORA_API_URL: 'http://127.0.0.1:3100' },
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);
let failures = 0;
const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

const docs = parse(await client.callTool({ name: 'search_documents', arguments: { query: 'restore', project: 'homelab' } }));
check('search_documents(project=homelab) returns refs with projectId', docs.length > 0 && 'projectId' in docs[0] && !('body' in docs[0]));

const created = parse(await client.callTool({ name: 'create_document', arguments: { title: 'mcp p3 smoke', body: 'hi', documentType: 'note', project: 'work' } }));
check('create_document(project=work) succeeds', !!created.id);

const task = parse(await client.callTool({ name: 'create_task', arguments: { title: 'mcp p3 task', project: 'homelab' } }));
check('create_task(project=homelab) succeeds with defaults', !!task.id && task.priority === 'medium');

const badProject = await client.callTool({ name: 'create_task', arguments: { title: 'x', project: 'does-not-exist' } });
check('create_task(unknown project) -> isError', badProject.isError === true);

await client.close();
console.log(failures === 0 ? '\nALL MCP SMOKE CHECKS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```
Run:
```bash
npm run demo > /tmp/demo.log 2>&1 &
until curl -sf http://127.0.0.1:3100/healthz >/dev/null; do sleep 0.5; done
node _mcp_smoke.mjs 2>&1 | grep -v "running on stdio"
RESULT=$?
pkill -f scripts/demo-server.js
rm -f _mcp_smoke.mjs
test $RESULT -eq 0
```
Expected: all smoke checks PASS (search returns refs with `projectId`; create with a `project` slug succeeds; an unknown project surfaces a tool error). Remove the smoke script afterward (the command above deletes it).

- [ ] **Step 5: Commit the README and push**

```bash
git add mcp/README.md
git commit -m "$(cat <<'EOF'
docs: MCP README describes the project arg (slug or id)

Co-Authored-By: Mark Joyeux <mark.joyeux@markjoyeux.com>
Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git push origin feat/projects-model
```

---

## Self-Review

**1. Spec coverage (MCP section of the design spec):**
- Rename `context` arg → `project` (z.string) across `search_documents`, `search_tasks`, `create_document`, `update_document`, `create_task`, `update_task`; drop the `CONTEXT` enum → Tasks 3 & 4. ✔
- Tools pass `project` to the API's `?project=` filter / payload (slug-or-id resolved server-side) → list filters via client (Task 2), create/update via pass-through payload (Tasks 3 & 4). ✔
- Search refs reflect the project (`projectId`) instead of the removed `context` → Task 1 (`shape.js`). ✔
- Update the MCP README/tool descriptions → Tasks 3, 4 (descriptions) + Task 5 (README). ✔
- Dedicated `list_projects`/`create_project` tools remain deferred (not in scope) → not implemented; noted. ✔

**2. Placeholder scan:** Every edit is a concrete symbol-level replacement against the verified current code (exact old → new snippets). The smoke script is given in full. No "TBD"/"handle X" vagueness.

**3. Type/name consistency:** The tool argument is `project` (a slug-or-id string) everywhere; the client list query key is `project`; documents/tasks expose `projectId` (so `shape.js` refs use `projectId`, matching the backend's `normalize*Row`). The `CONTEXT` enum is removed from both tool modules. Create/update handlers are unchanged in body (they spread `args`/`patch`), so renaming the schema key is sufficient to send `project` in the payload. Test fixtures (`SAMPLE_DOC`/`SAMPLE_TASK`) switch their `context` field to `projectId` to match the new ref shape.
