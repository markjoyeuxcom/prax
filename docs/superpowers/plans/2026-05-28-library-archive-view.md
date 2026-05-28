# Library Archive View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archived Library documents disappear from the active list and are viewable only in a read-only Archive view inside the Library workspace, toggled by a header button.

**Architecture:** Add `state.libraryView: 'active' | 'archive'` and a cached `state.libraryActiveDocumentCount`. `loadDocuments` fetches `archived: true` in archive mode, `archived: undefined` (server default = active only) otherwise, so `state.documents` is always a single coherent set. The renderer gains a header toggle, an ARCHIVE kicker, archive-aware count/empty-state copy, and forces the detail panel read-only whenever the selected doc is archived. Reset triggers (project switch, view switch, doc create) return `libraryView` to `'active'`.

**Tech Stack:** Plain-JS frontend modules, Node built-in test runner (`npm test`), no backend changes.

**Spec:** [docs/superpowers/specs/2026-05-28-library-archive-view-design.md](../specs/2026-05-28-library-archive-view-design.md)

**Key implementation note (refinement over spec §4):** The spec proposed hiding the `[+] new doc` button in archive view, which would require threading `libraryView` into `renderShell`. Instead, the document-form submit handler resets `libraryView` to `'active'` on success, so creating a doc always lands the user in the active view with the new doc selected. Same net effect ("can't create into archive and lose the doc"), less coupling, and the create button needs no change. This is reflected in Task 2.

---

## Task 1: Renderer — archive-aware Library workspace

**Files:**
- Modify: `public/js/renderLibrary.js`
- Test: `tests/frontend/renderLibrary.test.js`

`renderLibraryHtml` gains a `libraryView` option (default `'active'`, so existing call sites and tests are unaffected until Task 2 wires it). It threads to the header (toggle button, ARCHIVE kicker, count copy) and the empty-state copy. The detail panel's read-only behaviour keys off the existing `isArchived` flag — in the archive view every doc has `archivedAt` set, and in the active view none do (loader contract), so `isArchived` is the correct signal and no extra param is needed in `renderDocumentDetail`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/frontend/renderLibrary.test.js`:

```js
const ACTIVE_DOC = {
  id: 'd1', title: 'Live runbook', body: '# live', documentType: 'runbook',
  projectId: 'p1', tags: [], sourceFilename: null, archivedAt: null,
  createdAt: 'now', updatedAt: 'now',
};
const ARCHIVED_DOC = { ...ACTIVE_DOC, id: 'd2', title: 'Old runbook', archivedAt: '2026-05-01T00:00:00.000Z' };

test('renderLibraryHtml active view shows [a] archive toggle and plain document count', () => {
  const html = renderLibraryHtml({ documents: [ACTIVE_DOC], selectedDocumentId: 'd1', libraryView: 'active' });
  assert.match(html, /data-action="toggle-library-view"[^>]*>\[a\] archive/);
  assert.match(html, /1 documents/);
  assert.doesNotMatch(html, /class="detail-kicker">ARCHIVE</);
});

test('renderLibraryHtml archive view shows [back] toggle, ARCHIVE kicker, and archived count', () => {
  const html = renderLibraryHtml({ documents: [ARCHIVED_DOC], selectedDocumentId: 'd2', libraryView: 'archive' });
  assert.match(html, /data-action="toggle-library-view"[^>]*>\[←\] active/);
  assert.match(html, /<span class="detail-kicker">ARCHIVE<\/span>/);
  assert.match(html, /1 archived documents/);
});

test('renderLibraryHtml archive empty state reads "No archived documents" without the create CTA', () => {
  const html = renderLibraryHtml({ documents: [], libraryView: 'archive' });
  assert.match(html, /No archived documents/);
  assert.doesNotMatch(html, /Create or import Markdown/);
});

test('renderLibraryHtml active empty state keeps the create/import CTA', () => {
  const html = renderLibraryHtml({ documents: [], libraryView: 'active' });
  assert.match(html, /No Markdown documents/);
  assert.match(html, /Create or import Markdown/);
});

test('renderLibraryHtml archive view detail panel is preview-only: no mode tabs, no editor toolbar, restore+delete present', () => {
  const html = renderLibraryHtml({
    documents: [ARCHIVED_DOC], selectedDocumentId: 'd2', editorMode: 'edit', libraryView: 'archive',
  });
  assert.doesNotMatch(html, /data-library-mode="edit"/);
  assert.doesNotMatch(html, /data-action="save-document-draft"/);
  assert.doesNotMatch(html, /data-action="export-document"/);
  assert.match(html, /data-action="restore-document"/);
  assert.match(html, /data-action="delete-archived-document"/);
  assert.match(html, /class="markdown-preview"/);
});

test('renderLibraryHtml active view detail panel keeps editor tabs, archive action, and export', () => {
  const html = renderLibraryHtml({
    documents: [ACTIVE_DOC], selectedDocumentId: 'd1', editorMode: 'edit', libraryView: 'active',
  });
  assert.match(html, /data-library-mode="edit"/);
  assert.match(html, /data-action="archive-document"/);
  assert.match(html, /data-action="export-document"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/frontend/renderLibrary.test.js`
