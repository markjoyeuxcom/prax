import { renderMarkdownHtml } from './markdownPreview.js';
import { visibleTagsForFilter } from './libraryFilters.js';

const DOCUMENT_TYPES = [
  { value: 'runbook', label: 'Runbook' },
  { value: 'note', label: 'Note' },
];

const CONTEXTS = [
  { value: 'personal', label: 'Personal' },
  { value: 'work', label: 'Work' },
  { value: 'homelab', label: 'Homelab' },
];

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

function renderTags(tags = []) {
  if (!tags.length) return '<span class="document-tag">untagged</span>';
  return tags.map(tag => `<span class="document-tag">${escapeHtml(tag)}</span>`).join('');
}

function normalizedTags(tags = []) {
  return tags.map(tag => String(tag || '').trim().toLowerCase()).filter(Boolean);
}

function renderTagFilters({
  availableTags = [],
  activeTags = [],
  tagQuery = '',
  areTagsExpanded = false,
} = {}) {
  const activeTagSet = new Set(normalizedTags(activeTags));
  const allActive = activeTagSet.size === 0;
  const { visibleTags, hiddenCount } = visibleTagsForFilter(availableTags, activeTags, tagQuery, {
    isExpanded: areTagsExpanded,
  });

  if (!availableTags.length) {
    return `
      <section class="library-tag-filter" aria-label="Library tag filters">
        <div class="library-tag-filter__header">
          <span>Tags</span>
        </div>
        <p class="library-tag-filter__empty">No tags yet</p>
      </section>`;
  }

  return `
    <section class="library-tag-filter" aria-label="Library tag filters">
      <div class="library-tag-filter__header">
        <span>Tags</span>
        <button class="tag-filter-chip${allActive ? ' is-active' : ''}" type="button" data-action="clear-library-tags" aria-pressed="${allActive}">All</button>
      </div>
      <label class="tag-search-field">
        <span class="sr-only">Search tags</span>
        <input type="search" placeholder="Search tags" autocomplete="off" value="${escapeHtml(tagQuery)}" data-library-tag-search>
      </label>
      <div class="tag-filter-list">${visibleTags.map(({ tag, count, isPinned }) => {
        const normalized = String(tag || '').trim().toLowerCase();
        const isActive = activeTagSet.has(normalized);
        return `<button class="tag-filter-chip${isActive ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}" type="button" data-library-tag="${escapeHtml(normalized)}" aria-pressed="${isActive}">${escapeHtml(normalized)} <span>${Number(count) || 0}</span></button>`;
      }).join('')}
      </div>
      ${hiddenCount ? `<button class="tag-filter-toggle" type="button" data-action="toggle-library-tags">Show ${hiddenCount} more</button>` : ''}
    </section>`;
}

function selectedDocument(documents, selectedDocumentId) {
  return documents.find(document => document.id === selectedDocumentId) || documents[0] || null;
}

function renderDocumentList(documents, activeDocumentId) {
  if (!documents.length) {
    return `
      <div class="task-empty" role="status">
        <strong>No Markdown documents</strong>
        <span>Create or import Markdown to build your runbook and notes library.</span>
      </div>`;
  }

  return documents.map((document) => {
    const isSelected = document.id === activeDocumentId;
    return `
      <button class="document-row${isSelected ? ' is-selected' : ''}" type="button" data-library-document-id="${escapeHtml(document.id)}"${isSelected ? ' aria-current="true"' : ''}>
        <span>
          <strong>${escapeHtml(document.title || 'Untitled document')}</strong>
          <small>${escapeHtml(labelFromValue(document.documentType || 'note'))} &middot; ${escapeHtml(document.sourceFilename || 'Created in TaskBoard')}</small>
        </span>
        <span class="document-tags">${renderTags(document.tags)}</span>
      </button>`;
  }).join('');
}

function renderModeButton(mode, activeMode, label) {
  return `<button class="secondary-action${mode === activeMode ? ' is-active' : ''}" type="button" data-library-mode="${mode}" aria-pressed="${mode === activeMode}">${label}</button>`;
}

function renderEditorPane(body, isDirty) {
  return `
    <section class="document-editor-pane" aria-label="Markdown editor">
      <header class="document-pane-header">
        <span>${isDirty ? 'Unsaved changes' : 'Saved'}</span>
        <button class="primary-action" type="button" data-action="save-document-draft"${isDirty ? '' : ' disabled'}>Save</button>
      </header>
      <textarea class="document-editor" data-document-editor spellcheck="false">${escapeHtml(body)}</textarea>
    </section>`;
}

function renderPreviewPane(body) {
  return `
    <section class="document-preview-pane" aria-label="Markdown preview">
      <div class="markdown-preview">${renderMarkdownHtml(body)}</div>
    </section>`;
}

