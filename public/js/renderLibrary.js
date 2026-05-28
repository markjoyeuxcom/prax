import { renderMarkdownHtml } from './markdownPreview.js';
import { groupDocumentsByType, visibleTagsForFilter } from './libraryFilters.js';

const DOCUMENT_TYPES = [
  { value: 'runbook', label: 'Runbook' },
  { value: 'note', label: 'Note' },
];

const MARKDOWN_TOOLS = [
  { action: 'heading', label: 'H2', title: 'Heading' },
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'bullet-list', label: 'List', title: 'Bullet list' },
  { action: 'numbered-list', label: '1.', title: 'Numbered list' },
  { action: 'checklist', label: 'Check', title: 'Checklist' },
  { action: 'quote', label: 'Quote', title: 'Quote' },
  { action: 'code', label: 'Code', title: 'Inline code' },
  { action: 'code-block', label: 'Block', title: 'Code block' },
  { action: 'link', label: 'Link', title: 'Link' },
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

function renderSmartViews({
  savedViews = [],
  activeSavedViewId = null,
  activeTags = [],
} = {}) {
  const canSaveView = normalizedTags(activeTags).length > 0;

  return `
    <section class="library-smart-views" aria-label="Library smart views">
      <div class="library-smart-views__header">
        <span>Smart views</span>
      </div>
      <div class="saved-view-list">${savedViews.length ? savedViews.map((view) => {
        const isActive = view.id === activeSavedViewId;
        return `
        <article class="saved-view${isActive ? ' is-active' : ''}">
          <button class="saved-view__select" type="button" data-library-saved-view-id="${escapeHtml(view.id)}" aria-pressed="${isActive}">
            <strong>${escapeHtml(view.label)}</strong>
            <span>${normalizedTags(view.tags).join(' + ')}</span>
          </button>
          <button class="saved-view__rename" type="button" data-action="rename-library-saved-view" data-library-saved-view-id="${escapeHtml(view.id)}" aria-label="Rename ${escapeHtml(view.label)}">Rename</button>
          <button class="saved-view__delete" type="button" data-action="delete-library-saved-view" data-library-saved-view-id="${escapeHtml(view.id)}" aria-label="Delete ${escapeHtml(view.label)}">x</button>
        </article>`;
      }).join('') : '<p class="library-smart-views__empty">Save a tag set to create a smart view.</p>'}
      </div>
      <div class="saved-view-form">
        <label class="sr-only" for="library-saved-view-name">Saved view name</label>
        <input id="library-saved-view-name" type="text" placeholder="Name current tags optional" autocomplete="off" data-library-saved-view-name${canSaveView ? '' : ' disabled'}>
        <button class="secondary-action" type="button" data-action="save-library-view"${canSaveView ? '' : ' disabled'}>Save view</button>
      </div>
    </section>`;
}

function documentCountLabel(count) {
  return `${count} ${count === 1 ? 'document' : 'documents'} shown`;
}

function renderActiveFilters({
  activeTags = [],
  activeSavedViewId = null,
  savedViews = [],
  documentCount = 0,
} = {}) {
  const tags = normalizedTags(activeTags);
  const savedView = savedViews.find(view => view.id === activeSavedViewId);

  if (!tags.length) {
    return `
      <section class="library-active-filters" aria-label="Active library filters">
        <div>
          <span>Active filters</span>
          <strong>All documents</strong>
        </div>
        <small>${documentCountLabel(documentCount)}</small>
      </section>`;
  }

  return `
    <section class="library-active-filters" aria-label="Active library filters">
      <div>
        <span>Active filters</span>
        <strong>${escapeHtml(savedView?.label || tags.join(' + '))}</strong>
      </div>
      <div class="active-filter-chips">
        ${tags.map(tag => `<button class="active-filter-chip" type="button" data-library-active-filter="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)} filter">${escapeHtml(tag)} <span>x</span></button>`).join('')}
      </div>
      <button class="text-action" type="button" data-action="clear-library-tags">Clear</button>
      <small>${documentCountLabel(documentCount)}</small>
    </section>`;
}

function selectedDocument(documents, selectedDocumentId) {
  return documents.find(document => document.id === selectedDocumentId) || documents[0] || null;
}

