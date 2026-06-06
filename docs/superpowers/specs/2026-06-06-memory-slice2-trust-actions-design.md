# Memory Slice 2 — Trust Actions on Every Surface

**Status:** Approved (brainstorm complete)
**Date:** 2026-06-06
**Branch:** `memory-slice2-trust-actions`

## Context

Slice 1 (v0.15.0) shipped the trust model — `verified` / `status` on documents, the
`POST /api/library/documents/:id/verify` and `…/supersede` routes, conservative active-only
retrieval, the `moomora` CLI (`verify` / `supersede`), and **read-only** trust display in the
Library UI (the `VERIFIED` / `SUPERSEDED` chips). See
[`2026-06-04-shared-ai-memory-slice1-design.md`](2026-06-04-shared-ai-memory-slice1-design.md).

The trust loop is therefore live on the **API** and **CLI**, but the **web UI** can only *read*
trust (no buttons), and the **MCP** server has no write tools for it. This slice closes that gap:
trust actions on every surface that already reads them.

## Goal

Let a human verify/supersede documents from the **web UI**, and let an agent supersede via **MCP** —
both wrapping the existing slice-1 routes. No schema or route changes.

## Decisions (resolved during brainstorm)

| Topic | Decision |
|---|---|
| Scope | **UI verify/supersede actions + MCP `supersede_document` only.** The skills→CLI convergence (roadmap) stays a separate future slice. |
| MCP verify | **Not exposed.** Verification stays a deliberate human act (UI button / `moomora verify --as`). `verified` keeps meaning "a human blessed it." Agents can `supersede` (content lifecycle) but not self-bless. |
| Supersede UX | **Reuse the existing link-picker modal** with a `pickerMode` flag (`'link'` default / `'supersede'`). No new picker component. |
| Verify actor | UI passes `as: 'user'` (no-auth model); `verified_by` shows `user`. |
| Superseded docs | Remain editable — `superseded` is a status, not archival. The detail panel notes the replacement (from the existing `supersedes` backlink). |

## Non-Goals (deferred)

- A `verify_document` MCP tool (verify stays human-only).
- Converging `moomora-recall` / `moomora-remember` onto the CLI (own slice).
- Any backend route or schema change (the slice-1 routes are sufficient).
- Prompting for / authenticating the verifier identity (no-auth model; actor is `'user'`).
- Disabling edit on superseded documents.

## Architecture

```
Web UI  ── verifyDocument()/supersedeDocument() (libraryApi.js) ─┐
                                                                  ├─► POST …/verify   (slice-1 route)
MCP     ── supersede_document tool → client.supersedeDocument ───┘   POST …/supersede (slice-1 route)
```

Both surfaces are thin clients over the existing routes. No new server code.

## Section 1 — Browser API client + UI actions

### `public/js/libraryApi.js`
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

### `public/js/renderLibrary.js` (detail panel)
In the `detail-actions` row, shown only when the document is **not archived**:
- **Verify toggle:** `[v] verify` when `!document.verified`, `[v] unverify` when verified —
  `data-action="toggle-verify"`.
- **Supersede:** `[s] supersede…` — `data-action="supersede-document"`, shown only when
  `document.status !== 'superseded'`.
- When `document.status === 'superseded'`, the `library-detail-meta` line gains a note
  (e.g. `· superseded`) — the replacement is visible in the existing **Links → Supersedes/Backlinks**
  section the detail panel already renders, so no new lookup is needed.

### `public/js/state.js`
- Add `pickerMode: 'link'` (default). The supersede flow sets it to `'supersede'` and reuses the
  existing `isLinkPickerOpen` / `linkPickerDocuments` / `linkPickerQuery` state.

### `public/js/main.js`
- **`toggle-verify`** handler: `await verifyDocument(id, !document.verified)`, then reload the
  document list and keep the doc selected so the chip + meta refresh.