function renderDocumentDetail(document, options = {}) {
  if (!document) {
    return `
      <aside class="detail-panel detail-panel--empty" aria-label="Document detail">
        <div class="detail-empty">
          <h2>No document selected</h2>
          <p>Select a Markdown document to preview or edit it.</p>
        </div>
      </aside>`;
  }

  const editorMode = options.editorMode || 'preview';
  const isArchived = Boolean(document.archivedAt);
  const body = options.draftBody ?? document.body ?? '';
  const isDirty = Boolean(options.isDirty);
  const editorVisible = editorMode === 'edit' || editorMode === 'split';
  const previewVisible = editorMode === 'preview' || editorMode === 'split';

  return `
    <aside class="detail-panel library-detail" aria-labelledby="selected-document-title">
      <header class="detail-header">
        <span class="detail-kicker">${escapeHtml(labelFromValue(document.documentType || 'note'))}</span>
        <h2 id="selected-document-title">${escapeHtml(document.title || 'Untitled document')}</h2>
        <p>${escapeHtml(document.sourceFilename || 'Created in TaskBoard')}</p>
        <div class="document-tags">${renderTags(document.tags)}</div>
        <div class="detail-actions">
          ${renderModeButton('edit', editorMode, 'Edit')}
          ${renderModeButton('preview', editorMode, 'Preview')}
          ${renderModeButton('split', editorMode, 'Split')}
          ${isArchived ? `
          <button class="secondary-action" type="button" data-action="restore-document">Restore</button>
          <button class="danger-action" type="button" data-action="delete-archived-document">Delete</button>` : `
          <button class="danger-action" type="button" data-action="archive-document">Archive</button>`}
        </div>
      </header>
      <div class="document-workspace document-workspace--${escapeHtml(editorMode)}">${editorVisible ? renderEditorPane(body, isDirty) : ''}${previewVisible ? renderPreviewPane(body) : ''}
      </div>
    </aside>`;
}

function renderOptions(options, selectedValue) {
  return options.map(option => `
            <option value="${option.value}"${option.value === selectedValue ? ' selected' : ''}>${option.label}</option>`).join('');
}

export function renderLibraryHtml({
  documents = [],
  selectedDocumentId = null,
  previewMode = null,
  editorMode = null,
  draftBody = null,
  isDirty = false,
  availableTags = [],
  activeTags = [],
  tagQuery = '',
  areTagsExpanded = false,
} = {}) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  const document = selectedDocument(safeDocuments, selectedDocumentId);
  const activeMode = editorMode || (previewMode === 'raw' ? 'edit' : previewMode) || 'preview';

  return `
    <section class="library-workspace" aria-label="Knowledge Library workspace">
      <aside class="library-browser" aria-labelledby="library-title">
        <header class="panel-header">
          <div>
            <h2 id="library-title">Knowledge Library</h2>
            <p>${safeDocuments.length} documents</p>
          </div>
          <span class="sync-pill">Markdown</span>
        </header>
        ${renderTagFilters({ availableTags, activeTags, tagQuery, areTagsExpanded })}
        <div class="document-list">${renderDocumentList(safeDocuments, document?.id)}
        </div>
      </aside>
      <div class="library-document-stage">${renderDocumentDetail(document, { editorMode: activeMode, draftBody, isDirty })}
      </div>
    </section>`;
}

export function renderDocumentFormHtml({
  document = null,
  activeContext = 'homelab',
  error = '',
  isSaving = false,
} = {}) {
  const isEditing = Boolean(document);
  const values = {
    title: document?.title || '',
    body: document?.body || '',
    documentType: document?.documentType || 'note',
    context: document?.context || activeContext,
    tags: Array.isArray(document?.tags) ? document.tags.join(', ') : '',
    sourceFilename: document?.sourceFilename || '',
  };

  return `
    <div class="modal-backdrop" data-modal="document-form">
      <section class="task-form-modal" role="dialog" aria-modal="true" aria-labelledby="document-form-title">
        <header class="task-form-header">
          <div>
            <h2 id="document-form-title">${isEditing ? 'Edit Document' : 'New Document'}</h2>
            <p>${isEditing ? 'Update this Markdown runbook or note.' : 'Create a Markdown runbook or note.'}</p>
          </div>
          <button class="icon-action" type="button" data-action="close-document-form" aria-label="Close document form">x</button>
        </header>

        <form class="task-form" data-document-form>
          ${error ? `<div class="form-error" role="alert">${escapeHtml(error)}</div>` : ''}
          <label>
            <span>Title</span>
            <input name="title" type="text" value="${escapeHtml(values.title)}" autocomplete="off" required>
          </label>
          <label>
            <span>Body</span>
            <textarea name="body" rows="12">${escapeHtml(values.body)}</textarea>
          </label>
          <div class="form-grid">
            <label>
              <span>Type</span>
              <select name="documentType">${renderOptions(DOCUMENT_TYPES, values.documentType)}
              </select>
            </label>
            <label>
              <span>Context</span>
              <select name="context">${renderOptions(CONTEXTS, values.context)}
              </select>
            </label>
            <label>
              <span>Tags</span>
              <input name="tags" type="text" value="${escapeHtml(values.tags)}" placeholder="postgres, backup">
            </label>
            <label>
              <span>Source File</span>
              <input name="sourceFilename" type="text" value="${escapeHtml(values.sourceFilename)}">
            </label>
          </div>
          <footer class="task-form-actions">
            <button class="secondary-action" type="button" data-action="close-document-form">Cancel</button>
            <button class="primary-action" type="submit"${isSaving ? ' disabled' : ''}>${isSaving ? 'Saving...' : 'Save Document'}</button>
          </footer>
        </form>
      </section>
    </div>`;
}
