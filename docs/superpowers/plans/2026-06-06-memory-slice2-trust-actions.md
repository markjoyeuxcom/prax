# Memory Slice 2 — Trust Actions on Every Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human verify/supersede documents from the Library web UI, and let an agent supersede via MCP, both as thin clients over the existing slice-1 routes — no backend or schema change.

**Architecture:** Two surfaces wrap the existing `POST /api/library/documents/:id/verify` and `…/supersede` routes. The browser gets `verifyDocument` / `supersedeDocument` API fetchers, two detail-panel buttons, and a `pickerMode` flag that reuses the existing link-picker modal for choosing a replacement (with an error-safe `try/finally` reset). MCP gets a `supersede_document` tool + `supersedeDocument` client method — but **no** verify tool (verify stays a human act).

**Tech Stack:** Vanilla ES modules (`public/js/*`), Node's built-in `node:test` runner, the MCP tool/zod stack under `mcp/`, Playwright for E2E. Reference spec: [`docs/superpowers/specs/2026-06-06-memory-slice2-trust-actions-design.md`](../specs/2026-06-06-memory-slice2-trust-actions-design.md).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `mcp/moomoraClient.js` | HTTP client used by MCP tools | Add `supersedeDocument` |
| `mcp/tools/documentLinks.js` | Document-link MCP tools | Add `supersede_document` tool |
| `tests/mcp/moomoraClient.test.js` | Client unit tests | Add supersede test |
| `tests/mcp/documentLinksTools.test.js` | Tool handler tests | Update names list + add supersede test |
| `tests/contract/mcpToolContract.test.js` | Frozen MCP surface | Add `supersede_document` to `FROZEN_TOOLS` |
| `public/js/libraryApi.js` | Browser → HTTP fetchers | Add `verifyDocument`, `supersedeDocument` |
| `tests/frontend/libraryApi.test.js` | Fetcher unit tests | Add verify(true/false) + supersede tests |
| `public/js/state.js` | App state defaults | Add `pickerMode: 'link'` |
| `public/js/renderLibrary.js` | Detail-panel rendering | Verify/supersede buttons + `· superseded` meta |
| `tests/frontend/renderLibrary.test.js` | Render unit tests | Button-presence/label/archived-hidden tests |
| `public/js/main.js` | Event wiring | Handlers + picker `pickerMode` branch + close resets |
| `tests/e2e/helpers/seed.js` | E2E seeding | Add `seedTrustPair` |
| `tests/e2e/trust-actions.spec.js` | E2E flow | New: verify + supersede flow |
| `docs/contract.md` | Format reference | Add `supersede_document`; clarify verify stays human |
| `CHANGELOG.md` | Release notes | `[Unreleased]` entry |

---

## Task 1: MCP `supersede_document` tool + client method

**Files:**
- Modify: `mcp/moomoraClient.js` (after `unlinkDocuments`, ~line 136)
- Modify: `mcp/tools/documentLinks.js` (new tool alongside `link_documents`)
- Test: `tests/mcp/moomoraClient.test.js`
- Test: `tests/mcp/documentLinksTools.test.js`
- Test: `tests/contract/mcpToolContract.test.js`

- [ ] **Step 1: Write the failing client test**

In `tests/mcp/moomoraClient.test.js`, add at the end of the file:

```javascript
test('supersedeDocument POSTs supersededBy with x-moomora-origin: agent header', async () => {
  const fetch = recordingFetch(jsonResponse(200, { id: 'old', status: 'superseded' }));
  const client = createMoomoraClient({ baseUrl: BASE, fetch });
  const doc = await client.supersedeDocument('old-id', 'new-id');
  assert.deepEqual(doc, { id: 'old', status: 'superseded' });
  const call = fetch.calls[0];
  assert.equal(new URL(call.url).pathname, '/api/library/documents/old-id/supersede');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), { supersededBy: 'new-id' });
  assert.equal(call.options.headers['x-moomora-origin'], 'agent');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/mcp/moomoraClient.test.js`
Expected: FAIL — `client.supersedeDocument is not a function`.

- [ ] **Step 3: Add the client method**

