# Navigation & Projects Layout — Design Spec

**Date:** 2026-05-21
**Status:** Approved for implementation

## Goal

Reorganise the app chrome so the two navigation axes — **which view** (Today / Board /
Backlog / Archive / Library) and **which project** — stop competing as two equal stacked
lists in the sidebar. Views move to a topbar tab strip; the sidebar becomes a focused,
active-only projects list; and project lifecycle (status, archive, delete) lives in the
Manage modal plus a dedicated Archive dialog.

This is a **frontend + styling** slice. It builds on the completed Projects feature
(projects API, statuses active/on-hold/completed/archived, restore + permanent-delete
endpoints) — **no backend, API, or MCP changes**.

## Background (current state)

The sidebar (`renderShell.js`) currently stacks two `side-nav` blocks of equal weight:
**Views** (5 buttons) and **Projects** (All projects + each active project + `[+] new
project` + `manage`), above the cluster-status card. As projects accumulate the sidebar
becomes one long undifferentiated scroll and the view×project relationship is unclear. The
Manage modal (`renderProjectManager.js`) lists *all* projects (every status) as a flat
editable list.

## Approach (chosen)

"Views as topbar tabs + projects-only sidebar (active-only) + Manage owns live lifecycle +
a separate Archive dialog." Chosen over a project-switcher header and over keeping two
sidebar lists, because it spatially separates the two axes (views horizontal, projects
vertical), keeps the sidebar short at any project count, and matches the app's existing
"Archive is a separate space" pattern.

## Design

### 1. Topbar view tabs

The five views move out of the sidebar into a horizontal tab strip in the global topbar,
rendered in the existing `nav-button` style, placed between the brand/hamburger and the
search field. Selecting a tab switches `activeView` (existing `data-view` handler). The
content header (heading + description) and the status-footer `<MODE>` tag are unchanged.

- The sidebar's `Views` `side-nav` block is **removed**.
- Responsive: on narrow widths the tab strip wraps; the existing **bottom nav** continues
  to provide Today / Board / Library / Archive on mobile, so the topbar tabs are primarily
  a desktop affordance. Backlog remains reachable on mobile via the hamburger drawer.

### 2. Sidebar — projects only, active-only

The remaining sidebar `side-nav` becomes the Projects nav:

- A `Projects` label.
- A prominent **`[+] new project`** action button.
- An **All projects** item (active when `activeProject === 'all'`).
- The list of **active** projects only (each `data-project="<id>"`; the selected one gets
  the active highlight). No status dots and no Archived group here.
- A **`manage`** action (opens the Manage modal).
- The cluster-status card stays at the bottom.

`state.projects` already holds only active projects (loaded via `fetchProjects('active')`),
so the sidebar list needs no filtering change. The status-footer breadcrumb continues to
show the active project's name.

### 3. Manage modal — live projects + archive entry

`renderProjectManager.js` changes from a flat list to **live projects grouped by status**:

- A create row (unchanged): name input + `[+] add`.
- Groups **Active / On-hold / Completed**, each with a count, rendered only when non-empty.
  Each row keeps the existing controls: inline rename, status `▾` (limited to the three
  live states — see Archive below for moving in/out of archived), reorder `↑ ↓` (within the
  Active group), and delete (disabled/greyed when the project owns tasks or documents).
- Archived projects are **excluded** from this list.
- A footer button **`🗄 archived projects · N`** (N = archived count) opens the Archive
  dialog. When N is 0 the button still appears (disabled or showing "· 0").
- Setting a row's status to a non-live state is handled by archiving: the row's status
  control offers active/on-hold/completed; a separate **archive** affordance per row (e.g.
  an `[archive]` action) moves it to archived (calls the existing archive endpoint). This
  keeps "archived" out of the inline status dropdown so it can't be picked by accident.

The manager loads **all** projects (`fetchProjects('all')`) as today, then partitions them:
live (active/on-hold/completed) render in the groups; archived feed the count + the Archive
dialog.

### 4. Archive dialog — separate recovery space

A new render module (e.g. `renderProjectArchive.js`) produces a dialog reusing the modal
chrome:

- Header "Archived projects" with a **back** affordance (returns to Manage) and close.
- One row per archived project: name, **↩ restore** (sets status back to `active`), and
  **delete** (permanent; enabled only when the project owns no tasks/documents, surfacing
  the existing 409 as a friendly message).
- Empty state when there are no archived projects.

Opened from Manage's `🗄 archived projects` button. Implemented as its own dialog gated by
`state.isProjectArchiveOpen`: opening it sets `isProjectArchiveOpen = true` while Manage
stays open underneath (the archive renders on top / in place of the manager body); back and
close set it `false`, returning to Manage. Only one extra state flag, no manager rewrite.

### 5. State & wiring

- New state flag for the archive dialog (e.g. `isProjectArchiveOpen`); `managedProjects`
  (already loaded for Manage) is reused to derive both the live groups and the archived
  list, so no extra fetch is needed when toggling between Manage and Archive.
- Restore = `updateProject(id, { status: 'active' })`; archive = `archiveProject(id)`;
  permanent delete = `deleteProjectPermanent(id)` — all already in `projectApi.js`.
- After any change (create/rename/status/reorder/archive/restore/delete), refresh the
  managed list and the active sidebar list (existing `refreshProjectManager` pattern), and
  reset `activeProject` to `'all'` if the selected project is no longer active.

## Components / files

- `public/js/renderShell.js` — move view buttons to the topbar; slim the sidebar to the
  projects-only block; update the drawer if needed (keep Backlog + projects there).
- `public/js/renderProjectManager.js` — group live projects by status; exclude archived;
  add the `🗄 archived projects · N` button; per-row archive affordance.
- `public/js/renderProjectArchive.js` *(new)* — the Archive dialog.
- `public/js/main.js` — render the Archive dialog when open; wire open/back/close, restore,
  and permanent-delete; partition `managedProjects` into live vs archived.
- `public/js/state.js` — `isProjectArchiveOpen` flag.
- `public/styles.css` — topbar tab strip styles; any Manage group / archive dialog styles.

## Testing

- **renderShell:** topbar contains the five `data-view` tabs; the sidebar no longer renders
  a separate Views block; sidebar shows All + active projects + new + manage; project names
  escaped.
- **renderProjectManager:** live projects render under Active/On-hold/Completed groups;
  archived projects are NOT in the main list; the `archived projects · N` button shows the
  correct count; per-row archive affordance present.
- **renderProjectArchive:** renders a row per archived project with restore + delete;
  delete reflects the empty/non-empty state; empty-state hint; names escaped.
- **main.js wiring:** verified by `npm run check` + the suite staying green + a manual demo
  smoke (open Manage → archive a project → it leaves the sidebar and Manage groups, appears
  in Archive → restore → returns to active/sidebar; delete an empty archived project).

## Rollout

A frontend slice on the existing `feat/projects-model` branch (before that branch is
finished/merged), implemented in tasks: (1) topbar tabs + slim sidebar in `renderShell` +
tests; (2) Manage grouping + archive button + per-row archive + tests; (3) Archive dialog
module + tests; (4) `main.js`/`state.js` wiring; (5) styles; (6) verify + demo smoke.
Stage per task; commit when green.

## Out of scope

Backend/API/MCP (already support projects + statuses + restore/permanent-delete); the
project-switcher-header direction (rejected); status dots / inline Archived in the sidebar
(rejected in favour of active-only).
