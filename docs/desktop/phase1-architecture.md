# Phase 1 — Prax frontend architecture

How the Prax design (`Prax.dc.html` + `design-handoff.md`) becomes the real frontend in
`public/`, against the **unchanged** HTTP API. Written before implementation; updated as
decisions land.

## Ground rules (from docs/desktop/checklist.md)

- Static bundle served by Fastify; no API shape changes; `tests/contract/` stays green.
- Existing behavioral intent stays covered: frontend tests are ported to the new DOM,
  never silently dropped.
- Keyboard shortcuts preserved and extended to the design set (⌘K palette, N capture,
  ⌘J theme, Esc cascade, ↑↓/↵/E list navigation, ⌘B/I/E in editor).
- Fonts bundled locally (`public/vendor/fonts/`) — the desktop app must not need network.

## Design → API translation seam

All view modules speak the **design vocabulary**; one tiny module translates at the API
boundary (`public/js/statusMap.js`):

| Design concept | API reality |
|---|---|
| status `priority` | status `high-priority` |
| status `inprogress` | status `in-progress` |
| status `planned` | status `planned` |
| status `completed` | status `completed` |
| status `backlog` | status `notes` — today it is only a fifth board "parking lane" column with no other semantics, exactly what the design's Backlog is. Pure relabel; existing NOTES-column tasks become Backlog tasks. The old *derived* backlog (planned + no due date) is retired — those tasks now appear only under Planned. Board renders 4 columns; `notes`/backlog tasks are excluded from the board (fixes today's double-showing of backlog tasks in Planned). |
| status `archived` | `archivedAt` flag + archive/restore/delete endpoints |
| priority `high/med/low` | priority `high/medium/low` |
| `due` | `dueDate` |

Due-flag buckets (single source of truth, ported from the prototype `fmtDue`):
overdue (< today), today, soon (≤ 3 days), later; completed → muted.

## Module plan

### Kept as-is (logic + tests untouched)
- `taskApi.js`, `libraryApi.js`, `projectApi.js` — HTTP clients
- `importExport.js`, `libraryExport.js` — contract-locked serialization
- `taskModel.js`, `taskFilters.js`, `libraryFilters.js`, `librarySavedViews.js` — pure logic
- `public/vendor/codemirror-editor.js` (+ fonts)

### Reworked (same job, new design)
- `state.js` — extend: navType (today/project/all/library/editor/settings), tab,
  groupBy cycler, drawerId, palette/capture state, selection (selIds/listSelId),
  editor (docId/mode/focus/outline), library (q/semantic/tags/sort), toasts.
  Existing localStorage keys keep working; new state gets new keys.
- `preferences.js` — theme (light "Porcelain"/dark "Deep Fern"), accent (Fern/Indigo/
  Clay/Moss), reading font-scale (0.85–1.25 editor-only), window-chrome (mac/win).
  Replaces the four old palettes; `data-theme` + `--accent` override, per prototype.
- `keyboardShortcuts.js` — the design's full table with the Esc close-cascade.
- `markdownPreview.js` — design typography + clickable task-list items that rewrite
  `- [ ]`/`- [x]` in the source.
- `breakpoints.js` — sidebar→icon-rail at < 940px window width.

### Rewritten to the design (new DOM, ported test intent)
- `index.html`, `styles.css` — full token system (colors light+dark, oklch accents,
  type scale, radii, shadows, motion keyframes mmFade/mmSlide/mmPop/mmToast).
- `renderShell.js` — titlebar (traffic lights / Win controls per setting, breadcrumb,
  search pill, New task, theme toggle), sidebar (nav + Today badge, projects with
  color dots, saved views, settings), icon rail, statusbar.
- `renderList.js` — grouped rows (due/priority/status grouping), selection tints,
  multi-select bulk bar, empty states.
- `renderBoard.js` — 4 columns (Priority/In progress/Planned/Completed), drag with
  drop-position indicator, within-column reorder, project chips.
- `renderBacklog.js`, `renderArchive.js` — promote/restore rows.
- `renderToday.js` — NEW cross-project Overdue/Today/Due soon.
- `renderAllProjects.js` — state-grouped project cards with progress bars +
  state-change actions (replaces project manager/archive dialogs).