function renderDocumentRows(documents, activeDocumentId) {
  return documents.map((document) => {
    const isSelected = document.id === activeDocumentId;
    return `
      <button class="document-row${isSelected ? ' is-selected' : ''}" type="button" data-library-document-id="${escapeHtml(document.id)}"${isSelected ? ' aria-current="true"' : ''}>
        <span>
          <strong>${escapeHtml(document.title || 'Untitled document')}</strong>
          <small>${escapeHtml(labelFromValue(document.documentType || 'note'))} &middot; ${escapeHtml(document.sourceFilename || 'Created in Moomora Console')}</small>
        </span>
        <span class="document-tags">${renderTags(document.tags)}</span>
      </button>`;
  }).join('');
}

function renderDocumentList(documents, activeDocumentId, { groupByType = false } = {}) {
  if (!documents.length) {
    return `
      <div class="task-empty" role="status">
        <strong>No Markdown documents</strong>
        <span>Create or import Markdown to build your runbook and notes library.</span>
      </div>`;
  }

  if (groupByType) {
    const groups = groupDocumentsByType(documents);
    return groups.map(({ label, docs }) => `
      <div class="document-group-header">${escapeHtml(label)} <span>${docs.length}</span></div>${renderDocumentRows(docs, activeDocumentId)}`).join('');
  }

  return renderDocumentRows(documents, activeDocumentId);
}

function renderModes(editorMode, modes = ['edit', 'preview', 'split']) {
  return `
        <div class="modes" role="tablist" aria-label="Editor mode">
          ${modes.map(mode => `<button class="${mode === editorMode ? 'on' : ''}" role="tab" type="button" data-library-mode="${mode}" aria-selected="${mode === editorMode}">${mode}</button>`).join('')}
        </div>`;
}

function renderMarkdownToolbar() {
  return `
        <div class="markdown-toolbar" aria-label="Markdown formatting tools">
          ${MARKDOWN_TOOLS.map(tool => `<button class="markdown-tool-button" type="button" data-markdown-action="${escapeHtml(tool.action)}" title="${escapeHtml(tool.title)}" aria-label="${escapeHtml(tool.title)}">${escapeHtml(tool.label)}</button>`).join('')}
        </div>`;
}

function renderEditorPane(body, options = {}) {
  const status = options.saveStatus || (options.isDirty ? 'Unsaved changes' : 'Saved');

  return `
    <section class="document-editor-pane" aria-label="Markdown editor">
      <header class="document-pane-header">
        <span data-document-save-status>${escapeHtml(status)}</span>
        <div class="document-pane-actions">
          <button class="bracket-button" type="button" data-action="toggle-document-focus" aria-label="Focus writing mode" aria-pressed="${Boolean(options.isFocusMode)}">[f] focus</button>
          ${options.isArchived ? '' : `<button class="bracket-button" type="button" data-action="export-document" data-document-id="${escapeHtml(options.documentId || '')}" aria-label="Export document as Markdown">[x] export</button>`}
          <button class="bracket-button bracket-button--primary" type="button" data-action="save-document-draft"${options.isDirty ? '' : ' disabled'}>[s] save</button>
        </div>
      </header>
      ${renderMarkdownToolbar()}
      <div class="document-editor-shell">
        <textarea class="document-editor document-editor--fallback" data-document-editor spellcheck="false">${escapeHtml(body)}</textarea>
        <div class="code-editor" data-code-editor hidden></div>
      </div>
    </section>`;
}

function renderPreviewPane(body) {
  return `
    <section class="document-preview-pane" aria-label="Markdown preview">
      <div class="markdown-preview">${renderMarkdownHtml(body)}</div>
    </section>`;
}

