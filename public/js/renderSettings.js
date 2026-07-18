import { escapeHtml } from './renderHelpers.js';
import {
  ACCENT_CSS,
  ACCENT_OPTIONS,
  READING_SCALE_MIN,
  READING_SCALE_MAX,
} from './preferences.js';

// Settings view — Appearance / Intelligence / Integrations / Data & admin cards.
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

// Fern is the token default (no --accent-choice override), so the swatch shows
// the vivid choice before the theme derives its contrast-safe working accent.
const FERN_SWATCH_CSS = 'oklch(0.60 0.09 175)';

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
          <div class="settings-row__label">Preview font</div>
          <div class="settings-row__desc">Font for the rendered preview. Serif reads like a document; sans matches the app; mono suits code-heavy runbooks. Headings stay sans.</div>
        </div>
        <div class="seg">
          ${[['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']].map(([font, label]) => {
            const on = (preferences.previewFont || 'serif') === font;
            return `<button type="button"${on ? ' class="is-active"' : ''} data-action="set-preview-font" data-font="${font}" aria-pressed="${on}">${label}</button>`;
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
        <input class="range" type="range" min="${READING_SCALE_MIN}" max="${READING_SCALE_MAX}" step="0.05" value="${scale}" data-reading-scale aria-label="Reading text size" style="width:100%; margin-top:8px;">
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

// Chat (AI-answer) providers for Ask Prax / post-mortems / runbook generation.
const CHAT_PROVIDERS = [
  { key: 'none', label: 'Off', desc: 'Ask Prax returns sources only — no written answer' },
  { key: 'gemini', label: 'Gemini', desc: 'Google — fast + cheap, needs an API key' },
  { key: 'anthropic', label: 'Claude', desc: 'Anthropic — strong grounding, needs an API key' },
  { key: 'openai', label: 'OpenAI', desc: 'GPT models — needs an API key' },
  { key: 'ollama', label: 'Ollama', desc: 'Local model — private, no key' },
  { key: 'llamacpp', label: 'llama.cpp', desc: 'Your llama-server (OpenAI-compatible)' },
];

function providerCard(provider, activeBackend, action = 'set-ai-provider', disabled = false) {
  const active = activeBackend === provider.key
    || (provider.key === 'none' && (!activeBackend || activeBackend === 'none'));
  return `
          <button type="button" class="provider-card${active ? ' is-active' : ''}" data-action="${action}" data-backend="${provider.key}"${disabled ? ' disabled' : ''}>
            <div class="provider-card__label">${provider.label}</div>
            <div class="provider-card__desc">${provider.desc}</div>
          </button>`;
}

// The "AI answers" sub-section — the chat provider that powers Ask Prax. Mirrors
// the semantic provider block; its config inputs use data-ai-chat-* so they
// don't collide with the embedding ones.
function renderChatSection(state) {
  const status = state.chatStatus && typeof state.chatStatus === 'object' ? state.chatStatus : { available: false };
  const backend = status.backend || 'none';
  const meta = CHAT_PROVIDERS.find((p) => p.key === backend);
  const available = status.available === true;
  const pending = Boolean(state.intelligenceSettingsPending);
  const locked = pending || Boolean(status.loadError) || Boolean(status.loading);
  const draft = state.chatSettingsDraft?.backend === backend ? state.chatSettingsDraft : null;
  const statusLine = status.loading
    ? 'Checking answer-model status…'
    : status.loadError
      ? `<span role="alert" style="color:var(--danger);">${escapeHtml(status.loadError)}</span> <button class="settings-link" type="button" data-action="retry-intelligence-status">Retry status</button>`
      : available
        ? `${escapeHtml(meta ? meta.label : backend)}${status.model ? ` · ${escapeHtml(status.model)}` : ''} · ${status.connected ? 'connected' : 'not reachable'}`
        : 'Off — Ask Prax shows the relevant sources without a written answer. Pick a model to synthesize grounded, cited answers.';

  const providers = `
    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Answer model</div>
        <div class="provider-grid">
          ${CHAT_PROVIDERS.map((provider) => providerCard(provider, backend, 'set-ai-chat-provider', locked)).join('')}
        </div>
      </div>
    </div>`;

  let configRows = '';
  if (backend !== 'none' && backend !== 'fake') {
    const keyRequired = status.keyRequired === true;
    const showKey = keyRequired || backend === 'llamacpp';
    const keyLabel = keyRequired ? 'API key' : 'API key (optional)';
    const keyPlaceholder = status.hasApiKey ? '•••••••• saved — enter to replace' : (keyRequired ? 'required' : 'none');
    configRows = `
    <div class="settings-row">
      <div class="settings-row__text" style="display:flex; flex-direction:column; gap:8px;">
        <div class="settings-row__label">${meta ? meta.label : escapeHtml(backend)} configuration</div>
        <div class="editor-info__field"><label>Base URL</label><input class="text-input" type="text" data-ai-chat-base-url value="${escapeHtml(draft?.baseUrl ?? status.baseUrl ?? '')}"${locked ? ' disabled' : ''}></div>
        <div class="editor-info__field"><label>Model</label><input class="text-input" type="text" data-ai-chat-model value="${escapeHtml(draft?.model ?? status.model ?? '')}"${locked ? ' disabled' : ''}></div>
        ${showKey ? `<div class="editor-info__field"><label>${keyLabel}</label><input class="text-input" type="password" data-ai-chat-key value="${escapeHtml(draft?.apiKey || '')}" placeholder="${keyPlaceholder}" autocomplete="off"${locked ? ' disabled' : ''}></div>
        <div class="settings-row__desc">The key is stored in the local database and never returned by the API.</div>` : ''}
        <div style="display:flex; justify-content:flex-end;"><button class="btn-outline" type="button" data-action="save-ai-chat"${locked ? ' disabled' : ''}${pending ? ' aria-busy="true"' : ''}>${pending ? 'Saving…' : 'Save &amp; test connection'}</button></div>
      </div>
    </div>`;
  }

  return `
    <div class="settings-row" style="border-top:1px solid var(--line2); margin-top:10px; padding-top:16px;">
      <div class="settings-row__text">
        <div class="settings-row__label">AI answers</div>
        <div class="settings-row__desc">${statusLine}</div>
      </div>
    </div>
    ${providers}
    ${configRows}`;
}

function renderIntelligenceCard(state) {
  const status = state.semanticStatus && typeof state.semanticStatus === 'object' ? state.semanticStatus : { available: false };
  const available = status.available === true;
  const enabled = available && status.enabled === true;
  const backend = status.backend || 'none';
  const providerMeta = AI_PROVIDERS.find((p) => p.key === backend);
  const pending = Boolean(state.intelligenceSettingsPending);
  const locked = pending || Boolean(status.loadError) || Boolean(status.loading);
  const draft = state.semanticSettingsDraft?.backend === backend ? state.semanticSettingsDraft : null;

  const statusLine = status.loading
    ? 'Checking semantic-search status…'
    : status.loadError
      ? `<span role="alert" style="color:var(--danger);">${escapeHtml(status.loadError)}</span> <button class="settings-link" type="button" data-action="retry-intelligence-status">Retry status</button>`
      : available
        ? `${escapeHtml(providerMeta ? providerMeta.label : status.backend)} · ${status.connected ? 'connected' : 'disconnected'} · ${Number(status.embeddedCount) || 0}/${Number(status.totalCount) || 0} documents embedded`
        : 'Pick a provider below to enable searching the library by meaning.';

  const providers = `
    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Provider</div>
        <div class="provider-grid">
          ${AI_PROVIDERS.map((provider) => providerCard(provider, backend, 'set-ai-provider', locked)).join('')}
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
        <div class="editor-info__field"><label>Base URL</label><input class="text-input" type="text" data-ai-base-url value="${escapeHtml(draft?.baseUrl ?? status.baseUrl ?? '')}"${locked ? ' disabled' : ''}></div>
        <div class="editor-info__field"><label>Embedding model</label><input class="text-input" type="text" data-ai-model value="${escapeHtml(draft?.model ?? status.model ?? '')}"${locked ? ' disabled' : ''}></div>
        ${showKey ? `<div class="editor-info__field"><label>${keyLabel}</label><input class="text-input" type="password" data-ai-key value="${escapeHtml(draft?.apiKey || '')}" placeholder="${keyPlaceholder}" autocomplete="off"${locked ? ' disabled' : ''}></div>
        <div class="settings-row__desc">The key is stored in the local database and never returned by the API.</div>` : ''}
        <div style="display:flex; justify-content:flex-end;"><button class="btn-outline" type="button" data-action="save-ai-provider"${locked ? ' disabled' : ''}${pending ? ' aria-busy="true"' : ''}>${pending ? 'Saving…' : 'Save &amp; test connection'}</button></div>
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
      <button type="button" class="switch${enabled ? ' is-on' : ''}" data-action="toggle-semantic-search" aria-pressed="${enabled}" aria-label="Toggle semantic search"${available && !locked ? '' : ' disabled'}${pending ? ' aria-busy="true"' : ''}><span></span></button>
    </div>
    ${providers}
    ${configRows}
    ${indexRow}
    ${renderChatSection(state)}
  </section>`;
}

// Last-sync timestamps render as local date + time; an unparseable value falls
// back to the raw string rather than "Invalid Date".
function formatSyncTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Integrations tab — Google Calendar one-way push. Mirrors the Intelligence
// card's conventions: real backend status only, write-only secret (never
// echoed — hasClientSecret drives a placeholder), pending locks every
// consequential control, degraded notices live in state.
function renderIntegrationsCard(state) {
  const status = state.googleCalendarStatus && typeof state.googleCalendarStatus === 'object'
    ? state.googleCalendarStatus
    : null;
  const draft = state.googleCalendarDraft && typeof state.googleCalendarDraft === 'object'
    ? state.googleCalendarDraft
    : { clientId: '', clientSecret: '' };
  const pending = Boolean(state.googleCalendarPending);
  const loading = !status || status.loading === true;
  const locked = pending || loading || Boolean(status?.loadError);
  const configured = status?.configured === true;
  const connected = status?.connected === true;

  const statusLine = loading
    ? 'Checking Google Calendar status…'
    : status.loadError
      ? `<span role="alert" style="color:var(--danger);">${escapeHtml(status.loadError)}</span> <button class="settings-link" type="button" data-action="retry-google-calendar-status">Retry status</button>`
      : connected
        ? `Connected${status.accountEmail ? ` as ${escapeHtml(status.accountEmail)}` : ''} — calendar created${status.lastSyncAt
          ? `; last sync: ${escapeHtml(formatSyncTime(status.lastSyncAt))} — ${escapeHtml(status.lastSyncSummary || '')}`
          : '; not synced yet'}.`
        : configured
          ? 'Configured but not connected — click Connect to sign in with Google.'
          : 'Not configured — save a Google OAuth client id and secret to begin.';

  // Sync results and degraded messages (multi-line: one line per failure).
  const notice = state.googleCalendarNotice
    ? `<div class="settings-row__desc" data-gcal-notice role="status" style="margin-top:6px; white-space:pre-line;">${escapeHtml(state.googleCalendarNotice)}</div>`
    : '';

  const secretPlaceholder = status?.hasClientSecret ? '(saved)' : 'required';

  return `
  <section class="settings-card">
    <h2 class="settings-card__title">Integrations</h2>
    <p class="settings-card__sub">Connect Prax to outside services.</p>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Google Calendar</div>
        <div class="settings-row__desc">One-way push: open tasks with a due date are copied into a dedicated “Prax” calendar in your Google account — nothing in Google is read back. Create a <strong>Desktop</strong>-type OAuth client in Google Cloud Console and paste its id and secret below.</div>
        <div class="settings-row__desc" data-gcal-status style="margin-top:6px;">${statusLine}</div>
        ${notice}
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row__text" style="display:flex; flex-direction:column; gap:8px;">
        <div class="settings-row__label">OAuth client</div>
        <div class="editor-info__field"><label>Client ID</label><input class="text-input" type="text" data-gcal-client-id value="${escapeHtml(draft.clientId || '')}" autocomplete="off"${locked ? ' disabled' : ''}></div>
        <div class="editor-info__field"><label>Client secret</label><input class="text-input" type="password" data-gcal-client-secret value="${escapeHtml(draft.clientSecret || '')}" placeholder="${secretPlaceholder}" autocomplete="off"${locked ? ' disabled' : ''}></div>
        <div class="settings-row__desc">The secret is stored in the local database and never returned by the API.</div>
        <div style="display:flex; justify-content:flex-end;"><button class="btn-outline" type="button" data-action="save-google-calendar"${locked ? ' disabled' : ''}>Save</button></div>
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Connection</div>
        <div class="settings-row__desc">Connect opens Google sign-in in a new tab; Prax notices the callback automatically. Sync now pushes open dated tasks. Disconnect keeps the “Prax” calendar in Google.</div>
      </div>
      <button class="btn-outline" type="button" data-action="connect-google-calendar"${configured && !locked ? '' : ' disabled'}>Connect</button>
      <button class="btn-outline" type="button" data-action="sync-google-calendar"${connected && !locked ? '' : ' disabled'}>Sync now</button>
      <button class="btn-outline" type="button" data-action="disconnect-google-calendar"${connected && !locked ? '' : ' disabled'}>Disconnect…</button>
    </div>
  </section>`;
}

function importModeRadio(mode, label, activeMode, { disabled = false } = {}) {
  return `
        <label style="display:inline-flex; align-items:center; gap:5px; font-size:12px;">
          <input type="radio" name="import-mode" value="${mode}"${mode === activeMode ? ' checked' : ''}${disabled ? ' disabled' : ''}>
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
  const importProject = projects.find(project => project.id === state.adminImportProjectId) || projects[0] || null;
  const importProjectName = escapeHtml(importProject?.name || 'no project');
  const importPending = Boolean(state.adminImportPending);
  const selectedFile = state.adminImportFileName
    ? `<div class="settings-row__desc" data-import-file-summary style="margin-top:6px;">Selected: ${escapeHtml(state.adminImportFileName)}</div>`
    : '';
  const importStatus = state.adminImportError
    ? `<div class="settings-row__desc" data-import-status role="status" style="margin-top:6px; color:var(--danger);">${escapeHtml(state.adminImportError)}</div>`
    : state.adminImportResult
      ? `<div class="settings-row__desc" data-import-status role="status" style="margin-top:6px;">Imported ${Number(state.adminImportResult.imported) || 0}; skipped ${Number(state.adminImportResult.skipped) || 0}${state.adminImportResult.replayed ? ' · recovered from an earlier commit' : ''}.</div>`
      : '';
  const staleDocs = Array.isArray(state.staleDocs) ? state.staleDocs : [];
  const orphanDocs = Array.isArray(state.orphanDocs) ? state.orphanDocs : [];
  const maintenanceFilter = state.maintenanceProjectFilter || 'all';
  const deployment = state.deploymentStatus && typeof state.deploymentStatus === 'object'
    ? state.deploymentStatus
    : { loading: false, error: 'Prax could not load the deployment security status.' };

  let deploymentStatus;
  if (deployment.loading) {
    deploymentStatus = '<div class="settings-row__desc" role="status">Checking bind scope…</div>';
  } else if (deployment.error) {
    deploymentStatus = `
      <div class="settings-row__desc" role="alert" style="color:var(--danger);">${escapeHtml(deployment.error)}</div>
      <button class="btn-outline" type="button" data-action="refresh-deployment-status">Retry</button>`;
  } else if (deployment.networkScope === 'network') {
    deploymentStatus = `
      <div class="settings-row__desc" role="status" style="color:var(--danger);">
        <strong>Trusted network — no authentication.</strong> Listening on ${escapeHtml(deployment.bindHost || 'a network interface')}.
        Anyone who can reach Prax can read and change this workspace. Use an authenticated TLS proxy before wider exposure.
      </div>`;
  } else {
    deploymentStatus = `
      <div class="settings-row__desc" role="status">
        <strong>Local only.</strong> Listening on ${escapeHtml(deployment.bindHost || 'loopback')}.
        Prax has no user accounts or authorization; changing the bind address requires an explicit operator acknowledgement.
      </div>`;
  }

  const replaceConfirm = importMode === 'replace'
    ? `
        <input class="text-input" type="text" data-replace-confirm placeholder="REPLACE" autocomplete="off" style="display:block; margin-top:8px;"${importPending ? ' disabled' : ''}>`
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
        <div class="settings-row__label">Deployment security</div>
        ${deploymentStatus}
      </div>
    </div>

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
        <div class="settings-row__desc">Restore tasks and checklist items into <strong>${importProjectName}</strong>.</div>
        <label class="settings-row__desc" style="display:block; margin-top:8px;">Destination
          <select class="text-input" data-import-project style="display:block; margin-top:4px;"${importPending ? ' disabled' : ''}>
            ${projects.map(project => `<option value="${escapeHtml(project.id)}"${project.id === importProject?.id ? ' selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
          </select>
        </label>
        <div style="display:flex; flex-wrap:wrap; gap:4px 14px; margin-top:8px;">
          ${importModeRadio('skip', 'Skip duplicates', importMode, { disabled: importPending })}
          ${importModeRadio('append', 'Append', importMode, { disabled: importPending })}
          ${importModeRadio('replace', 'Replace project', importMode, { disabled: importPending })}
        </div>${replaceConfirm}
        <input type="file" data-import-file accept="application/json,.json" aria-label="Task import JSON file" style="display:block; margin-top:8px; font-size:12px;"${importPending ? ' disabled' : ''}>
        ${selectedFile}${importStatus}
      </div>
      <button class="btn-outline" type="button" data-action="import-tasks"${importPending ? ' disabled aria-busy="true"' : ''}>${importPending ? 'Importing…' : 'Import…'}</button>
    </div>

    <div class="settings-row">
      <div class="settings-row__text">
        <div class="settings-row__label">Export library as Markdown</div>
        <div class="settings-row__desc">One .md file per document · ${documentCount} documents in ${projectName}.</div>
      </div>
      <button class="btn-outline" type="button" data-action="export-library-project">Export project…</button>
      <button class="btn-outline" type="button" data-action="export-library-all">Export entire library…</button>
    </div>

    <div class="group-label" style="margin-top:18px;">MAINTENANCE</div>
    <div class="settings-row" style="border-top:none;">
      <select class="text-input" data-maintenance-project-filter aria-label="Maintenance project filter">
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
  ['integrations', 'Integrations'],
  ['data', 'Data & admin'],
];

export function renderSettingsHtml(state, model = {}) {
  const preferences = state.preferences && typeof state.preferences === 'object' ? state.preferences : {};
  const tab = SETTINGS_TABS.some(([key]) => key === state.settingsTab)
    ? state.settingsTab
    : 'appearance';
  const card = tab === 'intelligence'
    ? renderIntelligenceCard(state)
    : tab === 'integrations'
      ? renderIntegrationsCard(state)
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
