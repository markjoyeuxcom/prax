# UI Redesign — "Operator Evolved" Design Spec

**Date:** 2026-05-19
**Status:** Draft for review
**Direction:** Operator Evolved (k9s/htop/btop lineage, evolved for desktop + mobile)

## Overview

Redesign the Moomora Console frontend so it has a distinctive identity that matches its purpose — a homelab operations console — while remaining usable on phone and tablet without compression artifacts. The current UI is competent but generic (slate-dark dashboard, Inter sans-serif, table-based list, rounded chrome). The redesign commits to a single operator aesthetic inspired by terminal admin tools (k9s, htop, btop) and adapts that aesthetic to touch-first surfaces without diluting the personality.

This spec covers the visual language, layout architecture, component patterns, view-by-view treatment, and a three-phase rollout plan. It does not change any API, schema, server route, or test pertaining to backend logic.

## Goals

- Replace the generic dark-dashboard look with a committed operator aesthetic.
- Make the design work equally well at desktop (≥1024px), tablet (768–1023px), and mobile (<768px).
- Preserve every existing feature: tasks (Today/Board/Backlog/Archive), Library with markdown editor/preview/split, tag filtering and smart views, Admin import/export, archive/restore, drag/drop board reorder.
- Keep the backend API contract unchanged.
- Keep all existing user data accessible without migration.

## Non-Goals

- No new features. No new API endpoints. No schema changes.
- No framework adoption (Vue/React/Svelte). Stays vanilla ES modules.
- No icon library or SVG sprite. Visual marks come from Unicode glyphs.
- No new third-party JS dependencies beyond two web fonts (JetBrains Mono, Source Serif).
- No authentication or auth-related UI changes.

## Visual Language

### Palette (14 tokens)

| Token | Hex | Role |
|---|---|---|
| `bg` | `#0d0e0f` | Main canvas |
| `bg-deep` | `#08090a` | Sidebar, status footer |
| `surface` | `#11140f` | Cards (slightly warmer than bg) |
| `surface-warm` | `#14140f` | Markdown preview pane only |
| `border` | `#1f2021` | Solid 1px boundaries |
| `border-dim` | `#2a2b2c` | Dotted 1px sub-section dividers, input borders |
| `text` | `#e7f2d8` | Titles (very slight green tint) |
| `text-body` | `#c8c8c8` | Body copy |
| `text-dim` | `#7a7d80` | Metadata, secondary info |
| `text-dimmer` | `#5a5d60` | Labels, footer text |
| `accent` | `#87d75f` | Phosphor — active state, mode tag, ok/success |
| `accent-amber` | `#d7af5f` | Numbers, counts, dirty marker, value emphasis |
| `accent-cyan` | `#87afff` | Sub-nav, contexts, inline tags |
| `danger` | `#ff5f5f` | High priority, errors, destructive actions |

Color carries meaning. Phosphor is reserved for active/ok. Amber is for emphasized values. Cyan is for sub-navigation. Red is danger only and is never used decoratively.

### Typography

One typeface family: **JetBrains Mono** with `ui-monospace` fallback. Two weights (400, 700). Five sizes on the existing 4/8px scale:

| Size | px | Role |
|---|---|---|
| h1 | 17 | Page titles, sidebar brand |
| h2 | 15 | Card titles, panel headings |
| body | 14 | Card meta, description text, body copy |
| meta | 12 | Status footer, secondary detail |
| micro | 11 | Sidebar group labels (uppercase), badges |

Uppercase labels (micro, badges, group headings) get `letter-spacing: 0.06em`. Body, titles, and headings get `letter-spacing: 0`. Inter is removed from the codebase.

The single typographic exception: the Library **preview pane** uses **Source Serif** (`Source Serif Pro` with `Georgia` fallback) for paragraph body. Headings, code, and blockquotes inside the preview stay mono. This is the only place serif appears in the app, and it exists to give long runbooks a paper-like reading surface.

### Ornament

Five ornament patterns. That is the entire vocabulary.

