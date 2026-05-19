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

function checkedMode(importMode, mode) {
  return importMode === mode ? ' checked' : '';
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
        <header class="admin-modal__header">
          <div>
            <span class="detail-kicker">Operations</span>
            <h2 id="admin-title">Admin Operations</h2>
            <p>Backup and restore controls for the selected Moomora Console context.</p>
          </div>
          <button class="icon-action" type="button" aria-label="Close Admin" data-action="close-admin">&times;</button>
        </header>

        <div class="admin-sections">
          <section class="admin-section" aria-labelledby="backup-title">
            <div>
              <h3 id="backup-title">Backup</h3>
              <p>${safeContext} &middot; ${safeTaskCount} loaded tasks &middot; Generated at download time</p>
            </div>
            <div class="admin-actions">
              <button class="secondary-action" type="button" data-action="export-context">Export ${safeContext}</button>
              <button class="secondary-action" type="button" data-action="export-all">Export All Contexts</button>
            </div>
          </section>

          <section class="admin-section" aria-labelledby="import-title">
            <div>
              <h3 id="import-title">Restore / Import</h3>
              <p>Imports apply to the selected ${safeContext} context.</p>
            </div>
            <fieldset class="admin-mode-group">
              <legend>Import mode</legend>
              <label>
                <input type="radio" name="admin-import-mode" value="skip" data-admin-import-mode="skip"${checkedMode(importMode, 'skip')}>
                <span>Skip duplicates</span>
              </label>
              <label>
                <input type="radio" name="admin-import-mode" value="append" data-admin-import-mode="append"${checkedMode(importMode, 'append')}>
                <span>Append</span>
              </label>
              <label>
                <input type="radio" name="admin-import-mode" value="replace" data-admin-import-mode="replace"${checkedMode(importMode, 'replace')}>
                <span>Replace context</span>
              </label>
            </fieldset>
            <label class="admin-input-row">
              <span>Replace confirmation</span>
              <input type="text" autocomplete="off" placeholder="Type REPLACE for replace mode" data-admin-replace-confirm>
            </label>
            <label class="admin-input-row">
              <span>Import JSON</span>
              <input type="file" accept="application/json,.json" data-admin-import-file>
            </label>
            <div>
              <h3>Import Markdown</h3>
              <p>Import one Markdown file into the selected ${safeContext} Library.</p>
            </div>
            <fieldset class="admin-mode-group">
              <legend>Document type</legend>
              <label>
                <input type="radio" name="admin-markdown-type" value="runbook" data-admin-markdown-type="runbook">
                <span>Runbook</span>
              </label>
              <label>
                <input type="radio" name="admin-markdown-type" value="note" data-admin-markdown-type="note" checked>
                <span>Note</span>
              </label>
            </fieldset>
            <label class="admin-input-row">
              <span>Import Markdown</span>
              <input type="file" accept="text/markdown,.md" data-admin-markdown-file>
            </label>
          </section>

          <section class="admin-section" aria-labelledby="archive-maintenance-title">
            <div>
              <h3 id="archive-maintenance-title">Archive Maintenance</h3>
              <p>Review archived tasks and permanently delete individual records from Archive.</p>
            </div>
            <div class="admin-actions">
              <button class="secondary-action" type="button" data-action="open-archive">Open Archive</button>
            </div>
          </section>
        </div>
      </section>
    </div>`;
}
