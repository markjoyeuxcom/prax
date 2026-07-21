# Context-Aware Panel Implementation Plan

**Goal:** The panel becomes the secondary navigation for the rail's current context — a
Today plan cockpit, a Calendar mini-month, a Library document browser, and Settings
section nav — while project contexts keep the existing Projects/Views browser untouched.

**Source:** Layout follow-up (2026-07-21), all four mocked phases chosen by the user.
**Status:** Shipped

## Design decisions

1. **Dispatch on `navType`, defaults preserved.** `renderPanelHtml` becomes a dispatcher:
   `today` → cockpit, `calendar` → mini-month, `library`/`editor` → document browser,
   `settings` → section nav; everything else (projects, All, Filter) renders the exact
   existing browser. Every context panel reuses the live `data-action` vocabulary — the
   cockpit's rows are `open-task`, the mini-month days are `calendar-select-day`, the
   library types are `toggle-lib-type` — so panels and main views can never disagree.
2. **Filter auto-selects the Views tab** (set in `goFilter`, not forced at render), so the
   filter world's sidebar is its views; the user can still tab away.
3. **Today cockpit** = the plan score, the Plan/Shut-down actions, honest counts
   (overdue / due / snoozed / planned-earlier), and the planned working set as rows.
   The Today page header keeps its own buttons — narrow windows have no panel.
4. **Calendar panel** reuses `buildCalendarModel` for a Monday-start mini grid: load dots,
   today ring, selected-day highlight, ‹ › month nav, and the selected (or current) day's
   tasks beneath.
5. **Library panel** = document types with counts (one-click filters), Library saved
   views (their natural home), and the five most recently touched docs. *No duplicate
   search box* — the main view owns search, and two inputs sharing a selector would
   fight the focus-restore machinery.
6. **Settings panel** replaces the horizontal tab strip on wide windows (the strip stays
   under 940px where there is no panel) and adds a small live-status block: calendar
   sync state and the capture chord — rendered only from already-loaded state, never
   fetched by the panel.

## Work

- [x] `renderShell.js`: dispatcher + `renderTodayPanel` / `renderCalendarPanel` /
      `renderLibraryPanel` / `renderSettingsPanel`; browser panel extracted unchanged.
- [x] `goFilter` sets `panelTab: 'views'`; Settings strip conditional on `winW < 940`.
- [x] CSS for cockpit/mini-month/status rows.
- [x] Tests: dispatch suite + one per context (score/buttons/planned rows; grid
      dots/today/selected; type counts/recent order; section rows + status), Settings
      strip-narrow pins updated, `makeState` default context moved to `all` (the old
      default `today` now renders a cockpit, which the browser tests are not about).
- [x] E2e: existing panel journeys now start from All projects (the app boots into
      Today, whose panel is the cockpit); today-plan spec disambiguates the now-doubled
      Plan/Shut-down buttons; the palette spec's "still on Projects tab" assertion
      became "Stale is active on the auto-selected Views tab"; new journeys for cockpit,
      settings nav, library types, calendar mini-month.
- [x] CHANGELOG entry.

## Verification (as shipped)

Recorded in the commit: full unit + e2e gates green. No schema, no new endpoints, no new
IPC — every context panel is a re-arrangement of loaded state over existing actions.

## Risks / notes

- The trade-off named in the mockup discussion stands: in Library/Settings the project
  list is two clicks (or one ⌘K) away. Inbox stays on the rail, and the palette jumps
  are the designed mitigation.
- Context panels render only what is already in state (e.g. calendar status appears
  once Settings loaded it) — a panel must never originate fetches or spinners.
