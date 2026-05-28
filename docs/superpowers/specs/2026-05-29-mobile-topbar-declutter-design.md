# Mobile Top-Bar Declutter Design

**Date:** 2026-05-29
**Status:** Approved (brainstorm)
**Builds on:** v0.7.6
**Scope:** Spec B of the UI-improvement effort (mobile / consistency polish).

## Goal

Fix the overcrowded mobile top bar. At ≤767px the bar tries to fit the view title, the search field, and three action buttons (`[~] settings`, `[a] admin`, `[+] new`) into the viewport width; the search field collapses to a useless ~22px box (the "empty square" between the hamburger and settings) and `.topbar-actions` overflows ~41px past the right edge, clipping `[+] new`.

The fix hides the redundant action group on mobile and lets the search field expand to fill the bar.

## Current state (context)

- The top bar ([public/js/renderShell.js](public/js/renderShell.js), `.topbar`) renders: `.hamburger-trigger` (mobile only), `.topbar-title` (h1, the view label), `.search-field` (`flex: 1`), and `.topbar-actions` (settings, admin, library-only import, new).
- At ≤767px ([public/styles.css](public/styles.css) `@media (max-width: 767px)`), `.sidebar` is hidden, `.hamburger-trigger` and `.bottom-nav` are shown, and `.search-field` gets `max-width: none`. But `.topbar-actions` is still rendered at full size, so the search field is squeezed to ~22px and the actions overflow the right edge.
- On mobile the action buttons are **already reachable elsewhere**: the hamburger drawer ([renderShell.js](public/js/renderShell.js) `renderHamburgerDrawer`) has `[~] settings` (`open-settings`) and `[a] open admin` (`open-admin`); the bottom nav (`renderBottomNav`) has a `+` slot that dispatches `new-task` / `new-document` by view.
- The one action **not** mirrored elsewhere is the Library-only `[↑] import` (`import-document`), which lives only in `.topbar-actions`.

## Decisions (from brainstorm)

- Hide `.topbar-actions` entirely on mobile; let the search field expand. (Chosen over keeping `[+] new` in the bar, or hiding search.)
- Library `[↑] import` becomes **desktop/tablet-only** on mobile — accepted. Importing a `.md` file via a mobile file picker is awkward and rare; import stays fully available at >767px.

## Non-goals

- No change to the rendered markup or any JS — the action buttons remain in the DOM and behave exactly as today on desktop/tablet. This is a CSS-only, mobile-only visual fix.
- No change to the metric strip (it flex-wraps cleanly on mobile — acceptable), the archive-toggle styling (already a proper `bracket-button` after the archive-view work), or any other view. Those original Spec-B items are already resolved.
- No new mobile affordance for Library import (explicitly accepted as desktop-only).

## The change

One rule, added inside the existing `@media (max-width: 767px)` block in [public/styles.css](public/styles.css) (alongside the other mobile overrides such as `.sidebar { display: none; }` and `.search-field { max-width: none; }`):

```css
.topbar-actions { display: none; }
```

Effect at ≤767px:

- The top bar becomes `≡ hamburger · view title · search field`.
- `.search-field` (already `flex: 1; max-width: none` on mobile) expands to fill the space the actions vacated — no more collapsed ~22px box.
- No element overflows the right edge — `[+] new` clipping is gone (the button is hidden, not clipped).

Reachability on mobile is preserved for everything except Library import:

- `settings` → hamburger drawer (`open-settings`)
- `admin` → hamburger drawer (`open-admin`)
- `new task` / `new doc` → bottom-nav `+` slot
- Library `import` → desktop/tablet only (accepted)

Desktop (≥768px) and tablet are unaffected — `.topbar-actions` is only hidden under the mobile media query; at all other widths it renders as today.

## Testing

This is a CSS-only media-query change with no markup or behaviour change, so:

- **No render-test changes.** The existing `tests/frontend/renderShell.test.js` assertions that the action buttons are present in the markup (`data-action="open-settings"`, `data-action="open-admin"`, `data-action="new-task"` / `new-document`, `import-document` on library) all still pass — the buttons remain in the rendered HTML; they are only visually hidden by CSS at ≤767px. Confirm the full suite stays green (`npm test`).
- **Manual mobile smoke** (the real verification), at a ≤767px viewport via `npm run demo`:
  1. Top bar shows `≡ · view title · search` with the search field filling the bar — no empty square, no clipped button.
  2. `settings` and `admin` open from the hamburger drawer; `+` in the bottom nav creates a task (or doc on Library).
  3. On the Library view, `[↑] import` is absent on mobile (desktop-only, as accepted).
  4. At ≥1024px the top bar is unchanged (title + search + settings/admin/[import]/new).

## Risks / notes

- The only capability change is Library import being hidden on mobile — a deliberate, accepted trade-off, documented here so it isn't mistaken for a regression.
- Because the change is a single mobile-scoped CSS rule, blast radius is minimal: it cannot affect desktop/tablet layout or any non-CSS behaviour.
- If mobile import is ever wanted back, the follow-up is to surface `import-document` in the hamburger drawer's Library context rather than re-showing the whole action group.