In `mcp/moomoraClient.js`, immediately after the `unlinkDocuments` method (the block ending `…/links/${targetId}`, { query: { relation } }),`), insert:

```javascript
    supersedeDocument: (id, supersededBy) =>
      request('POST', `/api/library/documents/${id}/supersede`, {
        body: { supersededBy },
        headers: { 'x-moomora-origin': 'agent' },
      }),
```

- [ ] **Step 4: Run the client test to verify it passes**

Run: `node --test tests/mcp/moomoraClient.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing tool tests**

In `tests/mcp/documentLinksTools.test.js`, update the existing surface test (currently asserting three tools) to expect four:

```javascript
test('exposes the four document-link tools', () => {
  const names = createDocumentLinkTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['link_documents', 'list_document_links', 'supersede_document', 'unlink_documents']);
});
```

Then add a handler test at the end of the file:

```javascript
test('supersede_document validates uuids, rejects self-supersede, maps not-found, calls client', async () => {
  let received;
  const client = { supersedeDocument: async (id, by) => { received = [id, by]; return { id, status: 'superseded' }; } };
  const tool = byName(createDocumentLinkTools(client), 'supersede_document');

  assert.equal((await tool.handler({ documentId: 'bad', supersededBy: TGT })).isError, true);
  assert.equal((await tool.handler({ documentId: SRC, supersededBy: 'bad' })).isError, true);
  assert.equal((await tool.handler({ documentId: SRC, supersededBy: SRC })).isError, true);

  const res = await tool.handler({ documentId: SRC, supersededBy: TGT });
  assert.deepEqual(received, [SRC, TGT]);
  assert.deepEqual(JSON.parse(res.content[0].text), { id: SRC, status: 'superseded' });

  const nf = byName(createDocumentLinkTools({ supersedeDocument: async () => null }), 'supersede_document');
  assert.equal((await nf.handler({ documentId: SRC, supersededBy: TGT })).isError, true);
});
```

- [ ] **Step 6: Run the tool tests to verify they fail**

Run: `node --test tests/mcp/documentLinksTools.test.js`
Expected: FAIL — the names list expects only three tools / `supersede_document` not found.

- [ ] **Step 7: Add the `supersede_document` tool**

In `mcp/tools/documentLinks.js`, inside the array returned by `createDocumentLinkTools`, add this object after the `unlink_documents` tool (keep the same `z` / `isValidUuid` / `okResult` / `errorResult` / `withErrorHandling` imports already at the top of the file):

```javascript
    {
      name: 'supersede_document',
      title: 'Supersede a document',
      description:
        'Retire a document in favour of a replacement: creates a supersedes link (new → old) AND ' +
        'sets the old document\'s status to "superseded" so it drops out of default retrieval. Use ' +
        'this instead of link_documents when replacing a doc. Note: verifying a document is a human ' +
        'action and is intentionally not available via MCP.',
      inputSchema: {
        documentId: z.string().describe('UUID of the document being retired (superseded).'),
        supersededBy: z.string().describe('UUID of the newer document that replaces it.'),
      },
      handler: withErrorHandling(async ({ documentId, supersededBy }) => {
        if (!isValidUuid(documentId)) return errorResult('documentId must be a valid UUID.');
        if (!isValidUuid(supersededBy)) return errorResult('supersededBy must be a valid UUID.');
        if (documentId === supersededBy) return errorResult('a document cannot supersede itself.');
        const doc = await client.supersedeDocument(documentId, supersededBy);
        if (!doc) return errorResult('document not found.');
        return okResult(doc);
      }),
    },
```

- [ ] **Step 8: Run the tool tests to verify they pass**

Run: `node --test tests/mcp/documentLinksTools.test.js`
Expected: PASS.

- [ ] **Step 9: Update the frozen MCP contract**

In `tests/contract/mcpToolContract.test.js`, add to the `FROZEN_TOOLS` object (after the `unlink_documents` entry):

```javascript
  supersede_document: { required: ['documentId', 'supersededBy'], optional: [] },
```

- [ ] **Step 10: Run the contract test to verify it passes**

