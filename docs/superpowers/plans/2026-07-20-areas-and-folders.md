# Areas and Folders Implementation Plan

**Goal:** Turn scale into structure (layout option C): projects group under named **areas**
in the panel, smart views group under **folders**, each section collapsible with persisted
state — so 60 projects read as five areas, not one list.

**Source:** Sidebar-at-scale discussion (2026-07-20); the final layer after the rail+panel
shell, ⌘K jumps, and pinned favorites.
**Status:** Shipped

## Design decisions

1. **Area is project data, folder is view convention.** `projects.area` is a server column
   (migration `0022`, free text ≤ 60 chars, `''` clears) — it describes the project and
   travels with the database, edited inline in the All-projects ops row exactly like
   on-call/handoff/repo. Smart-view folders need NO schema: views are localStorage, and a
   view saved as `Folder/Name` lands in that folder (the only creation surface is one text
   input; the slash convention is documented in its placeholder). Existing labels with
   slashes are untouched — parsing happens only at creation. Library saved views stay in
   their own section, unfoldered (they are few and tag-shaped).
2. **Grouping degrades to exactly today's panel.** No areas anywhere → the flat Projects
   list, unchanged. With areas: Pinned first (pins outrank grouping), then areas
   alphabetically, then unassigned projects under "Other". Views tab mirrors it with
   folders. Section headers carry counts.
3. **Collapse is per-device view state** (`prax.collapsedSections.v1`, same localStorage
   regime as pins), toggled by clicking the section header. A typed panel filter
   **auto-expands everything** — hiding matches inside a collapsed section would make the
   filter a liar.
4. **The palette says the area.** ⌘K project results read "Project · Work" (and
   "· on hold" when relevant) — the area doubles as a disambiguator for same-ish names.

## Work

- [x] Migration `0022_add_project_area.sql`; repository map + normalizer; PATCH accepts
      `area` (string, trimmed, ≤ 60 or 400, `''` → null); pin cascade updated (22).
- [x] All-projects ops row gains the Area input (debounced-save pattern, no focus steal).
- [x] `createSmartView` parses `Folder/Name`; sanitize preserves `folder`; save-dialog
      placeholder documents the convention.
- [x] `collapsed.js` (load/save/toggle, normalized + capped) + `state.collapsedSections`
      + `toggle-section` handler.
- [x] Panel grouping both tabs + collapse chevrons + filter auto-expand; palette area sub.
- [x] Tests: backend area route suite; frontend folder-parse + grouping/collapse/
      auto-expand + palette sub; e2e journey (set area inline → panel groups → collapse
      survives reload → foldered view lands in its folder).
- [x] CHANGELOG entry.

## Verification (as shipped)

Recorded in the commit: full unit + e2e gates green, migration pins updated deliberately.
Areas ride every existing surface for free (project payloads, MCP `list_projects`, weekly
review project names) — no new tools, no contract changes (project shape is not a pinned
export format).

## Risks / notes

- Area is free text by design (no area registry to manage); the inline input plus palette
  sub make typos visible where they'd be made. A future datalist can suggest existing
  areas without changing the model.
- Collapse state references areas/folders by name; renaming an area simply starts that
  section expanded — stale keys are inert and capped, never an error.