Expected: FAIL — `toggle-library-view` button absent, "archived documents" count absent, etc.

- [ ] **Step 3: Add `libraryView` to the `renderLibraryHtml` signature**

In `public/js/renderLibrary.js`, the `renderLibraryHtml` options block ends with (around line 344-347):

```js
  typeFilter = 'all',
  sortBy = 'updated',
  groupByType = false,
} = {}) {
```

Change to:

```js
  typeFilter = 'all',
  sortBy = 'updated',
  groupByType = false,
  libraryView = 'active',
} = {}) {
```

- [ ] **Step 4: Update the workspace header (toggle button, kicker, count copy)**

In `renderLibraryHtml`, find the header block (around line 352-362):

```js
  return `
    <section class="library-workspace${isFocusMode ? ' is-focus-mode' : ''}" aria-label="Knowledge Library workspace">
      <aside class="library-browser" aria-labelledby="library-title">
        <header class="panel-header">
          <div>
            <h2 id="library-title">Knowledge Library</h2>
            <p>${safeDocuments.length} documents</p>
          </div>
          <span class="sync-pill">Markdown</span>
          <button class="bracket-button bracket-button--quiet library-tags-toggle" type="button" data-action="toggle-library-tags-drawer" aria-expanded="${isLibraryTagsDrawerOpen}">tags ↕</button>
        </header>
```

Replace with:

```js
  const isArchiveView = libraryView === 'archive';
  return `
    <section class="library-workspace${isFocusMode ? ' is-focus-mode' : ''}" aria-label="Knowledge Library workspace">
      <aside class="library-browser" aria-labelledby="library-title">
        <header class="panel-header">
          <div>
            ${isArchiveView ? '<span class="detail-kicker">ARCHIVE</span>' : ''}
            <h2 id="library-title">Knowledge Library</h2>
            <p>${safeDocuments.length} ${isArchiveView ? 'archived documents' : 'documents'}</p>
          </div>
          <span class="sync-pill">Markdown</span>
          <button class="bracket-button bracket-button--quiet" type="button" data-action="toggle-library-view">${isArchiveView ? '[←] active' : '[a] archive'}</button>
          <button class="bracket-button bracket-button--quiet library-tags-toggle" type="button" data-action="toggle-library-tags-drawer" aria-expanded="${isLibraryTagsDrawerOpen}">tags ↕</button>
        </header>
```

(The `const isArchiveView = ...` line goes immediately before the existing `return \`` — make sure the existing `const safeDocuments`/`const document`/`const activeMode` lines that precede `return` are kept; add `isArchiveView` alongside them.)

- [ ] **Step 5: Thread `libraryView` into the document list call**

In `renderLibraryHtml`, the document-list render call is (around line 383):

```js
        <div class="document-list">${renderDocumentList(safeDocuments, document?.id, { groupByType })}
```

Change to:

```js
        <div class="document-list">${renderDocumentList(safeDocuments, document?.id, { groupByType, libraryView })}
```

