import { escapeHtml } from './renderHelpers.js';
import {
  ACCENT_CSS,
  ACCENT_OPTIONS,
  READING_SCALE_MIN,
  READING_SCALE_MAX,
} from './preferences.js';

// Settings view — Appearance / Intelligence / Data & admin cards.
// Pure state → HTML string; events delegate via data-action in main.js.
// Intelligence shows the REAL backend status (no fake provider switching);
// the old admin panel + library maintenance fold into Data & admin.

const THEME_PREVIEWS = {
  light: { bg: '#FAF9F7', bar: '#D8D6D0', bar2: '#E5E3DE' },
  dark: { bg: '#1C2220', bar: '#39423F', bar2: '#2C3331' },
};

// Reminders default to an in-app toast. Offer to upgrade to native desktop
// notifications when the platform supports them and hasn't decided yet; confirm
// when already granted. Guarded so the pure render is safe where Notification
// is undefined (Node tests, older webviews).
function remindersNotifHint(preferences) {
  if (!preferences.reminders) return '';
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  if (perm === 'default') return ' <button class="settings-link" type="button" data-action="enable-desktop-notifications">Enable desktop notifications</button>';
  if (perm === 'granted') return ' Desktop notifications are on.';
  return '';
}

const ACCENT_TITLES = {
  fern: 'Fern (default)',
  teal: 'Teal',
  sky: 'Sky',
  indigo: 'Indigo',
  plum: 'Plum',
  rose: 'Rose',
  amber: 'Amber',
  clay: 'Clay',
  moss: 'Moss',
};

// Fern is the token default (no --accent override), so the swatch shows the
// light-theme fern token value directly.
const FERN_SWATCH_CSS = 'oklch(0.52 0.09 175)';

function themeCard(key, label, activeTheme) {
  const pv = THEME_PREVIEWS[key];
  const active = activeTheme === key;
  return `
    <button type="button" class="theme-card${active ? ' is-active' : ''}" data-action="set-theme" data-theme="${key}">
      <div class="theme-card__preview" style="background:${pv.bg};">
        <div class="theme-card__bar" style="background:${pv.bar}; width:60%;"></div>
        <div class="theme-card__bar" style="background:${pv.bar2}; width:82%;"></div>
        <div class="theme-card__bar" style="background:var(--accent); width:40%;"></div>
      </div>
      <div class="theme-card__label">${label}</div>
    </button>`;
}

function chromeButton(key, label, activeChrome) {
  const active = activeChrome === key;
  return `<button type="button"${active ? ' class="is-active"' : ''} data-action="set-chrome" data-chrome="${key}" aria-pressed="${active}">${label}</button>`;
}

function accentSwatch(key, activeAccent) {
  const css = ACCENT_CSS[key] || FERN_SWATCH_CSS;
  const active = activeAccent === key;
  return `<button type="button" class="swatch${active ? ' is-active' : ''}" data-action="set-accent" data-accent="${key}" title="${escapeHtml(ACCENT_TITLES[key] || key)}" style="background:${css};"></button>`;
}

