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
  libraryView: 'active',            // 'active' | 'archive' (Library workspace mode)
  libraryActiveDocumentCount: 0,    // cached count of active docs for the Admin panel
  taskDocuments: [],
  taskChecklist: [],
  taskActivity: [],
  activeTaskDetailTab: 'work',
  activeTaskDetailSection: 'docs',
  taskNotesDraftId: null,
  taskNotesDraft: '',
  isTaskNotesDirty: false,
  taskNotesSavedAt: '',
  isBoardTaskDetailOpen: false,
  isLinkPickerOpen: false,
  linkPickerDocuments: [],
  linkPickerQuery: '',
  preferences: { ...DEFAULT_PREFERENCES },
  boardOpenSections: { 'high-priority': true, 'in-progress': true, planned: false, completed: false, notes: false },
  boardGrouping: 'flat',        // 'flat' | 'swimlanes' (All-projects board only)
  boardLaneCollapsed: {},        // { [projectId]: true } collapsed lanes (session-only)
  boardFilters: [],              // active Board focus chips (session-only)
  taskBoardExtras: {},           // { [taskId]: { docsCount, checklistDone, checklistTotal, nextChecklistItem, latestActivity } }
  taskBoardExtrasLoading: {},    // { [taskId]: token } requests currently in flight
  listGrouping: 'flat',         // 'flat' | 'swimlanes' (All-projects Tasks view only)
  listLaneCollapsed: {},         // { [projectId]: true } collapsed list lanes (session-only)
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

const BOARD_GROUPING_KEY = 'moomora.boardGrouping.v1';

export function loadBoardGrouping(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(BOARD_GROUPING_KEY) === 'swimlanes' ? 'swimlanes' : 'flat';
  } catch {
    return 'flat';
  }
}

export function persistBoardGrouping(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(BOARD_GROUPING_KEY, value === 'swimlanes' ? 'swimlanes' : 'flat');
  } catch {
    /* ignore storage failures */
  }
}

const LIST_GROUPING_KEY = 'moomora.listGrouping.v1';

export function loadListGrouping(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(LIST_GROUPING_KEY) === 'swimlanes' ? 'swimlanes' : 'flat';
  } catch {
    return 'flat';
  }
}

export function persistListGrouping(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(LIST_GROUPING_KEY, value === 'swimlanes' ? 'swimlanes' : 'flat');
  } catch {
    /* ignore storage failures */
  }
}
