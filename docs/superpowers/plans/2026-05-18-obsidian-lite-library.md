# Obsidian-Lite Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Knowledge Library into a more capable Markdown editor/preview workspace.

**Architecture:** Keep the existing database and Library API. Upgrade `markdownPreview.js` to support common Markdown patterns while escaping raw HTML. Update `renderLibrary.js` and `main.js` so selected documents can be edited inline in `edit`, `preview`, and `split` modes.

**Tech Stack:** Vanilla ES modules, HTML textarea editor, custom safe Markdown renderer, Node test runner.

---

### Task 1: Richer Markdown Preview

**Files:**
- Modify: `public/js/markdownPreview.js`
- Test: `tests/frontend/markdownPreview.test.js`

- [ ] Write failing tests for blockquotes, inline formatting, inline code, links, ordered lists, task checkboxes, tables, horizontal rules, and fenced code language labels.
- [ ] Run `npm test tests/frontend/markdownPreview.test.js` and confirm failures.
- [ ] Implement the Markdown rendering upgrade while preserving HTML escaping.
- [ ] Run the focused Markdown tests.

### Task 2: Obsidian-Lite Library Renderer

**Files:**
- Modify: `public/js/renderLibrary.js`
- Test: `tests/frontend/renderLibrary.test.js`

- [ ] Write failing tests for `edit`, `preview`, and `split` workspace modes.
- [ ] Assert the editor textarea, save button, dirty-state text, and preview pane render in the correct modes.
- [ ] Implement mode tabs and inline editor layout.
- [ ] Run focused Library render tests.

### Task 3: Inline Editor Wiring

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`

- [ ] Add editor mode and draft state to app state.
- [ ] Wire mode switches, draft updates, save, selected-document changes, and refresh after save.
- [ ] Keep the existing new-document modal for initial creation.
- [ ] Run `npm test` and `npm run check`.

### Task 4: Verification and Commit

**Files:**
- No source changes expected.

- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Run `npm audit --omit=dev`.
- [ ] Browser-smoke `Cloudflare Tunnel Implementation Plan` in Preview and Split mode.
- [ ] Commit the implementation.
