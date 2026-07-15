export function documentDraftSavedPatch({ documents = [], savedDocument, activeDocumentId = savedDocument?.id }) {
  const patch = {
    documents: documents.map(document => document.id === savedDocument.id ? savedDocument : document),
  };
  // A PATCH may finish after the user has navigated to another document. The
  // saved record still belongs in the documents cache, but it must never replace
  // the new editor's draft id/body or clear its dirty state.
  if (activeDocumentId !== savedDocument.id) return patch;
  return {
    ...patch,
    documentDraftId: savedDocument.id,
    documentDraftTitle: savedDocument.title || 'Untitled',
    documentDraftBody: savedDocument.body || '',
    isDocumentDirty: false,
    documentSaveStatus: 'Saved',
    documentDraftRecoveryReason: null,
    isDocumentDraftStored: true,
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
