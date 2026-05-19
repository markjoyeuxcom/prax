import { DEFAULT_PREFERENCES } from './preferences.js';

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
  isSettingsPanelOpen: false,
  settingsSection: 'appearance',
  isDocumentFormOpen: false,
  isDocumentInfoEditorOpen: false,
  editingTaskId: null,
  editingDocumentId: null,
  formError: '',
  documentFormError: '',
  documentInfoError: '',
  isSaving: false,
  adminImportMode: 'skip',
  documentEditorMode: 'preview',
  documentDraftBody: '',
  documentDraftId: null,
  isDocumentDirty: false,
  documentSaveStatus: 'Saved',
  isDocumentFocusMode: false,
  activeLibraryTags: [],
  libraryTagQuery: '',
  areLibraryTagsExpanded: false,
  librarySavedViews: [],
  preferences: { ...DEFAULT_PREFERENCES },
};

export function setState(patch) {
  Object.assign(state, patch);
}
