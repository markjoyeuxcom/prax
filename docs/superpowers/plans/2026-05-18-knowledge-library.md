# Knowledge Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first Knowledge Library slice for Markdown runbooks and notes.

**Architecture:** Markdown documents get their own schema, repository, and route module. The frontend adds Library state, API helpers, renderers, and Admin `.md` import wiring while keeping task workflows intact. Markdown preview is a small escaping renderer rather than a dependency.

**Tech Stack:** Fastify, PostgreSQL, vanilla ES modules, browser File API, Node test runner.

---

### Task 1: Backend Markdown Documents

**Files:**
- Modify: `server/schema.sql`
- Create: `server/libraryRepository.js`
- Create: `server/libraryRoutes.js`
- Modify: `server/index.js`
- Test: `tests/backend/libraryRepository.test.js`
- Test: `tests/backend/libraryRoutes.test.js`

- [ ] Write failing repository tests for create, update, archive, restore, and permanent delete query builders.
- [ ] Write failing route tests for listing, creating, updating, archiving, restoring, permanent delete, and invalid payloads.
- [ ] Implement the schema, repository, route validation, and app registration.
- [ ] Run backend library tests.

### Task 2: Frontend API and Markdown Rendering

**Files:**
- Create: `public/js/libraryApi.js`
- Create: `public/js/markdownPreview.js`
- Test: `tests/frontend/libraryApi.test.js`
- Test: `tests/frontend/markdownPreview.test.js`

- [ ] Write failing API helper tests for list/create/update/archive/restore/permanent delete.
- [ ] Write failing Markdown preview tests for headings, lists, paragraphs, code, and HTML escaping.
- [ ] Implement the helpers and preview renderer.
- [ ] Run focused frontend tests.

### Task 3: Library View UI

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `public/js/state.js`
- Create: `public/js/renderLibrary.js`
- Modify: `public/js/main.js`
- Modify: `public/styles.css`
- Test: `tests/frontend/renderShell.test.js`
- Test: `tests/frontend/renderLibrary.test.js`

- [ ] Write failing tests that shell includes Library navigation.
- [ ] Write failing Library render tests for list, detail, raw mode, empty state, and editor modal.
- [ ] Implement Library view rendering and state wiring.
- [ ] Add create/edit/archive/delete/restore event handling.
- [ ] Run focused frontend tests and syntax check.

### Task 4: Admin Markdown Import

**Files:**
- Modify: `public/js/renderAdminPanel.js`
- Modify: `public/js/main.js`
- Test: `tests/frontend/renderAdminPanel.test.js`

- [ ] Write failing Admin panel test for `data-admin-markdown-file`.
- [ ] Wire `.md` file import to create a Markdown document in the selected context.
- [ ] Run focused Admin tests.

### Task 5: Verification and Commit

**Files:**
- No source changes expected.

- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Run `npm audit --omit=dev`.
- [ ] Restart the fixture server with an in-memory library repository.
- [ ] Browser-smoke Library navigation, new document creation, Admin Markdown import controls, and Markdown preview.
- [ ] Commit the implementation.