Run: `node --test tests/contract/mcpToolContract.test.js`
Expected: PASS — the surface SHAPE test now finds `supersede_document` with exactly `documentId` + `supersededBy` required.

- [ ] **Step 11: Commit**

```bash
git add mcp/moomoraClient.js mcp/tools/documentLinks.js tests/mcp/moomoraClient.test.js tests/mcp/documentLinksTools.test.js tests/contract/mcpToolContract.test.js
git commit -m "feat(mcp): add supersede_document tool + client method"
```

---

## Task 2: Browser API client fetchers

**Files:**
- Modify: `public/js/libraryApi.js`
- Test: `tests/frontend/libraryApi.test.js`

- [ ] **Step 1: Write the failing fetcher tests**

In `tests/frontend/libraryApi.test.js`, add `verifyDocument` and `supersedeDocument` to the import block at the top:

```javascript
import {
  archiveDocument,
  createDocument,
  deleteArchivedDocument,
  fetchDocumentLinks,
  fetchDocuments,
  fetchOrphanDocuments,
  fetchStaleDocuments,
  restoreDocument,
  supersedeDocument,
  updateDocument,
  verifyDocument,
} from '../../public/js/libraryApi.js';
```

Then add at the end of the file:

```javascript
test('verifyDocument posts verified:true with as:user to the verify route', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse({ id: 'doc-1', verified: true }); };

  const result = await verifyDocument('doc-1', true);

  assert.deepEqual(result, { id: 'doc-1', verified: true });
  assert.equal(calls[0][0], '/api/library/documents/doc-1/verify');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { verified: true, as: 'user' });
});

test('verifyDocument posts verified:false on the unverify path', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse({ id: 'doc-1', verified: false }); };

  await verifyDocument('doc-1', false);

  assert.deepEqual(JSON.parse(calls[0][1].body), { verified: false, as: 'user' });
});

test('supersedeDocument posts supersededBy to the supersede route', async () => {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return jsonResponse({ id: 'old', status: 'superseded' }); };

  const result = await supersedeDocument('old', 'new');

  assert.deepEqual(result, { id: 'old', status: 'superseded' });
  assert.equal(calls[0][0], '/api/library/documents/old/supersede');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { supersededBy: 'new' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/frontend/libraryApi.test.js`
Expected: FAIL — `verifyDocument` / `supersedeDocument` are not exported.

- [ ] **Step 3: Add the fetchers**

In `public/js/libraryApi.js`, append:

```javascript
export async function verifyDocument(id, verified, as = 'user') {
  const response = await fetch(`/api/library/documents/${id}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verified, as }),
  });
  if (!response.ok) throw new Error('Failed to update verification');
  return response.json();
}

export async function supersedeDocument(id, supersededBy) {
  const response = await fetch(`/api/library/documents/${id}/supersede`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ supersededBy }),
  });
  if (!response.ok) throw new Error('Failed to supersede document');
  return response.json();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/frontend/libraryApi.test.js`
Expected: PASS (3 new tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/libraryApi.js tests/frontend/libraryApi.test.js
git commit -m "feat(library): add verifyDocument/supersedeDocument API fetchers"
```

---

## Task 3: Detail-panel buttons + meta note + `pickerMode` state

**Files:**
- Modify: `public/js/state.js` (link-picker state block, ~line 65)
- Modify: `public/js/renderLibrary.js` (detail meta line ~362; detail-actions block ~364-371)
- Test: `tests/frontend/renderLibrary.test.js`

- [ ] **Step 1: Write the failing render tests**

In `tests/frontend/renderLibrary.test.js`, add after the existing `ARCHIVED_DOC` fixture definition:

```javascript
test('renderLibraryHtml detail panel shows [v] verify for an unverified active doc', () => {
  const html = renderLibraryHtml({ documents: [ACTIVE_DOC], selectedDocumentId: 'd1', libraryView: 'active' });
  assert.match(html, /data-action="toggle-verify"[^>]*>\[v\] verify/);
});

test('renderLibraryHtml detail panel shows [v] unverify when the doc is verified', () => {
  const html = renderLibraryHtml({
    documents: [{ ...ACTIVE_DOC, verified: true, verifiedBy: 'user' }],
    selectedDocumentId: 'd1', libraryView: 'active',
  });
  assert.match(html, /data-action="toggle-verify"[^>]*>\[v\] unverify/);
});

test('renderLibraryHtml detail panel shows [s] supersede for an active doc and hides it once superseded', () => {
  const active = renderLibraryHtml({ documents: [ACTIVE_DOC], selectedDocumentId: 'd1', libraryView: 'active' });
  assert.match(active, /data-action="supersede-document"/);

  const superseded = renderLibraryHtml({
    documents: [{ ...ACTIVE_DOC, status: 'superseded' }],
    selectedDocumentId: 'd1', libraryView: 'active',
  });
  assert.doesNotMatch(superseded, /data-action="supersede-document"/);
  assert.match(superseded, /library-detail-meta[^>]*>[^<]*· superseded/);
});

test('renderLibraryHtml hides verify and supersede actions when the document is archived', () => {
  const html = renderLibraryHtml({
    documents: [ARCHIVED_DOC], selectedDocumentId: 'd2', libraryView: 'archive',
  });
  assert.doesNotMatch(html, /data-action="toggle-verify"/);
  assert.doesNotMatch(html, /data-action="supersede-document"/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/frontend/renderLibrary.test.js`
Expected: FAIL — no `toggle-verify` / `supersede-document` actions and no `· superseded` meta yet.

- [ ] **Step 3: Add the meta `· superseded` note**

In `public/js/renderLibrary.js`, replace the `library-detail-meta` paragraph (the line that currently reads `<p class="library-detail-meta">Updated by ${escapeHtml(document.updatedBy || 'user')}${document.verified ? \` · verified${document.verifiedBy ? \` by ${escapeHtml(document.verifiedBy)}\` : ''}\` : ' · unverified'}</p>`) with:

```javascript
        <p class="library-detail-meta">Updated by ${escapeHtml(document.updatedBy || 'user')}${document.verified ? ` · verified${document.verifiedBy ? ` by ${escapeHtml(document.verifiedBy)}` : ''}` : ' · unverified'}${document.status === 'superseded' ? ' · superseded' : ''}</p>
```

- [ ] **Step 4: Add the verify + supersede buttons to detail-actions**

In `public/js/renderLibrary.js`, in the `<div class="detail-actions">` block, insert the two new buttons immediately after the `[i] info` button line (the line `${isArchived ? '' : '<button class="bracket-button" type="button" data-action="edit-document-info">[i] info</button>'}`) and before the archive/restore conditional:

```javascript
          ${isArchived ? '' : `<button class="bracket-button" type="button" data-action="toggle-verify">[v] ${document.verified ? 'unverify' : 'verify'}</button>`}
          ${isArchived || document.status === 'superseded' ? '' : '<button class="bracket-button" type="button" data-action="supersede-document">[s] supersede…</button>'}
```

- [ ] **Step 5: Run the render tests to verify they pass**

Run: `node --test tests/frontend/renderLibrary.test.js`
Expected: PASS (4 new tests; the existing archived/active detail tests stay green).

- [ ] **Step 6: Add `pickerMode` to state**

In `public/js/state.js`, in the link-picker state block, change:

```javascript
  isLinkPickerOpen: false,
  linkPickerDocuments: [],
  linkPickerQuery: '',
```

to:

```javascript
  isLinkPickerOpen: false,
  pickerMode: 'link',             // 'link' (task↔doc) | 'supersede' (pick a replacement)
  linkPickerDocuments: [],
  linkPickerQuery: '',
```

- [ ] **Step 7: Syntax-check the changed browser modules**

Run: `node --check public/js/renderLibrary.js && node --check public/js/state.js`
Expected: no output (exit 0).

- [ ] **Step 8: Commit**

```bash
git add public/js/renderLibrary.js public/js/state.js tests/frontend/renderLibrary.test.js
git commit -m "feat(library): verify/supersede detail buttons + superseded meta + pickerMode state"
```

