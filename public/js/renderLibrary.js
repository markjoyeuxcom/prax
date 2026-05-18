import { renderMarkdownHtml } from './markdownPreview.js';

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

function renderDocumentDetail(document, previewMode) {
  if (!document) {
    return `
      <aside class="detail-panel detail-panel--empty" aria-label="Document detail">
        <div class="detail-empty">
          <h2>No document selected</h2>
          <p>Select a Markdown document to preview or edit it.</p>
        </div>
      </aside>`;
  }

  const isArchived = Boolean(document.archivedAt);
  const body = document.body || '';
  const content = previewMode === 'raw'
    ? `<pre class="document-raw">${escapeHtml(body)}</pre>`
    : `<div class="markdown-preview">${renderMarkdownHtml(body)}</div>`;

  return `
    <aside class="detail-panel library-detail" aria-labelledby="selected-document-title">
      <header class="detail-header">
        <span class="detail-kicker">${escapeHtml(labelFromValue(document.documentType || 'note'))}</span>
        <h2 id="selected-document-title">${escapeHtml(document.title || 'Untitled document')}</h2>
        <p>${escapeHtml(document.sourceFilename || 'Created in TaskBoard')}</p>
        <div class="document-tags">${renderTags(document.tags)}</div>
        <div class="detail-actions">
          <button class="secondary-action" type="button" data-action="toggle-document-raw">${previewMode === 'raw' ? 'Preview' : 'Raw'}</button>
          ${isArchived ? `
          <button class="secondary-action" type="button" data-action="restore-document">Restore</button>
          <button class="danger-action" type="button" data-action="delete-archived-document">Delete</button>` : `
          <button class="secondary-action" type="button" data-action="edit-document">Edit</button>
          <button class="danger-action" type="button" data-action="archive-document">Archive</button>`}
        </div>
      </header>
      <div class="document-preview">${content}</div>
    </aside>`;
}

function renderOptions(options, selectedValue) {
  return options.map(option => `
            <option value="${option.value}"${option.value === selectedValue ? ' selected' : ''}>${option.label}</option>`).join('');
}

export function renderLibraryHtml({
  documents = [],
  selectedDocumentId = null,
  previewMode = 'preview',
} = {}) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  const document = selectedDocument(safeDocuments, selectedDocumentId);

  return [
    `<section class="task-panel library-panel" aria-labelledby="library-title">
      <header class="panel-header">
        <div>
          <h2 id="library-title">Knowledge Library</h2>
          <p>${safeDocuments.length} documents</p>
        </div>
        <span class="sync-pill">Markdown</span>
      </header>
      <div class="document-list">${renderDocumentList(safeDocuments, document?.id)}
      </div>
    </section>`,
    renderDocumentDetail(document, previewMode),
  ].join('');
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
