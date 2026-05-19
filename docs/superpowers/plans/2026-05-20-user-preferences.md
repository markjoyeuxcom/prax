# User Preferences Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated browser-local Settings panel for interface size and colour palette preferences.

**Architecture:** Preferences are frontend-only and persist in `localStorage` under one key. A focused helper module owns validation, persistence, reset, and root attribute application. Rendering stays aligned with existing modal patterns by adding a `renderSettingsPanelHtml` module and wiring it through `state.js` and `main.js`.

**Tech Stack:** Vanilla JavaScript ES modules, localStorage, CSS custom properties, Node test runner.

---

## File Structure

- Create `public/js/preferences.js`: preference defaults, allowed values, parser, localStorage persistence, reset, and root attribute application.
- Create `public/js/renderSettingsPanel.js`: Settings modal HTML with Appearance, Data, and About sections.
- Modify `public/js/state.js`: add `isSettingsPanelOpen`, `settingsSection`, and `preferences`.
- Modify `public/js/main.js`: load/apply preferences at startup, open/close Settings, handle preference clicks/reset, and render Settings modal.
- Modify `public/js/renderShell.js`: add a Settings button in the topbar.
- Modify `public/styles.css`: add palette attribute overrides, font scale variables, and Settings modal/control styles.
- Create `tests/frontend/preferences.test.js`: preference helper coverage.
- Create `tests/frontend/renderSettingsPanel.test.js`: Settings modal render coverage.
- Modify `tests/frontend/renderShell.test.js`: assert Settings button exists.

## Task 1: Preference Helper

**Files:**
- Create: `public/js/preferences.js`
- Test: `tests/frontend/preferences.test.js`

- [ ] **Step 1: Write failing preference helper tests**

Create `tests/frontend/preferences.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
  LOCAL_STORAGE_KEY,
  applyPreferences,
  loadPreferences,
  normalizePreferences,
  resetPreferences,
  savePreferences,
} from '../../public/js/preferences.js';

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function rootStub() {
  const attributes = new Map();
  return {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
  };
}

test('normalizePreferences returns defaults for empty or invalid input', () => {
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ fontScale: 'giant', palette: 'rainbow' }), DEFAULT_PREFERENCES);
});

test('normalizePreferences preserves valid font scale and palette values', () => {
  assert.deepEqual(
    normalizePreferences({ fontScale: 'large', palette: 'daylight' }),
    { fontScale: 'large', palette: 'daylight' },
  );
});

test('loadPreferences parses saved localStorage JSON', () => {
  const storage = storageWith({
    [LOCAL_STORAGE_KEY]: JSON.stringify({ fontScale: 'compact', palette: 'graphite' }),
  });

  assert.deepEqual(loadPreferences(storage), { fontScale: 'compact', palette: 'graphite' });
});

test('loadPreferences returns defaults for malformed saved JSON', () => {
  const storage = storageWith({ [LOCAL_STORAGE_KEY]: '{bad json' });

  assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);
});

test('savePreferences stores normalized preferences', () => {
  const storage = storageWith();

  const saved = savePreferences({ fontScale: 'large', palette: 'daylight' }, storage);

  assert.deepEqual(saved, { fontScale: 'large', palette: 'daylight' });
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), JSON.stringify(saved));
});

test('resetPreferences clears storage and returns defaults', () => {
  const storage = storageWith({
    [LOCAL_STORAGE_KEY]: JSON.stringify({ fontScale: 'large', palette: 'daylight' }),
  });

  const reset = resetPreferences(storage);

  assert.deepEqual(reset, DEFAULT_PREFERENCES);
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), null);
});

test('applyPreferences writes root attributes', () => {
  const root = rootStub();

  applyPreferences({ fontScale: 'large', palette: 'graphite' }, root);

  assert.equal(root.getAttribute('data-font-scale'), 'large');
  assert.equal(root.getAttribute('data-palette'), 'graphite');
});
```

