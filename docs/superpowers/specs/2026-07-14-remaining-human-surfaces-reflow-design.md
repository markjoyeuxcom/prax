# Remaining Human Surfaces Reflow — Design

**Status:** Approved for implementation
**Date:** 2026-07-14
**Quality-standard scope:** runbook execution, Settings, and data-transfer dialogs

## Problem

Task and Library/editor workflows now have a 320 CSS px/400%-equivalent reflow contract. Three
important human surfaces remain outside it:

- runbook headers, step timestamps, footer actions, and chronicle actor columns assume desktop
  width;
- Settings rows and Appearance controls include unbroken horizontal groups, especially the full
  accent palette;
- Markdown import and Library export dialogs use desktop body/footer padding around native file
  controls and long action labels.

These surfaces already have correctness and keyboard evidence. The missing clause is whether the
same named controls remain perceivable and operable without zooming out or navigating a second
page-level horizontal axis.

## Outcomes

### 1. Runbook execution reflow

At 320 CSS px an active or terminal run remains inside the main content viewport. The back action,
status, start metadata, post-mortem/copy actions, progress, long steps, actor timestamps, footer
actions, and chronicle all wrap or stack without losing order or meaning. Running a step still uses
the production mutation/readback path.

### 2. Settings reflow

Appearance, Intelligence, and Data & admin each remain one-dimensional at the reference width.
Rows may wrap controls beneath descriptions; segmented controls, theme choices, accent swatches,
provider cards, import controls, maintenance rows, and export actions remain visible, labelled,
and within their settings card. No setting is removed for width.

### 3. Data-transfer dialog reflow

Markdown import and Library export dialogs fit the viewport without their own horizontal scroll.
Headers, selects, native file input, selected-file summaries, scope/destination notices, errors,
and footer actions stay contained. Dialogs retain their existing focus trap, Escape behaviour,
pending lock, exact destination/scope, and safe retry semantics.

### 4. Honest evidence boundary

The pass automates reflow, control reachability, and one production run-step mutation at the WCAG
reference width. It complements, but does not replace, manual screen-reader, cognitive, physical
device, or supported-platform native save-dialog review.

## Gate-A invariants

- Responsive presentation cannot change run status, step identity, event order, settings values,
  import destination, export scope, or retry identity.
- Named controls remain present in DOM and keyboard order; width alone never hides an action.
- Dialogs retain containment, focus return, cancellation, and pending-state locks.
- Page/application chrome reflows; only inherently two-dimensional content may own an internal
  horizontal scroller.
- Long stored titles, filenames, actor labels, and provider descriptions cannot widen the page.

## Verification

- Production-path Playwright evidence covers running runbooks, all three Settings tabs, parsed
  Markdown import state, and Library export destination state at 320 CSS px.
- Existing axe, runbook exact-once/chronicle, settings reconciliation, import retry, export save,
  and dialog keyboard journeys remain green.
- Full unit, contract, browser, syntax, and whitespace gates remain required.

## Non-goals

- Redesigning Settings information architecture.
- Changing runbook lifecycle semantics or dialog destination APIs.
- Claiming browser emulation is physical-device or assistive-technology certification.
- Activating performance budgets.
