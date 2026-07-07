import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSettingsHtml } from '../../public/js/renderSettings.js';

function baseState(overrides = {}) {
  return {
    preferences: { theme: 'light', accent: 'fern', chromeOS: 'mac', readingScale: 1 },
    semanticStatus: { available: false },
    adminImportMode: 'skip',
    projects: [
      { id: 'p1', name: 'Homelab' },
      { id: 'p2', name: 'Work' },
    ],
    staleDocs: [],
    orphanDocs: [],
    maintenanceProjectFilter: 'all',
    ...overrides,
  };
}

function baseModel(overrides = {}) {
  return {
    stats: { tasks: 12, projects: 3, documents: 8 },
    activeProjectName: 'Homelab',
    activeDocumentCount: 4,
    ...overrides,
  };
}

test('renders the page head, section tabs, and one card per tab', () => {
  const html = renderSettingsHtml(baseState(), baseModel());
  assert.match(html, /class="page-head__title">Settings</);
  // three tabs, appearance active by default
  assert.match(html, /class="tabs__tab is-active"[^>]*data-action="set-settings-tab" data-tab="appearance"/);
  assert.match(html, /data-action="set-settings-tab" data-tab="intelligence"/);
  assert.match(html, /data-action="set-settings-tab" data-tab="data"/);
  // only the active tab's card renders
  assert.match(html, /settings-card__title">Appearance</);
  assert.doesNotMatch(html, /settings-card__title">Intelligence</);
  assert.doesNotMatch(html, /settings-card__title">Data &amp; admin</);
  const intel = renderSettingsHtml(baseState({ settingsTab: 'intelligence' }), baseModel());
  assert.match(intel, /settings-card__title">Intelligence</);
  assert.doesNotMatch(intel, /settings-card__title">Appearance</);
  const data = renderSettingsHtml(baseState({ settingsTab: 'data' }), baseModel());
  assert.match(data, /settings-card__title">Data &amp; admin</);
  assert.doesNotMatch(data, /settings-card__title">Appearance</);
  // unknown tab falls back to appearance
  const fallback = renderSettingsHtml(baseState({ settingsTab: 'nope' }), baseModel());
  assert.match(fallback, /settings-card__title">Appearance</);
});

test('the active tab marker follows the selected tab (guards a stuck-active-nav regression)', () => {
  // Each selected tab must be the ONLY one wearing is-active + aria-current,
  // so a hardcoded "appearance is always active" bug cannot pass.
  for (const [selected, others] of [
    ['appearance', ['intelligence', 'data']],
    ['intelligence', ['appearance', 'data']],
    ['data', ['appearance', 'intelligence']],
  ]) {
    const html = renderSettingsHtml(baseState({ settingsTab: selected }), baseModel());
    assert.match(html, new RegExp(`class="tabs__tab is-active"[^>]*data-tab="${selected}"[^>]*aria-current="true"`));
    for (const other of others) {
      assert.doesNotMatch(html, new RegExp(`class="tabs__tab is-active"[^>]*data-tab="${other}"`));
      assert.doesNotMatch(html, new RegExp(`data-tab="${other}"[^>]*aria-current`));
    }
  }
  // Invalid ARIA (aria-selected on a plain button) must be gone; the active
  // state uses aria-current, matching the app-wide convention.
  assert.doesNotMatch(renderSettingsHtml(baseState(), baseModel()), /aria-selected/);
});

// ---- Appearance ----------------------------------------------------------

test('theme cards carry set-theme actions and mark the active theme', () => {
  const html = renderSettingsHtml(baseState({ preferences: { theme: 'dark', accent: 'fern', chromeOS: 'mac', readingScale: 1 } }), baseModel());
  assert.match(html, /data-action="set-theme" data-theme="light"/);
  assert.match(html, /data-action="set-theme" data-theme="dark"/);
  assert.match(html, /class="theme-card is-active" data-action="set-theme" data-theme="dark"/);
  assert.doesNotMatch(html, /class="theme-card is-active" data-action="set-theme" data-theme="light"/);
  // design preview colors
  assert.match(html, /#FAF9F7/);
  assert.match(html, /#D8D6D0/);
  assert.match(html, /#E5E3DE/);
  assert.match(html, /#1C2220/);
  assert.match(html, /#39423F/);
  assert.match(html, /#2C3331/);
  assert.match(html, /theme-card__bar" style="background:var\(--accent\)/);
});

test('light theme marks the light card active', () => {
  const html = renderSettingsHtml(baseState(), baseModel());
  assert.match(html, /class="theme-card is-active" data-action="set-theme" data-theme="light"/);
  assert.doesNotMatch(html, /class="theme-card is-active" data-action="set-theme" data-theme="dark"/);
});

test('window-controls segmented pair reflects the chrome preference via aria-pressed', () => {
  const mac = renderSettingsHtml(baseState(), baseModel());
  assert.match(mac, /data-action="set-chrome" data-chrome="mac" aria-pressed="true"/);
  assert.match(mac, /data-action="set-chrome" data-chrome="win" aria-pressed="false"/);
  assert.match(mac, />macOS</);
  assert.match(mac, />Windows</);

  const win = renderSettingsHtml(baseState({ preferences: { theme: 'light', accent: 'fern', chromeOS: 'win', readingScale: 1 } }), baseModel());
  assert.match(win, /data-chrome="win" aria-pressed="true"/);
  assert.match(win, /data-chrome="mac" aria-pressed="false"/);
});

test('renders the four accent swatches and marks the active one', () => {
  const html = renderSettingsHtml(baseState({ preferences: { theme: 'light', accent: 'clay', chromeOS: 'mac', readingScale: 1 } }), baseModel());
  assert.equal((html.match(/data-action="set-accent"/g) || []).length, 4);
  assert.match(html, /data-accent="fern"/);
  assert.match(html, /data-accent="indigo"/);
  assert.match(html, /data-accent="clay"/);
  assert.match(html, /data-accent="moss"/);
  assert.match(html, /class="swatch is-active" data-action="set-accent" data-accent="clay"/);
  assert.doesNotMatch(html, /class="swatch is-active" data-action="set-accent" data-accent="fern"/);
  // fern has no --accent override; its swatch falls back to the token value
  assert.match(html, /data-accent="fern"[^>]*background:oklch\(0\.52 0\.09 175\)/);
  assert.match(html, /data-accent="indigo"[^>]*background:oklch\(0\.60 0\.11 265\)/);
  assert.match(html, /title="Fern \(default\)"/);
  assert.match(html, /title="Indigo"/);
  assert.match(html, /title="Clay"/);
  assert.match(html, /title="Moss"/);
});

test('reading scale range carries bounds, current value, and a percent label', () => {
  const html = renderSettingsHtml(baseState({ preferences: { theme: 'light', accent: 'fern', chromeOS: 'mac', readingScale: 1.05 } }), baseModel());
  assert.match(html, /type="range" min="0.85" max="1.25" step="0.05" value="1.05" data-reading-scale/);
  assert.match(html, />105%</);
  assert.match(html, /Applies to the editor and preview only\./);
});

// ---- Intelligence ---------------------------------------------------------

test('no provider configured: disabled switch, invitation copy, Off card active', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'intelligence',  semanticStatus: { available: false, backend: null } }), baseModel());
  assert.match(html, /data-action="toggle-semantic-search"[^>]* disabled/);
  assert.doesNotMatch(html, /class="switch is-on" data-action="toggle-semantic-search"/);
  assert.match(html, /Pick a provider below to enable searching the library by meaning\./);
  assert.match(html, /provider-card is-active" data-action="set-ai-provider" data-backend="none"/);
  assert.doesNotMatch(html, /data-action="reindex-embeddings"/);
});

test('ollama provider selected: generic config fields without a key input', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'intelligence', 
    semanticStatus: { available: true, enabled: false, backend: 'ollama', connected: false, embeddedCount: 0, totalCount: 10, baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text', keyRequired: false },
  }), baseModel());
  assert.match(html, /provider-card is-active" data-action="set-ai-provider" data-backend="ollama"/);
  assert.match(html, /Ollama · disconnected · 0\/10 documents embedded/);
  assert.match(html, /data-ai-base-url value="http:\/\/127\.0\.0\.1:11434"/);
  assert.match(html, /data-ai-model value="nomic-embed-text"/);
  assert.match(html, /data-action="save-ai-provider"/);
  assert.doesNotMatch(html, /data-ai-key/);
  assert.doesNotMatch(html, /data-action="reindex-embeddings"/);
  assert.doesNotMatch(html, /data-action="toggle-semantic-search"[^>]* disabled/);
});

test('key-required providers get a write-only key field that never echoes the key', () => {
  for (const backend of ['openai', 'gemini', 'voyage']) {
    const html = renderSettingsHtml(baseState({ settingsTab: 'intelligence', 
      semanticStatus: { available: true, enabled: true, backend, connected: true, embeddedCount: 9, totalCount: 10, baseUrl: 'https://example.test/v1', model: 'some-model', hasApiKey: true, keyRequired: true },
    }), baseModel());
    assert.match(html, new RegExp(`provider-card is-active" data-action="set-ai-provider" data-backend="${backend}"`));
    assert.match(html, /data-ai-key value=""/);
    assert.match(html, /placeholder="•••••••• saved — enter to replace"/);
    assert.match(html, /type="password"/);
  }
});

test('llama.cpp shows an optional key field; reindex appears when enabled', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'intelligence', 
    semanticStatus: { available: true, enabled: true, backend: 'llamacpp', connected: true, embeddedCount: 2, totalCount: 2, baseUrl: 'http://127.0.0.1:8080/v1', model: '', keyRequired: false, hasApiKey: false },
  }), baseModel());
  assert.match(html, /provider-card is-active" data-action="set-ai-provider" data-backend="llamacpp"/);
  assert.match(html, /API key \(optional\)/);
  assert.match(html, /data-action="reindex-embeddings"[^>]*>Re-index</);
});

test('all six provider cards render as buttons with backend payloads', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'intelligence',  semanticStatus: { available: false, backend: null } }), baseModel());
  for (const backend of ['none', 'ollama', 'openai', 'voyage', 'gemini', 'llamacpp']) {
    assert.match(html, new RegExp(`<button[^>]*data-action="set-ai-provider" data-backend="${backend}"`));
  }
  assert.match(html, /Claude · Voyage AI/);
});
// ---- Data & admin ----------------------------------------------------------

test('task export rows carry actions and the active project name', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data' }), baseModel());
  assert.match(html, /Export tasks as JSON/);
  assert.match(html, /data-action="export-project-tasks"/);
  assert.match(html, /data-action="export-all-tasks"/);
  assert.match(html, /Every task and checklist item in Homelab\./);
});

test('library export row carries actions and the active document count', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data' }), baseModel());
  assert.match(html, /Export library as Markdown/);
  assert.match(html, /data-action="export-library-project"/);
  assert.match(html, /data-action="export-library-all"/);
  assert.match(html, /4 documents in Homelab\./);
});

