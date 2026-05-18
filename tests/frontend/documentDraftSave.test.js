import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canPreserveEditorAfterDraftSave,
  documentDraftSavedPatch,
} from '../../public/js/documentDraftSave.js';

test('documentDraftSavedPatch updates the saved document and clears draft dirty state', () => {
  const savedDocument = { id: 'doc-1', title: 'Runbook', body: '# Saved' };

  assert.deepEqual(documentDraftSavedPatch({
    documents: [
      { id: 'doc-1', title: 'Runbook', body: '# Draft' },
      { id: 'doc-2', title: 'Notes', body: 'Notes' },
    ],
    savedDocument,
  }), {
    documents: [
      { id: 'doc-1', title: 'Runbook', body: '# Saved' },
      { id: 'doc-2', title: 'Notes', body: 'Notes' },
    ],
    selectedDocumentId: 'doc-1',
    documentDraftId: 'doc-1',
    documentDraftBody: '# Saved',
    isDocumentDirty: false,
    documentSaveStatus: 'Saved',
  });
});

test('canPreserveEditorAfterDraftSave keeps the live editor when the same document is still selected', () => {
  assert.equal(canPreserveEditorAfterDraftSave({
    editorExists: true,
    savedDocumentId: 'doc-1',
    selectedDocumentId: 'doc-1',
    documentDraftId: 'doc-1',
  }), true);
});

test('canPreserveEditorAfterDraftSave rejects stale saves after navigation', () => {
  assert.equal(canPreserveEditorAfterDraftSave({
    editorExists: true,
    savedDocumentId: 'doc-1',
    selectedDocumentId: 'doc-2',
    documentDraftId: 'doc-1',
  }), false);
});
