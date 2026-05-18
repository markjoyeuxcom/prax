import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocumentFormHtml, renderLibraryHtml } from '../../public/js/renderLibrary.js';

const documents = [
  {
    id: 'doc-1',
    title: 'Restore CloudNativePG',
    body: '# Restore CloudNativePG\n\nCheck backups.',
    documentType: 'runbook',
    context: 'homelab',
    tags: ['postgres', 'backup'],
    sourceFilename: 'restore.md',
    updatedAt: '2026-05-18T10:00:00.000Z',
    archivedAt: null,
  },
  {
    id: 'doc-2',
    title: 'Ideas',
    body: 'General notes',
    documentType: 'note',
    context: 'homelab',
    tags: [],
    sourceFilename: null,
    updatedAt: '2026-05-18T11:00:00.000Z',
    archivedAt: null,
  },
];

test('renderLibraryHtml renders document list and preview detail', () => {
  const html = renderLibraryHtml({
    documents,
    selectedDocumentId: 'doc-1',
    editorMode: 'preview',
    availableTags: [
      { tag: 'backup', count: 1 },
      { tag: 'postgres', count: 1 },
    ],
    activeTags: ['backup'],
    tagQuery: 'post',
    areTagsExpanded: false,
    savedViews: [
      { id: 'cloudflare-cloudflare', label: 'Cloudflare', tags: ['cloudflare'] },
      { id: 'postgres-backup-postgres', label: 'Postgres Backup', tags: ['backup', 'postgres'] },
    ],
    activeSavedViewId: 'postgres-backup-postgres',
  });

  assert.match(html, /Knowledge Library/);
  assert.match(html, /Smart views/);
  assert.match(html, /data-library-saved-view-id="postgres-backup-postgres"/);
  assert.match(html, /aria-pressed="true">[\s\S]*Postgres Backup/);
  assert.match(html, /data-action="delete-library-saved-view"/);
  assert.match(html, /data-action="rename-library-saved-view"/);
  assert.match(html, /data-library-saved-view-name/);
  assert.match(html, /data-action="save-library-view"/);
  assert.match(html, /class="library-active-filters"/);
  assert.match(html, /Active filters/);
  assert.match(html, /Postgres Backup/);
  assert.match(html, /data-library-active-filter="backup"/);
  assert.match(html, /2 documents shown/);
  assert.match(html, /class="library-workspace"/);
  assert.match(html, /class="library-browser"/);
  assert.match(html, /class="library-document-stage"/);
  assert.match(html, /2 documents/);
  assert.match(html, /data-action="clear-library-tags"/);
  assert.match(html, /data-library-tag-search/);
  assert.match(html, /value="post"/);
  assert.match(html, /data-library-tag="backup"/);
  assert.match(html, /aria-pressed="true">backup <span>1<\/span>/);
  assert.match(html, /data-library-tag="postgres"/);
  assert.match(html, /data-library-document-id="doc-1"/);
  assert.match(html, /Restore CloudNativePG/);
  assert.match(html, /Runbook/);
  assert.match(html, /postgres/);
  assert.match(html, /data-action="archive-document"/);
  assert.match(html, /data-action="edit-document-info"/);
  assert.match(html, /data-library-mode="edit"/);
  assert.match(html, /data-library-mode="preview"/);
  assert.match(html, /data-library-mode="split"/);
  assert.doesNotMatch(html, /data-action="edit-document"/);
  assert.match(html, /<h1>Restore CloudNativePG<\/h1>/);
});

test('renderLibraryHtml renders inline document metadata editor', () => {
  const html = renderLibraryHtml({
    documents,
    selectedDocumentId: 'doc-1',
    isInfoEditing: true,
    infoError: 'Title is required.',
    isSaving: true,
  });

  assert.match(html, /data-document-info-form/);
  assert.match(html, /Title is required\./);
  assert.match(html, /name="title"/);
  assert.match(html, /value="Restore CloudNativePG"/);
  assert.match(html, /name="documentType"/);
  assert.match(html, /value="runbook" selected/);
  assert.match(html, /name="tags"/);
  assert.match(html, /value="postgres, backup"/);
  assert.match(html, /name="sourceFilename"/);
  assert.match(html, /value="restore.md"/);
  assert.match(html, /data-action="cancel-document-info"/);
  assert.match(html, /Saving\.\.\./);
  assert.doesNotMatch(html, /data-document-editor/);
});

