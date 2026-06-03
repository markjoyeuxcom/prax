# Document graph UI surface design

**Status:** Approved
**Date:** 2026-06-03
**Target release:** v0.12.0
**Predecessors:**
- [`2026-05-31-document-graph-mvp-design.md`](./2026-05-31-document-graph-mvp-design.md) — links
- [`2026-05-31-doc-graph-provenance-design.md`](./2026-05-31-doc-graph-provenance-design.md) — content_hash, updated_by
- [`2026-06-02-document-kind-design.md`](./2026-06-02-document-kind-design.md) — kind
- [`2026-06-02-library-export-v2-design.md`](./2026-06-02-library-export-v2-design.md) — export v2

## Goal

Make the document graph **visible in the UI**. Until now, links, kind, and stale/orphan
status have been first-class concepts in the API and MCP layer but invisible in the
console UI. v0.12 closes that gap: detail-panel link display, list-view stale/synthesized
signals, and a dedicated Maintenance panel for grooming. No new graph data — every byte
this surfaces already exists in the HTTP API.

## Decisions locked in

- **Read-only graph display.** No `+ Add link` affordance, no unlink button. Links are
  still created/removed via MCP or the HTTP API. The agent stays the link author until
  we have enough real usage to know what UI-driven link curation should look like.
- **Inline stale signals AND a dedicated Maintenance panel.** Inline pills drive
  attention; the panel is the curation surface. Both together.
- **One small backend contract addition: `stale: boolean` on the doc list response.**
  Avoids the client-side cross-reference fetch. Computed via a left-join lateral in the
  list query.
- **Kind badge in both the list view (`SYNTH` chip on synthesized rows) and the detail
  panel (full `SOURCE` / `SYNTHESIZED` pill).** `updated_by` in the detail panel only —
  density management in the list.

## Non-goals

- **No link editing.** No add-link picker, no unlink button. Read-only over the graph.
- **No graph visualization.** No force-directed graph view, no per-project graph map.
  Deferred to a future release if/when usage signals demand it.
- **No actions in the Maintenance panel.** No "mark reviewed," no "trigger refresh,"
  no bulk operations. It's a read-only curation surface.
- **No mobile-specific layout tuning** beyond the existing responsive shell. The new
  chips and Links section should render acceptably on small viewports because they
  reuse existing token/spacing rules, but no dedicated mobile redesign.
- **No `references` relation** (see "Future work" below).
- **No `staleSources` rendering in the inline list.** The list chip says "STALE" only;
  to see *what* changed, you open the doc or the Maintenance panel.

## Surface

### Detail panel — additions

The existing document detail drawer (`renderDocumentDetail`-ish component) gains three
pieces of UI:

1. **`kind` badge** next to the title.
   - `kind: 'source'` → small `SOURCE` pill, muted (low-emphasis) styling.
   - `kind: 'synthesized'` → `SYNTHESIZED` pill, accent color (one of the existing
     palette accent tokens — see "Styling" below).
2. **`updated_by` line** in the metadata block, alongside the existing date stamps:
   `Updated by: user` or `Updated by: agent`.
3. **Links section** below the body:

   ```
   ─── Links ──────────────────────────────
   Derived from:
     → CloudNativePG backup verification           [open]

   Backlinks:
     ← Postgres restore — quick reference          (derived-from)
     ← Postgres restore — summary                  (derived-from)
   ```

   Behavior:
   - Fetched via the existing `GET /api/library/documents/:id/links?direction=both`.
   - Grouped by direction: "Derived from" / "Supersedes" for outbound; "Backlinks"
     for inbound (with the relation type in parens since inbound mixes relations).
   - Each row: title + relation hint + `[open]` action.
   - **`[open]` action** navigates the detail panel to the linked document. Preserves
     a small back-stack so a back button (or browser back) returns to the previous
     doc in the panel.
   - Empty state: "No links."

### Library list view — additions

Two small per-row signals, rendered to the right of the title:

1. **`SYNTH` chip** on rows where `kind === 'synthesized'`. Muted accent color.
2. **`STALE` pill** on rows where `stale === true`. Warmer accent color (amber/yellow
   tone, mapped through the existing palette tokens). Clicking the pill opens the doc
   detail with the Links section pre-expanded.

Rows that are neither synthesized nor stale render with no extra chips. The chip area
is part of the existing title row — no new vertical space per row.

### Admin → Maintenance panel (new)

A new section under Admin, sibling to the existing Import / Export / Backup panels.

```
Admin
├── Backup
├── Import
├── Export
└── Maintenance      ← new
```

**Layout:**

- **Filter**: project picker (`All projects` default) and a Refresh button. The filter
  passes through to both API calls as `?project=<slug-or-id>`. Refresh re-fetches both
  lists with current filter applied.
- **Two stacked sections**: "Stale documents" then "Orphan documents." Each has:
  - Short explanation line ("Documents whose `derived-from` source has changed…" /
    "Documents with no inbound or outbound links.").
  - A table with rows showing title + metadata + `[open]` action.
  - Empty state ("No stale documents. Nice." / "No orphan documents.").
- **Click [open]** on a row → opens the doc in the standard detail panel.

Backed by existing endpoints:
- `GET /api/library/maintenance/stale?project=...`
- `GET /api/library/maintenance/orphans?project=...`

No new HTTP work.

## Backend contract addition

The library list response gains one field per row:

```
stale: boolean
```

