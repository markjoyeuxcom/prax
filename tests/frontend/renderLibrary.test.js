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
    previewMode: 'preview',
  });

  assert.match(html, /Knowledge Library/);
  assert.match(html, /2 documents/);
  assert.match(html, /data-library-document-id="doc-1"/);
  assert.match(html, /Restore CloudNativePG/);
  assert.match(html, /Runbook/);
  assert.match(html, /postgres/);
  assert.match(html, /data-action="edit-document"/);
  assert.match(html, /data-action="archive-document"/);
  assert.match(html, /data-action="toggle-document-raw"/);
  assert.match(html, /<h1>Restore CloudNativePG<\/h1>/);
});

test('renderLibraryHtml renders raw source mode and escapes Markdown', () => {
  const html = renderLibraryHtml({
    documents: [{
      ...documents[0],
      body: '# <script>alert("x")</script>',
    }],
    selectedDocumentId: 'doc-1',
    previewMode: 'raw',
  });

  assert.match(html, /document-raw/);
  assert.match(html, /# &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
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