---

## Task 3b: Mode-aware link-picker heading

The shared picker modal currently hardcodes task-link copy ("Link a document" / "Attach a runbook or note to this task." / mobile "link doc"). In supersede mode that copy is wrong. Add an optional `mode` argument (defaulting to `'link'`, so all existing callers and tests are unaffected) that swaps the heading/subtext.

**Files:**
- Modify: `public/js/renderLinkPicker.js`
- Test: `tests/frontend/renderLinkPicker.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/frontend/renderLinkPicker.test.js`, add at the end of the file:

```javascript
test('link picker keeps task-link copy by default', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments });
  assert.match(html, /<h2 id="link-picker-title">Link a document<\/h2>/);
  assert.match(html, /Attach a runbook or note to this task\./);
});

test('link picker shows supersede copy in supersede mode', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, mode: 'supersede' });
  assert.match(html, /<h2 id="link-picker-title">Supersede with…<\/h2>/);
  assert.match(html, /Pick the document that replaces this one\./);
  assert.doesNotMatch(html, /Attach a runbook or note to this task\./);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/frontend/renderLinkPicker.test.js`
Expected: FAIL — supersede mode still renders the task-link heading.

- [ ] **Step 3: Add the `mode` argument and branch the copy**

In `public/js/renderLinkPicker.js`, change the function signature:

```javascript
export function renderLinkPickerHtml({ documents = [], linkedIds = [], query = '', mode = 'link' } = {}) {
```

Immediately after the `const filtered = …` line (before `const rows = …`), add:

```javascript
  const isSupersede = mode === 'supersede';
  const heading = isSupersede ? 'Supersede with…' : 'Link a document';
  const subtext = isSupersede ? 'Pick the document that replaces this one.' : 'Attach a runbook or note to this task.';
  const mobileTitle = isSupersede ? 'supersede' : 'link doc';
```

Then in the returned template, replace the three hardcoded strings:
- `<h2 id="link-picker-title">Link a document</h2>` → `<h2 id="link-picker-title">${heading}</h2>`
- `<p>Attach a runbook or note to this task.</p>` → `<p>${subtext}</p>`
- `<h2 class="modal-header__title">link doc</h2>` → `<h2 class="modal-header__title">${mobileTitle}</h2>`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/frontend/renderLinkPicker.test.js`
Expected: PASS (existing picker tests stay green — default mode is unchanged).

- [ ] **Step 5: Commit**

```bash
git add public/js/renderLinkPicker.js tests/frontend/renderLinkPicker.test.js
git commit -m "feat(library): mode-aware link-picker heading for supersede"
```

---

## Task 4: Wire the handlers (verify, supersede, picker branch)

**Files:**
- Modify: `public/js/main.js` — import (line ~25-39); detail handlers (after archive-document, ~line 1328); `bindLinkPickerEvents` (~2508-2556)

This task has no new unit test (main.js wiring is exercised by Task 5's E2E and the already-green render/fetcher tests). It is verified by `node --check` and the full suite.

- [ ] **Step 1: Import the new fetchers**

In `public/js/main.js`, in the `from './libraryApi.js'` import block, change:

```javascript
  updateDocument,
} from './libraryApi.js';
```

to:

```javascript
  supersedeDocument,
  updateDocument,
  verifyDocument,
} from './libraryApi.js';
```

- [ ] **Step 2: Add the toggle-verify and supersede-document handlers**

In `public/js/main.js`, immediately **before** the `workspace.querySelector('[data-action="archive-document"]')` handler, insert:

```javascript
  workspace.querySelector('[data-action="toggle-verify"]')?.addEventListener('click', async () => {
    const doc = selectedDocument();
    if (!doc) return;
    try {
      await verifyDocument(doc.id, !doc.verified);
      await loadDocuments({ selectedDocumentId: doc.id });
    } catch {
      window.alert('Moomora Console could not update verification.');
    }
  });

  workspace.querySelector('[data-action="supersede-document"]')?.addEventListener('click', async () => {
    const current = selectedDocument();
    if (!current) return;
    try {
      const docs = await fetchDocuments({
        project: state.activeProject === 'all' ? undefined : state.activeProject,
        archived: false,
      });
      const candidates = docs.filter(
        candidate => candidate.id !== current.id
          && candidate.status !== 'superseded'
          && candidate.projectId === current.projectId,
      );
      setState({
        linkPickerDocuments: candidates,
        linkPickerQuery: '',
        isLinkPickerOpen: true,
        pickerMode: 'supersede',
      });
      renderApp();
    } catch {
      window.alert('Moomora Console could not load documents to supersede.');
    }
  });

