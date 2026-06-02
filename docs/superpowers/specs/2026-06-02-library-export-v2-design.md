# Library `.md` front-matter v2 design

**Status:** Approved
**Date:** 2026-06-02
**Target release:** v0.11.0
**Predecessors:**
- [`2026-05-31-document-graph-mvp-design.md`](./2026-05-31-document-graph-mvp-design.md) — links
- [`2026-05-31-doc-graph-provenance-design.md`](./2026-05-31-doc-graph-provenance-design.md) — content_hash, updated_by
- [`2026-06-02-document-kind-design.md`](./2026-06-02-document-kind-design.md) — kind

## Goal

Extend the library `.md` export front-matter so a zip captures the full document model:
the document graph (`derived-from`, `supersedes`), provenance (`content_hash`,
`updated_by`), and `kind`. Stay export-only — no import path. Agents and humans reading
a Moomora export get the same context the live app has, minus the body of the relationship
graph that would have lived in a database.

## Decisions locked in

- **Identifier:** hybrid. Each link target is `{ id, ref }` where `id` is the UUID
  (authoritative) and `ref` is a path-style hint matching where the target lives in the
  zip when possible. The `ref` is not authoritative — readers must use `id` for any
  programmatic resolution.
- **Scope:** full v2 — `kind`, `content_hash`, `updated_by`, and `links` all land in v2.
- **Round-trip:** export-only. No import parser, no link-resolution-on-import, no version
  field in YAML.
- **Always-emit:** `links: derived-from: [], supersedes: []` is always present, matching
  the existing `tags: []` convention. The predictability dominates the per-doc verbosity
  cost for the orphan majority.
- **Direction:** outbound only. Inbound (`backlinks`) is derivable from the rest of the
  export.

## Non-goals

- **No import / round-trip.** Library exports stay one-way; the spec for that lives in a
  future feature once we know what import is for (Obsidian sync, backup restore, DB
  migration are all plausible — none is current). Adding import without that motivation
  bloats the surface area.
- **No format version field.** YAML readers ignore unknown keys; existing v1 readers (and
  generic Markdown tools) will silently accept v2. We add a version field at the moment
  we add an import parser that needs it.
- **No inbound / backlink emission.** Always derivable from other docs' outbound lists.
- **No body changes.** v2 is front-matter only.
- **No per-doc opt-out.** No HTTP query to skip the v2 fields.

## Front-matter shape

Front-matter gains five keys in this order, appended after the existing v1 keys:

```markdown
---
title: Postgres restore
type: runbook
project: homelab
tags:
  - postgres
  - dr
created_at: 2026-04-12T10:33:21.000Z
updated_at: 2026-05-20T08:11:09.000Z
kind: synthesized
content_hash: 47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d
updated_by: agent
links:
  derived-from:
    - id: c58d3108-4f93-4a50-ac42-0c1d61e61b08
      ref: homelab/cloudnativepg-restore.md
  supersedes: []
---
```

### Field rules

- **`kind`**: `'source' | 'synthesized'`. Unquoted (constrained vocabulary).
- **`content_hash`**: SHA-256 hex of the body, lowercase, unquoted, 64 chars.
- **`updated_by`**: `'user' | 'agent'`. Unquoted.
- **`links`**: a block with exactly two keys, in this order: `derived-from`, then
  `supersedes`. Each is a YAML list. Empty lists render as `derived-from: []` /
  `supersedes: []` inline. Non-empty lists render as block sequences with `id:` and
  `ref:` keys (in that order) per entry.
- **`id`**: target UUID.
- **`ref`**: hint string. Computation rules, in order:
  1. **All-projects export, target in any project**: `<projectSlug>/<documentFilename
     (target)>` (resolves to a file in the zip).
  2. **Single-project export, target in the same project**: bare
     `<documentFilename(target)>` (resolves to a file in the zip, since the
     single-project zip is flat, no project-slug folder).
  3. **Single-project export, target in a different project**:
     `<projectSlug>/<documentFilename(target)>` — the ref dangles by design (the target
     is not in the zip). The `id` remains authoritative.

  In all cases, `documentFilename(target)` uses the same logic as the zip-entry
  filename: `sourceFilename` basename, else slugified title, else `untitled.md`.