1. **Brackets and angles.**
   - Badges: `[ high ]`, `[ med ]`, `[ low ]`.
   - Mode tag: `<TODAY>`, `<BOARD>`, `<SPLIT>`, `<EDIT · ●>` (the `●` indicates a dirty document).
   - Action buttons: `[+] new`, `[e] edit`, `[s] save`, `[d] archive`, `[!] delete`. Bracket prefix doubles as a hotkey hint on desktop.
   - Tag chips: `ingress [4]` — name + count, dashed border by default.

2. **Dividers.**
   - 1px solid (`border`) for primary boundaries: cards, sidebar edge, modal frames.
   - 1px dotted (`border-dim`) for secondary dividers inside panels.
   - 3px solid colored left border for selection state and priority stripe.

3. **Glyphs (single Unicode characters).**
   - Priority blocks: `■■■` high, `■■□` med, `■□□` low.
   - Sync state: `●●●` ok, `●●○` syncing, `●○○` offline.
   - Status dots: `●` modified, `✓` saved, `○` idle.
   - Radio replacement: `(•)` selected, `( )` default.
   - Section collapse: `▾` open, `▸` closed.

   No icon fonts. No SVG sprite. Glyphs are Unicode chars styled with the palette.

4. **Breadcrumb path.** `moomora / today / homelab`. Slashes use `text-dimmer`, leaf node uses `accent-amber` and bold.