- [ ] **Step 2: Run helper test to verify it fails**

Run:

```bash
npm test -- tests/frontend/preferences.test.js
```

Expected: FAIL because `public/js/preferences.js` does not exist.

- [ ] **Step 3: Implement preference helper**

Create `public/js/preferences.js`:

```js
export const LOCAL_STORAGE_KEY = 'moomora-console.preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
  fontScale: 'comfortable',
  palette: 'console',
});

export const FONT_SCALE_OPTIONS = Object.freeze(['compact', 'comfortable', 'large']);
export const PALETTE_OPTIONS = Object.freeze(['console', 'graphite', 'daylight']);

function isAllowed(value, allowed) {
  return allowed.includes(String(value || ''));
}

export function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    fontScale: isAllowed(source.fontScale, FONT_SCALE_OPTIONS) ? source.fontScale : DEFAULT_PREFERENCES.fontScale,
    palette: isAllowed(source.palette, PALETTE_OPTIONS) ? source.palette : DEFAULT_PREFERENCES.palette,
  };
}

export function loadPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LOCAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences, storage = globalThis.localStorage) {
  const normalized = normalizePreferences(preferences);
  try {
    storage?.setItem?.(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Appearance preferences are non-critical; runtime state still applies.
  }
  return normalized;
}

export function resetPreferences(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(LOCAL_STORAGE_KEY);
  } catch {
    // Appearance preferences are non-critical; defaults still apply.
  }
  return { ...DEFAULT_PREFERENCES };
}

export function applyPreferences(preferences, root = globalThis.document?.documentElement) {
  const normalized = normalizePreferences(preferences);
  root?.setAttribute?.('data-font-scale', normalized.fontScale);
  root?.setAttribute?.('data-palette', normalized.palette);
  return normalized;
}
```

- [ ] **Step 4: Run helper test to verify it passes**

Run:

```bash
npm test -- tests/frontend/preferences.test.js
```

Expected: PASS for all preference helper tests.

- [ ] **Step 5: Commit helper**

```bash
git add public/js/preferences.js tests/frontend/preferences.test.js
git commit -m "feat: add browser-local preferences helper"
```

## Task 2: Settings Panel Renderer

**Files:**
- Create: `public/js/renderSettingsPanel.js`
- Test: `tests/frontend/renderSettingsPanel.test.js`

- [ ] **Step 1: Write failing Settings panel render tests**

Create `tests/frontend/renderSettingsPanel.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSettingsPanelHtml } from '../../public/js/renderSettingsPanel.js';

test('renderSettingsPanelHtml renders appearance controls and local storage note', () => {
  const html = renderSettingsPanelHtml({
    preferences: { fontScale: 'comfortable', palette: 'console' },
  });

  assert.match(html, /role="dialog"/);
  assert.match(html, /Settings/);
  assert.match(html, /Appearance/);
  assert.match(html, /Data/);
  assert.match(html, /About/);
  assert.match(html, /No cookies/);
  assert.match(html, /data-settings-font-scale="compact"/);
  assert.match(html, /data-settings-font-scale="comfortable"/);
  assert.match(html, /data-settings-font-scale="large"/);
  assert.match(html, /data-settings-palette="console"/);
  assert.match(html, /data-settings-palette="graphite"/);
  assert.match(html, /data-settings-palette="daylight"/);
  assert.match(html, /data-action="reset-preferences"/);
});

test('renderSettingsPanelHtml marks selected font scale and palette', () => {
  const html = renderSettingsPanelHtml({
    preferences: { fontScale: 'large', palette: 'daylight' },
  });

  assert.match(html, /data-settings-font-scale="large"[^>]*aria-pressed="true"/);
  assert.match(html, /data-settings-palette="daylight"[^>]*aria-pressed="true"/);
});

test('renderSettingsPanelHtml renders active section state', () => {
  const html = renderSettingsPanelHtml({
    activeSection: 'about',
    preferences: { fontScale: 'compact', palette: 'graphite' },
  });

  assert.match(html, /data-settings-section="about"[^>]*aria-pressed="true"/);
});
```

