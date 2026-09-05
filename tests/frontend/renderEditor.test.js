import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEditorHtml, buildOutline, buildBacklinks } from '../../public/js/renderEditor.js';

const baseDoc = {
  id: 'doc-1',
  title: 'Postgres restore',
  body: '# Restore\n\nSteps.',
  documentType: 'runbook',
  projectId: 'p1',
  tags: ['postgres', 'backup'],
  sourceFilename: null,
  archivedAt: null,
  kind: 'source',
  status: 'active',
  verified: false,
  verifiedBy: null,
  updatedBy: 'user',
};

function makeState(overrides = {}) {
  return {
    editorMode: 'split',
    editorFocus: false,
    outlineOpen: false,
    documentDraftId: baseDoc.id,
    documentDraftTitle: baseDoc.title,
    documentDraftBody: baseDoc.body,
    documentSaveStatus: 'Saved',
    documentDraftRecoveryReason: null,
    isDocumentInfoEditorOpen: false,
    documentInfoError: '',
    documentLinks: null,
    ...overrides,
  };
}

function render(stateOverrides = {}, docOverrides = {}, model = {}) {
  return renderEditorHtml(
    makeState(stateOverrides),
    { ...baseDoc, ...docOverrides },
    {
      previewHtml: '<p>preview</p>',
      project: { id: 'p1', name: 'Homelab', color: '#4C8B78' },
      projects: [
        { id: 'p1', name: 'Homelab' },
        { id: 'p2', name: 'Work' },
      ],
      ...model,
    },
  );
}

// ---- buildOutline ------------------------------------------------------------

test('buildOutline collects #–### headings with levels, ordinals, source lines, and md symbols stripped', () => {
  const outline = buildOutline('# One\ntext\n## *Two* `code`\n### [Three](url)\n#### Four');
  assert.deepEqual(outline, [
    { label: 'One', level: 1, index: 0, line: 0 },
    { label: 'Two code', level: 2, index: 1, line: 2 },
    { label: 'Three(url)', level: 3, index: 2, line: 3 },
  ]);
});

test('buildOutline returns [] for empty or heading-less text', () => {
  assert.deepEqual(buildOutline(''), []);
  assert.deepEqual(buildOutline(null), []);
  assert.deepEqual(buildOutline('plain text\nno headings'), []);
});

test('outline rail renders when open with 2+ headings, padded by level, carrying source lines', () => {
  const outline = buildOutline('# A\n## B\n### C');
  const html = render({ outlineOpen: true }, {}, { outline });
  assert.match(html, /class="outline"/);
  assert.match(html, /data-action="outline-jump" data-heading-index="0" data-line="0" style="padding-left:8px"/);
  assert.match(html, /data-heading-index="1" data-line="1" style="padding-left:19px"/);
  assert.match(html, /data-heading-index="2" data-line="2" style="padding-left:30px"/);
  assert.equal(html.includes('outline__hint'), false);
});

test('outline rail open with fewer than 2 headings shows the teach-hint (not hidden)', () => {
  const one = buildOutline('# Only');
  const html = render({ outlineOpen: true }, {}, { outline: one });
  assert.match(html, /class="outline"/);
  assert.match(html, /outline__hint/);
  assert.match(html, /data-heading-index="0"/); // the lone heading still lists
});

test('outline rail hidden when toggled off', () => {
  const two = buildOutline('# A\n## B');
  assert.equal(render({ outlineOpen: false }, {}, { outline: two }).includes('class="outline"'), false);
});

// ---- buildBacklinks ----------------------------------------------------------

test('buildBacklinks keeps non-archived tasks whose docIds include the doc', () => {
  const tasks = [
    { id: 't1', title: 'Restore DB', projectId: 'p1', priority: 'high', archivedAt: null, docIds: ['doc-1', 'doc-9'] },
    { id: 't2', title: 'Archived', projectId: 'p1', priority: 'low', archivedAt: '2026-01-01T00:00:00.000Z', docIds: ['doc-1'] },
    { id: 't3', title: 'Elsewhere', projectId: 'p1', priority: 'low', archivedAt: null, docIds: ['doc-2'] },
    { id: 't4', title: 'No links', projectId: 'p1', archivedAt: null },
  ];
  const projects = [{ id: 'p1', name: 'Homelab', color: '#4C8B78' }];
  assert.deepEqual(buildBacklinks(tasks, projects, 'doc-1'), [
    { taskId: 't1', title: 'Restore DB', projectName: 'Homelab', projectColor: '#4C8B78', priority: 'high' },
  ]);
  assert.deepEqual(buildBacklinks([], projects, 'doc-1'), []);
});

