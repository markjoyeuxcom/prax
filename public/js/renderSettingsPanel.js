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
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Preferences</span>
              <h2 id="settings-title">Settings</h2>
              <p>Stored locally in this browser. No cookies, no server sync.</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="close-settings" aria-label="Close Settings">[x] close</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-settings">cancel</button>
            <h2 class="modal-header__title">settings</h2>
            <span></span>
          </div>
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
