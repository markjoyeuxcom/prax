import { escapeHtml } from './renderHelpers.js';

export function renderMarkdownImportHtml(state, projects = []) {
  if (!state.markdownImportOpen) return '';
  const choices = Array.isArray(projects) ? projects : [];
  const selected = choices.find(project => project.id === state.markdownImportProjectId) || choices[0] || null;
  const files = Array.isArray(state.markdownImportFiles) ? state.markdownImportFiles : [];
  const pending = Boolean(state.markdownImportPending);
  const retrying = Boolean(state.markdownImportNotice && files.length);
  const intakeLocked = pending || retrying;
  const fileList = files.length
    ? `<div class="markdown-import__files" data-markdown-import-summary>
        <div class="markdown-import__files-head">${files.length} file${files.length === 1 ? '' : 's'} ready</div>
        ${files.map(file => `<div class="markdown-import__file"><span>${escapeHtml(file.name || 'unnamed.md')}</span><small>${escapeHtml(file.title || 'Untitled')}</small></div>`).join('')}
      </div>`
    : '<p class="markdown-import__empty" data-markdown-import-summary>No files selected.</p>';
  const notice = state.markdownImportError
    ? `<p class="markdown-import__notice markdown-import__notice--error" role="alert">${escapeHtml(state.markdownImportError)}</p>`
    : state.markdownImportNotice
      ? `<p class="markdown-import__notice" role="status">${escapeHtml(state.markdownImportNotice)}</p>`
      : '';
  const submitLabel = pending
    ? 'Importing…'
    : (state.markdownImportNotice && files.length ? 'Retry failed' : `Import ${files.length || ''}`.trim());

  return `
    <div class="overlay-center" data-overlay="markdown-import" data-action="close-markdown-import">
      <section class="markdown-import" role="dialog" aria-modal="true" aria-labelledby="markdown-import-title"${pending ? ' aria-busy="true"' : ''}>
        <header class="markdown-import__head">
          <div>
            <h2 id="markdown-import-title">Import Markdown</h2>
            <p>Each file becomes a source note in one project.</p>
          </div>
          <button class="btn-icon" type="button" data-action="close-markdown-import" aria-label="Close Markdown import"${pending ? ' disabled' : ''}>×</button>
        </header>
        <div class="markdown-import__body">
          <label class="markdown-import__field"><span>Destination project</span>
            <select class="text-input" data-markdown-import-project${intakeLocked ? ' disabled' : ''}>
              ${choices.map(project => `<option value="${escapeHtml(project.id)}"${project.id === selected?.id ? ' selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
            </select>
          </label>
          <label class="markdown-import__field"><span>Markdown files</span>
            <input type="file" data-markdown-import-files accept="text/markdown,.md,.markdown,.txt" multiple${intakeLocked ? ' disabled' : ''}>
          </label>
          ${fileList}
          <p class="markdown-import__scope">Plain intake preserves file content and filename. It does not restore Prax export metadata, document type, provenance, trust, or graph links.</p>
          ${notice}
        </div>
        <footer class="markdown-import__actions">
          <button class="btn-ghost" type="button" data-action="close-markdown-import"${pending ? ' disabled' : ''}>Cancel</button>
          <button class="btn-primary" type="button" data-action="submit-markdown-import"${pending || !selected || files.length === 0 ? ' disabled' : ''}>${escapeHtml(submitLabel)}</button>
        </footer>
      </section>
    </div>`;
}