- [ ] **Step 2: Run renderer test to verify it fails**

Run:

```bash
npm test -- tests/frontend/renderSettingsPanel.test.js
```

Expected: FAIL because `public/js/renderSettingsPanel.js` does not exist.

- [ ] **Step 3: Implement Settings panel renderer**

Create `public/js/renderSettingsPanel.js`:

```js
import { DEFAULT_PREFERENCES, FONT_SCALE_OPTIONS, PALETTE_OPTIONS, normalizePreferences } from './preferences.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelFromValue(value) {
  return String(value)
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function selected(value, activeValue) {
  return value === activeValue ? ' aria-pressed="true"' : ' aria-pressed="false"';
}

function renderSectionButton(section, activeSection, label) {
  return `<button class="settings-nav-button" type="button" data-settings-section="${escapeHtml(section)}"${selected(section, activeSection)}>${escapeHtml(label)}</button>`;
}

function renderFontScaleButton(value, activeValue) {
  return `<button class="settings-choice settings-choice--font" type="button" data-settings-font-scale="${escapeHtml(value)}"${selected(value, activeValue)}>${escapeHtml(labelFromValue(value))}</button>`;
}

function paletteDescription(value) {
  if (value === 'graphite') return 'Neutral dark, less blue';
  if (value === 'daylight') return 'GitHub-like light mode';
  return 'Current dark console palette';
}

function renderPaletteButton(value, activeValue) {
  return `
    <button class="settings-palette" type="button" data-settings-palette="${escapeHtml(value)}"${selected(value, activeValue)}>
      <span class="settings-palette__swatches settings-palette__swatches--${escapeHtml(value)}" aria-hidden="true"></span>
      <span class="settings-palette__name">${escapeHtml(labelFromValue(value))}</span>
      <span class="settings-palette__description">${escapeHtml(paletteDescription(value))}</span>
    </button>`;
}

function renderAppearance(preferences) {
  return `
    <section class="settings-section" aria-labelledby="settings-appearance-title">
      <div>
        <h3 id="settings-appearance-title">Interface Size</h3>
        <p>Fixed scale for navigation, lists, document preview, editor, and controls.</p>
      </div>
      <div class="settings-choice-row" aria-label="Interface size">
        ${FONT_SCALE_OPTIONS.map(value => renderFontScaleButton(value, preferences.fontScale)).join('')}
      </div>
    </section>
    <section class="settings-section" aria-labelledby="settings-palette-title">
      <div>
        <h3 id="settings-palette-title">Colour Palette</h3>
        <p>Code blocks and the editor remain monospace for technical readability.</p>
      </div>
      <div class="settings-palette-grid" aria-label="Colour palette">
        ${PALETTE_OPTIONS.map(value => renderPaletteButton(value, preferences.palette)).join('')}
      </div>
    </section>
    <section class="settings-section settings-section--inline" aria-labelledby="settings-reset-title">
      <div>
        <h3 id="settings-reset-title">Reset Preferences</h3>
        <p>Return to ${escapeHtml(labelFromValue(DEFAULT_PREFERENCES.fontScale))} size and ${escapeHtml(labelFromValue(DEFAULT_PREFERENCES.palette))} palette.</p>
      </div>
      <button class="danger-action" type="button" data-action="reset-preferences">Reset</button>
    </section>`;
}

function renderDataSection() {
  return `
    <section class="settings-section" aria-labelledby="settings-data-title">
      <div>
        <h3 id="settings-data-title">Data</h3>
        <p>Preferences are stored in this browser with localStorage. No cookies are set and preferences are not sent to the server.</p>
      </div>
      <p class="settings-note">Backup, import, restore, and archive maintenance controls remain under Admin Operations.</p>
    </section>`;
}

function renderAboutSection() {
  return `
    <section class="settings-section" aria-labelledby="settings-about-title">
      <div>
        <h3 id="settings-about-title">About</h3>
        <p>Moomora Console is a local-first operations workspace for tasks, runbooks, and Markdown workflows.</p>
      </div>
    </section>`;
}

export function renderSettingsPanelHtml({
  activeSection = 'appearance',
  preferences = DEFAULT_PREFERENCES,
} = {}) {
  const safeSection = ['appearance', 'data', 'about'].includes(activeSection) ? activeSection : 'appearance';
  const safePreferences = normalizePreferences(preferences);
  const sectionHtml = safeSection === 'data'
    ? renderDataSection()
    : safeSection === 'about'
      ? renderAboutSection()
      : renderAppearance(safePreferences);

  return `
    <div class="modal-backdrop" data-settings-panel>
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-modal__header">
          <div>
            <span class="detail-kicker">Preferences</span>
            <h2 id="settings-title">Settings</h2>
            <p>Stored locally in this browser. No cookies, no server sync.</p>
          </div>
          <button class="icon-action" type="button" aria-label="Close Settings" data-action="close-settings">&times;</button>
        </header>
        <div class="settings-layout">
          <nav class="settings-nav" aria-label="Settings sections">
            ${renderSectionButton('appearance', safeSection, 'Appearance')}
            ${renderSectionButton('data', safeSection, 'Data')}
            ${renderSectionButton('about', safeSection, 'About')}
          </nav>
          <div class="settings-content">
            ${sectionHtml}
          </div>
        </div>
      </section>
    </div>`;
}
```