### Key ordering rationale

The v1 prefix (`title`, `type`, `project`, `tags`, `created_at`, `updated_at`) stays
unchanged so existing tooling that diffs v1 against v2 sees a clean append. The new
keys are grouped: scalar provenance first (`kind`, `content_hash`, `updated_by`), then
the multi-line `links:` block last.

## Architecture

Two files, kept byte-identical (the existing contract test enforces this):

- `server/libraryExport.js` — pure module. `formatFrontMatter(doc, projectSlug, links)`
  gains a third argument: a `{ outboundByRelation }` object shaped
  `{ 'derived-from': [{ id, ref }, ...], supersedes: [{ id, ref }, ...] }`.
  Callers (the route layer) compute the `ref` strings before calling.
  `renderDocumentMarkdown(doc, projectSlug, links)` threads `links` through to
  `formatFrontMatter`.
- `public/js/libraryExport.js` — mirror. Same signature, byte-identical output.

### `formatFrontMatter` signature

Today:
```js
formatFrontMatter(doc, projectSlug)
```

After:
```js
formatFrontMatter(doc, projectSlug, links)
// links: { 'derived-from': [{ id, ref }], supersedes: [{ id, ref }] }
// Both keys are required. Empty arrays are valid.
```

If a caller passes `links: undefined`, the formatter falls back to empty arrays
(`{ 'derived-from': [], supersedes: [] }`). This keeps single-doc callers that pre-date
v2 — and the existing contract dual-write smoke at fixture-construction time —
trivially safe.

## Data flow

### Bulk export (`GET /api/library/export`)

Today the route calls `repository.listActiveDocumentsForExport({ projectId })` which
returns docs with `projectSlug` joined. For v2 we add a sibling repository method that
returns outbound links for a batch of doc ids.

**New method** on `documentLinksRepository`:

```js
async listOutboundLinksForDocuments(docIds)
// returns Map<sourceDocId, { 'derived-from': [{ targetId, targetProjectSlug,
//   targetSourceFilename, targetTitle }], supersedes: [...same shape...] }>
```

SQL sketch:

```sql
select dl.source_document_id,
       dl.relation,
       t.id as target_id,
       p.slug as target_project_slug,
       t.source_filename as target_source_filename,
       t.title as target_title
from document_links dl
join markdown_documents t on t.id = dl.target_document_id and t.archived_at is null
join projects p on p.id = t.project_id
where dl.source_document_id = any($1)
order by dl.source_document_id, dl.relation, t.title
```

The route then computes `ref` per entry using the same `documentFilename(target)` logic
the export already uses, plus the `<projectSlug>/` prefix rules from the field-rules
section above.

The route assembles the `outboundByRelation` shape per doc:

```js
{
  'derived-from': edges
    .filter(e => e.relation === 'derived-from')
    .map(e => ({ id: e.targetId, ref: computeRef(e) })),
  supersedes: edges
    .filter(e => e.relation === 'supersedes')
    .map(e => ({ id: e.targetId, ref: computeRef(e) })),
}
```

…and passes it to `renderDocumentMarkdown(doc, doc.projectSlug, links)`.

### Single-doc download

Today, the UI fetches `/api/library/documents/:id` then calls `buildExportedMarkdown
(doc, slug)` client-side, and the browser's `triggerDownload` saves it.

For v2, the UI would also need the doc's outbound links. Rather than thread that
through the browser, **add a new server endpoint**:

```
GET /api/library/documents/:id/export
```

…which:
- Resolves the doc.
- Fetches its outbound links (using the same `listOutboundLinksForDocuments([id])`
  method as bulk).
- Renders the `.md` using `renderDocumentMarkdown`.
- Sets `Content-Type: text/markdown; charset=utf-8` and
  `Content-Disposition: attachment; filename="<documentFilename(doc)>"`.
- Returns the rendered string.

The browser flow changes from "fetch JSON + render locally + trigger download" to
"trigger download against the export URL". `triggerDownload` stays as a helper if any
non-export download path uses it; otherwise inline-anchor with `href` to the URL is
fine.

