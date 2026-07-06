import { DEFAULT_PREFERENCES } from './preferences.js';

// Prax app state — one mutable object; setState(patch) = Object.assign and the
// caller re-renders. Navigation is in-memory only (no URL routing, matching the
// previous app). View modules speak the design vocabulary (see statusMap.js).
export const state = {
  // ---- data ----
  tasks: [],                    // all active tasks across projects (Today/sidebar need the full set)
  archivedTasks: [],            // archived tasks of the current project (Archive tab fetch)
  documents: [],
  projects: [],                 // active + on-hold projects (sidebar set)
  managedProjects: [],          // all statuses (All-projects view)

  // ---- routing ----
  navType: 'project',           // 'today' | 'project' | 'all' | 'library' | 'editor' | 'settings'
  navId: null,                  // project id when navType === 'project'
  tab: 'list',                  // project tab: 'list' | 'board' | 'backlog' | 'archive'
  groupBy: 'due',               // list grouping cycler: 'due' | 'priority' | 'status'

  // ---- chrome / status ----
  apiStatus: 'unknown',         // 'unknown' | 'loading' | 'connected' | 'error'
  winW: 1400,                   // window width for the sidebar→rail switch (<940)

  // ---- tasks: selection + drawer ----
  selectedTaskId: null,         // keyboard/list selection (accent-soft tint)
  multiSelectIds: [],           // ⇧/⌘-click multi-select (accent-soft2 tint)
  drawerTaskId: null,           // open task drawer (null = closed)
  taskDocuments: [],
  taskChecklist: [],
  taskActivity: [],
  taskNotesDraftId: null,
  taskNotesDraft: '',
  isTaskNotesDirty: false,

  // ---- board ----
  dragTaskId: null,
  dragOverColumn: null,         // design column key under the pointer
  dragPos: null,                // { col, beforeId } drop-position indicator
  taskBoardExtras: {},          // { [taskId]: { docsCount, checklistDone, checklistTotal, nextChecklistItem, latestActivity } }
  taskBoardExtrasLoading: {},   // { [taskId]: token } requests in flight

  // ---- overlays ----
  paletteOpen: false,
  paletteQuery: '',
  paletteSelection: 0,
  captureOpen: false,
  captureQuery: '',
  toast: null,                  // { message, undo: fn|null }
  isLinkPickerOpen: false,
  pickerMode: 'link',           // 'link' (task↔doc) | 'supersede' (pick a replacement)
  linkPickerDocuments: [],
  linkPickerQuery: '',

  // ---- library ----
  selectedDocumentId: null,
  libraryQuery: '',
  librarySemantic: false,       // semantic mode toggle (spark)
  activeLibraryTags: [],
  librarySavedViews: [],
  librarySortBy: 'updated',     // 'updated' | 'title' cycler
  libraryView: 'active',        // 'active' | 'archive'
  semanticStatus: { available: false },
  semanticResults: null,        // null = no search ran; [] = ran, empty
  documentLinks: null,          // null = not yet fetched; [] = fetched, empty
  staleDocs: [],
  orphanDocs: [],
  maintenanceProjectFilter: 'all',

  // ---- editor ----
  editorDocId: null,
  editorMode: 'split',          // 'edit' | 'split' | 'preview'
  editorFocus: false,
  outlineOpen: true,
  documentDraftBody: '',
  documentDraftId: null,
  isDocumentDirty: false,
  documentSaveStatus: 'Saved',  // 'Saved' | 'Unsaved changes' | 'Saving...' | 'Autosaving...' | 'Save failed'
  isDocumentInfoEditorOpen: false,
  documentInfoError: '',

  // ---- settings ----
  preferences: { ...DEFAULT_PREFERENCES },
  adminImportMode: 'skip',
};

export function setState(patch) {
  Object.assign(state, patch);
}

const ACTIVE_PROJECT_KEY = 'moomora.activeProject.v1';

// Persisted as 'all' or a project id; navType/tab derive from it on boot.
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

// The old board/list swimlane-grouping persistence keys (moomora.boardGrouping.v1 /
// moomora.listGrouping.v1) were retired with the swimlane views themselves —
// the All-projects screen and Today view replace cross-project lanes.
