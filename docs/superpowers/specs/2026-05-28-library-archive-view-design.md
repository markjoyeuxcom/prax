# Library Archive View Design

**Date:** 2026-05-28
**Status:** Approved (brainstorm)
**Builds on:** v0.7.4

## Goal

When a Markdown document is archived from the Library, it should disappear from the active list and become visible only in a dedicated Archive view inside the Library workspace. The current behaviour — archived docs remain visible in the same list as active docs because the loader fetches `archived: 'all'` — is the bug being fixed.

The Archive view is read-only (preview-only, no editor pane) and reuses the existing list, filters, search, tag chips, and detail-panel restore/delete actions. A small header toggle moves between the two views inside the Library workspace; no new top-level nav entry.

## Current state (context)

- `loadDocuments` ([public/js/main.js:2399](public/js/main.js:2399)) passes `archived: 'all'`, so `state.documents` contains active and archived rows together. The list renderer doesn't filter on `archivedAt`.
- `renderDocumentDetail` ([public/js/renderLibrary.js:288](public/js/renderLibrary.js:288)) already conditionally swaps `[d] archive` for `[r] restore` + `[!] delete` when `document.archivedAt` is set, and hides `[i] info`. The editor mode tabs (edit/preview/split) and the editor pane render regardless.
- Tasks already have a dedicated Archive view (`isArchiveView` in [public/js/taskViews.js](public/js/taskViews.js), top-level nav button). The loader pattern there is the model: `archived: isArchiveView(state.activeView) ? true : undefined`. Library is the only domain with a broken archive surface.
- Server `listDocuments` already supports `archived: true | false | 'all'` ([server/libraryRepository.js](server/libraryRepository.js)). No backend change required for this feature.

## Non-goals (v1)

- No new top-level nav entry. The Archive lives inside the Library workspace only.
- No bulk restore or bulk delete. Per-doc actions only, same as Tasks archive.
- No edit-in-place for archived docs. Restore first, then edit.
- No keyboard shortcut for the toggle in v1.
- No MCP tool changes. Archived docs are not exposed for write or restore via MCP.
- No backend changes. The route and repo are unchanged.

---

## 1. State and navigation

Add a new state field:

```js
libraryView: 'active' | 'archive'  // default 'active'
```

It is reset to `'active'` whenever:

- The user clicks the Library nav (already moves you to the Library workspace; this also forces active mode).
- `state.activeProject` changes (project switcher or hamburger).
- `state.activeView` changes to anything other than `'library'`.

It is set to `'archive'` only by clicking the header toggle button described below.

The Library workspace header (`panel-header` in `renderLibraryHtml`) gains a new bracket-button on the right side, next to the existing `tags ↕` toggle:

- When `libraryView === 'active'`: `[a] archive` with `data-action="toggle-library-view"`.
- When `libraryView === 'archive'`: `[←] active` with the same `data-action`.

Clicking the button:

1. Flips `state.libraryView` to the other value.
2. Clears `state.selectedDocumentId`.
3. Calls `loadDocuments({ selectedDocumentId: null })` to re-fetch the right set.

When `libraryView === 'archive'`, the heading area gains a small `<span class="detail-kicker">ARCHIVE</span>` above the existing `<h2>Knowledge Library</h2>`, and the document-count line reads `N archived documents` instead of `N documents`. This is the only persistent "you are in the archive" signal in the workspace.

## 2. Data flow

`loadDocuments` ([public/js/main.js:2399](public/js/main.js:2399)) changes from:

```js
const documents = await fetchDocuments({
  project: state.activeProject === 'all' ? undefined : state.activeProject,
  archived: 'all',
});
```

to:

```js
const documents = await fetchDocuments({
  project: state.activeProject === 'all' ? undefined : state.activeProject,
  archived: state.libraryView === 'archive' ? true : undefined,
});
```

`archived: undefined` falls through to the server default (active only). `archived: true` returns only archived docs.

Effects:

- `state.documents` now contains exactly one set: either active or archived, never mixed.
- Existing callers of `loadDocuments({ ... })` keep working unchanged — they read `state.libraryView` from state.
- Archiving a doc from the active view → `loadDocuments` re-runs in active mode → the doc disappears from the active list. (This is the primary bug fix.)
- Restoring a doc from the archive view → `loadDocuments` re-runs in archive mode → the restored doc disappears from the archive list. User can switch to active to find it.
- Permanently deleting from the archive view → `loadDocuments` re-runs, archive list shrinks by one.

## 3. Renderer changes

All changes live in [public/js/renderLibrary.js](public/js/renderLibrary.js); no new files.

`renderLibraryHtml` gains a `libraryView` option (default `'active'`). It is threaded into the header and the detail panel.

**Header toggle button.** Inserted into the `panel-header` block alongside `tags ↕`:

```js
<button class="bracket-button bracket-button--quiet" type="button" data-action="toggle-library-view">${libraryView === 'archive' ? '[←] active' : '[a] archive'}</button>
```

**Archive kicker.** When `libraryView === 'archive'`, the `panel-header` heading area renders:

```html
<span class="detail-kicker">ARCHIVE</span>
<h2 id="library-title">Knowledge Library</h2>
<p>N archived documents</p>
```

instead of the existing `<h2>` + `<p>N documents</p>`. The count comes from `safeDocuments.length` as today; the word is the only change.

**Empty state.** `renderDocumentList` already handles an empty `documents` array with a `<div class="task-empty">` block. Branch the copy on `libraryView`:

- `libraryView === 'active'`: existing copy ("No Markdown documents" / "Create or import Markdown to build your runbook and notes library.")
- `libraryView === 'archive'`: "No archived documents." (no CTA).

**Read-only detail panel.** Pass `libraryView` into `renderDocumentDetail`. When `libraryView === 'archive'`:

- `editorVisible` is forced to `false` regardless of `editorMode`. `renderEditorPane` is never called, so the `[s] save`, `[f] focus`, `[x] export` toolbar is absent.
- `renderModes(editorMode)` is replaced with an empty string in the `detail-actions` div, so the `edit`/`preview`/`split` tabs are absent.
- `previewVisible` is forced to `true`. The doc renders in preview only.
- Existing `isArchived` conditionals for the action buttons (`[r] restore` / `[!] delete`) continue to work as today — they read `document.archivedAt`, which will be set on every doc in this view.

The `[i] info` button stays hidden (already hidden when `isArchived`).

When `libraryView === 'active'` and the selected doc happens to be archived (which the loader contract now prevents, but the renderer should still degrade gracefully), the existing `isArchived` behaviour applies — the restore/delete actions show. This is a defensive contract for renderer robustness, not an intentional UI surface.

## 4. Existing controls in the archive view

The list controls all keep working unchanged because they operate over `state.documents`:

- Tag filters and active-filter chips → filter the archive list by the same tags.
- Smart Views → tag combinations are orthogonal to active/archive; a saved view applies in either.
- Type filter (`all` / `runbook` / `note`), sort, group toggle → all apply.
- Tag search input → applies.

The bottom-nav `[+] new doc` slot and any "new document" button in the Library workspace render an empty string when `libraryView === 'archive'`. You cannot create directly into archive.

**Admin panel doc count.** The Library section in the Admin panel ([public/js/renderAdminPanel.js](public/js/renderAdminPanel.js)) shows a per-project document count computed from `state.documents.filter(d => !d.archivedAt && ...).length` ([public/js/main.js:1542](public/js/main.js:1542)). With the new loader, `state.documents` contains only one of {active, archived}, so this count would read `0` when Admin is opened from the archive view.

Fix: cache the active count on every active-mode fetch. Add `state.libraryActiveDocumentCount: number` (default `0`). At the end of `loadDocuments`, if `state.libraryView === 'active'`, recompute and store the count from the freshly-fetched `documents` array. When rendering the Admin panel, read `state.libraryActiveDocumentCount` instead of recomputing from `state.documents`. The count may be one fetch stale if you've been in archive view for a while, but it's accurate as of the last visit to the active view — acceptable for an informational metric on an Admin surface.

This avoids the alternative of forcing `libraryView` back to `'active'` when Admin opens, which would surprise the user by dropping them out of the archive view they were inspecting.

## 5. Error handling and edge cases

| Case | Behaviour |
|---|---|
| Switch projects while in archive view | `libraryView` resets to `'active'`. `loadDocuments` re-runs against the new project's active list. |
| Switch `activeView` away from Library and back | `libraryView` resets to `'active'` when Library is re-entered. No archive surprise. |
| Empty archive | "No archived documents." empty state, no CTA. |
| Restore the only archived doc | `loadDocuments` returns `[]`; archive list shows the empty state; user clicks `[←] active` to see the restored doc. |
| Permanent delete the only archived doc | Same as restore — empty state in archive. |
| Toggle the view while a doc is selected | Selection is cleared (`selectedDocumentId = null`) before the re-fetch; the new list renders with no selection. |
| `state.documents` somehow contains a mix (loader bug, future regression) | The renderer renders whatever is in `state.documents` and doesn't filter on `archivedAt`. The contract is the loader's. |
| Network failure on the archive-mode `loadDocuments` | Same path as today's `loadDocuments` error handling (no new error UI). |
| Existing keyboard shortcut `[d]` for archive in the detail panel | Unaffected — only fires when an active doc is selected, which is unchanged. |

---

## Data flow summary

