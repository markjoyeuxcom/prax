export const state = {
  tasks: [],
  documents: [],
  selectedTaskId: null,
  selectedDocumentId: null,
  activeView: 'list',
  activeContext: 'homelab',
  searchQuery: '',
  apiStatus: 'unknown',
  isTaskFormOpen: false,
  isAdminPanelOpen: false,
  isDocumentFormOpen: false,
  editingTaskId: null,
  editingDocumentId: null,
  formError: '',
  documentFormError: '',
  isSaving: false,
  adminImportMode: 'skip',
  documentPreviewMode: 'preview',
};

export function setState(patch) {
  Object.assign(state, patch);
}
