# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Moomora Console frontend in the "Operator Evolved" direction (k9s/htop/btop lineage) while preserving every existing feature and adapting cleanly to desktop, tablet, and mobile.

**Architecture:** Three sequential phases, each fully testable. Phase 1 rewrites the stylesheet and adds the new fonts so the app looks completely different but renderer logic is unchanged. Phase 2 restructures markup (cards instead of table rows, bracketed buttons, new mode toggle, new status footer). Phase 3 adds mobile-specific layout (bottom nav, drill-down, breakpoint helper, CodeMirror theme). Backend API, schema, and tests stay untouched.

**Tech Stack:** Vanilla ES modules, Node's built-in test runner, Fastify (untouched), PostgreSQL (untouched), CodeMirror 6 (theme override), JetBrains Mono + Source Serif Pro (self-hosted WOFF2).

**Design source of truth:** [docs/superpowers/specs/2026-05-19-ui-redesign-design.md](../specs/2026-05-19-ui-redesign-design.md). When this plan says "per spec § Section Name," look there for the locked-in design values (palette tokens, ornament rules, etc).

---

## STAGE-ONLY GIT WORKFLOW

The user has explicitly chosen **stage-only mode**: no `git commit` is to be run during this plan's execution. Every task that would normally end with `git commit -m "..."` instead ends with `git add <paths>` to stage the change for the user's review. At the end of each phase, work pauses for the user to load the app and smoke-test before proceeding to the next phase.

If a step in this plan shows `git commit`, **substitute `git add` for the staging command instead.** When the user lifts the constraint later, the plan can be re-read with commits at the original boundaries.

---

# Phase 1 — Visual Language (stylesheet + fonts)

End-of-phase state: the app looks completely different (operator palette, JetBrains Mono everywhere, bracketed badges, mode tag visible in the status footer) but every feature still works because renderer logic is unchanged. The CodeMirror editor surface is a known intermediate inconsistency until Phase 3.

## Task 1: Add self-hosted fonts

**Files:**
- Create: `public/vendor/fonts/JetBrainsMono-Regular.woff2`
- Create: `public/vendor/fonts/JetBrainsMono-Bold.woff2`
- Create: `public/vendor/fonts/SourceSerifPro-Regular.woff2`

- [ ] **Step 1: Create the fonts directory**

```bash
mkdir -p public/vendor/fonts
```

- [ ] **Step 2: Download JetBrains Mono Regular and Bold**

```bash
curl -L -o public/vendor/fonts/JetBrainsMono-Regular.woff2 \
  https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/webfonts/JetBrainsMono-Regular.woff2
curl -L -o public/vendor/fonts/JetBrainsMono-Bold.woff2 \
  https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/webfonts/JetBrainsMono-Bold.woff2
```

Expected: both files downloaded, ~60-80 KB each.

- [ ] **Step 3: Download Source Serif Pro Regular**

```bash
curl -L -o public/vendor/fonts/SourceSerifPro-Regular.woff2 \
  https://github.com/adobe-fonts/source-serif/raw/release/WOFF2/TTF/SourceSerif4-Regular.otf.woff2
```

Expected: file downloaded, ~50-80 KB.

- [ ] **Step 4: Verify file sizes**

```bash
ls -la public/vendor/fonts/
```

Expected: three `.woff2` files each between 40 KB and 200 KB. If any file is under 1 KB, the URL is wrong — investigate before continuing.

- [ ] **Step 5: Stage**

```bash
git add public/vendor/fonts/
```

## Task 2: Update index.html with font links and cache-busting

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Read current index.html**

```bash
cat public/index.html
```

Expected: small HTML doc with `<link rel="stylesheet" href="/styles.css?v=20260519-moomora">` and a single module script for `main.js`.

- [ ] **Step 2: Replace index.html with the new font-loading version**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Moomora Console</title>
  <style>
    @font-face {
      font-family: "JetBrains Mono";
      src: url("/vendor/fonts/JetBrainsMono-Regular.woff2") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "JetBrains Mono";
      src: url("/vendor/fonts/JetBrainsMono-Bold.woff2") format("woff2");
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Source Serif";
      src: url("/vendor/fonts/SourceSerifPro-Regular.woff2") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
  </style>
  <link rel="stylesheet" href="/styles.css?v=20260519-operator">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/js/main.js?v=20260519-operator"></script>
</body>
</html>
```

- [ ] **Step 3: Stage**

```bash
git add public/index.html
```

## Task 3: Rewrite the stylesheet — palette, typography, base elements

**Files:**
- Modify: `public/styles.css`

This task replaces the entire stylesheet. Because the file is ~1860 lines today and ~1200 lines after, it is rewritten as one cohesive change rather than incremental edits. The rewrite implements every rule in spec § Visual Language and the layout rules in spec § Layout Architecture (excluding mobile-specific behavior, which lands in Phase 3).

- [ ] **Step 1: Back up the current stylesheet (working-tree only, not committed)**

```bash
cp public/styles.css public/styles.css.bak
```

This file is never committed. It exists only so the engineer can `diff` against the old behavior during the rewrite.

- [ ] **Step 2: Write the new styles.css**

The replacement file implements, in this order: CSS reset, `@font-face` references (already in `<style>` block in index.html, so omit here), `:root` custom properties for the 14-token palette, base element rules (`body`, `button`, `input`), shell grid, sidebar, topbar, content header, metrics, workspace, task panel + cards, detail panel, board panel + columns + cards, library workspace, document list, document detail, mode toggle, markdown editor, markdown preview, modal backdrop + task form + admin modal + document info form, status footer, breakpoint media queries (`@media (max-width: 1023px)` and `@media (max-width: 767px)` placeholders that get filled in Phase 3).

Use spec § Visual Language for exact color values and spec § Layout Architecture for grid templates. Class names should preserve every existing class used by `public/js/render*.js` modules so renderer logic doesn't need to change in this phase. Add new class hooks (`.status-footer`, `.mode-tag`, `.priority-stripe`) where the new design needs them but the renderers don't surface them yet.

Concrete rules that must appear in the new file:

```css
:root {
  --bg: #0d0e0f;
  --bg-deep: #08090a;
  --surface: #11140f;
  --surface-warm: #14140f;
  --border: #1f2021;
  --border-dim: #2a2b2c;
  --text: #e7f2d8;
  --text-body: #c8c8c8;
  --text-dim: #7a7d80;
  --text-dimmer: #5a5d60;
  --accent: #87d75f;
  --accent-amber: #d7af5f;
  --accent-cyan: #87afff;
  --danger: #ff5f5f;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text-body);
  font-family: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.45;
}

button, input, textarea, select {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-dim);
  border-radius: 0;
}

button { cursor: pointer; }
:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