```text
[ click [a] archive in header ]
  → setState({ libraryView: 'archive', selectedDocumentId: null })
  → loadDocuments({ selectedDocumentId: null })
      → fetchDocuments({ project, archived: true })
      → setState({ documents: <archived only>, ... })
  → renderApp() with libraryView='archive'
      → header shows [←] active + ARCHIVE kicker
      → list shows archived docs
      → detail panel: preview-only, [r] restore + [!] delete actions

[ click [r] restore on a doc ]
  → existing restore handler
  → loadDocuments({ selectedDocumentId: null })
      → still in libraryView='archive', re-fetches archive
      → restored doc no longer present
  → renderApp() → archive list shorter by one

[ click [←] active in header ]
  → setState({ libraryView: 'active', selectedDocumentId: null })
  → loadDocuments → fetches active set
  → restored doc now visible
```

---

## Build order

1. State + loader change (`state.libraryView`, `state.libraryActiveDocumentCount`, `loadDocuments` archived flag, active-mode count cache update) + reset triggers (project change, view change, Library nav). Tests for the state transitions.
2. Renderer changes (`renderLibraryHtml` toggle button, kicker, count copy; `renderDocumentList` empty-state branch; `renderDocumentDetail` editor-pane suppression in archive mode). Tests for the rendered HTML.
3. Handler wiring (`toggle-library-view` click handler in main.js library bind block). No new test surface beyond what the render and state tests already cover; the click handler is a one-liner setState + loadDocuments.

---

## Testing

### Frontend renderer (`tests/frontend/renderLibrary.test.js`)

- `libraryView: 'active'` (default): header contains `[a] archive` button with `data-action="toggle-library-view"`; no `ARCHIVE` kicker; document-count line reads `N documents`.
- `libraryView: 'archive'`: header contains `[←] active`; `<span class="detail-kicker">ARCHIVE</span>` present; document-count line reads `N archived documents`.
- `libraryView: 'archive'` with empty `documents`: empty-state copy is "No archived documents." (no CTA copy).
- `libraryView: 'archive'` with a selected archived doc: no `edit`/`preview`/`split` mode tabs in the detail header; no `[s] save`, `[f] focus`, `[x] export` in the detail panel; `[r] restore` and `[!] delete` are present; preview pane renders.
- `libraryView: 'active'`: existing behaviour fully preserved — mode tabs present, full editor toolbar present for an active doc.
- Defensive: a doc with `archivedAt` set rendered in `libraryView: 'active'` still surfaces the restore/delete buttons (existing `isArchived` path).

### Frontend state and handler (extension to an existing test file, e.g. `tests/frontend/libraryFilters.test.js` or a new small `tests/frontend/libraryView.test.js`)

- Toggling `libraryView` from `'active'` to `'archive'` clears `selectedDocumentId`.
- Changing `activeProject` resets `libraryView` to `'active'`.
- Changing `activeView` to anything else and back to `'library'` resets `libraryView` to `'active'`.
- A successful active-mode `loadDocuments` updates `state.libraryActiveDocumentCount` to the new active count; archive-mode `loadDocuments` leaves it untouched.

### Backend

No change. The existing `tests/backend/libraryRepository.test.js` coverage of `archived: true | false | 'all'` filtering is sufficient.

### Manual smoke (PR description)

1. Library → archive a doc → it disappears from the active list immediately.
2. Header `[a] archive` → archive view shows the doc; preview-only; restore + delete buttons present.
3. Restore → doc reappears in active view after `[←] active`.
4. Switch projects from inside archive view → returns to active view of the new project.
5. Open Admin from archive view → Library section shows the active-doc count, not 0.
6. Archive view + empty result (project with no archived docs) → "No archived documents." empty state, no CTA.

---

## Risks / notes

- The `loadDocuments` change ripples to every caller indirectly. Because every caller reads `state.libraryView` from state (and the default is `'active'`), the behaviour for any caller that doesn't care about archive is unchanged. The risk surface is the reset triggers: forgetting one (e.g. Library nav click) means the user lands on a stale archive view. The state tests cover each reset trigger.
- The Admin panel doc-count cache (`state.libraryActiveDocumentCount`) can be one fetch stale when Admin is opened from a long-lived archive view session. Trade-off accepted: the metric is informational, the alternative (forcing `libraryView` back to active on Admin open) would surprise the user on Admin close.
- No backend, no MCP, no route changes. The blast radius of the diff is contained to three frontend files and their tests: `public/js/renderLibrary.js`, `public/js/main.js`, and one test file (plus possibly a small new one).
- The defensive `isArchived` path in the active view's detail panel (rendering restore/delete for a doc that "shouldn't" be there) is a renderer contract, not a UI surface. The loader guarantees prevent it from being exercised in practice. Keeping it costs nothing and protects against future loader regressions.
