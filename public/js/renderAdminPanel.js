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
  activeProject = 'all',
  projects = [],
  taskCount = 0,
  documentCount = 0,
  importMode = 'skip',
  staleDocs = [],
  orphanDocs = [],
  maintenanceProjectFilter = 'all',
  semanticStatus = { available: false },
} = {}) {
  const activeProjectName = activeProject === 'all'
    ? 'all projects'
    : (projects.find(p => p.id === activeProject)?.name || 'all projects');
  const safeProjectName = escapeHtml(activeProjectName);
  const safeTaskCount = Number.isFinite(Number(taskCount)) ? Number(taskCount) : 0;
  const safeDocumentCount = Number.isFinite(Number(documentCount)) ? Number(documentCount) : 0;

  return `
    <div class="modal-backdrop" data-admin-panel>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Operations</span>
              <h2 id="admin-title">Admin Operations</h2>
              <p>Backup and restore controls for the selected Prax project.</p>
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
          <section class="admin-section" aria-labelledby="library-export-title">
            <div>
              <h3 id="library-export-title">Library</h3>
              <p>${safeProjectName} &middot; ${safeDocumentCount} documents &middot; Generated at download time</p>
            </div>
            <div class="admin-actions">
              <button class="bracket-button" type="button" data-action="export-library-project">[x] export ${safeProjectName}</button>
              <button class="bracket-button" type="button" data-action="export-library-all">[X] export all</button>
            </div>
          </section>

          <section class="admin-section" aria-labelledby="backup-title">
            <div>
              <h3 id="backup-title">Backup</h3>
              <p>${safeProjectName} &middot; ${safeTaskCount} loaded tasks &middot; Generated at download time</p>
            </div>
            <div class="admin-actions">
              <button class="bracket-button" type="button" data-action="export-project">[x] export ${safeProjectName}</button>
              <button class="bracket-button" type="button" data-action="export-all">[X] export all</button>
            </div>
          </section>

          <section class="admin-section" aria-labelledby="import-title">
            <div>
              <h3 id="import-title">Restore / Import</h3>
              <p>Imports apply to the selected ${safeProjectName} project.</p>
            </div>
            <fieldset class="admin-mode-group">
              <legend>Import mode</legend>
              ${radioLine('skip', 'Skip duplicates', importMode)}
              ${radioLine('append', 'Append', importMode)}
              ${radioLine('replace', 'Replace project', importMode)}
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

          <section class="admin-section" aria-labelledby="library-maintenance-title">
            <div>
              <h3 id="library-maintenance-title">Library Maintenance</h3>
              <p>Stale and orphan documents in the library graph.</p>
            </div>
            <div class="admin-actions">
              <label>
                <span>Filter</span>
                <select data-maintenance-project-filter>
                  <option value="all"${maintenanceProjectFilter === 'all' ? ' selected' : ''}>All projects</option>
                  ${projects.map(p => `<option value="${escapeHtml(p.id)}"${p.id === maintenanceProjectFilter ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
              </label>
              <button class="bracket-button bracket-button--quiet" type="button" data-action="refresh-maintenance">[r] refresh</button>
            </div>

            <div class="admin-subsection">
              <h4>Stale documents</h4>
              <p class="admin-help">Documents whose derived-from source has changed since the link was created.</p>
              ${staleDocs.length === 0 ? '<p class="admin-empty">No stale documents.</p>' : `
              <ul class="admin-doc-list">${staleDocs.map((d) => `
                <li>
                  <div>
                    <strong>${escapeHtml(d.title || 'Untitled')}</strong>
                    <small>${escapeHtml(labelFromValue(d.documentType || 'note'))} · kind: ${escapeHtml(d.kind || 'source')} · updated by ${escapeHtml(d.updatedBy || 'user')}</small>
                    ${Array.isArray(d.staleSources) && d.staleSources.length > 0 ? `<small>Stale sources: ${d.staleSources.map((s) => escapeHtml(s.title || '')).join(', ')}</small>` : ''}
                  </div>
                  <button class="bracket-button bracket-button--quiet" type="button" data-action="open-library-doc" data-library-document-id="${escapeHtml(d.documentId)}"${d.projectId ? ` data-library-project-id="${escapeHtml(d.projectId)}"` : ''}>[open]</button>
                </li>`).join('')}
              </ul>`}
            </div>

            <div class="admin-subsection">
              <h4>Orphan documents</h4>
              <p class="admin-help">Documents with no inbound or outbound links.</p>
              ${orphanDocs.length === 0 ? '<p class="admin-empty">No orphan documents.</p>' : `
              <ul class="admin-doc-list">${orphanDocs.map((d) => `
                <li>
                  <div>
                    <strong>${escapeHtml(d.title || 'Untitled')}</strong>
                    <small>${escapeHtml(labelFromValue(d.documentType || 'note'))} · kind: ${escapeHtml(d.kind || 'source')}</small>
                  </div>
                  <button class="bracket-button bracket-button--quiet" type="button" data-action="open-library-doc" data-library-document-id="${escapeHtml(d.documentId)}"${d.projectId ? ` data-library-project-id="${escapeHtml(d.projectId)}"` : ''}>[open]</button>
                </li>`).join('')}
              </ul>`}
            </div>
          </section>

          <section class="admin-section" aria-labelledby="semantic-search-title">
            <div>
              <h3 id="semantic-search-title">Semantic Search</h3>
              ${semanticStatus.available === false
                ? `<p>Status: unavailable (no backend configured)</p>`
                : `<p>Backend: ${escapeHtml(semanticStatus.backend || '')} &middot; ${semanticStatus.connected ? 'connected' : 'disconnected'} &middot; ${Number(semanticStatus.embeddedCount) || 0}/${Number(semanticStatus.totalCount) || 0} documents embedded</p>`
              }
            </div>
            ${semanticStatus.available === true ? `
            <div class="admin-actions">
              <button class="bracket-button" type="button" data-action="toggle-semantic-search" aria-pressed="${semanticStatus.enabled === true}">${semanticStatus.enabled ? '[x] disable' : '[ ] enable'}</button>
              <button class="bracket-button bracket-button--quiet" type="button" data-action="reindex-embeddings">[r] reindex</button>
              <button class="bracket-button bracket-button--quiet" type="button" data-action="force-reindex-embeddings">[R] rebuild all</button>
            </div>` : ''}
          </section>
        </div>
      </section>
    </div>`;
}
