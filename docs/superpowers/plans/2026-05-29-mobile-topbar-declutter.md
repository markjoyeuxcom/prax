# Mobile Top-Bar Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the redundant top-bar action group on mobile so the search field can fill the bar — fixing the collapsed "empty square" search box and the clipped `[+] new` button.

**Architecture:** A single CSS rule added to the existing `@media (max-width: 767px)` block hides `.topbar-actions`. No markup or JS change; the buttons stay in the DOM and on desktop/tablet exactly as today, and remain reachable on mobile via the hamburger drawer (settings/admin) and bottom nav (new). Library `[↑] import` is intentionally desktop/tablet-only after this.

**Tech Stack:** Plain CSS (`public/styles.css`), Node built-in test runner for the regression check.

**Spec:** [docs/superpowers/specs/2026-05-29-mobile-topbar-declutter-design.md](../specs/2026-05-29-mobile-topbar-declutter-design.md)

---

## Task 1: Hide top-bar actions on mobile

**Files:**
- Modify: `public/styles.css` (the `@media (max-width: 767px)` block, near line 3083)

This is a CSS-only, mobile-scoped visual fix. There is no failing-test-first step because a media-query rule isn't meaningfully unit-testable and no markup/behaviour changes (the existing `renderShell` tests assert the action buttons exist in the HTML, which stays true — they are only hidden by CSS at ≤767px). Verification is the full suite staying green plus a manual mobile smoke.

- [ ] **Step 1: Confirm a clean baseline**

Run: `npm test`
Expected: full suite passes (569 tests, 0 failures).

- [ ] **Step 2: Add the rule**

In `public/styles.css`, inside the `@media (max-width: 767px) {` block, the search override currently reads:

```css
  .search-field { max-width: none; }
```

Add the `.topbar-actions` hide immediately after it, so the block reads:

```css
  .search-field { max-width: none; }

  /* On mobile the action buttons are redundant — settings/admin live in the
     hamburger drawer and "+ new" is in the bottom nav — so hide the group and
     let the search field fill the bar. (Library [↑] import is desktop-only.) */
  .topbar-actions { display: none; }
```

Do not change the markup or any other rule. `.search-field` already has `flex: 1` (base rule) and `max-width: none` (mobile), so it expands into the freed space automatically.

- [ ] **Step 3: Verify the suite is still green**

Run: `npm test`
Expected: full suite still passes (569 tests, 0 failures) — the change is CSS-only and touches no tested markup or behaviour.

Run: `npm run check`
Expected: clean.

- [ ] **Step 4: Manual mobile smoke**

Run: `npm run demo` (serves on `http://127.0.0.1:3100`). In a browser at a ≤767px viewport (e.g. 390×844), verify:
1. Top bar shows `≡ hamburger · view title · search field`, with the search field filling the bar — no collapsed ~22px "empty square", no element clipped at the right edge.
2. `[~] settings` and `[a] admin` open from the hamburger drawer; the bottom-nav `+` creates a task (and a document on the Library view).
3. On the Library view, `[↑] import` is absent on mobile (desktop-only, as accepted in the spec).
4. Resize to ≥1024px: the top bar is unchanged — title + search + `settings`/`admin`/(`import` on Library)/`new` all present.

Stop the demo (Ctrl+C / `pkill -f "node scripts/demo-server.js"`).

- [ ] **Step 5: Commit**

```bash
git add public/styles.css
git commit -m "fix: hide redundant top-bar actions on mobile so search fills the bar"
```

---

## Self-review checklist

- [x] **Spec coverage:** the single spec change (`.topbar-actions { display: none; }` in the ≤767px media query) is Task 1 Step 2; reachability preserved via drawer/bottom-nav and import-desktop-only are covered by the manual smoke (Step 4 items 2–3); "no markup/JS change, suite stays green" is Step 3; desktop unaffected is Step 4 item 4.
- [x] **No placeholder steps:** every step is concrete — exact file, exact rule, exact commands and expected output. The absence of a failing-test-first step is explicitly justified (CSS media query, no testable surface).
- [x] **Type/name consistency:** the only identifier is the existing `.topbar-actions` class (rendered by `renderShell.js`, styled in `styles.css`); no new names introduced.
