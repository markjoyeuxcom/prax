import { escapeHtml } from './renderHelpers.js';
import { DOCUMENT_TYPES } from './documentTypes.js';

export function renderTemplateStudioHtml(draft, choices, projects, previewHtml = '') {
  if (!draft) return '';
  const locked = Boolean(draft.pending || draft.job);
  const disabled = locked ? ' disabled' : '';
  const task = draft.source?.target === 'task';
  return `<div class="overlay-center" data-overlay="template-studio" data-action="close-template-studio">
    <section class="library-export template-studio" role="dialog" aria-modal="true" aria-labelledby="template-studio-title" aria-describedby="template-studio-description"${draft.pending ? ' aria-busy="true"' : ''}>
      <header class="library-export__head">
        <div><h2 id="template-studio-title">Templates &amp; guides</h2>
          <p id="template-studio-description">Choose a starting point and create your own copy.</p></div>
        <button class="btn-icon" type="button" data-action="close-template-studio" aria-label="Close templates"${draft.pending ? ' disabled' : ''}>×</button>
      </header>
      <div class="library-export__body">
        <label class="library-export__field"><span>Starting point</span>
          <select class="text-input" data-template-field="source"${disabled}>
            ${choices.map(item => `<option value="${escapeHtml(item.id)}"${item.id === draft.source?.id ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
        <p class="library-export__scope">${escapeHtml(draft.source?.hint || '')}. ${task ? 'Creates a task with unchecked acceptance items.' : 'Creates an unverified document. The original stays available.'}</p>
        <div class="template-studio__fields">
          <label class="library-export__field"><span>Destination project</span>
            <select class="text-input" data-template-field="project"${disabled}>
              <option value="">Choose a project</option>
              ${projects.map(project => `<option value="${escapeHtml(project.id)}"${project.id === draft.project ? ' selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
            </select>
          </label>
          ${task ? '' : `<label class="library-export__field"><span>Copy type</span>
            <select class="text-input" data-template-field="documentType"${disabled}>
              ${DOCUMENT_TYPES.map(type => `<option value="${type.value}"${type.value === draft.documentType ? ' selected' : ''}>${type.label}</option>`).join('')}
            </select></label>`}
        </div>
        <label class="library-export__field"><span>${task ? 'Task title' : 'Document title'}</span>
          <input class="text-input" data-template-field="title" value="${escapeHtml(draft.title)}"${disabled}>
        </label>
        <div class="template-studio__preview markdown-body" role="region" aria-label="Template preview" tabindex="0">${previewHtml}</div>
        ${draft.error ? `<p class="library-export__notice library-export__notice--error" role="alert">${escapeHtml(draft.error)}</p>` : ''}
        ${draft.pending ? '<p role="status">Creating your copy…</p>' : ''}
      </div>
      <footer class="library-export__actions">
        <button class="btn-ghost" type="button" data-action="discard-template-studio"${draft.pending ? ' disabled' : ''}>Discard draft…</button>
        <button class="btn-ghost" type="button" data-action="close-template-studio"${draft.pending ? ' disabled' : ''}>Close</button>
        <button class="btn-primary" type="button" data-action="submit-template-studio"${draft.pending || !draft.source ? ' disabled' : ''}>${draft.pending ? 'Creating…' : draft.job ? 'Retry creation' : task ? 'Create task' : 'Use template'}</button>
      </footer>
    </section></div>`;
}