- [ ] **Step 6: Branch the empty-state copy in `renderDocumentList`**

`renderDocumentList` is defined around line 179:

```js
function renderDocumentList(documents, activeDocumentId, { groupByType = false } = {}) {
  if (!documents.length) {
    return `
      <div class="task-empty" role="status">
        <strong>No Markdown documents</strong>
        <span>Create or import Markdown to build your runbook and notes library.</span>
      </div>`;
  }
```

Change to:

```js
function renderDocumentList(documents, activeDocumentId, { groupByType = false, libraryView = 'active' } = {}) {
  if (!documents.length) {
    if (libraryView === 'archive') {
      return `
      <div class="task-empty" role="status">
        <strong>No archived documents</strong>
      </div>`;
    }
    return `
      <div class="task-empty" role="status">
        <strong>No Markdown documents</strong>
        <span>Create or import Markdown to build your runbook and notes library.</span>
      </div>`;
  }
```

- [ ] **Step 7: Force the detail panel read-only when the selected doc is archived**

`renderDocumentDetail` begins (around line 287-288):

```js
  const editorMode = options.editorMode || 'preview';
  const isArchived = Boolean(document.archivedAt);
```

Reorder and force preview mode for archived docs:

```js
  const isArchived = Boolean(document.archivedAt);
  const editorMode = isArchived ? 'preview' : (options.editorMode || 'preview');
```

Then, in the same function, the detail-actions block (around line 304-305):

```js
        <div class="detail-actions">
          ${renderModes(editorMode)}
```

Change to suppress the mode tabs for archived docs:

```js
        <div class="detail-actions">
          ${isArchived ? '' : renderModes(editorMode)}
```

No other change is needed: with `editorMode` forced to `'preview'`, the existing `editorVisible = editorMode === 'edit' || editorMode === 'split'` resolves to `false` (so `renderEditorPane` and its `[s] save`/`[f] focus`/`[x] export` toolbar never render), and `previewVisible` resolves to `true`. The existing `isArchived` conditionals already render `[r] restore` + `[!] delete` instead of `[d] archive` and hide `[i] info`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- tests/frontend/renderLibrary.test.js`
Expected: PASS (all existing renderLibrary tests plus the 6 new ones).

- [ ] **Step 9: Run the full frontend suite to confirm no regression**

Run: `npm test -- tests/frontend`
Expected: PASS. (The `libraryView` default of `'active'` keeps every existing test's output identical.)

- [ ] **Step 10: Commit**

```bash
git add public/js/renderLibrary.js tests/frontend/renderLibrary.test.js
git commit -m "feat: archive-aware Library workspace rendering"
```

---

## Task 2: State + wiring — loader, toggle, reset triggers, admin count

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`

This task is integration glue between `state`, the loader, the event handlers, and the renderer from Task 1. The `state` singleton and the `main.js` event handlers are not unit-tested in this codebase (consistent with how `libraryTypeFilter`, `librarySortBy`, etc. are wired); correctness is verified by `npm run check`, the full existing suite staying green, and the manual smoke in Task 3. The render contract these handlers drive is already pinned by Task 1's tests.

- [ ] **Step 1: Add the two new state fields**

In `public/js/state.js`, the library-related defaults are around lines 38-46. After `libraryGroupByType: false,` add:

```js
  libraryView: 'active',            // 'active' | 'archive' (Library workspace mode)
  libraryActiveDocumentCount: 0,    // cached count of active docs for the Admin panel
```

- [ ] **Step 2: Switch the loader to fetch the right set and cache the active count**

In `public/js/main.js`, `loadDocuments` is around line 2399:

```js
async function loadDocuments({ selectedDocumentId = state.selectedDocumentId } = {}) {
  setState({ apiStatus: 'loading' });
  renderLoading();
  const documents = await fetchDocuments({
    project: state.activeProject === 'all' ? undefined : state.activeProject,
    archived: 'all',
  });
  const selectedDocumentExists = documents.some(document => document.id === selectedDocumentId);
  setState({
    documents,
    apiStatus: 'connected',
    selectedDocumentId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftBody: (selectedDocumentExists ? documents.find(document => document.id === selectedDocumentId) : documents[0])?.body || '',
    isDocumentDirty: false,
  });
  renderApp();
}
```