test('buildBacklinks tolerates a missing project', () => {
  const rows = buildBacklinks(
    [{ id: 't1', title: 'X', projectId: 'ghost', priority: 'medium', docIds: ['d'] }],
    [],
    'd',
  );
  assert.deepEqual(rows, [{ taskId: 't1', title: 'X', projectName: '', projectColor: '', priority: 'medium' }]);
});

test('backlinks footer lists referencing tasks with priority dot and project chip', () => {
  const backlinks = [
    { taskId: 't1', title: 'Restore DB', projectName: 'Homelab', projectColor: '#4C8B78', priority: 'high' },
    { taskId: 't2', title: 'Verify backups', projectName: 'Ops', projectColor: '#888888', priority: 'medium' },
  ];
  const html = render({ editorMode: 'preview' }, {}, { backlinks });
  assert.match(html, /Referenced by 2 task\(s\)/);
  assert.match(html, /data-action="open-task" data-task-id="t1"/);
  assert.match(html, /data-action="open-task" data-task-id="t2"/);
  assert.match(html, /prio-dot--high/);
  assert.match(html, /prio-dot--med/);
  assert.match(html, /Restore DB/);
  assert.match(html, /chip chip--project[^>]*>Homelab</);
});

test('no backlinks footer when nothing references the doc', () => {
  const html = render({ editorMode: 'preview' }, {}, { backlinks: [] });
  assert.equal(html.includes('Referenced by'), false);
});

// ---- modes / panes -----------------------------------------------------------

test('mode seg marks the active mode', () => {
  const html = render({ editorMode: 'edit' });
  assert.match(html, /data-action="set-editor-mode" data-mode="edit" class="is-active" aria-pressed="true"/);
  assert.match(html, /data-mode="split" aria-pressed="false"/);
  assert.match(html, /data-mode="preview" aria-pressed="false"/);
});

