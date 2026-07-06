import { escapeHtml, chip, prioDotClass } from './renderHelpers.js';

// Prax document editor — pure render module (docs/desktop/phase1-actions.md).
// `renderEditorHtml(state, doc, model)` returns an HTML string; no DOM access.
// Events are delegated from main.js via data-action attributes. CodeMirror is
// mounted by main.js into [data-code-editor]; markdownPreview.renderMarkdownHtml
// produces `model.previewHtml` — it arrives ALREADY rendered/escaped and is
// interpolated as-is (never re-escaped).

const EDITOR_MODES = [
  ['edit', 'Edit'],
  ['split', 'Split'],
  ['preview', 'Preview'],
];

// Toolbar in design order (design-handoff §8); data-md-action values are the
// markdownEditor.js applyMarkdownFormat action vocabulary.
const MARKDOWN_TOOLS = [
  { action: 'bold', label: 'B', title: 'Bold (⌘B)' },
  { action: 'italic', label: 'I', title: 'Italic (⌘I)' },
  { action: 'heading', label: 'H2', title: 'Heading' },
  { action: 'quote', label: '“ ”', title: 'Quote' },
  { action: 'code', label: '‹ ›', title: 'Code (⌘E)' },
  { action: 'code-block', label: '```', title: 'Code block' },
  { action: 'bullet-list', label: '• list', title: 'Bullet list' },
  { action: 'numbered-list', label: '1. list', title: 'Numbered list' },
  { action: 'checklist', label: '☐ task', title: 'Task item' },
  { action: 'link', label: 'link', title: 'Link' },
];

const DOCUMENT_TYPES = [
  { value: 'runbook', label: 'Runbook' },
  { value: 'note', label: 'Note' },
];

