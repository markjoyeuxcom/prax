# Handoff: Prax — Desktop Task / Notes / Runbook Console

## Overview

Prax (by Moomora) is a **single-user, local-first desktop app** for tasks, notes, and Markdown runbooks. This handoff covers the complete redesign away from a terminal aesthetic to a calm, native-feeling desktop app in the class of Linear / Things / Craft. It includes: project management, four task views (list, kanban, backlog, archive), a task detail drawer, a Markdown library with keyword + semantic search, an Obsidian-style editor, cross-links between tasks and docs, and settings (appearance, AI, data admin).

Sibling product: **Klyx** (Kubernetes GUI). The two share a brand construction: outlined rounded-square icon containing a geometric shape + lowercase letter.

## About the Design Files

`Prax.dc.html` is a **design reference created in HTML** — a working interactive prototype showing intended look and behavior. It is **not production code**. The task is to recreate this design in the target codebase's environment. Recommended stack for the real app: **Tauri (Rust shell) + a web frontend** (React/Svelte/Vue — whatever the team prefers), with local SQLite or flat-file storage. If reusing the existing Moomora web frontend, apply this design system to it and wrap in Tauri.

The prototype's data (projects, tasks, docs) is seed/demo content — replace with real persistence.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, and interactions are final intent. Recreate pixel-perfectly, substituting equivalent components from your framework where sensible (e.g. native menus, real drag-and-drop lib).

---

## Design Tokens

Implement as CSS custom properties (or your token system). Two first-class themes.

### Color — Light ("Porcelain")

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F1F0EC` | Sidebar, titlebar, statusbar, recessed panes |
| `--surface` | `#FAF9F7` | Main content background, drawer, modals |
| `--card` | `#FFFFFF` | Cards, rows containers, inputs |
| `--ink` | `#1F2624` | Primary text (green-tinted near-black) |
| `--ink2` | `#59625E` | Secondary text |
| `--ink3` | `#8E9793` | Tertiary/hint text |
| `--line` | `rgba(31,38,36,.08)` | Hairline borders |
| `--line2` | `rgba(31,38,36,.16)` | Stronger borders, control outlines |
| `--accent` | `oklch(0.52 0.09 175)` | Fern teal — primary actions, active states |
| `--accent-ink` | `#FFFFFF` | Text on accent |
| `--accent-soft` | `color-mix(in oklab, var(--accent) 11%, transparent)` | Hovers, active nav, tints |
| `--accent-soft2` | 20% mix | Selection |
| `--hi` | `oklch(0.60 0.16 27)` | High priority / overdue (coral red) |
| `--med` | `oklch(0.70 0.13 78)` | Medium priority / due-today (amber) |
| `--lo` | `oklch(0.62 0.05 230)` | Low priority (muted slate blue) |
| `--hi-soft` / `--med-soft` | 12–16% alpha of above | Flag chip backgrounds |
| Desk backdrop | `linear-gradient(160deg,#E9E7E1,#DDDCD6 55%,#D2D3CD)` | Behind the window |

### Color — Dark ("Deep Fern")

| Token | Value |
|---|---|
| `--bg` | `#171C1B` |
| `--surface` | `#1C2220` |
| `--card` | `#242B29` |
| `--ink` | `#E6EAE8` |
| `--ink2` | `#9AA5A0` |
| `--ink3` | `#68736E` |
| `--line` | `rgba(230,234,232,.07)` |
| `--line2` | `rgba(230,234,232,.15)` |
| `--accent` | `oklch(0.78 0.10 172)` (brighter teal) |
| `--accent-ink` | `#0E1F1B` |
| `--hi` | `oklch(0.70 0.15 25)` · `--med` `oklch(0.78 0.12 80)` · `--lo` `oklch(0.68 0.05 230)` |
| Desk backdrop | `linear-gradient(160deg,#101413,#0C100F 60%,#0A0D0C)` |