```

- [ ] **Step 3: Reset `pickerMode` on the picker close paths**

In `public/js/main.js`, inside `bindLinkPickerEvents`, update **both** close paths so cancelling never leaves the picker stuck in supersede mode. Change the close-button handler:

```javascript
  backdrop.querySelectorAll('[data-action="close-link-picker"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ isLinkPickerOpen: false, pickerMode: 'link' });
      renderApp();
    });
  });
```

and the backdrop-click handler:

```javascript
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      setState({ isLinkPickerOpen: false, pickerMode: 'link' });
      renderApp();
    }
  });
```

- [ ] **Step 4: Branch the picker select handler on `pickerMode`**

In `public/js/main.js`, in `bindLinkPickerEvents`, replace the `[data-link-picker-doc]` click handler body so it handles supersede first (error-safe `try/finally` that always resets `pickerMode`), then falls through to the unchanged task-link path:

```javascript
  backdrop.querySelectorAll('[data-link-picker-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const docId = btn.dataset.linkPickerDoc;

      if (state.pickerMode === 'supersede') {
        const current = selectedDocument();
        if (!current) return;
        try {
          await supersedeDocument(current.id, docId);
          await loadDocuments({ selectedDocumentId: current.id });
        } catch {
          window.alert('Moomora Console could not supersede the document.');
        } finally {
          setState({ isLinkPickerOpen: false, pickerMode: 'link' });
          renderApp();
        }
        return;
      }

      const taskId = state.selectedTaskId;
      if (!taskId) return;
      const isLinked = state.taskDocuments.some(d => d.id === docId);
      try {
        const updated = isLinked
          ? await unlinkTaskDocument(taskId, docId)
          : await linkTaskDocument(taskId, docId);
        setState({ taskDocuments: updated });
        clearTaskBoardExtra(taskId);
        renderApp();
      } catch {
        window.alert('Moomora Console could not update the document link.');
      }
    });
  });
```

- [ ] **Step 5: Pass `mode` to the picker at the render call site**

In `public/js/main.js`, in `renderApp` where the picker is rendered (the `if (state.isLinkPickerOpen)` block, ~line 1690), add `mode: state.pickerMode` to the call:

```javascript
  if (state.isLinkPickerOpen) {
    app.insertAdjacentHTML('beforeend', renderLinkPickerHtml({
      documents: state.linkPickerDocuments,
      linkedIds: state.taskDocuments.map(d => d.id),
      query: state.linkPickerQuery,
      mode: state.pickerMode,
    }));
  }
```

- [ ] **Step 6: Syntax-check main.js**

Run: `node --check public/js/main.js`
Expected: no output (exit 0).

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: all green (the new fetcher/render/MCP tests included).

- [ ] **Step 8: Commit**

```bash
git add public/js/main.js
git commit -m "feat(library): wire verify toggle + supersede picker (pickerMode, error-safe reset)"
```

---

## Task 5: End-to-end flow (Playwright, against the demo)

**Files:**
- Modify: `tests/e2e/helpers/seed.js` (add `seedTrustPair`)
- Create: `tests/e2e/trust-actions.spec.js`

The demo server (`scripts/demo-server.js`) already implements `verifyDocument`, `markDocumentSuperseded`, and links grouping, so the whole flow runs under `npm run test:e2e`.

- [ ] **Step 1: Add the seed helper**

In `tests/e2e/helpers/seed.js`, append:

```javascript
export async function seedTrustPair(request, prefix) {
  const projectId = await resolveProjectId(request, 'homelab');
  const primary = await createDocument(request, {
    title: `${prefix} primary`,
    body: '# primary\n\noriginal\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['e2e'],
  });
  const replacement = await createDocument(request, {
    title: `${prefix} replacement`,
    body: '# replacement\n\nnewer\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['e2e'],
  });
  return { projectId, primary, replacement };
}
```

- [ ] **Step 2: Write the E2E spec**

Create `tests/e2e/trust-actions.spec.js`:

```javascript
import { test, expect } from '@playwright/test';
import { seedTrustPair } from './helpers/seed.js';