test('import row: action, mode radios with checked state, file input, no replace confirm in skip mode', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data',  adminImportMode: 'skip' }), baseModel());
  assert.match(html, /data-action="import-tasks"/);
  assert.match(html, /name="import-mode" value="skip" checked/);
  assert.match(html, /name="import-mode" value="append"/);
  assert.match(html, /name="import-mode" value="replace"/);
  assert.doesNotMatch(html, /value="append" checked/);
  assert.doesNotMatch(html, /value="replace" checked/);
  assert.match(html, /Skip duplicates/);
  assert.match(html, /Append/);
  assert.match(html, /Replace project/);
  assert.match(html, /data-import-file accept="application\/json,\.json"/);
  assert.doesNotMatch(html, /data-replace-confirm/);
});

test('import row marks the append mode checked', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data',  adminImportMode: 'append' }), baseModel());
  assert.match(html, /value="append" checked/);
  assert.doesNotMatch(html, /value="skip" checked/);
});

test('replace mode reveals the REPLACE confirmation input', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data',  adminImportMode: 'replace' }), baseModel());
  assert.match(html, /value="replace" checked/);
  assert.match(html, /data-replace-confirm placeholder="REPLACE"/);
});

// ---- Maintenance -----------------------------------------------------------

test('maintenance block: group label, project filter with selected option, refresh action', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data',  maintenanceProjectFilter: 'p2' }), baseModel());
  assert.match(html, /class="group-label"[^>]*>MAINTENANCE</);
  assert.match(html, /data-maintenance-project-filter/);
  assert.match(html, /<option value="all">All projects<\/option>/);
  assert.match(html, /<option value="p1">Homelab<\/option>/);
  assert.match(html, /<option value="p2" selected>Work<\/option>/);
  assert.match(html, /data-action="refresh-maintenance"[^>]*>Refresh</);
});

