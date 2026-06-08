# Memory Skills → CLI Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `moomora-recall` / `moomora-remember` skills and the `moomora` CLI share one implementation by extracting `recall`/`remember` into `cli/lib/*` modules that both consume — adding a cross-project `moomora recall` and a `moomora remember --memory` flag — with no backend or schema change.

**Architecture:** Three layers. `cli/lib/apiClient.js` stays the pure HTTP layer (gains friendly not-reachable mapping, `err.status`, `ensureProject`, `listDocuments`). New `cli/lib/recall.js` and `cli/lib/remember.js` hold the operations as pure functions over an injected client. Every entrypoint — the `moomora` CLI commands and the zero-install skill `.mjs` wrappers — does `createClient()` → operation → format → stdout.

**Tech Stack:** Vanilla ES modules (Node 20+ global `fetch`), Node's built-in `node:test`. Reference spec: [`docs/superpowers/specs/2026-06-07-memory-skills-cli-convergence-design.md`](../specs/2026-06-07-memory-skills-cli-convergence-design.md).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `cli/lib/apiClient.js` | HTTP layer | not-reachable mapping, `err.status`, `ensureProject`, `listDocuments` |
| `tests/cli/apiClient.test.js` | client unit tests | NEW |
| `cli/lib/recall.js` | recall operation + `formatRecall` | NEW |
| `tests/cli/recall.test.js` | recall unit tests | NEW |
| `cli/lib/remember.js` | remember operation | NEW |
| `tests/cli/remember.test.js` | remember unit tests | NEW |
| `cli/moomora.js` | CLI entry | add `recall`; refactor `remember`; HELP |
| `package.json` | `check` script | add the two new lib files |
| `.claude/skills/moomora-recall/recall.mjs` | skill entrypoint | rewrite → thin wrapper |
| `.claude/skills/moomora-remember/remember.mjs` | skill entrypoint | rewrite → thin wrapper |
| `.claude/skills/moomora-recall/SKILL.md`, `.../moomora-remember/SKILL.md` | docs | note shared modules |
| `docs/agent-memory.md`, `CHANGELOG.md` | docs | CLI equivalents + changelog |

Run one test file with `node --test <path>`; the full suite with `npm test`; syntax check with `npm run check`.

---

## Task 1: `apiClient.js` — not-reachable mapping, `err.status`, `ensureProject`, `listDocuments`

**Files:**
- Modify: `cli/lib/apiClient.js`
- Test: `tests/cli/apiClient.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/apiClient.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../../cli/lib/apiClient.js';

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('request maps a network failure to a friendly not-reachable error', async () => {
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  const client = createClient({ baseUrl: 'http://x' });
  await assert.rejects(
    client.getDocument('d1'),
    /Moomora not reachable at http:\/\/x — is the app running\? \(fetch failed\)/,
  );
});

test('request attaches the HTTP status to thrown errors', async () => {
  globalThis.fetch = async () => jsonRes(409, { message: 'semantic search is not enabled' });
  const client = createClient({ baseUrl: 'http://x' });
  await assert.rejects(client.semanticSearch(undefined, 'q', {}), (err) => {
    assert.equal(err.status, 409);
    assert.match(err.message, /semantic search is not enabled/);
    return true;
  });
});

test('ensureProject returns the slug of an existing project without creating', async () => {
  const methods = [];
  globalThis.fetch = async (url, opts) => {
    methods.push(opts?.method || 'GET');
    return jsonRes(200, [{ slug: 'memory', name: 'Memory' }]);
  };
  const client = createClient({ baseUrl: 'http://x' });
  assert.equal(await client.ensureProject('memory'), 'memory');
  assert.deepEqual(methods, ['GET']);
});

test('ensureProject creates the project when missing', async () => {
  const methods = [];
  globalThis.fetch = async (url, opts) => {
    const method = opts?.method || 'GET';
    methods.push(method);
    if (method === 'POST') return jsonRes(201, { slug: 'memory' });
    return jsonRes(200, []);
  };
  const client = createClient({ baseUrl: 'http://x' });
  assert.equal(await client.ensureProject('memory'), 'memory');
  assert.ok(methods.includes('POST'));
});

test('listDocuments scopes by project when given and omits it otherwise', async () => {
  let captured;
  globalThis.fetch = async (url) => { captured = url; return jsonRes(200, []); };
  const client = createClient({ baseUrl: 'http://x' });
  await client.listDocuments('homelab');
  assert.match(captured, /\/api\/library\/documents\?project=homelab$/);
  await client.listDocuments();
  assert.match(captured, /\/api\/library\/documents$/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/cli/apiClient.test.js`