`true` if and only if the doc appears in `list_stale_documents` (i.e. has an outbound
`derived-from` edge whose `target_hash` differs from the target's current `content_hash`).
`false` otherwise.

### SQL approach

Extend `buildListDocuments`'s query with a `left join lateral`:

```sql
left join lateral (
  select true as stale
  from document_links dl
  join markdown_documents tgt on tgt.id = dl.target_document_id and tgt.archived_at is null
  where dl.source_document_id = d.id
    and dl.relation = 'derived-from'
    and dl.target_hash is not null
    and tgt.content_hash is distinct from dl.target_hash
  limit 1
) s on true
```

…and in the SELECT list: `coalesce(s.stale, false) as stale`.

Why lateral: one row per doc with a boolean computed in the same round-trip. No N+1,
no separate stale-list fetch on the frontend, no client-side cross-reference.

### Normalization

`normalizeDocumentRow` exposes `stale: row.stale ?? false`. Documents fetched via paths
that DON'T include the join (e.g. `getDocument` by id) get `stale: false` from the
fallback. That's correct: the detail panel doesn't need the inline stale flag (it shows
the Links section, which is the richer signal).

### Contract lock

`tests/contract/libraryFormat.test.js`: `FROZEN_DOC_KEYS` gains `stale`. Locks the
shape against accidental removal.

## Architecture

**Backend (small):**
- `server/libraryRepository.js` — extend `buildListDocuments` query with the lateral
  join. Update `normalizeDocumentRow` with the `stale` field.
- `tests/contract/libraryFormat.test.js` — `FROZEN_DOC_KEYS` gains `stale`.
- New unit tests for the lateral-join SQL and the normalizer field.

**Frontend (the bulk):**
- The exact file split depends on the existing component structure in `public/js/`;
  the plan will identify the right files at planning time after a brief recon. The
  responsibilities to be placed:
  - Library list row: render the `SYNTH` and `STALE` chips conditionally.
  - Document detail panel: render `kind` badge in the title row, `updated_by` in the
    metadata block, Links section below the body.
  - New Maintenance panel module: fetch + render stale and orphan tables, project
    filter, refresh.
  - Admin navigation: register the new Maintenance section.
- `public/css/library.css` (or the existing CSS files) — new chip styles, Links
  section spacing, Maintenance panel layout.

**Demo server:**
- `scripts/demo-server.js` — `createMemoryLibraryRepository.listDocuments` computes
  `stale` per row by cross-referencing the in-memory link store. Mirrors the production
  SQL semantics so the demo UI shows the same chips.

**No new HTTP endpoints, no new MCP tools, no new migration, no new repository methods.**

## Styling

The existing palette system (Console / Graphite / Daylight / Midnight) already provides
accent tokens. The new chips use:

- **`SOURCE` pill (detail panel only):** low-emphasis token (matches existing muted
  metadata text color).
- **`SYNTHESIZED` pill (detail panel) and `SYNTH` chip (list):** primary accent token.
- **`STALE` pill (list and Maintenance panel):** warning accent token (warm —
  amber/yellow family). The existing palettes (Console / Graphite / Daylight /
  Midnight) define an overdue/due-soon color used by the board's date flags; reuse
  that token (or its closest variant per palette) rather than introducing a new
  semantic color. The board's overdue indicator and the doc-stale pill carry the same
  "needs attention" signal in different domains, so sharing the token is consistent.

Chip sizing: small, single-line, fits inline with the title text. Reuses any existing
tag-pill component if one is available; otherwise a tiny dedicated class.

## Data flow

### List view

1. Library list view fetches `GET /api/library/documents` (existing).
2. Each row of the response now includes `stale: boolean` and the already-existing
   `kind`.
3. The row renderer conditionally appends `SYNTH` chip + `STALE` pill.

No extra network calls.

### Detail panel

1. Click a doc → opens the detail drawer (existing flow).
2. The drawer fetches `GET /api/library/documents/:id` (existing).
3. The drawer ALSO fetches `GET /api/library/documents/:id/links?direction=both`
   (existing endpoint, new caller).
4. Both responses render: kind badge, metadata, body, Links section.

The two requests run in parallel; the Links section shows a small inline spinner until
the second request settles, then renders.

### Maintenance panel

1. User opens Admin → Maintenance.
2. Panel fetches both `/api/library/maintenance/stale` and `/api/library/maintenance/orphans`
   in parallel, with the current project filter.
3. Two tables render. Refresh button re-issues both calls.

## Testing strategy

### Backend

- **Repository unit test** (`tests/backend/libraryRepository.stale.test.js`):
  - `buildListDocuments` SQL contains the lateral join (regex match on text).
  - `normalizeDocumentRow` returns `stale: false` when row has no stale column.
  - `normalizeDocumentRow` returns `stale: true` when row has `stale: true`.
- **Contract test**: `FROZEN_DOC_KEYS` gains `stale`.
- **Integration test against stubbed repos** (extends existing route tests if cleanly
  possible): `GET /api/library/documents` response shape includes `stale`.

### Frontend

The exact test file names and module structure are deferred to the plan, but the
behaviors covered:

- Library list: a synthesized row renders the `SYNTH` chip; a stale row renders the
  `STALE` pill; a source non-stale row renders neither.
- Document detail: `kind` badge present and correctly styled; `updated_by` line
  present; Links section renders outbound + inbound groupings; empty state when no
  links.
- Maintenance panel: empty states render; populated state shows the right rows;
  project filter is forwarded to both API calls; refresh re-fetches.

### E2E smoke against real Postgres

After merge, re-seed the demo content used earlier:
- Source doc + synthesized doc with `derived-from`.
- Edit the source body to trigger stale.
- An orphan doc.

Then:
- Library list: confirm `STALE` and `SYNTH` chips render on the right rows.
- Detail panel: confirm Links + kind badge + `updated_by` render.
- Maintenance panel: confirm stale and orphan tables populate, project filter works,
  refresh works.

## Release

Single PR. Cuts as **v0.12.0** (minor: additive contract field `stale`, additive UI
surface, no breaking changes).

## Future work (out of scope for v0.12)

- **`references` relation**: peer cross-references that don't carry derivation
  semantics. A separate sub-project; small backend extension + this UI gains a new
  link group.
- **pgvector / semantic search**: the bigger RAG retrieval upgrade. Targeting v0.13.
- **Link editing in the UI**: add/remove links from the detail panel. Worth doing
  once we have signals from real usage that humans want to curate links by hand.
- **Graph visualization**: force-directed or hierarchical view. Defer until we have
  a question that only graph viz answers.
- **Maintenance actions**: "mark reviewed," "trigger refresh of derived docs," etc.
  Held until we see how the read-only Maintenance panel gets used.

## Open questions

None.