`public/js/libraryExport.js` stays in the repo (byte-identical to the server) and
remains exercised by the contract dual-write invariant test, but is no longer the live
rendering path for single-doc download. This trades one bit of redundancy for a single
source of truth on what gets emitted.

### Cross-project link targets in single-project exports

A doc in project A might `derived-from` a doc in project B. In an all-projects export
both exist; the `ref` for the cross-project edge uses the standard
`<projectSlug>/<file>` form and resolves correctly when the zip is extracted.

In a single-project export, the cross-project target is **not** in the zip. The `ref`
still emits in cross-project form (`<projectSlug>/<file>`) and dangles — the UUID
`id` is still authoritative, so machine consumers can resolve it against a live API
or a different export. This is intentional: dropping the link silently would lose
information.

## Demo server

The in-memory demo server (`scripts/demo-server.js`) mirrors the new method and
behavior:

- `createMemoryDocumentLinksRepository.listOutboundLinksForDocuments(docIds)` returns
  the same grouped shape.
- The demo bulk-export route call site passes links through to the renderer.
- The demo single-doc-export route is added.

## Testing strategy

### Pure-function tests (`tests/contract/libraryFormat.test.js` and dedicated file)

- `formatFrontMatter` with empty links: emits `derived-from: []` / `supersedes: []`.
- With a single `derived-from` entry: block sequence with `id:` / `ref:` in that order.
- With multiple `derived-from` entries: list order preserved (we sort by target title
  in the SQL).
- With both relations populated: both blocks present, `derived-from` before `supersedes`.
- With cross-project `ref`: emitted with project prefix.
- `kind`, `content_hash`, `updated_by` placement: between `updated_at` and `links:`,
  in spec order.
- `content_hash` is unquoted (it's a-z0-9 only).
- All v2 fields appear when constructed from a normalized document row from the
  repository.

### Dual-write invariant

Extend the existing test in `tests/contract/libraryFormat.test.js`:

```js
test('SHAPE: browser serializer is byte-identical to server (dual-write invariant)', () => {
  const fixtures = [
    // existing v1 fixtures…
    // new: doc with kind/contentHash/updatedBy and no links
    // new: doc with derived-from only
    // new: doc with both relations
    // new: doc with cross-project ref
  ];
  for (const { doc, slug, links } of fixtures) {
    assert.equal(
      buildExportedMarkdown(doc, slug, links),
      renderDocumentMarkdown(doc, slug, links)
    );
  }
});
```

### Repository test

`tests/backend/documentLinksRepository.export.test.js`:

- `buildListOutboundLinksForDocuments` SQL selects the right columns from the right
  joins.
- `listOutboundLinksForDocuments` returns the grouped Map shape.
- Archived target documents are excluded (matches the existing pattern).
- Empty input returns an empty Map.

### Route tests

`tests/backend/libraryExportRoute.test.js` (extend):

- Bulk export: a seeded doc with links produces a ZIP whose front-matter contains the
  links block.
- A doc without links emits the empty-block form.

`tests/backend/librarySingleExportRoute.test.js` (new):

- `GET /api/library/documents/:id/export` returns 200 with `text/markdown` and the
  rendered front-matter+body.
- Returns 404 for a missing or archived doc.
- 400 for an invalid UUID.

### E2E smoke against real Postgres

- `docker compose up`, seed a project with one derived-from link, hit
  `GET /api/library/export`, unzip, eyeball the front-matter.
- Hit `GET /api/library/documents/:id/export` directly, verify the response.

## Contract docs

`docs/contract.md` "Format 2" section updates:

- Replace the existing golden example with the v2 example above.
- Add field-rule prose for `kind`, `content_hash`, `updated_by`.
- Add a `links` subsection explaining:
  - Outbound only.
  - `{ id, ref }` shape; `id` authoritative, `ref` is a hint.
  - `ref` computation rules (single-project vs all-projects, cross-project dangle).
  - Always-emit empty `derived-from: []` / `supersedes: []`.
- Add a new entry to the "Not currently supported" list re-confirming no import.
- Add the new HTTP route: `GET /api/library/documents/:id/export`.

## Release

Single PR. Cuts as **v0.11.0** (minor: additive front-matter additions, additive new
HTTP route, no breaking changes to v1 readers since YAML ignores unknown keys).

## Open questions

None.
