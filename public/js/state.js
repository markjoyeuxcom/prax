export const state = {
  tasks: [],
  selectedTaskId: null,
  activeView: 'list',
  activeContext: 'homelab',
  searchQuery: '',
  apiStatus: 'unknown',
  isTaskFormOpen: false,
  editingTaskId: null,
  formError: '',
  isSaving: false,
};

export function setState(patch) {
  Object.assign(state, patch);
}