- [ ] **Step 4: Run renderer test to verify it passes**

Run:

```bash
npm test -- tests/frontend/renderSettingsPanel.test.js
```

Expected: PASS for all Settings panel render tests.

- [ ] **Step 5: Commit renderer**

```bash
git add public/js/renderSettingsPanel.js tests/frontend/renderSettingsPanel.test.js
git commit -m "feat: render settings preferences panel"
```

## Task 3: App Wiring

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/renderShell.js`
- Modify: `public/js/main.js`
- Test: `tests/frontend/renderShell.test.js`

- [ ] **Step 1: Write failing shell test for Settings action**

Modify `tests/frontend/renderShell.test.js` in `renderShellHtml includes workflow hooks for search, context, and actions`:

```js
  assert.match(html, /data-action="open-settings"/);
```

Place it near the existing `open-admin` assertion.

- [ ] **Step 2: Run shell test to verify it fails**

Run:

```bash
npm test -- tests/frontend/renderShell.test.js
```

Expected: FAIL because the shell does not render `data-action="open-settings"`.

- [ ] **Step 3: Add preference state**

Modify `public/js/state.js`:

```js
import { DEFAULT_PREFERENCES } from './preferences.js';

export const state = {
  tasks: [],
  documents: [],
  selectedTaskId: null,
  selectedDocumentId: null,
  activeView: 'list',
  activeContext: 'homelab',
  searchQuery: '',
  apiStatus: 'unknown',
  isTaskFormOpen: false,
  isAdminPanelOpen: false,
  isSettingsPanelOpen: false,
  settingsSection: 'appearance',
  isDocumentFormOpen: false,
  isDocumentInfoEditorOpen: false,
  editingTaskId: null,
  editingDocumentId: null,
  formError: '',
  documentFormError: '',
  documentInfoError: '',
  isSaving: false,
  adminImportMode: 'skip',
  documentEditorMode: 'preview',
  documentDraftBody: '',
  documentDraftId: null,
  isDocumentDirty: false,
  documentSaveStatus: 'Saved',
  isDocumentFocusMode: false,
  activeLibraryTags: [],
  libraryTagQuery: '',
  areLibraryTagsExpanded: false,
  librarySavedViews: [],
  preferences: { ...DEFAULT_PREFERENCES },
};

