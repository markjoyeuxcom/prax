export const state = {
  tasks: [],
  selectedTaskId: null,
  activeView: 'list',
  activeContext: 'homelab',
  searchQuery: '',
  apiStatus: 'unknown',
  isTaskFormOpen: false,
  isAdminPanelOpen: false,
  editingTaskId: null,
  formError: '',
  isSaving: false,
  adminImportMode: 'skip',
};

export function setState(patch) {
  Object.assign(state, patch);
}