test('maintenance filter defaults to the all option selected', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data' }), baseModel());
  assert.match(html, /<option value="all" selected>All projects<\/option>/);
});

test('maintenance lists render empty states by default', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data' }), baseModel());
  assert.match(html, /No stale documents\./);
  assert.match(html, /No orphan documents\./);
});

test('stale docs render as doc-rows with joined stale sources and an open button with both ids', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data', 
    staleDocs: [{
      documentId: 'd1',
      projectId: 'p1',
      title: 'Old summary',
      staleSources: [{ title: 'Source A' }, { title: 'Source B' }],
    }],
  }), baseModel());
  assert.match(html, /class="doc-row"/);
  assert.match(html, /doc-row__title">Old summary</);
  assert.match(html, /stale sources: Source A, Source B/);
  assert.match(html, /data-action="open-library-doc" data-library-document-id="d1" data-library-project-id="p1"/);
  assert.doesNotMatch(html, /No stale documents\./);
});

test('orphan docs render as doc-rows with open buttons carrying both ids', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data', 
    orphanDocs: [{ documentId: 'd2', projectId: 'p2', title: 'Sprint notes' }],
  }), baseModel());
  assert.match(html, /doc-row__title">Sprint notes</);
  assert.match(html, /data-action="open-library-doc" data-library-document-id="d2" data-library-project-id="p2"/);
  assert.doesNotMatch(html, /No orphan documents\./);
});