function renderAppearanceCard(preferences) {
  const theme = preferences.theme === 'dark' ? 'dark' : 'light';
  const chrome = preferences.chromeOS === 'win' ? 'win' : 'mac';
  const accent = ACCENT_OPTIONS.includes(preferences.accent) ? preferences.accent : 'fern';
  const scale = Number.isFinite(Number(preferences.readingScale)) ? Number(preferences.readingScale) : 1;
  const scaleLabel = `${Math.round(scale * 100)}%`;

  return `
  <section class="settings-card">
    <h2 class="settings-card__title">Appearance</h2>
    <p class="settings-card__sub">Theme, window chrome, accent, and reading size.</p>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Theme</div>
        <div style="display:flex; gap:10px; margin-top:8px;">
          ${themeCard('light', 'Light', theme)}
          ${themeCard('dark', 'Dark', theme)}
        </div>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Window controls</div>
        <div class="settings-row__desc">Traffic lights or Windows controls in the titlebar.</div>
      </div>
      <div class="seg">
        ${chromeButton('mac', 'macOS', chrome)}
        ${chromeButton('win', 'Windows', chrome)}
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Accent</div>
        <div class="settings-row__desc">Used for selection, highlights, and buttons.</div>
      </div>
      <div style="display:flex; gap:9px;">
        ${ACCENT_OPTIONS.map((key) => accentSwatch(key, accent)).join('')}
      </div>
    </div>

    <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">Editor line numbers</div>
          <div class="settings-row__desc">Show a line-number gutter in the Markdown editor.</div>
        </div>
        <button class="switch${preferences.lineNumbers ? ' is-on' : ''}" type="button" data-action="toggle-line-numbers" role="switch" aria-checked="${Boolean(preferences.lineNumbers)}" aria-label="Editor line numbers"><span></span></button>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">Editor engine <span class="settings-badge">experimental</span></div>
          <div class="settings-row__desc">CodeMirror is the default; “Plain” is a lightweight textarea spike (no 275&nbsp;KB dependency).</div>
        </div>
        <div class="seg">
          ${['codemirror', 'plain'].map((eng) => {
            const on = (preferences.editorEngine || 'codemirror') === eng;
            return `<button type="button"${on ? ' class="is-active"' : ''} data-action="set-editor-engine" data-engine="${eng}" aria-pressed="${on}">${eng === 'plain' ? 'Plain' : 'CodeMirror'}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">Editor font</div>
          <div class="settings-row__desc">Proportional (Instrument&nbsp;Sans) reads like prose; monospace aligns code and keeps bold&nbsp;/&nbsp;italic. In proportional mode the plain editor shows emphasis by colour so its caret stays exact.</div>
        </div>
        <div class="seg">
          ${['proportional', 'monospace'].map((font) => {
            const on = (preferences.editorFont || 'proportional') === font;
            return `<button type="button"${on ? ' class="is-active"' : ''} data-action="set-editor-font" data-font="${font}" aria-pressed="${on}">${font === 'monospace' ? 'Monospace' : 'Proportional'}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__text">
          <div class="settings-row__label">Due-date reminders</div>
          <div class="settings-row__desc">Nudge you when a task is due or overdue while Prax is open.${remindersNotifHint(preferences)}</div>
        </div>
        <button class="switch${preferences.reminders ? ' is-on' : ''}" type="button" data-action="toggle-reminders" role="switch" aria-checked="${Boolean(preferences.reminders)}" aria-label="Due-date reminders"><span></span></button>
      </div>
      <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label" style="display:flex; align-items:center; justify-content:space-between;">
          <span>Reading text size</span>
          <span style="font-weight:450; color:var(--ink3);">${scaleLabel}</span>
        </div>
        <input class="range" type="range" min="${READING_SCALE_MIN}" max="${READING_SCALE_MAX}" step="0.05" value="${scale}" data-reading-scale style="width:100%; margin-top:8px;">
        <div class="settings-row__desc">Applies to the editor and preview only.</div>
      </div>
    </div>
  </section>`;
}

const AI_PROVIDERS = [
  { key: 'none', label: 'Off', desc: 'Keyword search only' },
  { key: 'ollama', label: 'Ollama', desc: 'Local or remote server — private by default' },
  { key: 'openai', label: 'OpenAI', desc: 'ChatGPT\u2019s embeddings — needs an API key' },
  { key: 'voyage', label: 'Claude \u00b7 Voyage AI', desc: 'Anthropic\u2019s embeddings partner — needs a Voyage key' },
  { key: 'gemini', label: 'Gemini', desc: 'Google\u2019s embeddings — needs an API key' },
  { key: 'llamacpp', label: 'llama.cpp', desc: 'Your llama-server (OpenAI-compatible)' },
];

function providerCard(provider, activeBackend) {
  const active = activeBackend === provider.key
    || (provider.key === 'none' && (!activeBackend || activeBackend === 'none'));
  return `
          <button type="button" class="provider-card${active ? ' is-active' : ''}" data-action="set-ai-provider" data-backend="${provider.key}">
            <div class="provider-card__label">${provider.label}</div>
            <div class="provider-card__desc">${provider.desc}</div>
          </button>`;
}

function renderIntelligenceCard(semanticStatus) {
  const status = semanticStatus && typeof semanticStatus === 'object' ? semanticStatus : { available: false };
  const available = status.available === true;
  const enabled = available && status.enabled === true;
  const backend = status.backend || 'none';
  const providerMeta = AI_PROVIDERS.find((p) => p.key === backend);

  const statusLine = available
    ? `${escapeHtml(providerMeta ? providerMeta.label : status.backend)} · ${status.connected ? 'connected' : 'disconnected'} · ${Number(status.embeddedCount) || 0}/${Number(status.totalCount) || 0} documents embedded`
    : 'Pick a provider below to enable searching the library by meaning.';

  const providers = `
    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Provider</div>
        <div class="provider-grid">
          ${AI_PROVIDERS.map((provider) => providerCard(provider, backend)).join('')}
        </div>
      </div>
    </div>`;

  // Generic per-provider configuration: every real backend has a base URL and
  // model; the key field appears when the backend needs (or accepts) one.
  let configRows = '';
  if (backend !== 'none' && backend !== 'fake') {
    const keyRequired = status.keyRequired === true;
    const showKey = keyRequired || backend === 'llamacpp';
    const keyLabel = keyRequired ? 'API key' : 'API key (optional)';
    const keyPlaceholder = status.hasApiKey ? '•••••••• saved — enter to replace' : (keyRequired ? 'required' : 'none');
    configRows = `
    <div class="settings-row">
      <div class="settings-row__text" style="display:flex; flex-direction:column; gap:8px;">
        <div class="settings-row__label">${providerMeta ? providerMeta.label : escapeHtml(backend)} configuration</div>
        <div class="editor-info__field"><label>Base URL</label><input class="text-input" type="text" data-ai-base-url value="${escapeHtml(status.baseUrl || '')}"></div>
        <div class="editor-info__field"><label>Embedding model</label><input class="text-input" type="text" data-ai-model value="${escapeHtml(status.model || '')}"></div>
        ${showKey ? `<div class="editor-info__field"><label>${keyLabel}</label><input class="text-input" type="password" data-ai-key value="" placeholder="${keyPlaceholder}" autocomplete="off"></div>
        <div class="settings-row__desc">The key is stored in the local database and never returned by the API.</div>` : ''}
        <div style="display:flex; justify-content:flex-end;"><button class="btn-outline" type="button" data-action="save-ai-provider">Save &amp; test connection</button></div>
      </div>
    </div>`;
  }

  const indexRow = enabled ? `
    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Embedding index</div>
        <div class="settings-row__desc">Re-index new or changed documents, or rebuild every embedding.</div>
      </div>
      <button class="btn-outline" type="button" data-action="reindex-embeddings">Re-index</button>
      <button class="btn-outline" type="button" data-action="force-reindex-embeddings">Rebuild all</button>
    </div>` : '';

  return `
  <section class="settings-card">
    <h2 class="settings-card__title">Intelligence</h2>
    <p class="settings-card__sub">Search the library by meaning as well as keywords. Adds the Semantic toggle to the library search.</p>

    <div class="settings-row"${available ? '' : ' style="opacity:.7;"'}>
      <div class="settings-row__text">
        <div class="settings-row__label">Semantic search</div>
        <div class="settings-row__desc">${statusLine}</div>
      </div>
      <button type="button" class="switch${enabled ? ' is-on' : ''}" data-action="toggle-semantic-search" aria-pressed="${enabled}" aria-label="Toggle semantic search"${available ? '' : ' disabled'}><span></span></button>
    </div>
    ${providers}
    ${configRows}
    ${indexRow}
  </section>`;
}

function importModeRadio(mode, label, activeMode) {
  return `
        <label style="display:inline-flex; align-items:center; gap:5px; font-size:12px;">
          <input type="radio" name="import-mode" value="${mode}"${mode === activeMode ? ' checked' : ''}>
          ${label}
        </label>`;
}

function maintenanceDocRow(doc, { withSources } = {}) {
  const sources = withSources && Array.isArray(doc.staleSources) && doc.staleSources.length > 0
    ? `<span style="flex:none; max-width:45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11.5px; color:var(--ink3);">stale sources: ${doc.staleSources.map((s) => escapeHtml(s?.title || '')).join(', ')}</span>`
    : '';
  const projectAttr = doc.projectId ? ` data-library-project-id="${escapeHtml(doc.projectId)}"` : '';
  return `
        <div class="doc-row">
          <span class="doc-row__title">${escapeHtml(doc.title || 'Untitled')}</span>
          ${sources}
          <button class="btn-outline" type="button" data-action="open-library-doc" data-library-document-id="${escapeHtml(doc.documentId)}"${projectAttr}>Open</button>
        </div>`;
}

function renderDataCard(state, model) {
  const projectName = escapeHtml(model.activeProjectName || 'all projects');
  const documentCount = Number(model.activeDocumentCount) || 0;
  const stats = model.stats && typeof model.stats === 'object' ? model.stats : {};
  const importMode = ['skip', 'append', 'replace'].includes(state.adminImportMode) ? state.adminImportMode : 'skip';
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const staleDocs = Array.isArray(state.staleDocs) ? state.staleDocs : [];
  const orphanDocs = Array.isArray(state.orphanDocs) ? state.orphanDocs : [];
  const maintenanceFilter = state.maintenanceProjectFilter || 'all';

  const replaceConfirm = importMode === 'replace'
    ? `
        <input class="text-input" type="text" data-replace-confirm placeholder="REPLACE" autocomplete="off" style="display:block; margin-top:8px;">`
    : '';

  const staleList = staleDocs.length === 0
    ? '<p class="settings-row__desc">No stale documents.</p>'
    : staleDocs.map((doc) => maintenanceDocRow(doc, { withSources: true })).join('');
  const orphanList = orphanDocs.length === 0
    ? '<p class="settings-row__desc">No orphan documents.</p>'
    : orphanDocs.map((doc) => maintenanceDocRow(doc, { withSources: false })).join('');

  return `
  <section class="settings-card">
    <h2 class="settings-card__title">Data &amp; admin</h2>
    <p class="settings-card__sub">Backups, imports, and library maintenance.</p>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Export tasks as JSON</div>
        <div class="settings-row__desc">Every task and checklist item in ${projectName}.</div>
      </div>
      <button class="btn-outline" type="button" data-action="export-project-tasks">Export</button>
      <button class="btn-outline" type="button" data-action="export-all-tasks">Export all projects</button>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Import tasks from JSON</div>
        <div class="settings-row__desc">Merge a previous export into ${projectName}.</div>
        <div style="display:flex; flex-wrap:wrap; gap:4px 14px; margin-top:8px;">
          ${importModeRadio('skip', 'Skip duplicates', importMode)}
          ${importModeRadio('append', 'Append', importMode)}
          ${importModeRadio('replace', 'Replace project', importMode)}
        </div>${replaceConfirm}
        <input type="file" data-import-file accept="application/json,.json" style="display:block; margin-top:8px; font-size:12px;">
      </div>
      <button class="btn-outline" type="button" data-action="import-tasks">Import…</button>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Export library as Markdown</div>
        <div class="settings-row__desc">One .md file per document · ${documentCount} documents in ${projectName}.</div>
      </div>
      <button class="btn-outline" type="button" data-action="export-library-project">Export</button>
      <button class="btn-outline" type="button" data-action="export-library-all">Export entire library</button>
    </div>

    <div class="group-label" style="margin-top:18px;">MAINTENANCE</div>
    <div class="settings-row" style="border-top:none;">
      <select class="text-input" data-maintenance-project-filter>
        <option value="all"${maintenanceFilter === 'all' ? ' selected' : ''}>All projects</option>
        ${projects.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === maintenanceFilter ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
      <span style="flex:1;"></span>
      <button class="btn-outline" type="button" data-action="refresh-maintenance">Refresh</button>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Stale documents</div>
        <div class="settings-row__desc">Derived documents whose source changed since the link was created.</div>
        <div style="margin-top:8px;">
          ${staleList}
        </div>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Orphan documents</div>
        <div class="settings-row__desc">Documents with no inbound or outbound links.</div>
        <div style="margin-top:8px;">
          ${orphanList}
        </div>
      </div>
    </div>

    <div class="stats-foot">${Number(stats.tasks) || 0} tasks · ${Number(stats.projects) || 0} projects · ${Number(stats.documents) || 0} documents</div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Preferences</div>
        <div class="settings-row__desc">Restore the default theme, accent, window controls, and text size.</div>
      </div>
      <button class="btn-outline" type="button" data-action="reset-preferences">Reset preferences</button>
    </div>
  </section>`;
}

const SETTINGS_TABS = [
  ['appearance', 'Appearance'],
  ['intelligence', 'Intelligence'],
  ['data', 'Data & admin'],
];

export function renderSettingsHtml(state, model = {}) {
  const preferences = state.preferences && typeof state.preferences === 'object' ? state.preferences : {};
  const tab = SETTINGS_TABS.some(([key]) => key === state.settingsTab)
    ? state.settingsTab
    : 'appearance';
  const card = tab === 'intelligence'
    ? renderIntelligenceCard(state.semanticStatus)
    : tab === 'data'
      ? renderDataCard(state, model)
      : renderAppearanceCard(preferences);
  return `
  <div class="page page--settings">
    <div class="page-head">
      <h1 class="page-head__title">Settings</h1>
    </div>
    <nav class="tabs" aria-label="Settings sections">
      ${SETTINGS_TABS.map(([key, label]) => `<button class="tabs__tab${tab === key ? ' is-active' : ''}" type="button" data-action="set-settings-tab" data-tab="${key}"${tab === key ? ' aria-current="true"' : ''}>${escapeHtml(label)}</button>`).join('')}
    </nav>
    <div class="settings">
      ${card}
    </div>
  </div>`;
}