// Open the library view and click the row whose title contains `titleText`.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-view="library"]').first().click();
  const row = page.locator('.document-row', { hasText: titleText });
  await expect(row).toBeVisible();
  await row.click();
}

test('a human can verify a document from the detail panel', async ({ page }) => {
  const prefix = `trust-verify-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  const detail = page.locator('.library-detail');
  await expect(detail.locator('[data-action="toggle-verify"]')).toContainText('verify');

  await detail.locator('[data-action="toggle-verify"]').click();

  // Chip + meta + button label all reflect the verified state without a reload.
  await expect(detail.locator('.chip-verified')).toBeVisible();
  await expect(detail.locator('.library-detail-meta')).toContainText('verified');
  await expect(detail.locator('[data-action="toggle-verify"]')).toContainText('unverify');
});

test('a human can supersede a document by picking a replacement', async ({ page }) => {
  const prefix = `trust-supersede-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  // Open the picker in supersede mode and choose the replacement.
  await page.locator('[data-action="supersede-document"]').click();
  const picker = page.locator('[data-link-picker]');
  await expect(picker).toBeVisible();
  await expect(picker.locator('#link-picker-title')).toContainText('Supersede');
  await picker.locator('[data-link-picker-doc]', { hasText: `${prefix} replacement` }).click();

  // The old (still-selected) doc flips to superseded: chip + meta + dimmed row.
  const detail = page.locator('.library-detail');
  await expect(detail.locator('.chip-superseded')).toBeVisible();
  await expect(detail.locator('.library-detail-meta')).toContainText('superseded');
  await expect(page.locator('.document-row.is-superseded', { hasText: `${prefix} primary` })).toBeVisible();

  // The supersede button is gone once superseded.
  await expect(detail.locator('[data-action="supersede-document"]')).toHaveCount(0);

  // The replacement appears under Backlinks (the link is new → old, so on the
  // old doc it is an inbound supersedes).
  const links = detail.locator('.document-links');
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} replacement`);
});
```

- [ ] **Step 3: Run the E2E spec**

Run: `npm run test:e2e -- trust-actions.spec.js`
Expected: both tests PASS. (If Playwright browsers are not installed, run `npx playwright install` first.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/seed.js tests/e2e/trust-actions.spec.js
git commit -m "test(e2e): verify + supersede trust-action flows"
```

---

## Task 6: Docs, CHANGELOG, and final verification

**Files:**
- Modify: `docs/contract.md` (MCP tool table ~line 202; trust-endpoints prose ~line 268)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Add `supersede_document` to the MCP tool table**

In `docs/contract.md`, in the MCP tool table, after the `unlink_documents` row, add:

```markdown
| `supersede_document` | `documentId`, `supersededBy` | — |
```

- [ ] **Step 2: Clarify the trust-endpoint MCP exposure**

In `docs/contract.md`, the `### Trust endpoints (HTTP-only)` section currently says the endpoints are "**HTTP-only** and not exposed as MCP tools." Replace that heading and its first sentence with:

```markdown
### Trust endpoints

These endpoints manage the trust/lifecycle state of library documents. `verify` is
deliberately **not** exposed as an MCP tool — verification is a human act (Library UI button
or `moomora verify --as`), so `verified` keeps meaning "a human blessed it." `supersede` **is**
available to agents via the `supersede_document` MCP tool (content lifecycle, not self-blessing),
in addition to the HTTP route below.
```

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md`, fill the empty `## [Unreleased]` section:

```markdown
## [Unreleased]

### Added

- **Trust actions on every surface (memory slice 2).** The Library detail panel gains
  `[v] verify` / `[v] unverify` and `[s] supersede…` buttons, so a human can change a document's
  trust state from the web UI (previously read-only chips). Supersede reuses the link-picker
  modal to choose a same-project replacement. Agents gain a `supersede_document` MCP tool
  (with a matching `supersedeDocument` client method); verifying stays a human-only action and is
  intentionally not exposed via MCP.
```

- [ ] **Step 4: Run the full suite + syntax check**

Run: `npm test && npm run check`
Expected: all unit/contract tests green; `npm run check` prints nothing (all `node --check` pass).

- [ ] **Step 5: Run the E2E suite once more (whole project)**

Run: `npm run test:e2e`
Expected: all specs PASS (smoke, links-section, list-chips, maintenance, trust-actions).

- [ ] **Step 6: Commit**

```bash
git add docs/contract.md CHANGELOG.md
git commit -m "docs: document supersede_document MCP tool + UI trust actions"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- Section 1 `libraryApi.js` fetchers → Task 2. `renderLibrary.js` buttons + meta → Task 3. `state.js pickerMode` → Task 3. `main.js` handlers + picker branch + `try/finally` reset → Task 4.
- Section 2 MCP `supersedeDocument` client + `supersede_document` tool, no verify tool → Task 1.
- Section 3 demo server (no change — confirmed in Task 5 preamble); MCP contract/handler/client tests → Task 1; render tests incl. **archived-hidden** → Task 3; API-client `verifyDocument(true)` **and** `(false)` + supersede → Task 2; E2E flow with **Backlinks** assertion → Task 5; docs + CHANGELOG → Task 6.
- The two review nits the user called out are encoded: **error-safe picker reset** (Task 4 Step 4, `finally` always resets `pickerMode='link'`, plus both close paths in Step 3) and the **archived render test** (Task 3 Step 1, fourth test).

**Placeholder scan** — no TBD/TODO; every code step shows complete code and exact run commands with expected output.

**Type/name consistency** — `pickerMode` (string `'link'`/`'supersede'`), `verifyDocument(id, verified, as)`, `supersedeDocument(id, supersededBy)`, client `supersedeDocument(id, supersededBy)`, tool `supersede_document` with `documentId`/`supersededBy`, data-actions `toggle-verify` / `supersede-document`, and the existing `data-link-picker-doc` / `selectedDocument()` / `loadDocuments({selectedDocumentId})` anchors are used identically across tasks and tests.

**Note on same-project scoping:** the supersede candidate filter (Task 4 Step 2) adds `candidate.projectId === current.projectId` so candidates stay same-project even when the Library is in the "all projects" view — a faithful tightening of the spec's "same project, active, non-self, non-superseded" intent.

**Verified against the code before handoff (review pushback resolved):**
- *Selection survives the post-supersede reload.* Both `listDocuments` implementations only apply a `status` filter when one is passed: the real repo (`server/libraryRepository.js:280`, `if (filters.status && [...].includes(filters.status))`) and the demo server (`scripts/demo-server.js:399`, `if (filters.status && document.status && …)`). The web list route (`server/libraryRoutes.js:189`) passes **no** status, so the now-`superseded` doc stays in the list and `loadDocuments({ selectedDocumentId: current.id })` re-selects it. No `includeSelected` flag or fetch-by-id is needed — the spec's "selection survives" claim holds as written.
- *Picker candidates include superseded docs, then we filter them out.* `fetchDocuments({ project, archived: false })` returns all statuses (same routes as above), which is exactly why the candidate filter explicitly drops `status === 'superseded'`.
- *E2E DOM hooks are real, not invented.* `renderLinkPicker.js` emits `data-link-picker` (backdrop), `data-link-picker-doc` (rows), `data-link-picker-search` (search), and `#link-picker-title` (heading) — every locator in Task 5 maps to existing markup.
- *Mode-aware heading (Task 3b)* was added after discovering the picker hardcoded "Link a document / Attach a runbook or note to this task" — wrong copy in supersede mode. The change is backward-compatible (`mode` defaults to `'link'`).