// ---- Footer ----------------------------------------------------------------

test('stats footer joins task, project, and document counts', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data' }), baseModel());
  assert.match(html, /class="stats-foot">12 tasks · 3 projects · 8 documents</);
});

test('reset preferences row carries the reset action', () => {
  const html = renderSettingsHtml(baseState({ settingsTab: 'data' }), baseModel());
  assert.match(html, /data-action="reset-preferences"[^>]*>Reset preferences</);
});

// ---- XSS -------------------------------------------------------------------

test('escapes backend name, doc titles, sources, and project names', () => {
  const hostile = {
    semanticStatus: { available: true, enabled: true, backend: '<script>alert(1)</script>', connected: true, embeddedCount: 1, totalCount: 1 },
    projects: [{ id: 'p1', name: '<script>proj</script>' }],
    staleDocs: [{
      documentId: 'd1',
      projectId: 'p1',
      title: '<script>stale</script>',
      staleSources: [{ title: '<script>src</script>' }],
    }],
    orphanDocs: [{ documentId: 'd2', title: '<script>orphan</script>' }],
  };
  const intel = renderSettingsHtml(baseState({ ...hostile, settingsTab: 'intelligence' }), baseModel({ activeProjectName: '<script>active</script>' }));
  const data = renderSettingsHtml(baseState({ ...hostile, settingsTab: 'data' }), baseModel({ activeProjectName: '<script>active</script>' }));
  assert.ok(!intel.includes('<script>'));
  assert.ok(!data.includes('<script>'));
  assert.match(intel, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(data, /&lt;script&gt;proj&lt;\/script&gt;/);
  assert.match(data, /&lt;script&gt;stale&lt;\/script&gt;/);
  assert.match(data, /&lt;script&gt;src&lt;\/script&gt;/);
  assert.match(data, /&lt;script&gt;orphan&lt;\/script&gt;/);
  assert.match(data, /&lt;script&gt;active&lt;\/script&gt;/);
});

test('appearance offers the editor line-numbers switch reflecting the preference', () => {
  const off = renderSettingsHtml(baseState(), baseModel());
  assert.match(off, /data-action="toggle-line-numbers"/);
  assert.doesNotMatch(off, /toggle-line-numbers"[^>]*aria-checked="true"/);
  const on = renderSettingsHtml(baseState({ preferences: { ...baseState().preferences, lineNumbers: true } }), baseModel());
  assert.match(on, /class="switch is-on"[^>]*data-action="toggle-line-numbers"/);
});