Replace the whole function with:

```js
async function loadDocuments({ selectedDocumentId = state.selectedDocumentId } = {}) {
  setState({ apiStatus: 'loading' });
  renderLoading();
  const documents = await fetchDocuments({
    project: state.activeProject === 'all' ? undefined : state.activeProject,
    archived: state.libraryView === 'archive' ? true : undefined,
  });
  const selectedDocumentExists = documents.some(document => document.id === selectedDocumentId);
  const patch = {
    documents,
    apiStatus: 'connected',
    selectedDocumentId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftBody: (selectedDocumentExists ? documents.find(document => document.id === selectedDocumentId) : documents[0])?.body || '',
    isDocumentDirty: false,
  };
  if (state.libraryView === 'active') {
    patch.libraryActiveDocumentCount = documents.length;
  }
  setState(patch);
  renderApp();
}
```

- [ ] **Step 3: Pass `libraryView` to the renderer**

In `public/js/main.js`, `renderLibraryWorkspace` calls `renderLibraryHtml` around line 732. The options object ends with:

```js
    typeFilter: state.libraryTypeFilter,
    sortBy: state.librarySortBy,
    groupByType: state.libraryGroupByType,
  });
```

Change to:

```js
    typeFilter: state.libraryTypeFilter,
    sortBy: state.librarySortBy,
    groupByType: state.libraryGroupByType,
    libraryView: state.libraryView,
  });
```

- [ ] **Step 4: Wire the toggle handler**

In `public/js/main.js`, the library workspace event-binding block has the `toggle-library-tags-drawer` handler around line 762. Immediately after that handler's closing `});`, add:

```js
  workspace.querySelector('[data-action="toggle-library-view"]')?.addEventListener('click', async () => {
    setState({
      libraryView: state.libraryView === 'archive' ? 'active' : 'archive',
      selectedDocumentId: null,
    });
    try {
      await loadDocuments({ selectedDocumentId: null });
    } catch (error) {
      setState({ apiStatus: 'error' });
      renderError(error.message);
    }
  });
```

- [ ] **Step 5: Reset `libraryView` on view switch**

In `public/js/main.js`, the `[data-view]` handler's `setState({ ... })` (around line 1764) lists many reset fields. Add `libraryView: 'active',` to that object (e.g. right after `selectedDocumentId: null,`):

```js
      setState({
        activeView: nextView,
        selectedTaskId: null,
        selectedDocumentId: null,
        libraryView: 'active',
        activeLibraryTags: [],
        ...
```

- [ ] **Step 6: Reset `libraryView` on project switch**

In `public/js/main.js`, the `[data-project]` handler's `setState({ ... })` (around line 1668) — add `libraryView: 'active',` right after `selectedDocumentId: null,`:

```js
      setState({
        activeProject: nextProject,
        selectedTaskId: null,
        selectedDocumentId: null,
        libraryView: 'active',
        activeLibraryTags: [],
        ...
```

- [ ] **Step 7: Reset `libraryView` after a document is created/saved**

In `public/js/main.js`, the document-form submit success handler sets state around line 1863 before reloading. Add `libraryView: 'active',` so a doc created while viewing the archive lands the user back in the active view with the new doc selected:

```js
      setState({
        activeProject: nextProject,
        selectedDocumentId: savedDocument.id,
        libraryView: 'active',
        isDocumentFormOpen: false,
        editingDocumentId: null,
        isSaving: false,
        documentFormError: '',
      });
      await loadDocuments({ selectedDocumentId: savedDocument.id });
```

- [ ] **Step 8: Read the cached count in the Admin panel**

In `public/js/main.js`, the `renderAdminPanelHtml` call (around line 1539-1543) currently computes `documentCount` inline:

```js
      activeProject: state.activeProject,
      projects: state.projects,
      taskCount: state.tasks.length,
      documentCount: (state.documents || []).filter(d => !d.archivedAt && (state.activeProject === 'all' || d.projectId === state.activeProject)).length,
      importMode: state.adminImportMode,
```