- `renderTaskDetail.js` — drawer: status/priority pills, due, serif notes, checklist
  with progress, linked docs, activity timeline, archive+undo.
- `renderLibrary.js` — card grid grouped Runbooks/Notes, tag chips, saved views,
  semantic mode (score blocks + "why it matched"), import/export, trust/maintenance
  preserved from current UI in design-consistent form.
- `renderEditor.js` — page-sheet layout, segmented modes, toolbar, outline rail,
  backlinks footer, focus mode, status footer.
- `renderSettings.js` — Appearance / Intelligence / Data & admin cards (absorbs the
  old admin panel; JSON import/export + backup + semantic index UI keep their flows).
- NEW `renderPalette.js` (⌘K), `renderCapture.js` (N), `renderToast.js` (undo toasts),
  `icons.js` (15×15 stroke set + logo).
- `main.js` — orchestration.

## Decisions from the behavior maps

- **No jsdom anywhere**: render modules are pure `state → HTML string` functions tested
  with regex assertions (node:test); events bind in main.js via `data-action` attributes.
  The new modules keep this exact pattern.
- **Board persistence stays `moveTaskOnBoard`** (`boardWorkflow.js`, REUSE): the
  prototype's drop semantics (beforeId / append) map directly onto its
  `{taskId, targetStatus, beforeTaskId}` input and single `PATCH /api/tasks/reorder`.
- **Board extras** cache + per-task invalidation on all six mutation paths (notes save,
  checklist add/toggle/delete, doc link/unlink, board drop) is preserved.
- **Drawer gains a status editor** (design status pills → existing `PATCH /api/tasks/:id`);
  drawer notes move from manual save to debounced autosave (same endpoint).
- **Undo** (complete / archive / bulk) = frontend inverse calls (PATCH status back,
  `PATCH /:id/restore`), 5s toast window, matching the prototype.
- **Semantic results show rank + snippet, not scores** — the API returns no similarity
  score, and we don't fabricate one. "Why it matched" = server snippet.
- **Settings ▸ Intelligence** renders the real backend status (backend name, connected,
  embedded counts, enable toggle, reindex/rebuild) in the design's card language;
  provider cards/API-key inputs from the comp are shown only as read-only backend
  status until the backend supports switching (Phase 2+).
- **Trust & maintenance features survive the redesign**: SYNTH/STALE/VERIFIED/SUPERSEDED
  chips on doc cards/rows, verify + supersede actions, and stale-document maintenance
  (moved from the old admin modal into Settings ▸ Data & admin). The six e2e journeys keep
  their flows with updated selectors.
- **Markdown task-items become clickable** in preview (design: toggling rewrites
  `- [ ]`/`- [x]` in the source) — an intentional, documented change to the previously
  read-only checkbox rendering.
- **CodeMirror stays** as the edit pane (`mountCodeMirrorEditor`), restyled to the
  design tokens; the hand-rolled `markdownPreview.js` engine (tables, fences, escaping)
  stays as the preview renderer.
- **Preferences migrate**: `prax.preferences` now stores
  `{theme, accent, chromeOS, readingScale}`; legacy palettes map console/graphite/
  midnight → dark, daylight → light on load. Applied as `data-theme` on body +
  `--accent`/`--reading-scale` custom-property overrides.
- **No URL routing** today; parity kept (in-memory navigation state).

## Design deltas that stay honest to the API

- **Today / backlinks / palette search** are pure frontend compositions of existing
  endpoints — no new API.
- **Board extras** (checklist counts, doc counts, latest activity) come from the
  existing `listTaskBoardExtras` endpoint.
- **Semantic settings** in the design (provider cards, API key, reindex) map to the
  existing settings/admin endpoints; anything the backend doesn't support yet renders
  in its unavailable state (no fake affordances).
- **Undo** is frontend-local (inverse API call), matching prototype semantics.

## Test strategy

- REUSE-class tests must pass unchanged throughout.
- REWRITE-class tests are ported per-module as each view lands (same behavioral
  assertions, new selectors); e2e specs updated last, run in CI (this dev VM can't
  run Playwright browsers — ubuntu-arm64 unsupported).

## Exit gate (Phase 1)

`npm test` green (unit + contract), e2e green in CI, redesigned UI verified against
`npm run demo` in a real browser, no API/format changes.
