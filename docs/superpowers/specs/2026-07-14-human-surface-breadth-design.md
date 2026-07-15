# Human-surface Breadth — Design

**Status:** Approved for implementation
**Date:** 2026-07-14
**Quality-standard scope:** task lifecycle, responsive reflow, touch operation, and reduced motion

## Problem

The release-wide evidence pass established automated WCAG scans and large-fixture performance
baselines, but it deliberately left several human-surface clauses open. At narrow and
400%-equivalent widths the task board still requires horizontal travel, task multi-selection
depends on desktop modifier keys, and dense action regions have no explicit reflow contract.
Reduced-motion styling exists, but no production-browser assertion prevents it from regressing.

These are product constraints, not cosmetic preferences. A user must be able to inspect and
operate the core task lifecycle without page-level two-dimensional scrolling, a physical
keyboard, or avoidable animation.

## Outcomes

### 1. Reflow contract

At a CSS viewport width of 320 px—the WCAG 1.4.10 reference equivalent of a 1280 px desktop
viewport at 400% zoom—the task list, board, backlog, and archive have no page-level horizontal
overflow. Content may wrap or stack; controls may use a clearly bounded internal scroller only
when preserving a one-dimensional ordered control is materially better than wrapping.

The task board becomes a single vertical sequence at narrow widths. Its columns retain headings,
counts, cards, empty states, and keyboard order. This intentionally replaces the current forced
720 px canvas.

### 2. Touch-operable multi-selection and bulk actions

Every list task has an explicit Select/Deselect control with an accessible name and pressed
state. It is visually available for coarse-pointer and narrow-viewport users and remains
discoverable by keyboard and hover on desktop. Modifier-click selection continues to work.

Selecting more than one task exposes the existing bulk toolbar. At narrow widths the toolbar
wraps within the viewport without hiding Complete, Backlog, Archive, or Clear selection. Browser
evidence uses a touch-enabled context to select tasks and execute a real bulk lifecycle action.

### 3. Reduced-motion evidence

When the operating system requests reduced motion, production-rendered application controls and
overlays have no non-essential CSS animation or transition duration. The browser test checks
computed styles rather than merely emulating the preference.

### 4. Honest evidence boundary

This pass adds deterministic browser evidence for reflow, touch reachability, lifecycle mutation,
and reduced-motion CSS. It does not claim screen-reader certification, full physical-device
coverage, cognitive-usability validation, or human visual approval at every zoom step. Those
remain explicit scorecard constraints until manually exercised.

## Gate-A invariants

- Responsive styles must not change task identity, status mapping, count semantics, or visible
  keyboard order.
- Touch selection must never open the task drawer or toggle task completion as a side effect.
- Bulk mutations continue to use stable task identities, readback, and the existing undo path.
- Narrow layouts must not remove named actions; presentation may stack or wrap them.
- Reduced motion must not suppress state feedback or focus indication.

## Verification

- Unit evidence protects selection markup and pressed-state semantics.
- Production-path Playwright evidence covers 320 px reflow, narrow board stacking, touch bulk
  operation, and computed reduced-motion styles.
- The full unit, contract, E2E, syntax, and whitespace gates remain required.

## Non-goals

- A broad visual redesign of Prax.
- Replacing drag-and-drop with a new board interaction model in this pass.
- Activating numerical performance budgets.
- Treating automated reflow checks as a substitute for manual assistive-technology review.
