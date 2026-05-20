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

test('settings panel renders both desktop and mobile modal headers', () => {
  const html = renderSettingsPanelHtml({ preferences: { fontScale: 'comfortable', palette: 'console' } });
  assert.match(html, /class="modal-header--desktop"/);
  assert.match(html, /class="modal-header--mobile"/);
  assert.match(html, /data-action="close-settings"/);
});