export function setState(patch) {
  Object.assign(state, patch);
}
```

- [ ] **Step 4: Add Settings button to shell**

Modify `public/js/renderShell.js` topbar actions:

```js
          <div class="topbar-actions">
            <button class="secondary-action" type="button" data-action="open-settings">Settings</button>
            <button class="secondary-action" type="button" data-action="open-admin">Admin</button>
            <button class="primary-action" type="button" data-action="${primaryAction.action}">${primaryAction.label}</button>
          </div>
```

- [ ] **Step 5: Wire Settings in main**

Modify imports in `public/js/main.js`:

```js
import { applyPreferences, loadPreferences, resetPreferences, savePreferences } from './preferences.js';
import { renderSettingsPanelHtml } from './renderSettingsPanel.js';
```

Modify `renderApp()` after the Admin panel block:

```js
  if (state.isSettingsPanelOpen) {
    app.insertAdjacentHTML('beforeend', renderSettingsPanelHtml({
      activeSection: state.settingsSection,
      preferences: state.preferences,
    }));
  }
```

Modify the bind calls in `renderApp()`:

```js
  bindAdminPanelEvents();
  bindSettingsPanelEvents();
```

Add Settings open handler in `bindShellEvents()` after the Admin handler:

```js
  app.querySelector('[data-action="open-settings"]')?.addEventListener('click', () => {
    setState({
      isSettingsPanelOpen: true,
      isAdminPanelOpen: false,
      isTaskFormOpen: false,
      isDocumentFormOpen: false,
      editingTaskId: null,
      editingDocumentId: null,
    });
    renderApp();
  });
```

Add `bindSettingsPanelEvents()` near `bindAdminPanelEvents()`:

```js
function updatePreferences(nextPreferences) {
  const preferences = savePreferences(nextPreferences);
  applyPreferences(preferences);
  setState({ preferences });
}

function bindSettingsPanelEvents() {
  const panel = app.querySelector('[data-settings-panel]');
  if (!panel) return;

  panel.querySelector('[data-action="close-settings"]')?.addEventListener('click', () => {
    setState({ isSettingsPanelOpen: false });
    renderApp();
  });

  panel.querySelectorAll('[data-settings-section]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({ settingsSection: button.dataset.settingsSection || 'appearance' });
      renderApp();
    });
  });

  panel.querySelectorAll('[data-settings-font-scale]').forEach((button) => {
    button.addEventListener('click', () => {
      updatePreferences({
        ...state.preferences,
        fontScale: button.dataset.settingsFontScale,
      });
      renderApp();
    });
  });

  panel.querySelectorAll('[data-settings-palette]').forEach((button) => {
    button.addEventListener('click', () => {
      updatePreferences({
        ...state.preferences,
        palette: button.dataset.settingsPalette,
      });
      renderApp();
    });
  });

  panel.querySelector('[data-action="reset-preferences"]')?.addEventListener('click', () => {
    const preferences = resetPreferences();
    applyPreferences(preferences);
    setState({ preferences, settingsSection: 'appearance' });
    renderApp();
  });
}
```

Modify startup where saved library views are loaded:

```js
async function init() {
  try {
    const preferences = applyPreferences(loadPreferences());
    setState({
      preferences,
      librarySavedViews: savedLibraryViewsFromJson(window.localStorage?.getItem(SAVED_LIBRARY_VIEWS_KEY)),
    });
    await loadTasks();
  } catch (error) {
    setState({ apiStatus: 'error' });
    renderError(error.message);
  }
}
```

Replace the existing `init()` function with the version above.

The key addition is:

```js
      preferences: applyPreferences(loadPreferences()),
