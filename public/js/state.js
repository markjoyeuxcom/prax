import { DEFAULT_PREFERENCES } from './preferences.js';

export const state = {
  tasks: [],
  documents: [],
  selectedTaskId: null,
  selectedDocumentId: null,
  activeView: 'list',
  activeProject: 'all',   // 'all' or a project id
  projects: [],           // active projects loaded from /api/projects
  searchQuery: '',
  apiStatus: 'unknown',
  isTaskFormOpen: false,
  isDrawerOpen: false,
  mobileDetailOpen: false,
  isAdminPanelOpen: false,
  isProjectManagerOpen: false,
  isProjectArchiveOpen: false,
  managedProjects: [],
  projectManagerError: '',
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
  isLibraryTagsDrawerOpen: false,
  isLibraryDocOpen: false,
  activeLibraryTags: [],
  libraryTagQuery: '',
  areLibraryTagsExpanded: false,
  librarySavedViews: [],
  libraryTypeFilter: 'all',
  librarySortBy: 'updated',
  libraryGroupByType: false,
  taskDocuments: [],
  isLinkPickerOpen: false,
  linkPickerDocuments: [],
  linkPickerQuery: '',
  preferences: { ...DEFAULT_PREFERENCES },
  boardOpenSections: { 'high-priority': true, 'in-progress': true, planned: false, completed: false, notes: false },
};

export function setState(patch) {
  Object.assign(state, patch);
}

const ACTIVE_PROJECT_KEY = 'moomora.activeProject.v1';

export function loadActiveProject(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(ACTIVE_PROJECT_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

export function persistActiveProject(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(ACTIVE_PROJECT_KEY, value);
  } catch {
    /* ignore storage failures */
  }
}