Expected: FAIL — `client.ensureProject` / `listDocuments` are not functions; the not-reachable and status assertions fail.

- [ ] **Step 3: Update `request()` for not-reachable + status**

In `cli/lib/apiClient.js`, replace the `request` function body's fetch/throw section. Change:

```javascript
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
```

to:

```javascript
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Moomora not reachable at ${base} — is the app running? (${err.message})`);
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
```

- [ ] **Step 4: Add `ensureProject` and `listDocuments` methods**

In `cli/lib/apiClient.js`, inside the returned object, add these two methods after the `supersede(...)` method (before the closing `};`):

```javascript
    async ensureProject(target) {
      const projects = await request('GET', '/api/projects');
      const match = (Array.isArray(projects) ? projects : []).find(
        (p) => p.slug === target || (p.name && p.name.toLowerCase() === String(target).toLowerCase()),
      );
      if (match) return match.slug;
      const created = await request('POST', '/api/projects', { body: { name: target } });
      return created.slug;
    },
    listDocuments(project) {
      const qs = project && project !== 'all' ? `?project=${encodeURIComponent(project)}` : '';
      return request('GET', `/api/library/documents${qs}`);
    },
```

(Add a comma after the previous method's closing `}` so the object stays valid.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/cli/apiClient.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add cli/lib/apiClient.js tests/cli/apiClient.test.js
git commit -m "feat(cli): apiClient not-reachable mapping, err.status, ensureProject, listDocuments"
```

---

## Task 2: `cli/lib/recall.js` — recall operation + `formatRecall`

**Files:**
- Create: `cli/lib/recall.js`
- Test: `tests/cli/recall.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/recall.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { recall, formatRecall } from '../../cli/lib/recall.js';

const fakeClient = (overrides = {}) => ({
  semanticSearch: async () => [],
  keywordSearch: async () => [],
  getDocument: async () => ({}),
  listDocuments: async () => [],
  ...overrides,
});

test('recall returns a hit with the top body fetched and related preserved', async () => {
  const refs = [
    { id: 't', title: 'Top', documentType: 'note' },
    { id: 'r1', title: 'R1' }, { id: 'r2', title: 'R2' },
  ];
  const client = fakeClient({
    semanticSearch: async (project) => { assert.equal(project, undefined); return refs; },
    getDocument: async (id) => { assert.equal(id, 't'); return { id: 't', body: 'FULL BODY' }; },
  });
  const result = await recall(client, { query: 'x', limit: 5 });
  assert.equal(result.kind, 'hit');
  assert.equal(result.top.body, 'FULL BODY');
  assert.deepEqual(result.related.map((r) => r.id), ['r1', 'r2']);
});

test('recall reports an honest miss on empty semantic results', async () => {
  const result = await recall(fakeClient(), { query: 'nope' });
  assert.deepEqual(result, { kind: 'empty', query: 'nope', note: null });
  assert.equal(formatRecall(result), 'No relevant memory found for: "nope"');
});

test('recall falls back to keyword search on a 409 (semantic disabled)', async () => {
  const client = fakeClient({
    semanticSearch: async () => { const e = new Error('semantic search is not enabled'); e.status = 409; throw e; },
    keywordSearch: async () => [{ id: 'k', title: 'Kw', documentType: 'runbook', body: 'b' }],
  });
  const result = await recall(client, { query: 'x' });
  assert.equal(result.kind, 'hit');
  assert.equal(result.note, 'semantic search disabled — keyword results');
  assert.match(formatRecall(result), /\(semantic search disabled — keyword results\)/);
});

test('recall rethrows non-409 errors (e.g. not reachable)', async () => {
  const client = fakeClient({ semanticSearch: async () => { throw new Error('Moomora not reachable at http://x'); } });
  await assert.rejects(recall(client, { query: 'x' }), /not reachable/);
});

test('recall --recent lists most-recent docs sorted by updatedAt desc', async () => {
  const client = fakeClient({
    listDocuments: async () => [
      { id: 'a', title: 'A', updatedAt: '2026-01-01', body: 'aa' },
      { id: 'b', title: 'B', updatedAt: '2026-03-01', body: 'bb' },
    ],
  });
  const result = await recall(client, { recent: true, limit: 5 });
  assert.equal(result.kind, 'recent');
  assert.deepEqual(result.items.map((i) => i.id), ['b', 'a']);
  assert.match(formatRecall(result), /Most recent 2 document\(s\):/);
});

test('formatRecall trims the hit body to 800 chars with an ellipsis', () => {
  const big = 'x'.repeat(900);
  const out = formatRecall({ kind: 'hit', note: null, top: { id: 't', title: 'T', documentType: 'note', body: big }, related: [] });
  assert.ok(out.includes('…'));
  assert.ok(out.length < 900);
});

test('formatRecall renders the Related list for hits', () => {
  const out = formatRecall({
    kind: 'hit', note: null,
    top: { id: 't', title: 'Top', documentType: 'note', body: 'b' },
    related: [{ id: 'r1', title: 'R1' }],
  });
  assert.match(out, /## Top {2}\(note · t\)/);
  assert.match(out, /Related:/);
  assert.match(out, /- R1 — r1/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/cli/recall.test.js`
