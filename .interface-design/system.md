# Prax interface design system

Working notes for anyone changing the UI. The stylesheet is `public/prax.css`; its
last two blocks, the Console layer and the ledger layer, carry these decisions and
win on equal specificity over the component rules above them. Keep new rules in
those layers or in the component they belong to, never as inline styles.

## Direction and feel

Prax is a bound ledger on a dark desk: one person and several agent CLIs write memory
into it, and the screen's first job is to say who wrote a thing, when, and whether a
person has checked it. The feel is quiet, dense enough for a day's work, and honest.
Nothing decorative; every colour means something.

Two themes, Graphite (dark, default) and Paper (light), share one hue and shift only
lightness. Ten user-selectable accents; lime is the default. Violet is reserved for
agent authorship and AI, and never used for anything else.

## Type

- UI: Schibsted Grotesk, 14px body. Weight and colour do the hierarchy before size.
- Metadata: JetBrains Mono for every id, count, date, key, section label and seal.
- Reading: Newsreader for document bodies, excerpts and the review desk.
- Scale in use: 10.5 (section labels, seals) · 11 (counts) · 12 (secondary) · 13
  (sidebar, rows) · 14 (body) · 16–20 (page titles) · 26 (review title).
- Four text tiers: `--ink`, `--ink2`, `--ink3`, and disabled. `--ink3` stays above AA
  on every surface; do not fade whole controls to signal unavailability.

## Surfaces and depth

Depth strategy is hairlines, not shadows. One sheet: titlebar, sidebar, status line and
the docked inspector all share `--surface` and are separated by `--rule` (the `--line`
hairline). Elevation above the page is a whisper: cards mix `--card` 70% into the
surface; popovers and the palette use `--pop`. Shadows appear only on floating layers.

Fields are wells. `--well` is the surface mixed toward the desk (72% light, 55% dark)
and is the background of the command bar, Library search, project filter and inspector
inputs. Focus returns the surface and adds the accent ring (`2px solid var(--accent)`,
offset 1px, plus a 3px `--accent-soft` halo on search).

## Colour budget

The accent marks three things only:

1. The current place: a 2px accent bar in the sidebar margin
   (`.places__item.is-active::before`), label in ink, icon in `--ink2`.
2. The page's one primary action: `.btn-primary` in `--accent-vivid` with dark ink.
   The titlebar New is a quiet bordered button so each page keeps a single primary.
3. Focus.

The status-line mode is accent text with a hairline, not a filled block. Hover and
selection are neutral lifts (`--ink` at 4–9%). Coral (`--hi`) is for overdue and
danger only; amber (`--med`) for soon, deferred and synth.

## Provenance seals

Trust is a mono word in a ring, 10.5px uppercase, 4px radius, 1px 7px padding:

- `.chip--unverified` dashed violet ring (agent-written, nobody has checked it)
- `.chip--verified` solid accent ring with a ✓
- `.chip--superseded` hairline ring, struck through
- `.chip--synth` amber ring; `.chip--stale` keeps its warning fill
- `.rq-chip--agent` on the review desk is the same seal

Type badges (`[class*="chip--type-"]`) are a bordered mono label with no colour; colour
is reserved for trust. On Library cards the seals sit on their own line under the
title (`.doc-card__head` wraps). The same seal appears on Library rows, the editor
head, Today's night shift and the review desk; add it anywhere a document is named.

## Spacing and density

Base unit 4px. Sidebar 232px, docked inspector 400px, review queue column 300px.
Rows: task 36px comfortable, 32px compact (a `data-density` preference on `body`).
Page padding 22px; card padding 14px; section gaps 18px with a mono group label and
a hairline to the edge. Mono metadata reads as a right-hand column, not pills.

## Components

- Button primary — 28px h · 0 11px pad · 6px radius · 12.5px/600 · `--accent-vivid`.
- Button ghost — 28px h · 0 10px · 8px radius · hairline border · `--ink2`.
- Seal — see above. Chip (status, due) — 11px/550 · 2px 8px · pill.
- Segmented control — 28px h · hairline frame · active segment `--accent-soft`.
- Task check — 24px target, 16px drawn box, done fills `--accent-vivid`.
- Command bar — 32px h · 8px radius · `--well` · mono `›` prompt in the accent.

## Motion

`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for anything entering or interactive,
`--ease-move` for on-screen movement. Buttons press to `scale(.97)` on `:active`.
Animate only transform and opacity. The reduced-motion rule removes every animation
and transition.

## Not yet implemented

The redesign canvas (Claude artifact 66BW5kYocXgmWziH46tbEG) goes further: a
provenance strip with author and date, a Library peek pane on Space, Today as a day
ledger, the inbox triage walk as the page. Those change markup and behaviour and are
tracked on the Prax task for the 2026-10-11 UI/UX review.