Replace the `documentCount` line with the cached value (so it stays correct even when Admin is opened from the archive view, where `state.documents` holds only archived docs):

```js
      activeProject: state.activeProject,
      projects: state.projects,
      taskCount: state.tasks.length,
      documentCount: state.libraryActiveDocumentCount,
      importMode: state.adminImportMode,
```

- [ ] **Step 9: Run the syntax check and full suite**

Run: `npm run check`
Expected: PASS (no syntax errors in `public/js/main.js`).

Run: `npm test`
Expected: PASS (full suite green — Task 1's render tests plus everything pre-existing).

- [ ] **Step 10: Commit**

```bash
git add public/js/state.js public/js/main.js
git commit -m "feat: wire Library archive view (loader, toggle, reset triggers, admin count cache)"
```

---

## Task 3: End-to-end verification

**Files:** none modified — verification only.

- [ ] **Step 1: Full suite + check**

Run: `npm test`
Expected: all tests pass.

Run: `npm run check`
Expected: no syntax errors.

- [ ] **Step 2: Manual smoke against the demo server**

Run (one terminal): `npm run demo` (serves on `http://127.0.0.1:3100`).

In a browser at `http://127.0.0.1:3100/`, verify each:

1. Library → select a doc → `[d] archive` in the detail panel → the doc immediately disappears from the active list (the bug is fixed).
2. Library header shows `[a] archive`. Click it → the workspace switches to the archive view: `ARCHIVE` kicker on the heading, count reads "N archived documents", `[←] active` button, and the archived doc is listed.
3. Select the archived doc → the detail panel is preview-only: no `edit`/`preview`/`split` tabs, no `[s] save` / `[f] focus` / `[x] export`, but `[r] restore` and `[!] delete` are present.
4. Click `[r] restore` → the doc leaves the archive list. Click `[←] active` → the restored doc is back in the active list.
5. From the archive view, switch projects (project switcher / hamburger) → you return to the active view of the newly selected project.
6. From the archive view, open Admin → the `Library` section shows the active-document count for the current project (not 0).
7. Archive view of a project with no archived docs → "No archived documents." empty state, no create CTA.
8. From the archive view, create a new document (`+`) → after saving you land in the active view with the new doc selected.

Stop the demo server with Ctrl+C.

- [ ] **Step 3: If any smoke step failed, fix and recommit**

Debug, fix, add a regression test where it makes sense (render-level issues belong in `tests/frontend/renderLibrary.test.js`), and commit. If everything passed, no commit needed for this task.

---

## Self-review checklist

- [x] **Spec coverage:** state field + default (Task 2 §1), loader archived flag (Task 2 §2), active-count cache (Task 2 §2/§8), header toggle button (Task 1 §4), ARCHIVE kicker + count copy (Task 1 §4), empty-state copy (Task 1 §6), read-only detail panel / no editor pane / no mode tabs (Task 1 §7), restore+delete preserved (existing `isArchived` path, asserted in Task 1 §1), reset on view switch (Task 2 §5), reset on project switch (Task 2 §6), can't-create-into-archive (Task 2 §7, the documented refinement over spec §4), Admin count fix (Task 2 §8), tests (Task 1 §1) and manual smoke (Task 3 §2) match the spec's testing section.
- [x] **No placeholder steps:** every code step shows the exact before/after; every command step states the expected result.
- [x] **Type/name consistency:** `libraryView` (`'active'`/`'archive'`) and `libraryActiveDocumentCount` are introduced in Task 2 §1 and used identically in the loader, the render call, the toggle handler, the reset triggers, and the Admin count. The renderer option `libraryView` (Task 1) matches the state field passed in Task 2 §3. The `data-action="toggle-library-view"` attribute is emitted in Task 1 §4 and bound in Task 2 §4. The detail-panel read-only behaviour keys off the existing `isArchived` variable (Task 1 §7), which is consistent with the loader contract that archive-view docs all carry `archivedAt`.