```

- [ ] **Step 6: Run shell test and smoke check**

Run:

```bash
npm test -- tests/frontend/renderShell.test.js tests/frontend/renderSettingsPanel.test.js tests/frontend/preferences.test.js
npm run check
```

Expected: all listed tests PASS and syntax check exits 0.

- [ ] **Step 7: Commit wiring**

```bash
git add public/js/state.js public/js/renderShell.js public/js/main.js tests/frontend/renderShell.test.js
git commit -m "feat: wire browser-local settings panel"
```

## Task 4: Preference Styling

**Files:**
- Modify: `public/styles.css`
- Test: `tests/frontend/libraryStyles.test.js`

- [ ] **Step 1: Write failing CSS assertions**

Modify `tests/frontend/libraryStyles.test.js` by adding:

```js
test('Preference palettes and font scales are defined', () => {
  assert.match(styles, /:root\[data-palette="graphite"\]/);
  assert.match(styles, /:root\[data-palette="daylight"\]/);
  assert.match(styles, /:root\[data-font-scale="compact"\]/);
  assert.match(styles, /:root\[data-font-scale="large"\]/);
  assert.match(styles, /\.settings-modal/);
  assert.match(styles, /\.settings-palette__swatches--daylight/);
});
```

- [ ] **Step 2: Run style test to verify it fails**

Run:

```bash
npm test -- tests/frontend/libraryStyles.test.js
```

Expected: FAIL because palette, font scale, and Settings classes are not defined.

- [ ] **Step 3: Add root preference variables**

Modify the top of `public/styles.css` after the default `:root` block:

```css
:root {
  --app-font-size: 1rem;
  --editor-font-size: 0.88rem;
  --preview-font-size: 0.92rem;
  --modal-backdrop: rgba(4, 9, 14, 0.72);
}

:root[data-font-scale="compact"] {
  --app-font-size: 0.94rem;
  --editor-font-size: 0.84rem;
  --preview-font-size: 0.88rem;
}

:root[data-font-scale="large"] {
  --app-font-size: 1.08rem;
  --editor-font-size: 0.96rem;
  --preview-font-size: 1rem;
}

:root[data-palette="graphite"] {
  --bg: #101214;
  --surface: #181b1f;
  --surface-2: #20242a;
  --border: #343a42;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --accent: #d4d4d8;
  --accent-strong: #a3e635;
  --warning: #facc15;
  --danger: #fb7185;
  --modal-backdrop: rgba(0, 0, 0, 0.68);
}

:root[data-palette="daylight"] {
  --bg: #f6f8fa;
  --surface: #ffffff;
  --surface-2: #f6f8fa;
  --border: #d0d7de;
  --text: #24292f;
  --muted: #57606a;
  --accent: #0969da;
  --accent-strong: #1a7f37;
  --warning: #9a6700;
  --danger: #cf222e;
  --modal-backdrop: rgba(31, 35, 40, 0.28);
}
```

Modify `body`:

```css
  font-size: var(--app-font-size);
```

Replace fixed editor and preview sizes:

```css
.document-editor {
  font-size: var(--editor-font-size);
}

.code-editor .cm-editor {
  font-size: var(--editor-font-size);
}

.document-workspace--focused .document-editor {
  font-size: calc(var(--editor-font-size) + 0.06rem);
}

.document-workspace--focused .code-editor .cm-editor {
  font-size: calc(var(--editor-font-size) + 0.06rem);
}

.markdown-preview {
  font-size: var(--preview-font-size);
}
```

Replace `.modal-backdrop` background:

```css
  background: var(--modal-backdrop);
```

- [ ] **Step 4: Add Settings modal styles**

Add near Admin modal styles in `public/styles.css`:

```css
.settings-modal {
  width: min(860px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 22px 80px rgba(0, 0, 0, 0.34);
}

.settings-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  border-bottom: 1px solid var(--border);
}

.settings-modal__header h2 {
  margin: 0;
  color: var(--text);
  font-size: 1.05rem;
  letter-spacing: 0;
}

.settings-modal__header p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.settings-layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  min-height: 430px;
}

.settings-nav {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 14px;
  border-right: 1px solid var(--border);
  background: rgba(10, 17, 25, 0.25);
}

