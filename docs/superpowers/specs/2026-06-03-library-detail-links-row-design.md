# Library detail Links row visibility fix design

**Status:** Approved
**Date:** 2026-06-03
**Target release:** v0.12.1 (patch)

## Goal

Make the Links section in the library document detail panel visible in every
view mode. After v0.12.0 shipped, the Links section only renders in info-edit
mode by accident of layout; in preview / edit / split / focus modes, the
section is clipped below the visible aside.

## Root cause

`public/styles.css` defines `.library-detail` as a 2-row CSS grid:

```css
.library-detail {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  max-height: none;
  overflow: hidden;
  border-left: 0;
}
```

The renderer (`renderDocumentDetail` in `public/js/renderLibrary.js`) appends
the Links section as the third child of the `<aside>`:

```
<aside class="detail-panel library-detail">
  <header class="detail-header">…</header>           <- row 1 (auto)
  <div class="document-workspace …">…</div>          <- row 2 (1fr)
  <section class="document-links">…</section>        <- implicit row 3
</aside>
```

CSS Grid creates an implicit third row (`grid-auto-rows: auto`), but
`overflow: hidden` on the aside plus the workspace's greedy `1fr` height push
the Links row outside the visible 100%-height aside. It is clipped.

In info-edit mode (`<form class="document-info-form">` instead of the
workspace div), the form does not aggressively claim 1fr fill behavior the
same way and the layout coincidentally leaves Links visible.

## Decisions locked in

- **Single-line CSS fix.** Add an explicit third row of `auto` height to
  `grid-template-rows`. No JS changes, no structural changes to the renderer,
  no other CSS cleanups.
- **Links remains a sibling of the workspace.** Not nested inside the
  workspace, not pinned via absolute positioning. Sibling at the same grid
  level keeps the renderer's DOM structure unchanged.
- **`auto` for the Links row.** Claims only the height the content needs;
  collapses to 0 when there are no links. The `1fr` workspace row absorbs the
  loss via its own internal scrolling (CodeMirror, preview overflow).

## Non-goals

- **No structural change to `renderDocumentDetail`.** The renderer is
  unchanged.
- **No JS changes.**
- **No browser-based layout testing infrastructure.** The existing
  string-HTML test pattern can't catch CSS layout bugs; building that
  infrastructure is way out of scope for a one-line bug fix.
- **No accommodation for very tall Links sections.** If a doc ever has 50+
  outbound links the workspace would shrink toward 0. In practice doc graphs
  have a handful of edges per node; a static `auto` row is the right default.
  If this becomes a problem later, swap to `minmax(0, 200px)` with
  `overflow-y: auto` on `.document-links` — out of scope for v0.12.1.
- **No other CSS cleanups.** Discipline a follow-up cycle for any other
  layout polish.

## The fix

`public/styles.css`, the `.library-detail` rule:

```css
.library-detail {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;   /* was: auto minmax(0, 1fr) */
  height: 100%;
  max-height: none;
  overflow: hidden;
  border-left: 0;
}
```

That is the entire code change.

## What this guarantees

- Links section is visible in every detail mode (preview, edit, split,
  info-edit, focus).
- Workspace row shrinks to accommodate the Links row's required height.
  Workspace internal scroll continues to absorb body overflow.
- An empty Links section (e.g., `documentLinks === null` before the fetch
  settles, or `[]` for an unlinked doc) collapses the third row to 0; no
  visual gap.

## Testing

No new automated tests.

Verification path:

1. Rebuild the running stack from source (`docker compose up -d --build`) or
   run the demo server.
2. Open a doc with at least one inbound or outbound link.
3. Cycle through every detail mode: preview, edit, split, info-edit, focus.
   Confirm the Links section is visible at the bottom of the aside in each
   mode.
4. Open a doc with no links — confirm there's no visual artifact at the
   bottom (the section collapses cleanly).

A future v0.13 could revisit and introduce browser-based layout regression
testing; that's a separate conversation.

## Release

Patch — **v0.12.1**. Single PR. CSS-only diff.

## Open questions

None.