// Outline: headings #–### → [{ label, level, index }] where index is the
// heading ordinal (payload for data-action="outline-jump"). Markdown symbols
// are stripped from labels, matching the design prototype.
export function buildOutline(text) {
  const items = [];
  String(text ?? '').split(/\r?\n/).forEach((line) => {
    const match = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!match) return;
    items.push({
      label: match[2].replace(/[*`_\[\]]/g, '').trim(),
      level: match[1].length,
      index: items.length,
    });
  });
  return items;
}

// Backlinks: non-archived tasks that link this document. Each task is expected
// to already carry a `docIds` array (the caller composes it — e.g. from the
// task↔document link fetch/extras — tasks straight from the task API do not
// have it). Tasks without a docIds array never match; returns [] when none.
export function buildBacklinks(tasks, projects, docId) {
  if (!docId) return [];
  const projectById = new Map(
    (Array.isArray(projects) ? projects : [])
      .filter((project) => project && project.id)
      .map((project) => [project.id, project]),
  );
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task && !task.archivedAt
      && Array.isArray(task.docIds) && task.docIds.includes(docId))
    .map((task) => {
      const project = projectById.get(task.projectId);
      return {
        taskId: task.id,
        title: task.title || 'Untitled task',
        projectName: project?.name || '',
        projectColor: project?.color || '',
        priority: task.priority || 'medium',
      };
    });
}

function projectChip(name, color) {
  if (!name) return '';
  const safeColor = escapeHtml(color || 'var(--ink3)');
  return `<span class="chip chip--project" style="background:color-mix(in oklab, ${safeColor} 13%, transparent);color:${safeColor}">${escapeHtml(name)}</span>`;
}

function renderHead(state, doc, { mode, readOnly }) {
  const tags = (Array.isArray(doc.tags) ? doc.tags : []).filter(Boolean);
  const seg = readOnly ? '' : `
      <div class="seg" role="group" aria-label="Editor mode">
        ${EDITOR_MODES.map(([value, label]) => `<button type="button" data-action="set-editor-mode" data-mode="${value}"${mode === value ? ' class="is-active"' : ''} aria-pressed="${mode === value}">${label}</button>`).join('')}
      </div>`;

  return `
    <header class="editor-head">
      <button class="editor-head__back" type="button" data-action="back-to-library" title="Back to library" aria-label="Back to library">←</button>
      <input class="editor-head__title" type="text" data-doc-title value="${escapeHtml(doc.title || '')}" aria-label="Document title" autocomplete="off" spellcheck="false"${readOnly ? ' readonly' : ''}>
      ${tags.length ? `<div class="editor-head__tags">${tags.map((tag) => chip(`#${tag}`, 'tag')).join('')}</div>` : ''}${seg}
      <button class="btn-ghost${state.outlineOpen ? ' is-on' : ''}" type="button" data-action="toggle-outline" aria-pressed="${Boolean(state.outlineOpen)}">Outline</button>
      <button class="btn-ghost" type="button" data-action="export-doc" title="Download this document as .md">Export</button>
      <button class="btn-ghost${state.editorFocus ? ' is-on' : ''}" type="button" data-action="toggle-focus" title="Focus mode (Esc to exit)" aria-pressed="${Boolean(state.editorFocus)}">Focus</button>
      ${readOnly ? '' : '<button class="btn-ghost" type="button" data-action="edit-document-info">Info</button>'}
    </header>`;
}

function renderTrustStrip(doc, { readOnly }) {
  const chips = [];
  if (doc.kind === 'synthesized') {
    chips.push('<span class="chip chip--synth" aria-label="Document kind: synthesized">SYNTHESIZED</span>');
  } else {
    chips.push('<span class="chip" aria-label="Document kind: source">SOURCE</span>');
  }
  if (doc.verified === true) {
    chips.push('<span class="chip chip--verified" aria-label="Verified by a human">VERIFIED</span>');
  }
  if (doc.status === 'superseded') {
    chips.push('<span class="chip chip--superseded" aria-label="Superseded by a newer document">SUPERSEDED</span>');
  }

  const verifiedText = doc.verified
    ? `verified${doc.verifiedBy ? ` by ${escapeHtml(doc.verifiedBy)}` : ''}`
    : 'unverified';
  const meta = `Updated by ${escapeHtml(doc.updatedBy || 'user')} · ${verifiedText}`;

  const actions = readOnly ? `
        <button class="btn-ghost" type="button" data-action="restore-document">Restore</button>
        <button class="btn-ghost" type="button" data-action="delete-archived-document">Delete</button>` : `
        <button class="btn-ghost" type="button" data-action="toggle-verify">${doc.verified ? 'Unverify' : 'Verify'}</button>
        ${doc.status === 'superseded' ? '' : '<button class="btn-ghost" type="button" data-action="supersede-document">Supersede…</button>'}
        <button class="btn-ghost" type="button" data-action="archive-document">Archive</button>`;

  return `
    <div class="trust-strip">
      ${chips.join('')}
      <span class="trust-strip__meta">${meta}</span>
      <span class="trust-strip__actions">${actions}
      </span>
    </div>`;
}

function renderInfoForm(state, doc) {
  const tags = Array.isArray(doc.tags) ? doc.tags.join(', ') : '';
  const type = doc.documentType === 'runbook' ? 'runbook' : 'note';
  return `
    <div class="editor-info">
      ${state.documentInfoError ? `<div class="editor-info__error" role="alert">${escapeHtml(state.documentInfoError)}</div>` : ''}
      <label class="editor-info__field"><span>Title</span>
        <input class="text-input" type="text" data-doc-info-title value="${escapeHtml(doc.title || '')}" autocomplete="off">
      </label>
      <label class="editor-info__field"><span>Type</span>
        <select class="text-input" data-doc-info-type>
          ${DOCUMENT_TYPES.map((option) => `<option value="${option.value}"${option.value === type ? ' selected' : ''}>${option.label}</option>`).join('')}
        </select>
      </label>
      <label class="editor-info__field"><span>Tags</span>
        <input class="text-input" type="text" data-doc-info-tags value="${escapeHtml(tags)}" placeholder="postgres, backup" autocomplete="off">
      </label>
      <label class="editor-info__field"><span>Source file</span>
        <input class="text-input" type="text" data-doc-info-source value="${escapeHtml(doc.sourceFilename || '')}" autocomplete="off">
      </label>
      <div class="editor-info__actions">
        <button class="btn-ghost" type="button" data-action="save-document-info">Save</button>
        <button class="btn-ghost" type="button" data-action="cancel-document-info">Cancel</button>
      </div>
    </div>`;
}

function renderToolbar() {
  return `
    <div class="toolbar" aria-label="Markdown formatting">
      ${MARKDOWN_TOOLS.map((tool) => `<button type="button" data-action="md-format" data-md-action="${tool.action}" title="${escapeHtml(tool.title)}" aria-label="${escapeHtml(tool.title)}">${escapeHtml(tool.label)}</button>`).join('')}
      <span class="toolbar__hint">⌘B bold · ⌘I italic · ⌘E code</span>
    </div>`;
}

function renderOutlineRail(outline) {
  return `
      <aside class="outline" aria-label="Document outline">
        <div class="outline__label">Outline</div>
        ${outline.map((item) => `<button type="button" data-action="outline-jump" data-heading-index="${item.index}" style="padding-left:${8 + (item.level - 1) * 11}px">${escapeHtml(item.label)}</button>`).join('')}
      </aside>`;
}

function renderBacklinksFooter(backlinks) {
  if (!backlinks.length) return '';
  return `
        <footer class="backlinks">
          <div class="backlinks__label">Referenced by ${backlinks.length} task(s)</div>
          ${backlinks.map((link) => `
          <button type="button" data-action="open-task" data-task-id="${escapeHtml(link.taskId)}">
            <span class="${prioDotClass(link.priority)}"></span>
            <span class="backlinks__title">${escapeHtml(link.title)}</span>
            ${projectChip(link.projectName, link.projectColor)}
          </button>`).join('')}
        </footer>`;
}

// Document↔document links, tri-state: null/undefined = not fetched yet →
// render nothing; [] = fetched, empty → "No links."; entries → grouped rows.
function renderLinksSection(links) {
  if (links == null) return '';
  const list = Array.isArray(links) ? links : [];
  if (!list.length) {
    return `
        <section class="doc-links" data-document-links aria-label="Document links">
          <p class="doc-links__empty">No links.</p>
        </section>`;
  }

  const outbound = list.filter((link) => link.direction === 'outbound');
  const inbound = list.filter((link) => link.direction === 'inbound');
  const group = (label, entries, showRelation) => (!entries.length ? '' : `
          <div class="doc-links__group">
            <div class="doc-links__label">${label}</div>
            ${entries.map((entry) => `
            <button class="doc-row" type="button" data-action="open-doc" data-document-id="${escapeHtml(entry.documentId)}">
              <span class="doc-row__title">${escapeHtml(entry.title || 'Untitled')}</span>
              ${showRelation ? `<small>(${escapeHtml(entry.relation)})</small>` : ''}
            </button>`).join('')}
          </div>`);

  return `
        <section class="doc-links" data-document-links aria-label="Document links">
          ${group('Derived from', outbound.filter((link) => link.relation === 'derived-from'), false)}
          ${group('Supersedes', outbound.filter((link) => link.relation === 'supersedes'), false)}
          ${group('Backlinks', inbound, true)}
        </section>`;
}

function editContent(body) {
  return `
            <div class="code-editor" data-code-editor hidden></div>
            <textarea class="editor-ta" data-document-editor spellcheck="false">${escapeHtml(body)}</textarea>`;
}

function previewContent(previewHtml, backlinksHtml) {
  return `
            <div class="prose" data-markdown-preview>${previewHtml}</div>${backlinksHtml}`;
}

// renderEditorHtml(state, doc, model)
// model = { outline, backlinks, previewHtml, links? } — outline/backlinks from
// buildOutline/buildBacklinks, previewHtml from markdownPreview (trusted, not
// re-escaped). Links default to state.documentLinks when model omits them.
// Word/char/read-time counts come from state.documentDraftBody (doc.body when
// no draft is loaded); save status from state.documentSaveStatus.
export function renderEditorHtml(state, doc, model = {}) {
  if (!doc) return '';

  const readOnly = Boolean(doc.archivedAt);
  const mode = readOnly
    ? 'preview'
    : (EDITOR_MODES.some(([value]) => value === state.editorMode) ? state.editorMode : 'split');
  const focus = Boolean(state.editorFocus);
  const outline = Array.isArray(model.outline) ? model.outline : [];
  const backlinks = Array.isArray(model.backlinks) ? model.backlinks : [];
  const previewHtml = model.previewHtml || '';
  const links = model.links === undefined ? state.documentLinks : model.links;
  const body = String(state.documentDraftBody ?? doc.body ?? '');

  const showEdit = mode === 'edit' || mode === 'split';
  const showPreview = mode === 'preview' || mode === 'split';
  const split = mode === 'split';

  const backlinksHtml = showPreview ? renderBacklinksFooter(backlinks) : '';
  const linksHtml = renderLinksSection(links);
  const outlineHtml = state.outlineOpen && outline.length > 1 && !focus
    ? renderOutlineRail(outline)
    : '';
  const toolbarHtml = showEdit && !readOnly && !focus ? renderToolbar() : '';

  let panesHtml;
  if (split) {
    panesHtml = `
      <section class="pane" aria-label="Markdown editor">
        <div class="pane__label">Markdown</div>
        <div class="pane__scroll">${editContent(body)}
        </div>
      </section>
      <section class="pane" aria-label="Markdown preview">
        <div class="pane__label">Preview</div>
        <div class="pane__scroll">${previewContent(previewHtml, backlinksHtml)}${linksHtml}
        </div>
      </section>`;
  } else {
    const sheetContent = showPreview ? previewContent(previewHtml, backlinksHtml) : editContent(body);
    panesHtml = `
      <section class="pane pane--sheet${focus ? ' pane--focus' : ''}" aria-label="${showPreview ? 'Markdown preview' : 'Markdown editor'}">
        <div class="pane__scroll">
          <div class="sheet">${sheetContent}
          </div>${linksHtml}
        </div>
      </section>`;
  }

  const words = body.split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.round(words / 200));
  const saveStatus = state.documentSaveStatus || 'Saved';

  return `
  <div class="editor">
    ${renderHead(state, doc, { mode, readOnly })}
    ${renderTrustStrip(doc, { readOnly })}
    ${state.isDocumentInfoEditorOpen ? renderInfoForm(state, doc) : ''}
    ${toolbarHtml}
    <div class="editor-body">${outlineHtml}${panesHtml}
    </div>
    <footer class="editor-foot">
      <span>${words} words · ${body.length} characters · ${readTime} min read</span>
      <span>Markdown · <span data-document-save-status>${escapeHtml(saveStatus)}</span></span>
    </footer>
  </div>`;
}