Expected: FAIL — cannot import `recall` / `formatRecall` (module does not exist).

- [ ] **Step 3: Write `cli/lib/recall.js`**

Create `cli/lib/recall.js`:

```javascript
// cli/lib/recall.js — the one implementation of "recall": semantic-first (→ keyword
// on a 409 = semantic-disabled), distilled to a compact result, plus a chronological
// --recent mode. Pure of I/O: takes an injected client and returns a structured
// result; formatRecall renders it. Shared by `moomora recall` and the moomora-recall
// skill wrapper.

const BODY_CHARS = 800;
const RELATED_MAX = 5;

function trimBody(body) {
  const text = String(body || '').trim();
  return text.length <= BODY_CHARS ? text : `${text.slice(0, BODY_CHARS).trimEnd()}…`;
}

export async function recall(client, { query, project, limit = 5, recent = false } = {}) {
  if (recent) {
    const docs = await client.listDocuments(project || undefined);
    const items = (Array.isArray(docs) ? docs : [])
      .slice()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit)
      .map((d) => ({
        title: d.title || 'Untitled',
        id: d.id,
        snippet: String(d.body || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      }));
    return { kind: 'recent', project: project || '', items };
  }

  let refs;
  try {
    refs = await client.semanticSearch(project || undefined, query, {});
  } catch (err) {
    if (err && err.status === 409) {
      const docs = await client.keywordSearch(project || undefined, query, {});
      const kept = (Array.isArray(docs) ? docs : []).slice(0, limit);
      if (kept.length === 0) return { kind: 'empty', query, note: 'keyword' };
      return { kind: 'hit', note: 'semantic search disabled — keyword results', top: kept[0], related: kept.slice(1) };
    }
    throw err;
  }

  const list = Array.isArray(refs) ? refs : [];
  if (list.length === 0) return { kind: 'empty', query, note: null };
  const kept = list.slice(0, limit);
  const topDoc = await client.getDocument(kept[0].id).catch(() => null);
  return {
    kind: 'hit',
    note: null,
    top: { ...kept[0], body: topDoc ? topDoc.body : kept[0].body },
    related: kept.slice(1),
  };
}

export function formatRecall(result) {
  if (!result) return '';
  if (result.kind === 'empty') {
    const suffix = result.note === 'keyword' ? ' (keyword; semantic search is disabled)' : '';
    return `No relevant memory found for: "${result.query}"${suffix}`;
  }
  if (result.kind === 'recent') {
    if (!result.items.length) return 'No documents yet.';
    const scope = result.project ? ` in "${result.project}"` : '';
    const head = `Most recent ${result.items.length} document(s)${scope}:`;
    const lines = result.items.map((d) => `- ${d.title} — ${d.id}${d.snippet ? ` — ${d.snippet}` : ''}`);
    return [head, ...lines].join('\n');
  }
  // kind: 'hit'
  const lines = [];
  if (result.note) lines.push(`(${result.note})`);
  const top = result.top;
  lines.push(`## ${top.title || 'Untitled'}  (${top.documentType || 'note'} · ${top.id})`);
  lines.push('');
  lines.push(trimBody(top.body));
  const related = (result.related || []).slice(0, RELATED_MAX);
  if (related.length) {
    lines.push('');
    lines.push('Related:');
    for (const r of related) lines.push(`- ${r.title || 'Untitled'} — ${r.id}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/cli/recall.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/recall.js tests/cli/recall.test.js
git commit -m "feat(cli): shared recall operation + formatRecall distiller"
```

---

## Task 3: `cli/lib/remember.js` — remember operation

**Files:**
- Create: `cli/lib/remember.js`
- Test: `tests/cli/remember.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/remember.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { remember } from '../../cli/lib/remember.js';

const fakeClient = (overrides = {}) => ({
  ensureProject: async (p) => p,
  findByTitle: async () => [],
  createMemory: async (doc) => ({ id: 'new', ...doc }),
  updateMemory: async (id, patch) => ({ id, ...patch }),
  ...overrides,
});

test('remember ensures the target project and creates without a kind field by default', async () => {
  let ensured; let created;
  const client = fakeClient({
    ensureProject: async (p) => { ensured = p; return p; },
    createMemory: async (doc) => { created = doc; return { id: 'new', ...doc }; },
  });
  const { doc, action } = await remember(client, { title: 'T', body: 'B', project: 'homelab', tags: ['x'] });
  assert.equal(ensured, 'homelab');
  assert.equal(action, 'created');
  assert.equal('kind' in created, false);
  assert.equal(created.project, 'homelab');
  assert.deepEqual(created.tags, ['x']);
  assert.equal(doc.id, 'new');
});

test('remember updates in place when an exact title already exists', async () => {
  let updatedId;
  const client = fakeClient({
    findByTitle: async () => [{ id: 'dup', title: 'T' }],
    updateMemory: async (id, patch) => { updatedId = id; return { id, ...patch }; },
  });
  const { action } = await remember(client, { title: 'T', body: 'B2', project: 'memory', tags: [] });
  assert.equal(action, 'updated');
  assert.equal(updatedId, 'dup');
});

test('remember does not treat a substring title match as a duplicate', async () => {
  let created = false;
  const client = fakeClient({
    findByTitle: async () => [{ id: 'other', title: 'T extended' }],
    createMemory: async (doc) => { created = true; return { id: 'new', ...doc }; },
  });
  const { action } = await remember(client, { title: 'T', body: 'B', project: 'memory', tags: [] });
  assert.equal(action, 'created');
  assert.ok(created);
});

test('remember forwards kind:synthesized into the create body when the caller passes it', async () => {
  let created;
  const client = fakeClient({ createMemory: async (doc) => { created = doc; return { id: 'n', ...doc }; } });
  await remember(client, { title: 'T', body: 'B', project: 'memory', tags: ['memory'], kind: 'synthesized' });
  assert.equal(created.kind, 'synthesized');
});

test('remember de-duplicates the passed tags', async () => {
  let created;
  const client = fakeClient({ createMemory: async (doc) => { created = doc; return { id: 'n', ...doc }; } });
  await remember(client, { title: 'T', body: 'B', project: 'memory', tags: ['memory', 'memory', 'a'] });
  assert.deepEqual(created.tags, ['memory', 'a']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/cli/remember.test.js`
Expected: FAIL — cannot import `remember` (module does not exist).

- [ ] **Step 3: Write `cli/lib/remember.js`**

Create `cli/lib/remember.js`:

```javascript
// cli/lib/remember.js — the one implementation of "remember": ensure the target
// project exists, de-dup by exact title, then create or update. The CALLER resolves
// the target project slug and composes tags/kind (namespace policy stays in the thin
// callers). Shared by `moomora remember` and the moomora-remember skill wrapper.

export async function remember(client, { title, body, project, type = 'note', tags = [], kind } = {}) {
  const slug = await client.ensureProject(project);
  const documentType = type === 'runbook' ? 'runbook' : 'note';
  const allTags = Array.from(new Set(tags));

  const existing = (await client.findByTitle(slug, title)).find((d) => d.title === title);
  if (existing) {
    const doc = await client.updateMemory(existing.id, { title, body, tags: allTags });
    return { doc, action: 'updated' };
  }
  const doc = await client.createMemory({
    title, body, documentType, project: slug, tags: allTags, ...(kind ? { kind } : {}),
  });
  return { doc, action: 'created' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/cli/remember.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/lib/remember.js tests/cli/remember.test.js
git commit -m "feat(cli): shared remember operation (ensure-project, dedup-by-title)"
```

---

## Task 4: Wire the CLI — `recall` command, `remember` refactor, HELP, `check` script

**Files:**
- Modify: `cli/moomora.js`
- Modify: `package.json` (the `check` script)

No new unit test (CLI entry wiring is exercised by the lib tests already written and the live smoke in Task 6). Verified by `npm run check` + `npm test`.

- [ ] **Step 1: Import the shared operations**

In `cli/moomora.js`, add to the import block near the top (after the existing `import { formatSearchResults, formatDocument } from './lib/format.js';` line):

```javascript
import { recall, formatRecall } from './lib/recall.js';
import { remember } from './lib/remember.js';
```

- [ ] **Step 2: Add the `recall` command**

In `cli/moomora.js`, insert this block immediately **before** the `if (command === 'get')` block:

```javascript
  if (command === 'recall') {
    const project = flags.project;
    const recent = flags.recent !== undefined && flags.recent !== false;
    let limit = flags.limit ? Number(flags.limit) : 5;
    if (recent && typeof flags.recent === 'string') {
      const n = Number(flags.recent);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
    const query = positionals.slice(1).join(' ');
    if (!recent && !query) throw new Error('recall requires a query (or use --recent).');
    const result = await recall(client, { query, project, limit, recent });
    out(flags.json ? result : formatRecall(result));
    return;
  }
```

- [ ] **Step 3: Refactor the `remember` command to use the shared module**

In `cli/moomora.js`, replace the entire existing `if (command === 'remember') { … }` block with:

```javascript
  if (command === 'remember') {
    const title = positionals[1];
    if (!title) throw new Error('remember requires a title.');
    const body = flags.body !== undefined && flags.body !== true ? String(flags.body) : '';
    const type = flags.type === 'runbook' ? 'runbook' : 'note';
    const project = flags.memory ? 'memory' : resolveProjectName(flags).project;
    const userTags = flags.tag ? String(flags.tag).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const tags = [...userTags, ...(flags.memory ? ['memory'] : [])];
    const { doc, action } = await remember(client, { title, body, project, type, tags });
    out(flags.json ? doc : `${action === 'updated' ? 'Updated' : 'Remembered'} "${doc.title}" (${doc.id}) — unverified.`);
    return;
  }
```

(The CLI uses comma-split `--tag a,b` — the existing arg parser is single-value-per-flag, so comma-split is the faithful way to deliver the spec's multi-tag intent without parser surgery.)

- [ ] **Step 4: Update the HELP text**

In `cli/moomora.js`, in the `HELP` template literal, insert the `recall` line after the `search` line and change the `remember` line. The Usage block becomes:

```
Usage:
  moomora init [--project <slug>]
  moomora context [query...] [--json] [--limit <n>]
  moomora search <query> [--all] [--json]
  moomora recall [query...] [--project <slug>] [--limit <n>] [--recent [n]] [--json]
  moomora get <id> [--json]
  moomora remember <title> [--body <text>] [--memory] [--type runbook|note] [--tag a,b]
  moomora verify <id> [--as <name>]
  moomora unverify <id>
  moomora supersede <oldId> --with <newId>
```

- [ ] **Step 5: Add the new lib files to the `check` script**

In `package.json`, change the end of the `"check"` script value from:

```
... && node --check cli/lib/apiClient.js && node --check cli/lib/format.js"
```

to:

```
... && node --check cli/lib/apiClient.js && node --check cli/lib/format.js && node --check cli/lib/recall.js && node --check cli/lib/remember.js"
```

- [ ] **Step 6: Verify syntax + full suite**

Run: `node --check cli/moomora.js && npm run check`
Expected: no output (exit 0).
Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add cli/moomora.js package.json
git commit -m "feat(cli): add 'moomora recall'; remember uses shared module + --memory"
```

---

## Task 5: Rewrite the skill wrappers as thin pass-throughs

**Files:**
- Modify: `.claude/skills/moomora-recall/recall.mjs`
- Modify: `.claude/skills/moomora-remember/remember.mjs`

No new unit test (the wrappers are trivially thin over already-tested modules; verified by `node --check` and the Task 6 live smoke).

- [ ] **Step 1: Rewrite `recall.mjs`**

Replace the entire contents of `.claude/skills/moomora-recall/recall.mjs` with:

```javascript
#!/usr/bin/env node
// moomora-recall — thin wrapper over the shared cli/lib recall operation, so the
// skill and the `moomora` CLI share one code path. Zero-install: imports the repo's
// own lib by relative path; no global `moomora` needed.
import { createClient } from '../../../cli/lib/apiClient.js';
import { recall, formatRecall } from '../../../cli/lib/recall.js';

function parseArgs(argv) {
  const out = { query: '', project: '', limit: 5, recent: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') { out.project = argv[++i] || ''; }
    else if (a === '--limit') { const n = Number(argv[++i]); out.limit = Number.isFinite(n) && n > 0 ? n : 5; }
    else if (a === '--recent') {
      out.recent = true;
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) { out.limit = n; i += 1; }
    } else rest.push(a);
  }
  out.query = rest.join(' ').trim();
  return out;
}

async function main() {
  const { query, project, limit, recent } = parseArgs(process.argv.slice(2));
  if (!recent && !query) {
    console.error('Usage: node recall.mjs "<query>" [--project <slug>] [--limit <n>]  |  node recall.mjs --recent [n] [--project <slug>]');
    process.exit(1);
  }
  const result = await recall(createClient(), { query, project, limit, recent });
  console.log(formatRecall(result));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 2: Rewrite `remember.mjs`**

Replace the entire contents of `.claude/skills/moomora-remember/remember.mjs` with:

```javascript
#!/usr/bin/env node
// moomora-remember — thin wrapper over the shared cli/lib remember operation. Writes
// agent memory (synthesized, memory-tagged) to the `memory` project by default.
// Zero-install: imports the repo's own lib by relative path; no global `moomora`.
import { createClient } from '../../../cli/lib/apiClient.js';
import { remember } from '../../../cli/lib/remember.js';

function parseArgs(argv) {
  const out = { tags: [], type: 'note', project: 'memory' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tags') { out.tags = String(argv[++i] || '').split(',').map((t) => t.trim()).filter(Boolean); }
    else if (a === '--type') { out.type = argv[++i] || 'note'; }
    else if (a === '--project') { out.project = argv[++i] || 'memory'; }
    else rest.push(a);
  }
  out.title = (rest[0] || '').trim();
  out.body = (rest[1] || '').trim();
  return out;
}

async function main() {
  const { title, body, tags, type, project } = parseArgs(process.argv.slice(2));
  if (!title || !body) {
    console.error('Usage: node remember.mjs "<title>" "<body>" [--tags a,b] [--type note|runbook] [--project <slug>]');
    process.exit(1);
  }
  const { doc, action } = await remember(createClient(), {
    title, body, project, type, tags: ['memory', ...tags], kind: 'synthesized',
  });
  console.log(`Remembered "${title}" → ${doc.id} (${action})`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 3: Verify syntax**

Run: `node --check .claude/skills/moomora-recall/recall.mjs && node --check .claude/skills/moomora-remember/remember.mjs`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/moomora-recall/recall.mjs .claude/skills/moomora-remember/remember.mjs
git commit -m "refactor(skills): recall/remember .mjs are thin wrappers over cli/lib"
```

---

## Task 6: Docs, CHANGELOG, and live end-to-end verification

**Files:**
- Modify: `.claude/skills/moomora-recall/SKILL.md`, `.claude/skills/moomora-remember/SKILL.md`
- Modify: `docs/agent-memory.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Note the shared modules in both SKILL.md files**

In `.claude/skills/moomora-recall/SKILL.md`, add this line at the end of the `## How to run` section (after the existing run instructions):

```markdown
> Implementation note: this script is a thin wrapper over `cli/lib/recall.js` — the same
> operation behind `moomora recall`. The `node …/recall.mjs` invocation is unchanged and needs
> no global `moomora` install.
```

In `.claude/skills/moomora-remember/SKILL.md`, add at the end of its `## How to run` section:

```markdown
> Implementation note: this script is a thin wrapper over `cli/lib/remember.js` — the same
> operation behind `moomora remember`. The `node …/remember.mjs` invocation is unchanged and
> needs no global `moomora` install.
```

- [ ] **Step 2: Document the human-CLI equivalents in `docs/agent-memory.md`**

In `docs/agent-memory.md`, add a short subsection (place it after the part that introduces the recall/remember skills — search for `moomora-recall` to find the spot):

```markdown
### Human CLI equivalents

The skills now share one code path with the `moomora` CLI (`cli/lib/recall.js`,
`cli/lib/remember.js`). The human-facing commands:

- `moomora recall "<query>"` — cross-project, active-only, distilled recall (`--recent [n]` for a
  chronological list; `--project <slug>` to scope).
- `moomora remember "<title>" --body "<text>"` — writes to the **current** project; add `--memory`
  to write to the global `memory` namespace (what the `moomora-remember` skill does).
```

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md`, under the `## [Unreleased]` heading (currently empty), add:

```markdown
## [Unreleased]

### Changed

- **Memory skills converged onto the CLI.** `moomora-recall` / `moomora-remember` are now thin
  wrappers over shared `cli/lib/recall.js` and `cli/lib/remember.js` — one implementation behind
  both the skills and the `moomora` CLI. New `moomora recall` (cross-project, distilled, with
  `--recent`) and `moomora remember --memory` (write to the global `memory` namespace). The skill
  invocation and output are unchanged, and skills remain zero-install (no global `moomora`).
```

- [ ] **Step 4: Run the full suite + syntax check**

Run: `npm test && npm run check`
Expected: all tests green; `npm run check` prints nothing (exit 0).

- [ ] **Step 5: Live end-to-end smoke (CLI vs skill parity against the demo server)**

Run the demo server and exercise both surfaces, confirming the skill and CLI agree:

```bash
# Start the demo server on a spare port
PORT=4010 node scripts/demo-server.js > /tmp/conv-demo.log 2>&1 &
DEMO=$!
sleep 2
export MOOMORA_API_URL=http://127.0.0.1:4010

# remember via the skill (memory project, synthesized) then recall via the CLI (cross-project)
node .claude/skills/moomora-remember/remember.mjs "Conv smoke note" "pgvector restore runbook lives here"
node cli/moomora.js recall "pgvector restore" --limit 3
# recall via the skill should produce the same distilled block
node .claude/skills/moomora-recall/recall.mjs "pgvector restore" --limit 3
# remember via the CLI to the memory namespace, then --recent via the skill
node cli/moomora.js remember "Conv smoke cli" --memory --body "second memory entry"
node .claude/skills/moomora-recall/recall.mjs --recent 5 --project memory

kill $DEMO
```

Expected: the skill `remember` prints `Remembered "Conv smoke note" → <id> (created)`; both `recall`
invocations print the same `## Conv smoke note  (note · <id>)` distilled block; the CLI `remember
--memory` prints `Remembered "Conv smoke cli" (<id>) — unverified.`; `--recent 5 --project memory`
lists both notes. No "not reachable" or stack traces.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/moomora-recall/SKILL.md .claude/skills/moomora-remember/SKILL.md docs/agent-memory.md CHANGELOG.md
git commit -m "docs: converge memory skills onto the CLI (SKILL.md, agent-memory, CHANGELOG)"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- §1 `apiClient.js` (not-reachable, `err.status`, `ensureProject`, `listDocuments`) → Task 1.
- §2 `recall.js` (`recall` + `formatRecall`, 409 fallback, `--recent`, all-projects default) → Task 2; CLI `recall` command → Task 4; skill `recall.mjs` rewrite → Task 5.
- §3 `remember.js` (ensure-project, dedup, caller-composed tags, optional `kind`) → Task 3; CLI `remember` refactor + `--memory` → Task 4; skill `remember.mjs` rewrite → Task 5.
- §4 tests (`tests/cli/{apiClient,recall,remember}.test.js`) → Tasks 1–3; `check`-script additions → Task 4; docs (SKILL.md ×2, agent-memory.md, CHANGELOG, HELP) → Tasks 4 & 6; live parity smoke → Task 6.
- Success criteria 1–4 (one code path; cross-project distilled `recall` + `--recent`; `remember` scoping with `--memory`; zero-install + green suites) are exercised by Tasks 4–6.

**Placeholder scan** — no TBD/TODO; every code step shows complete code and exact run commands with expected output.

**Type/name consistency** — `recall(client, {query, project, limit, recent})` and `formatRecall(result)` (result kinds `hit`/`empty`/`recent`); `remember(client, {title, body, project, type, tags, kind})` returning `{doc, action}`; client methods `ensureProject`/`listDocuments`/`semanticSearch`/`keywordSearch`/`getDocument`/`findByTitle`/`createMemory`/`updateMemory` are used identically across the lib modules, CLI commands, skill wrappers, and tests. The `err.status === 409` contract set in Task 1 is the same one Task 2's recall fallback and test rely on.

**Deliberate implementation choices (within spec intent):** CLI `--tag a,b` is comma-split (the existing single-value arg parser); the recall keyword fallback is active-only (the spec's stated consistency fix). Both are noted at their step.
