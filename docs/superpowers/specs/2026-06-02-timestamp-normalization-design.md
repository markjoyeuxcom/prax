# Timestamp normalization at the data-layer boundary

**Status:** Approved
**Date:** 2026-06-02
**Target release:** v0.11.1 (patch)

## Goal

Ensure every JSON timestamp field exposed by the HTTP API and the library export
emits ISO-8601 form (`YYYY-MM-DDTHH:mm:ss.sssZ`), matching what the contract documents
already promise. Today, production responses backed by Postgres TIMESTAMPTZ columns
emit the JS `Date.toString()` form (e.g. `Tue Jun 02 2026 19:47:21 GMT+0000 (Coordinated
Universal Time)`) because the `pg` driver returns `Date` objects and the normalizers
pass them through unchanged. Most CI tests use ISO strings as fixtures, so the bug is
invisible to the suite.

## Why this matters

- The library `.md` export emits the raw value in front-matter (`server/libraryExport.js:43-44`),
  so a real-Postgres export bears a non-ISO timestamp while the contract example shows ISO.
- The HTTP API's JSON response shapes (`/api/library/documents`, `/api/tasks`,
  `/api/projects`, `/api/tasks/:id/checklist`, `/api/tasks/:id/activity`) all serialize
  through these normalizers. `JSON.stringify(date)` happens to produce ISO when the value
  is a Date — but every Markdown-rendered or template-rendered touchpoint stringifies via
  `${value}` which calls `.toString()`. The shapes are inconsistent in subtle ways.

## Decisions locked in

- **Five normalizers in scope**: `normalizeDocumentRow`, `normalizeTaskRow`,
  `normalizeActivityRow`, `normalizeProjectRow`, `normalizeChecklistRow`. (The other
  exported normalizers — `normalizeLinkRow`, `normalizeStaleRow`,
  `normalizeTaskBoardExtraRow` — don't expose timestamp fields.)
- **Shared helper, single file**: `server/columnTypes.js` exports `toIso(value)`. New
  file rather than scattering inline because the project has no existing shared util
  module and we want one canonical home for column-type adapters.
- **Pass-through behavior**: `null` and `undefined` are returned unchanged; `Date`
  instances become ISO strings; strings pass through unchanged.
- **No schema change. No wire format change.** This is a correctness fix making
  production match the contract docs.

## Non-goals

- No touch to `server/libraryExport.js` — fix lives in the normalizers, not at the
  rendering boundary. If a future caller bypasses normalization (none exists today),
  they're responsible for their own coercion.
- No changes to MCP tool output shapes (those flow through the same normalizers).
- No introduction of a broader util module ("server/utils.js") — `columnTypes.js` is
  named for the narrow purpose and can grow if other column-type adapters appear.
- No bulk renaming of fields, no doc rewording.

## Implementation

### `server/columnTypes.js` (new)

```js
export function toIso(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}
```

Properties:
- `null` → `null` (preserves `archivedAt: null` in JSON responses).
- `undefined` → `undefined`.
- `Date` → `value.toISOString()` (e.g. `2026-06-02T19:47:21.000Z`).
- `string` → unchanged (fixtures that pass ISO strings still work).
- Other types are passed through; we don't try to coerce numbers (no caller emits
  those today).

### Normalizer wrap

In each of the five normalizers, every timestamp field is wrapped:

```js
createdAt: toIso(row.created_at),
updatedAt: toIso(row.updated_at),
archivedAt: toIso(row.archived_at),
```

Affected fields:
- `normalizeDocumentRow` — `createdAt`, `updatedAt`, `archivedAt`.
- `normalizeTaskRow` — `createdAt`, `updatedAt`, `archivedAt`.
- `normalizeActivityRow` — `createdAt`.
- `normalizeProjectRow` — `createdAt`, `updatedAt`.
- `normalizeChecklistRow` — `createdAt`, `updatedAt`.

No other code changes. The library export formatter, the route handlers, the MCP tool
output adapters — all unchanged.

## Testing

### New file: `tests/backend/normalizers.timestamps.test.js`

Three behavior tests per normalizer (five normalizers × three checks = 15 assertions
in one file):

For each of `normalizeDocumentRow`, `normalizeTaskRow`, `normalizeActivityRow`,
`normalizeProjectRow`, `normalizeChecklistRow`:
1. Date inputs → ISO string output (assert regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`).
2. `null` for `archived_at` (where applicable) → `null` output.
3. ISO string inputs → unchanged output (existing fixture pattern).

### Plus: `server/columnTypes.toIso.test.js` (or inlined in the normalizers test)

Three unit tests for the helper:
1. `Date` → ISO string.
2. `null` / `undefined` → pass through.
3. String → pass through.

### Contract regression

Extend `tests/contract/libraryFormat.test.js` so at least one dual-write fixture
seeds `createdAt` / `updatedAt` as **`Date` objects**. The fixture then asserts the
rendered front-matter contains the ISO form. This locks the production bug so it
can't recur silently.

Today's fixtures use ISO strings, which is why the bug was invisible to CI. After this
change, a future regression in normalization OR in `toIso` would turn the contract
test red.

## Real-Postgres smoke verification (release-time)

After merging, repeat the v0.11.0 smoke against a fresh `docker compose up -d --build`:

1. Create a doc via POST.
2. `GET /api/library/documents` — assert response JSON contains ISO timestamps.
3. `GET /api/library/export` — unzip a `.md`, eyeball that `created_at` / `updated_at`
   are ISO, NOT JS `Date.toString()`.
4. `GET /api/library/documents/:id/export` — same check.

## Release

Patch — **v0.11.1**. Single PR. No new feature, no contract surface change, just
correctness.

## Open questions

None.