Accent is user-swappable (Settings): Fern (default), Indigo `oklch(0.60 0.11 265)`, Clay `oklch(0.62 0.11 40)`, Moss `oklch(0.58 0.10 130)`.

### Typography

- **UI**: `Instrument Sans` (Google Fonts), fallback Helvetica Neue. Weights 400–700; most labels 450–650.
- **Prose** (editor preview, doc excerpts, task notes): `Source Serif 4`, fallback Georgia.
- **Code** (inline/blocks in Markdown only): `ui-monospace / SF Mono / Menlo`.
- Scale (px): 10 uppercase micro-labels (letter-spacing .08em) · 11–11.5 meta · 12–12.5 controls · 13–13.5 body/rows · 14.5 doc titles · 15.5 drawer title · 19 page titles (weight 650, letter-spacing −0.015em). Editor body 15px base × user "reading size" scale (0.85–1.25), line-height 1.7.

### Spacing, radii, elevation

- Spacing: 4/6/8 micro; 9–11 within rows; 14–16 card padding; 20–26 page padding.
- Radii: 4–5 kbd chips · 6–8 buttons/inputs · 9–10 rows/small cards · 12 cards/panels · 14 drawer/modals/page-sheet · 99px pills · window 12.
- Shadows: window `0 24px 70px rgba(31,38,36,.18), 0 2px 8px rgba(31,38,36,.08)`; popovers/drawer (`--pop`) `0 16px 48px …16, 0 2px 8px …10`; card hover `0 4px 14px rgba(31,38,36,.07–.08)`; page sheet `0 2px 12px rgba(31,38,36,.06)`. Darker equivalents in dark theme (black at .35–.5).
- Focus: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px }` on all interactive elements.

### Iconography

15×15 stroke icons, `stroke-width:1.4`, round caps/joins, `currentColor`, built from primitives (rects/circles/lines): grid, book, doc, search, plus, sliders, tag, spark (semantic/AI), check, group, cmd, inbox. Use an equivalent minimal set (e.g. Lucide at 15px/1.4 stroke) or port the inline SVGs from the prototype.

### Brand

- Logo: rounded-square outline (stroke 2, radius ~27%) containing a 45°-rotated rounded square (diamond) + lowercase "p", all in `--accent`. Sizes used: 15 (palette footer), 25 (sidebar/rail), 48 (empty states).
- App icon: `prax-app-icon.png` (1024px macOS squircle, fern gradient `#3E8172→#2C6558→#1D4A40`, white diamond + p). Wordmark: lowercase "prax" 650 weight + "by moomora" 10px `--ink3`.

### Motion

- `mmFade` fade-in .25–.3s ease (cards, view content)
- `mmSlide` drawer: translateX(28px)+fade, .22s `cubic-bezier(.2,.8,.25,1)`
- `mmPop` palette/capture: scale(.97)+translateY(6px)+fade, .18s same easing
- `mmToast` toast: translateY(14px)+fade, .22s
- Hover transitions on borders/backgrounds only; no gratuitous motion.

---

## Application Shell

