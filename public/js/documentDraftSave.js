export function documentDraftSavedPatch({ documents = [], savedDocument }) {
  return {
    documents: documents.map(document => document.id === savedDocument.id ? savedDocument : document),
    selectedDocumentId: savedDocument.id,
    documentDraftId: savedDocument.id,
    documentDraftBody: savedDocument.body || '',
    isDocumentDirty: false,
    documentSaveStatus: 'Saved',
  };
}

export function canPreserveEditorAfterDraftSave({
  editorExists = false,
  savedDocumentId = null,
  selectedDocumentId = null,
  documentDraftId = null,
} = {}) {
  return Boolean(editorExists)
    && savedDocumentId === selectedDocumentId
    && savedDocumentId === documentDraftId;
}