.settings-nav-button,
.settings-choice,
.settings-palette {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  text-align: left;
  cursor: pointer;
}

.settings-nav-button {
  padding: 9px 10px;
  font-weight: 750;
}

.settings-nav-button[aria-pressed="true"],
.settings-choice[aria-pressed="true"],
.settings-palette[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--surface-2);
  color: var(--text);
}

.settings-content {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
}

.settings-section {
  display: grid;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(10, 17, 25, 0.24);
}

.settings-section--inline {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.settings-section h3 {
  margin: 0;
  color: var(--text);
  font-size: 0.94rem;
  letter-spacing: 0;
}

.settings-section p,
.settings-note {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.settings-choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-choice {
  padding: 8px 10px;
  font-weight: 800;
}

.settings-choice[data-settings-font-scale="compact"] {
  font-size: 0.78rem;
}

.settings-choice[data-settings-font-scale="comfortable"] {
  font-size: 0.86rem;
}

.settings-choice[data-settings-font-scale="large"] {
  font-size: 0.96rem;
}

.settings-palette-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.settings-palette {
  display: grid;
  gap: 7px;
  padding: 10px;
}

.settings-palette__swatches {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  height: 32px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 7px;
}

.settings-palette__swatches::before,
.settings-palette__swatches::after,
.settings-palette__swatches span {
  content: "";
}

.settings-palette__swatches--console {
  background: linear-gradient(90deg, #0a1119 0 40%, #111b28 40% 60%, #4f9cff 60% 80%, #72d6a2 80%);
}

.settings-palette__swatches--graphite {
  background: linear-gradient(90deg, #101214 0 40%, #20242a 40% 60%, #d4d4d8 60% 80%, #a3e635 80%);
}

.settings-palette__swatches--daylight {
  background: linear-gradient(90deg, #ffffff 0 40%, #f6f8fa 40% 60%, #0969da 60% 80%, #1a7f37 80%);
}

.settings-palette__name {
  color: var(--text);
  font-size: 0.86rem;
  font-weight: 800;
}

.settings-palette__description {
  color: var(--muted);
  font-size: 0.78rem;
}

.danger-action {
  border: 1px solid rgba(255, 122, 122, 0.48);
  border-radius: 8px;
  background: rgba(255, 122, 122, 0.12);
  color: var(--danger);
  padding: 8px 10px;
  font-weight: 800;
  cursor: pointer;
}
```

Add responsive fallback near existing media queries:

```css
@media (max-width: 760px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .settings-palette-grid {
    grid-template-columns: 1fr;
  }

  .settings-section--inline {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run style test to verify it passes**

Run:

```bash
npm test -- tests/frontend/libraryStyles.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit styling**

```bash
git add public/styles.css tests/frontend/libraryStyles.test.js
git commit -m "style: add preference palettes and settings panel"
```

## Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm run check
npm test
git diff --check HEAD
```

Expected:

- `npm run check` exits 0.
- `npm test` reports all tests passing.
- `git diff --check HEAD` exits 0 with no output.

- [ ] **Step 2: Smoke test in browser**

Start the app if it is not already running:

```bash
PORT=3100 HOST=127.0.0.1 npm run demo
```

Open:

```text
http://127.0.0.1:3100/
```

Manual checks:

- Settings button opens the Settings panel.
- Compact, Comfortable, and Large update visible text sizing immediately.
- Console, Graphite, and Daylight update the site palette immediately.
- Reload keeps the selected preferences.
- Reset returns to Comfortable and Console.
- Admin panel still opens.
- Library editor still uses monospace text.

- [ ] **Step 3: Commit any smoke-test fixes**

If a smoke-test fix is needed:

```bash
git add public/js public/styles.css tests/frontend
git commit -m "fix: polish settings preferences behavior"
```

If no fix is needed, do not create an empty commit.

- [ ] **Step 4: Push branch**

```bash
git status --short --branch
git push origin main
```

Expected: `main` pushes cleanly.
