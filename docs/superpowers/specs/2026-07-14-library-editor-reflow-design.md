# Library and Editor Reflow — Design

**Status:** Approved for implementation
**Date:** 2026-07-14
**Quality-standard scope:** Library discovery, document editing, responsive reflow, and zoom

## Problem

The task human-surface pass established a 320 CSS px/400%-equivalent contract for task views, but
the Library and editor still have desktop-only width assumptions. Library cards require at least
275 px inside a narrower main content area. The editor header, formatting toolbar, outline, and
split panes are laid out as fixed horizontal strips. At high zoom or a narrow window those choices
force clipping, horizontal travel, or unusably compressed editing panes.

Document discovery and editing are defining Prax workflows. Their controls and persisted draft
state must remain reachable without requiring a user to zoom out.

## Outcomes

### 1. Library collection reflow

At 320 CSS px the active collection, filters, search, semantic results, and archive remain within
the main content viewport. Search receives a full-width row; action, facet, tag, and progress
controls wrap without being removed. Document cards use one fluid column, and long titles,
ownership, trust, type, tags, and archive actions wrap or truncate within their named container.

### 2. Editor control reflow

The document title and every editor action remain reachable at 320 CSS px. Header metadata and
actions wrap into ordered rows, the formatting toolbar wraps, the footer can grow rather than
clip, and the document-info form stacks its label/control pairs where needed. No action is hidden
solely because of viewport width.

### 3. Narrow editing model

Split mode becomes a vertical edit-then-preview sequence at the narrow breakpoint. Both panes
remain present and retain DOM/keyboard order. The outline becomes a bounded full-width region
above the panes rather than consuming most of the horizontal editing area. Long Markdown/code
lines may scroll inside their dedicated editor/code container; the page itself may not gain a
second horizontal axis.

### 4. Draft and mode preservation

Responsive presentation never changes the document identity, editor mode, title/body draft,
save state, links, or trust metadata. Browser evidence edits a production document while narrow,
switches modes, and verifies the exact title/body through the canonical API.

### 5. Honest evidence boundary

This pass automates the WCAG reference reflow width, control reachability, split-pane order, and a
real narrow editing mutation. It does not claim screen-reader certification, physical-device
coverage, cognitive review, or human visual approval at each intermediate zoom level.

## Gate-A invariants

- Responsive presentation cannot discard, autosubmit, or change a document draft.
- Every named editor/Library action remains in the accessibility tree and keyboard order.
- The narrow split view preserves edit before preview and never duplicates editor controllers.
- Internal scrolling is allowed only for an inherently two-dimensional content region such as a
  long code line; application chrome and ordinary prose reflow.
- Active/archive ownership, trust, type, and lifecycle semantics remain visible.

## Verification

- Production-path Playwright evidence exercises active Library, archive, narrow split editor,
  outline, mode controls, and a real saved edit at 320 CSS px.
- Existing axe, editor recovery, navigation, lifecycle, and performance evidence stays green.
- The full unit, contract, browser, syntax, and whitespace gates remain required.

## Non-goals

- Redesigning the editor information architecture.
- Replacing CodeMirror or the Markdown preview engine.
- Activating a numerical editor-open performance budget.
- Treating browser viewport emulation as manual assistive-technology evidence.
