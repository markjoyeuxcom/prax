# Year-One Shell Design

**Date:** 2026-09-19
**Status:** Approved (brainstorm); item 1 implemented in this change, items 2–3 pending
**Builds on:** v0.32.1
**Scope:** The three lowest-cost structural fixes from the year-one UI audit. The full audit
and the alternative mocks live on the design canvas
[Prax UI Alternatives](https://claude.ai/artifact/DEPREJFVT1bmBLj4Edvjw7) (private; the audit
summary is also a `reference` memory in Prax: "Prax UI audit at year-one scale").

## Goal

Prax was sized for its first month. The audit populated the shell with a plausible year of
heavy use — 34 projects in four areas, ~1,300 open tasks, 612 documents, 143 unverified
agent-written memories — and found the places where the layout stops working. This spec picks
the three fixes that change structure without changing the visual language (Porcelain / Deep
Fern tokens, Instrument Sans, rail + panel + main frame all stay).

## Findings this spec addresses

1. **The project title truncates.** On-call, handoff, repo and area share the header row with
   the title and render even when empty (placeholders included), so "Homelab" reads "Homel…" at
   1360 px. Longer names lose most of their characters.
2. **List groups never fold.** Later, No date and (on the board) Completed render open, so the
   three rows that need action today share the page with forty that do not. Done work has no
   time bucket in the list.
3. **The Library stacks three rows of facets above the first document** while the context panel
   beside it repeats the type facets and shows five recent documents. The header carries eight
   actions.

Findings the audit raised but this spec leaves for later: a real breadcrumb in the titlebar,
Recent + folded On-hold in the browser panel, the shortcut-hint statusbar, the Library table
mode and review queue, and ⌘K scopes.

## 1. Project header: Ops disclosure — implemented

### Decisions

- The header row keeps only the dot, the title, the status chip, the rename pencil and an
  **Ops** toggle on the right. The title gets the row; nothing else pushes on it.
- The four fields move to their **own row** beneath the header. A field with a value renders
  as the same inline input as before (same `data-project-*` attributes, aria labels and
  placeholders, so the debounced PATCH handler is untouched). A field **without** a value
  renders as a small `＋ Field` button; clicking it reveals the input and focuses it.
- The Ops toggle is a `toggle-section` action with key `ops:<projectId>`, the same
  localStorage collapsed-sections regime the panel areas use. Default is expanded. The toggle
  shows a count of set fields so a collapsed row still tells the truth.
- A field the user is typing into is pinned visible for the session (`revealedOpsFields`),
  so clearing a value and a background re-render cannot remove the input under the caret.
- Inbox keeps no ops row, as before.

### Non-goals

- No change to the project API, the ops PATCH contract, or the prax CLI repo detection.
- No handoff/on-call editor beyond the inline inputs.

### Files

- `public/js/renderProjectOps.js` (new, pure): `OPS_FIELDS`, `opsSectionKey`, `revealKey`,
  `setOpsFields`, `renderOpsToggleHtml`, `renderProjectOpsHtml`.
- `public/js/main.js`: header uses the module; `reveal-ops-field` action; ops input handler
  pins the field visible; `revealedOpsFields` in `state.js`.
- `public/prax.css`: `.page-head__title` gets `min-width: 0` and `flex: 1 1 auto`; `.proj-ops`
  becomes a wrapping full-width row; new `.proj-ops__add`, `.page-head__ops-toggle`.

### Testing

- `tests/frontend/renderProjectOps.test.js`: set fields render inputs, unset fields render add
  buttons, revealed fields render inputs, collapsed renders nothing, the toggle carries the
  section key / `aria-expanded` / count, values are escaped.
- `tests/frontend/praxStyles.test.js`: the title can shrink (`min-width: 0`) and the ops row
  wraps on its own line.
- Manual: a project named "Homelab infrastructure and networking" at 1100 px keeps its full
  name; a new project shows four `＋` buttons and no placeholders; collapse persists across
  reload; typing into On call then deleting it keeps the input until you navigate away.

## 2. Collapsible list groups with a "Done this week" bucket — pending

- Every list group header becomes a `toggle-section` button (key `list:<projectId>:<group>`),
  reusing `collapsedSections`. Collapsed groups render the label and count only. The Today view
  already does this for the week-ahead section; the project list should match.
- `buildListGroups` gains a trailing **Done this week** group (completed in the last 7 days,
  not archived), collapsed by default, with an **Archive all** action on its header that calls
  the existing bulk archive.
- Keyboard: `flatIds` must exclude rows in collapsed groups (the Today view's precedent).
- Tests: `renderList.test.js` for the header markup and the collapsed render; `taskModel` or
  the list-group builder for the done-this-week bucket boundary (7 × 24 h from `now`).

## 3. Library facets move into the context panel — pending

- The Library panel already lists types with counts. Extend it with **Project** and **Trust**
  sections (same `toggle-lib-project` / `toggle-lib-trust` actions the facet pills dispatch) and
  a tag section: a "Find a tag…" filter box plus the top tags by use, with a "N more" row.
- The main view drops the three facet rows and keeps the search box, the active-filter chips
  with an × each, and the sort / group controls.
- The header collapses to **Ask Prax**, **New ▾** (runbook / note / decision / …) and an
  overflow menu holding Import, Export, Health, Weekly review and Archive. Every action keeps its
  `data-action`, so the command palette entries are unchanged.
- Tests: `renderShell.test.js` (panel sections and counts) and `renderLibrary.test.js` (facet
  rows gone, chips present, overflow menu items present).