test('split renders two labeled panes with editor host and preview', () => {
  const html = render({ editorMode: 'split' });
  assert.match(html, /pane__label">Markdown</);
  assert.match(html, /pane__label">Preview</);
  assert.equal(html.includes('pane--sheet'), false);
  assert.match(html, /data-code-editor hidden/);
  assert.match(html, /data-document-editor/);
  assert.match(html, /data-markdown-preview/);
});

test('edit-only renders a single sheet pane without preview', () => {
  const html = render({ editorMode: 'edit' });
  assert.match(html, /pane pane--sheet/);
  assert.match(html, /class="sheet"/);
  assert.match(html, /data-document-editor/);
  assert.equal(html.includes('data-markdown-preview'), false);
  assert.equal(html.includes('pane__label'), false);
});

test('preview-only renders trusted preview html inside a sheet, unescaped', () => {
  const html = render({ editorMode: 'preview' }, {}, { previewHtml: '<p>hello <strong>world</strong></p>' });
  assert.match(html, /pane pane--sheet/);
  assert.ok(html.includes('<p>hello <strong>world</strong></p>'));
  assert.equal(html.includes('data-document-editor'), false);
  assert.equal(html.includes('data-code-editor'), false);
});

test('focus mode hides toolbar and outline and marks the sheet pane', () => {
  const outline = buildOutline('# A\n## B');
  const html = render({ editorMode: 'edit', editorFocus: true, outlineOpen: true }, {}, { outline });
  assert.equal(html.includes('data-action="md-format"'), false);
  assert.equal(html.includes('class="outline"'), false);
  assert.match(html, /pane--focus/);
  assert.match(html, /data-action="toggle-focus"[^>]*aria-pressed="true"/);
});

// ---- archived (readOnly) -----------------------------------------------------

test('archived doc forces preview and offers restore/delete in the menu', () => {
  const html = render({ editorMode: 'edit', docMenuOpen: true }, { archivedAt: '2026-06-01T00:00:00.000Z' });
  assert.match(html, /data-markdown-preview/);
  assert.equal(html.includes('data-document-editor'), false);
  assert.equal(html.includes('data-action="set-editor-mode"'), false);
  assert.equal(html.includes('data-action="md-format"'), false);
  assert.match(html, /chip--state-archived[^>]*>ARCHIVED</);
  assert.match(html, /data-action="restore-document"/);
  assert.match(html, /data-action="delete-document"/);
  assert.equal(html.includes('data-action="archive-document"'), false);
  assert.equal(html.includes('data-action="toggle-verify"'), false);
  assert.equal(html.includes('data-action="supersede-document"'), false);
});

// ---- trust chips + document menu ------------------------------------------------

test('the header keeps the prototype shape: no trust strip, actions behind the menu', () => {
  const html = render();
  assert.equal(html.includes('trust-strip'), false);
  assert.match(html, /data-action="toggle-doc-menu"/);
  // menu closed by default: no actions rendered yet
  assert.equal(html.includes('data-action="toggle-verify"'), false);
  assert.equal(html.includes('data-action="archive-document"'), false);
  // a plain source doc shows no trust chips in the header
  assert.equal(html.includes('>SOURCE<'), false);
});

test('the editor header always identifies the owning project', () => {
  const html = render();
  assert.match(html, /editor-head__tags[^>]*>[\s\S]*?chip chip--project[^>]*>Homelab<\/span>/);
});

test('the open menu carries meta and verify/supersede/archive/delete/info for a source doc', () => {
  const html = render({ docMenuOpen: true });
  assert.match(html, /menu__meta">Source · updated by user · unverified</);
  assert.match(html, /data-action="edit-document-info">Document info…</);
  assert.match(html, /data-action="toggle-verify">Verify</);
  assert.match(html, /data-action="supersede-document">Supersede…</);
  assert.match(html, /data-action="archive-document">Archive</);
  // Delete permanently sits alongside Archive for active docs.
  assert.match(html, /data-action="delete-document">Delete permanently…</);
});

test('synthesized + verified doc shows header chips and flips the menu labels', () => {
  const html = render({ docMenuOpen: true }, { kind: 'synthesized', verified: true, verifiedBy: 'marc', updatedBy: 'agent' });
  assert.match(html, /chip--synth[^>]*>SYNTH</);
  assert.match(html, /chip--verified[^>]*>VERIFIED</);
  assert.match(html, /data-action="toggle-verify">Unverify</);
  assert.match(html, /Synthesized · updated by agent · verified by marc/);
});

test('superseded doc shows the chip and hides the supersede action', () => {
  const html = render({ docMenuOpen: true }, { status: 'superseded' });
  assert.match(html, /chip--superseded[^>]*>SUPERSEDED</);
  assert.equal(html.includes('data-action="supersede-document"'), false);
});

// ---- links tri-state -----------------------------------------------------------

test('links render nothing before the fetch (null)', () => {
  const html = render({ documentLinks: null });
  assert.equal(html.includes('data-document-links'), false);
  assert.equal(html.includes('No links.'), false);
});

test('links render the empty state once fetched ([])', () => {
  const html = render({ documentLinks: [] });
  assert.match(html, /data-document-links/);
  assert.match(html, /No links\./);
});

test('links group Derived from / Supersedes / Backlinks as doc rows', () => {
  const html = render({
    documentLinks: [
      { documentId: 'd2', title: 'Source A', relation: 'derived-from', direction: 'outbound' },
      { documentId: 'd3', title: 'Old runbook', relation: 'supersedes', direction: 'outbound' },
      { documentId: 'd4', title: 'Derivation B', relation: 'derived-from', direction: 'inbound' },
    ],
  });
  assert.match(html, /data-document-links/);
  assert.match(html, /Derived from/);
  assert.match(html, /Supersedes/);
  assert.match(html, /Backlinks/);
  assert.match(html, /data-action="open-doc" data-document-id="d2">\s*<span class="doc-row__title">Source A</);
  assert.match(html, /data-action="open-doc" data-document-id="d3">\s*<span class="doc-row__title">Old runbook</);
  assert.match(html, /data-document-id="d4">\s*<span class="doc-row__title">Derivation B<\/span>\s*<small>\(derived-from\)<\/small>/);
});

// ---- info form -----------------------------------------------------------------

test('info form renders fields and error when open', () => {
  const html = render(
    { isDocumentInfoEditorOpen: true, documentInfoError: 'Title is required' },
    { sourceFilename: 'restore.md' },
  );
  assert.match(html, /data-doc-info-title value="Postgres restore"/);
  assert.match(html, /data-doc-info-type/);
  assert.match(html, /value="runbook" selected/);
  assert.match(html, /value="note"/);
  assert.match(html, /data-doc-info-project/);
  assert.match(html, /value="p1" selected>Homelab/);
  assert.match(html, /value="p2">Work/);
  assert.match(html, /data-doc-info-tags value="postgres, backup"/);
  assert.match(html, /data-doc-info-source value="restore.md"/);
  assert.match(html, /data-action="save-document-info"/);
  assert.match(html, /data-action="cancel-document-info"/);
  assert.match(html, /role="alert">Title is required/);
});

test('info form retains a completed current owner while allowing reassignment', () => {
  const html = render(
    { isDocumentInfoEditorOpen: true },
    { projectId: 'completed' },
    {
      project: { id: 'completed', name: 'Completed project', color: '#888888' },
      projects: [
        { id: 'completed', name: 'Completed project', status: 'completed' },
        { id: 'p2', name: 'Work', status: 'active' },
      ],
    },
  );
  assert.match(html, /data-doc-info-project/);
  assert.match(html, /value="completed" selected>Completed project/);
  assert.match(html, /value="p2">Work/);
});

test('info form absent when closed', () => {
  const html = render();
  assert.equal(html.includes('data-doc-info-title'), false);
  assert.equal(html.includes('data-action="save-document-info"'), false);
});

// ---- toolbar -------------------------------------------------------------------

test('toolbar offers every md-format action in edit mode with the shortcut hint', () => {
  const html = render({ editorMode: 'edit' });
  const actions = ['heading', 'bold', 'italic', 'bullet-list', 'numbered-list', 'checklist', 'quote', 'code', 'code-block', 'link'];
  for (const action of actions) {
    assert.match(html, new RegExp(`data-action="md-format" data-md-action="${action}"`), `missing md action ${action}`);
  }
  assert.match(html, /⌘B bold · ⌘I italic · ⌘E code/);
});

test('toolbar absent in preview mode', () => {
  assert.equal(render({ editorMode: 'preview' }).includes('data-action="md-format"'), false);
});

// ---- foot ----------------------------------------------------------------------

test('foot shows word, character, and read-time counts from the draft', () => {
  const html = render({ documentDraftBody: 'one two three' });
  assert.match(html, /3 words · 13 characters · 1 min read/);
});

test('foot carries the save status span', () => {
  const html = render({ documentSaveStatus: 'Autosaving...' });
  assert.match(html, /data-document-save-status role="status" aria-live="polite">Autosaving\.\.\.<\/span>/);
  assert.match(html, /data-document-save-action hidden/);
});

test('foot exposes an explicit recovery action after failure and reload', () => {
  const failed = render({ documentSaveStatus: 'Save failed', documentDraftRecoveryReason: 'failed' });
  assert.match(failed, /data-document-save-action>Retry<\/button>/);

  const recovered = render({ documentSaveStatus: 'Recovered draft', documentDraftRecoveryReason: 'recovered' });
  assert.match(recovered, /data-document-save-action>Save recovered draft<\/button>/);

  const conflict = render({
    documentSaveStatus: 'Recovered draft — saved copy changed',
    documentDraftRecoveryReason: 'conflict',
  });
  assert.match(conflict, /data-document-save-action>Review and save<\/button>/);
});

test('head renders the active draft title without mutating the saved document', () => {
  const html = render({ documentDraftTitle: 'Recovered title' });
  assert.match(html, /data-doc-title value="Recovered title"/);
});

// ---- escaping ------------------------------------------------------------------

test('escapes hostile doc titles and draft bodies', () => {
  const hostile = '</textarea><script>alert(1)</script>';
  const html = render({ documentDraftTitle: hostile, documentDraftBody: hostile }, { title: hostile });
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;/textarea&gt;&lt;script&gt;'));
});

test('escapes task titles in backlinks', () => {
  const backlinks = buildBacklinks(
    [{ id: 't1', title: '<script>steal()</script>', projectId: 'p1', priority: 'high', docIds: ['doc-1'] }],
    [{ id: 'p1', name: 'Homelab', color: '#4C8B78' }],
    'doc-1',
  );
  const html = render({ editorMode: 'preview' }, {}, { backlinks });
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;steal\(\)&lt;\/script&gt;/);
});

// ---- related documents -------------------------------------------------------

test('related documents render as clickable rows with a similarity percentage (preview modes)', () => {
  const related = [
    { id: 'doc-2', title: 'Backup drill', similarity: 0.82 },
    { id: 'doc-3', title: 'Failover', similarity: 0.55 },
  ];
  const html = render({ editorMode: 'split' }, {}, { related });
  assert.match(html, /class="doc-related"/);
  assert.match(html, /class="doc-related__label">Related documents</);
  assert.match(html, /data-action="open-doc" data-document-id="doc-2"[^>]*>[\s\S]*?Backup drill[\s\S]*?82%/);
  assert.match(html, /data-document-id="doc-3"[\s\S]*?55%/);
});

test('related documents section is hidden when empty, not fetched, or in edit-only mode', () => {
  assert.doesNotMatch(render({ editorMode: 'split' }, {}, { related: [] }), /doc-related/);
  assert.doesNotMatch(render({ editorMode: 'split' }, {}, { related: null }), /doc-related/);
  // edit-only mode shows no preview-side sections
  assert.doesNotMatch(render({ editorMode: 'edit' }, {}, { related: [{ id: 'x', title: 'X', similarity: 0.9 }] }), /doc-related/);
});

// ---- info form draft (root-review finding 5) -----------------------------------

const infoDraft = {
  documentId: baseDoc.id,
  baseline: { revision: 'a'.repeat(64), title: baseDoc.title, documentType: 'runbook', projectId: 'p1', tags: baseDoc.tags, sourceFilename: null },
  fields: { title: 'Typed title', documentType: 'note', projectId: 'p2', tags: 'typed, tags', sourceFilename: 'typed.md', refsText: 'https://x/pr/9 | PR' },
  pending: false,
  conflict: null,
};

test('info form renders the explicit draft (typed values) instead of the document after a rerender', () => {
  const html = render({ isDocumentInfoEditorOpen: true, documentInfoDraft: infoDraft, documentInfoError: 'Prax could not save document info.' });
  assert.match(html, /data-doc-info-title value="Typed title"/);
  assert.match(html, /value="note" selected/);
  assert.match(html, /value="p2" selected>Work/);
  assert.match(html, /data-doc-info-tags value="typed, tags"/);
  assert.match(html, /data-doc-info-source value="typed.md"/);
  assert.match(html, /data-doc-info-refs[^>]*>https:\/\/x\/pr\/9 \| PR</);
  assert.match(html, /role="alert">Prax could not save document info\./);
  assert.doesNotMatch(html, /data-doc-info-title value="Postgres restore"/);
});

test('info form disables Save while a save is pending', () => {
  const html = render({ isDocumentInfoEditorOpen: true, documentInfoDraft: { ...infoDraft, pending: true } });
  assert.match(html, /data-action="save-document-info"[^>]*disabled/);
  assert.match(html, /Saving…/);
});

test('info form shows a conflict review with both values and explicit keep-theirs / keep-mine actions', () => {
  const conflict = { remote: { ...baseDoc, title: 'Remote title', revision: 'b'.repeat(64) }, conflicts: ['title'] };
  const html = render({ isDocumentInfoEditorOpen: true, documentInfoDraft: { ...infoDraft, conflict } });
  assert.match(html, /data-doc-info-conflict/);
  assert.match(html, /Title[^<]*<[^>]*>[^<]*Remote title/);
  assert.match(html, /Typed title/);
  assert.match(html, /data-action="doc-info-keep-theirs"/);
  assert.match(html, /data-action="doc-info-keep-mine"/);
  // Typed values remain in the inputs — nothing was discarded.
  assert.match(html, /data-doc-info-title value="Typed title"/);
});