function renderDocumentInfoForm(document, options = {}) {
  const values = {
    title: document?.title || '',
    documentType: document?.documentType || 'note',
    tags: Array.isArray(document?.tags) ? document.tags.join(', ') : '',
    sourceFilename: document?.sourceFilename || '',
  };

  return `
    <form class="document-info-form" data-document-info-form>
      ${options.error ? `<div class="form-error" role="alert">${escapeHtml(options.error)}</div>` : ''}
      <label>
        <span>Title</span>
        <input name="title" type="text" value="${escapeHtml(values.title)}" autocomplete="off" required>
      </label>
      <div class="form-grid">
        <label>
          <span>Type</span>
          <select name="documentType">${renderOptions(DOCUMENT_TYPES, values.documentType)}
          </select>
        </label>
        <label>
          <span>Source File</span>
          <input name="sourceFilename" type="text" value="${escapeHtml(values.sourceFilename)}">
        </label>
      </div>
      <label>
        <span>Tags</span>
        <input name="tags" type="text" value="${escapeHtml(values.tags)}" placeholder="postgres, backup">
      </label>
      <footer class="document-info-actions">
        <button class="bracket-button bracket-button--quiet" type="button" data-action="cancel-document-info">cancel</button>
        <button class="bracket-button bracket-button--primary" type="submit"${options.isSaving ? ' disabled' : ''}>${options.isSaving ? '[s] saving...' : '[s] save'}</button>
      </footer>
    </form>`;
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
  const isInfoEditing = Boolean(options.isInfoEditing);
  const isFocusMode = Boolean(options.isFocusMode);
  const editorVisible = editorMode === 'edit' || editorMode === 'split';
  const previewVisible = editorMode === 'preview' || editorMode === 'split';

  return `
    <aside class="detail-panel library-detail${isFocusMode ? ' is-focus-mode' : ''}" aria-labelledby="selected-document-title">
      <header class="detail-header">
        ${options.isLibraryDocOpen ? `<button class="detail-back bracket-button bracket-button--quiet" type="button" data-action="close-library-doc" aria-label="Back">← back</button>` : ''}
        <span class="detail-kicker">${escapeHtml(labelFromValue(document.documentType || 'note'))}</span>
        <h2 id="selected-document-title">${escapeHtml(document.title || 'Untitled document')}</h2>
        <p>${escapeHtml(document.sourceFilename || 'Created in Moomora Console')}</p>
        <div class="document-tags">${renderTags(document.tags)}</div>
        <div class="detail-actions">
          ${renderModes(editorMode)}
          ${isArchived ? '' : '<button class="bracket-button" type="button" data-action="edit-document-info">[i] info</button>'}
          ${isArchived ? `
          <button class="bracket-button" type="button" data-action="restore-document">[r] restore</button>
          <button class="bracket-button bracket-button--danger" type="button" data-action="delete-archived-document">[!] delete</button>` : `
          <button class="bracket-button bracket-button--danger" type="button" data-action="archive-document">[d] archive</button>`}
        </div>
      </header>
      ${isInfoEditing ? renderDocumentInfoForm(document, { error: options.infoError, isSaving: options.isSaving }) : `
      <div class="document-workspace document-workspace--${escapeHtml(editorMode)}${isFocusMode ? ' document-workspace--focused' : ''}">${editorVisible ? renderEditorPane(body, { isDirty, saveStatus: options.saveStatus, isFocusMode, documentId: document.id, isArchived }) : ''}${previewVisible ? renderPreviewPane(body) : ''}
      </div>`}
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
  savedViews = [],
  activeSavedViewId = null,
  isInfoEditing = false,
  infoError = '',
  isSaving = false,
  saveStatus = '',
  isFocusMode = false,
  isLibraryTagsDrawerOpen = false,
  isLibraryDocOpen = false,
  typeFilter = 'all',
  sortBy = 'updated',
  groupByType = false,
} = {}) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  const document = selectedDocument(safeDocuments, selectedDocumentId);
  const activeMode = editorMode || (previewMode === 'raw' ? 'edit' : previewMode) || 'preview';

  return `
    <section class="library-workspace${isFocusMode ? ' is-focus-mode' : ''}" aria-label="Knowledge Library workspace">
      <aside class="library-browser" aria-labelledby="library-title">
        <header class="panel-header">
          <div>
            <h2 id="library-title">Knowledge Library</h2>
            <p>${safeDocuments.length} documents</p>
          </div>
          <span class="sync-pill">Markdown</span>
          <button class="bracket-button bracket-button--quiet library-tags-toggle" type="button" data-action="toggle-library-tags-drawer" aria-expanded="${isLibraryTagsDrawerOpen}">tags ↕</button>
        </header>
        <div class="library-tag-filter__drawer${isLibraryTagsDrawerOpen ? ' is-open' : ''}">
          ${renderSmartViews({ savedViews, activeSavedViewId, activeTags })}
          ${renderTagFilters({ availableTags, activeTags, tagQuery, areTagsExpanded })}
          ${renderActiveFilters({ activeTags, activeSavedViewId, savedViews, documentCount: safeDocuments.length })}
        </div>
        <div class="library-controls">
          <div class="modes library-type-filter" role="tablist" aria-label="Document type">
            <button class="${typeFilter === 'all' ? 'on' : ''}" type="button" role="tab" data-library-type="all" aria-selected="${typeFilter === 'all'}">all</button>
            <button class="${typeFilter === 'runbook' ? 'on' : ''}" type="button" role="tab" data-library-type="runbook" aria-selected="${typeFilter === 'runbook'}">runbook</button>
            <button class="${typeFilter === 'note' ? 'on' : ''}" type="button" role="tab" data-library-type="note" aria-selected="${typeFilter === 'note'}">note</button>
          </div>
          <label class="library-sort-label">sort
            <select class="library-sort" data-library-sort>
              <option value="updated"${sortBy === 'updated' ? ' selected' : ''}>updated</option>
              <option value="created"${sortBy === 'created' ? ' selected' : ''}>created</option>
              <option value="title"${sortBy === 'title' ? ' selected' : ''}>title</option>
              <option value="type"${sortBy === 'type' ? ' selected' : ''}>type</option>
            </select>
          </label>
          <button class="bracket-button bracket-button--quiet library-group-toggle" type="button" data-action="toggle-library-group" aria-pressed="${groupByType}">group: ${groupByType ? 'type' : 'off'}</button>
        </div>
        <div class="document-list">${renderDocumentList(safeDocuments, document?.id, { groupByType })}
        </div>
      </aside>
      <div class="library-resizer" data-library-resizer role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize library browser"></div>
      <div class="library-document-stage">${renderDocumentDetail(document, { editorMode: activeMode, draftBody, isDirty, isInfoEditing, infoError, isSaving, saveStatus, isFocusMode, isLibraryDocOpen })}
      </div>
    </section>`;
}

export function renderDocumentFormHtml({
  document = null,
  projects = [],
  values: valuesOverride = {},
  error = '',
  isSaving = false,
} = {}) {
  const isEditing = Boolean(document);
  const values = {
    title: document?.title || '',
    body: document?.body || '',
    documentType: document?.documentType || 'note',
    project: valuesOverride.project || '',
    tags: Array.isArray(document?.tags) ? document.tags.join(', ') : '',
    sourceFilename: document?.sourceFilename || '',
  };

  return `
    <div class="modal-backdrop" data-modal="document-form">
      <section class="task-form-modal" role="dialog" aria-modal="true" aria-labelledby="document-form-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <h2 id="document-form-title">${isEditing ? 'edit document' : 'new document'}</h2>
              <p>${isEditing ? 'Update this Markdown runbook or note.' : 'Create a Markdown runbook or note.'}</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="close-document-form" aria-label="Close document form">[x] close</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-document-form">cancel</button>
            <h2 class="modal-header__title">${isEditing ? 'edit document' : 'new document'}</h2>
            <button class="modal-header__save bracket-button bracket-button--primary" type="submit" form="document-form" data-action="submit-from-header"${isSaving ? ' disabled' : ''}>${isSaving ? '[s] saving...' : '[s] save'}</button>
          </div>
        </header>

        <form class="task-form" id="document-form" data-document-form>
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
              <span>Project</span>
              <select name="project">${projects.map(project =>
    `<option value="${escapeHtml(project.id)}"${project.id === values.project ? ' selected' : ''}>${escapeHtml(project.name)}</option>`
  ).join('')}</select>
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
            <button class="bracket-button bracket-button--quiet" type="button" data-action="close-document-form">cancel</button>
            <button class="bracket-button bracket-button--primary" type="submit"${isSaving ? ' disabled' : ''}>${isSaving ? '[s] saving...' : '[s] save'}</button>
          </footer>
        </form>
      </section>
    </div>`;
}
