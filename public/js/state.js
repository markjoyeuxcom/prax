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
  planMode: null,               // { mode:'plan'|'shutdown', queue, index, added, carried, dropped, rescheduled, done? }
  panelTab: 'projects',         // rail+panel shell: which browser tab ('projects' | 'views')
  panelFilter: '',              // type-to-filter text for the active panel tab
  pinned: { projects: [], smartViews: [], libraryViews: [] }, // starred favorites (localStorage)
  captureShortcut: null,        // { shortcut, default } from the server (desktop shell)
  captureShortcutNotice: null,  // last apply outcome shown in Settings
  taskRelatedDocs: null,        // { taskId, loading, suggestions, degraded, reason } — drawer Related knowledge
  navType: 'project',           // 'today' | 'project' | 'all' | 'library' | 'editor' | 'run' | 'filter' | 'calendar' | 'settings'
  navId: null,                  // project id when navType === 'project'
  calendarMonth: null,          // 'YYYY-MM' shown in the Calendar view; null = current month
  calendarSelectedDay: null,    // ISO day whose tasks show in the calendar detail strip (null = none)
  renamingProjectId: null,      // project whose header title is being inline-edited (null = none)
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
  taskNotesDraftId: null,          // shared task text-draft id (legacy name retained for render compatibility)
  taskDraftBaseline: null,         // {title,description,notes} the open drawer was seeded from; saves diff against this
  taskTitleDraft: '',
  taskDescriptionDraft: '',
  taskNotesDraft: '',
  isTaskNotesDirty: false,         // true when any task text-draft field differs
  taskDraftSaveStatus: 'Saved',
  taskDraftRecoveryReason: null,   // null | 'failed' | 'recovered' | 'conflict'
  isTaskDraftStored: true,
  taskLabelDraftId: null,          // render-stable transient label input owner
  taskLabelDraft: '',

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
  captureSubmitting: false,     // create POST/readback is in flight; capture cannot be dismissed
  captureError: null,           // truthful create/recovery status shown inside the dialog
  captureRecovered: false,      // unfinished capture restored from local recovery
  captureRequestPayload: null,  // exact client-ID payload retained for an unchanged safe retry
  captureRequestIntent: null,   // visible-intent key paired with captureRequestPayload
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
  libraryProjects: [],          // facet: owning project ids (OR within project axis)
  librarySavedViews: [],
  librarySortBy: 'updated',     // 'updated' | 'title' cycler
  libraryView: 'active',        // 'active' | 'archive'
  markdownImportOpen: false,
  markdownImportProjectId: null, // explicit destination selected inside the import dialog
  markdownImportFiles: [],       // retained [{ id, name, title, body }] after native input rerenders
  markdownImportPending: false,
  markdownImportError: '',
  markdownImportNotice: '',
  libraryExportOpen: false,
  libraryExportScope: 'all',       // 'all' or one owning project slug
  libraryExportFilename: '',       // render-stable suggestion shown before native/browser save
  libraryExportPending: false,
  libraryExportError: '',
  deploymentStatus: { loading: false, error: '' },
  semanticStatus: { available: false },
  chatStatus: { available: false },
  intelligenceSettingsPending: false,
  semanticSettingsDraft: null,
  chatSettingsDraft: null,
  semanticResults: null,        // null = no search ran; [] = ran, empty
  semanticPage: null,           // exact paged response metadata for the active query
  semanticIndex: null,          // current revision/model coverage from the active search
  semanticError: false,         // last semantic search failed (backend unreachable), not just empty
  semanticLoading: false,       // submitted semantic query is in flight
  semanticLoadingMore: false,   // an additional result page is in flight
  semanticMoreError: false,     // append failed; existing results remain usable
  documentLinks: null,          // null = not yet fetched; [] = fetched, empty
  documentExternalRefs: null,   // external URLs the doc points at; null = not yet fetched
  docInfoRefsSeed: null,        // refs snapshot the open Document-info form was seeded from
  staleDocs: [],
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
  healthData: null,             // null = not loaded; { needsReview, empty, stale, counts }
  healthLinkSuggestions: null,  // null = not loaded; [{ sourceId, sourceTitle, targetId, targetTitle, snippet }]
  healthLoading: false,
  healthAiReview: null,         // null = not run; the AI-review envelope { contradictions, gaps, ... }
  healthAiReviewLoading: false,
  healthAiReviewError: null,    // null | error message string

  // ---- Daily brief / on-call handoff ----
  dailyBriefOpen: false,
  dailyBriefNarrative: null,    // null = not drafted; string = the AI stand-up
  dailyBriefLoading: false,
  dailyBriefError: false,       // false | error message string

  // ---- AI assistant (agentic chat over the whole tool tree) ----
  assistantOpen: false,
  assistantStatus: null,        // null = not fetched; { available, model, backend, supportsTools, toolCount }
  assistantMessages: [],        // canonical conversation echoed to the server (user/assistant/tool turns)
  assistantLoading: false,      // a turn is in flight
  assistantPending: null,       // null, or [{ id, name, input, summary }] writes awaiting confirmation
  assistantError: null,         // null | error message string
  assistantErrorKind: null,     // null | 'error' | 'partial' (truthful committed-write outcome)

  // ---- NL capture & NL→filter (Tier-3 #8) ----
  nlCaptureLoading: false,
  nlCaptureFields: null,        // merged preview fields ({priority,dueDate,dueTime,recurrence,project,labels}) or null
  nlCaptureDropped: [],         // [{field,value}] the model hallucinated and we ignored (shown muted)
  nlCaptureRaw: null,           // the text as typed, before the cleaned title replaced it (Esc restores)
  nlCaptureError: null,
  nlFilterLoading: false,
  nlFilterSource: null,         // the English that produced activeFilterExpr (provenance hint + restore)
  nlFilterWarnings: [],         // semantic lint from the server audit
  nlFilterError: null,

  // ---- editor AI writing actions (Tier-3 #7) ----
  writeMenuOpen: false,         // the ✦ AI toolbar dropdown
  writeSelection: null,         // selection captured at menu-open ({from,to,text}) — renderApp clears the live one
  writeContext: null,           // null, or { action, label, verb, mode:'whole'|'selection'|'prepend', docId, selText, selStart, selEnd, model }
  writeResult: null,            // the generated text (null while loading / on error)
  writeLoading: false,
  writeError: null,             // null | error message string

  // ---- editor ----
  editorDocId: null,
  editorMode: 'split',          // 'edit' | 'split' | 'preview'
  editorFocus: false,
  outlineOpen: true,
  documentDraftTitle: '',
  documentDraftBody: '',
  documentDraftId: null,
  isDocumentDirty: false,
  documentSaveStatus: 'Saved',  // includes unsaved/autosaving/failure/recovery states
  documentDraftRecoveryReason: null, // null | 'failed' | 'recovered' | 'conflict'
  isDocumentDraftStored: true,  // false when origin-local recovery storage is unavailable
  isDocumentInfoEditorOpen: false,
  documentInfoError: '',
  docMenuOpen: false,           // editor ••• actions dropdown
  newDocMenuOpen: false,        // Library "＋ New doc" template chooser
  documentRuns: null,           // past runs of the open runbook (null = not fetched)

  // ---- runbook execution (run view) ----
  activeRun: null,              // run snapshot + current steps + append-only events
  runReturnDocId: null,         // runbook doc to return to via "← back" (also used to look up its title)
  runStartPending: false,       // exact-once start POST/readback is in flight
  runStartIntent: null,         // { id, documentId, title } retained across a safe retry
  runMutationPending: false,    // serialized step/status mutation or canonical readback is in flight
  postMortemLoading: false,     // true while a post-mortem is being generated for the active run

  // ---- editor find/replace (Prax-native panel; see renderSearchPanel.js) ----
  editorSearchOpen: false,
  searchQuery: '',
  searchReplace: '',
  searchCaseSensitive: false,
  searchWholeWord: false,
  searchRegexp: false,
  searchMatchInfo: { total: 0, current: 0, valid: true },

  // ---- integrations (Google Calendar one-way push) ----
  googleCalendarStatus: null,      // null until the Integrations tab loads it; then { configured, connected, ... , loading, loadError }
  googleCalendarDraft: { clientId: '', clientSecret: '' }, // render-stable OAuth client inputs (the API never echoes the secret back)
  googleCalendarPending: false,    // a save/connect/sync/disconnect is in flight (locks the card)
  googleCalendarNotice: null,      // string|null — sync results / degraded messages shown under the status line

  // ---- settings ----
  preferences: { ...DEFAULT_PREFERENCES },
  adminImportMode: 'skip',
  adminImportProjectId: null,       // explicit task-import destination; never inferred at submit time
  adminImportFileName: '',          // retained because renderApp replaces the native file input
  adminImportPayload: null,         // parsed + validated JSON selected by the user
  adminImportPending: false,        // consequential batch write lock
  adminImportError: '',             // actionable validation/transport/reconciliation status
  adminImportResult: null,          // last known committed { imported, skipped, replayed }
  adminImportRequest: null,         // { id, intent } retained for unchanged lost-response retry
  settingsTab: 'appearance',    // 'appearance' | 'intelligence' | 'integrations' | 'data'
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