- **`supersede-document`** handler: load the active, non-self documents for the current project
  (via `fetchDocuments({ project, archived: false })`, filter out the current id and any
  `status === 'superseded'`), set `pickerMode='supersede'`, open the picker.
- The picker's existing select handler branches on `state.pickerMode`:
  - `'link'` → current task↔document link behaviour (unchanged).
  - `'supersede'` → `await supersedeDocument(currentDocId, pickedId)`, close the picker, reset
    `pickerMode='link'`, reload the list, and re-fetch the selected doc's links so the new
    `supersedes` backlink appears.
- On close/cancel, `pickerMode` resets to `'link'`.

## Section 2 — MCP `supersede_document`

### `mcp/moomoraClient.js`
```javascript
supersedeDocument: (id, supersededBy) =>
  request('POST', `/api/library/documents/${id}/supersede`,
    { body: { supersededBy }, headers: { 'x-moomora-origin': 'agent' } }),
```

### `mcp/tools/documentLinks.js` (new tool alongside `link_documents`)
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
}
```
- `server.js` already spreads `createDocumentLinkTools(apiClient)`, so the tool auto-registers —
  **no `server.js` change**.
- **No `verify` tool.** `get_document` / `search_documents` / `search_documents_semantic` already
  surface `verified` / `status` read-only, so agents can see trust state, just not set it.

## Section 3 — Testing, docs & scope

### Demo server
No change. The in-memory repo already implements `markDocumentSuperseded` and `listDocuments`
(used by the supersede picker) from slice 1, so the UI flow and the MCP tool both work under
`npm run demo`.

### Tests
- **MCP contract** (`tests/contract/mcpToolContract.test.js`): assert `supersede_document` is
  present with its input schema (`documentId`, `supersededBy`).
- **MCP handler** (`tests/mcp/documentLinksTools.test.js`): `supersede_document` rejects non-UUID
  args and self-supersede, and calls `client.supersedeDocument` on valid input. **MCP client**
  (`tests/mcp/moomoraClient.test.js`): `supersedeDocument` POSTs the right path/body with the
  `x-moomora-origin: agent` header.
- **UI render** (`tests/frontend/renderLibrary.test.js`): the detail panel emits the `toggle-verify`
  button (label flips on `verified`) and the `supersede-document` button (hidden when
  `status === 'superseded'`). **API client** (`tests/frontend/libraryApi.test.js`):
  `verifyDocument` / `supersedeDocument` hit the right URLs/bodies.
- **E2E** (`tests/e2e/`, Playwright, against the demo): one flow — select a doc, click verify
  (assert `VERIFIED` chip appears + meta shows "verified"), then supersede it with another doc
  (assert `SUPERSEDED` chip + dim + the `Supersedes`/backlink in the Links section).

> The slice-1 supersede route already rejects self-supersede (`server/libraryRoutes.js`), so the
> MCP tool's `documentId === supersededBy` guard is a belt-and-suspenders early error, not the only
> line of defence.

### Docs
- `docs/contract.md` — add `supersede_document` to the MCP tool surface; note verify is UI/CLI-only.
- `CHANGELOG.md` `[Unreleased]` — verify/supersede in the Library UI + the `supersede_document` MCP
  tool.

### Scope boundaries (out, restated)
No `verify` MCP tool; UI verify actor is `'user'`; supersede picker = same-project, active, non-self
docs; superseded docs stay editable; no backend/schema change; skills→CLI converge deferred.

## Success criteria

1. From the Library UI: a human can toggle a document **verified ⇄ unverified** (chip + meta update
   live) and **supersede** a document by picking a replacement (old doc flips to `superseded`, gains
   a `supersedes` backlink, drops out of default/semantic retrieval).
2. From MCP: an agent can `supersede_document(old, new)` and **cannot** verify (no such tool).
3. The no-vector-leak invariant and active-only retrieval from slice 1 are untouched (no backend
   change), and `npm test` + `npm run check` stay green.
