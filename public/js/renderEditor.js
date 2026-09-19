import { DOCUMENT_TYPES, isDocumentType } from './documentTypes.js';
import { externalRefKind, EXTERNAL_REF_KIND_LABELS, isSafeHttpUrl, refsToLines } from './externalRefKind.js';
import { escapeHtml, chip, prioDotClass } from './renderHelpers.js';
import { DOCUMENT_INFO_FIELD_LABELS } from './documentInfoDraft.js';

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

// The shared taxonomy registry drives the doc-info Type select.

// Outline: headings #–### → [{ label, level, index }] where index is the
// heading ordinal (payload for data-action="outline-jump"). Markdown symbols
// are stripped from labels, matching the design prototype.
export function buildOutline(text) {
  const items = [];
  String(text ?? '').split(/\r?\n/).forEach((line, lineNumber) => {
    const match = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!match) return;
    items.push({
      label: match[2].replace(/[*`_\[\]]/g, '').trim(),
      level: match[1].length,
      index: items.length,
      line: lineNumber,
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
  return `<span class="chip chip--project" style="--project-color:${safeColor};background:color-mix(in oklab, ${safeColor} 13%, transparent)">${escapeHtml(name)}</span>`;
}

function trustChips(doc) {
  const chips = [];
  if (doc.kind === 'synthesized') {
    chips.push('<span class="chip chip--synth" aria-label="Document kind: synthesized">SYNTH</span>');
  }
  if (doc.verified === true) {
    chips.push('<span class="chip chip--verified" aria-label="Verified by a human">VERIFIED</span>');
  }
  if (doc.status === 'superseded') {
    chips.push('<span class="chip chip--superseded" aria-label="Superseded by a newer document">SUPERSEDED</span>');
  }
  if (doc.archivedAt) {
    chips.push('<span class="chip chip--state-archived" aria-label="Archived document">ARCHIVED</span>');
  }
  return chips.join('');
}

function renderDocMenu(state, doc, { readOnly }) {
  const verifiedText = doc.verified
    ? `verified${doc.verifiedBy ? ` by ${escapeHtml(doc.verifiedBy)}` : ''}`
    : 'unverified';
  const meta = `${doc.kind === 'synthesized' ? 'Synthesized' : 'Source'} · updated by ${escapeHtml(doc.updatedBy || 'user')} · ${verifiedText}`;

  const items = readOnly ? `
        <button role="menuitem" class="menu__item" type="button" data-action="restore-document">Restore</button>
        <button role="menuitem" class="menu__item menu__item--danger" type="button" data-action="delete-document">Delete permanently…</button>` : `
        <button role="menuitem" class="menu__item" type="button" data-action="edit-document-info">Document info…</button>
        <button role="menuitem" class="menu__item" type="button" data-action="toggle-verify">${doc.verified ? 'Unverify' : 'Verify'}</button>
        ${doc.status === 'superseded' ? '' : '<button role="menuitem" class="menu__item" type="button" data-action="supersede-document">Supersede…</button>'}
        <button role="menuitem" class="menu__item menu__item--danger" type="button" data-action="archive-document">Archive</button>
        <button role="menuitem" class="menu__item menu__item--danger" type="button" data-action="delete-document">Delete permanently…</button>`;

  return `
      <div class="menu">
        <button class="btn-ghost" type="button" data-action="toggle-doc-menu" aria-haspopup="true" aria-expanded="${Boolean(state.docMenuOpen)}" title="Document actions">•••</button>
        ${state.docMenuOpen ? `<div class="menu__panel" role="menu">
          <div class="menu__meta">${meta}</div>
          ${items}
        </div>` : ''}
      </div>`;
}

// The review-queue walk (year-one spec item 11): when this document was
// opened from the queue, a strip under the header says where you are in it
// and offers the next step — verify (the same read-then-verify action as
// the menu) and move on, skip, or go back. It shows only while the walk's
// current id is THIS document, so opening something else simply hides it.
export function renderReviewWalkHtml(state, doc) {
  const walk = state.reviewWalk;
  if (!walk || !Array.isArray(walk.ids) || walk.ids[walk.index] !== doc?.id) return '';
  const position = walk.index + 1;
  const total = walk.ids.length;
  const last = position >= total;
  const verified = Number(walk.verified) || 0;
  const primary = doc.verified === true
    ? `<button class="btn-primary btn-primary--sm" type="button" data-action="review-walk-skip">${last ? 'Finish' : 'Next'}</button>`
    : `<button class="btn-primary btn-primary--sm" type="button" data-action="review-walk-verify" title="Approve the saved content shown, then move on">${last ? 'Verify and finish' : 'Verify and next'}</button>`;
  // Skip stays available on the last document too — leaving it unverified is
  // a decision, and it should not take a detour through Back to queue.
  const skip = doc.verified === true
    ? ''
    : `<button class="btn-ghost" type="button" data-action="review-walk-skip">${last ? 'Skip and finish' : 'Skip'}</button>`;
  return `
    <div class="review-walk" role="region" aria-label="Review queue walk">
      <span class="review-walk__label">Review queue · <b>${position} of ${total}</b>${verified ? ` · ${verified} verified` : ''}</span>
      <span class="review-walk__hint">Read it, then decide. Only verified memory is recalled by default.</span>
      <span class="review-walk__actions">${primary}${skip}<button class="btn-ghost" type="button" data-action="back-to-library">Back to queue</button></span>
    </div>`;
}

function renderHead(state, doc, { mode, readOnly, project }) {
  const tags = (Array.isArray(doc.tags) ? doc.tags : []).filter(Boolean);
  const title = state.documentDraftId === doc.id ? state.documentDraftTitle : doc.title;
  const seg = readOnly ? '' : `
      <div class="seg" role="group" aria-label="Editor mode">
        ${EDITOR_MODES.map(([value, label]) => `<button type="button" data-action="set-editor-mode" data-mode="${value}"${mode === value ? ' class="is-active"' : ''} aria-pressed="${mode === value}">${label}</button>`).join('')}
      </div>`;

  return `
    <header class="editor-head">
      <button class="editor-head__back" type="button" data-action="back-to-library" title="Back to library" aria-label="Back to library">←</button>
      <input class="editor-head__title" type="text" data-doc-title value="${escapeHtml(title || '')}" aria-label="Document title" autocomplete="off" spellcheck="false"${readOnly ? ' readonly' : ''}>
      <div class="editor-head__tags">${projectChip(project?.name, project?.color)}${tags.map((tag) => chip(`#${tag}`, 'tag')).join('')}${trustChips(doc)}</div>
      <button class="btn-ghost btn-ghost--toggle${state.outlineOpen ? ' is-on' : ''}" type="button" data-action="toggle-outline" aria-pressed="${Boolean(state.outlineOpen)}">Outline</button>
      ${!readOnly && doc.documentType === 'runbook' ? `<button class="btn-primary btn-primary--sm" type="button" data-action="start-run" title="Start a run — track each step with a timestamp"${state.runStartPending ? ' disabled' : ''}>${state.runStartPending ? 'Starting…' : '▶ Run'}</button>` : ''}
      <button class="btn-ghost" type="button" data-action="export-doc" title="Download this document as .md">Export</button>
      ${seg}
      <button class="btn-ghost${state.editorFocus ? ' is-on' : ''}" type="button" data-action="toggle-focus" title="Focus mode (Esc to exit)" aria-pressed="${Boolean(state.editorFocus)}">Focus</button>
      ${renderDocMenu(state, doc, { readOnly })}
    </header>`;
}

// The form renders from the explicit draft (state.documentInfoDraft) whenever
// one is open for this document, so a rerender or a failed save never
// re-seeds the inputs from the record and discards what the person typed.
// The record-derived fallback only serves a form opened without a draft.
function renderInfoForm(state, doc, projects = []) {
  const draft = state.documentInfoDraft && state.documentInfoDraft.documentId === doc.id ? state.documentInfoDraft : null;
  const fields = draft ? draft.fields : {
    title: state.documentDraftId === doc.id ? state.documentDraftTitle : doc.title,
    documentType: doc.documentType,
    projectId: doc.projectId,
    tags: Array.isArray(doc.tags) ? doc.tags.join(', ') : '',
    sourceFilename: doc.sourceFilename || '',
    refsText: refsToLines(state.docInfoRefsSeed),
  };
  const type = isDocumentType(fields.documentType) ? fields.documentType : 'note';
  const pending = Boolean(draft?.pending);
  const conflict = draft?.conflict || null;
  const projectName = (id) => projects.find((project) => project.id === id)?.name || id || '—';
  const display = (field, value) => {
    if (field === 'projectId') return projectName(value);
    if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
    const text = String(value ?? '').trim();
    return text || '(none)';
  };
  const conflictHtml = conflict ? `
      <div class="editor-info__error editor-info__conflict" data-doc-info-conflict role="alert">
        <p>This document changed while you were editing. Review the contested values, choose which to keep, then save again. Your entries are kept until you decide.</p>
        <ul>${conflict.conflicts.map((field) => `<li><strong>${escapeHtml(DOCUMENT_INFO_FIELD_LABELS[field] || field)}</strong> — theirs: ${escapeHtml(display(field, conflict.remote?.[field]))} · yours: ${escapeHtml(display(field, fields[field]))}</li>`).join('')}</ul>
        <div class="editor-info__actions">
          <button class="btn-ghost" type="button" data-action="doc-info-keep-theirs">Use current values</button>
          <button class="btn-ghost" type="button" data-action="doc-info-keep-mine">Keep my changes</button>
        </div>
      </div>` : '';
  return `
    <div class="editor-info">
      ${state.documentInfoError ? `<div class="editor-info__error" role="alert">${escapeHtml(state.documentInfoError)}</div>` : ''}
      ${conflictHtml}
      <label class="editor-info__field"><span>Title</span>
        <input class="text-input" type="text" data-doc-info-title value="${escapeHtml(fields.title || '')}" autocomplete="off"${pending ? ' disabled' : ''}>
      </label>
      <label class="editor-info__field"><span>Type</span>
        <select class="text-input" data-doc-info-type${pending ? ' disabled' : ''}>
          ${DOCUMENT_TYPES.map((option) => `<option value="${option.value}"${option.value === type ? ' selected' : ''}>${option.label}</option>`).join('')}
        </select>
      </label>
      <label class="editor-info__field"><span>Project</span>
        <select class="text-input" data-doc-info-project${pending ? ' disabled' : ''}>
          ${projects.map(project => `<option value="${escapeHtml(project.id)}"${project.id === fields.projectId ? ' selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
        </select>
      </label>
      <label class="editor-info__field"><span>Tags</span>
        <input class="text-input" type="text" data-doc-info-tags value="${escapeHtml(fields.tags || '')}" placeholder="postgres, backup" autocomplete="off"${pending ? ' disabled' : ''}>
      </label>
      <label class="editor-info__field"><span>Source file</span>
        <input class="text-input" type="text" data-doc-info-source value="${escapeHtml(fields.sourceFilename || '')}" autocomplete="off"${pending ? ' disabled' : ''}>
      </label>
      <label class="editor-info__field"><span>External references</span>
        <textarea class="text-input editor-info__refs" data-doc-info-refs rows="3" placeholder="https://github.com/org/repo/pull/42 | The PR&#10;one URL per line, optional  | label" autocomplete="off" spellcheck="false"${pending ? ' disabled' : ''}>${escapeHtml(fields.refsText || '')}</textarea>
      </label>
      <div class="editor-info__actions">
        <button class="btn-ghost" type="button" data-action="save-document-info"${pending ? ' disabled' : ''}>${pending ? 'Saving…' : 'Save'}</button>
        <button class="btn-ghost" type="button" data-action="cancel-document-info"${pending ? ' disabled' : ''}>Cancel</button>
      </div>
    </div>`;
}

// Single source of truth for the writing-action menu (also drives main.js's
// WRITE_LABELS lookup). Order here is the menu order.
export const WRITE_ACTIONS = [
  ['draft', 'Draft from title'],
  ['summarize', 'Summarize'],
  ['rewrite', 'Rewrite for clarity'],
  ['checklist', 'Notes → checklist'],
];

function renderToolbar(state) {
  const canWrite = Boolean(state.chatStatus?.available);
  const aiMenu = `<div class="menu toolbar__ai">
      <button class="btn-ghost toolbar__ai-btn" type="button" data-action="toggle-write-menu" aria-haspopup="true" aria-expanded="${Boolean(state.writeMenuOpen)}"${canWrite ? '' : ' disabled title="Set an AI model in Settings ▸ Intelligence"'}>✦ AI</button>
      ${state.writeMenuOpen && canWrite ? `<div class="menu__panel" role="menu">
        ${WRITE_ACTIONS.map(([action, label]) => `<button role="menuitem" class="menu__item" type="button" data-action="write-action" data-write="${action}">${label}</button>`).join('')}
      </div>` : ''}
    </div>`;
  return `
    <div class="toolbar" aria-label="Markdown formatting">
      ${MARKDOWN_TOOLS.map((tool) => `<button type="button" data-action="md-format" data-md-action="${tool.action}" title="${escapeHtml(tool.title)}" aria-label="${escapeHtml(tool.title)}">${escapeHtml(tool.label)}</button>`).join('')}
      <span class="toolbar__hint">⌘B bold · ⌘I italic · ⌘E code</span>
      ${aiMenu}
    </div>`;
}

function renderOutlineRail(outline) {
  // With fewer than two headings there is nothing to navigate — but the rail
  // still renders (an active toggle must visibly do something) with a hint
  // that teaches how to populate it.
  const hint = outline.length < 2
    ? '<p class="outline__hint">Add <code>##</code> section headings and they appear here for quick jumps.</p>'
    : '';
  return `
      <aside class="outline" aria-label="Document outline">
        <div class="outline__label">Outline</div>
        ${outline.map((item) => `<button type="button" data-action="outline-jump" data-heading-index="${item.index}" data-line="${item.line}" style="padding-left:${8 + (item.level - 1) * 11}px">${escapeHtml(item.label)}</button>`).join('')}${hint}
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

// External references — outside URLs the document points at (a PR, a dashboard,
// an upstream bug). Read-only here (rows open in a new tab); editing lives in
// Document info. Tri-state like the links section: null = not fetched → nothing.
function renderExternalRefsSection(refs) {
  if (refs == null) return '';
  const list = Array.isArray(refs) ? refs : [];
  if (!list.length) return '';
  const rows = list.map((ref) => {
    const kind = externalRefKind(ref.url);
    const text = ref.label || ref.url;
    const chip = `<span class="doc-row__kind chip chip--ref-${kind}">${escapeHtml(EXTERNAL_REF_KIND_LABELS[kind] || 'Link')}</span>`;
    const title = `<span class="doc-row__title">${escapeHtml(text)}</span>`;
    // Only http(s)/mailto URLs become clickable anchors; anything else (e.g. a
    // javascript: URL, or a bare scp-like git@host:path) renders as inert text
    // so a stored URL can never execute or navigate somewhere unexpected.
    if (!isSafeHttpUrl(ref.url)) {
      return `
            <div class="doc-row doc-row--external doc-row--inert" title="${escapeHtml(ref.url)}">
              ${chip}
              ${title}
            </div>`;
    }
    return `
            <a class="doc-row doc-row--external" href="${escapeHtml(ref.url)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(ref.url)}">
              ${chip}
              ${title}
              <span class="doc-row__ext" aria-hidden="true">↗</span>
            </a>`;
  }).join('');
  return `
        <section class="doc-links" data-external-refs aria-label="External references">
          <div class="doc-links__group">
            <div class="doc-links__label">External references</div>
            ${rows}
          </div>
        </section>`;
}

// "More like this" — documents most similar by embedding. null/undefined = not
// fetched yet; [] or none = render nothing (semantic search may be off).
function renderRelatedSection(related) {
  if (related?.degraded) {
    const message = related.reason === 'semantic-off' ? 'Related documents are unavailable while semantic search is off.'
      : related.reason === 'not-indexed' ? 'Related documents will be available after this document is indexed.'
      : related.reason === 'index-incomplete' ? 'Some documents are still being indexed; related results may be incomplete.'
      : 'Related documents could not be loaded. Try again when the connection is available.';
    if (!related.items?.length) return '<section class="doc-related" aria-label="Related documents"><p role="status">' + escapeHtml(message) + '</p></section>';
  }
  const list = Array.isArray(related) ? related : (related?.items || []);
  if (!list.length) return '';
  return `
        <section class="doc-related" aria-label="Related documents">
          <div class="doc-related__label">Related documents</div>
          ${related?.degraded ? '<p role="status">Some documents are still being indexed; results may be incomplete.</p>' : ''}
          ${list.map((doc) => `
          <button class="doc-row doc-related__row" type="button" data-action="open-doc" data-document-id="${escapeHtml(doc.id)}">
            <span class="doc-row__title">${escapeHtml(doc.title || 'Untitled')}</span>
            ${Number.isFinite(doc.similarity) ? `<span class="doc-related__score">${Math.round(doc.similarity * 100)}%</span>` : ''}
          </button>`).join('')}
        </section>`;
}

// Past runs of a runbook, newest first. Hidden for notes and until fetched
// (state.documentRuns is null before the first fetch, [] when there are none).
function renderRunsSection(state, doc) {
  if (!doc || doc.documentType !== 'runbook') return '';
  const runs = Array.isArray(state.documentRuns) ? state.documentRuns : [];
  if (!runs.length) return '';
  return `
        <section class="doc-runs-section" aria-label="Past runs">
          <div class="doc-related__label">Past runs</div>
          <div class="doc-runs">
          ${runs.map((run) => `
            <button class="run-row" type="button" data-action="open-run" data-run-id="${escapeHtml(run.id)}" data-document-id="${escapeHtml(doc.id)}">
              <span class="chip chip--run-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
              <span class="run-row__title">${escapeHtml(run.title || String(run.startedAt || '').slice(0, 10))}</span>
              <span class="run-row__meta">${Number(run.doneCount) || 0}/${Number(run.stepCount) || 0}</span>
            </button>`).join('')}
          </div>
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
  const project = model.project || null;
  const projects = Array.isArray(model.projects) ? model.projects : (project ? [project] : []);

  const showEdit = mode === 'edit' || mode === 'split';
  const showPreview = mode === 'preview' || mode === 'split';
  const split = mode === 'split';

  const related = model.related === undefined ? state.documentSimilar : model.related;
  const backlinksHtml = showPreview ? renderBacklinksFooter(backlinks) : '';
  const relatedHtml = showPreview ? renderRelatedSection(related) : '';
  const runsHtml = showPreview ? renderRunsSection(state, doc) : '';
  const linksHtml = renderLinksSection(links);
  const extRefsHtml = renderExternalRefsSection(model.externalRefs === undefined ? state.documentExternalRefs : model.externalRefs);
  const outlineHtml = state.outlineOpen && !focus
    ? renderOutlineRail(outline)
    : '';
  const toolbarHtml = showEdit && !readOnly && !focus ? renderToolbar(state) : '';

  let panesHtml;
  if (split) {
    panesHtml = `
      <section class="pane" aria-label="Markdown editor">
        <div class="pane__label">Markdown</div>
        <div class="pane__scroll pane__scroll--edit">${editContent(body)}
        </div>
      </section>
      <section class="pane" aria-label="Markdown preview">
        <div class="pane__label">Preview</div>
        <div class="pane__scroll">${previewContent(previewHtml, backlinksHtml)}${runsHtml}${relatedHtml}${linksHtml}${extRefsHtml}
        </div>
      </section>`;
  } else {
    // The sheet is a fixed page; its content scrolls inside (prose in
    // .sheet__scroll, CodeMirror via its own scroller). Doc links render in
    // preview contexts only — while writing, the page holds just the text.
    const sheetContent = showPreview
      ? `<div class="sheet__scroll">${previewContent(previewHtml, backlinksHtml)}${runsHtml}${relatedHtml}${linksHtml}${extRefsHtml}
          </div>`
      : editContent(body);
    panesHtml = `
      <section class="pane pane--sheet${focus ? ' pane--focus' : ''}" aria-label="${showPreview ? 'Markdown preview' : 'Markdown editor'}">
        <div class="pane__scroll">
          <div class="sheet">${sheetContent}
          </div>
        </div>
      </section>`;
  }

  const words = body.split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.round(words / 200));
  const saveStatus = state.documentSaveStatus || 'Saved';
  const recoveryReason = state.documentDraftRecoveryReason || null;
  const recoveryLabel = recoveryReason === 'conflict'
    ? 'Review and save'
    : (recoveryReason === 'recovered' ? 'Save recovered draft' : 'Retry');
  const showRecoveryAction = !readOnly && ['failed', 'recovered', 'conflict'].includes(recoveryReason);

  return `
  <div class="editor">
    ${renderHead(state, doc, { mode, readOnly, project })}
    ${renderReviewWalkHtml(state, doc)}
    ${state.isDocumentInfoEditorOpen ? renderInfoForm(state, doc, projects) : ''}
    ${toolbarHtml}
    <div class="editor-body">${outlineHtml}${panesHtml}
    </div>
    <footer class="editor-foot">
      <span data-editor-counts>${words} words · ${body.length} characters · ${readTime} min read</span>
      <span class="editor-foot__save">Markdown · <span data-document-save-status role="status" aria-live="polite">${escapeHtml(saveStatus)}</span>
        ${readOnly ? '' : `<button class="editor-foot__save-action" type="button" data-action="retry-document-save" data-document-save-action${showRecoveryAction ? '' : ' hidden'}>${escapeHtml(recoveryLabel)}</button>
        <button class="editor-foot__save-action" type="button" data-action="discard-document-draft"${showRecoveryAction ? '' : ' hidden'}>Discard draft</button>`}
      </span>
    </footer>
  </div>`;
}
