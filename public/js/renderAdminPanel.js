function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelFromValue(value) {
  return String(value ?? '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function radioLine(mode, label, importMode) {
  const isActive = mode === importMode;
  return `
    <label class="admin-mode-line${isActive ? ' is-active' : ''}">
      <input type="radio" name="admin-import-mode" value="${mode}" data-admin-import-mode="${mode}" class="admin-mode-line__input"${isActive ? ' checked' : ''}>
      <span class="radio-glyph${isActive ? ' is-active' : ''}">${isActive ? '(•)' : '( )'}</span>
      <span class="admin-mode-line__label">${label}</span>
    </label>`;
}


export function renderAdminPanelHtml({
  activeContext = 'homelab',
  taskCount = 0,
  importMode = 'skip',
} = {}) {
  const contextLabel = labelFromValue(activeContext);
  const safeContext = escapeHtml(contextLabel);
  const safeTaskCount = Number.isFinite(Number(taskCount)) ? Number(taskCount) : 0;

  return `
    <div class="modal-backdrop" data-admin-panel>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Operations</span>
              <h2 id="admin-title">Admin Operations</h2>
              <p>Backup and restore controls for the selected Moomora Console context.</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="close-admin" aria-label="Close Admin">[x] close</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-admin">cancel</button>
            <h2 class="modal-header__title">admin</h2>
            <span></span>
          </div>
        </header>

        <div class="admin-sections">
          <section class="admin-section" aria-labelledby="backup-title">
            <div>
              <h3 id="backup-title">Backup</h3>
              <p>${safeContext} &middot; ${safeTaskCount} loaded tasks &middot; Generated at download time</p>
            </div>
            <div class="admin-actions">
              <button class="bracket-button" type="button" data-action="export-context">[x] export ${safeContext}</button>
              <button class="bracket-button" type="button" data-action="export-all">[X] export all</button>
            </div>
          </section>

          <section class="admin-section" aria-labelledby="import-title">
            <div>
              <h3 id="import-title">Restore / Import</h3>
              <p>Imports apply to the selected ${safeContext} context.</p>
            </div>
            <fieldset class="admin-mode-group">
              <legend>Import mode</legend>
              ${radioLine('skip', 'Skip duplicates', importMode)}
              ${radioLine('append', 'Append', importMode)}
              ${radioLine('replace', 'Replace context', importMode)}
            </fieldset>
            <label class="admin-input-row">
              <span>Replace confirmation</span>
              <input type="text" autocomplete="off" placeholder="Type REPLACE for replace mode" data-admin-replace-confirm>
            </label>
            <label class="admin-input-row">
              <span>Import JSON</span>
              <input type="file" accept="application/json,.json" data-admin-import-file>
            </label>
          </section>

          <section class="admin-section" aria-labelledby="archive-maintenance-title">
            <div>
              <h3 id="archive-maintenance-title">Archive Maintenance</h3>
              <p>Review archived tasks and permanently delete individual records from Archive.</p>
            </div>
            <div class="admin-actions">
              <button class="bracket-button" type="button" data-action="open-archive">[a] open archive</button>
            </div>
          </section>
        </div>
      </section>
    </div>`;
}
