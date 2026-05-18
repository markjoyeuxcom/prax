# Library Workspace Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Library view feel like a dedicated Markdown workspace instead of a task dashboard with a narrow document sidebar.

**Architecture:** Keep the current client-rendered modules, but add Library-specific shell and workspace classes. `renderShellHtml` will mark Library mode and omit task metrics; `renderLibraryHtml` will return one workspace container with a compact document navigator and a wide document stage.

**Tech Stack:** Vanilla JavaScript render functions, Node test runner, CSS grid.

---

### Task 1: Shell Layout State

**Files:**
- Modify: `public/js/renderShell.js`
- Test: `tests/frontend/renderShell.test.js`

- [ ] Add a failing test proving Library shell markup uses a Library-specific main class and does not render task metrics.
- [ ] Update `renderShellHtml` so Library receives `console-main--library` and skips the metrics section.
- [ ] Run `npm test -- tests/frontend/renderShell.test.js` and confirm it passes.

### Task 2: Library Workspace Structure

**Files:**
- Modify: `public/js/renderLibrary.js`
- Test: `tests/frontend/renderLibrary.test.js`

- [ ] Add a failing test proving Library renders a single `library-workspace` with `library-browser` and `library-document-stage` children.
- [ ] Update `renderLibraryHtml` so the list and document stage are contained in one dedicated workspace component.
- [ ] Remove duplicate Edit controls in the document header by keeping mode buttons plus archive/restore lifecycle actions.
- [ ] Run `npm test -- tests/frontend/renderLibrary.test.js` and confirm it passes.

### Task 3: Professional Workspace CSS

**Files:**
- Modify: `public/styles.css`

- [ ] Add Library-specific layout styles: full-height workspace, fixed compact browser pane, wide document stage, sticky document toolbar, and balanced split mode.
- [ ] Add responsive CSS so the Library stacks cleanly on narrow screens.
- [ ] Run `npm run check`, `npm test`, `npm audit --omit=dev`, and a browser smoke test on `http://127.0.0.1:3100/`.
