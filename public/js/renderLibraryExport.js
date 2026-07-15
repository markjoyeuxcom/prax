import { escapeHtml } from './renderHelpers.js';
import { libraryArchiveFilename } from './libraryExport.js';

const DESTINATIONS = {
  desktop: {
    title: 'Operating-system Save dialog',
    description: 'Choose any folder and change the ZIP filename before saving.',
    action: 'Choose location & export',
  },
  'browser-picker': {
    title: 'Browser Save dialog',
    description: 'Choose any permitted folder and change the ZIP filename before saving.',
    action: 'Choose location & export',
  },
  download: {
    title: 'Browser Downloads location',
    description: 'This browser cannot choose folders from Prax. Its Downloads or “Ask where to save” setting controls the destination.',
    action: 'Download ZIP',
  },
};

export function renderLibraryExportHtml(state, projects = [], mode = 'download') {
  if (!state.libraryExportOpen) return '';
  const choices = (Array.isArray(projects) ? projects : []).filter(project => project?.slug);
  const selectedScope = state.libraryExportScope === 'all'
    || choices.some(project => project.slug === state.libraryExportScope)
    ? state.libraryExportScope
    : 'all';
  const filename = state.libraryExportFilename || libraryArchiveFilename(selectedScope);
  const destination = DESTINATIONS[mode] || DESTINATIONS.download;
  const pending = Boolean(state.libraryExportPending);
  const error = state.libraryExportError
    ? `<p class="library-export__notice library-export__notice--error" role="alert">${escapeHtml(state.libraryExportError)}</p>`
    : pending
      ? '<p class="library-export__notice" role="status">Preparing and writing the archive…</p>'
      : '';

  return `
    <div class="overlay-center" data-overlay="library-export" data-action="close-library-export">
      <section class="library-export" role="dialog" aria-modal="true" aria-labelledby="library-export-title" aria-describedby="library-export-description"${pending ? ' aria-busy="true"' : ''}>
        <header class="library-export__head">
          <div>
            <h2 id="library-export-title">Export Library</h2>
            <p id="library-export-description">Create a portable ZIP of Markdown documents.</p>
          </div>
          <button class="btn-icon" type="button" data-action="close-library-export" aria-label="Close Library export"${pending ? ' disabled' : ''}>×</button>
        </header>
        <div class="library-export__body">
          <label class="library-export__field"><span>Export scope</span>
            <select class="text-input" data-library-export-scope${pending ? ' disabled' : ''}>
              <option value="all"${selectedScope === 'all' ? ' selected' : ''}>Entire library</option>
              ${choices.map(project => `<option value="${escapeHtml(project.slug)}"${project.slug === selectedScope ? ' selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
            </select>
          </label>
          <div class="library-export__field">
            <span>ZIP filename</span>
            <code class="library-export__filename" data-library-export-filename>${escapeHtml(filename)}</code>
          </div>
          <div class="library-export__destination">
            <strong>${escapeHtml(destination.title)}</strong>
            <span>${escapeHtml(destination.description)}</span>
          </div>
          <p class="library-export__scope">Includes active documents only, with one <code>.md</code> file per document. This preserves portable content and links; it is not a full database backup.</p>
          ${error}
        </div>
        <footer class="library-export__actions">
          <button class="btn-ghost" type="button" data-action="close-library-export"${pending ? ' disabled' : ''}>Cancel</button>
          <button class="btn-primary" type="button" data-action="submit-library-export"${pending ? ' disabled' : ''}>${pending ? 'Exporting…' : escapeHtml(destination.action)}</button>
        </footer>
      </section>
    </div>`;
}