test('renderLibraryHtml renders show-more control for collapsed long tag lists', () => {
  const html = renderLibraryHtml({
    documents,
    availableTags: Array.from({ length: 14 }, (_, index) => ({
      tag: `tag-${String(index + 1).padStart(2, '0')}`,
      count: 1,
    })),
    activeTags: [],
    areTagsExpanded: false,
  });

  assert.match(html, /data-action="toggle-library-tags"/);
  assert.match(html, /Show 2 more/);
  assert.doesNotMatch(html, /data-library-tag="tag-14"/);
});

test('renderLibraryHtml renders edit mode with editor and save controls', () => {
  const html = renderLibraryHtml({
    documents,
    selectedDocumentId: 'doc-1',
    editorMode: 'edit',
    draftBody: '# Draft body',
    isDirty: true,
    saveStatus: 'Autosaving...',
  });

  assert.match(html, /document-editor/);
  assert.match(html, /data-document-editor/);
  assert.match(html, /# Draft body/);
  assert.match(html, /data-action="save-document-draft"/);
  assert.match(html, /Autosaving\.\.\./);
  assert.match(html, /data-markdown-action="bold"/);
  assert.match(html, /data-markdown-action="bullet-list"/);
  assert.match(html, /data-markdown-action="checklist"/);
  assert.match(html, /data-action="toggle-document-focus"/);
  assert.match(html, /aria-label="Focus writing mode"/);
  assert.doesNotMatch(html, /markdown-preview/);
});

test('renderLibraryHtml can render focused writing mode', () => {
  const html = renderLibraryHtml({
    documents,
    selectedDocumentId: 'doc-1',
    editorMode: 'edit',
    isFocusMode: true,
  });

  assert.match(html, /library-workspace is-focus-mode/);
  assert.match(html, /library-detail is-focus-mode/);
  assert.match(html, /document-workspace document-workspace--edit document-workspace--focused/);
  assert.match(html, /aria-pressed="true">Focus/);
});

test('renderLibraryHtml renders split mode with editor and escaped preview', () => {
  const html = renderLibraryHtml({
    documents: [{
      ...documents[0],
      body: '# <script>alert("x")</script>',
    }],
    selectedDocumentId: 'doc-1',
    editorMode: 'split',
  });

  assert.match(html, /document-editor/);
  assert.match(html, /markdown-preview/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('renderLibraryHtml renders archived document restore and delete actions', () => {
  const html = renderLibraryHtml({
    documents: [{ ...documents[0], archivedAt: '2026-05-18T12:00:00.000Z' }],
    selectedDocumentId: 'doc-1',
  });

  assert.match(html, /data-action="restore-document"/);
  assert.match(html, /data-action="delete-archived-document"/);
  assert.doesNotMatch(html, /data-action="archive-document"/);
});

test('renderLibraryHtml renders empty state', () => {
  const html = renderLibraryHtml({ documents: [] });

  assert.match(html, /No Markdown documents/);
  assert.match(html, /Create or import Markdown/);
});

test('renderDocumentFormHtml renders create and edit fields', () => {
  const html = renderDocumentFormHtml({
    activeContext: 'homelab',
    document: documents[0],
    error: 'Title is required.',
  });

  assert.match(html, /Edit Document/);
  assert.match(html, /Title is required/);
  assert.match(html, /name="title"/);
  assert.match(html, /name="body"/);
  assert.match(html, /name="documentType"/);
  assert.match(html, /value="runbook" selected/);
  assert.match(html, /name="tags"/);
  assert.match(html, /postgres, backup/);
});