- Desk backdrop gradient fills the OS window; app window: max-width 1560, radius 12, `--line2` border, window shadow, 22px inset.
- **Titlebar (46px, `--bg`, bottom hairline)**: traffic lights (12px circles #FF5F57/#FEBC2E/#28C840) OR Windows controls (─ ▢ ✕, 34×28 flat buttons, close hover = red bg) per Settings. Center: breadcrumb `prax — <context>` 12.5px `--ink3`. Right: search pill ("Search or jump to… ⌘K", 28px, `--surface`, hairline), "＋ New task" primary button (accent bg, 28px, radius 8, weight 600), theme toggle (◐, 28×28 outline button).
- **Sidebar (230px, `--bg`, right hairline)**: logo + wordmark; nav (Today with red count badge, All projects, Library); PROJECTS section (colored dot — solid=active, ring=on-hold — name, open-task count; ＋ to manage); SAVED VIEWS (tag icon + label); Settings pinned bottom above hairline. Items: 30px rows, radius 7, 13px; active = `--accent-soft` bg (+accent text for nav); hover = `--accent-soft`.
- **Icon rail (54px)** replaces sidebar below **940px window width**: logo, icon buttons (34×34, tooltips), hairline divider, project color-dot buttons (active = 2px accent outline inset).
- **Statusbar (29px, `--bg`, top hairline, 11px `--ink3`)**: left "● All changes saved locally" (accent dot); right kbd hints: ⌘K command · N new task · ↑↓ navigate · E done · ⌘J theme. Kbd chip: 1px `--line2` border, radius 4, 10px.
- In **Focus mode** (editor), sidebar, titlebar right controls, and statusbar are hidden.

## Screens / Views

### 1. Project — List (default)
Header (pad 20/26): 10px project color dot + name (19px/650) + state chip (11px pill: Active=accent-soft/accent, On hold=med-soft/med, Completed/Archived=line/ink2). Tab row under it (List · Board · Backlog · Archive; active = 600 weight ink + 2px accent underline; counts appended "· n"), right: "Group: Due date" cycler (Due date → Priority → Status).

Task groups: uppercase 11px label (Overdue=`--hi`, Today=`--med`, others `--ink3`) + count; rows in a `--card` container (radius 10, hairline dividers). Row (padding 9/14, 13.5px): checkbox (16px, radius 5, 1.5px `--line2` border; done = accent bg + white ✓) · 7px priority dot (hi/med/lo) · title (done = strikethrough `--ink3`) · checklist "2/4" with check icon · linked-doc count with doc icon · due chip (pill 11px: "Jul 4 · overdue" hi-soft/hi, "Today" med-soft/med, future = line/ink2). Completed group last.

- Hover row: `--accent-soft`. Keyboard selection: same tint; ⇧/⌘-click multi-select: `--accent-soft2`.
- **Multi-select bulk bar**: sticky bottom, `--ink` bg pill-card (radius 12), "N selected" + Complete / Backlog / Archive buttons (white 14% alpha bg) + ✕ clear.
- **Empty state** (e.g. "Reading Pipeline"): centered 48px logo, "Nothing here yet" 15.5/650, one supporting line `--ink2`, primary "New task" button, "or press N anywhere" hint.

### 2. Project — Board (kanban)
4 columns (grid, min 215px, gap 14): Priority (`--hi` dot) · In progress (accent) · Planned (`--lo`) · Completed (`--ink3`). Column: radius 12, `--bg` fill, 8px padding; drag-over = `--accent-soft` fill + dashed accent border. Card (`--card`, radius 10, pad 11/12, subtle shadow, grab cursor): priority dot + 13px/550 title; meta row: project chip (project color at 13% bg / full color text), due chip, checklist + doc counts; optional last-activity line above a hairline. Drag & drop: 3px accent **drop-position indicator** between cards; reorder within column supported; empty column shows dashed "Drop cards here" slot. Completed cards keep strikethrough style.

### 3. Project — Backlog
Hint line ("Someday / maybe…"), stacked rows (card, radius 10): dot + title + "Promote to board" outline button (hover accent). Empty: dashed border card, friendly line.

### 4. Project — Archive
Dimmed rows (opacity .75) + "Restore". Empty: dashed card.

### 5. Today (cross-project)
Title + date line ("Sunday, July 6 — everything due or slipping…"). Groups: Planned / Overdue / Today, then a collapsible **Next 7 days** section with one group per day (Tomorrow, then weekday + date); the collapse state persists per device with the panel sections. Rows = list rows + project chip. Sidebar badge = overdue+today count (hi-soft/hi pill). Empty: logo, "All clear".

### 6. All projects
Title + subtitle; sections by state (Active / On hold / Completed / Archived, archived cards at 60% opacity). Card (radius 12, pad 15/16, hover shadow+border): dot + name + state chip; 4px progress bar (project color on `--line`); "n open · n done" + updated label; hairline; state-change chip buttons (Active/Hold/Done/Archive minus current). Click card → project list.

### 7. Library
Header: title + "Import .md" (real file picker, multi, `.md/.markdown/.txt` → docs tagged `#imported`), "Export all", primary "＋ New doc". Search row: input (34px, `--card`, accent border when semantic on; placeholder switches to natural-language prompt) + **Semantic** toggle button (spark icon; on = accent fill) + "Sort: Updated/Title" cycler. Tag chip row (pills; active = accent fill/white).

- **Keyword mode**: docs grouped Runbooks / Notes in a responsive card grid (min 275px). Doc card: title 13.5/600 + type chip (RUNBOOK accent-soft/accent, NOTE line/ink2), 2-line serif excerpt `--ink2`, tag pills (accent-soft/accent), updated label.
- **Semantic mode, no query**: centered spark illustration + "Ask your library a question" + example prompt; notes it runs locally.
- **Semantic mode, query**: "N documents matched by meaning — ranked locally…" + result cards: left 44px score block (big accent % + mini bar), title + type chip, one-line "why it matched" reason in `--ink2`.
- **No-results**: "No documents match" + suggestion to try Semantic + "Clear filters".

### 8. Editor
Header (pad 12/20, bottom hairline): back ←, **editable title input** (borderless; hover hairline; focus accent border + card bg; min-width 140px), tag pills (clipped overflow), Edit/Split/Preview segmented control (active = accent-soft/accent), **Outline** toggle, **Export** (downloads current doc as `.md`), **Focus** toggle (active = accent fill).

Toolbar (Edit/Split only): B, I, H2, quote, inline code, bullet, task item, link — wrap/insert at cursor selection; tooltips include shortcuts. Right label: "⌘B bold · ⌘I italic · ⌘E code" (also live keybindings in the textarea).

Panes:
- **Split**: full-width halves with center hairline; 10px uppercase pane labels "Markdown" / "Preview"; editor scroll drives preview proportionally (one-way sync).
- **Edit-only / Preview-only**: content rendered as a **page sheet** — max-width 740, `--card` bg, `--line2` border, radius 14, soft shadow, centered on `--bg` with 20–26px gutter.
- **Focus**: chrome hidden, borderless centered 740px column.
- **Outline rail** (192px, left hairline): heading list from `#`–`###`; indented 11px/level; click scrolls the preview (or approximates in the textarea). Auto-hidden in Focus / when <2 headings.
- Raw pane: plain textarea, Instrument Sans, 1.7 line-height, accent caret.

Markdown preview rendering (Source Serif 4): H1 1.65em / H2 1.25em / H3 1.05em in Instrument Sans 650; blockquote = 3px accent left bar on accent-soft, radius right; inline code = accent-soft chip, mono .85em; code block = `--bg` card; **task list items are clickable** — toggling rewrites `- [ ]`/`- [x]` in the source; links accent-colored.

**Backlinks footer** (preview): hairline, "REFERENCED BY N TASK(S)", rows (priority dot + task title + project chip) → clicking opens that task's drawer.

Status footer (28px): "N words · N characters · N min read" · right "Markdown · autosaved".

### 9. Settings
Single 640px column, three carded sections:
- **Appearance**: Theme (two preview cards with mini bars + accent stripe; selected = 2px accent border) · Window controls (macOS / Windows segmented) · Accent (4 swatch circles, selected = accent ring) · Reading text size slider (0.85–1.25, applies to editor/preview only, % label).
- **Intelligence**: Semantic search toggle switch (36×21 pill, accent when on; off hides Semantic in Library) · Provider cards (On-device / Claude API / Custom endpoint; selected = accent border + soft bg) · API key password input + "Test connection" (cloud providers) with privacy note · Embedding model row + Re-index (on-device) · index stats footer.
- **Data & admin**: rows (label + description + right outline button): Back up now, Export tasks as JSON, Import tasks from JSON, Export library as Markdown; stats footer ("N tasks · N projects · N documents · last backup …").

### 10. Overlays
- **Task drawer**: right-side floating panel — 410px wide, inset 34px, radius 14, `--pop` shadow, slide-in; scrim `rgba(15,20,18,.28)`. Below 940px: near-full-width (12px inset). Contents: done checkbox + 15.5/650 title + project & due chips; ✕ close (Esc). Field rows (64px label column, 11.5px `--ink3`): Status pills (Priority/In progress/Planned/Completed/Backlog; active accent fill), Priority pills (dot + label, active accent border), Due (native date input + Clear). Notes: serif editable textarea (borderless; hover/focus border). Checklist: header with "n of m" + thin accent progress bar; toggleable items. Linked documents: card rows (doc icon, title, type chip) → open in editor. Activity: dot-and-line timeline, 12.5px entries + 11px timestamps. Footer: "Archive task" (hover = red) with **Undo toast**.
- **Command palette (⌘K)**: centered 560px, top 14vh, radius 14, pop shadow+scrim. Input row w/ search icon + esc chip. Grouped results (Commands / Tasks / Documents), filtered live; ↑↓ moves accent-soft highlight, ↵ runs. Commands include New task, New document, Toggle dark mode, Go to board, Open library, All projects, Focus writing, Open settings. Footer: logo + "prax" + key hints.
- **Quick capture (N)**: 520px modal, checkbox glyph + borderless input "What needs doing?"; footer shows destination project chip + "↵ add task". Adds a planned/medium task to the current project.
- **Toast**: bottom-center `--ink` pill, 12.5px, optional bright-teal **Undo** action (5s), else 2.4s.

## Interactions & Behavior (summary)

- **Keyboard**: ⌘K palette · ⌘J theme · N quick capture · Esc closes palette→capture→drawer→selection→focus (in that order) · ↑↓/↵/E list navigation · ⌘B/⌘I/⌘E in editor.
- **Undo** on complete, archive, bulk actions (restores prior status).
- **Drag & drop**: HTML5 DnD; position indicator; cross-column status change + within-column reorder; toast on drop.
- **Theme**: `data-theme` attribute switch; both themes first-class; accent override applies everywhere via the token.
- **Responsive**: sidebar→rail at <940px; drawer widens; text truncation with ellipsis everywhere (titles, tags clip rather than wrap); board scrolls horizontally at min 900px content width.
- **Persistence intent**: all mutations (task status/priority/due/notes/checklist, doc bodies/titles, settings) autosave locally; "saved locally" indicator in statusbar.

## State Management (prototype reference)

Core state: `theme`, `accent`, `chromeOS`, `fontScale`; routing (`navType`: today/project/all/library/editor/settings + `navId`, project `tab`, `docId`, `editorMode`, `focus`); data (`projects[]`, `tasks[]`, `docs[]`, `savedViews[]`); UI (`drawerId`, `paletteOpen/paletteQ/palSel`, `captureOpen`, `libQ/semantic/libTags/libSort`, `selIds/listSelId`, `dragId/dragPos`, `outlineOpen`, toast).

Task: `{id, projectId, title, notes, priority: high|med|low, due: date|null, status: priority|inprogress|planned|completed|backlog|archived, checklist:[{t,done}], docs:[docId], activity:[{t,when}]}`.
Doc: `{id, title, type: runbook|note, tags[], updated, excerpt, body(markdown)}`.
Project: `{id, name, color, state: active|on-hold|completed|archived}`.

Semantic search in the prototype is faked (keyword-overlap scoring + per-doc "why" strings); production should use real embeddings per the Settings provider choice.

## Assets

- `Prax.dc.html` — the full interactive prototype (open in a browser; all styling inline, logic in the embedded script)
- `prax-app-icon.png` — 1024px app icon (derive .icns / .ico from it)
- Fonts: Instrument Sans + Source Serif 4 via Google Fonts (bundle locally for the desktop build)
- Logo: inline SVG, see `logo(size)` in the prototype source

## Files

- `design_handoff_prax/Prax.dc.html`
- `design_handoff_prax/prax-app-icon.png`
- `design_handoff_prax/README.md` (this file)