a { color: var(--accent-cyan); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Continue building the file following the patterns established in `.superpowers/brainstorm/62803-1779216258/content/components.html` (component reference) and `breakpoints.html` (layout reference). Where a class name exists in current `styles.css` and is still used by current renderers (`.task-row`, `.priority-badge`, `.detail-panel`, `.board-card`, `.board-cards`, `.library-workspace`, `.library-browser`, `.library-detail`, `.document-row`, `.document-pane-header`, `.markdown-toolbar`, `.markdown-tool-button`, `.document-editor`, `.markdown-preview`, `.task-form-modal`, `.admin-modal`, `.modal-backdrop`, `.metric-card`, `.metrics-row`, `.app-shell`, `.sidebar`, `.console-main`, `.topbar`, `.search-field`, `.secondary-action`, `.primary-action`, `.danger-action`, `.icon-action`, `.nav-button`, `.cluster-card`, `.sync-pill`, `.detail-meta`, `.detail-block`, `.detail-header`, `.detail-actions`, `.detail-kicker`, etc), keep the selector and re-style its body. Do not rename existing classes in this phase — renaming is part of Phase 2.

New class hooks to ADD (renderers will start using them in Phase 2; they're styled now so the markup lands ready):
- `.status-footer` (always-visible bottom bar; 28px tall; flex with breadcrumb · sync · mode-tag)
- `.status-footer__breadcrumb`, `.status-footer__sync`, `.status-footer__mode`
- `.mode-tag` (the `<TODAY>` glyph; phosphor color, 0.74rem, weight 700)
- `.priority-stripe` (3px-wide colored left border helper)
- `.bracket-badge` (the `[ HIGH ]` style badge replacement for `.priority-badge`)
- `.bracket-button` (the `[+] new` action button family)
- `.tag-chip--filter` (dashed border filter chip; current `.tag-filter-chip` keeps its existing meaning but adds this modifier in Phase 2)
- `.bottom-nav`, `.bottom-nav__slot`, `.bottom-nav__slot.is-active` (mobile; styled now, rendered Phase 3)
- `.hamburger-drawer`, `.hamburger-drawer__open` (mobile drawer; styled now, rendered Phase 3)

- [ ] **Step 3: Remove the backup file**

```bash
rm public/styles.css.bak
```

- [ ] **Step 4: Syntax check**

```bash
npm run check
```

Expected: exits 0. The check syntax-checks the server, demo server, and `public/js/main.js` — it does not validate CSS, but a passing run confirms no JS was accidentally broken.

- [ ] **Step 5: Verify CSS loads without errors**

```bash
node -e 'import("fs").then(fs => { const css = fs.readFileSync("public/styles.css", "utf8"); console.log("lines:", css.split(/\n/).length); console.log("has --bg token:", css.includes("--bg:")); console.log("has JetBrains Mono:", css.includes("JetBrains Mono")); })'
```

Expected output: a line count around 1100–1300, `has --bg token: true`, `has JetBrains Mono: true`.

- [ ] **Step 6: Stage**

```bash
git add public/styles.css
```

## Task 4: Surface the mode tag, breadcrumb, and bracket topbar buttons in renderShell.js

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `tests/frontend/renderShell.test.js`

The shell currently has a cluster card with status info, but nothing renders the new always-visible status footer with breadcrumb · sync · mode-tag. This task adds the footer at the markup level so Phase 1 produces a visible mode tag with no JS rewiring yet. It also restyles the topbar's two primary actions (`Admin` → `[a] admin`, `New Task`/`New Document` → `[+] new`) to the bracket-button pattern, since they live in the same renderer.

- [ ] **Step 1: Read the current renderShell.js**

```bash
sed -n '1,200p' public/js/renderShell.js
```

Familiarize with the existing `renderShellHtml({ activeContext, activeView, apiStatus, searchQuery, metrics })` signature.

- [ ] **Step 2: Read the current renderShell.test.js**

```bash
sed -n '1,200p' tests/frontend/renderShell.test.js
```

- [ ] **Step 3: Add failing tests for the status footer and bracket topbar buttons**

Append to `tests/frontend/renderShell.test.js`:

```js
test('shell renders a status footer with breadcrumb, sync, and mode tag', () => {
  const html = renderShellHtml({
    activeContext: 'homelab',
    activeView: 'list',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="status-footer"/);
  assert.match(html, /class="status-footer__breadcrumb"/);
  assert.match(html, /moomora.*today.*homelab/i);
  assert.match(html, /class="status-footer__sync"/);
  assert.match(html, /class="status-footer__mode">&lt;TODAY&gt;/);
});

test('shell topbar renders bracket-style Admin and primary action buttons', () => {
  const html = renderShellHtml({
    activeContext: 'homelab',
    activeView: 'list',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /data-action="open-admin"[^>]*class="bracket-button[^"]*"[^>]*>\[a\] admin/);
  assert.match(html, /data-action="new-task"[^>]*class="bracket-button bracket-button--primary"[^>]*>\[\+\] new/);
});

test('shell topbar primary action becomes new-document on library view', () => {
  const html = renderShellHtml({
    activeContext: 'homelab',
    activeView: 'library',
    apiStatus: 'connected',
    searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /data-action="new-document"[^>]*>\[\+\] new doc/);
});
```

- [ ] **Step 4: Run the test to confirm it fails**

```bash
node --test tests/frontend/renderShell.test.js
```

Expected: the new test fails with "no match for `class="status-footer"`".

- [ ] **Step 5: Update renderShell.js**

First, update the topbar action buttons. Find the existing block:

```js
<button class="secondary-action" type="button" data-action="open-admin">Admin</button>
<button class="primary-action" type="button" data-action="${primaryAction.action}">${primaryAction.label}</button>
```

Replace with:

```js
<button class="bracket-button" type="button" data-action="open-admin">[a] admin</button>
<button class="bracket-button bracket-button--primary" type="button" data-action="${primaryAction.action}">[+] ${primaryAction.label === 'New Document' ? 'new doc' : 'new'}</button>
```

The `primaryAction.label` check preserves the existing primaryAction.action dispatch (new-task vs new-document) while presenting both as `[+] new` or `[+] new doc`.

Then, in `renderShellHtml`, add a helper:

```js
function modeTagFor(activeView) {
  const tags = {
    list: 'TODAY',
    board: 'BOARD',
    backlog: 'BACKLOG',
    archive: 'ARCHIVE',
    library: 'LIBRARY',
  };
  return tags[activeView] || activeView.toUpperCase();
}

function syncLabelFor(apiStatus) {
  if (apiStatus === 'error') return '<span class="sync-dots sync-dots--off">●○○</span> offline';
  if (apiStatus === 'loading') return '<span class="sync-dots sync-dots--pending">●●○</span> syncing';
  return '<span class="sync-dots sync-dots--ok">●●●</span> ok';
}
```

Then immediately before the closing `</main>` of the main element, render:

```js
const statusFooterHtml = `
        <footer class="status-footer" aria-label="Console status">
          <span class="status-footer__breadcrumb">moomora <span class="status-footer__slash">/</span> ${escapeHtml(activeViewConfig.id)} <span class="status-footer__slash">/</span> <strong>${escapeHtml(activeContext)}</strong></span>
          <span class="status-footer__sync">${syncLabelFor(apiStatus)}</span>
          <span class="status-footer__mode">&lt;${escapeHtml(modeTagFor(activeView))}&gt;</span>
        </footer>`;
```

Insert `${statusFooterHtml}` after the workspace `<div>` and before `</main>` in the template literal returned from `renderShellHtml`.

- [ ] **Step 6: Run the failing test — expect it to pass**

```bash
node --test tests/frontend/renderShell.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Stage**

```bash
git add public/js/renderShell.js tests/frontend/renderShell.test.js
```

## Task 5: Update broken render tests caused by class-name changes

**Files:**
- Modify: `tests/frontend/*.test.js` (whichever fail)

Phase 1 may have broken tests that asserted on the literal text "Inter", border-radius pixel values, or other current-stylesheet specifics that no longer apply.

- [ ] **Step 1: Run the full frontend test suite**

```bash
npm test -- tests/frontend
```

Expected: most tests pass. Any failures will fall into one of these categories: (a) tests asserting on literal CSS class names that the renderers don't actually use; (b) tests that broke for some other reason.

- [ ] **Step 2: For each failing test, read the test and the assertion**

For each failure:

```bash
# Example
sed -n 'FAILING_LINE-5,FAILING_LINE+5p' tests/frontend/<failing-test>.test.js
```

Identify whether the test is asserting on something the redesign legitimately removed (in which case update the assertion to match the new contract) or on something that should still work (in which case the implementation broke something — fix the implementation, not the test).

- [ ] **Step 3: Update each failing test in place**

For each test that needs updating, edit the assertion to match the new markup or class names. Keep the *intent* of the test — only the assertion details change.

- [ ] **Step 4: Re-run the full suite**

```bash
npm test
```

Expected: all backend tests still pass, all frontend tests pass.

- [ ] **Step 5: Stage any test updates**

```bash
git add tests/frontend/
```

## Task 6: Phase 1 smoke test pause

**Files:** none.

- [ ] **Step 1: Final verification commands**

```bash
npm run check
npm test
```

Expected: both exit 0.

- [ ] **Step 2: Start the demo server**

```bash
npm run demo
```

Expected: server starts on `http://127.0.0.1:3100/`.

- [ ] **Step 3: Manually verify in a browser**

Open `http://127.0.0.1:3100/` and confirm:
- The page renders with the new operator palette (dark `#0d0e0f`, phosphor green accents).
- All text is in JetBrains Mono (mono everywhere).
- The status footer at the bottom shows `moomora / list / homelab`, a sync state with `●●●`, and a `<TODAY>` mode tag on the right.
- Switching context (Personal / Work / Homelab) updates the breadcrumb.
- Switching view (Today / Board / Backlog / Archive / Library) updates the mode tag.
- All existing functionality (creating tasks, editing, archiving, library document list, admin panel) still works — even though some components still look "old" (cards aren't introduced until Phase 2).

The CodeMirror editor inside Library/edit mode still has its current off-theme appearance; this is expected and is fixed in Phase 3.

- [ ] **Step 4: Stop the demo server (Ctrl+C in its terminal) and report to the user**

Report message:

> Phase 1 complete. Working tree contains: `public/vendor/fonts/` (3 WOFF2 files), `public/index.html` (font links + cache-bust), `public/styles.css` (full rewrite to operator palette and typography), `public/js/renderShell.js` and its test (status footer + mode tag). All changes staged via `git add`, no commits made. Smoke test confirmed: app renders with the new visual language, all features work, CodeMirror editor still uses its old theme as expected. Awaiting approval to proceed to Phase 2.

---

# Phase 2 — Component Restructure

End-of-phase state: every desktop view uses the new component patterns from the spec. Task list is cards, badges are bracketed, actions are bracket-prefixed buttons, library uses the new mode toggle, admin uses glyph radios. Mobile/tablet layouts are not yet adapted — that's Phase 3.

## Task 7: Convert task list rows to cards

**Files:**
- Modify: `public/js/renderList.js`
- Modify: `tests/frontend/renderList.test.js`

Replace the table-row markup with the task card pattern from spec § Component Patterns > Cards.

- [ ] **Step 1: Read the current renderList.js**

```bash
sed -n '1,150p' public/js/renderList.js
```

- [ ] **Step 2: Read the current renderList.test.js**

```bash
sed -n '1,150p' tests/frontend/renderList.test.js
```

- [ ] **Step 3: Update tests to expect the new card markup**

Replace the test that checks for `.task-row` markup with one that checks for `.task-card`:

```js
test('list renders a task card with priority stripe and bracket badge', () => {
  const tasks = [{
    id: 'aaa', title: 'Back up CNPG',
    description: 'Verify backup schedule',
    priority: 'high', status: 'planned', context: 'homelab',
    dueDate: '2026-05-19', sortOrder: 0,
  }];
  const html = renderListHtml(tasks, 'aaa', {
    title: 'Today', countLabel: 'active tasks',
    emptyTitle: '', emptyDescription: '',
  });
  assert.match(html, /class="task-card[^"]*task-card--hi[^"]*"/);
  assert.match(html, /class="task-card[^"]*is-selected"/);
  assert.match(html, /class="bracket-badge bracket-badge--hi">\[ HIGH \]/);
  assert.match(html, /Back up CNPG/);
  assert.match(html, /due 2026-05-19/);
});

test('list renders empty state in bracketed form', () => {
  const html = renderListHtml([], null, {
    title: 'Today', countLabel: 'active',
    emptyTitle: 'No tasks',
    emptyDescription: 'Add work to see it here.',
  });
  assert.match(html, /class="task-list--empty"/);
  assert.match(html, /\[ no tasks \]/i);
});
```

- [ ] **Step 4: Run tests to confirm failure**

```bash
node --test tests/frontend/renderList.test.js
```

Expected: tests fail because `task-card` and `bracket-badge` classes aren't emitted yet.

- [ ] **Step 5: Rewrite renderList.js**

Replace the row-based body with a card-based body:

```js
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function priorityClass(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'hi';
  if (p === 'low') return 'lo';
  return 'md';
}

function priorityLabel(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'HIGH';
  if (p === 'low') return 'LOW';
  return 'MED';
}

function renderCard(task, selectedTaskId) {
  const isSelected = task.id === selectedTaskId;
  const pClass = priorityClass(task.priority);
  const pLabel = priorityLabel(task.priority);
  const desc = task.description || '';
  const due = task.dueDate ? `due <strong>${escapeHtml(task.dueDate)}</strong>` : 'no due';
  const status = String(task.status || 'planned').replace(/-/g, ' ');
  const tags = (task.tags || []).filter(Boolean);
  const tagLine = tags.length
    ? `<div class="task-card__tags">${tags.map(t => `#${escapeHtml(t)}`).join(' ')}</div>`
    : '';

  return `
    <button class="task-card task-card--${pClass}${isSelected ? ' is-selected' : ''}" type="button" data-task-id="${escapeHtml(task.id)}"${isSelected ? ' aria-current="true"' : ''}>
      <div class="task-card__line1">
        <strong class="task-card__title">${escapeHtml(task.title || 'Untitled task')}</strong>
        <span class="bracket-badge bracket-badge--${pClass}">[ ${pLabel} ]</span>
      </div>
      <div class="task-card__line2">${escapeHtml(status)} · ${due}${desc ? ` · ${escapeHtml(desc)}` : ''}</div>
      ${tagLine}
    </button>`;
}

function renderCards(tasks, selectedTaskId, emptyTitle, emptyDescription) {
  if (!tasks.length) {
    return `
      <div class="task-list--empty" role="status">
        <strong>[ ${escapeHtml(emptyTitle || 'no tasks').toLowerCase()} ]</strong>
        <span>${escapeHtml(emptyDescription || '')}</span>
      </div>`;
  }
  return tasks.map(t => renderCard(t, selectedTaskId)).join('');
}

export function renderListHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const title = options.title || 'Task Queue';
  const countLabel = options.countLabel || 'active tasks';

  return `
    <section class="task-panel" aria-labelledby="task-queue-title">
      <header class="panel-header">
        <div>
          <h2 id="task-queue-title">${escapeHtml(title)}</h2>
          <p>${safeTasks.length} ${escapeHtml(countLabel)}</p>
        </div>
      </header>
      <div class="task-list">${renderCards(safeTasks, selectedTaskId, options.emptyTitle, options.emptyDescription)}
      </div>
    </section>`;
}
```

- [ ] **Step 6: Run tests to confirm pass**

```bash
node --test tests/frontend/renderList.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Stage**

```bash
git add public/js/renderList.js tests/frontend/renderList.test.js
```

## Task 8: Convert task detail panel

**Files:**
- Modify: `public/js/renderTaskDetail.js`
- Modify: `tests/frontend/renderTaskDetail.test.js`

Replace pill badges and rounded buttons with bracketed badges and bracket-prefixed action buttons. Add a breadcrumb in the header.

- [ ] **Step 1: Read renderTaskDetail.js**

```bash
sed -n '1,120p' public/js/renderTaskDetail.js
```

- [ ] **Step 2: Read renderTaskDetail.test.js**

```bash
sed -n '1,120p' tests/frontend/renderTaskDetail.test.js
```

- [ ] **Step 3: Update tests to expect bracket-style actions**

Add or modify tests to assert:

```js
test('detail renders bracketed action buttons for an active task', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'medium', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, {});
  assert.match(html, /data-action="edit-task"[^>]*>\[e\] edit/);
  assert.match(html, /data-action="archive-task"[^>]*>\[d\] archive/);
});

test('detail renders restore and delete for archived tasks', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'low', status: 'planned', dueDate: null, archivedAt: '2026-05-01' };
  const html = renderTaskDetailHtml(task, { readOnly: true, restoreAction: true, deleteAction: true });
  assert.match(html, /data-action="restore-task"[^>]*>\[r\] restore/);
  assert.match(html, /data-action="delete-archived-task"[^>]*>\[!\] delete/);
});
```

- [ ] **Step 4: Run tests to confirm failure**

```bash
node --test tests/frontend/renderTaskDetail.test.js
```

Expected: tests fail because action labels aren't bracketed.

- [ ] **Step 5: Rewrite renderTaskDetailHtml**

Replace the action button block:

```js
function priorityClass(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'hi';
  if (p === 'low') return 'lo';
  return 'md';
}

function priorityLabel(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'HIGH';
  if (p === 'low') return 'LOW';
  return 'MED';
}

function actionsFor(options) {
  const readOnly = Boolean(options.readOnly);
  const restoreAction = Boolean(options.restoreAction);
  const deleteAction = Boolean(options.deleteAction);
  if (restoreAction) {
    return `
        <div class="detail-actions">
          <button class="bracket-button bracket-button--quiet" type="button" data-action="restore-task">[r] restore</button>
          ${deleteAction ? '<button class="bracket-button bracket-button--danger" type="button" data-action="delete-archived-task">[!] delete</button>' : ''}
        </div>`;
  }
  if (readOnly) return '';
  return `
        <div class="detail-actions">
          <button class="bracket-button" type="button" data-action="edit-task">[e] edit</button>
          <button class="bracket-button bracket-button--danger" type="button" data-action="archive-task">[d] archive</button>
        </div>`;
}
```

Use `actionsFor(options)` inside the existing template literal where action buttons render. Also wrap the priority value in the detail meta in a `bracket-badge` of the corresponding priority class.

- [ ] **Step 6: Run tests to confirm pass**

```bash
node --test tests/frontend/renderTaskDetail.test.js
```

Expected: all pass.

- [ ] **Step 7: Stage**

```bash
git add public/js/renderTaskDetail.js tests/frontend/renderTaskDetail.test.js
```

## Task 9: Convert task form modal

**Files:**
- Modify: `public/js/renderTaskForm.js`
- Modify: `tests/frontend/renderTaskForm.test.js`

Update form actions to bracket-prefixed buttons (`[s] save`, `cancel`).

- [ ] **Step 1: Update test expectations**

```js
test('form renders bracketed save button and quiet cancel', () => {
  const html = renderTaskFormHtml({ task: null, activeContext: 'homelab', error: '', isSaving: false });
  assert.match(html, /data-action="close-task-form"[^>]*>cancel/);
  assert.match(html, /type="submit"[^>]*>\[s\] save/);
});

test('form save button disabled while saving', () => {
  const html = renderTaskFormHtml({ task: null, activeContext: 'homelab', error: '', isSaving: true });
  assert.match(html, /type="submit"[^>]* disabled[^>]*>\[s\] saving\.\.\./);
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
node --test tests/frontend/renderTaskForm.test.js
```

Expected: failures because button text is "Save Task" / "Cancel", not bracket-prefixed.

- [ ] **Step 3: Update renderTaskFormHtml**

In the `<footer class="task-form-actions">` block, replace:

```js
<footer class="task-form-actions">
  <button class="bracket-button bracket-button--quiet" type="button" data-action="close-task-form">cancel</button>
  <button class="bracket-button bracket-button--primary" type="submit"${isSaving ? ' disabled' : ''}>${isSaving ? '[s] saving...' : '[s] save'}</button>
</footer>
```

Also replace input wrapper class names with the new operator-style hooks (use `task-form__field` for each label wrapper if you've defined that class in CSS). If the existing classes work with the new stylesheet, leave them.

- [ ] **Step 4: Run tests to confirm pass**

```bash
node --test tests/frontend/renderTaskForm.test.js
```

- [ ] **Step 5: Stage**

```bash
git add public/js/renderTaskForm.js tests/frontend/renderTaskForm.test.js
```

## Task 10: Convert admin panel — bracket sections + glyph radios

**Files:**
- Modify: `public/js/renderAdminPanel.js`
- Modify: `tests/frontend/renderAdminPanel.test.js`

Replace native radio buttons with `(•)` / `( )` glyph spans and bracket-style action buttons.

- [ ] **Step 1: Update tests to expect glyph-based radios**

```js
test('admin radio group uses glyph indicators not native radios', () => {
  const html = renderAdminPanelHtml({ activeContext: 'homelab', taskCount: 3, importMode: 'skip' });
  assert.match(html, /data-action="open-archive"[^>]*>\[a\] open archive/i);
  assert.match(html, /class="radio-glyph[^"]*is-active"[^>]*>\(•\)/);
  assert.match(html, /class="radio-glyph"[^>]*>\( \)/);
});
```

- [ ] **Step 2: Run tests — confirm failures**

```bash
node --test tests/frontend/renderAdminPanel.test.js
```

- [ ] **Step 3: Update renderAdminPanelHtml**

Native radio inputs MUST remain (they're functionally bound by main.js). Wrap each radio with a sibling glyph span and hide the native input visually:

```js
function radioLine(mode, label, importMode) {
  const isActive = mode === importMode;
  return `
    <label class="admin-mode-line${isActive ? ' is-active' : ''}">
      <input type="radio" name="admin-import-mode" value="${mode}" data-admin-import-mode="${mode}" class="admin-mode-line__input"${isActive ? ' checked' : ''}>
      <span class="radio-glyph${isActive ? ' is-active' : ''}">${isActive ? '(•)' : '( )'}</span>
      <span class="admin-mode-line__label">${label}</span>
    </label>`;
}
```

Use `radioLine('skip', 'skip duplicates', importMode)` etc. Replace `<button data-action="open-archive">Open Archive</button>` with `<button class="bracket-button" data-action="open-archive">[a] open archive</button>`. Apply similar bracket treatment to all export buttons (`[x] export <ctx>`, `[X] export all`).

CSS for `.admin-mode-line__input` must include `.sr-only` styling (it's already in the stylesheet — verify) or new `position: absolute; opacity: 0; pointer-events: none;` to hide the native radio while keeping it focusable.

- [ ] **Step 4: Run tests to confirm pass**

```bash
node --test tests/frontend/renderAdminPanel.test.js
```

- [ ] **Step 5: Stage**

```bash
git add public/js/renderAdminPanel.js tests/frontend/renderAdminPanel.test.js
```

## Task 11: Convert board cards and column headers

**Files:**
- Modify: `public/js/renderBoard.js`
- Modify: `tests/frontend/renderBoard.test.js`

Compact board card with priority stripe, bracketed column header, count in amber.

- [ ] **Step 1: Update tests**

```js
test('board column header is bracketed and shows count', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'high', status: 'high-priority', sortOrder: 0 }];
  const html = renderBoardHtml(tasks, 'a');
  assert.match(html, /class="board-column__header"/);
  assert.match(html, /\[ HIGH PRIORITY \]/);
  assert.match(html, /class="board-column__count">1/);
});

test('board card uses bracket card markup with priority stripe', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'high', status: 'in-progress', sortOrder: 0, dueDate: '2026-05-19' }];
  const html = renderBoardHtml(tasks, 'a');
  assert.match(html, /class="board-card board-card--hi is-selected"/);
  assert.match(html, /2026-05-19/);
});
```

- [ ] **Step 2: Run — expect failures**

```bash
node --test tests/frontend/renderBoard.test.js
```

- [ ] **Step 3: Rewrite renderBoardHtml**

```js
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COLUMNS = [
  { id: 'high-priority', label: 'HIGH PRIORITY' },
  { id: 'in-progress',   label: 'IN PROGRESS' },
  { id: 'planned',       label: 'PLANNED' },
  { id: 'completed',     label: 'COMPLETED' },
  { id: 'notes',         label: 'NOTES' },
];

function priorityClass(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'hi';
  if (p === 'low') return 'lo';
  return 'md';
}

function renderCard(task, selectedTaskId) {
  const pClass = priorityClass(task.priority);
  const isSel = task.id === selectedTaskId;
  return `
        <button class="board-card board-card--${pClass}${isSel ? ' is-selected' : ''}" type="button" data-board-card="true" data-task-id="${escapeHtml(task.id)}" draggable="true"${isSel ? ' aria-current="true"' : ''}>
          <strong class="board-card__title">${escapeHtml(task.title || 'Untitled task')}</strong>
          <span class="board-card__meta">${escapeHtml(String(task.priority || 'medium'))} · ${escapeHtml(task.dueDate || '—')}</span>
        </button>`;
}

function renderColumnCards(tasks, columnId, selectedTaskId) {
  const columnTasks = tasks
    .filter(t => (t.status || t.column || 'planned') === columnId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (!columnTasks.length) return '<div class="board-empty">[ no cards ]</div>';
  return columnTasks.map(t => renderCard(t, selectedTaskId)).join('');
}

export function renderBoardHtml(tasks = [], selectedTaskId = null) {
  const safe = Array.isArray(tasks) ? tasks : [];
  return `
    <section class="board-panel" aria-label="Task board">
      ${COLUMNS.map(col => `
        <section class="board-column" aria-label="${col.label}" data-board-column="${col.id}">
          <header class="board-column__header">
            <h2 class="board-column__title">[ ${col.label} ]</h2>
            <span class="board-column__count">${safe.filter(t => (t.status || t.column || 'planned') === col.id).length}</span>
          </header>
          <div class="board-cards" data-board-column="${col.id}">${renderColumnCards(safe, col.id, selectedTaskId)}
          </div>
        </section>`).join('')}
    </section>`;
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
node --test tests/frontend/renderBoard.test.js
```

- [ ] **Step 5: Stage**

```bash
git add public/js/renderBoard.js tests/frontend/renderBoard.test.js
```

## Task 12: Convert library mode toggle

**Files:**
- Modify: `public/js/renderLibrary.js`
- Modify: `tests/frontend/renderLibrary.test.js`

Replace the three `secondary-action` mode buttons with a `modes` segmented control. Bracket-style action buttons for archive/restore/delete/info.

- [ ] **Step 1: Update tests**

```js
test('library renders a segmented mode toggle with active state', () => {
  const docs = [{ id: 'a', title: 'Doc', body: '', documentType: 'note', context: 'homelab', tags: [], sourceFilename: null }];
  const html = renderLibraryHtml({
    documents: docs, selectedDocumentId: 'a',
    editorMode: 'split', draftBody: '', isDirty: false,
    availableTags: [], activeTags: [], tagQuery: '',
    areTagsExpanded: false, savedViews: [], activeSavedViewId: null,
    isInfoEditing: false, infoError: '', isSaving: false,
    saveStatus: 'Saved', isFocusMode: false,
  });
  assert.match(html, /class="modes"/);
  assert.match(html, /data-library-mode="split"[^>]*class="[^"]*on"/);
});

test('library actions use bracket buttons', () => {
  const docs = [{ id: 'a', title: 'Doc', body: '', documentType: 'note', context: 'homelab', tags: [], sourceFilename: null }];
  const html = renderLibraryHtml({
    documents: docs, selectedDocumentId: 'a', editorMode: 'preview',
    draftBody: '', isDirty: false, availableTags: [], activeTags: [],
    tagQuery: '', areTagsExpanded: false, savedViews: [],
    activeSavedViewId: null, isInfoEditing: false, infoError: '',
    isSaving: false, saveStatus: 'Saved', isFocusMode: false,
  });
  assert.match(html, /data-action="archive-document"[^>]*>\[d\] archive/);
  assert.match(html, /data-action="edit-document-info"[^>]*>\[i\] info/);
});
```

- [ ] **Step 2: Run — expect failures**

```bash
node --test tests/frontend/renderLibrary.test.js
```

- [ ] **Step 3: Replace `renderModeButton` and its usages**

In `renderLibrary.js`, replace the existing `renderModeButton` helper with a segmented renderer:

```js
function renderModes(editorMode, modes = ['edit', 'preview', 'split']) {
  return `
        <div class="modes" role="tablist" aria-label="Editor mode">
          ${modes.map(mode => `<button class="${mode === editorMode ? 'on' : ''}" role="tab" type="button" data-library-mode="${mode}" aria-selected="${mode === editorMode}">${mode}</button>`).join('')}
        </div>`;
}
```

Replace the three lines that call `renderModeButton('edit', ...)`, `renderModeButton('preview', ...)`, `renderModeButton('split', ...)` with a single `${renderModes(editorMode)}` call.

For the archive/restore/delete/info actions, swap `secondary-action` and `danger-action` classes for `bracket-button` and prepend the bracketed prefix:

```js
${isArchived ? '' : '<button class="bracket-button" type="button" data-action="edit-document-info">[i] info</button>'}
${isArchived ? `
<button class="bracket-button" type="button" data-action="restore-document">[r] restore</button>
<button class="bracket-button bracket-button--danger" type="button" data-action="delete-archived-document">[!] delete</button>` : `
<button class="bracket-button bracket-button--danger" type="button" data-action="archive-document">[d] archive</button>`}
```

Apply similar `[s] save` treatment in `renderEditorPane`'s save button.

- [ ] **Step 4: Run tests to confirm pass**

```bash
node --test tests/frontend/renderLibrary.test.js
```

- [ ] **Step 5: Stage**

```bash
git add public/js/renderLibrary.js tests/frontend/renderLibrary.test.js
```

## Task 13: Phase 2 smoke test pause

**Files:** none.

- [ ] **Step 1: Run full verification**

```bash
npm run check
npm test
```

Expected: both exit 0.

- [ ] **Step 2: Restart demo server and smoke-test**

```bash
npm run demo
```

Open `http://127.0.0.1:3100/` and confirm:
- Today / Backlog / Archive show task cards with priority stripes and bracketed badges.
- Task detail panel shows `[e] edit · [d] archive` (or `[r] restore · [!] delete` for archived tasks).
- Board columns have `[ HIGH PRIORITY ]` style headers with amber counts.
- Library has a `[edit][split][preview]` segmented toggle that highlights the active mode.
- Admin panel uses `(•)` / `( )` radios and `[a] open archive`, `[x] export <ctx>` style buttons.
- All CRUD still works: create / edit / archive / restore / permanently delete / drag a board card / import a JSON file / change import mode.

- [ ] **Step 3: Stop the server and report to the user**

> Phase 2 complete. Working tree updated: renderList, renderTaskDetail, renderTaskForm, renderAdminPanel, renderBoard, renderLibrary and their tests. All changes staged. Smoke test confirmed: desktop redesign is complete, all features work. Mobile/tablet still uses desktop layout (Phase 3 fixes). Awaiting approval to proceed to Phase 3.

---

# Phase 3 — Mobile and Breakpoint Adaptation

End-of-phase state: full redesign complete on all three breakpoints. CodeMirror uses the operator theme. All tests pass.

## Task 14: Create breakpoints helper module

**Files:**
- Create: `public/js/breakpoints.js`
- Create: `tests/frontend/breakpoints.test.js`

A small helper that exports `isMobile()`, `isTablet()`, `isDesktop()`, and `onBreakpointChange(callback)`.

- [ ] **Step 1: Write the failing test first**

Create `tests/frontend/breakpoints.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set up a minimal matchMedia mock before importing the module
const listeners = new Map();
let currentWidth = 1200;

globalThis.window = {
  matchMedia(query) {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    const obj = {
      matches: currentWidth >= min,
      addEventListener(_event, cb) { listeners.set(query, cb); },
      removeEventListener() {},
    };
    return obj;
  },
};

const { isMobile, isTablet, isDesktop, onBreakpointChange } = await import('../../public/js/breakpoints.js');

test('isDesktop true above 1024px', () => {
  currentWidth = 1200;
  assert.equal(isDesktop(), true);
  assert.equal(isTablet(), false);
  assert.equal(isMobile(), false);
});

test('isTablet true between 768 and 1023', () => {
  currentWidth = 900;
  assert.equal(isDesktop(), false);
  assert.equal(isTablet(), true);
  assert.equal(isMobile(), false);
});

test('isMobile true below 768', () => {
  currentWidth = 360;
  assert.equal(isDesktop(), false);
  assert.equal(isTablet(), false);
  assert.equal(isMobile(), true);
});

test('onBreakpointChange invokes callback when band changes', () => {
  currentWidth = 1200;
  const calls = [];
  const stop = onBreakpointChange(band => calls.push(band));
  currentWidth = 800;
  listeners.get('(min-width: 1024px)')({ matches: false });
  assert.deepEqual(calls.at(-1), 'tablet');
  currentWidth = 360;
  listeners.get('(min-width: 768px)')({ matches: false });
  assert.deepEqual(calls.at(-1), 'mobile');
  stop();
});
```

- [ ] **Step 2: Run — expect import failure**

```bash
node --test tests/frontend/breakpoints.test.js
```

Expected: error because `public/js/breakpoints.js` does not exist.

- [ ] **Step 3: Implement the helper**

Create `public/js/breakpoints.js`:

```js
const DESKTOP_QUERY = '(min-width: 1024px)';
const TABLET_QUERY  = '(min-width: 768px)';

function safeMatch(query) {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

export function isDesktop() {
  return safeMatch(DESKTOP_QUERY);
}

export function isTablet() {
  return !isDesktop() && safeMatch(TABLET_QUERY);
}

export function isMobile() {
  return !safeMatch(TABLET_QUERY);
}

export function currentBand() {
  if (isDesktop()) return 'desktop';
  if (isTablet()) return 'tablet';
  return 'mobile';
}

export function onBreakpointChange(callback) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  let lastBand = currentBand();
  const desktopMql = window.matchMedia(DESKTOP_QUERY);
  const tabletMql = window.matchMedia(TABLET_QUERY);
  const handler = () => {
    const band = currentBand();
    if (band !== lastBand) {
      lastBand = band;
      callback(band);
    }
  };
  desktopMql.addEventListener('change', handler);
  tabletMql.addEventListener('change', handler);
  return () => {
    desktopMql.removeEventListener('change', handler);
    tabletMql.removeEventListener('change', handler);
  };
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
node --test tests/frontend/breakpoints.test.js
```

Expected: 4 passes.

- [ ] **Step 5: Stage**

```bash
git add public/js/breakpoints.js tests/frontend/breakpoints.test.js
```

## Task 15: Add bottom nav rendering

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `tests/frontend/renderShell.test.js`

The shell always renders the bottom nav markup; CSS hides it on tablet/desktop. This avoids JS rendering branches per breakpoint.

- [ ] **Step 1: Add failing test for bottom nav**

```js
test('shell renders bottom nav with 5 slots and active state', () => {
  const html = renderShellHtml({
    activeContext: 'homelab', activeView: 'library',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
  });
  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /data-bottom-nav="library"[^>]*class="[^"]*is-active"/);
  assert.match(html, /data-bottom-nav="new"/);
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
node --test tests/frontend/renderShell.test.js
```

- [ ] **Step 3: Add bottom nav HTML to renderShellHtml**

Add helper:

```js
function renderBottomNav(activeView) {
  const slots = [
    { key: 'list',    glyph: 'T', label: 'today',   view: 'list' },
    { key: 'board',   glyph: 'B', label: 'board',   view: 'board' },
    { key: 'new',     glyph: '+', label: '',        view: null },
    { key: 'library', glyph: 'L', label: 'library', view: 'library' },
    { key: 'archive', glyph: 'A', label: 'arch',    view: 'archive' },
  ];
  return `
        <nav class="bottom-nav" aria-label="Primary">
          ${slots.map(slot => {
            const isActive = slot.view && slot.view === activeView;
            const action = slot.key === 'new' ? 'data-action="new-task"' : `data-view="${slot.view}"`;
            return `<button class="bottom-nav__slot${isActive ? ' is-active' : ''}${slot.key === 'new' ? ' bottom-nav__slot--add' : ''}" type="button" data-bottom-nav="${slot.key}" ${action}>
              <span class="bottom-nav__glyph">${slot.glyph}</span>
              <span class="bottom-nav__label">${slot.label}</span>
            </button>`;
          }).join('')}
        </nav>`;
}
```

In `renderShellHtml`, insert `${renderBottomNav(activeView)}` directly before the closing `</div>` of `app-shell` so it lives at the shell root (CSS positions it `position: fixed; bottom: 0;` on mobile via media queries already added in Phase 1).

- [ ] **Step 4: Run tests to confirm pass**

```bash
node --test tests/frontend/renderShell.test.js
```

- [ ] **Step 5: Stage**

```bash
git add public/js/renderShell.js tests/frontend/renderShell.test.js
```

## Task 16: Add hamburger drawer

**Files:**
- Modify: `public/js/renderShell.js`
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`
- Modify: `tests/frontend/renderShell.test.js`

Drawer holds Backlog link, Admin trigger, Contexts switcher, Cluster card. Always rendered; CSS hides it on desktop.

- [ ] **Step 1: Add failing test**

```js
test('shell renders hamburger drawer with backlog, admin, contexts', () => {
  const html = renderShellHtml({
    activeContext: 'homelab', activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
    isDrawerOpen: false,
  });
  assert.match(html, /class="hamburger-drawer"/);
  assert.match(html, /data-view="backlog"/);
  assert.match(html, /data-action="open-admin"/);
  assert.match(html, /data-context="personal"/);
});

test('shell drawer is open when isDrawerOpen is true', () => {
  const html = renderShellHtml({
    activeContext: 'homelab', activeView: 'list',
    apiStatus: 'connected', searchQuery: '',
    metrics: { dueToday: 0, overdue: 0, inProgress: 0, completedThisWeek: 0 },
    isDrawerOpen: true,
  });
  assert.match(html, /class="hamburger-drawer is-open"/);
});
```

- [ ] **Step 2: Run — failure expected**

```bash
node --test tests/frontend/renderShell.test.js
```

- [ ] **Step 3: Add hamburger trigger + drawer HTML**

In `renderShellHtml`, add a hamburger button to the topbar (before the search field, mobile/tablet visible via CSS):

```js
<button class="hamburger-trigger" type="button" data-action="toggle-drawer" aria-label="Menu">≡</button>
```

Add drawer markup (also always rendered, CSS positions it as a slide-in):

```js
function renderHamburgerDrawer({ activeContext, isDrawerOpen, apiStatus }) {
  return `
    <aside class="hamburger-drawer${isDrawerOpen ? ' is-open' : ''}" aria-label="Secondary navigation"${isDrawerOpen ? '' : ' aria-hidden="true"'}>
      <header class="hamburger-drawer__header">
        <span class="hamburger-drawer__title">// MENU</span>
        <button class="hamburger-drawer__close" type="button" data-action="toggle-drawer" aria-label="Close menu">×</button>
      </header>
      <div class="hamburger-drawer__group">
        <p class="hamburger-drawer__label">// VIEWS</p>
        <button class="hamburger-drawer__item" type="button" data-view="backlog">backlog</button>
      </div>
      <div class="hamburger-drawer__group">
        <p class="hamburger-drawer__label">// CONTEXTS</p>
        ${['personal', 'work', 'homelab'].map(c => `<button class="hamburger-drawer__item${c === activeContext ? ' is-active' : ''}" type="button" data-context="${c}">${c}</button>`).join('')}
      </div>
      <div class="hamburger-drawer__group">
        <p class="hamburger-drawer__label">// ADMIN</p>
        <button class="hamburger-drawer__item" type="button" data-action="open-admin">[a] open admin</button>
      </div>
      <div class="hamburger-drawer__group">
        <p class="hamburger-drawer__label">// CLUSTER</p>
        <dl class="hamburger-drawer__status">
          <div><dt>api</dt><dd>${apiStatus === 'connected' ? 'ok' : apiStatus === 'loading' ? 'syncing' : 'offline'}</dd></div>
          <div><dt>db</dt><dd>ok</dd></div>
          <div><dt>backup</dt><dd>ready</dd></div>
        </dl>
      </div>
    </aside>`;
}
```

Render `${renderHamburgerDrawer({ activeContext, isDrawerOpen, apiStatus })}` just inside `app-shell`. Accept `isDrawerOpen` as a new option in `renderShellHtml` with default `false`.

- [ ] **Step 4: Add isDrawerOpen to state.js**

Append to the state object in `public/js/state.js`:

```js
  isDrawerOpen: false,
```

- [ ] **Step 5: Wire the toggle in main.js**

In `bindShellEvents()` inside `public/js/main.js`, add:

```js
  app.querySelectorAll('[data-action="toggle-drawer"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({ isDrawerOpen: !state.isDrawerOpen });
      renderApp();
    });
  });
```

Also make sure `renderApp` passes `isDrawerOpen: state.isDrawerOpen` to `renderShellHtml`. Close the drawer when any nav item is selected (after the existing setState in `[data-view]` and `[data-context]` handlers, add `isDrawerOpen: false`).

- [ ] **Step 6: Run tests to confirm pass**

```bash
node --test tests/frontend/renderShell.test.js
```

- [ ] **Step 7: Stage**

```bash
git add public/js/renderShell.js public/js/state.js public/js/main.js tests/frontend/renderShell.test.js
```

## Task 17: Add mobile drill-down for list+detail views

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`
- Modify: `public/js/renderTaskDetail.js`
- Modify: `tests/frontend/renderTaskDetail.test.js`

On mobile, opening a task takes the user to a second screen with a back arrow. Achieved via a `mobileDetailOpen` state flag and a class on the workspace that CSS uses to hide/show.

- [ ] **Step 1: Add state field**

In `public/js/state.js`, add:

```js
  mobileDetailOpen: false,
```

- [ ] **Step 2: Add failing test for back-arrow markup**

In `tests/frontend/renderTaskDetail.test.js`:

```js
test('detail renders a mobile back button when mobileDetailOpen is true', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'low', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, { mobileDetailOpen: true });
  assert.match(html, /data-action="close-mobile-detail"[^>]*aria-label="Back"/);
});

test('detail omits back button when mobileDetailOpen is false', () => {
  const task = { id: 'a', title: 'X', description: '', priority: 'low', status: 'planned', dueDate: null };
  const html = renderTaskDetailHtml(task, { mobileDetailOpen: false });
  assert.doesNotMatch(html, /data-action="close-mobile-detail"/);
});
```

- [ ] **Step 3: Run — expect failure**

```bash
node --test tests/frontend/renderTaskDetail.test.js
```

- [ ] **Step 4: Add back-arrow markup in renderTaskDetailHtml**

At the top of the detail panel header, conditionally render:

```js
${options.mobileDetailOpen ? `<button class="detail-back" type="button" data-action="close-mobile-detail" aria-label="Back">← back</button>` : ''}
```

- [ ] **Step 5: Wire navigation in main.js**

When a task row/card is clicked, if `isMobile()` set `mobileDetailOpen: true`. Add the `close-mobile-detail` handler:

```js
import { isMobile } from './breakpoints.js';

// inside the existing data-task-id click handler:
row.addEventListener('click', () => {
  setState({
    selectedTaskId: row.dataset.taskId,
    mobileDetailOpen: isMobile() ? true : state.mobileDetailOpen,
  });
  renderWorkspace();
});

// new handler in bindShellEvents:
app.querySelectorAll('[data-action="close-mobile-detail"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    setState({ mobileDetailOpen: false });
    renderApp();
  });
});
```

In `renderWorkspace`, pass `mobileDetailOpen: state.mobileDetailOpen` to `renderTaskDetailHtml`. Add a class to the workspace element when `state.mobileDetailOpen && isMobile()`:

```js
workspace.classList.toggle('is-mobile-detail-open', state.mobileDetailOpen);
```

CSS hides the list on mobile when `.workspace.is-mobile-detail-open` and full-bleeds the detail panel.

- [ ] **Step 6: Run tests**

```bash
node --test tests/frontend/renderTaskDetail.test.js
```

- [ ] **Step 7: Stage**

```bash
git add public/js/state.js public/js/main.js public/js/renderTaskDetail.js tests/frontend/renderTaskDetail.test.js
```

## Task 18: Add Board mobile collapsible sections

**Files:**
- Modify: `public/js/renderBoard.js`
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`
- Modify: `tests/frontend/renderBoard.test.js`

Each board column becomes a section with `▾`/`▸` header on mobile. State tracks which sections are open.

- [ ] **Step 1: Add state**

```js
  boardOpenSections: { 'high-priority': true, 'in-progress': true, 'planned': false, 'completed': false, 'notes': false },
```

- [ ] **Step 2: Add failing tests**

```js
test('board column header includes a collapse toggle', () => {
  const html = renderBoardHtml([], null, { boardOpenSections: { 'high-priority': true } });
  assert.match(html, /data-action="toggle-board-section"[^>]*data-section="high-priority"/);
  assert.match(html, /▾/);
});

test('board column with closed section uses closed glyph and aria-hidden cards', () => {
  const tasks = [{ id: 'a', title: 'X', priority: 'low', status: 'planned', sortOrder: 0 }];
  const html = renderBoardHtml(tasks, null, { boardOpenSections: { planned: false } });
  assert.match(html, /data-section="planned"[^>]*aria-expanded="false"/);
});
```

- [ ] **Step 3: Run — failure expected**

```bash
node --test tests/frontend/renderBoard.test.js
```

- [ ] **Step 4: Accept third options arg in renderBoardHtml**

Update the signature:

```js
export function renderBoardHtml(tasks = [], selectedTaskId = null, options = {}) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const openSections = options.boardOpenSections || {};
  return `
    <section class="board-panel" aria-label="Task board">
      ${COLUMNS.map(col => {
        const isOpen = openSections[col.id] !== false;
        return `
        <section class="board-column board-column--${isOpen ? 'open' : 'closed'}" aria-label="${col.label}" data-board-column="${col.id}" aria-expanded="${isOpen}">
          <header class="board-column__header">
            <button class="board-column__toggle" type="button" data-action="toggle-board-section" data-section="${col.id}" aria-label="Toggle ${col.label}">
              <span class="board-column__glyph">${isOpen ? '▾' : '▸'}</span>
              <h2 class="board-column__title">[ ${col.label} ]</h2>
              <span class="board-column__count">${safe.filter(t => (t.status || t.column || 'planned') === col.id).length}</span>
            </button>
          </header>
          <div class="board-cards" data-board-column="${col.id}"${isOpen ? '' : ' hidden'}>${renderColumnCards(safe, col.id, selectedTaskId)}
          </div>
        </section>`;
      }).join('')}
    </section>`;
}
```

- [ ] **Step 5: Wire toggle handler in main.js**

In `bindBoardEvents`, add:

```js
workspace.querySelectorAll('[data-action="toggle-board-section"]').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    const section = btn.dataset.section;
    setState({
      boardOpenSections: { ...state.boardOpenSections, [section]: !state.boardOpenSections[section] },
    });
    renderWorkspace();
  });
});
```

Pass `{ boardOpenSections: state.boardOpenSections }` when calling `renderBoardHtml` inside `renderWorkspacePrimary`.

- [ ] **Step 6: Run tests**

```bash
node --test tests/frontend/renderBoard.test.js
```

- [ ] **Step 7: Stage**

```bash
git add public/js/renderBoard.js public/js/state.js public/js/main.js tests/frontend/renderBoard.test.js
```

## Task 19: Long-press touch reorder for board cards

**Files:**
- Modify: `public/js/main.js`

Touch users get a long-press → "move to..." menu instead of drag/drop.

- [ ] **Step 1: Add a longpress detector in bindBoardEvents**

In `bindBoardEvents()` add (after the existing dragstart/dragend wiring):

```js
const LONG_PRESS_MS = 480;

workspace.querySelectorAll('[data-board-card]').forEach((card) => {
  let pressTimer = null;
  let pressed = false;

  card.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    pressed = true;
    pressTimer = window.setTimeout(() => {
      if (!pressed) return;
      openTouchMoveMenu(card.dataset.taskId, card);
    }, LONG_PRESS_MS);
  });

  card.addEventListener('pointerup', () => {
    pressed = false;
    if (pressTimer) { window.clearTimeout(pressTimer); pressTimer = null; }
  });

  card.addEventListener('pointercancel', () => {
    pressed = false;
    if (pressTimer) { window.clearTimeout(pressTimer); pressTimer = null; }
  });

  card.addEventListener('pointerleave', () => {
    pressed = false;
    if (pressTimer) { window.clearTimeout(pressTimer); pressTimer = null; }
  });
});
```

- [ ] **Step 2: Implement openTouchMoveMenu**

Add this helper inside `main.js` (above `bindBoardEvents`):

```js
function openTouchMoveMenu(taskId, anchor) {
  const STATUSES = ['high-priority', 'in-progress', 'planned', 'completed', 'notes'];
  const choice = window.prompt(`move to which column?\n${STATUSES.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (!choice) return;
  const idx = Number(choice) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= STATUSES.length) return;
  const targetStatus = STATUSES[idx];
  handleBoardDrop({ taskId, targetStatus, beforeTaskId: null });
}
```

(Using `window.prompt` is a deliberately simple first cut — it keeps the change scoped. A bespoke menu element can replace it later without changing the long-press detection.)

- [ ] **Step 3: Stage (no test added — manual smoke covers this)**

```bash
git add public/js/main.js
```

## Task 20: Library tags drawer on tablet + drill-down on mobile

**Files:**
- Modify: `public/js/renderLibrary.js`
- Modify: `public/js/state.js`
- Modify: `public/js/main.js`
- Modify: `tests/frontend/renderLibrary.test.js`

CSS will collapse the dedicated tags column on tablet; the drawer toggle is a chevron in the docs panel header. On mobile, opening a document switches to the second screen (similar to task drill-down).

- [ ] **Step 1: Add state fields**

```js
  isLibraryTagsDrawerOpen: false,
  isLibraryDocOpen: false,
```

- [ ] **Step 2: Add a failing test for the drawer toggle**

```js
test('library renders a tags drawer toggle in the docs header', () => {
  const html = renderLibraryHtml({
    documents: [], selectedDocumentId: null, editorMode: 'preview',
    draftBody: '', isDirty: false,
    availableTags: [{ tag: 'a', count: 1 }], activeTags: [], tagQuery: '',
    areTagsExpanded: false, savedViews: [], activeSavedViewId: null,
    isInfoEditing: false, infoError: '', isSaving: false,
    saveStatus: 'Saved', isFocusMode: false, isLibraryTagsDrawerOpen: false,
  });
  assert.match(html, /data-action="toggle-library-tags-drawer"[^>]*aria-expanded="false"/);
});
```

- [ ] **Step 3: Run — fail**

```bash
node --test tests/frontend/renderLibrary.test.js
```

- [ ] **Step 4: Update renderLibraryHtml**

Accept `isLibraryTagsDrawerOpen` in the options destructure. Add the toggle to the docs panel header:

```js
<header class="library-browser__header panel-header">
  <div>
    <h2 id="library-title">Knowledge Library</h2>
    <p>${safeDocuments.length} documents</p>
  </div>
  <button class="bracket-button bracket-button--quiet library-tags-toggle" type="button" data-action="toggle-library-tags-drawer" aria-expanded="${isLibraryTagsDrawerOpen}">tags ↕</button>
</header>
```

Wrap the existing tag filter section in a container that gets `library-tag-filter--drawer` and `is-open` classes when the drawer is open:

```js
<div class="library-tag-filter__drawer${isLibraryTagsDrawerOpen ? ' is-open' : ''}">
  ${renderSmartViews(...)}
  ${renderTagFilters(...)}
  ${renderActiveFilters(...)}
</div>
```

CSS hides the drawer on tablet by default, shows it inline on desktop, and slides it down when `is-open` on tablet/mobile.

- [ ] **Step 5: Wire toggle in main.js**

In `bindShellEvents` or inside `renderLibraryWorkspace`, add:

```js
workspace.querySelector('[data-action="toggle-library-tags-drawer"]')?.addEventListener('click', () => {
  setState({ isLibraryTagsDrawerOpen: !state.isLibraryTagsDrawerOpen });
  renderWorkspace();
});
```

For mobile drill-down on documents, mirror the task drill-down — when a document row is clicked, if `isMobile()`, set `isLibraryDocOpen: true`. Add a back button in the document stage equivalent to the task back arrow.

- [ ] **Step 6: Run tests**

```bash
node --test tests/frontend/renderLibrary.test.js
```

- [ ] **Step 7: Stage**

```bash
git add public/js/renderLibrary.js public/js/state.js public/js/main.js tests/frontend/renderLibrary.test.js
```

## Task 21: Modal sheet and full-screen chrome

**Files:**
- Modify: `public/styles.css`
- Modify: `public/js/renderTaskForm.js`
- Modify: `public/js/renderAdminPanel.js`
- Modify: `public/js/renderLibrary.js` (document form modal)

Modal chrome is purely CSS-driven across breakpoints — the markup includes hooks for desktop topbar (`×` close) and mobile topbar (`← cancel · title · [save]`); CSS shows the right one per breakpoint.

- [ ] **Step 1: Update each modal's header to include both chrome variants**

For the task form modal, the admin modal, the document form modal, and the document info form, the header should include both:

```html
<header class="modal-header">
  <div class="modal-header--desktop">
    <h2>new task</h2>
    <button class="modal-header__close" type="button" data-action="close-task-form" aria-label="Close">×</button>
  </div>
  <div class="modal-header--mobile">
    <button class="modal-header__cancel" type="button" data-action="close-task-form">cancel</button>
    <h2 class="modal-header__title">new task</h2>
    <button class="modal-header__save bracket-button bracket-button--primary" type="submit" form="task-form" data-action="submit-from-header">[s] save</button>
  </div>
</header>
```

CSS already (added in Phase 1) hides `.modal-header--mobile` above 768px and hides `.modal-header--desktop` below 768px. The submit-from-header `[s] save` button uses `form="task-form"` to submit the named form without being inside it.

- [ ] **Step 2: Update each form to have a stable id matching the form="..." attribute**

In renderTaskForm.js, give the form `id="task-form"`. Mirror for admin form (`id="admin-form"`) and document form (`id="document-form"`).

- [ ] **Step 3: Verify modal renders both chrome variants**

Run all frontend tests:

```bash
npm test -- tests/frontend
```

Update any test that asserts on specific modal header markup.

- [ ] **Step 4: Stage**

```bash
git add public/styles.css public/js/renderTaskForm.js public/js/renderAdminPanel.js public/js/renderLibrary.js
```

## Task 22: CodeMirror operator theme

**Files:**
- Modify: `scripts/codemirror-editor-source.js`
- Modify: `public/vendor/codemirror-editor.js` (regenerated by build)

CodeMirror gets a theme extension matching the operator palette.

- [ ] **Step 1: Add the theme extension**

Append to `scripts/codemirror-editor-source.js` (before the export):

```js
import { HighlightStyle, syntaxHighlighting as highlight } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const operatorTheme = EditorView.theme({
  '&': { backgroundColor: '#0d0e0f', color: '#c8c8c8' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, monospace' },
  '.cm-content': { caretColor: '#f8f2c6', padding: '14px' },
  '.cm-gutters': { backgroundColor: '#08090a', color: '#5a5d60', border: 'none', borderRight: '1px solid #1f2021' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(135, 215, 95, 0.06)', color: '#87d75f' },
  '.cm-activeLine': { backgroundColor: 'rgba(135, 215, 95, 0.04)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f8f2c6', borderLeftWidth: '2px' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(135, 215, 95, 0.22) !important' },
  '.cm-focused': { outline: 'none' },
}, { dark: true });

const operatorHighlight = HighlightStyle.define([
  { tag: tags.heading,         color: '#87d75f', fontWeight: '700' },
  { tag: tags.strong,          color: '#d7af5f', fontWeight: '700' },
  { tag: tags.emphasis,        color: '#c8c8c8', fontStyle: 'italic' },
  { tag: tags.link,            color: '#87afff', textDecoration: 'underline' },
  { tag: tags.monospace,       color: '#d7af5f', backgroundColor: '#08090a' },
  { tag: tags.quote,           color: '#87afff' },
  { tag: tags.keyword,         color: '#87d75f' },
  { tag: tags.comment,         color: '#5a5d60', fontStyle: 'italic' },
]);
```

In the `extensions` array passed to `EditorState.create`, replace `syntaxHighlighting(defaultHighlightStyle, { fallback: true })` with:

```js
operatorTheme,
highlight(operatorHighlight, { fallback: true }),
```

Remove the existing `EditorView.theme({ ... })` override (the operator theme supersedes it).

- [ ] **Step 2: Rebuild the bundle**

```bash
npm run build:codemirror
```

Expected: writes `public/vendor/codemirror-editor.js`. Check the file's mtime updated:

```bash
ls -la public/vendor/codemirror-editor.js
```

- [ ] **Step 3: Syntax check**

```bash
npm run check
```

Expected: exits 0.

- [ ] **Step 4: Stage**

```bash
git add scripts/codemirror-editor-source.js public/vendor/codemirror-editor.js
```

## Task 23: Phase 3 final verification + smoke test pause

**Files:** none.

- [ ] **Step 1: Run the full verification**

```bash
npm run check
npm test
npm audit --omit=dev
```

Expected: all three exit 0. If `npm audit` reports vulnerabilities, that's separate from this redesign and not part of this plan's scope.

- [ ] **Step 2: Restart demo server**

```bash
npm run demo
```

- [ ] **Step 3: Desktop smoke test (1200px+)**

Open `http://127.0.0.1:3100/` and confirm:
- All Phase 2 functionality still works (cards, bracket badges, mode toggle, etc).
- The bottom nav and hamburger drawer are not visible (CSS-hidden above 1024px).
- CodeMirror in Library/edit mode now matches the operator palette: phosphor headings, amber bold, dim gutter, yellow caret, cyan blockquotes.
- Status footer is always visible with breadcrumb · sync · mode tag.

- [ ] **Step 4: Tablet smoke test (Chrome devtools, 800px)**

Resize devtools to 800px width. Confirm:
- Sidebar collapsed into hamburger + horizontal nav strip.
- Board: 3 columns visible, scroll indicator on the right edge.
- Library: tags column hidden; tags drawer toggle in the docs header opens/closes the tag filters.
- Modals: bottom sheets instead of centered panels.

- [ ] **Step 5: Mobile smoke test (Chrome devtools, 360px)**

Resize to 360px. Confirm:
- Bottom nav with `T B + L A` is visible at the bottom.
- Hamburger drawer opens with `≡`, contains Backlog / Personal / Work / Homelab / Admin / Cluster status.
- Tapping a task opens the detail as a second screen with `← back` arrow.
- Board columns are collapsible sections with `▾`/`▸` toggles.
- Library docs list is screen 1; tapping a doc opens screen 2 with the edit/preview mode toggle (split mode dimmed).
- Long-pressing a board card (touch emulation in devtools) opens a `move to which column?` prompt.
- Modals are full-screen with `← cancel · title · [save]` topbar.

- [ ] **Step 6: Stop the server and report**

> Phase 3 complete. Full redesign is in place across desktop, tablet, and mobile. CodeMirror operator theme rendered. All tests pass. Working tree contains all staged changes from phases 1–3. Awaiting your final review before committing.

---

# Closeout

Files in the working tree at end of Phase 3:

```text
M  .gitignore
M  public/index.html
M  public/styles.css
M  public/js/state.js
M  public/js/main.js
M  public/js/renderShell.js
M  public/js/renderList.js
M  public/js/renderTaskDetail.js
M  public/js/renderTaskForm.js
M  public/js/renderAdminPanel.js
M  public/js/renderBoard.js
M  public/js/renderLibrary.js
M  public/vendor/codemirror-editor.js
M  scripts/codemirror-editor-source.js
M  tests/frontend/renderShell.test.js
M  tests/frontend/renderList.test.js
M  tests/frontend/renderTaskDetail.test.js
M  tests/frontend/renderTaskForm.test.js
M  tests/frontend/renderAdminPanel.test.js
M  tests/frontend/renderBoard.test.js
M  tests/frontend/renderLibrary.test.js
?? public/js/breakpoints.js
?? public/vendor/fonts/JetBrainsMono-Regular.woff2
?? public/vendor/fonts/JetBrainsMono-Bold.woff2
?? public/vendor/fonts/SourceSerifPro-Regular.woff2
?? tests/frontend/breakpoints.test.js
?? docs/superpowers/specs/2026-05-19-ui-redesign-design.md
?? docs/superpowers/plans/2026-05-19-ui-redesign.md
```

When the user is ready to commit, a clean sequence would be one commit per phase (3 commits) or one cohesive commit (1) — their call. Suggested commit messages if they want a single commit:

```text
feat(ui): redesign frontend in operator-evolved direction

- New operator palette (14 tokens), JetBrains Mono everywhere,
  Source Serif only inside Markdown preview
- Cards replace table rows; bracket-style badges and buttons
- Always-visible status footer with breadcrumb, sync, <MODE> tag
- Bottom nav + hamburger drawer on mobile; library tags drawer on tablet
- CodeMirror operator theme
- All tests updated; no API or schema changes

Design: docs/superpowers/specs/2026-05-19-ui-redesign-design.md
Plan:   docs/superpowers/plans/2026-05-19-ui-redesign.md
```

Or phased:
- `feat(ui): phase 1 — operator visual language (fonts + stylesheet rewrite)`
- `feat(ui): phase 2 — component restructure (cards, brackets, mode toggle)`
- `feat(ui): phase 3 — mobile and breakpoint adaptation`
