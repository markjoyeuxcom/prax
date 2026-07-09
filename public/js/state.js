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
  navType: 'project',           // 'today' | 'project' | 'all' | 'library' | 'editor' | 'run' | 'filter' | 'upcoming' | 'settings'
  navId: null,                  // project id when navType === 'project'
  tab: 'list',                  // project tab: 'list' | 'board' | 'backlog' | 'archive'
  groupBy: 'due',               // list grouping cycler: 'due' | 'priority' | 'status'

  // ---- task filter + smart views ----
  taskSmartViews: [],           // saved named filter expressions (localStorage)
  activeFilterExpr: '',         // the current filter view's expression
  activeSmartViewId: null,      // id of the saved view being shown (null = ad-hoc filter)

  // ---- chrome / status ----
  desktopShell: false,          // true when served inside the Tauri shell (?shell=desktop)
  desktopPlatform: '',          // 'macos' | 'windows' | 'linux' when desktopShell
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
  captureProjectId: null,       // destination for the new task (context-derived, user-overridable)
  captureDueDate: null,         // pre-set due date (today when capturing from the Today view)
  captureStatus: 'planned',     // pre-set status (backlog when capturing from a Backlog tab)
  captureMenuOpen: false,       // capture project-picker dropdown
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
  libraryTypes: [],             // facet: active doc types ('runbook'/'note')
  libraryTrust: [],             // facet: active trust flags ('verified'/'stale'/'superseded')
  librarySavedViews: [],
  librarySortBy: 'updated',     // 'updated' | 'title' cycler
  libraryView: 'active',        // 'active' | 'archive'
  semanticStatus: { available: false },
  chatStatus: { available: false },
  semanticResults: null,        // null = no search ran; [] = ran, empty
  semanticError: false,         // last semantic search failed (backend unreachable), not just empty
  documentLinks: null,          // null = not yet fetched; [] = fetched, empty
  staleDocs: [],
  orphanDocs: [],
  maintenanceProjectFilter: 'all',

  // ---- "Ask Prax" (grounded, cited answer over the library) ----
  askPraxOpen: false,
  askPraxQuery: '',
  askPraxResult: null,          // null = not run; { answer, degraded, reason, markdown, sources, model }
  askPraxLoading: false,
  askPraxError: false,

  // ---- "Generate runbook" (draft a runbook from an incident description) ----
  genRbOpen: false,
  genRbDescription: '',         // preserved across the loading re-render
  genRbProject: null,           // selected project id (the select's default)
  genRbLoading: false,
  genRbError: false,            // false | error message string

  // ---- Library health view ----
  healthData: null,             // null = not loaded; { needsReview, empty, stale, orphans, counts }
  healthLoading: false,

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
  docMenuOpen: false,           // editor ••• actions dropdown
  newDocMenuOpen: false,        // Library "＋ New doc" template chooser
  documentRuns: null,           // past runs of the open runbook (null = not fetched)

  // ---- runbook execution (run view) ----
  activeRun: null,              // the run being viewed: { id, documentId, title, status, startedAt, finishedAt, steps: [...] }
  runReturnDocId: null,         // runbook doc to return to via "← back" (also used to look up its title)
  postMortemLoading: false,     // true while a post-mortem is being generated for the active run

  // ---- editor find/replace (Prax-native panel; see renderSearchPanel.js) ----
  editorSearchOpen: false,
  searchQuery: '',
  searchReplace: '',
  searchCaseSensitive: false,
  searchWholeWord: false,
  searchRegexp: false,
  searchMatchInfo: { total: 0, current: 0, valid: true },

  // ---- settings ----
  preferences: { ...DEFAULT_PREFERENCES },
  adminImportMode: 'skip',
  settingsTab: 'appearance',    // 'appearance' | 'intelligence' | 'data'
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