5. **Zero radius.** No `border-radius` on any element except the iOS status bar (which we don't own). No drop shadows except on modal backdrops. No gradients. Everything is a hard rectangle.

### Density

- 4px base spacing unit (4, 8, 12, 16, 20, 24, 32).
- Cards: 11–14px padding (breathing room without table-row tightness).
- Sidebar: 180px wide on desktop.
- Bottom nav: 56px tall on mobile (44px tap target + label).
- Status footer: 28px tall on desktop, 22px on mobile.
- Topbar: 40px tall.

## Layout Architecture

### Breakpoints

Three breakpoints, three names:

- `mobile` — below 768px
- `tablet` — 768 to 1023px
- `desktop` — 1024px and up

Implemented as CSS media queries. JS-side breakpoint detection uses `window.matchMedia('(min-width: 1024px)')` and `(min-width: 768px)` listeners for cases where layout actually needs JS (mobile drill-down navigation, bottom nav active state).

### Shell

| Region | Desktop | Tablet | Mobile |
|---|---|---|---|
| Navigation | 180px sidebar (views + contexts + cluster card) | Hamburger drawer + horizontal nav strip below topbar | Hamburger drawer + 5-slot bottom nav |
| Topbar | 40px (search + `[+] new` + `[a] admin`) | 40px (`≡` + search + `[+]` + `[a]`) | 36px (`M / moomora · ≡`) |
| Workspace | Fills remaining space | Fills remaining space | Fills remaining space |
| Status footer | 28px (breadcrumb · sync · `<MODE>`) | 28px (same) | 22px (breadcrumb · `<MODE>`, sync moves into hamburger) |

The status footer is the constant element. It is always visible, on every breakpoint, with the same three slots in the same order.

### Navigation slot map

The desktop sidebar's `// VIEWS` group has 5 items: `today`, `board`, `backlog`, `archive`, `library`. Mobile bottom nav has 5 slots — but one is reserved for the contextual `+` action, leaving 4 view slots. The mapping is:

| View | Desktop sidebar | Tablet horizontal nav | Mobile bottom nav | Mobile hamburger drawer |
|---|---|---|---|---|
| Today | ✓ | ✓ | `T` | (link, duplicate of nav) |
| Board | ✓ | ✓ | `B` | (link, duplicate of nav) |
| Backlog | ✓ | ✓ | — | ✓ |
| Library | ✓ | ✓ | `L` | (link, duplicate of nav) |
| Archive | ✓ | ✓ | `A` | (link, duplicate of nav) |
| Admin (modal trigger) | topbar `[a]` button | topbar `[a]` button | — | ✓ |
| Contexts (personal/work/homelab) | sidebar | hamburger drawer | — | ✓ |
| Cluster card (api/db/backup state) | sidebar | hamburger drawer | — | ✓ |

The hamburger drawer (`≡`) on tablet and mobile contains everything that doesn't fit on the primary nav: Backlog, Admin trigger, Contexts switcher, and Cluster status card. Drawer slides in from the left and dismisses on backdrop tap or `×` close.

### View-specific layouts

**Today / Backlog / Archive (list + detail).**
- Desktop: 1fr list + 380px detail panel.
- Tablet: same as desktop, slightly compressed detail.
- Mobile: list-only screen; tapping a row opens detail as a second screen with back arrow.

**Board (5 columns).**
- Desktop: all 5 columns visible side-by-side (`grid-template-columns: repeat(5, minmax(190px, 1fr))`).
- Tablet: horizontally scrolling strip showing 3 columns at a time with a `→` scroll indicator at the right edge.
- Mobile: 5 collapsible vertical sections with `▾`/`▸` toggles. Each section shows column name + card count in its header.

**Library (4 panes).**
- Desktop: 4 columns — docs (180px) + tags (150px) + edit (1fr) + preview (1fr).
- Tablet: 3 columns — docs (with tags collapsed into a drawer above the docs list, toggleable via a `tags ↕` chevron) + edit (1fr) + preview (1fr).
- Mobile: drill-down. Screen 1 = docs list with tag drawer. Screen 2 = single doc with edit/preview mode toggle (split mode is dimmed and disabled, not hidden — keeps the affordance discoverable).

**Modals (task form, doc form, document info, admin panel).**
- Desktop: centered floating panel, 640px wide, dim backdrop.
- Tablet: bottom sheet sliding up from the bottom edge, draggable to dismiss.
- Mobile: full-screen flow with topbar (`← cancel · title · [save]`).

Form fields inside never change. Only the chrome around them adapts.

### Touch interactions

- **Drag/drop is desktop-only.** On touch (`pointerType === 'touch'`), board cards use long-press to open a "move to..." menu instead. Avoids fat-finger reorders.
- **Swipe gestures are minimal.** Mobile list items don't swipe to reveal actions (too fragile). All actions live in the detail screen.
- **Tap targets** are minimum 44px tall on mobile (cards, nav slots, mode toggles).

## Component Patterns

### Cards

**Task card** replaces the current table row in Today/Backlog/Archive.

```text
┌─[3px stripe: priority color]──────────────────────────┐
│ back up cnpg                              [ HIGH ]    │
│ planned · due 2026-05-19 · verify backup schedule     │
│ #postgres #backup                                     │
└───────────────────────────────────────────────────────┘
```

Variants: default, selected (amber stripe + 8% amber tint), hi/med/lo (left stripe color).

**Board card** is a tighter variant: title + meta only, no description, no tag line. Drag handle is the entire card on desktop; long-press anywhere on touch.

**Metric card** for the metrics strip: micro-uppercase label + amber/red/phosphor value.

### Controls

| Control | Treatment |
|---|---|
| Primary button | Phosphor border, dark phosphor fill, bracketed label (`[+] new`, `[s] save`) |
| Secondary button | Dim border, no fill, plain or bracketed label (`cancel`, `[e] edit`) |
| Danger button | Red border, red text, 7% red fill (`[d] archive`, `[!] delete`) |
| Quiet button | No border, dim text, hover→phosphor (for in-flow actions like "restore") |
| Mode toggle | Segmented 3-up, active state = phosphor text + 2px phosphor underline + 8% phosphor tint. Disabled state = dimmed but visible |
| Tag chip | Dashed border (signals "filter input"). Solid phosphor border when active. Count in amber, e.g. `ingress [4]` |
| Hamburger drawer | Slide-in panel from the left on tablet/mobile. Contains: Backlog link, Admin trigger, Contexts switcher, Cluster status card. Dismisses on backdrop tap or `×` close. |
| Sidebar nav item | 3px phosphor stripe + 8% tint when active; counts in amber (active) or dim (default) |
| Bottom nav slot | Single-letter glyph above lowercase label. Active = phosphor text + phosphor glyph |
| Status footer | Three slots: breadcrumb (left) · sync state (middle) · `<MODE>` tag (right) |

### Inputs

- No fills, no rounded corners. 1px `border-dim` by default.
- Focus state: border becomes phosphor (`accent`). No focus ring beyond that.
- Placeholder text in `text-dimmer`.
- Search input placeholder is `/ search` (vim-style hint, never functional).
- Native radio buttons replaced with `(•)` / `( )` glyphs.
- Native checkboxes used as-is (the rendered Markdown task list still uses `<input type="checkbox" disabled>` because it has to match the rendered output).

### Editor and preview

**CodeMirror editor (Library edit mode).** Restyled via a new CodeMirror theme extension in `scripts/codemirror-editor-source.js`:
- Line numbers: `text-dimmer` (`#5a5d60`)
- Headings: phosphor (`#87d75f`)
- Bold: amber (`#d7af5f`)
- Inline code: amber on `bg`
- Blockquotes: cyan (`#87afff`)
- Caret: unchanged yellow (`#f8f2c6`)
- Active line gutter: dim phosphor tint

The fallback `<textarea>` editor (for browsers/contexts where CodeMirror fails to mount) uses the same colors via class-based CSS.

**Markdown preview.** This is the one place we use Source Serif. Background is `surface-warm` (`#14140f`) — a slightly warmer near-black than the main `bg`. Headings stay mono+phosphor. Code stays mono+amber (inline) or mono+phosphor (block). Blockquotes get a 2px phosphor left border + 5% phosphor tint. Tables use the standard palette.

### Sync indicator

The sync state in the status footer reflects API health and is sourced from the existing `state.apiStatus`:

- `connected` → `●●● ok` (phosphor)
- `loading` → `●●○ syncing` (amber)
- `error` → `●○○ offline` (red)
- `unknown` → `○○○ —` (dim)

The dots and label are sufficient for the initial implementation. A relative timestamp on success (`sync 12s ago`) is left for a future enhancement — it would require a `setInterval` and a `lastSyncAt` state field, neither of which are essential for the visual identity.

## View-by-View Treatment

### Today (default view)

- Sidebar shows `today` as the active item in the `// VIEWS` group, with the current task count in amber.
- Topbar: search field + `[+] new` button + `[a] admin` button.
- Metrics strip: 4 metric cards (`due today` red, `overdue` dim or red if >0, `wip` amber, `closed wk` phosphor). On mobile the strip stays 4-across but each card shrinks to label + number only (the label abbreviates: `due`, `over`, `wip`, `closed`).
- Workspace: list of task cards (with priority stripe), one per task. Empty state is a single bracketed message: `[ no tasks in today ]`.
- Mobile: bottom nav with `T` highlighted, `<TODAY>` mode tag in status footer.

### Board

- Same five columns as today: `high-priority`, `in-progress`, `planned`, `completed`, `notes`.
- Column header: `[ HIGH ]` style bracketed label + count in amber.
- Card style is the compact Board card variant.
- Drop targets show a 3px phosphor border when a card is hovered over them during drag.
- Tablet: scroll-indicator (`→`) on the right of the visible columns.
- Mobile: collapsible sections; long-press a card to open a "move to..." menu.

### Backlog

- List + detail layout, same components as Today but filtered to `status === 'planned' && !dueDate`.
- Empty state: `[ no backlog tasks ]`.
- Same mobile treatment as Today.

### Archive

- List + detail, read-only. Detail panel hides Edit and Archive actions, shows Restore (quiet button) and Delete (danger button).
- Mode tag: `<ARCHIVE>`.

### Library

Most complex view. See Layout Architecture above for breakpoint handling.

- Doc list shows title + `note`/`runbook` type + filename in dim. Selected doc gets the standard stripe + tint.
- Tag panel (desktop) / drawer (tablet) shows tag chips with `[count]`. Active tags glow phosphor.
- Smart views (saved tag combinations) appear above the tag list as a separate group.
- Edit/Preview/Split mode toggle is a segmented control. On mobile, split is dimmed.
- Focus mode (existing feature) hides the doc list pane and centers the editor + preview.
- Save state shown in the pane header: `<EDIT · ●>` for dirty, `<EDIT>` for saved. Mode tag in the status footer reflects the same.
- Editor uses CodeMirror with the operator theme. Markdown toolbar buttons (`H2`, `B`, `I`, `List`, etc.) stay bracket-style.

### Admin

- Modal on desktop (640px), bottom sheet on tablet, full-screen on mobile.
- Sections: Backup (export buttons), Restore/Import (mode radios with `(•)` glyphs, file pickers, `REPLACE` confirmation field), Archive Maintenance (open-archive button).
- Mode tag during admin: `<ADMIN>`.

### Modals — task/document form, document info

- Same chrome adaptation as Admin (desktop modal → tablet sheet → mobile full-screen).
- Form fields: text inputs, textareas, selects, all styled per the input rules above.
- Validation errors render at the top of the form as a `[!] error` bracketed block in red.
- Save button is the primary `[s] save` style; disabled while `isSaving`.

## Data and State

No backend changes. Frontend state additions to [public/js/state.js](../../../public/js/state.js):

| Field | Type | Purpose |
|---|---|---|
| `isDrawerOpen` | boolean | Hamburger drawer state on tablet/mobile |
| `mobileDetailOpen` | boolean | True when mobile is showing the detail drill-down screen instead of the list |
| `isLibraryDocOpen` | boolean | True when mobile Library is on the document screen instead of the doc list |
| `isLibraryTagsDrawerOpen` | boolean | True when the tags drawer is open on tablet |
| `boardOpenSections` | object | Map of `status → boolean` for the mobile board section collapse state |

A new helper module `public/js/breakpoints.js` exports:
- `isMobile()`, `isTablet()`, `isDesktop()` — synchronous checks
- `onBreakpointChange(callback)` — registers a `matchMedia` listener
- Initializes `state.isMobile` / `state.isTablet` on load and on resize

No new API methods. All CRUD operations and route paths are unchanged.

## File Inventory

### Modified

- `public/styles.css` — full rewrite (~1860 → ~1200 lines of operator-themed CSS)
- `public/index.html` — add JetBrains Mono + Source Serif font links (self-hosted via `public/vendor/fonts/`)
- `public/js/state.js` — add breakpoint and mobile-nav fields
- `public/js/main.js` — wire bottom nav, mobile drill-down, breakpoint detection, sync timestamp tracking
- `public/js/renderShell.js` — sidebar/topbar/status-footer/bottom-nav markup; mode tag rendering
- `public/js/renderList.js` — table rows become cards
- `public/js/renderBoard.js` — bracketed column headers, compact card variant, mobile collapsible sections
- `public/js/renderTaskDetail.js` — bracketed badges, breadcrumb in header, bracket-style action buttons
- `public/js/renderTaskForm.js` — modal/sheet/fullscreen chrome variants
- `public/js/renderAdminPanel.js` — same chrome variants, glyph-based radios
- `public/js/renderLibrary.js` — 4-pane → 3-pane (tags drawer) → drill-down; bracketed mode toggle; warm preview surface
- `scripts/codemirror-editor-source.js` — operator-theme CodeMirror extension
- `public/vendor/codemirror-editor.js` — regenerated bundle (output of `npm run build:codemirror`)
- `tests/frontend/render*.test.js` — updated assertions for new class names and markup (estimated 60–80% touch)

### New

- `public/js/breakpoints.js` — breakpoint detection helper
- `public/vendor/fonts/JetBrainsMono-Regular.woff2`, `JetBrainsMono-Bold.woff2`, `SourceSerifPro-Regular.woff2` — self-hosted font files
- `tests/frontend/breakpoints.test.js` — covers the new helper

### Not touched

- Anything under `server/`
- `server/schema.sql`, `server/db.js`, `server/config.js`
- `tests/backend/*` — all backend tests stay green
- `.github/workflows/*`, `.github/dependabot.yml`
- `deploy/`, `compose.yaml`, `compose.image.yaml`, `Dockerfile`
- `scripts/demo-server.js`, `scripts/run-tests.js`

## Rollout Phases

Three testable intermediate states. After each phase the app must be running locally (`npm run demo`) and smoke-tested before proceeding.

### Phase 1 — Visual language (stylesheet + fonts)

- Self-host JetBrains Mono + Source Serif under `public/vendor/fonts/`.
- Add font links and stylesheet versioning bump in `public/index.html`.
- Rewrite `public/styles.css` against the existing markup, using existing class names where possible and adding small markup hooks only where strictly necessary (e.g., adding a `[data-mode-tag]` attribute to the topbar for the new mode display).
- Minimal renderer changes: only what's needed to surface the new class names and the status-footer mode tag.

**Verifiable state at end of phase 1:** the app looks completely different (operator palette, mono everywhere, bracketed badges, mode tag visible) but every feature still works because the underlying renderers and event handlers are unchanged. Backend tests pass. Most frontend render tests still pass; some may need class-name updates.

**Known intermediate inconsistency in phase 1:** the CodeMirror editor inside Library/edit mode still uses its current theme (off-white-on-dark with the old palette). It's wrapped in new operator chrome but the editor surface itself doesn't change until phase 3. This is acceptable for an intermediate state but worth noticing during smoke test.

### Phase 2 — Component restructure

- Convert task list from table rows to cards (`renderList.js`).
- Convert task detail panel to use bracketed badges, breadcrumb, bracket-style buttons (`renderTaskDetail.js`).
- Convert task and document forms to use the new input styles and bracket-prefixed actions (`renderTaskForm.js`, modal rendering in `renderLibrary.js`).
- Convert Admin panel to bracketed sections and glyph-based radios (`renderAdminPanel.js`).
- Restyle Board cards and column headers (`renderBoard.js`).
- Update affected frontend tests inline.

**Verifiable state at end of phase 2:** full desktop redesign is complete. Today, Board, Backlog, Archive, Library, and Admin all render in the new component patterns. Mobile/tablet still uses the desktop layout (suboptimal but not broken).

### Phase 3 — Mobile and breakpoint adaptation

- Add `public/js/breakpoints.js` and wire it into `state.js` and `main.js`.
- Add bottom nav rendering in `renderShell.js` (mobile only).
- Add mobile drill-down navigation in `main.js` for list+detail views and Library.
- Add Board collapsible sections (mobile) and horizontal scroll (tablet).
- Add Library tags-drawer (tablet) and drill-down (mobile).
- Add modal/sheet/fullscreen chrome variants.
- Add long-press touch handler for Board card moves (replaces drag/drop on touch).
- Restyle CodeMirror via the new theme extension in `scripts/codemirror-editor-source.js`.
- Run `npm run build:codemirror` to regenerate `public/vendor/codemirror-editor.js`.
- Add `tests/frontend/breakpoints.test.js` and any mobile-specific test coverage needed.

**Verifiable state at end of phase 3:** redesign is complete on all three breakpoints. CodeMirror uses the operator theme. All frontend and backend tests pass.

Each phase is a discrete write session. After each phase I stop, you run `npm run demo` and load `http://127.0.0.1:3100/` to verify the state, and tell me to proceed (or fix). No commits are made during any phase; all changes accumulate in the working tree until you decide to commit.

## Risks

1. **Frontend test churn.** An estimated 60–80% of `tests/frontend/render*.test.js` assert on specific class names or markup. The redesign changes both extensively. Mitigation: update tests inline with each renderer change so the suite stays green at every step within a phase.
2. **CodeMirror bundle regeneration.** `public/vendor/codemirror-editor.js` is checked into git per current convention. The phase 3 theme work requires running `npm run build:codemirror` and including the regenerated bundle in the staged diff. Mitigation: run the build before the end of phase 3 and verify the bundle hash differs.
3. **Mobile drag-and-drop fallback.** Replacing native drag/drop with long-press on touch is a behavioral change for any touch user (including iPad). Mitigation: long-press menu is discoverable (visual feedback on press), and desktop drag/drop is unchanged.
4. **Self-hosted fonts add ~300KB.** JetBrains Mono (regular + bold) plus Source Serif regular as WOFF2 totals roughly 300KB added to the repo. Mitigation: this is the local-first homelab tradeoff — accept the size to avoid an external CDN request and keep the app fully offline-capable.
5. **Breakpoint detection edge cases.** `window.matchMedia` listeners can fire during orientation change or device pixel ratio shifts. Mitigation: the helper module debounces breakpoint state changes and re-renders only when the breakpoint band actually changes.
6. **Reading comfort regression.** Long Markdown documents in Library preview using Source Serif on `surface-warm` is a meaningful improvement, but for users who prefer pure mono, this is a small regression. Mitigation: if it becomes a real complaint, add a per-document or per-user preference. Out of scope for this redesign.

## Testing Strategy

### Test suite changes

- All backend tests (`tests/backend/*`) are untouched and must continue to pass at every phase.
- Frontend tests (`tests/frontend/render*.test.js`) are updated inline with renderer changes. Phase 1 may break a small number of tests that assert on specific Inter font references or rounded-corner classes; these are fixed in the same phase.
- New tests: `tests/frontend/breakpoints.test.js` covers `isMobile()`/`isTablet()`/`isDesktop()` and the change-callback wiring.
- No new tests required for visual treatment (we don't snapshot-test CSS); the renderer tests cover markup hooks.

### Manual verification per phase

| Phase | Smoke test |
|---|---|
| 1 | Load app, switch contexts, switch views, open New Task modal, open Admin, open Library. Confirm: new palette visible, mono everywhere, no obvious layout breaks, status-footer mode tag visible. |
| 2 | Phase 1 + create/edit/archive/restore a task; drag a board card between columns; create/edit/archive a Markdown doc; toggle Library mode between edit/preview/split; run admin import/export. |
| 3 | Phase 2 + load on a real phone or via Chrome devtools at 360px and 1024px; confirm bottom nav, drill-down navigation, board sections, library tag drawer, long-press card move, modal full-screen on mobile. |

### Verification commands

After each phase:
```bash
npm run check
npm test
npm audit --omit=dev
```

All three must exit 0. Visual verification is manual.

### What we don't test

- Pixel-perfect snapshots (not maintainable for a CSS-heavy redesign).
- Cross-browser font fallback rendering (visual-only; if JetBrains Mono fails to load, `ui-monospace` is acceptable).
- Touch gestures in automated tests (covered by manual mobile smoke test).

## Decisions

Choices made during brainstorming, recorded so reviewers can see why.

| Decision | Choice | Alternative considered |
|---|---|---|
| Personality direction | Operator Evolved (k9s lineage) | Editorial paper, Refined product, Bloomberg, Acme, BBS |
| Typeface | JetBrains Mono (mono everywhere) | Inter (current), separate body face, mixed |
| Preview pane exception | Source Serif body, mono headings/code | Mono everywhere (loses reading comfort), serif everywhere (loses identity) |
| Tag chip shape | Dashed border (filter input semantic) | Bracketed `[ ingress (4) ]` (uniform with badges) |
| Selection state | 3px stripe + 8% tint | Solid filled background (too heavy) |
| Border radius | Zero everywhere | 4px (current), 8px (rounded), mixed |
| Mobile nav | Bottom nav with 5 slots `T B + L A` | Hamburger only, slide-out drawer |
| Touch reorder | Long-press → "move to..." menu | Drag/drop (too fragile on touch) |
| Split mode on mobile | Dimmed + disabled (visible) | Hidden entirely |
| Font hosting | Self-hosted under `public/vendor/fonts/` | CDN (one less file but external request) |
| Rollout structure | Three phases with test pauses | All-in one pass, styles-first ship-and-decide |
| Git workflow | Stage-only, no commits until user reviews | Commit per phase, commit at end |

## Out of Scope (Explicit)

- Any API changes
- Any database schema changes
- Authentication / login UI
- Realtime collaboration features
- Settings or preferences panel
- Per-user themes or palette overrides
- Drag/drop on touch devices
- Calendar view (already out of scope per existing specs)
- Internationalization
