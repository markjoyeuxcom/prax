# Phase 1 — module & action contract

Shared contract for the Prax render modules. Every module is a pure
`render*(state[, helpers]) → HTML string`; **no DOM access, no imports of main.js**.
Events are delegated in main.js purely via `data-action` (+ payload `data-*`)
attributes. Escape all interpolated user content with the shared `escapeHtml`
(from `renderHelpers.js`). Class names come from `public/prax.css`.

## Module exports

| File | Exports |
|---|---|
| renderShell.js | `renderTitlebarHtml(state)`, `renderSidebarHtml(state, counts)`, `renderRailHtml(state)`, `renderStatusbarHtml(state)` |
| renderList.js | `renderListHtml(state, groups)`, `renderBulkBarHtml(state)`, `buildListGroups(state, tasks, {now})` |
| renderToday.js | `renderTodayHtml(state, groups, {now})`, `buildTodayGroups(tasks, projects, {now})` |
| renderBoard.js | `renderBoardHtml(state, columns)`, `buildBoardColumns(state, tasks)` |
| renderBacklog.js | `renderBacklogHtml(state, tasks)`, `renderArchiveHtml(state, tasks)` |
| renderTaskDetail.js | `renderTaskDrawerHtml(state, task, context)` (context: projects, docs, checklist, activity) |
| renderLibrary.js | `renderLibraryHtml(state, model)`, `buildLibraryModel(state, {now})` |
| renderEditor.js | `renderEditorHtml(state, doc, model)`, `buildOutline(text)`, `buildBacklinks(tasks, projects, docId)` |
| renderAllProjects.js | `renderAllProjectsHtml(state, groups)`, `buildProjectGroups(projects, tasks)` |
| renderPalette.js | `renderPaletteHtml(state, groups)`, `buildPaletteGroups(state, {tasks, documents, projects})` |
| renderCapture.js | `renderCaptureHtml(state, project)` |
| renderToast.js | `renderToastHtml(state)` |
| renderSettings.js | `renderSettingsHtml(state, model)` |
| renderLinkPicker.js | `renderLinkPickerHtml(state)` (kept, restyled) |
| renderHelpers.js | `escapeHtml(value)`, `chip(label, variant)`, `prioDotClass(designPriority)` |

Tasks passed to view modules keep **API field names** (`status: 'high-priority'`,
`priority: 'medium'`, `dueDate`, `archivedAt`) — modules translate for display via
statusMap.js/dueFlags.js. Payloads sent back through actions use API vocabulary too;
only labels are design-vocabulary.

## data-action table

Navigation / chrome:
- `nav-today`, `nav-all`, `nav-library`, `nav-settings` — sidebar/rail
- `nav-project` + `data-project-id`
- `set-tab` + `data-tab` (`list|board|backlog|archive`)
- `cycle-group` — list grouping cycler (due → priority → status)
- `open-palette`, `open-capture`, `toggle-theme`
- `select-saved-view` + `data-view-index`; `manage-projects` (sidebar ＋ → All projects)

Tasks:
- `open-task` + `data-task-id` (row/card click; ⇧/⌘-click multi-selects)
- `toggle-task-done` + `data-task-id` (checkbox; stopPropagation)
- `promote-task` / `restore-task` + `data-task-id` (backlog promote / archive restore)
- `bulk-complete`, `bulk-backlog`, `bulk-archive`, `clear-selection`
- Board DnD is bound directly (dragstart/over/drop) on `[data-board-card]` /
  `[data-board-column]` + `data-task-id`/`data-column`; drop indicator rendered
  from `state.dragPos` as `.drop-ind`

Drawer:
- `close-drawer`
- `set-task-status` + `data-status` (API value), `set-task-priority` + `data-priority` (API value)
- `set-task-due` (input[type=date] change), `clear-task-due`
- notes: textarea `[data-task-notes]`, autosaved (input debounce in main.js)
- `toggle-checklist-item` + `data-item-id` + `data-completed`, `delete-checklist-item` + `data-item-id`,
  add via `[data-checklist-new]` + Enter or `add-checklist-item`
- `open-linked-doc` + `data-document-id`, `unlink-task-document` + `data-document-id`, `open-link-picker`
- `archive-task` (footer; fires undo toast)
- `edit-task` (opens task form for full edit)

Library:
- `open-doc` + `data-document-id` (→ editor)
- `toggle-semantic`, `cycle-lib-sort`, `toggle-lib-tag` + `data-tag`, `clear-lib-filters`
- `new-document`, `import-documents` (multi-file), `export-library`
- `save-library-view`, `delete-library-view` + `data-view-index`
- `toggle-library-view` (active ↔ archive)
- trust: `toggle-verify`, `supersede-document`, `archive-document`, `restore-document`,
  `delete-archived-document` (+ `data-document-id` where not the selected doc)

Editor:
- `back-to-library`, `set-editor-mode` + `data-mode`, `toggle-outline`, `toggle-focus`, `export-doc`
- title input `[data-doc-title]` (input → rename)
- toolbar: `md-format` + `data-md-action` (heading|bold|italic|bullet-list|numbered-list|checklist|quote|code|code-block|link)
- outline: `outline-jump` + `data-heading-index`
- preview task items: `toggle-md-check` + `data-line`
- backlinks: `open-task` + `data-task-id`
- `edit-document-info`, `cancel-document-info` (info form intact)

All projects:
- `open-project` + `data-project-id`
- `set-project-state` + `data-project-id` + `data-state` (`active|on-hold|completed|archived`)
- `create-project`, `delete-project` + `data-project-id` (empty projects only; confirm)

Palette / capture / toast:
- palette input `[data-palette-input]`; items `palette-run` + `data-palette-index`; `close-palette`
- capture input `[data-capture-input]` (Enter adds); `close-capture`
- `toast-undo`

Settings:
- `set-theme` + `data-theme`, `set-accent` + `data-accent`, `set-chrome` + `data-chrome`
- reading scale: `[data-reading-scale]` range input
- `toggle-semantic-search`, `reindex-embeddings`, `force-reindex-embeddings`
- `export-project-tasks`, `export-all-tasks`, `import-tasks` (+ mode radios `[name="import-mode"]`,
  replace confirm `[data-replace-confirm]`, file `[data-import-file]`)
- `export-library-project`, `export-library-all`
- maintenance: `refresh-maintenance`, `[data-maintenance-project-filter]` select,
  `open-library-doc` + `data-library-document-id` + `data-library-project-id`
- `reset-preferences`

## Test conventions

One test file per module in tests/frontend/, node:test + assert/strict, HTML-string
regex assertions (no jsdom). Port the behavioral intent listed for each old test file;
selection marking uses `is-selected` / `aria-current`, pressed state `aria-pressed`.
XSS: every module test includes at least one `<script>`-escaping assertion.
