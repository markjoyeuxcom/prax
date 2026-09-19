import { importRequestFor, completeImportRequest } from './importRecovery.js';
import { reconcileTaskArchive } from './taskArchiveOutcome.js';
import { documentDraftPatch, mergeDocumentDraft } from './documentDraftMerge.js';
import { openDocumentInfoDraft, normalizeInfoFields, documentInfoPatch, mergeDocumentInfo, documentInfoCommitted, rebaseDocumentInfoDraft } from './documentInfoDraft.js';
import { loadAssistantRecovery, saveAssistantRecovery } from './assistantRecovery.js';
import { createProjectDrafts } from './projectDrafts.js';
// Prax — application orchestrator.
// Render modules are pure state → HTML string functions; this file owns data
// loading, event delegation (single delegated click/input/change listeners
// reading data-action attributes), API translation via statusMap, and the
// post-render lifecycle (CodeMirror mount, drag indicator, autosave timers).

import { state, setState, loadActiveProject, persistActiveProject } from './state.js';
import {
  applyPreferences, loadPreferences, savePreferences, resetPreferences,
  SLIPPAGE_DEFERRAL_OPTIONS, SLIPPAGE_AGE_OPTIONS, WIP_LIMIT_OPTIONS,
} from './preferences.js';
import {
  fetchTasks, fetchTask, createTask, updateTask, reorderTasks, archiveTask, restoreTask,
  deleteArchivedTask, exportTasks, importTasks, fetchTaskDocuments, fetchRelatedDocuments,
  linkTaskDocument, unlinkTaskDocument, fetchTaskChecklist, addChecklistItem,
  setChecklistItem, deleteChecklistItem, fetchTaskActivity, fetchTaskBoardExtras,
  parseNlCapture, parseNlFilter,
} from './taskApi.js';
import {
  fetchProjects, createProject, updateProject, deleteProjectPermanent,
} from './projectApi.js';
import {
  fetchDocuments, fetchDocument, createDocument, updateDocument, archiveDocument,
  restoreDocument, deleteDocumentPermanently, fetchDocumentLinks, fetchDocumentTaskBacklinks, fetchSimilarDocuments,
  unlinkDocuments,
  fetchExternalRefs, addExternalRef, removeExternalRef,
  fetchStaleDocuments, fetchDeploymentStatus, fetchSemanticStatus,
  setSemanticEnabled, putSemanticSettings, reindexEmbeddings, semanticSearch,
  fetchChatStatus, putChatSettings,
  fetchGoogleCalendarStatus, putGoogleCalendarSettings, connectGoogleCalendar,
  syncGoogleCalendar, disconnectGoogleCalendar,
  verifyDocument, supersedeDocument,
  startRun, fetchRuns, fetchRun, setRunStep, setRunStatus, createPostMortem,
  askPrax, generateRunbook, fetchHealth, narrateBrief,
  assistantChat, fetchAssistantStatus,
  fetchLinkSuggestions, applyWikiLink, runAiReview, runWritingAction,
  generateWeeklyReview, fetchCaptureShortcut, saveCaptureShortcut,
} from './libraryApi.js';
import { normalizeTask } from './taskModel.js';
import { apiStatus, designStatus, isOpen } from './statusMap.js';
import { moveTaskOnBoard } from './boardWorkflow.js';
import { pendingExtraIds, batchIds, clearTaskBoardExtra } from './boardExtras.js';
import { installKeyboardShortcuts } from './keyboardShortcuts.js';
import { settingsPatchMatchesStatus } from './settingsOutcome.js';
import { applyMarkdownFormat } from './markdownEditor.js';
import { renderMarkdownHtml, titleFromMarkdown } from './markdownPreview.js';
import { updateDocumentLivePreview } from './documentLivePreview.js';
import {
  canPreserveEditorAfterDraftSave, documentDraftSavedPatch,
} from './documentDraftSave.js';
import {
  clearDocumentDraftRecovery, documentDraftIsDirty, loadDocumentDraftRecovery,
  normalizeDocumentDraftTitle, resolveDocumentDraftRecovery, storeDocumentDraftRecovery,
} from './documentDraftRecovery.js';
import {
  clearTaskDraftRecovery, loadTaskDraftRecovery, normalizeTaskDraftTitle,
  resolveTaskDraftRecovery, storeTaskDraftRecovery, taskDraftIsDirty,
} from './taskDraftRecovery.js';
import { createTaskMutationQueue } from './taskMutationQueue.js';
import { taskMatchesPatch } from './taskPatchOutcome.js';
import { taskMatchesCreatePayload } from './taskCreateOutcome.js';
import { documentMatchesLifecycle, lifecycleOutcomeMessage } from './documentLifecycleOutcome.js';
import {
  runMatchesStartIntent, runMatchesStatusIntent, runMatchesStepIntent,
} from './runOutcome.js';
import {
  captureIntentKey, clearTaskCaptureRecovery, loadTaskCaptureRecovery,
  storeTaskCaptureRecovery,
} from './taskCaptureRecovery.js';
import {
  libraryArchiveFilename, libraryExportDestinationMode, libraryExportFailureMessage, saveLibraryArchive,
  triggerLibraryDocumentDownload,
} from './libraryExport.js';
import { tasksFromImportPayload, exportFilename, normalizeImportMode } from './importExport.js';
import { createSavedLibraryView, savedLibraryViewsFromJson } from './librarySavedViews.js';
import { parseCaptureShorthand, mergeNlCapture } from './captureShorthand.js';
import { computeDueReminders, isOverdue } from './dueReminders.js';
import { dueBucket } from './dueFlags.js';
import { normalizeLabel } from './labels.js';
import { parseExternalRefLines } from './externalRefKind.js';
import { mountCodeMirrorEditor } from '../vendor/codemirror-editor.js';

import {
  renderTitlebarHtml, renderPanelHtml, renderRailHtml, renderStatusbarHtml,
  projectColor,
} from './renderShell.js';
import {
  TASK_RENDER_BATCH_SIZE, renderListHtml, renderBulkBarHtml, buildListGroups, limitTaskGroups,
  applyCollapsedGroups,
} from './renderList.js';
import { renderTodayHtml, buildTodayGroups, TODAY_WEEK_SECTION } from './renderToday.js';
import { renderPlanModeHtml } from './renderPlanMode.js';
import {
  createExternalRefresh, installExternalRefreshTriggers, collectionFingerprint,
  installWriteEpoch, writeEpoch, captureFocus, restoreFocus,
} from './externalRefresh.js';
import { renderCalendarHtml, buildCalendarModel, monthKeyOf, shiftMonthKey } from './renderCalendar.js';
import { renderFilterHtml, buildFilterGroups } from './renderFilter.js';
import { parseTaskFilter, projectResolver } from './taskFilter.js';
import { createSmartView, findSmartView, smartViewsFromJson } from './taskSmartViews.js';
import { loadPinned, savePinned, togglePinned } from './pinned.js';
import { isCollapsed, loadCollapsed, saveCollapsed, toggleCollapsed } from './collapsed.js';
import { loadRecent, saveRecent, pushRecent } from './recentProjects.js';
import { renderBoardHtml, buildBoardColumns, limitBoardColumns } from './renderBoard.js';
import { renderBacklogHtml, renderArchiveHtml } from './renderBacklog.js';
import { renderTaskDrawerHtml, renderMissingTaskDrawerHtml } from './renderTaskDetail.js';
import { renderLinkPickerHtml } from './renderLinkPicker.js';
import { LIBRARY_RENDER_BATCH_SIZE, renderLibraryHtml, buildLibraryModel } from './renderLibrary.js';
import { templateById } from './documentTemplates.js';
import { renderEditorHtml, buildOutline, buildBacklinks, WRITE_ACTIONS } from './renderEditor.js';
import { renderRunHtml, buildChronicle } from './renderRun.js';
import { renderAskPraxHtml } from './renderAskPrax.js';
import { renderGenerateRunbookHtml } from './renderGenerateRunbook.js';
import { renderHealthHtml } from './renderHealth.js';
import { renderDailyBriefHtml } from './renderDailyBrief.js';
import { buildDailyBrief } from './brief.js';
import { renderAssistantHtml } from './renderAssistant.js';
import { assistantOutcomeNotice } from './assistantOutcome.js';
import { renderWritingPreviewHtml } from './renderWritingPreview.js';
import { renderSearchPanelHtml, searchCountLabel } from './renderSearchPanel.js';
import { renderAllProjectsHtml, buildProjectGroups } from './renderAllProjects.js';
import { renderPaletteHtml, buildPaletteGroups, cyclePaletteScope, normalizePaletteScope } from './renderPalette.js';
import { renderCaptureHtml } from './renderCapture.js';
import { renderToastHtml } from './renderToast.js';
import { renderConfirmHtml } from './renderConfirm.js';
import { renderShortcutsHtml } from './renderShortcuts.js';
import { renderMarkdownImportHtml } from './renderMarkdownImport.js';
import { renderLibraryExportHtml } from './renderLibraryExport.js';
import { renderSettingsHtml } from './renderSettings.js';
import { escapeHtml } from './renderHelpers.js';
import { renderOpsToggleHtml, renderProjectOpsHtml, opsSectionKey, revealKey, opsFieldAttr } from './renderProjectOps.js';
import { icon } from './icons.js';

const SAVED_LIBRARY_VIEWS_KEY = 'moomora.librarySavedViews.v1';
const SMART_VIEWS_KEY = 'moomora.taskSmartViews.v1';
const DOCUMENT_AUTOSAVE_DELAY_MS = 1200;
const TASK_DRAFT_AUTOSAVE_DELAY_MS = 1000;

// ---- module runtime (not state: timers, controllers, transient DOM) --------
let appRoot = null;
let flatIds = [];                 // keyboard-navigation order of the visible list
let paletteFlat = [];             // flattened palette items for Enter/arrows
let documentEditorController = null;
let pendingEditorSelection = null; // {from,to} to restore after a renderApp re-mount (see renderApp)
let documentAutosaveTimer = null;
let documentSavePromise = null;     // coalesces navigation flushes with an in-flight autosave
let taskDraftSaveTimer = null;
let taskDraftSavePromise = null;  // coalesces close/switch with a drawer autosave
let toastTimer = null;
let isReindexing = false;         // guards the reindex/rebuild handler from double-runs
let prevViewKey = null;           // suppress the main-content fade on same-view re-renders
const projectOpsTimers = new Map();
let projectRecoveryAnnounced = false;
const projectDrafts = createProjectDrafts({
  storage: taskDraftStorage(), save: updateProject,
  read: async id => (await fetchProjects()).find(project => project.id === id),
  onSaved: (id, patch) => applyProjectPatchLocal(id, patch),
  onError: message => showToast(message, () => projectDrafts.flushAll(), 10000, 'Retry'),
});
let boardExtrasRenderTimer = null; // enrichment must not preempt primary task interaction
let dragIndicator = null;
let documentsLoadToken = 0;       // only the newest Active/Archive collection may install
let tasksLoadToken = 0;           // only the newest task collection request may install
let semanticSearchToken = 0;      // stale/superseded meaning searches never install
let askPraxToken = 0;             // stale/closed grounded-answer requests never install
let drawerContextToken = 0;       // a late task-context load cannot replace a newer drawer
let gcalPollToken = 0;            // stale Google-connect polls (left Settings / newer op) never install
let restoreMarkdownImportFocus = false;
let restoreLibraryExportFocus = false;
let libraryExportReturnAction = 'export-library';
let captureReturnElement = null;
let taskCollectionWindow = { key: '', limit: TASK_RENDER_BATCH_SIZE };
let libraryCollectionWindow = { key: '', limit: LIBRARY_RENDER_BATCH_SIZE };
const enqueueTaskMutation = createTaskMutationQueue();
const enqueueRunMutation = createTaskMutationQueue();
let pendingRunMutationCount = 0;

function taskCollectionLimit(key) {
  if (taskCollectionWindow.key !== key) {
    taskCollectionWindow = { key, limit: TASK_RENDER_BATCH_SIZE };
  }
  return taskCollectionWindow.limit;
}

function libraryCollectionLimit(key) {
  if (libraryCollectionWindow.key !== key) {
    libraryCollectionWindow = { key, limit: LIBRARY_RENDER_BATCH_SIZE };
  }
  return libraryCollectionWindow.limit;
}

// Native window.alert/confirm/prompt do not exist in the desktop webview
// (Tauri implements no JS dialogs — confirm() returns falsy, alert() is a
// no-op). All user feedback goes through the toast; confirmations go through
// the in-app confirm dialog (openConfirm → renderConfirmHtml).
function alertError(message) {
  showToast(`Prax could not ${message}.`);
}

function openConfirm(confirm) {
  // Close any open menu first. A confirm launched from a menu item (e.g. the
  // doc menu's "Delete permanently…") otherwise leaves the menu open, and the
  // "click outside a menu closes it" handler swallows the first click on the
  // confirm's buttons — forcing a second click. The confirm is a modal, so the
  // menu should be gone anyway.
  setState({ confirm, docMenuOpen: false, newDocMenuOpen: false, libraryMenuOpen: false, captureMenuOpen: false });
  renderApp();
}

function newProjectDialog() {
  return {
    message: 'Name this project',
    okLabel: 'Create project',
    action: 'create-project',
    input: { placeholder: 'Project name' },
  };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadProjects() {
  const all = projectDrafts.overlay(await fetchProjects('all'));
  if (projectDrafts.hasPending() && !projectRecoveryAnnounced) {
    projectRecoveryAnnounced = true;
    showToast('Recovered unsaved project changes. Review the fields and retry saving when ready.', () => projectDrafts.flushAll(), 10000, 'Retry');
  }
  const sidebar = all.filter(p => p.status === 'active' || p.status === 'on-hold');
  setState({ projects: sidebar, managedProjects: all });
}

// Returns true when the collection was installed, 'superseded' when a newer
// request started meanwhile (its result wins), or 'stale' when `guardWrites`
// is set and a local write started or settled while this snapshot was in
// flight — an older snapshot must never overwrite a newer accepted save.
async function loadTasks({ announceReminders = true, guardWrites = false } = {}) {
  const token = (tasksLoadToken += 1);
  const epoch = writeEpoch();
  const tasks = await fetchTasks({});
  if (token !== tasksLoadToken) return 'superseded';
  if (guardWrites && writeEpoch() !== epoch) return 'stale';
  setState({ tasks: tasks.map(normalizeTask), apiStatus: 'connected' });
  reconcileTaskDrawerAfterRefresh();
  if (announceReminders) checkDueReminders();
  return true;
}

// After a refresh installs newer server state, fold it into the open drawer's
// UNTOUCHED fields (draft still equals the seeded baseline): the user sees an
// out-of-band edit live, and the next save cannot resend the stale value.
// Touched fields keep both draft and baseline, so the existing conflict
// detection still notices a same-field divergence on save failure.
function reconcileTaskDrawerAfterRefresh() {
  const taskId = state.drawerTaskId;
  if (!taskId || state.taskNotesDraftId !== taskId || !state.taskDraftBaseline) return;
  const server = taskById(taskId);
  if (!server || server.archivedAt) return;
  const baseline = state.taskDraftBaseline;
  const draft = taskDraftSnapshot();
  const draftKeys = { title: 'taskTitleDraft', description: 'taskDescriptionDraft', notes: 'taskNotesDraft' };
  const nextBaseline = { ...baseline };
  const patch = {};
  for (const [field, draftKey] of Object.entries(draftKeys)) {
    const untouched = draft[field] === baseline[field];
    if (untouched && (server[field] ?? '') !== baseline[field]) {
      patch[draftKey] = server[field] ?? '';
      nextBaseline[field] = server[field] ?? '';
    }
  }
  if (Object.keys(patch).length) setState({ ...patch, taskDraftBaseline: nextBaseline });
}

// Due-date reminders: announce tasks that are due/overdue. A native desktop
// notification when the user has granted permission, otherwise a single in-app
// toast per batch. Deduped by task id for the session so a task is announced
// once. Runs after every task load and on a heartbeat (for an app left open
// across midnight). See dueReminders.js for the pure selection.
const notifiedDueIds = new Set();

function fireNativeReminder(task) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const title = isOverdue(task.dueDate) ? 'Task overdue' : 'Task due today';
    // eslint-disable-next-line no-new
    new Notification(title, { body: task.title, tag: `prax-due-${task.id}` });
    return true;
  } catch { return false; }
}

// Evening shutdown nudge (preference, default off): one gentle toast per day
// once the hour passes and planned items are still open. Delivery only — the
// decision walk lives behind the Today view's Shut down button.
const SHUTDOWN_NUDGE_KEY = 'prax.shutdownNudge.lastShown';
function checkShutdownNudge(now = new Date()) {
  if (!state.preferences?.shutdownNudge) return;
  if (now.getHours() < 17) return;
  const today = todayISODate(now);
  try {
    if (localStorage.getItem(SHUTDOWN_NUDGE_KEY) === today) return;
  } catch { return; }
  const openPlanned = (state.tasks || []).filter((task) => planEligible(task, now) && task.plannedFor === today).length;
  if (!openPlanned) return;
  try { localStorage.setItem(SHUTDOWN_NUDGE_KEY, today); } catch { /* no storage, no stamp */ }
  showToast(`${openPlanned} planned task${openPlanned === 1 ? '' : 's'} still open — shut down today from the Today view.`, null, 8000);
}

// Weekly-review nudge (preference, default off): Sunday evening, once, only
// while this week's review doc does not exist yet.
const WEEKLY_NUDGE_KEY = 'prax.weeklyReviewNudge.lastShown';
function checkWeeklyReviewNudge(now = new Date()) {
  if (!state.preferences?.weeklyReviewNudge) return;
  if (now.getDay() !== 0 || now.getHours() < 17) return; // Sunday evenings
  const today = todayISODate(now);
  try {
    if (localStorage.getItem(WEEKLY_NUDGE_KEY) === today) return;
  } catch { return; }
  const hasReview = (state.documents || []).some((doc) => /^Weekly review — \d{4}-W\d{2}$/.test(doc.title || '') && !doc.archivedAt
    && new Date(doc.updatedAt || 0).getTime() > now.getTime() - 6 * 86_400_000);
  if (hasReview) return;
  try { localStorage.setItem(WEEKLY_NUDGE_KEY, today); } catch { /* no storage, no stamp */ }
  showToast('No weekly review yet — one click in the Library compiles it.', null, 8000);
}

function checkDueReminders() {
  if (!state.preferences?.reminders) return false;
  const fresh = computeDueReminders(state.tasks, { now: new Date() }).filter((t) => !notifiedDueIds.has(t.id));
  if (!fresh.length) return false;
  fresh.forEach((t) => notifiedDueIds.add(t.id));

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    fresh.forEach(fireNativeReminder);
    return false;
  }
  const overdue = fresh.filter((t) => isOverdue(t.dueDate)).length;
  const n = fresh.length;
  const word = overdue === n ? 'overdue' : 'due';
  showToast(`⏰ ${n} task${n > 1 ? 's' : ''} ${word}`, null, 6000);
  return true;
}

async function loadArchivedTasks() {
  if (state.navType !== 'project' || !state.navId) {
    setState({ archivedTasks: [] });
    return;
  }
  const tasks = await fetchTasks({ project: state.navId, archived: true });
  setState({ archivedTasks: tasks.map(normalizeTask) });
}

async function loadDocuments() {
  const token = (documentsLoadToken += 1);
  const archive = state.libraryView === 'archive';
  const documents = await fetchDocuments(archive ? { archived: true } : {});
  if (token !== documentsLoadToken || archive !== (state.libraryView === 'archive')) return false;
  setState({ documents });
  return true;
}

// Refresh after writes made OUTSIDE this window — the capture bar (its own
// webview), the memory skills, the CLI, MCP, another tab. Tasks always; the
// Library only when no document is open in the editor, whose own draft/merge
// logic owns that case. Re-render only when something actually changed.
async function refreshFromOutside() {
  const before = `${collectionFingerprint(state.tasks)}#${collectionFingerprint(state.documents)}`;
  const applied = await loadTasks({ announceReminders: false, guardWrites: true });
  if (!state.editorDocId) await loadDocuments().catch(() => false);
  // A snapshot that spanned a local write was discarded; ask for a fresh one
  // once the write has settled (the refresher runs it after its interval).
  if (applied === 'stale') externalRefresh.trigger('stale');
  const after = `${collectionFingerprint(state.tasks)}#${collectionFingerprint(state.documents)}`;
  const changed = after !== before;
  // A document open in the editor owns its surface: rebuilding the DOM would
  // re-mount CodeMirror under the caret. The state is installed; the next
  // navigation renders it.
  if (changed && state.navType !== 'editor') {
    const focus = captureFocus();
    renderApp();
    restoreFocus(focus);
  }
  return changed;
}
const externalRefresh = createExternalRefresh({ load: refreshFromOutside });

async function loadDeploymentStatus() {
  setState({ deploymentStatus: { loading: true, error: '' } });
  try {
    const status = await fetchDeploymentStatus();
    setState({ deploymentStatus: { ...status, loading: false, error: '' } });
  } catch {
    setState({
      deploymentStatus: {
        loading: false,
        error: 'Prax could not load the deployment security status.',
      },
    });
  }
}

async function loadSemanticStatus() {
  setState({ semanticStatus: { ...state.semanticStatus, loading: true, loadError: '' } });
  try {
    setState({ semanticStatus: { ...(await fetchSemanticStatus()), loading: false, loadError: '' } });
  } catch {
    setState({
      semanticStatus: {
        ...state.semanticStatus,
        loading: false,
        loadError: 'Prax could not load semantic-search settings.',
      },
    });
  }
}

async function loadChatStatus() {
  setState({ chatStatus: { ...state.chatStatus, loading: true, loadError: '' } });
  try {
    setState({ chatStatus: { ...(await fetchChatStatus()), loading: false, loadError: '' } });
  } catch {
    setState({
      chatStatus: {
        ...state.chatStatus,
        loading: false,
        loadError: 'Prax could not load answer-model settings.',
      },
    });
  }
}

async function loadGoogleCalendarStatus() {
  setState({ googleCalendarStatus: { ...(state.googleCalendarStatus || {}), loading: true, loadError: '' } });
  try {
    setState({ googleCalendarStatus: { ...(await fetchGoogleCalendarStatus()), loading: false, loadError: '' } });
  } catch {
    setState({
      googleCalendarStatus: {
        ...(state.googleCalendarStatus || {}),
        loading: false,
        loadError: 'Prax could not load Google Calendar settings.',
      },
    });
  }
}

// Google-connect polling: consent happens in an external browser tab and the
// app only learns the outcome when the OAuth callback lands on the server.
// Poll the status endpoint (3s, up to 2 minutes) until `connected` flips, and
// go stale silently when the user leaves Settings or a newer connect /
// disconnect bumps the token.
const GCAL_POLL_INTERVAL_MS = 3000;
const GCAL_POLL_MAX_ATTEMPTS = 40; // 40 × 3s = 2 minutes

function stopGoogleCalendarPolling() {
  gcalPollToken += 1;
}

function startGoogleCalendarPolling() {
  gcalPollToken += 1;
  const token = gcalPollToken;
  let attempts = 0;
  const tick = async () => {
    if (token !== gcalPollToken) return;
    if (state.navType !== 'settings') return; // user left Settings — stop quietly
    attempts += 1;
    try {
      const status = await fetchGoogleCalendarStatus();
      if (token !== gcalPollToken) return;
      if (status.connected) {
        setState({
          googleCalendarStatus: { ...status, loading: false, loadError: '' },
          googleCalendarNotice: 'Google Calendar connected — the dedicated “Prax” calendar is ready.',
        });
        if (state.navType === 'settings') renderApp();
        return;
      }
    } catch { /* transient poll failure — keep waiting for the callback */ }
    if (token !== gcalPollToken) return;
    if (attempts >= GCAL_POLL_MAX_ATTEMPTS) {
      setState({ googleCalendarNotice: 'Google sign-in did not complete. Click Connect to try again.' });
      if (state.navType === 'settings') renderApp();
      return;
    }
    setTimeout(tick, GCAL_POLL_INTERVAL_MS);
  };
  setTimeout(tick, GCAL_POLL_INTERVAL_MS);
}

async function reconcileSemanticSettingsMutation(patch, error) {
  const previousStatus = state.semanticStatus;
  try {
    const status = { ...(await fetchSemanticStatus()), loading: false, loadError: '' };
    const applied = settingsPatchMatchesStatus(patch, status, previousStatus);
    setState({
      semanticStatus: status,
      intelligenceSettingsPending: false,
      semanticSettingsDraft: applied ? null : state.semanticSettingsDraft,
    });
    showToast(applied
      ? 'Semantic-search settings were saved; Prax recovered the current status after the response failed.'
      : `${error?.message || 'Prax could not save the semantic-search settings.'} Current settings were reloaded; review before retrying.`);
  } catch {
    setState({
      intelligenceSettingsPending: false,
      semanticStatus: {
        ...state.semanticStatus,
        loading: false,
        loadError: 'Prax could not confirm the semantic-search settings outcome.',
      },
    });
    showToast('Prax could not confirm the semantic-search settings outcome. Reload status before retrying.');
  }
  renderApp();
}

async function reconcileChatSettingsMutation(patch, error) {
  const previousStatus = state.chatStatus;
  try {
    const status = { ...(await fetchChatStatus()), loading: false, loadError: '' };
    const applied = settingsPatchMatchesStatus(patch, status, previousStatus);
    setState({
      chatStatus: status,
      intelligenceSettingsPending: false,
      chatSettingsDraft: applied ? null : state.chatSettingsDraft,
    });
    showToast(applied
      ? 'Answer-model settings were saved; Prax recovered the current status after the response failed.'
      : `${error?.message || 'Prax could not save the answer-model settings.'} Current settings were reloaded; review before retrying.`);
  } catch {
    setState({
      intelligenceSettingsPending: false,
      chatStatus: {
        ...state.chatStatus,
        loading: false,
        loadError: 'Prax could not confirm the answer-model settings outcome.',
      },
    });
    showToast('Prax could not confirm the answer-model settings outcome. Reload status before retrying.');
  }
  renderApp();
}

async function loadMaintenance() {
  const project = state.maintenanceProjectFilter === 'all' ? '' : state.maintenanceProjectFilter;
  try {
    setState({ staleDocs: await fetchStaleDocuments(project) });
  } catch {
    setState({ staleDocs: [] });
  }
}

async function loadHealth() {
  setState({ healthLoading: true });
  try {
    const [healthData, healthLinkSuggestions] = await Promise.all([
      fetchHealth(''),
      fetchLinkSuggestions('').catch(() => []), // suggestions are a bonus; never fail the page
    ]);
    setState({ healthData, healthLinkSuggestions, healthLoading: false });
  } catch {
    setState({ healthData: null, healthLoading: false });
  }
}

// Generation token so an in-flight scan whose Health view was left and re-entered
// (or superseded by a newer scan) drops its result instead of clobbering state.
let aiReviewToken = 0;

async function goHealth() {
  if (!(await prepareEditorNavigation())) return false;
  // Clear any prior AI review and invalidate any in-flight scan on re-entry.
  aiReviewToken += 1;
  setState({ navType: 'health', editorFocus: false, healthAiReview: null, healthAiReviewError: null, healthAiReviewLoading: false });
  renderApp();
  loadHealth().then(renderApp);
  return true;
}

// On-demand AI review (contradictions + gaps). Advisory; spends model tokens.
async function scanLibraryWithAi() {
  if (state.healthAiReviewLoading || !state.chatStatus?.available) return;
  const token = (aiReviewToken += 1);
  setState({ healthAiReviewLoading: true, healthAiReviewError: null });
  renderApp();
  try {
    const review = await runAiReview('');
    if (token !== aiReviewToken) return; // superseded by a newer scan or navigation
    if (review.reason === 'no-chat-model') {
      setState({ healthAiReviewLoading: false, healthAiReview: null, healthAiReviewError: 'No AI model configured — set one in Settings ▸ Intelligence.' });
    } else if (review.reason === 'ai-review-failed') {
      setState({ healthAiReviewLoading: false, healthAiReview: null, healthAiReviewError: 'The AI review could not complete. Please try again.' });
    } else {
      setState({ healthAiReviewLoading: false, healthAiReview: review });
    }
  } catch {
    if (token !== aiReviewToken) return;
    setState({ healthAiReviewLoading: false, healthAiReviewError: 'Could not complete the AI review.' });
  }
  if (token === aiReviewToken) renderApp();
}

// ---- Today plan & shutdown ritual (2026-07-18 plan) -------------------------
// One queue-walking overlay, two modes. Every action is a normal PATCH; the
// server classifies planned/carried and owns carry_count. A failure keeps the
// current item on screen with a toast — skipping data loss is not an option.

function planEligible(task, now) {
  return task && task.status !== 'completed' && !task.archivedAt
    && !(task.deferredUntil && new Date(task.deferredUntil) > now);
}

function buildPlanQueue(now = new Date()) {
  const today = todayISODate(now);
  const tasks = state.tasks || [];
  const seen = new Set();
  const queue = [];
  const push = (task, bucket) => {
    if (!task || seen.has(task.id)) return;
    seen.add(task.id);
    queue.push({ id: task.id, bucket });
  };
  const open = tasks.filter((task) => planEligible(task, now));
  // Stale plans first: yesterday's unshut-down working set demands a verdict.
  open.filter((task) => task.plannedFor && task.plannedFor < today)
    .forEach((task) => push(task, 'stale'));
  const unplanned = open.filter((task) => task.plannedFor !== today && !(task.plannedFor && task.plannedFor < today));
  const bucketOf = (task) => dueBucket(task.dueDate, { now });
  unplanned.filter((task) => bucketOf(task) === 'overdue').forEach((task) => push(task, 'overdue'));
  unplanned.filter((task) => bucketOf(task) === 'today').forEach((task) => push(task, 'today'));
  const inboxId = inboxProjectId();
  unplanned.filter((task) => task.projectId === inboxId && !task.dueDate).forEach((task) => push(task, 'inbox'));
  unplanned.filter((task) => task.dueDate && task.dueDate > today && task.dueDate <= todayISODate(new Date(now.getTime() + 7 * 86_400_000)))
    .forEach((task) => push(task, 'upcoming'));
  return queue;
}

function openPlanMode() {
  const queue = buildPlanQueue(new Date());
  setState({ planMode: { mode: 'plan', queue, index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0 } });
  renderApp();
}

function openShutdown() {
  const today = todayISODate();
  const queue = (state.tasks || [])
    .filter((task) => planEligible(task, new Date()) && task.plannedFor === today)
    .map((task) => ({ id: task.id, bucket: 'planned' }));
  const done = (state.tasks || []).filter((task) => task.plannedFor === today && task.status === 'completed' && !task.archivedAt).length;
  setState({ planMode: { mode: 'shutdown', queue, index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0, done } });
  renderApp();
}

function mergePlanTask(updated) {
  setState({ tasks: state.tasks.map((task) => (task.id === updated.id ? normalizeTask(updated) : task)) });
}

async function planModeAct(action) {
  const planMode = state.planMode;
  if (!planMode) return;
  const entry = planMode.queue[planMode.index];
  const advance = (patch = {}) => {
    setState({ planMode: { ...state.planMode, ...patch, index: state.planMode.index + 1 } });
    renderApp();
  };
  if (!entry || action === 'skip') { advance(); return; }
  const today = todayISODate();
  try {
    if (action === 'add' || action === 'today') {
      const time = document.querySelector('[data-plan-time]')?.value || '';
      const fields = { plannedFor: today, ...(time ? { dueTime: time, ...(state.tasks.find(t => t.id === entry.id)?.dueDate ? {} : { dueDate: today }) } : {}) };
      mergePlanTask(await updateTask(entry.id, fields));
      advance({ added: planMode.added + 1 });
    } else if (action === 'carry') {
      const tomorrow = todayISODate(new Date(Date.now() + 86_400_000));
      mergePlanTask(await updateTask(entry.id, { plannedFor: tomorrow }));
      advance({ carried: planMode.carried + 1 });
    } else if (action === 'reschedule') {
      const date = document.querySelector('[data-shutdown-date]')?.value || '';
      if (!date) { showToast('Pick a reschedule date first'); return; }
      mergePlanTask(await updateTask(entry.id, { dueDate: date, plannedFor: null }));
      advance({ rescheduled: planMode.rescheduled + 1 });
    } else if (action === 'drop') {
      mergePlanTask(await updateTask(entry.id, { plannedFor: null }));
      advance({ dropped: planMode.dropped + 1 });
    }
  } catch {
    showToast('Could not save that decision — Prax may be unreachable. The item stays here.');
  }
}

function openDailyBrief() {
  setState({ dailyBriefOpen: true, dailyBriefNarrative: null, dailyBriefError: false, dailyBriefLoading: false });
  renderApp();
}

async function draftDailyBrief() {
  if (state.dailyBriefLoading) return;
  setState({ dailyBriefLoading: true, dailyBriefError: false });
  renderApp();
  try {
    const res = await narrateBrief(buildDailyBrief(state));
    if (res.narrative) setState({ dailyBriefLoading: false, dailyBriefNarrative: res.narrative });
    else setState({ dailyBriefLoading: false, dailyBriefError: res.reason === 'no-chat-model' ? 'No AI model configured — set one in Settings ▸ Intelligence. Showing the plain brief.' : 'Could not draft with AI. Showing the plain brief.' });
  } catch {
    setState({ dailyBriefLoading: false, dailyBriefError: 'Could not reach the AI model. Showing the plain brief.' });
  }
  renderApp();
}

async function copyDailyBrief() {
  const text = state.dailyBriefNarrative || buildDailyBrief(state);
  const ok = await copyToClipboard(text);
  showToast(ok ? 'Brief copied' : 'Could not copy');
}

// ---- AI assistant (agentic tool-calling chat) -----------------------------

function openAssistant() {
  if (state.captureSubmitting) return;
  if (state.captureOpen) discardCapture();
  setState({ assistantOpen: true, assistantError: null, assistantErrorKind: null, paletteOpen: false });
  renderApp();
  loadAssistantStatus();
}

async function loadAssistantStatus() {
  try {
    const status = await fetchAssistantStatus();
    setState({ assistantStatus: status });
  } catch {
    setState({ assistantStatus: { available: false, toolCount: 0 } });
  }
  if (state.assistantOpen) renderApp();
}

// Apply one turn's response envelope to state (shared by send + confirm resume).
// After the assistant executes an approved write, the server has mutated data
// the human UI holds a cached copy of (tasks/projects/documents). Reload it so
// the change shows immediately instead of only after a manual refresh/nav.
async function refreshAfterAssistantWrite() {
  try {
    await Promise.all([loadTasks(), loadProjects(), loadDocuments()]);
    if (state.healthData) await loadHealth();
    return true;
  } catch {
    return false;
  }
}

async function applyAssistantResult(res) {
  const preserveApproval = Boolean(state.assistantPending?.length)
    && (res.status === 'no_model' || res.reason === 'approval-unavailable');
  if (preserveApproval) {
    setState({ assistantLoading: false, assistantError: res.status === 'no_model'
      ? 'No AI model configured — restore a tool-capable model in Settings, then retry this saved approval.'
      : 'This model cannot resume the saved approval. Restore a tool-capable model in Settings, then retry.', assistantErrorKind: 'error' });
  } else if (res.status === 'awaiting_confirmation') {
    setState({ assistantMessages: res.messages, assistantPending: res.pending || [], assistantLoading: false, assistantError: null, assistantErrorKind: null });
  } else if (res.status === 'no_model') {
    setState({ assistantLoading: false, assistantPending: null, assistantError: 'No AI model configured — set one in Settings ▸ Intelligence ▸ AI answers.', assistantErrorKind: 'error', assistantStatus: { available: false, toolCount: state.assistantStatus?.toolCount || 0 } });
  } else if (res.status === 'error') {
    setState({ assistantMessages: res.messages || state.assistantMessages, assistantLoading: false, assistantPending: null, assistantError: null, assistantErrorKind: null });
  } else {
    // done
    setState({ assistantMessages: res.messages, assistantLoading: false, assistantPending: null, assistantError: null, assistantErrorKind: null });
  }

  // A write mutated cached data. Wait for the reload so the notice can say
  // whether the committed change is already visible or requires a page reload.
  const refreshed = res.didWrite || res.outcomeUnknown ? await refreshAfterAssistantWrite() : true;
  if (!preserveApproval) setState({ assistantApprovalAttempted: false });
  saveAssistantRecovery(taskDraftStorage(), state.assistantPending?.length ? { messages: state.assistantMessages, pending: state.assistantPending, attempted: state.assistantApprovalAttempted } : null);
  const notice = preserveApproval || res.status === 'no_model' ? null : assistantOutcomeNotice(res, { refreshed });
  if (notice) setState({ assistantError: notice.text, assistantErrorKind: notice.kind });
}

async function sendAssistant(rawText) {
  const text = (rawText || '').trim();
  if (!text || state.assistantLoading || (state.assistantPending && state.assistantPending.length)) return;
  const messages = [...state.assistantMessages, { role: 'user', content: text }];
  setState({ assistantMessages: messages, assistantInput: '', assistantLoading: true, assistantError: null, assistantErrorKind: null });
  renderApp();
  try {
    const res = await assistantChat(messages);
    await applyAssistantResult(res);
  } catch (err) {
    setState({ assistantLoading: false, assistantError: err?.message || 'The assistant request failed.', assistantErrorKind: 'error' });
  }
  renderApp();
}

async function resolveAssistantWrites(decision) {
  const pending = state.assistantPending;
  if (!pending || !pending.length || state.assistantLoading) return;
  const decisions = {};
  for (const p of pending) decisions[p.id] = decision; // batch approve/decline
  if (state.assistantApprovalAttempted && decision !== 'approve') return;
  if (!saveAssistantRecovery(taskDraftStorage(), { messages: state.assistantMessages, pending, attempted: decision === 'approve' })) {
    showToast('The approval could not be saved for recovery. Keep this window open and try again.');
    return;
  }
  setState({ assistantApprovalAttempted: decision === 'approve', assistantLoading: true, assistantError: null, assistantErrorKind: null });
  renderApp();
  try {
    const res = await assistantChat(state.assistantMessages, decisions);
    await applyAssistantResult(res);
  } catch (err) {
    setState({ assistantLoading: false, assistantError: 'The connection ended before the approval outcome was known. Retry safely to recover the same action; do not start a replacement action.', assistantErrorKind: 'error' });
  }
  renderApp();
}

function clearAssistant() {
  if (state.assistantLoading || state.assistantApprovalAttempted) { showToast('Recover the pending approval outcome before starting a new chat.'); return; }
  saveAssistantRecovery(taskDraftStorage(), null);
  setState({ assistantMessages: [], assistantPending: null, assistantError: null, assistantErrorKind: null, assistantInput: '', assistantLoading: false });
  renderApp();
}

async function verifyHealthDoc(id) {
  if (!id || !(await prepareEditorNavigation(id))) return;
  try {
    const current = await fetchDocument(id);
    cacheLifecycleDocument(current);
    await openDocumentInEditor(id);
    destroyEditorController();
    setState({ editorMode: 'preview' });
    renderApp();
    showToast('Review this document, then use Verify to approve the content shown.', null, 7000);
  } catch { showToast('Could not load this document for review.'); }
}

// Accept a suggested wiki-link: link the first plain mention, then reload so the
// suggestion (now satisfied) drops off the list.
async function acceptLinkSuggestion(id, title) {
  if (!id || !title) return;
  try {
    await applyWikiLink(id, title);
    showToast(`Linked [[${title}]]`);
    await loadDocuments(); // the doc body changed
    await loadHealth();
  } catch (err) {
    showToast(err?.message || 'Could not add the link');
  }
  renderApp();
}

async function loadDrawerContext(taskId) {
  const token = (drawerContextToken += 1);
  const [documents, checklist, activity] = await Promise.allSettled([
    fetchTaskDocuments(taskId),
    fetchTaskChecklist(taskId),
    fetchTaskActivity(taskId),
  ]);
  if (token !== drawerContextToken || state.drawerTaskId !== taskId) return false;
  setState({
    taskDocuments: documents.status === 'fulfilled' ? documents.value : [],
    taskChecklist: checklist.status === 'fulfilled' ? checklist.value : [],
    taskActivity: activity.status === 'fulfilled' ? activity.value : [],
  });
  renderApp();
  // Related knowledge fills AFTER the drawer renders (advisory regime: it may
  // never delay the drawer). The token guard drops a stale fill.
  loadRelatedDocuments(taskId, token);
  return true;
}

// Session-scoped dismissals: a dismissed suggestion stays gone for this tab's
// lifetime, per task — not a server concern.
const relatedDismissed = new Set();

async function loadRelatedDocuments(taskId, token) {
  setState({ taskRelatedDocs: { taskId, loading: true, suggestions: [] } });
  renderApp();
  const result = await fetchRelatedDocuments(taskId).catch(() => ({ suggestions: [], degraded: true, reason: 'search-failed' }));
  if (token !== drawerContextToken || state.drawerTaskId !== taskId) return;
  setState({
    taskRelatedDocs: {
      taskId,
      loading: false,
      suggestions: (result.suggestions || []).filter((doc) => !relatedDismissed.has(`${taskId}:${doc.id}`)),
      degraded: Boolean(result.degraded),
      reason: result.reason || null,
    },
  });
  renderApp();
}

async function loadDocumentTaskBacklinks(documentId) {
  try {
    const tasks = await fetchDocumentTaskBacklinks(documentId);
    if (state.editorDocId === documentId) {
      setState({ documentTaskBacklinks: tasks });
      if (!state.isDocumentInfoEditorOpen) renderApp();
    }
  } catch {
    /* backlinks footer stays empty */
  }
}

async function loadSimilarDocuments(documentId) {
  try {
    const similar = await fetchSimilarDocuments(documentId);
    if (state.editorDocId === documentId) {
      setState({ documentSimilar: similar });
      if (!state.isDocumentInfoEditorOpen) renderApp();
    }
  } catch {
    if (state.editorDocId === documentId) { setState({ documentSimilar: { items: [], degraded: true, reason: 'unavailable' } }); renderApp(); }
  }
}

async function loadDocumentLinks(documentId) {
  try {
    const links = await fetchDocumentLinks(documentId, 'both');
    if (state.editorDocId === documentId) {
      setState({ documentLinks: links });
      if (!state.isDocumentInfoEditorOpen) renderApp();
    }
  } catch {
    /* links section stays unfetched */
  }
}

async function loadExternalRefs(documentId) {
  try {
    const refs = await fetchExternalRefs(documentId);
    if (state.editorDocId === documentId) {
      setState({ documentExternalRefs: refs });
      // While the Document info form is open, a re-render would rebuild it
      // from state and discard whatever the user has typed; the section
      // renders on the next render (form close, save, or any action).
      if (!state.isDocumentInfoEditorOpen) renderApp();
    }
  } catch {
    /* refs section stays unfetched */
  }
}

// Reconcile the doc-info refs textarea (one `url` or `url | label` per line)
// against the refs SNAPSHOT the form was seeded from (docInfoRefsSeed):
// upsert every desired line (the POST is idempotent and also updates a
// changed label) and delete any seeded ref whose URL is no longer listed.
// If the seed is null the form opened before the stored refs could be
// fetched — the user never saw them, so an absent line means "not displayed",
// not "removed": upserts still apply but nothing is deleted. Best-effort per
// row so one bad line doesn't abort the rest; returns the failure count so
// the caller can tell the user about a partial save.
async function reconcileExternalRefs(documentId, refsText, seed = state.docInfoRefsSeed) {
  const desired = parseExternalRefLines(refsText);
  const desiredUrls = new Set(desired.map((r) => r.url));
  const seeded = Array.isArray(seed) ? seed : [];
  let failed = 0;
  for (const ref of seeded) {
    if (!desiredUrls.has(ref.url)) {
      try { await removeExternalRef(documentId, ref.id); } catch { failed += 1; }
    }
  }
  for (const ref of desired) {
    try { await addExternalRef(documentId, ref); } catch { failed += 1; }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Document-info form (root-review finding 5). The form is an explicit draft in
// state.documentInfoDraft: what it was opened from (baseline + revision), what
// the person typed, and any unresolved conflict. Inputs mirror into the draft
// without re-rendering, so a rerender or a failed save never reseeds the
// inputs from the record and throws typed metadata away.
const DOCUMENT_INFO_INPUT_FIELDS = [
  ['data-doc-info-title', 'title'], ['data-doc-info-type', 'documentType'], ['data-doc-info-project', 'projectId'],
  ['data-doc-info-tags', 'tags'], ['data-doc-info-source', 'sourceFilename'], ['data-doc-info-refs', 'refsText'],
];

function mirrorDocumentInfoInput(target) {
  const entry = DOCUMENT_INFO_INPUT_FIELDS.find(([attr]) => target.hasAttribute?.(attr));
  if (!entry) return false;
  const draft = state.documentInfoDraft;
  if (draft && !draft.pending) setState({ documentInfoDraft: { ...draft, fields: { ...draft.fields, [entry[1]]: target.value } } });
  return true;
}

// One metadata PATCH, classified: saved / conflict (the record the server
// holds now) / error. A lost response is judged only on the fields SENT, so
// an unrelated concurrent edit cannot mask a save that landed.
async function sendDocumentInfoPatch(docId, patch) {
  try {
    return { saved: await updateDocument(docId, patch) };
  } catch (error) {
    if (error?.status === 409 && error?.document?.revision) return { conflict: error.document };
    let observed = null;
    try { observed = await fetchDocument(docId); } catch { observed = null; }
    if (observed && documentInfoCommitted(observed, patch)) return { saved: observed };
    return { error: true };
  }
}

// Rebase the editor on an acknowledged record so the next body edit stays
// conditional on the saved title and body. A clean editor adopts the record
// outright — a remote body surfaced by a 409 must never be typed over by the
// next autosave. A dirty editor keeps its base when the body moved under it,
// so its own autosave reconciles through the body-conflict review instead of
// silently overwriting the remote body.
function rebaseEditorOnDocument(docId, doc) {
  const base = state.documentDraftBase || currentDocument();
  cacheLifecycleDocument(doc);
  if (state.editorDocId !== docId || state.documentDraftId !== docId) return;
  const body = doc.body || '';
  if (!state.isDocumentDirty) {
    const bodyMoved = state.documentDraftBody !== body;
    setState({ documentDraftBase: doc, documentDraftTitle: doc.title || '', documentDraftBody: body });
    if (bodyMoved) destroyEditorController();
    return;
  }
  if (body !== (base?.body || '')) return;
  setState({
    documentDraftBase: doc,
    documentDraftTitle: state.documentDraftTitle === (base?.title || '') ? (doc.title || '') : state.documentDraftTitle,
  });
}

// Past runs of a runbook, shown in the editor sidebar. Notes have no runs.
async function loadDocumentRuns(doc) {
  if (!doc || doc.documentType !== 'runbook') { setState({ documentRuns: null }); return; }
  try {
    const runs = await fetchRuns(doc.id);
    if (state.editorDocId === doc.id) {
      setState({ documentRuns: runs });
      if (!state.isDocumentInfoEditorOpen) renderApp();
    }
  } catch {
    /* runs section stays hidden */
  }
}

// Opening an editor needs five independent context reads. Installing each one
// separately rebuilt the entire shell and remounted CodeMirror five times.
// Fetch them concurrently, reject stale results, then install one coherent
// patch and render once. Individual loaders remain for targeted refreshes after
// mutations (supersession and external-reference edits).
async function loadDocumentContext(doc) {
  if (!doc?.id) return false;
  const documentId = doc.id;
  const results = await Promise.allSettled([
    fetchDocumentLinks(documentId, 'both'),
    fetchExternalRefs(documentId),
    fetchDocumentTaskBacklinks(documentId),
    fetchSimilarDocuments(documentId),
    doc.documentType === 'runbook' ? fetchRuns(documentId) : Promise.resolve(null),
  ]);
  if (state.editorDocId !== documentId) return false;
  const keys = [
    'documentLinks', 'documentExternalRefs', 'documentTaskBacklinks', 'documentSimilar', 'documentRuns',
  ];
  const patch = {};
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') patch[keys[index]] = result.value;
    else if (keys[index] === 'documentSimilar') patch.documentSimilar = { items: [], degraded: true, reason: 'unavailable' };
  });
  setState(patch);
  if (!state.isDocumentInfoEditorOpen) renderApp();
  return true;
}

async function ensureBoardExtras(tasks) {
  const missing = pendingExtraIds(tasks.map(t => t.id), state.taskBoardExtras, state.taskBoardExtrasLoading);
  if (!missing.length) return;
  const token = Date.now();
  const loading = { ...state.taskBoardExtrasLoading };
  for (const id of missing) loading[id] = token;
  setState({ taskBoardExtrasLoading: loading });
  try {
    for (const batch of batchIds(missing)) {
      const extras = await fetchTaskBoardExtras(batch);
      const merged = { ...state.taskBoardExtras };
      for (const extra of extras) merged[extra.taskId] = extra;
      // ids the server omitted still count as fetched (empty extras)
      for (const id of batch) {
        if (merged[id] === undefined) {
          merged[id] = { docsCount: 0, checklistDone: 0, checklistTotal: 0, latestActivity: '' };
        }
      }
      setState({ taskBoardExtras: merged });
    }
    clearTimeout(boardExtrasRenderTimer);
    boardExtrasRenderTimer = setTimeout(() => {
      const stillVisible = state.navType === 'project' && (state.tab === 'board' || state.tab === 'list');
      if (stillVisible && !state.captureOpen && !state.drawerTaskId) renderApp();
    }, 500);
  } catch {
    /* signals degrade silently; a later render retries */
  } finally {
    const done = { ...state.taskBoardExtrasLoading };
    for (const id of missing) if (done[id] === token) delete done[id];
    setState({ taskBoardExtrasLoading: done });
  }
}

// ---------------------------------------------------------------------------
// Toasts & undo
// ---------------------------------------------------------------------------

function showToast(message, undo = null, duration = undo ? 5000 : 2400, undoLabel = 'Undo') {
  clearTimeout(toastTimer);
  setState({ toast: { message, undo, undoLabel } });
  toastTimer = setTimeout(() => {
    setState({ toast: null });
    renderApp();
  }, duration);
  renderApp();
}

function dismissToast() {
  clearTimeout(toastTimer);
  setState({ toast: null });
}

// Copy text to the clipboard, resolving true/false. Prefers the async Clipboard
// API (works on localhost/Tauri, which count as secure contexts) and falls back
// to a hidden-textarea execCommand for older webviews.
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Task mutations
// ---------------------------------------------------------------------------

function taskById(id) {
  return state.tasks.find(t => t.id === id) || state.archivedTasks.find(t => t.id === id) || null;
}

function applyTaskPatchLocal(id, patch) {
  setState({ tasks: state.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) });
}

// Update a project in both the sidebar and managed sets without re-rendering
// (the on-call/handoff inputs are mid-edit; a render would steal focus).
function applyProjectPatchLocal(id, patch) {
  setState({
    projects: state.projects.map(p => (p.id === id ? { ...p, ...patch } : p)),
    managedProjects: state.managedProjects.map(p => (p.id === id ? { ...p, ...patch } : p)),
  });
}

// Inline project rename from the header title. The slug stays stable (name is a
// display label); resolveProject matches the new name, so nothing breaks.
function startRenameProject(id) {
  setState({ renamingProjectId: id });
  renderApp();
}

async function saveRenameProject(id, rawValue) {
  if (state.renamingProjectId !== id) return; // already committed/cancelled
  const value = (rawValue || '').trim();
  const project = projectsById()[id];
  setState({ renamingProjectId: null });
  if (!value || !project || value === project.name) { renderApp(); return; }
  applyProjectPatchLocal(id, { name: value }); // optimistic
  renderApp();
  try {
    const updated = await updateProject(id, { name: value });
    if (updated) applyProjectPatchLocal(id, { name: updated.name });
    showToast('Project renamed');
  } catch {
    await loadProjects(); // reconcile on failure
    alertError('rename this project');
  }
  renderApp();
}

// Snooze target for a preset: tomorrow / next week, at 9am local so the task
// reappears in the morning rather than at midnight. Returns an ISO timestamp.
function snoozeUntil(preset) {
  const d = new Date();
  d.setDate(d.getDate() + (preset === 'week' ? 7 : 1));
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

async function updateTaskWithReadback(id, apiPatch) {
  try {
    return await updateTask(id, apiPatch);
  } catch (writeError) {
    try {
      const observed = normalizeTask(await fetchTask(id));
      if (taskMatchesPatch(observed, apiPatch)) return observed;
    } catch { /* the canonical outcome remains unknown */ }
    throw writeError;
  }
}

async function patchTask(id, apiPatch, { failure = 'update this task' } = {}) {
  if (!id) return null;
  let normalized;
  try {
    const updated = await enqueueTaskMutation(id, async () => {
      // Hold the per-task queue through exact lost-response reconciliation.
      return updateTaskWithReadback(id, apiPatch);
    });
    normalized = normalizeTask(updated);
  } catch {
    alertError(failure);
    await loadTasks().catch(() => {});
    renderApp();
    return null;
  }
  applyTaskPatchLocal(id, normalized);
  let lifecycleRefreshFailed = false;
  // Completing a recurring task spawns its next instance atomically
  // server-side. Collection refresh is separate and cannot redefine success.
  if (normalized.recurrence && normalized.status === 'completed') {
    try { await loadTasks(); } catch { lifecycleRefreshFailed = true; }
    // A lost PATCH response reconciled via GET readback never carries the
    // route's additive nextOccurrenceTaskId — but the successor was committed
    // in the same transaction, so find it in the refreshed collection rather
    // than toasting "could not be scheduled" about a schedule that happened.
    if (!normalized.nextOccurrenceTaskId && !lifecycleRefreshFailed) {
      const successor = state.tasks.find((t) => t.id !== normalized.id
        && t.projectId === normalized.projectId
        && t.title === normalized.title
        && t.recurrence === normalized.recurrence
        && t.status !== 'completed' && !t.archivedAt
        && (!normalized.dueDate || (t.dueDate && t.dueDate > normalized.dueDate)));
      if (successor) normalized = { ...normalized, nextOccurrenceTaskId: successor.id };
    } else if (!normalized.nextOccurrenceTaskId && lifecycleRefreshFailed) {
      // The atomic transition committed with the completion; only the
      // collection refresh failed — the successor exists but is not loaded.
      normalized = { ...normalized, nextOccurrenceTaskId: 'unloaded' };
    }
  }
  renderApp();
  return lifecycleRefreshFailed ? { ...normalized, lifecycleRefreshFailed: true } : normalized;
}

// Add a normalized label to the open task (deduped). Shares the label
// convention with the server and the filter grammar via normalizeLabel.
async function addTaskLabel(raw) {
  const label = normalizeLabel(raw);
  const task = taskById(state.drawerTaskId);
  if (!label || !task) return;
  const current = Array.isArray(task.labels) ? task.labels : [];
  if (current.includes(label)) {
    setState({ taskLabelDraft: '' });
    renderApp();
    return;
  }
  const taskId = state.drawerTaskId;
  const saved = await patchTask(taskId, { labels: [...current, label] });
  if (saved && state.drawerTaskId === taskId) {
    setState({ taskLabelDraftId: taskId, taskLabelDraft: '' });
    renderApp();
  }
}

async function toggleTaskDone(id) {
  const task = taskById(id);
  if (!task || task.archivedAt) return;
  const prior = task.status;
  const done = designStatus(prior) === 'completed';
  const wasRecurring = Boolean(task.recurrence);
  const next = done ? apiStatus('planned') : apiStatus('completed');
  applyTaskPatchLocal(id, { status: next });
  renderApp();
  const saved = await patchTask(id, { status: next });
  if (saved) {
    const message = done
      ? (wasRecurring ? 'Reopened as one-off — future occurrences are unchanged.' : 'Reopened')
      : (saved.nextOccurrenceTaskId
        ? `Completed — next occurrence scheduled${saved.lifecycleRefreshFailed ? '; reload to show it' : ''}.`
        : (saved.recurrence
          ? 'Completed — but the next occurrence could not be scheduled.'
          : 'Completed — nice.'));
    showToast(message, async () => {
      dismissToast();
      const undone = await patchTask(id, { status: prior });
      if (saved.recurrence && undone) {
        showToast('Reopened as one-off — future occurrences are unchanged.');
      }
    }, 5000, saved.recurrence ? 'Reopen' : 'Undo');
  }
}

async function bulkSetStatus(designKey, label) {
  const ids = [...state.multiSelectIds];
  if (!ids.length) return;
  const prior = ids.map(id => ({ id, status: taskById(id)?.status }));
  setState({ multiSelectIds: [] });
  try {
    await Promise.all(ids.map(id => enqueueTaskMutation(
      id,
      () => updateTaskWithReadback(id, { status: apiStatus(designKey) }),
    )));
    await loadTasks();
    showToast(`${ids.length} task${ids.length > 1 ? 's' : ''} → ${label}`, async () => {
      dismissToast();
      await Promise.all(prior.filter(p => p.status).map(p => enqueueTaskMutation(
        p.id,
        () => updateTaskWithReadback(p.id, { status: p.status }),
      )));
      await loadTasks();
      renderApp();
    });
  } catch {
    alertError('apply the bulk change');
    await loadTasks();
  }
  renderApp();
}

async function archiveSelectedTasks(ids) {
  if (!ids.length) return;
  if (ids.includes(state.drawerTaskId) && !(await flushTaskDrawerDraft())) {
    showToast('Save this task draft before archiving it.'); return;
  }
  const results = await Promise.all(ids.map(id => enqueueTaskMutation(id, () =>
    reconcileTaskArchive({ id, mutate: archiveTask, read: fetchTask }))));
  const committed = ids.filter((id,index) => results[index].committed);
  const unresolved = ids.filter(id => !committed.includes(id));
  setState({
    multiSelectIds: unresolved,
    ...(committed.includes(state.drawerTaskId) ? {drawerTaskId:null,taskNotesDraftId:null,taskLabelDraftId:null,taskLabelDraft:''} : {}),
    tasks: state.tasks.filter(task => !committed.includes(task.id)),
  });
  let refreshed = true;
  try { await loadTasks(); if (state.tab === 'archive') await loadArchivedTasks(); }
  catch { refreshed = false; }
  const undo = committed.length ? async () => {
    dismissToast();
    const restored = await Promise.all(committed.map(id => enqueueTaskMutation(id, () =>
      reconcileTaskArchive({ id, archived:false, mutate:restoreTask, read:fetchTask }))));
    const count = restored.filter(result => result.committed).length;
    let loaded = true;
    try { await loadTasks(); if (state.tab === 'archive') await loadArchivedTasks(); } catch { loaded = false; }
    showToast(count === committed.length
      ? (loaded ? 'Task archive undone' : 'Tasks restored, but the list could not refresh. Reload to see them.')
      : count + ' restored; ' + (committed.length-count) + ' restore outcomes could not be confirmed.', null, 7000);
    renderApp();
  } : null;
  const success = ids.length === 1 ? 'Task archived' : committed.length + ' tasks archived';
  let message = committed.length ? success : 'Prax could not confirm the archive outcome.';
  if (unresolved.length && committed.length) message += '; ' + unresolved.length + ' could not be confirmed and remain selected.';
  if (!refreshed) message += ' The list could not refresh; reload to reconcile it.';
  showToast(message, undo, 7000);
  renderApp();
}
async function bulkArchive() { await archiveSelectedTasks([...state.multiSelectIds]); }
async function archiveTaskWithUndo(id) { if (taskById(id)) await archiveSelectedTasks([id]); }

function taskDraftStorage() {
  try { return window.localStorage; } catch { return null; }
}

function taskDraftSnapshot() {
  return {
    title: state.taskTitleDraft,
    description: state.taskDescriptionDraft,
    notes: state.taskNotesDraft,
  };
}

function setTaskDraftStatusInPlace(status) {
  setState({ taskDraftSaveStatus: status });
  const label = appRoot?.querySelector('[data-task-draft-save-status]');
  if (label) label.textContent = status;
  const action = appRoot?.querySelector('[data-task-draft-save-action]');
  if (action) {
    const reason = state.taskDraftRecoveryReason;
    action.hidden = !['failed', 'recovered', 'conflict'].includes(reason);
    action.disabled = ['Saving...', 'Autosaving...', 'Checking saved copy...'].includes(status);
    action.textContent = reason === 'conflict'
      ? 'Review and save'
      : (reason === 'recovered' ? 'Save recovered draft' : 'Retry');
  }
}

function seedTaskDrawerDraft(task) {
  clearTimeout(taskDraftSaveTimer);
  const storage = taskDraftStorage();
  if (task?.archivedAt) clearTaskDraftRecovery(storage, task.id);
  const recovery = task?.archivedAt ? null : loadTaskDraftRecovery(storage, task?.id);
  const resolved = resolveTaskDraftRecovery(task, recovery);
  if (resolved.clear) clearTaskDraftRecovery(storage, task.id);
  setState({
    taskNotesDraftId: task?.id || null,
    // The server values this drawer was seeded from. Saves send ONLY fields
    // whose draft diverges from this baseline, and refreshes fold newer
    // server values into untouched fields — so an out-of-band agent edit to
    // a field the user never touched is no longer overwritten by autosave.
    taskDraftBaseline: task
      ? { title: task.title, description: task.description, notes: task.notes }
      : null,
    taskTitleDraft: resolved.title,
    taskDescriptionDraft: resolved.description,
    taskNotesDraft: resolved.notes,
    isTaskNotesDirty: resolved.isDirty,
    taskDraftSaveStatus: resolved.status,
    taskDraftRecoveryReason: ['recovered', 'conflict'].includes(resolved.kind) ? resolved.kind : null,
    isTaskDraftStored: true,
    taskLabelDraftId: task?.id || null,
    taskLabelDraft: '',
  });
}

function scheduleTaskDraftAutosave() {
  clearTimeout(taskDraftSaveTimer);
  taskDraftSaveTimer = setTimeout(() => {
    if (state.taskNotesDraftId === state.drawerTaskId && state.isTaskNotesDirty
      && !['recovered', 'conflict'].includes(state.taskDraftRecoveryReason)
      // An empty title can never save — autosaving would just re-fail 'Title
      // required' every tick while the user is mid-edit. Stay quiet until a
      // title exists; a manual save/close still surfaces the requirement.
      && normalizeTaskDraftTitle(state.taskTitleDraft)) {
      setTaskDraftStatusInPlace('Autosaving...');
      saveTaskDrawerDraft({ status: null });
    }
  }, TASK_DRAFT_AUTOSAVE_DELAY_MS);
}

function handleTaskDrawerDraftChange(patch) {
  const task = taskById(state.drawerTaskId);
  if (!task) return;
  const draft = { ...taskDraftSnapshot(), ...patch };
  // Dirty means "the USER diverged from the seeded baseline" — comparing
  // against the live task would flip dirty when an out-of-band refresh
  // installs someone else's edit, arming an autosave the user never caused.
  const dirty = state.taskDraftBaseline
    ? taskDraftIsDirty(state.taskDraftBaseline, draft)
    : taskDraftIsDirty(task, draft);
  const storage = taskDraftStorage();
  const stored = dirty
    ? storeTaskDraftRecovery(storage, { task, ...draft })
    : clearTaskDraftRecovery(storage, task.id);
  const protectedRecovery = dirty && ['recovered', 'conflict'].includes(state.taskDraftRecoveryReason);
  setState({
    taskTitleDraft: draft.title,
    taskDescriptionDraft: draft.description,
    taskNotesDraft: draft.notes,
    isTaskNotesDirty: dirty,
    taskDraftRecoveryReason: protectedRecovery ? state.taskDraftRecoveryReason : null,
    isTaskDraftStored: dirty ? stored : true,
  });
  setTaskDraftStatusInPlace(dirty
    ? (protectedRecovery ? state.taskDraftSaveStatus : (stored ? 'Unsaved changes' : 'Unsaved — keep this tab open'))
    : 'Saved');
  if (!dirty || protectedRecovery) clearTimeout(taskDraftSaveTimer);
  else scheduleTaskDraftAutosave();
}

function applyTaskDraftSave(savedTask, { taskId, sentDraft }) {
  const saved = normalizeTask(savedTask);
  applyTaskPatchLocal(taskId, saved);
  const stillActive = state.drawerTaskId === taskId && state.taskNotesDraftId === taskId;
  // The saved row is the new server baseline for the per-field diff — and
  // fields the user had NOT touched must follow it into the draft, or the
  // rebased baseline makes the stale draft read as typing and the next
  // autosave resurrects the old value over an out-of-band edit one second
  // after the fix suppressed it.
  if (stillActive) {
    const prevBaseline = state.taskDraftBaseline;
    const draft = taskDraftSnapshot();
    const patch = { taskDraftBaseline: { title: saved.title, description: saved.description, notes: saved.notes } };
    if (prevBaseline) {
      if (draft.title === prevBaseline.title) patch.taskTitleDraft = saved.title;
      if (draft.description === prevBaseline.description) patch.taskDescriptionDraft = saved.description;
      if (draft.notes === prevBaseline.notes) patch.taskNotesDraft = saved.notes;
    }
    setState(patch);
  }
  if (stillActive && taskDraftIsDirty(saved, taskDraftSnapshot())) {
    const stored = storeTaskDraftRecovery(taskDraftStorage(), {
      task: saved,
      ...taskDraftSnapshot(),
    });
    const status = stored ? 'Unsaved changes' : 'Unsaved — keep this tab open';
    setState({
      isTaskNotesDirty: true,
      taskDraftSaveStatus: status,
      taskDraftRecoveryReason: null,
      isTaskDraftStored: stored,
      ...clearTaskBoardExtra(state, taskId),
    });
    scheduleTaskDraftAutosave();
    setTaskDraftStatusInPlace(status);
  } else {
    clearTaskDraftRecovery(taskDraftStorage(), taskId, sentDraft);
    if (stillActive) {
      setState({
        taskTitleDraft: saved.title,
        taskDescriptionDraft: saved.description,
        taskNotesDraft: saved.notes,
        isTaskNotesDirty: false,
        taskDraftRecoveryReason: null,
        isTaskDraftStored: true,
        ...clearTaskBoardExtra(state, taskId),
      });
      setTaskDraftStatusInPlace('Saved');
    }
  }
  return true;
}

// A per-field save can only be judged through the fields it actually SENT:
// unsent fields deliberately mirror out-of-band edits (assistant, MCP, second
// window), so a whole-snapshot compare misreads a landed notes-only save plus
// a foreign description edit as a blocking conflict.
function taskDraftFieldText(field, value) {
  return field === 'title' ? normalizeTaskDraftTitle(value) : String(value ?? '');
}

// The fields a save of `draft` sends: those diverging from the seeded baseline
// (no baseline ⇒ everything is sent). Mirrors saveTaskDrawerDraft's patch.
function taskDraftSentFields(draft, draftBaseline) {
  return ['title', 'description', 'notes']
    .filter((field) => !draftBaseline || draft[field] !== draftBaseline[field]);
}

// committed: every sent field reads back as the sent value — the write landed.
function taskDraftSaveCommitted(observed, sentDraft, sentFields) {
  return sentFields.every(
    (field) => taskDraftFieldText(field, observed[field]) === taskDraftFieldText(field, sentDraft[field]),
  );
}

// conflict: a SENT field diverges from the pre-save local copy — someone else
// won a field this draft is contending for. Unsent fields never participate.
function taskDraftSaveConflicts(observed, localTask, sentFields) {
  return sentFields.some(
    (field) => taskDraftFieldText(field, observed[field]) !== taskDraftFieldText(field, localTask[field]),
  );
}

function markTaskDraftConflict(observedTask, taskId) {
  applyTaskPatchLocal(taskId, normalizeTask(observedTask));
  if (state.drawerTaskId !== taskId) return;
  setState({ taskDraftRecoveryReason: 'conflict' });
  setTaskDraftStatusInPlace('Recovered draft — saved copy changed');
  showToast('The saved task changed. Review the recovered draft before replacing it.');
}

async function saveTaskDrawerDraft({ status = 'Saving...' } = {}) {
  const taskId = state.taskNotesDraftId;
  if (!taskId || !state.isTaskNotesDirty) return true;
  if (taskDraftSavePromise) return taskDraftSavePromise;
  const sentDraft = taskDraftSnapshot();
  // PATCH only the fields the user actually changed from the seeded baseline:
  // bundling all three overwrote out-of-band edits (assistant, MCP, second
  // window) to fields the user never touched.
  const baseline = state.taskDraftBaseline;
  const patch = {};
  if (!baseline || sentDraft.title !== baseline.title) patch.title = normalizeTaskDraftTitle(sentDraft.title);
  if (!baseline || sentDraft.description !== baseline.description) patch.description = sentDraft.description;
  if (!baseline || sentDraft.notes !== baseline.notes) patch.notes = sentDraft.notes;
  if (Object.prototype.hasOwnProperty.call(patch, 'title') && !patch.title) {
    setState({ taskDraftRecoveryReason: 'failed' });
    // The in-place status is the signal — no toast: showToast re-renders the
    // app, which destroys the focused title input mid-edit.
    setTaskDraftStatusInPlace('Title required');
    return false;
  }
  if (Object.keys(patch).length === 0) {
    // Nothing diverges from the server baseline — the draft is already saved.
    clearTaskDraftRecovery(taskDraftStorage(), taskId, sentDraft);
    setState({ isTaskNotesDirty: false, taskDraftRecoveryReason: null, isTaskDraftStored: true });
    setTaskDraftStatusInPlace('Saved');
    return true;
  }
  if (status) setTaskDraftStatusInPlace(status);
  taskDraftSavePromise = (async () => {
    try {
      return await enqueueTaskMutation(taskId, async () => {
        try {
          const saved = await updateTask(taskId, patch);
          return applyTaskDraftSave(saved, { taskId, sentDraft });
        } catch {
          // A response may be lost after commit. Read the canonical task once
          // while holding the task queue; never repeat the PATCH. Judge only
          // the fields the PATCH carried.
          try {
            const localTask = taskById(taskId);
            const observed = normalizeTask(await fetchTask(taskId));
            const sentFields = Object.keys(patch);
            if (taskDraftSaveCommitted(observed, sentDraft, sentFields)) {
              return applyTaskDraftSave(observed, { taskId, sentDraft });
            }
            if (localTask && taskDraftSaveConflicts(observed, localTask, sentFields)) {
              markTaskDraftConflict(observed, taskId);
              return false;
            }
          } catch { /* canonical outcome is still unknown/uncommitted */ }
          if (state.drawerTaskId === taskId) {
            setState({ taskDraftRecoveryReason: 'failed' });
            setTaskDraftStatusInPlace('Save failed');
            showToast(state.isTaskDraftStored
              ? 'Task save failed. The draft is kept on this device — retry when ready.'
              : 'Task save failed. Keep this drawer open and retry.');
          }
          return false;
        }
      });
    } finally {
      taskDraftSavePromise = null;
    }
  })();
  return taskDraftSavePromise;
}

async function flushTaskDrawerDraft() {
  clearTimeout(taskDraftSaveTimer);
  if (['recovered', 'conflict'].includes(state.taskDraftRecoveryReason)) return false;
  if (taskDraftSavePromise && !(await taskDraftSavePromise)) return false;
  if (state.isTaskNotesDirty) {
    const saved = await saveTaskDrawerDraft();
    if (!saved || state.isTaskNotesDirty) return false;
  }
  return true;
}

async function requestTaskDraftSave({ confirmed = false } = {}) {
  if (confirmed) return saveTaskDrawerDraft();
  const taskId = state.taskNotesDraftId;
  if (taskId && ['failed', 'recovered', 'conflict'].includes(state.taskDraftRecoveryReason)) {
    const localTask = taskById(taskId);
    const sentDraft = taskDraftSnapshot();
    // The retry would re-send only the fields diverging from the seeded
    // baseline — the saved copy is judged through those fields alone.
    const sentFields = taskDraftSentFields(sentDraft, state.taskDraftBaseline);
    setTaskDraftStatusInPlace('Checking saved copy...');
    try {
      const observed = normalizeTask(await fetchTask(taskId));
      if (taskDraftSaveCommitted(observed, sentDraft, sentFields)) {
        return applyTaskDraftSave(observed, { taskId, sentDraft });
      }
      if (localTask && taskDraftSaveConflicts(observed, localTask, sentFields)) {
        markTaskDraftConflict(observed, taskId);
      }
    } catch {
      setTaskDraftStatusInPlace('Could not verify saved copy');
      showToast('Could not verify the saved task, so Prax did not retry the write.');
      return false;
    }
  }
  if (state.taskDraftRecoveryReason === 'conflict') {
    openConfirm({
      message: 'The saved task changed after this draft began. Replace its text with the recovered draft?',
      okLabel: 'Replace saved text',
      action: 'retry-task-draft-save',
    });
    return false;
  }
  return saveTaskDrawerDraft();
}

// ---------------------------------------------------------------------------
// Board drag & drop (imperative during drag; full render only on drop)
// ---------------------------------------------------------------------------

function ensureDragIndicator() {
  if (!dragIndicator) {
    dragIndicator = document.createElement('div');
    dragIndicator.className = 'drop-ind';
  }
  return dragIndicator;
}

function clearDragChrome() {
  dragIndicator?.remove();
  appRoot?.querySelectorAll('.board-col.is-over').forEach(el => el.classList.remove('is-over'));
  appRoot?.querySelectorAll('.board-card.is-dragging').forEach(el => el.classList.remove('is-dragging'));
  setState({ dragTaskId: null, dragOverColumn: null, dragPos: null });
}

async function finishBoardDrop(designColumn, beforeTaskId, label) {
  const taskId = state.dragTaskId;
  clearDragChrome();
  if (!taskId) return;
  const { tasks: moved, updates } = moveTaskOnBoard(state.tasks, {
    taskId,
    targetStatus: apiStatus(designColumn),
    beforeTaskId,
  });
  if (!updates.length) { renderApp(); return; }
  setState({ tasks: moved, selectedTaskId: taskId, ...clearTaskBoardExtra(state, taskId) });
  renderApp();
  try {
    await reorderTasks(updates);
    showToast(`Moved to ${label}`);
  } catch {
    alertError('save the board move');
    await loadTasks();
    renderApp();
  }
}

function bindDragEvents() {
  appRoot.addEventListener('dragstart', (event) => {
    const card = event.target.closest?.('[data-board-card]');
    if (!card) return;
    setState({ dragTaskId: card.dataset.taskId });
    card.classList.add('is-dragging');
    try {
      event.dataTransfer.setData('text/plain', card.dataset.taskId);
      event.dataTransfer.effectAllowed = 'move';
    } catch { /* non-browser environments */ }
  });

  appRoot.addEventListener('dragover', (event) => {
    if (!state.dragTaskId) return;
    const column = event.target.closest?.('[data-board-column]');
    if (!column) return;
    event.preventDefault();
    appRoot.querySelectorAll('.board-col.is-over').forEach(el => el.classList.remove('is-over'));
    column.classList.add('is-over');
    const indicator = ensureDragIndicator();
    const card = event.target.closest('[data-board-card]');
    if (card && card.dataset.taskId !== state.dragTaskId) {
      const rect = card.getBoundingClientRect();
      const before = (event.clientY - rect.top) < rect.height / 2;
      if (before) card.parentNode.insertBefore(indicator, card);
      else card.parentNode.insertBefore(indicator, card.nextSibling);
      indicator.dataset.beforeId = before
        ? card.dataset.taskId
        : (card.nextElementSibling?.dataset?.taskId || '');
    } else if (!card) {
      column.appendChild(indicator);
      indicator.dataset.beforeId = '';
    }
  });

  appRoot.addEventListener('drop', (event) => {
    const column = event.target.closest?.('[data-board-column]');
    if (!column || !state.dragTaskId) return;
    event.preventDefault();
    const key = column.dataset.boardColumn;
    const beforeId = dragIndicator?.dataset?.beforeId || null;
    const label = column.querySelector('.board-col__head')?.textContent?.trim().replace(/\d+$/, '').trim() || key;
    finishBoardDrop(key, beforeId || null, label);
  });

  appRoot.addEventListener('dragend', () => clearDragChrome());
}

// ---------------------------------------------------------------------------
// Editor: draft lifecycle + CodeMirror
// ---------------------------------------------------------------------------

function currentDocument() {
  return state.documents.find(d => d.id === state.editorDocId) || null;
}

const documentLifecyclePending = new Set();
const documentLifecycleUncertain = new Set();

async function performDocumentLifecycleOnce(key, operation) {
  if (documentLifecycleUncertain.has(key)) {
    showToast('This document still has an unconfirmed lifecycle outcome. Reload before retrying.', null, 5000);
    return false;
  }
  if (documentLifecyclePending.has(key)) return false;
  documentLifecyclePending.add(key);
  try {
    return await operation();
  } finally {
    documentLifecyclePending.delete(key);
  }
}

function cacheLifecycleDocument(document, { remove = false } = {}) {
  if (!document?.id) return;
  const documents = (state.documents || []).filter(item => item.id !== document.id);
  if (!remove) documents.push(document);
  setState({ documents });
}

async function reconcileDocumentLifecycle({ id, intent, mutate }) {
  try {
    return { committed: true, document: await mutate(), outcome: 'committed' };
  } catch {
    let observed;
    try {
      observed = await fetchDocument(id);
    } catch (readError) {
      if (intent.type === 'delete' && readError?.status === 404) {
        observed = null;
      } else {
        return { committed: false, document: null, outcome: 'unknown' };
      }
    }
    if (documentMatchesLifecycle(observed, intent)) {
      return { committed: true, document: observed, outcome: 'reconciled' };
    }
    return { committed: false, document: observed, outcome: 'failed' };
  }
}

async function refreshLifecycleCollection(action, undo = null) {
  try {
    const applied = await loadDocuments();
    if (applied === false) throw new Error('stale collection refresh');
    return true;
  } catch {
    showToast(lifecycleOutcomeMessage(action, 'refresh-failed'), undo, undo ? 7000 : 5000);
    return false;
  }
}

function reportUncommittedLifecycle(action, outcome, documentId) {
  if (outcome === 'unknown' && documentId) {
    documentLifecycleUncertain.add(`document:${documentId}`);
  }
  showToast(outcome === 'unknown'
    ? lifecycleOutcomeMessage(action, 'unknown')
    : `Prax could not ${action.toLowerCase()}.`, null, 5000);
}

async function changeDocumentVerification(id, verified, { offerUndo = true } = {}) {
  let reviewedRevision = null;
  if (verified) {
    if (state.navType !== 'editor' || state.documentDraftId !== id) { await verifyHealthDoc(id); return false; }
    const reviewed = state.documentDraftBase;
    if (state.isDocumentDirty || documentSavePromise || !reviewed?.revision
      || documentDraftIsDirty(reviewed, { title: state.documentDraftTitle, body: state.documentDraftBody })) {
      showToast('Save the draft and review the saved content before verifying.');
      return false;
    }
    reviewedRevision = reviewed.revision;
  }
  const result = await reconcileDocumentLifecycle({
    id,
    intent: { type: 'verify', verified, revision: reviewedRevision },
    mutate: () => verifyDocument(id, verified, 'user', reviewedRevision),
  });
  if (!result.committed) {
    if (verified && result.document && result.document.revision !== reviewedRevision) {
      cacheLifecycleDocument(result.document);
      seedEditorDraft(result.document);
      destroyEditorController(); renderApp();
      showToast('The document changed. Review the current title and body before verifying again.', null, 7000);
    } else reportUncommittedLifecycle(verified ? 'Verify this document' : 'Unverify this document', result.outcome, id);
    return false;
  }
  cacheLifecycleDocument(result.document);
  renderApp();
  const undo = offerUndo ? async () => {
    dismissToast();
    await performDocumentLifecycleOnce(`document:${id}`, () => (
      changeDocumentVerification(id, !verified, { offerUndo: false })
    ));
  } : null;
  const action = verified ? 'Verification' : 'Unverification';
  if (!(await refreshLifecycleCollection(action, undo))) return true;
  const reconciled = lifecycleOutcomeMessage(action, result.outcome);
  showToast(reconciled || (verified ? 'Document verified' : 'Document unverified'), undo);
  return true;
}

async function restoreKnowledgeDocument(id) {
  const result = await reconcileDocumentLifecycle({
    id,
    intent: { type: 'restore' },
    mutate: () => restoreDocument(id),
  });
  if (!result.committed) {
    reportUncommittedLifecycle('Restore this document', result.outcome, id);
    return false;
  }
  const restoringOpenEditor = state.navType === 'editor' && state.editorDocId === id;
  const wasArchiveCollection = state.navType === 'library' && state.libraryView === 'archive';
  if (restoringOpenEditor) setState({ libraryView: 'active' });
  cacheLifecycleDocument(result.document, { remove: wasArchiveCollection });
  renderApp();
  if (!(await refreshLifecycleCollection('Restore'))) return true;
  showToast(lifecycleOutcomeMessage('Restore', result.outcome) || 'Document restored');
  return true;
}

async function archiveKnowledgeDocument(id, { offerUndo = true } = {}) {
  const result = await reconcileDocumentLifecycle({
    id,
    intent: { type: 'archive' },
    mutate: () => archiveDocument(id),
  });
  if (!result.committed) {
    reportUncommittedLifecycle('Archive this document', result.outcome, id);
    return false;
  }
  cacheLifecycleDocument(result.document, { remove: state.libraryView !== 'archive' });
  if (state.editorDocId === id) {
    destroyEditorController();
    setState({ navType: 'library', editorDocId: null, editorFocus: false, ...resetLibraryFilters() });
  }
  renderApp();
  const undo = offerUndo ? async () => {
    dismissToast();
    await performDocumentLifecycleOnce(`document:${id}`, () => (
      restoreKnowledgeDocument(id)
    ));
  } : null;
  if (!(await refreshLifecycleCollection('Archive', undo))) return true;
  showToast(lifecycleOutcomeMessage('Archive', result.outcome) || 'Document archived', undo);
  return true;
}

async function deleteKnowledgeDocument(id) {
  const result = await reconcileDocumentLifecycle({
    id,
    intent: { type: 'delete' },
    mutate: () => deleteDocumentPermanently(id),
  });
  if (!result.committed) {
    reportUncommittedLifecycle('Permanently delete this document', result.outcome, id);
    return false;
  }
  clearDocumentDraftRecovery(documentDraftStorage(), id);
  cacheLifecycleDocument({ id }, { remove: true });
  if (state.editorDocId === id) {
    destroyEditorController();
    setState({ navType: 'library', editorDocId: null, editorFocus: false });
  }
  renderApp();
  if (!(await refreshLifecycleCollection('Permanent deletion'))) return true;
  showToast(lifecycleOutcomeMessage('Permanent deletion', result.outcome) || 'Document permanently deleted');
  return true;
}

async function undoDocumentSupersession(predecessorId, replacementId) {
  try {
    await unlinkDocuments(replacementId, predecessorId, 'supersedes');
  } catch {
    try {
      const links = await fetchDocumentLinks(replacementId, 'outbound');
      const stillLinked = links.some(link => link.documentId === predecessorId && link.relation === 'supersedes');
      if (stillLinked) {
        showToast('Prax could not undo this supersession.');
        return false;
      }
    } catch {
      documentLifecycleUncertain.add(`document:${predecessorId}`);
      showToast(lifecycleOutcomeMessage('Undo supersession', 'unknown'), null, 5000);
      return false;
    }
  }
  const predecessor = await fetchDocument(predecessorId).catch(() => null);
  if (predecessor) cacheLifecycleDocument(predecessor);
  await loadDocumentLinks(predecessorId);
  renderApp();
  if (!(await refreshLifecycleCollection('Undo supersession'))) return true;
  showToast('Supersession undone');
  return true;
}

async function supersedeKnowledgeDocument(predecessorId, replacementId) {
  let result;
  try {
    result = { committed: true, document: await supersedeDocument(predecessorId, replacementId), outcome: 'committed' };
  } catch {
    try {
      const [predecessor, links] = await Promise.all([
        fetchDocument(predecessorId),
        fetchDocumentLinks(replacementId, 'outbound'),
      ]);
      const exactLink = links.some(link => link.documentId === predecessorId && link.relation === 'supersedes');
      result = documentMatchesLifecycle(predecessor, { type: 'supersede' }) && exactLink
        ? { committed: true, document: predecessor, outcome: 'reconciled' }
        : { committed: false, document: predecessor, outcome: 'failed' };
    } catch {
      result = { committed: false, document: null, outcome: 'unknown' };
    }
  }
  if (!result.committed) {
    if (result.outcome === 'unknown') setState({ isLinkPickerOpen: false });
    reportUncommittedLifecycle('Supersede this document', result.outcome, predecessorId);
    return false;
  }
  cacheLifecycleDocument(result.document);
  setState({ isLinkPickerOpen: false });
  renderApp();
  await loadDocumentLinks(predecessorId);
  renderApp();
  const undo = async () => {
    dismissToast();
    await performDocumentLifecycleOnce(`document:${predecessorId}`, () => (
      undoDocumentSupersession(predecessorId, replacementId)
    ));
  };
  if (!(await refreshLifecycleCollection('Supersession', undo))) return true;
  showToast(lifecycleOutcomeMessage('Supersession', result.outcome) || 'Document superseded', undo, 7000);
  return true;
}

function documentDraftStorage() {
  try { return window.localStorage; } catch { return null; }
}

// Resolve a [[wiki-link]] title to a non-archived document (case-insensitive),
// for the Markdown preview. Returns { id, title } or null (renders as "missing").
function resolveWikiLink(title) {
  const key = String(title || '').trim().toLowerCase();
  if (!key) return null;
  const doc = (state.documents || []).find(
    (d) => d && !d.archivedAt && String(d.title || '').trim().toLowerCase() === key,
  );
  return doc ? { id: doc.id, title: doc.title } : null;
}

// Non-archived documents (excluding the one being edited) offered as
// [[wiki-link]] autocomplete targets in the editor.
function wikiLinkDocuments() {
  return (state.documents || [])
    .filter((d) => d && !d.archivedAt && d.title && d.id !== state.editorDocId)
    .map((d) => ({ id: d.id, title: d.title }));
}

function seedEditorDraft(doc) {
  clearTimeout(documentAutosaveTimer);
  const storage = documentDraftStorage();
  const recovery = doc.archivedAt ? null : loadDocumentDraftRecovery(storage, doc.id);
  const resolved = resolveDocumentDraftRecovery(doc, recovery);
  if (resolved.clear) clearDocumentDraftRecovery(storage, doc.id);
  setState({
    editorDocId: doc.id,
    documentDraftId: doc.id,
    documentDraftBase: doc,
    documentDraftTitle: resolved.title,
    documentDraftBody: resolved.body,
    isDocumentDirty: resolved.isDirty,
    documentSaveStatus: resolved.status,
    documentDraftRecoveryReason: ['recovered', 'conflict'].includes(resolved.kind) ? resolved.kind : null,
    isDocumentDraftStored: true,
    documentLinks: null,
    documentExternalRefs: null,
    docInfoRefsSeed: null,
    documentTaskBacklinks: null,
    documentSimilar: null,
    documentRuns: null,
    isDocumentInfoEditorOpen: false,
    documentInfoError: '',
    // A new document starts with find/replace closed and cleared.
    editorSearchOpen: false,
    searchQuery: '',
    searchReplace: '',
    searchMatchInfo: { total: 0, current: 0, valid: true },
  });
}

// ---------------------------------------------------------------------------
// Editor find/replace — a Prax-native panel driving CodeMirror's search
// commands through the mounted controller. Managed by direct DOM insertion so
// CodeMirror is never remounted mid-search (renderApp would wipe its state).
// ---------------------------------------------------------------------------

let searchApplyTimer = null;

// Push the current query/options into CodeMirror and refresh the count. Safe to
// call after a remount — it re-applies from state, so search survives.
function applyCurrentSearch() {
  if (!documentEditorController?.applySearch) return;
  const info = documentEditorController.applySearch({
    search: state.searchQuery,
    replace: state.searchReplace,
    caseSensitive: state.searchCaseSensitive,
    regexp: state.searchRegexp,
    wholeWord: state.searchWholeWord,
  });
  setState({ searchMatchInfo: info });
  updateSearchCountDom();
}

function scheduleSearchApply() {
  clearTimeout(searchApplyTimer);
  searchApplyTimer = setTimeout(applyCurrentSearch, 90);
}

function updateSearchCountDom() {
  const el = appRoot?.querySelector('[data-search-count]');
  if (el) el.textContent = searchCountLabel(state);
}

// Reconcile the panel DOM with state.editorSearchOpen. Called from afterRender
// (a full render wipes the panel) and from open/close — never triggers renderApp.
function syncSearchPanelDom() {
  if (!appRoot) return;
  const existing = appRoot.querySelector('[data-editor-search]');
  const body = appRoot.querySelector('.editor-body');
  const wantOpen = state.navType === 'editor'
    && state.editorSearchOpen
    && Boolean(documentEditorController)
    && Boolean(body);
  if (!wantOpen) { existing?.remove(); return; }
  if (existing) return;
  body.insertAdjacentHTML('afterbegin', renderSearchPanelHtml(state));
  applyCurrentSearch();
  const find = appRoot.querySelector('[data-search-find]');
  find?.focus();
  find?.select();
}

function openEditorSearch() {
  if (state.navType !== 'editor' || !documentEditorController) return;
  const existing = appRoot.querySelector('[data-search-find]');
  if (existing) { existing.focus(); existing.select(); return; }
  // Seed the Find field from a one-line selection, like most editors.
  const selected = documentEditorController.getSelectionText?.() || '';
  const query = selected && !selected.includes('\n') ? selected : state.searchQuery;
  setState({ editorSearchOpen: true, searchQuery: query });
  syncSearchPanelDom();
}

function closeEditorSearch() {
  documentEditorController?.clearSearch?.();
  setState({ editorSearchOpen: false, searchMatchInfo: { total: 0, current: 0, valid: true } });
  syncSearchPanelDom();
  documentEditorController?.focus?.();
}

// next | previous | replace | replace-all — call the controller, refresh count.
// Replace commands mutate the doc, which fires onChange → draft autosave (that
// path never renderApps while the edit surface is live), so the panel persists.
function runSearchCommand(kind) {
  if (!documentEditorController) return;
  let info;
  if (kind === 'previous') info = documentEditorController.searchPrevious();
  else if (kind === 'replace') info = documentEditorController.replaceMatch();
  else if (kind === 'replace-all') info = documentEditorController.replaceAllMatches();
  else info = documentEditorController.searchNext();
  setState({ searchMatchInfo: info });
  updateSearchCountDom();
}

function toggleSearchOption(key, el) {
  setState({ [key]: !state[key] });
  el?.classList.toggle('is-on', state[key]);
  el?.setAttribute('aria-pressed', String(state[key]));
  applyCurrentSearch();
}

function setSaveStatusInPlace(status) {
  setState({ documentSaveStatus: status });
  const el = appRoot?.querySelector('[data-document-save-status]');
  if (el) el.textContent = status;
  const action = appRoot?.querySelector('[data-document-save-action]');
  if (action) {
    const reason = state.documentDraftRecoveryReason;
    action.hidden = !['failed', 'recovered', 'conflict'].includes(reason);
    action.disabled = status === 'Saving...' || status === 'Autosaving...';
    action.textContent = reason === 'conflict'
      ? 'Review and save'
      : (reason === 'recovered' ? 'Save recovered draft' : 'Retry');
  }
}

function handleDocumentDraftChange({ title = state.documentDraftTitle, body = state.documentDraftBody } = {}) {
  const doc = state.documentDraftBase || currentDocument();
  const draft = { title: String(title ?? ''), body: String(body ?? '') };
  const dirty = documentDraftIsDirty(doc, draft);
  const storage = documentDraftStorage();
  const stored = dirty
    ? storeDocumentDraftRecovery(storage, { document: doc, ...draft, conflict: state.documentDraftRecoveryReason === 'conflict' })
    : clearDocumentDraftRecovery(storage, doc?.id);
  const protectedRecovery = dirty && ['recovered', 'conflict'].includes(state.documentDraftRecoveryReason);
  setState({
    documentDraftTitle: draft.title,
    documentDraftBody: draft.body,
    isDocumentDirty: dirty,
    documentDraftRecoveryReason: protectedRecovery ? state.documentDraftRecoveryReason : null,
    isDocumentDraftStored: dirty ? stored : true,
  });
  setSaveStatusInPlace(dirty
    ? (protectedRecovery ? state.documentSaveStatus : (stored ? 'Unsaved changes' : 'Unsaved — keep this tab open'))
    : 'Saved');
  if (!dirty || protectedRecovery) clearTimeout(documentAutosaveTimer);
  else scheduleDocumentAutosave();
}

function handleDocumentDraftBodyChange(value) {
  handleDocumentDraftChange({ body: value });
  const counts = appRoot?.querySelector('[data-editor-counts]');
  if (counts) {
    const words = value.split(/\s+/).filter(Boolean).length;
    counts.textContent = `${words} words · ${value.length} characters · ${Math.max(1, Math.round(words / 200))} min read`;
  }
  updateDocumentLivePreview(appRoot, value, { resolveWikiLink });
}

function handleDocumentDraftTitleChange(value) {
  handleDocumentDraftChange({ title: value });
}

function scheduleDocumentAutosave() {
  clearTimeout(documentAutosaveTimer);
  documentAutosaveTimer = setTimeout(() => {
    if (state.isDocumentDirty && !['recovered', 'conflict'].includes(state.documentDraftRecoveryReason)) {
      setSaveStatusInPlace('Autosaving...');
      saveDocumentDraft({ status: null });
    }
  }, DOCUMENT_AUTOSAVE_DELAY_MS);
}

function applyDocumentDraftSave(saved, { draftId, sentDraft }) {
  const stillActive = state.editorDocId === draftId && state.documentDraftId === draftId;
  const patch = documentDraftSavedPatch({
    documents: state.documents,
    savedDocument: saved,
    activeDocumentId: stillActive ? draftId : null,
  });
  const liveDraft = {
    title: state.documentDraftTitle === sentDraft.title ? saved.title : state.documentDraftTitle,
    body: state.documentDraftBody === sentDraft.body ? saved.body : state.documentDraftBody,
  };
  if (stillActive) patch.documentDraftBase = saved;
  if (stillActive && documentDraftIsDirty(saved, liveDraft)) {
    // The user kept typing while the PATCH was in flight. Rebase the newer
    // recovery record onto the acknowledged version and save it next.
    patch.documentDraftTitle = liveDraft.title;
    patch.documentDraftBody = liveDraft.body;
    patch.isDocumentDirty = true;
    patch.documentSaveStatus = 'Unsaved changes';
    patch.documentDraftRecoveryReason = null;
    patch.isDocumentDraftStored = storeDocumentDraftRecovery(documentDraftStorage(), {
      document: saved,
      ...liveDraft,
    });
    scheduleDocumentAutosave();
  } else {
    clearDocumentDraftRecovery(documentDraftStorage(), draftId, sentDraft);
  }
  setState(patch);
  if (stillActive) {
    setSaveStatusInPlace(patch.documentSaveStatus);
    const title = appRoot?.querySelector('[data-doc-title]');
    if (title && title.value !== patch.documentDraftTitle) title.value = patch.documentDraftTitle;
    // A safe merge can bring in a remote body while only the title was edited.
    // Refresh that editor alone, leaving a live title input and its caret intact.
    if (documentEditorController && documentEditorController.getValue() !== patch.documentDraftBody) {
      const focused = appRoot?.querySelector('[data-code-editor]')?.contains(document.activeElement);
      destroyEditorController();
      const fallback = appRoot?.querySelector('[data-document-editor]');
      if (fallback) fallback.value = patch.documentDraftBody;
      mountEditorIfNeeded();
      if (focused) documentEditorController?.focus();
    }
    updateDocumentLivePreview(appRoot, patch.documentDraftBody, { resolveWikiLink });
  }
  // The fallback textarea preserves the caret exactly like CodeMirror does —
  // either way, re-rendering mid-typing would destroy the edit surface and
  // leak keystrokes to the global shortcuts.
  const editSurface = Boolean(documentEditorController)
    || Boolean(appRoot?.querySelector('[data-document-editor]:not([hidden])'));
  if (stillActive && !canPreserveEditorAfterDraftSave({
    editorExists: editSurface,
    savedDocumentId: saved.id,
    selectedDocumentId: state.editorDocId,
    documentDraftId: state.documentDraftId,
  })) {
    renderApp();
  }
  return true;
}

async function saveDocumentDraft({ status = 'Saving...' } = {}) {
  const draftId = state.documentDraftId;
  if (!draftId || !state.isDocumentDirty) return true;
  if (documentSavePromise) return documentSavePromise;
  const sentDraft = {
    title: state.documentDraftTitle,
    body: state.documentDraftBody,
  };
  if (status) setSaveStatusInPlace(status);
  const initialBase = state.documentDraftBase || currentDocument();
  documentSavePromise = (async () => {
    let base = initialBase, targetDraft = sentDraft;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const payload = documentDraftPatch(base, targetDraft);
        if (Object.keys(payload).length === 1) return applyDocumentDraftSave(base, { draftId, sentDraft });
        try {
          const saved = await updateDocument(draftId, payload);
          return applyDocumentDraftSave(saved, { draftId, sentDraft });
        } catch (error) {
          if (error.status !== 409 || !error.document) throw error;
          const merged = mergeDocumentDraft(base, targetDraft, error.document);
          if (merged.conflicts.length || attempt === 2) throw error;
          base = error.document;
          targetDraft = merged.draft;
        }
      }
    } catch (error) {
      let observed = error.document;
      if (!observed) { try { observed = await fetchDocument(draftId); } catch {} }
      if (observed) {
        const merged = mergeDocumentDraft(initialBase, sentDraft, observed);
        if (!merged.conflicts.length && !documentDraftIsDirty(observed, merged.draft)) {
          return applyDocumentDraftSave(observed, { draftId, sentDraft });
        }
      }
      if (state.editorDocId === draftId) {
        const conflict = error.status === 409 && observed;
        if (conflict) {
          const live = mergeDocumentDraft(initialBase, { title: state.documentDraftTitle, body: state.documentDraftBody }, observed).draft;
          cacheLifecycleDocument(observed);
          setState({ documentDraftBase: observed, documentDraftTitle: live.title, documentDraftBody: live.body, isDocumentDirty: true, documentDraftRecoveryReason: 'conflict', isDocumentDraftStored: storeDocumentDraftRecovery(documentDraftStorage(), { document: observed, ...live, conflict: true }) });
          destroyEditorController();
          renderApp();
          setSaveStatusInPlace('Conflict — review your draft');
          showToast('The saved document changed. Your draft is kept; review it before replacing the saved copy.', null, 7000);
        } else {
          setState({ documentDraftRecoveryReason: 'failed' });
          setSaveStatusInPlace('Save failed');
          showToast(state.isDocumentDraftStored ? 'Save could not be confirmed. Your draft is kept — retry when ready.' : 'Save could not be confirmed. Keep this tab open and retry.');
        }
      }
      return false;
    } finally { documentSavePromise = null; }
  })();
  return documentSavePromise;
}

async function flushDocumentDraftBeforeNavigation(targetDocumentId) {
  clearTimeout(documentAutosaveTimer);
  if (state.documentDraftId === targetDocumentId) return true;
  if (['recovered', 'conflict'].includes(state.documentDraftRecoveryReason)) return false;
  if (documentSavePromise && !(await documentSavePromise)) return false;
  // Content may have changed while the first request was in flight. Flush the
  // newest draft too before allowing the editor context to switch.
  if (state.isDocumentDirty && state.documentDraftId !== targetDocumentId) {
    const saved = await saveDocumentDraft();
    if (!saved || state.isDocumentDirty) return false;
  }
  return true;
}

// One boundary for every action that replaces the editor with another view.
// A failed/recovered/conflicting draft stays in its original context with the
// existing explicit recovery control instead of being abandoned behind the
// destination view.
async function prepareEditorNavigation(targetDocumentId = null) {
  if (state.navType !== 'editor') return true;
  const saved = await flushDocumentDraftBeforeNavigation(targetDocumentId);
  if (saved) return true;
  showToast(['recovered', 'conflict'].includes(state.documentDraftRecoveryReason)
    ? 'Review and save the recovered draft before leaving this document.'
    : 'Save this document before leaving it.');
  return false;
}

async function requestDocumentDraftSave({ confirmed = false } = {}) {
  if (state.documentDraftRecoveryReason === 'conflict' && !confirmed) {
    openConfirm({
      message: 'The saved copy changed after this draft began. Replace it with the recovered draft?',
      okLabel: 'Replace saved copy',
      action: 'retry-document-save',
    });
    return false;
  }
  return saveDocumentDraft();
}

function destroyEditorController() {
  documentEditorController?.destroy?.();
  documentEditorController = null;
}

function mountEditorIfNeeded() {
  if (state.navType !== 'editor') {
    destroyEditorController();
    return;
  }
  const host = appRoot.querySelector('[data-code-editor]');
  const fallback = appRoot.querySelector('[data-document-editor]');
  if (!host) { destroyEditorController(); return; }
  if (documentEditorController) return;
  try {
    documentEditorController = mountCodeMirrorEditor({
      host,
      value: state.documentDraftBody,
      lineNumbers: Boolean(state.preferences.lineNumbers),
      cursorToEnd: true,
      documentsProvider: wikiLinkDocuments,
      onChange: (value) => {
        if (fallback) fallback.value = value;
        handleDocumentDraftBodyChange(value);
      },
      onSave: () => requestDocumentDraftSave(),
    });
  } catch (err) {
    // A CodeMirror failure must never break the app — the recovery textarea
    // keeps editing working.
    console.warn('CodeMirror failed to mount; using the textarea fallback', err);
    documentEditorController = null;
  }
  if (documentEditorController) {
    host.hidden = false;
    if (fallback) fallback.hidden = true;
    // Restore a selection carried over the re-mount (keeps the ✦ AI menu's target
    // highlighted and live-readable). Guard the offsets against a shorter buffer.
    if (pendingEditorSelection && documentEditorController.setSelectionRange) {
      const len = (state.documentDraftBody || '').length;
      const from = Math.min(pendingEditorSelection.from, len);
      const to = Math.min(pendingEditorSelection.to, len);
      if (to > from) documentEditorController.setSelectionRange(from, to);
    }
  } else if (fallback) {
    fallback.hidden = false;
  }
  pendingEditorSelection = null;
}

function focusEditor() {
  if (documentEditorController?.focus) {
    documentEditorController.focus();
    return;
  }
  const textarea = appRoot.querySelector('[data-document-editor]:not([hidden])');
  if (textarea) {
    textarea.focus();
    // Continue the document rather than typing above the heading.
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }
}

function applyEditorFormat(action) {
  if (documentEditorController) {
    documentEditorController.applyFormat(action);
    return;
  }
  const textarea = appRoot.querySelector('[data-document-editor]');
  if (!textarea) return;
  const result = applyMarkdownFormat(textarea.value, textarea.selectionStart, textarea.selectionEnd, action);
  textarea.value = result.value;
  textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  textarea.focus();
  handleDocumentDraftBodyChange(result.value);
}

// ---- editor AI writing actions (Tier-3 #7) --------------------------------

const WRITE_LABELS = Object.fromEntries(WRITE_ACTIONS);
// Bumped on every run/close/navigation so a request that resolves after the
// user cancelled (or started another) is dropped instead of resurrecting the
// overlay. Mirrors aiReviewToken.
let writeToken = 0;

function currentEditorDoc() {
  return state.documents.find((d) => d.id === state.editorDocId) || null;
}

// Run a writing action over the selection (if any) or the whole document, then
// open the preview overlay. Nothing touches the document until the human applies.
async function runWrite(action) {
  if (!WRITE_LABELS[action] || state.navType !== 'editor') return;
  const doc = currentEditorDoc();
  const body = state.documentDraftBody || '';
  // Selection was captured when the menu opened (see toggle-write-menu); fall
  // back to a live read for any programmatic caller.
  const stash = state.writeSelection || null;
  const range = stash ? { from: stash.from, to: stash.to } : (documentEditorController?.getSelectionRange?.() || null);
  const rawSel = stash ? stash.text : String(documentEditorController?.getSelectionText?.() || '');
  const selText = rawSel.trim() ? rawSel : '';
  let payload;
  let mode;
  let verb;
  let selStart = null;
  let selEnd = null;
  if (action === 'draft') {
    payload = { action, title: doc?.title || '', documentType: doc?.documentType || '' };
    mode = 'whole';
    verb = body.trim() ? 'Replace document' : 'Insert draft';
  } else if (action === 'summarize') {
    const source = selText || body;
    if (!source.trim()) { showToast('Nothing to summarize — the document is empty.'); setState({ writeMenuOpen: false, writeSelection: null }); renderApp(); return; }
    payload = { action, text: source };
    mode = 'prepend';
    verb = 'Insert summary at top';
  } else { // rewrite | checklist
    const useSel = Boolean(selText);
    if (!useSel && !body.trim()) { showToast(`Nothing to ${action === 'checklist' ? 'convert' : 'rewrite'} — the document is empty.`); setState({ writeMenuOpen: false, writeSelection: null }); renderApp(); return; }
    payload = { action, text: useSel ? selText : body };
    mode = useSel ? 'selection' : 'whole';
    verb = useSel ? 'Replace selection' : 'Replace document';
    if (useSel && range) { selStart = range.from; selEnd = range.to; }
  }
  const token = (writeToken += 1);
  setState({
    writeMenuOpen: false, writeSelection: null,
    writeContext: { action, label: WRITE_LABELS[action], verb, mode, docId: state.editorDocId, selText: mode === 'selection' ? selText : '', selStart, selEnd, model: null },
    writeResult: null, writeLoading: true, writeError: null,
  });
  renderApp();
  try {
    const res = await runWritingAction(payload);
    if (token !== writeToken) return; // cancelled or superseded
    if (res.degraded) {
      setState({ writeLoading: false, writeError: res.reason === 'no-chat-model' ? 'No AI model configured — set one in Settings ▸ Intelligence.' : 'The model could not complete this. Try again.' });
    } else {
      setState({ writeLoading: false, writeResult: res.text, writeContext: { ...state.writeContext, model: res.model } });
    }
  } catch {
    if (token !== writeToken) return;
    setState({ writeLoading: false, writeError: 'Could not run the writing action.' });
  }
  if (token === writeToken) renderApp();
}

function closeWrite() {
  writeToken += 1; // invalidate any in-flight request
  setState({ writeContext: null, writeResult: null, writeLoading: false, writeError: null, writeSelection: null });
  renderApp();
}

// Apply the generated text to the editor buffer (dirty, not saved) per the mode.
function applyWrite() {
  const ctx = state.writeContext;
  const text = state.writeResult;
  if (!ctx || !text) return;
  // Guard against applying to a document the user navigated away from.
  if (ctx.docId && ctx.docId !== state.editorDocId) { showToast('You left the document — nothing was applied.'); closeWrite(); return; }
  const body = state.documentDraftBody || '';
  let next;
  if (ctx.mode === 'prepend') {
    next = body.trim() ? `${text.trim()}\n\n${body}` : text.trim();
  } else if (ctx.mode === 'selection') {
    // Prefer the exact recorded offsets (correct even when the selected text
    // repeats in the body). Splice, never String.replace, so `$` sequences in
    // the AI output are inserted literally rather than expanded.
    if (Number.isInteger(ctx.selStart) && Number.isInteger(ctx.selEnd) && body.slice(ctx.selStart, ctx.selEnd) === ctx.selText) {
      next = body.slice(0, ctx.selStart) + text + body.slice(ctx.selEnd);
    } else if (ctx.selText && body.includes(ctx.selText)) {
      next = body.replace(ctx.selText, () => text); // function replacer: no $-pattern expansion
    } else {
      showToast('The selected text changed — could not apply.'); closeWrite(); return;
    }
  } else {
    next = text; // whole
  }
  writeToken += 1;
  setState({ writeContext: null, writeResult: null, writeLoading: false, writeError: null });
  destroyEditorController();
  handleDocumentDraftBodyChange(next);
  renderApp();
  showToast('Applied — review and save');
}

async function copyWrite() {
  const ok = await copyToClipboard(state.writeResult || '');
  showToast(ok ? 'Copied' : 'Could not copy');
}

function toggleMarkdownCheck(line) {
  const lines = state.documentDraftBody.split('\n');
  const current = lines[line] || '';
  if (/^(\s*[-*]\s+)\[ \]/.test(current)) lines[line] = current.replace('[ ]', '[x]');
  else if (/^(\s*[-*]\s+)\[[xX]\]/.test(current)) lines[line] = current.replace(/\[[xX]\]/, '[ ]');
  else return;
  const value = lines.join('\n');
  destroyEditorController();
  handleDocumentDraftBodyChange(value);
  renderApp();
}

async function openDocumentInEditor(documentId) {
  if (state.navType === 'editor' && state.editorDocId === documentId) return true;
  if (!(await prepareEditorNavigation(documentId))) return false;
  destroyEditorController();
  let doc = state.documents.find(d => d.id === documentId);
  if (!doc) {
    setState({ libraryView: 'active' });
    await loadDocuments();
    doc = state.documents.find(d => d.id === documentId);
  }
  if (!doc) { alertError('open that document'); return false; }
  seedEditorDraft(doc);
  writeToken += 1; // drop any in-flight writing action from a previous doc
  setState({ navType: 'editor', editorFocus: false, writeMenuOpen: false, writeSelection: null, writeContext: null, writeResult: null, writeLoading: false, writeError: null });
  renderApp();
  loadDocumentContext(doc);
  return true;
}

// ---------------------------------------------------------------------------
// "Ask Prax" — grounded, cited answers over the library
// ---------------------------------------------------------------------------

function openAskPrax() {
  // Keep the last query (handy to re-run) but clear any prior answer.
  askPraxToken += 1;
  setState({ askPraxOpen: true, askPraxResult: null, askPraxError: false, askPraxLoading: false, paletteOpen: false });
  renderApp();
}

function closeAskPrax() {
  askPraxToken += 1;
  setState({ askPraxOpen: false, askPraxLoading: false });
  renderApp();
}

async function runAskPrax(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return;
  const token = (askPraxToken += 1);
  const isCurrent = () => token === askPraxToken
    && state.askPraxOpen
    && state.askPraxQuery === query;
  setState({ askPraxQuery: query, askPraxLoading: true, askPraxError: false, askPraxResult: null });
  renderApp();
  try {
    const result = await askPrax(query, 'all');
    if (!isCurrent()) return;
    setState({ askPraxLoading: false, askPraxResult: result });
  } catch {
    if (!isCurrent()) return;
    setState({ askPraxLoading: false, askPraxError: true });
  }
  renderApp();
}

async function copyAskPrax() {
  const r = state.askPraxResult;
  if (!r) return;
  const text = (typeof r.answer === 'string' && r.answer.trim()) ? r.answer : (r.markdown || '');
  if (!text) return;
  const ok = await copyToClipboard(text);
  showToast(ok ? 'Answer copied' : 'Could not copy');
}

function openGenerateRunbook() {
  const projects = captureProjectChoices().filter((p) => p.slug !== INBOX_SLUG);
  setState({ genRbOpen: true, genRbLoading: false, genRbError: false, genRbDescription: '', genRbProject: projects[0]?.id || null, paletteOpen: false });
  renderApp();
}

async function runGenerateRunbook() {
  const description = String(appRoot.querySelector('[data-genrb-input]')?.value || '').trim();
  const project = appRoot.querySelector('[data-genrb-project]')?.value || '';
  if (!description) { setState({ genRbError: 'Describe the alert or incident first.' }); renderApp(); return; }
  if (!project) { setState({ genRbError: 'Pick a project for the runbook.' }); renderApp(); return; }
  setState({ genRbLoading: true, genRbError: false, genRbDescription: description, genRbProject: project });
  renderApp();
  try {
    const res = await generateRunbook(description, project);
    setState({ genRbOpen: false, genRbLoading: false });
    showToast('Runbook drafted — review, edit, and verify');
    await openDocumentInEditor(res.document.id); // open the agent-written draft for review
  } catch (err) {
    setState({ genRbLoading: false, genRbError: err?.message || 'Could not generate the runbook.' });
    renderApp();
  }
}

// ---------------------------------------------------------------------------
// Runbook execution (runs)
// ---------------------------------------------------------------------------

// Snapshot the runbook's checkbox steps into a fresh run and open the run view.
// The run is a chronicle: checking a step stamps a time without touching the doc.
async function startRunForDocument(documentId) {
  if (state.runStartPending) return;
  const doc = state.documents.find((d) => d.id === documentId) || currentDocument();
  if (!doc) { alertError('start a run'); return; }
  const priorIntent = state.runStartIntent;
  const intent = priorIntent?.documentId === doc.id
    ? priorIntent
    : { id: crypto.randomUUID(), documentId: doc.id, title: '' };
  setState({ runStartPending: true, runStartIntent: intent });
  renderApp();
  // A run snapshots the persisted checkbox steps. Flush the current draft so
  // the chronicle cannot start from an older revision than the one on screen.
  if (!(await prepareEditorNavigation())) {
    setState({ runStartPending: false });
    renderApp();
    return;
  }
  let run;
  let recovered = false;
  try {
    run = await startRun(doc.id, intent.title, intent.id);
  } catch (writeError) {
    try {
      const canonical = await fetchRun(intent.id);
      if (runMatchesStartIntent(canonical, intent)) {
        run = canonical;
        recovered = true;
      } else {
        setState({ runStartPending: false });
        renderApp();
        showToast(writeError?.message || 'Run did not start. Retry uses the same safe identity.');
        return;
      }
    } catch (readError) {
      setState({ runStartPending: false });
      renderApp();
      const message = readError?.status === 404
        ? 'Run did not start. Retry is safe and will reuse the same identity.'
        : 'Could not confirm whether the run started. Retry is safe and cannot create a duplicate.';
      showToast(message, null, 7000);
      return;
    }
  }
  setState({
    navType: 'run',
    editorFocus: false,
    activeRun: run,
    runReturnDocId: doc.id,
    runStartPending: false,
    runStartIntent: null,
    runMutationPending: false,
    docMenuOpen: false,
  });
  renderApp();
  if (recovered) showToast('Run started — confirmed after the response was lost');
  if (!run.steps || run.steps.length === 0) showToast('This runbook has no checkbox steps yet — add “- [ ] step” lines.');
}

async function openRun(runId, returnDocId) {
  if (!(await prepareEditorNavigation())) return;
  try {
    const run = await fetchRun(runId);
    setState({
      navType: 'run',
      editorFocus: false,
      activeRun: run,
      runReturnDocId: returnDocId || run.documentId,
      runMutationPending: false,
    });
    renderApp();
  } catch { alertError('open that run'); }
}

function applyRunMutationResponse(runId, response, intent) {
  const current = state.activeRun;
  if (!current || current.id !== runId) return;
  if (intent.type === 'step') {
    const steps = current.steps.map((step) => (step.id === intent.stepId
      ? { ...step, checkedAt: response.checkedAt, checkedBy: response.checkedBy }
      : step));
    setState({ activeRun: { ...current, steps } });
  } else {
    setState({ activeRun: {
      ...current,
      status: response.status,
      finishedAt: response.finishedAt,
      finishedBy: response.finishedBy,
    } });
  }
}

// Run writes are deliberately followed by a canonical read. The PATCH response
// proves a commit, but only GET carries the complete event ledger; a rejected
// PATCH may also be a lost response after commit.
function queueRunMutation(runId, { write, intent, successMessage = '' }) {
  pendingRunMutationCount += 1;
  setState({ runMutationPending: true });
  renderApp();
  return enqueueRunMutation(runId, async () => {
    let response;
    let writeError = null;
    try {
      response = await write();
    } catch (error) {
      writeError = error;
    }

    try {
      const canonical = await fetchRun(runId);
      const matches = intent.type === 'step'
        ? runMatchesStepIntent(canonical, intent.stepId, intent.checked)
        : runMatchesStatusIntent(canonical, intent.status);
      if (state.activeRun?.id === runId) setState({ activeRun: canonical });
      if (writeError && !matches) {
        showToast(writeError.message || 'The run did not change.');
      } else if (writeError) {
        showToast(`${successMessage || 'Run updated'} — confirmed after the response was lost`);
      } else if (successMessage) {
        showToast(successMessage);
      }
    } catch {
      if (writeError) {
        showToast('Could not confirm the run change. Retry is safe and will not duplicate the event.', null, 7000);
      } else {
        applyRunMutationResponse(runId, response, intent);
        showToast('Run updated, but the chronicle could not refresh. Reopen the run to reload it.', null, 7000);
      }
    }
  }).finally(() => {
    pendingRunMutationCount = Math.max(0, pendingRunMutationCount - 1);
    setState({ runMutationPending: pendingRunMutationCount > 0 });
    renderApp();
  });
}

function toggleRunStep(stepId, nowChecked) {
  const run = state.activeRun;
  if (!run || run.status !== 'running') return Promise.resolve();
  return queueRunMutation(run.id, {
    intent: { type: 'step', stepId, checked: nowChecked },
    write: () => setRunStep(run.id, stepId, nowChecked),
  });
}

function endRun(status) {
  const run = state.activeRun;
  if (!run) return Promise.resolve();
  setState({ confirm: null });
  const label = status === 'completed' ? 'Run completed' : (status === 'aborted' ? 'Run aborted' : 'Run resumed');
  return queueRunMutation(run.id, {
    intent: { type: 'status', status },
    write: () => setRunStatus(run.id, status),
    successMessage: label,
  });
}

async function copyRunChronicle() {
  const run = state.activeRun;
  if (!run) return;
  const doc = (state.documents || []).find((d) => d.id === run.documentId);
  const ok = await copyToClipboard(buildChronicle(run, run.documentTitle || doc?.title || ''));
  showToast(ok ? 'Chronicle copied' : 'Could not copy chronicle');
}

async function generatePostMortem(runId) {
  if (!runId || state.postMortemLoading) return;
  setState({ postMortemLoading: true });
  renderApp();
  try {
    const res = await createPostMortem(runId);
    setState({ postMortemLoading: false });
    showToast(res.generated ? 'Post-mortem drafted — review & verify' : 'Draft created (no AI model) — fill in the narrative');
    // Open the new agent-written doc so the human can review + verify it.
    await openDocumentInEditor(res.document.id);
  } catch {
    setState({ postMortemLoading: false });
    renderApp();
    showToast('Could not generate the post-mortem');
  }
}

async function backFromRun() {
  const docId = state.runReturnDocId || state.activeRun?.documentId;
  setState({ activeRun: null });
  if (docId && await openDocumentInEditor(docId)) return;
  await goLibrary();
}

// ---------------------------------------------------------------------------
// Library helpers
// ---------------------------------------------------------------------------

// Toast line after a permanent project delete, from the server's summary of
// what went with it: `Project “X” deleted (3 tasks, 2 documents)`.
function deletedProjectMessage(result) {
  const parts = [];
  const tasks = result?.deleted?.tasks || 0;
  const documents = result?.deleted?.documents || 0;
  if (tasks) parts.push(`${tasks} task${tasks === 1 ? '' : 's'}`);
  if (documents) parts.push(`${documents} document${documents === 1 ? '' : 's'}`);
  const name = result?.name ? `Project “${result.name}”` : 'Project';
  return parts.length ? `${name} deleted (${parts.join(', ')})` : `${name} deleted`;
}

const INBOX_SLUG = 'inbox';
function inboxProject() {
  return (state.projects || []).find((p) => p.slug === INBOX_SLUG) || null;
}
function inboxProjectId() {
  return inboxProject()?.id || null;
}

function todayISODate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function defaultProjectId() {
  if (state.navType === 'project' && state.navId) return state.navId;
  return inboxProjectId() || state.projects[0]?.id || null;
}

// Context-derived capture defaults: destination + due/status reflect the view
// you're in, so a new task lands where you'd expect — a project view targets
// that project; Today targets Inbox and pre-sets a due-today; a Backlog tab
// pre-sets backlog status; everything else falls to Inbox.
function captureDefaults() {
  const fromProject = state.navType === 'project' ? state.navId : null;
  const onBacklog = state.navType === 'project' && state.tab === 'backlog';
  return {
    captureProjectId: fromProject || inboxProjectId() || state.projects[0]?.id || null,
    captureDueDate: state.navType === 'today' ? todayISODate() : null,
    captureStatus: onBacklog ? 'backlog' : 'planned',
    captureMenuOpen: false,
  };
}

function taskCaptureStorage() {
  try { return window.localStorage; } catch { return null; }
}

function captureRecoveryDraft() {
  return {
    query: state.captureQuery,
    projectId: state.captureProjectId,
    dueDate: state.captureDueDate,
    status: state.captureStatus,
    nlFields: state.nlCaptureFields,
    nlDropped: state.nlCaptureDropped,
    nlRaw: state.nlCaptureRaw,
    requestPayload: state.captureRequestPayload,
    requestIntent: state.captureRequestIntent,
  };
}

function persistCaptureRecovery(options) {
  return storeTaskCaptureRecovery(taskCaptureStorage(), captureRecoveryDraft(), options);
}

function clearCaptureRequestPatch() {
  return {
    captureRequestPayload: null,
    captureRequestIntent: null,
    captureError: null,
    captureRecovered: false,
  };
}

function openFreshCapture() {
  if (state.captureSubmitting) return false;
  captureReturnElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // Owner-guarded (no force): starting fresh HERE is not a verdict on a draft
  // another tab is still typing — only this tab's own leftover is dropped.
  clearTaskCaptureRecovery(taskCaptureStorage());
  setState({
    captureOpen: true,
    captureQuery: '',
    captureSubmitting: false,
    paletteOpen: false,
    ...captureDefaults(),
    ...clearCaptureRequestPatch(),
    ...nlCaptureResetPatch(),
  });
  renderCaptureOverlayLayer();
  return true;
}

function discardCapture() {
  if (state.captureSubmitting) return false;
  // force only when THIS tab displays capture content the user is throwing
  // away (typed text, a parsed preview, a restored recovery, or a pending
  // retry identity) — a restored draft may still carry a stale owner stamp
  // that an owner-guarded clear would resurrect. Closing an EMPTY capture
  // (Esc, palette, assistant) expresses no verdict on another tab's stored
  // draft, so that clear stays owner-guarded.
  const displaysDraft = Boolean(state.captureQuery
    || state.nlCaptureFields || state.captureRecovered || state.captureRequestPayload);
  clearTaskCaptureRecovery(taskCaptureStorage(), { force: displaysDraft });
  setState({
    captureOpen: false,
    captureQuery: '',
    captureMenuOpen: false,
    captureSubmitting: false,
    ...clearCaptureRequestPatch(),
    ...nlCaptureResetPatch(),
  });
  return true;
}

function restoreCaptureRecovery() {
  const recovery = loadTaskCaptureRecovery(taskCaptureStorage());
  if (!recovery) return false;
  if (recovery.requestPayload) {
    const observed = state.tasks.find(task => task.id === recovery.requestPayload.id);
    if (taskMatchesCreatePayload(observed, recovery.requestPayload)) {
      // force: the stored payload was confirmed created — it is stale for
      // every tab, and its owner token predates this reload anyway.
      clearTaskCaptureRecovery(taskCaptureStorage(), { force: true });
      showToast('Task was added before reload.');
      return false;
    }
  }
  const knownProjects = new Set((state.projects || []).map(project => project.id));
  const projectId = knownProjects.has(recovery.projectId)
    ? recovery.projectId
    : (inboxProjectId() || state.projects[0]?.id || null);
  const requestProject = recovery.requestPayload?.project;
  const keepRequest = !requestProject || knownProjects.has(requestProject);
  setState({
    captureOpen: true,
    captureQuery: recovery.query,
    captureProjectId: projectId,
    captureDueDate: recovery.dueDate,
    captureStatus: recovery.status === 'backlog' ? 'backlog' : 'planned',
    captureMenuOpen: false,
    captureSubmitting: false,
    captureError: 'Recovered unfinished task.',
    captureRecovered: true,
    captureRequestPayload: keepRequest ? recovery.requestPayload : null,
    captureRequestIntent: keepRequest ? recovery.requestIntent : null,
    nlCaptureLoading: false,
    nlCaptureFields: recovery.nlFields,
    nlCaptureDropped: recovery.nlDropped,
    nlCaptureRaw: recovery.nlRaw,
    nlCaptureError: null,
  });
  // Adopt the draft into THIS tab: the stored stamp predates this load, and
  // without a re-stamp the tab could never clear or empty its own restored
  // draft (owner-guarded paths would refuse forever). Single-slot trade-off:
  // if two tabs restore the same draft, the later adoption wins the slot.
  persistCaptureRecovery({ force: true });
  return true;
}

// Projects offered in the capture picker: Inbox first, then active/on-hold user
// projects, each carrying its dot color for the menu.
function captureProjectChoices() {
  const inbox = inboxProject();
  const rest = (state.projects || []).filter(
    (p) => p.slug !== INBOX_SLUG && (p.status === 'active' || p.status === 'on-hold'),
  );
  return (inbox ? [inbox, ...rest] : rest).map((p) => ({ ...p, color: projectColor(p) }));
}

async function createNewDocument(templateId) {
  if (!(await prepareEditorNavigation())) return false;
  setState({ newDocMenuOpen: false });
  destroyEditorController(); // fresh mount (cursorToEnd), no selection carried in
  const project = defaultProjectId();
  if (!project) { showToast('Create a project first.'); renderApp(); return; }
  const template = templateById(templateId);
  try {
    const doc = await createDocument({
      title: template.title, body: template.body, documentType: template.documentType, project, tags: [],
    });
    await loadDocuments();
    seedEditorDraft(state.documents.find(d => d.id === doc.id) || doc);
    writeToken += 1; // drop any writing state carried from the previous doc
    setState({ navType: 'editor', editorMode: 'edit', editorFocus: false, writeMenuOpen: false, writeSelection: null, writeContext: null, writeResult: null, writeLoading: false, writeError: null });
    renderApp();
    showToast('New document — rename it in the title bar');
    return true;
  } catch {
    alertError('create a document');
    return false;
  }
}

function markdownImportProjects() {
  return (state.projects || []).filter(project => project.status === 'active' || project.status === 'on-hold');
}

function libraryExportProjects() {
  const projects = state.managedProjects?.length ? state.managedProjects : state.projects;
  return (projects || []).filter(project => project.slug);
}

function openLibraryExport(scope = 'all', returnAction = 'export-library') {
  const projects = libraryExportProjects();
  const selectedScope = scope === 'all' || projects.some(project => project.slug === scope)
    ? scope
    : 'all';
  libraryExportReturnAction = returnAction;
  restoreLibraryExportFocus = false;
  setState({
    libraryExportOpen: true,
    libraryExportScope: selectedScope,
    libraryExportFilename: libraryArchiveFilename(selectedScope),
    libraryExportPending: false,
    libraryExportError: '',
    newDocMenuOpen: false,
  });
  renderApp();
}

function closeLibraryExport() {
  if (state.libraryExportPending) return false;
  restoreLibraryExportFocus = true;
  setState({
    libraryExportOpen: false,
    libraryExportPending: false,
    libraryExportError: '',
  });
  renderApp();
  return true;
}

async function submitLibraryExport() {
  if (state.libraryExportPending) return;
  const projects = libraryExportProjects();
  const scope = state.libraryExportScope === 'all'
    || projects.some(project => project.slug === state.libraryExportScope)
    ? state.libraryExportScope
    : 'all';
  const filename = state.libraryExportFilename || libraryArchiveFilename(scope);
  const mode = libraryExportDestinationMode({ desktopShell: state.desktopShell });
  setState({ libraryExportPending: true, libraryExportError: '' });
  renderApp();

  try {
    const result = await saveLibraryArchive({
      scope,
      filename,
      mode,
      desktopShell: state.desktopShell,
    });
    if (result.status === 'cancelled') {
      setState({ libraryExportPending: false });
      renderApp();
      return;
    }
    restoreLibraryExportFocus = true;
    setState({
      libraryExportOpen: false,
      libraryExportPending: false,
      libraryExportError: '',
    });
    showToast(result.status === 'downloaded'
      ? `Download started: ${filename}`
      : `Saved ${filename}`);
  } catch (error) {
    setState({
      libraryExportPending: false,
      libraryExportError: libraryExportFailureMessage(error),
    });
    renderApp();
  }
}

function openMarkdownImport() {
  const projects = markdownImportProjects();
  const retained = projects.find(project => project.id === state.markdownImportProjectId);
  const destination = retained || projects.find(project => project.slug === INBOX_SLUG) || projects[0] || null;
  setState({
    markdownImportOpen: true,
    markdownImportProjectId: destination?.id || null,
    markdownImportFiles: [],
    markdownImportPending: false,
    markdownImportError: destination ? '' : 'Create an active project before importing Markdown.',
    markdownImportNotice: '',
    newDocMenuOpen: false,
  });
  restoreMarkdownImportFocus = false;
  renderApp();
}

function closeMarkdownImport() {
  if (state.markdownImportPending) return false;
  restoreMarkdownImportFocus = true;
  setState({
    markdownImportOpen: false,
    markdownImportFiles: [],
    markdownImportError: '',
    markdownImportNotice: '',
  });
  renderApp();
  return true;
}

async function selectMarkdownImportFiles(fileList) {
  if (state.markdownImportPending || state.markdownImportNotice) return;
  const files = [...(fileList || [])];
  if (!files.length) return;
  const records = [];
  const unreadable = [];
  for (const file of files) {
    try {
      const body = await file.text();
      records.push({
        id: globalThis.crypto.randomUUID(),
        name: file.name || 'unnamed.md',
        title: titleFromMarkdown(body, file.name),
        body,
      });
    } catch {
      unreadable.push(file.name || 'unnamed file');
    }
  }
  setState({
    markdownImportFiles: records,
    markdownImportError: unreadable.length
      ? `${unreadable.length} file${unreadable.length === 1 ? '' : 's'} could not be read: ${unreadable.slice(0, 3).join(', ')}.`
      : '',
    markdownImportNotice: '',
  });
  renderApp();
}

async function submitMarkdownImport() {
  if (state.markdownImportPending) return;
  const destination = markdownImportProjects().find(project => project.id === state.markdownImportProjectId);
  const records = [...(state.markdownImportFiles || [])];
  if (!destination) {
    setState({ markdownImportError: 'Choose an active destination project.' });
    renderApp();
    return;
  }
  if (!records.length) {
    setState({ markdownImportError: 'Choose at least one Markdown file.' });
    renderApp();
    return;
  }
  setState({ markdownImportPending: true, markdownImportError: '', markdownImportNotice: '' });
  renderApp();
  let imported = 0;
  const failed = [];
  for (const record of records) {
    try {
      await createDocument({
        id: record.id,
        title: record.title,
        body: record.body,
        documentType: 'note',
        project: destination.id,
        tags: ['imported'],
        sourceFilename: record.name,
      });
      imported += 1;
    } catch {
      failed.push(record);
    }
  }

  let refreshFailed = false;
  if (imported) {
    try { await loadDocuments(); } catch { refreshFailed = true; }
  }
  const committed = imported
    ? `Imported ${imported} note${imported === 1 ? '' : 's'} into ${destination.name}.`
    : `No notes were confirmed in ${destination.name}.`;
  if (failed.length) {
    setState({
      markdownImportPending: false,
      markdownImportFiles: failed,
      markdownImportNotice: `${committed} ${failed.length} file${failed.length === 1 ? ' remains' : 's remain'}; retry is exact-once safe.${refreshFailed ? ' The Library could not refresh; reload to reconcile committed notes.' : ''}`,
    });
    renderApp();
    return;
  }

  setState({
    markdownImportOpen: false,
    markdownImportPending: false,
    markdownImportFiles: [],
    markdownImportError: '',
    markdownImportNotice: '',
  });
  restoreMarkdownImportFocus = true;
  showToast(refreshFailed
    ? `${committed} The Library could not refresh; reload to reconcile it.`
    : committed, null, refreshFailed ? 7000 : 5000);
}

function persistSavedViews() {
  try {
    localStorage.setItem(SAVED_LIBRARY_VIEWS_KEY, JSON.stringify(state.librarySavedViews));
  } catch { /* non-critical */ }
}

function persistSmartViews() {
  try {
    localStorage.setItem(SMART_VIEWS_KEY, JSON.stringify(state.taskSmartViews));
  } catch { /* non-critical */ }
}

// Open the task filter view. An expression + optional saved-view id (null =
// ad-hoc). Clears task selection like the other top-level views.
async function goFilter({ expr = '', smartViewId = null } = {}) {
  if (!(await prepareEditorNavigation())) return false;
  // The filter world's panel sidebar is its views — auto-select the tab.
  setState({ navType: 'filter', editorFocus: false, activeFilterExpr: expr, activeSmartViewId: smartViewId, selectedTaskId: null, multiSelectIds: [], panelTab: 'views', ...nlFilterResetPatch() });
  renderApp();
  return true;
}

function resetSemanticSearchPatch() {
  semanticSearchToken += 1;
  return {
    semanticResults: null,
    semanticPage: null,
    semanticIndex: null,
    semanticError: false,
    semanticLoading: false,
    semanticLoadingMore: false,
    semanticMoreError: false,
  };
}

function normalizeSemanticSearchPage(payload, { offset, limit }) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      page: { offset, limit, returned: payload.length, total: offset + payload.length, hasMore: false, nextOffset: null },
    };
  }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const page = payload?.page && typeof payload.page === 'object' ? payload.page : {};
  const total = Number.isInteger(page.total) && page.total >= 0 ? page.total : offset + items.length;
  const returned = Number.isInteger(page.returned) && page.returned >= 0 ? page.returned : items.length;
  const hasMore = Boolean(page.hasMore) && offset + returned < total;
  return {
    items,
    index: payload?.index ?? null,
    page: {
      offset,
      limit,
      returned,
      total,
      hasMore,
      nextOffset: hasMore && Number.isInteger(page.nextOffset) ? page.nextOffset : (hasMore ? offset + returned : null),
    },
  };
}

async function runSemanticSearch({ append = false } = {}) {
  const query = state.libraryQuery.trim();
  const existing = Array.isArray(state.semanticResults) ? state.semanticResults : [];
  const offset = append ? state.semanticPage?.nextOffset : 0;
  const limit = 20;
  if (append && (!Number.isInteger(offset) || state.semanticLoadingMore)) return;
  const token = (semanticSearchToken += 1);
  if (!query) { setState(resetSemanticSearchPatch()); renderApp(); return; }
  const isCurrent = () => token === semanticSearchToken
    && state.navType === 'library'
    && state.librarySemantic
    && state.libraryQuery.trim() === query;
  setState(append
    ? { semanticLoadingMore: true, semanticMoreError: false }
    : { semanticResults: null, semanticPage: null, semanticIndex: null, semanticError: false, semanticLoading: true, semanticLoadingMore: false, semanticMoreError: false });
  renderApp();
  const input = appRoot.querySelector('[data-library-search]');
  input?.focus();
  input?.setSelectionRange?.(input.value.length, input.value.length);
  try {
    const payload = await semanticSearch(query, undefined, { offset, limit });
    if (!isCurrent()) return;
    const result = normalizeSemanticSearchPage(payload, { offset, limit });
    const seen = new Set();
    const items = [...(append ? existing : []), ...result.items]
      .filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    setState({
      semanticResults: items,
      semanticPage: result.page,
      semanticIndex: result.index ?? null,
      semanticError: false,
      semanticLoading: false,
      semanticLoadingMore: false,
      semanticMoreError: false,
    });
    renderApp();
  } catch {
    if (!isCurrent()) return;
    if (append) {
      setState({ semanticLoadingMore: false, semanticMoreError: true });
      renderApp();
      return;
    }
    // A thrown error means the request itself failed (e.g. the embedding
    // backend is unreachable — a 503) — distinct from a successful search with
    // no matches. Surface it so it doesn't look like an empty result set.
    setState({ semanticResults: [], semanticPage: null, semanticIndex: null, semanticError: true, semanticLoading: false, semanticLoadingMore: false, semanticMoreError: false });
    showToast('Semantic search failed — the embedding backend is unreachable. Check the provider in Settings ▸ Intelligence.');
  }
}

// ---------------------------------------------------------------------------
// Settings / data-admin flows
// ---------------------------------------------------------------------------

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 3000);
}

async function exportTasksScoped(all) {
  try {
    const project = all ? 'all' : (state.navId || 'all');
    const payload = await exportTasks({ project });
    const context = all ? 'all-projects' : (state.projects.find(p => p.id === state.navId)?.name || 'project');
    downloadJsonFile(exportFilename(context, new Date()), payload);
  } catch {
    alertError(all ? 'export all projects' : 'export this project');
  }
}

async function importTasksFromSettings() {
  if (state.adminImportPending) return;
  let mode;
  try {
    mode = normalizeImportMode(state.adminImportMode || 'skip');
  } catch {
    mode = 'skip';
  }
  if (mode === 'replace') {
    const confirmBox = appRoot.querySelector('[data-replace-confirm]');
    if ((confirmBox?.value || '') !== 'REPLACE') {
      showToast('Type REPLACE to confirm a replace import.');
      return;
    }
  }
  const payload = state.adminImportPayload;
  if (!payload) { showToast('Choose a valid JSON export file first.'); return; }
  const project = state.adminImportProjectId;
  if (!project) { showToast('Create a project first.'); return; }
  const tasks = tasksFromImportPayload(payload);
  const intent = JSON.stringify({ project, mode, payload });
  setState({adminImportPending:true});
  let request;
  try { request = await importRequestFor(taskDraftStorage(), intent); }
  catch {
    setState({adminImportPending:false, adminImportError:'The import identity could not be saved for safe retry. Keep this window open and retry when storage is available.'});
    renderApp(); return;
  }
  setState({
    adminImportPending: true,
    adminImportError: '',
    adminImportResult: null,
    adminImportRequest: request,
  });
  renderApp();
  try {
    const result = await importTasks({
      project, mode, tasks,
      format: payload?.format,
      version: payload?.version,
      requestId: request.id,
    });
    setState({
      adminImportPending: false,
      adminImportError: '',
      adminImportResult: result,
      adminImportRequest: null,
      adminImportFileName: '',
      adminImportPayload: null,
    });
    completeImportRequest(taskDraftStorage(), request);
    const destination = state.projects.find(item => item.id === project)?.name || 'the selected project';
    const committed = `Imported ${result.imported} task${result.imported === 1 ? '' : 's'} into ${destination}; skipped ${result.skipped ?? 0}.`;
    try {
      await loadTasks();
      showToast(result.replayed ? `${committed} Recovered the earlier commit safely.` : committed, null, 5000);
    } catch {
      setState({ adminImportError: `${committed} The task list could not refresh; reload to reconcile it.` });
      showToast('Import committed, but the task list could not refresh. Reload to reconcile it.', null, 6000);
    }
    renderApp();
  } catch (err) {
    const transportUnknown = !Number.isInteger(err?.status);
    const message = transportUnknown
      ? 'The connection ended before Prax could confirm the result. Retry is safe and will reuse the same import operation.'
      : `Prax rejected the import: ${err?.message || 'the request was invalid'}.`;
    setState({ adminImportPending: false, adminImportError: message });
    if (err?.status === 409) setState({ adminImportRequest: null });
    showToast(message, null, 6000);
    renderApp();
  }
}

async function selectTaskImportFile(file) {
  if (!file || state.adminImportPending) return;
  try {
    const payload = JSON.parse(await file.text());
    tasksFromImportPayload(payload);
    setState({
      adminImportFileName: file.name || 'task-export.json',
      adminImportPayload: payload,
      adminImportError: '',
      adminImportResult: null,
      adminImportRequest: null,
    });
  } catch (err) {
    setState({
      adminImportFileName: file.name || '',
      adminImportPayload: null,
      adminImportError: `That file is not a supported Prax task export. ${err?.message || ''}`.trim(),
      adminImportResult: null,
      adminImportRequest: null,
    });
  }
  renderApp();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function resetLibraryFilters() {
  return {
    libraryQuery: '', librarySemantic: false, activeLibraryTags: [], libraryProjects: [],
    ...resetSemanticSearchPatch(), libraryView: 'active',
  };
}

async function navigateTopLevel(patch) {
  if (!(await prepareEditorNavigation())) return false;
  setState({ editorFocus: false, ...patch });
  renderApp();
  externalRefresh.trigger('navigate');
  return true;
}

async function goProject(projectId, tab = 'list') {
  if (!projectId) return navigateTopLevel({ navType: 'all' });
  if (!(await prepareEditorNavigation())) return false;
  // Same drawer-draft protection as closeTaskDrawer/openTaskDrawer: project
  // navigation (palette open-task, g-b board chord, project cards) used to
  // clear the drawer without flushing, silently discarding notes typed just
  // before the jump.
  if (state.drawerTaskId && !(await flushTaskDrawerDraft())) {
    showToast(['recovered', 'conflict'].includes(state.taskDraftRecoveryReason)
      ? 'Review and save the recovered task draft before leaving.'
      : 'Save this task draft before leaving.');
    return false;
  }
  setState({
    navType: 'project', navId: projectId, tab, editorFocus: false,
    selectedTaskId: null, multiSelectIds: [], drawerTaskId: null,
    taskNotesDraftId: null, taskDraftBaseline: null,
    taskLabelDraftId: null, taskLabelDraft: '',
    recentProjects: saveRecent(pushRecent(state.recentProjects, projectId)),
  });
  persistActiveProject(projectId);
  externalRefresh.trigger('navigate');
  if (tab === 'archive') loadArchivedTasks().then(renderApp);
  renderApp();
  return true;
}

async function goLibrary(extra = {}) {
  if (!(await prepareEditorNavigation())) return false;
  destroyEditorController();
  setState({ navType: 'library', editorFocus: false, ...resetLibraryFilters(), ...extra });
  renderApp();
  loadDocuments()
    .then((applied) => { if (applied && state.navType === 'library') renderApp(); })
    .catch(() => { if (state.navType === 'library') alertError('load the library'); });
  return true;
}

async function goSettings() {
  if (!(await prepareEditorNavigation())) return false;
  const validDestination = state.projects.some(project => project.id === state.navId)
    ? state.navId
    : (inboxProjectId() || state.projects[0]?.id || null);
  setState({ navType: 'settings', editorFocus: false, adminImportProjectId: validDestination });
  loadDeploymentStatus().then(renderApp);
  loadSemanticStatus().then(renderApp);
  loadChatStatus().then(renderApp);
  loadGoogleCalendarStatus().then(renderApp);
  loadMaintenance().then(renderApp);
  renderApp();
  return true;
}

function openShortcuts() {
  if (state.shortcutsOpen) { setState({ shortcutsOpen: false }); renderApp(); return; }
  setState({ shortcutsOpen: true });
  renderApp();
  appRoot.querySelector('[data-overlay="shortcuts"] [data-action="close-shortcuts"]')?.focus();
}

function escapeCascade() {
  if (state.shortcutsOpen) { setState({ shortcutsOpen: false }); renderApp(); return; }
  // The writing preview is a full-screen modal — it owns Esc over the (hidden,
  // behind-the-scrim) editor search panel.
  if (state.writeContext) { closeWrite(); return; }
  if (state.editorSearchOpen) { closeEditorSearch(); return; }
  if (state.assistantOpen) { setState({ assistantOpen: false }); renderApp(); return; }
  if (state.askPraxOpen) { closeAskPrax(); return; }
  if (state.genRbOpen) { setState({ genRbOpen: false }); renderApp(); return; }
  if (state.dailyBriefOpen) { setState({ dailyBriefOpen: false }); renderApp(); return; }
  if (state.planMode) { setState({ planMode: null }); renderApp(); return; }
  if (state.libraryExportOpen) { closeLibraryExport(); return; }
  if (state.markdownImportOpen) { closeMarkdownImport(); return; }
  if (state.confirm) { setState({ confirm: null }); renderApp(); return; }
  if (state.docMenuOpen) { setState({ docMenuOpen: false }); renderApp(); return; }
  if (state.paletteOpen) { setState({ paletteOpen: false }); renderApp(); return; }
  // Inside capture, the NL layer peels first: Esc aborts a parse / discards the
  // preview and restores the typed text; only the next Esc closes the overlay.
  if (state.captureOpen && (state.nlCaptureLoading || state.nlCaptureFields || state.nlCaptureError)) { cancelNlCapture(); return; }
  if (state.captureOpen) {
    if (state.captureSubmitting) return;
    discardCapture();
    renderCaptureOverlayLayer({ restoreFocus: true });
    return;
  }
  // The ✦ AI dropdown sits below the modal overlays + palette: a still-open (but
  // hidden-behind-an-overlay) menu must not swallow the first Esc aimed above it.
  if (state.writeMenuOpen) { setState({ writeMenuOpen: false, writeSelection: null }); renderApp(); return; }
  if (state.isLinkPickerOpen) { setState({ isLinkPickerOpen: false }); renderApp(); return; }
  if (state.isDocumentInfoEditorOpen) { setState({ isDocumentInfoEditorOpen: false }); renderApp(); return; }
  if (state.drawerTaskId) { closeTaskDrawer(); return; }
  if (state.navType === 'calendar' && state.calendarSelectedDay) {
    setState({ calendarSelectedDay: null });
    renderApp();
    return;
  }
  if (state.multiSelectIds.length || state.selectedTaskId) {
    setState({ multiSelectIds: [], selectedTaskId: null });
    renderApp();
    return;
  }
  if (state.editorFocus) {
    destroyEditorController();
    setState({ editorFocus: false });
    renderApp();
    return;
  }
  if (state.navType === 'run') backFromRun();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function projectsById() {
  const map = {};
  for (const project of (state.managedProjects.length ? state.managedProjects : state.projects)) {
    map[project.id] = project;
  }
  return map;
}

function sidebarCounts() {
  const projectOpen = {};
  for (const task of state.tasks) {
    if (!isOpen(task)) continue;
    projectOpen[task.projectId] = (projectOpen[task.projectId] || 0) + 1;
  }
  const now = new Date();
  const { badge } = buildTodayGroups(state.tasks, state.projects, { now });
  return { todayBadge: badge, projectOpen };
}

function projectTasks() {
  return state.tasks.filter(t => t.projectId === state.navId);
}

function renderMainHtml() {
  const now = new Date();
  if (state.apiStatus === 'loading'
    && ['today', 'all', 'filter', 'calendar', 'project'].includes(state.navType)) {
    return '<div class="page"><div class="empty" role="status" aria-live="polite">'
      + '<p class="empty__title">Loading tasks…</p>'
      + '<p class="empty__sub">Preparing your workspace.</p>'
      + '</div></div>';
  }
  switch (state.navType) {
    case 'today': {
      const built = buildTodayGroups(state.tasks, state.projects, { now });
      // A collapsed week ahead leaves the collection so arrow keys and the
      // "load more" progress only ever address rows that are on screen.
      const weekCollapsed = isCollapsed(state.collapsedSections, TODAY_WEEK_SECTION);
      const groups = weekCollapsed ? built.groups.filter((group) => !group.week) : built.groups;
      const collection = limitTaskGroups(groups, taskCollectionLimit(`today|${weekCollapsed ? 'folded' : 'week'}`));
      flatIds = collection.flatIds;
      return renderTodayHtml(state, collection.groups, {
        now, snoozedCount: built.snoozedCount, collection,
        plannedCount: built.plannedCount, plannedDone: built.plannedDone,
        stalePlannedCount: built.stalePlannedCount,
        weekCount: built.weekCount, weekCollapsed,
      });
    }
    case 'all': {
      const groups = buildProjectGroups(state.managedProjects, state.tasks);
      return renderAllProjectsHtml(state, groups, projectColor);
    }
    case 'library': {
      const collectionKey = JSON.stringify([
        state.libraryView, state.libraryQuery, state.librarySemantic, state.librarySortBy,
        state.activeLibraryTags, state.libraryTypes, state.libraryTrust, state.libraryProjects,
      ]);
      const model = buildLibraryModel(state, { limit: libraryCollectionLimit(collectionKey) });
      // Wide windows show the facets in the Library panel (renderShell); the
      // main view then carries active-filter chips only. Same 940px line as
      // the rail/panel switch in renderApp.
      return renderLibraryHtml(state, model, { facetsInPanel: state.winW >= 940 });
    }
    case 'editor': {
      const doc = currentDocument();
      if (!doc) return '<div class="page"><p class="view-hint">Document not found.</p></div>';
      const text = state.documentDraftBody;
      // Backlinks come from the server (tasks referencing this doc). Give each
      // a docIds pointer and hand projects their computed color so the shared,
      // tested buildBacklinks resolves the chip name/color the same as tasks.
      const backlinkTasks = (state.documentTaskBacklinks || []).map((task) => ({ ...task, docIds: [doc.id] }));
      const coloredProjects = (state.projects || []).map((project) => ({ ...project, color: projectColor(project) }));
      const owner = [...(state.managedProjects || []), ...(state.projects || [])]
        .find(project => project.id === doc.projectId) || null;
      const infoProjects = [...(state.projects || [])];
      if (owner && !infoProjects.some(project => project.id === owner.id)) infoProjects.unshift(owner);
      const model = {
        outline: buildOutline(text),
        backlinks: buildBacklinks(backlinkTasks, coloredProjects, doc.id),
        previewHtml: renderMarkdownHtml(text, { resolveWikiLink }),
        project: owner ? { ...owner, color: projectColor(owner) } : null,
        projects: infoProjects,
      };
      return renderEditorHtml(state, doc, model);
    }
    case 'run': {
      const run = state.activeRun;
      const doc = (state.documents || []).find((d) => d.id === (run?.documentId || state.runReturnDocId));
      return renderRunHtml(state, run, { docTitle: run?.documentTitle || doc?.title || run?.title || 'Runbook', now });
    }
    case 'health':
      return renderHealthHtml(state);
    case 'filter': {
      // Live typing → best-effort (partial) parse so the list never empties.
      const { predicate, error } = parseTaskFilter(state.activeFilterExpr || '', { partial: true });
      const built = buildFilterGroups(state.tasks, state.projects, predicate || (() => true), { now });
      const collection = limitTaskGroups(built.groups, taskCollectionLimit(`filter|${state.activeFilterExpr || ''}`));
      flatIds = collection.flatIds;
      return renderFilterHtml(state, { groups: collection.groups, count: built.count, error, collection });
    }
    case 'calendar': {
      const model = buildCalendarModel(state.tasks, state.projects, { month: state.calendarMonth, now });
      // The desktop shell serves on a fresh ephemeral port every launch, so a
      // copied subscription URL would silently die on the next restart — only
      // advertise the feed where the origin is durable (server/docker).
      const feedUrl = state.desktopShell ? '' : `${window.location.origin}/api/calendar.ics`;
      return renderCalendarHtml(state, model, { feedUrl });
    }
    case 'settings': {
      const model = {
        stats: {
          tasks: state.tasks.length,
          projects: (state.managedProjects.length ? state.managedProjects : state.projects).length,
          documents: state.documents.length,
        },
        activeProjectName: state.projects.find(p => p.id === state.navId)?.name || 'All projects',
        activeDocumentCount: state.documents.length,
      };
      return renderSettingsHtml(state, model);
    }
    case 'project':
    default: {
      const tasks = projectTasks();
      const project = projectsById()[state.navId];
      const chipClass = `chip--state-${project?.status || 'active'}`;
      const backlogCount = tasks.filter(t => designStatus(t.status) === 'backlog' && !t.archivedAt).length;
      const archiveCount = state.tab === 'archive' ? state.archivedTasks.length : 0;
      const tabs = [['list', 'List'], ['board', 'Board'], ['backlog', 'Backlog'], ['archive', 'Archive']]
        .map(([key, label]) => {
          const count = key === 'backlog' ? backlogCount : (key === 'archive' ? archiveCount : 0);
          const suffix = count ? ` · ${count}` : '';
          return `<button class="tabs__tab${state.tab === key ? ' is-active' : ''}" type="button" data-action="set-tab" data-tab="${key}">${label}${suffix}</button>`;
        }).join('');
      const groupLabel = { due: 'Due date', priority: 'Priority', status: 'Status' }[state.groupBy];
      const right = state.tab === 'list'
        ? `<div class="tabs__right"><button class="btn-ghost" type="button" data-action="cycle-group">Group: ${groupLabel}</button></div>`
        : '';
      let body = '';
      if (state.tab === 'board') {
        const columns = buildBoardColumns(state, tasks);
        const collection = limitBoardColumns(
          columns,
          taskCollectionLimit(`project|${state.navId}|board`),
        );
        flatIds = collection.columns.flatMap(c => c.cards.map(card => card.id));
        body = renderBoardHtml(state, collection.columns, projectsById(), { collection });
      } else if (state.tab === 'backlog') {
        const backlog = tasks.filter(t => designStatus(t.status) === 'backlog' && !t.archivedAt);
        const collection = limitTaskGroups(
          [{ key: 'backlog', label: 'Backlog', tasks: backlog }],
          taskCollectionLimit(`project|${state.navId}|backlog`),
        );
        flatIds = collection.flatIds;
        body = renderBacklogHtml(state, collection.groups[0]?.tasks || [], { collection });
      } else if (state.tab === 'archive') {
        const collection = limitTaskGroups(
          [{ key: 'archive', label: 'Archive', tasks: state.archivedTasks }],
          taskCollectionLimit(`project|${state.navId}|archive`),
        );
        flatIds = collection.flatIds;
        body = renderArchiveHtml(state, collection.groups[0]?.tasks || [], { collection });
      } else {
        const built = buildListGroups(state, tasks, { now });
        // Folded groups keep their header and count but leave the collection,
        // so ↑↓ and the progress row only ever address rows on screen.
        const folded = applyCollapsedGroups(built.groups, state.collapsedSections, state.navId);
        const collection = limitTaskGroups(
          folded,
          taskCollectionLimit(`project|${state.navId}|list|${state.groupBy}`),
        );
        flatIds = collection.flatIds;
        body = renderListHtml(state, collection.groups, { collection }) + renderBulkBarHtml(state);
      }
      const canRename = project && project.slug !== INBOX_SLUG;
      // Ops metadata (on call / handoff / repo / area) sits on its own row under
      // an Ops disclosure; the title keeps the header row (year-one shell spec).
      const hasOps = Boolean(project) && project.slug !== INBOX_SLUG;
      const opsCollapsed = hasOps && isCollapsed(state.collapsedSections, opsSectionKey(project.id));
      const titleHtml = (canRename && state.renamingProjectId === project.id)
        ? `<input class="page-head__rename" type="text" data-project-rename data-project-id="${escapeHtml(project.id)}" value="${escapeHtml(project.name)}" aria-label="Rename project" autocomplete="off" spellcheck="false">`
        : `<h1 class="page-head__title">${escapeHtml(project?.name || 'Tasks')}</h1>`
          + (canRename ? `<button class="page-head__rename-btn" type="button" data-action="rename-project" data-project-id="${escapeHtml(project.id)}" title="Rename project" aria-label="Rename project">${icon('pencil', 13)}</button>` : '');
      return `<div class="page">
        <header class="page-head">
          <span class="page-head__dot" style="--dot:${project ? projectColor(project) : 'var(--accent)'}"></span>
          ${titleHtml}
          <span class="chip ${chipClass}">${escapeHtml((project?.status || 'active').replace('-', ' '))}</span>
          ${hasOps ? renderOpsToggleHtml(project, { collapsed: opsCollapsed }) : ''}
        </header>
        ${hasOps ? renderProjectOpsHtml(project, { collapsed: opsCollapsed, revealed: state.revealedOpsFields }) : ''}
        <nav class="tabs">${tabs}${right}</nav>
        ${body}
      </div>`;
    }
  }
}

function renderOverlaysHtml() {
  let html = '';
  if (state.drawerTaskId) {
    const task = taskById(state.drawerTaskId);
    if (task) {
      const project = projectsById()[task.projectId];
      html += renderTaskDrawerHtml(state, task, {
        project: project ? { ...project, color: projectColor(project) } : null,
        projects: state.projects,
        documents: state.taskDocuments,
        checklist: state.taskChecklist,
        activity: state.taskActivity,
        readOnly: Boolean(task.archivedAt),
      });
    } else {
      // The task vanished (archived/deleted externally, dropped by a refresh).
      // Rendering nothing here while the draft state persisted left an
      // INVISIBLE dirty draft vetoing every close and navigation forever.
      html += renderMissingTaskDrawerHtml(state);
    }
  }
  if (state.isLinkPickerOpen) html += renderLinkPickerHtml(state);
  if (state.paletteOpen) {
    const built = buildPaletteGroups(state, {
      tasks: state.tasks, documents: state.documents, projects: state.projects,
    });
    paletteFlat = built.flat;
    html += renderPaletteHtml(state, built);
  }
  if (state.captureOpen) {
    const choices = captureProjectChoices();
    const selectedId = state.captureProjectId || defaultProjectId();
    const raw = selectedId ? projectsById()[selectedId] : null;
    const selected = raw ? { ...raw, color: projectColor(raw) } : null;
    // Keep the chosen project visible in the picker even if it's not in the
    // default list (e.g. capturing while viewing a completed project).
    if (selected && !choices.some((p) => p.id === selected.id)) choices.unshift(selected);
    html += renderCaptureHtml(
      state,
      selected || { name: 'No project', color: 'var(--ink3)' },
      choices,
    );
  }
  if (state.markdownImportOpen) {
    html += renderMarkdownImportHtml(state, markdownImportProjects());
  }
  if (state.libraryExportOpen) {
    html += renderLibraryExportHtml(
      state,
      libraryExportProjects(),
      libraryExportDestinationMode({ desktopShell: state.desktopShell }),
    );
  }
  if (state.askPraxOpen) {
    const r = state.askPraxResult;
    // Render the written answer when there is one, else the retrieved pack.
    const md = r ? ((typeof r.answer === 'string' && r.answer.trim()) ? r.answer : (r.markdown || '')) : '';
    html += renderAskPraxHtml(state, { bodyHtml: md ? renderMarkdownHtml(md, { resolveWikiLink }) : '' });
  }
  if (state.genRbOpen) {
    html += renderGenerateRunbookHtml(state, { projects: captureProjectChoices().filter((p) => p.slug !== INBOX_SLUG) });
  }
  if (state.dailyBriefOpen) {
    html += renderDailyBriefHtml(state, {
      briefHtml: renderMarkdownHtml(buildDailyBrief(state), { resolveWikiLink }),
      narrativeHtml: state.dailyBriefNarrative ? renderMarkdownHtml(state.dailyBriefNarrative, { resolveWikiLink }) : '',
    });
  }
  if (state.assistantOpen) {
    html += renderAssistantHtml(state, { renderMarkdown: (md) => renderMarkdownHtml(md, { resolveWikiLink }) });
  }
  if (state.writeContext && state.navType === 'editor') {
    html += renderWritingPreviewHtml(state, { resultHtml: state.writeResult ? renderMarkdownHtml(state.writeResult, { resolveWikiLink }) : '' });
  }
  if (state.planMode) html += renderPlanModeHtml(state);
  if (state.shortcutsOpen) html += renderShortcutsHtml(state);
  if (state.confirm) html += renderConfirmHtml(state.confirm);
  html += renderToastHtml(state);
  return html;
}

// Capture is a modal layer over an otherwise unchanged workspace. Opening or
// closing it must not rebuild thousands of task objects, the sidebar, or an
// editor. Internal capture mutations may still choose a full render when the
// underlying collection genuinely changed (for example after task creation).
function renderCaptureOverlayLayer({ restoreFocus = false } = {}) {
  const root = appRoot?.querySelector('[data-overlay-root]');
  if (!root) {
    renderApp();
    return;
  }
  root.innerHTML = renderOverlaysHtml();
  if (state.captureOpen) {
    const input = root.querySelector('[data-capture-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  } else if (restoreFocus && captureReturnElement?.isConnected) {
    captureReturnElement.focus();
    captureReturnElement = null;
  }
}

function renderApp() {
  if (!appRoot) return;
  // A render can land between the browser updating an input's DOM value and
  // dispatching its input event (notably when drawer context resolves). Only
  // the FOCUSED field can hold such an unflushed keystroke — an unfocused
  // field's DOM is whatever the last render wrote, and after a state-side
  // fold (refresh reconcile, save rebase, discard reseed) that DOM is stale:
  // capturing it would re-install the folded-away value as "user typing" and
  // autosave it back over the out-of-band edit or the discard.
  const liveDrawer = appRoot.querySelector('.drawer[data-task-id]');
  if (liveDrawer?.dataset.taskId === state.drawerTaskId
    && state.taskNotesDraftId === state.drawerTaskId
    && !taskById(state.drawerTaskId)?.archivedAt) {
    const active = document.activeElement;
    const focusedField = active instanceof HTMLElement && liveDrawer.contains(active)
      ? (active.matches('[data-task-title]') ? 'title'
        : active.matches('[data-task-description]') ? 'description'
          : active.matches('[data-task-notes]') ? 'notes'
            : null)
      : null;
    if (focusedField && active.value !== taskDraftSnapshot()[focusedField]) {
      handleTaskDrawerDraftChange({ [focusedField]: active.value });
    }
  }
  // Rebuilding innerHTML destroys any mounted CodeMirror DOM — drop the
  // controller so afterRender mounts a fresh instance instead of skipping on
  // a stale handle. (Saves that should keep the caret avoid renderApp
  // entirely via canPreserveEditorAfterDraftSave.)
  // Preserve a non-empty editor selection across the re-mount below (a collapsed
  // caret stays null → cursorToEnd, unchanged). Without this, opening the ✦ AI
  // menu — which re-renders — would drop the selection a writing action needs.
  pendingEditorSelection = state.navType === 'editor' && documentEditorController?.getSelectionRange
    ? documentEditorController.getSelectionRange()
    : null;
  destroyEditorController();
  // The ✦ AI menu/overlay are editor-only; never let leaked write state (e.g. an
  // in-flight action the user navigated away from) render over another view.
  if (state.navType !== 'editor' && (state.writeContext || state.writeMenuOpen || state.writeSelection)) {
    writeToken += 1;
    state.writeContext = null; state.writeResult = null; state.writeLoading = false;
    state.writeError = null; state.writeMenuOpen = false; state.writeSelection = null;
  }
  const narrow = state.winW < 940;
  const chrome = !state.editorFocus;
  const counts = sidebarCounts();
  const nav = chrome
    ? renderRailHtml(state, counts, { showProjects: narrow })
      + (narrow ? '' : renderPanelHtml(state, counts))
    : '';
  // The main-content fade-in is a *view-transition* cue. renderApp rebuilds the
  // DOM on every state change, so without this the fade replays on same-view
  // re-renders too — a strobe while typing in the library search / filtering.
  // Only animate when the view identity actually changes.
  const viewKey = `${state.navType}|${state.navId}|${state.tab}|${state.libraryView}|${state.editorDocId}|${state.settingsTab}`;
  const flatMain = viewKey === prevViewKey;
  prevViewKey = viewKey;
  appRoot.innerHTML = `
    <div class="desk">
      <div class="window">
        ${chrome ? renderTitlebarHtml(state) : ''}
        <div class="window__body">
          ${nav}
          <main class="main"><div class="main__scroll${flatMain ? ' main__scroll--flat' : ''}">${renderMainHtml()}</div></main>
        </div>
        ${chrome ? renderStatusbarHtml(state) : ''}
      </div>
    </div>
    <div data-overlay-root>${renderOverlaysHtml()}</div>`;
  afterRender();
}

function afterRender() {
  mountEditorIfNeeded();
  if (restoreMarkdownImportFocus && !state.markdownImportOpen) {
    restoreMarkdownImportFocus = false;
    appRoot.querySelector('[data-action="import-documents"]')?.focus();
  }
  if (restoreLibraryExportFocus && !state.libraryExportOpen) {
    restoreLibraryExportFocus = false;
    appRoot.querySelector(`[data-action="${libraryExportReturnAction}"]`)?.focus();
  }
  if (state.renamingProjectId) {
    const input = appRoot.querySelector('[data-project-rename]');
    if (input && document.activeElement !== input) { input.focus(); input.select(); }
  }
  if (state.paletteOpen) {
    const input = appRoot.querySelector('[data-palette-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  } else if (state.captureOpen) {
    // The DOM is fresh after every render — put the caret at the end so typing
    // continues the title (matters after the parse swaps the input's value).
    const input = appRoot.querySelector('[data-capture-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  } else if (state.assistantOpen) {
    // Keep the transcript pinned to the latest turn, and (when idle) the caret
    // in the composer.
    const scroll = appRoot.querySelector('[data-assistant-scroll]');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    if (!state.assistantLoading && !(state.assistantPending && state.assistantPending.length)) {
      const input = appRoot.querySelector('[data-assistant-input]');
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    }
  } else if (state.askPraxOpen && !state.askPraxLoading) {
    const input = appRoot.querySelector('[data-ask-prax-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  } else if (state.genRbOpen && !state.genRbLoading) {
    const input = appRoot.querySelector('[data-genrb-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  } else if (state.markdownImportOpen && !state.markdownImportPending) {
    (state.markdownImportFiles.length
      ? appRoot.querySelector('[data-action="submit-markdown-import"]')
      : appRoot.querySelector('[data-markdown-import-project]'))?.focus();
  } else if (state.libraryExportOpen && !state.libraryExportPending) {
    appRoot.querySelector('[data-library-export-scope]')?.focus();
  } else if (state.confirm) {
    // Focus the text field when there is one; otherwise Cancel — never the
    // destructive action, so a stray Enter can't confirm a delete.
    (appRoot.querySelector('[data-confirm-input]')
      || appRoot.querySelector('.confirm button[data-action="confirm-cancel"]'))?.focus();
  } else if (state.navType === 'editor' && !state.drawerTaskId
    && !state.isDocumentInfoEditorOpen && !state.editorSearchOpen) {
    // Keep the caret in the document: an unfocused editor screen would let
    // plain letters fall through to the global shortcuts (n = capture…).
    const active = document.activeElement;
    if (!active || active === document.body || active === appRoot) focusEditor();
  }
  // Re-attach the find/replace panel if a full render wiped it (it lives
  // outside renderApp so CodeMirror is never remounted mid-search).
  syncSearchPanelDom();
  if (state.navType === 'project' && (state.tab === 'board' || state.tab === 'list')) {
    const visibleIds = new Set(flatIds);
    ensureBoardExtras(projectTasks().filter(t => !t.archivedAt && visibleIds.has(t.id)));
  }
}

// ---------------------------------------------------------------------------
// Palette commands
// ---------------------------------------------------------------------------

const paletteCommands = {
  'new-task': () => { openFreshCapture(); },
  'new-document': () => { setState({ paletteOpen: false }); createNewDocument(); },
  'toggle-theme': () => { setState({ paletteOpen: false }); toggleTheme(); },
  'go-board': async () => {
    setState({ paletteOpen: false });
    await goProject(state.navType === 'project' ? state.navId : state.projects[0]?.id, 'board');
  },
  'go-library': async () => { setState({ paletteOpen: false }); await goLibrary(); },
  'go-all': async () => { setState({ paletteOpen: false }); await navigateTopLevel({ navType: 'all' }); },
  'focus-writing': async () => {
    setState({ paletteOpen: false });
    const target = state.editorDocId || state.documents[0]?.id;
    if (!target) { renderApp(); return; }
    if (!(await openDocumentInEditor(target))) return;
    destroyEditorController();
    setState({ editorFocus: true, editorMode: 'edit' });
    renderApp();
  },
  'go-settings': async () => { setState({ paletteOpen: false }); await goSettings(); },
};

// Switch the palette scope in place, keeping the caret in the search box.
function setPaletteScope(scope) {
  setState({ paletteScope: normalizePaletteScope(scope), paletteSelection: 0 });
  renderApp();
  const input = appRoot.querySelector('[data-palette-input]');
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

async function runPaletteItem(item, { done = false } = {}) {
  if (!item) return;
  if (item.action === 'palette-scope') { setPaletteScope(item.scope); return; }
  if (item.action === 'open-task' && done) {
    setState({ paletteOpen: false });
    await toggleTaskDone(item.id);
    return;
  }
  if (item.action === 'open-task') {
    const task = taskById(item.id);
    setState({ paletteOpen: false });
    if (task && await goProject(task.projectId, 'list')) {
      await openTaskDrawer(task.id);
    }
    return;
  }
  if (item.action === 'open-doc') {
    setState({ paletteOpen: false });
    await openDocumentInEditor(item.id);
    return;
  }
  if (item.action === 'go-project') {
    setState({ paletteOpen: false });
    await goProject(item.id, 'list');
    return;
  }
  if (item.action === 'go-smart-view') {
    setState({ paletteOpen: false });
    const view = findSmartView(state.taskSmartViews, item.id);
    if (view) await goFilter({ expr: view.expr, smartViewId: view.id });
    return;
  }
  if (item.action === 'go-library-view') {
    setState({ paletteOpen: false });
    const view = state.librarySavedViews[Number(item.index)];
    if (view) await goLibrary({ activeLibraryTags: [...view.tags] });
    return;
  }
  const command = paletteCommands[item.action];
  if (command) await command();
}

function toggleTheme() {
  const preferences = savePreferences({
    ...state.preferences,
    theme: state.preferences.theme === 'dark' ? 'light' : 'dark',
  });
  setState({ preferences });
  applyPreferences(preferences);
  renderApp();
}

async function openTaskDrawer(taskId, { multi = false } = {}) {
  if (multi) {
    const next = state.multiSelectIds.includes(taskId)
      ? state.multiSelectIds.filter(id => id !== taskId)
      : [...state.multiSelectIds, taskId];
    setState({ multiSelectIds: next });
    renderApp();
    return true;
  }
  const task = taskById(taskId);
  if (!task) return false;
  if (state.drawerTaskId === taskId) return true;
  if (state.drawerTaskId && !(await flushTaskDrawerDraft())) {
    showToast('Save the open task draft before switching tasks.');
    return false;
  }
  seedTaskDrawerDraft(task);
  setState({
    drawerTaskId: taskId,
    selectedTaskId: taskId,
    taskDocuments: [],
    taskChecklist: [],
    taskActivity: [],
  });
  renderApp();
  loadDrawerContext(taskId);
  return true;
}

async function closeTaskDrawer() {
  if (!state.drawerTaskId) return true;
  if (!(await flushTaskDrawerDraft())) {
    showToast(['recovered', 'conflict'].includes(state.taskDraftRecoveryReason)
      ? 'Review and save the recovered task draft before closing.'
      : 'Save this task draft before closing.');
    return false;
  }
  setState({ drawerTaskId: null, taskNotesDraftId: null, taskLabelDraftId: null, taskLabelDraft: '' });
  renderApp();
  return true;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleAction(action, el, event) {
  switch (action) {
    // ---- navigation ----
    case 'nav-today': await navigateTopLevel({ navType: 'today', selectedTaskId: null, multiSelectIds: [] }); break;
    case 'nav-all': await navigateTopLevel({ navType: 'all' }); break;
    case 'manage-projects':
      if (await navigateTopLevel({ navType: 'all' })) openConfirm(newProjectDialog());
      break;
    case 'nav-library': await goLibrary(); break;
    case 'nav-calendar': await navigateTopLevel({ navType: 'calendar', selectedTaskId: null, multiSelectIds: [], calendarSelectedDay: null }); break;
    case 'calendar-prev':
    case 'calendar-next': {
      const current = state.calendarMonth || monthKeyOf(new Date());
      setState({ calendarMonth: shiftMonthKey(current, action === 'calendar-next' ? 1 : -1), calendarSelectedDay: null });
      renderApp();
      break;
    }
    case 'calendar-today': setState({ calendarMonth: null, calendarSelectedDay: null }); renderApp(); break;
    case 'calendar-select-day': {
      const day = el.dataset.day;
      setState({ calendarSelectedDay: state.calendarSelectedDay === day ? null : day });
      renderApp();
      break;
    }
    case 'copy-ics-url': {
      const ok = await copyToClipboard(el.dataset.url || '');
      showToast(ok ? 'Feed URL copied' : 'Could not copy');
      break;
    }
    case 'nav-filter': await goFilter(); break;
    case 'nav-settings': await goSettings(); loadCaptureShortcut(); break;
    case 'toggle-section': {
      setState({ collapsedSections: saveCollapsed(toggleCollapsed(state.collapsedSections, el.dataset.sectionKey)) });
      renderApp();
      break;
    }
    case 'toggle-pin': {
      event.stopPropagation();
      setState({ pinned: savePinned(togglePinned(state.pinned, el.dataset.kind, el.dataset.key)) });
      renderApp();
      break;
    }
    case 'set-panel-tab': {
      const tab = el.dataset.tab === 'views' ? 'views' : 'projects';
      // Switching tabs clears the filter — a projects query rarely means
      // anything against views, and stale filters read as missing data.
      setState({ panelTab: tab, panelFilter: '' });
      renderApp();
      break;
    }
    case 'select-smart-view': {
      const view = findSmartView(state.taskSmartViews, el.dataset.viewId);
      if (view) await goFilter({ expr: view.expr, smartViewId: view.id });
      break;
    }
    case 'delete-smart-view': {
      event.stopPropagation();
      const id = el.dataset.viewId;
      setState({ taskSmartViews: state.taskSmartViews.filter(v => v.id !== id) });
      if (state.activeSmartViewId === id) setState({ activeSmartViewId: null });
      persistSmartViews();
      renderApp();
      break;
    }
    case 'save-smart-view': {
      if (!el.dataset.confirmed) {
        openConfirm({
          message: 'Name this smart view',
          okLabel: 'Save view', action: 'save-smart-view',
          input: { value: '', placeholder: 'View name (or Folder/Name)' },
        });
        break;
      }
      const name = (appRoot.querySelector('[data-confirm-input]')?.value || '').trim();
      setState({ confirm: null });
      const view = name ? createSmartView(name, state.activeFilterExpr) : null;
      if (view) {
        setState({ taskSmartViews: [...state.taskSmartViews.filter(v => v.id !== view.id), view], activeSmartViewId: view.id });
        persistSmartViews();
      }
      renderApp();
      break;
    }
    case 'nl-filter': await runNlFilter(); break;
    case 'restore-nl-query': {
      const source = state.nlFilterSource;
      if (source != null) {
        setState({ activeFilterExpr: source, activeSmartViewId: null, ...nlFilterResetPatch() });
        renderApp();
        const input = appRoot.querySelector('[data-filter-input]');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      }
      break;
    }
    case 'drop-nl-field': {
      if (!state.nlCaptureFields || state.captureSubmitting) break;
      const fields = { ...state.nlCaptureFields };
      delete fields[el.dataset.field];
      if (el.dataset.field === 'dueDate') delete fields.dueTime; // a time needs its date
      setState({ nlCaptureFields: fields, ...clearCaptureRequestPatch() });
      persistCaptureRecovery();
      renderApp();
      break;
    }
    case 'drop-nl-label': {
      if (!state.nlCaptureFields || state.captureSubmitting) break;
      const labels = (state.nlCaptureFields.labels || []).filter((l) => l !== el.dataset.value);
      const fields = { ...state.nlCaptureFields };
      if (labels.length) fields.labels = labels;
      else delete fields.labels;
      setState({ nlCaptureFields: fields, ...clearCaptureRequestPatch() });
      persistCaptureRecovery();
      renderApp();
      break;
    }
    case 'set-settings-tab': {
      setState({ settingsTab: el.dataset.tab });
      // Integrations loads lazily: fetch the Google Calendar status the first
      // time the tab opens (goSettings also primes it on entering Settings).
      if (el.dataset.tab === 'integrations' && !state.googleCalendarStatus) {
        loadGoogleCalendarStatus().then(renderApp);
      }
      renderApp();
      break;
    }
    case 'refresh-deployment-status': loadDeploymentStatus().then(renderApp); renderApp(); break;
    case 'nav-project': await goProject(el.dataset.projectId); break;
    case 'rename-project': startRenameProject(el.dataset.projectId); break;
    case 'reveal-ops-field': {
      // Show the input for an unset ops field and put the caret in it. The
      // reveal is session state: it survives re-renders until navigation.
      const key = revealKey(el.dataset.projectId, el.dataset.field);
      if (!state.revealedOpsFields.includes(key)) setState({ revealedOpsFields: [...state.revealedOpsFields, key] });
      renderApp();
      const attr = opsFieldAttr(el.dataset.field);
      if (attr) document.querySelector(`#proj-ops-${CSS.escape(el.dataset.projectId)} input[${attr}]`)?.focus();
      break;
    }
    case 'set-tab': {
      const tab = el.dataset.tab;
      setState({ tab, selectedTaskId: null, multiSelectIds: [] });
      if (tab === 'archive') await loadArchivedTasks();
      renderApp();
      break;
    }
    case 'cycle-group':
      setState({ groupBy: { due: 'priority', priority: 'status', status: 'due' }[state.groupBy] });
      renderApp();
      break;
    case 'show-more-tasks':
      taskCollectionWindow.limit += TASK_RENDER_BATCH_SIZE;
      renderApp();
      break;
    case 'select-saved-view': {
      const view = state.librarySavedViews[Number(el.dataset.viewIndex)];
      if (view) await goLibrary({ activeLibraryTags: [...view.tags] });
      break;
    }
    case 'open-palette':
      if (state.captureSubmitting) break;
      if (state.captureOpen) discardCapture();
      setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0, paletteScope: 'all' });
      renderApp();
      break;
    case 'open-capture': openFreshCapture(); break;
    case 'toggle-capture-menu':
      if (!state.captureSubmitting) { setState({ captureMenuOpen: !state.captureMenuOpen }); renderApp(); }
      break;
    case 'set-capture-project':
      if (!state.captureSubmitting) {
        setState({ captureProjectId: el.dataset.projectId, captureMenuOpen: false, ...clearCaptureRequestPatch() });
        persistCaptureRecovery();
        renderApp();
      }
      break;
    case 'toggle-theme': toggleTheme(); break;

    // ---- tasks ----
    case 'open-task': await openTaskDrawer(el.dataset.taskId, { multi: event.metaKey || event.shiftKey || event.ctrlKey }); break;
    case 'toggle-task-selection': {
      event.stopPropagation();
      await openTaskDrawer(el.dataset.taskId, { multi: true });
      break;
    }
    case 'toggle-task-done': event.stopPropagation(); toggleTaskDone(el.dataset.taskId); break;
    case 'promote-task':
      event.stopPropagation();
      await patchTask(el.dataset.taskId, { status: apiStatus('planned') });
      showToast('Promoted to board');
      break;
    case 'restore-task': {
      event.stopPropagation();
      const id = el.dataset.taskId || state.drawerTaskId;
      try {
        await restoreTask(id);
        setState({ drawerTaskId: null, taskLabelDraftId: null, taskLabelDraft: '' });
        await loadTasks();
        await loadArchivedTasks();
        showToast('Restored');
      } catch { alertError('restore the selected task'); }
      renderApp();
      break;
    }
    case 'delete-archived-task': {
      event.stopPropagation();
      const id = el.dataset.taskId || state.drawerTaskId;
      const task = taskById(id);
      if (!el.dataset.confirmed) {
        openConfirm({
          message: `Permanently delete "${task?.title || 'this task'}"? This cannot be undone.`,
          okLabel: 'Delete', danger: true,
          action: 'delete-archived-task', data: { 'task-id': id || '' },
        });
        break;
      }
      setState({ confirm: null });
      try {
        await deleteArchivedTask(id);
        clearTaskDraftRecovery(taskDraftStorage(), id);
        setState({ drawerTaskId: null, taskNotesDraftId: null, taskLabelDraftId: null, taskLabelDraft: '' });
        await loadArchivedTasks();
      } catch { alertError('delete the archived task'); }
      renderApp();
      break;
    }
    case 'bulk-complete': bulkSetStatus('completed', 'Completed'); break;
    case 'bulk-backlog': bulkSetStatus('backlog', 'Backlog'); break;
    case 'bulk-archive': bulkArchive(); break;
    case 'archive-group': {
      // "Archive all" on a done group header: every task the group holds right
      // now, through the same undoable path as the bulk bar.
      const group = buildListGroups(state, projectTasks(), { now: new Date() }).groups
        .find((candidate) => candidate.key === el.dataset.groupKey);
      if (group?.tasks.length) await archiveSelectedTasks(group.tasks.map((task) => task.id));
      break;
    }
    case 'clear-selection': setState({ multiSelectIds: [], selectedTaskId: null }); renderApp(); break;

    // ---- drawer ----
    case 'close-drawer': await closeTaskDrawer(); break;
    // Explicit exit from a failed/recovered/conflict draft (incl. the
    // missing-task fallback drawer): drop the device copy after confirming,
    // reset the draft from the live task, or close outright when the task is
    // gone — the trap was a veto loop with no discard affordance.
    case 'discard-task-draft': {
      const confirmed = el.dataset.confirmed === '1';
      if (!confirmed) {
        openConfirm({
          message: 'Discard the unsaved task draft? The copy kept on this device will be deleted.',
          okLabel: 'Discard draft',
          action: 'discard-task-draft',
        });
        break;
      }
      setState({ confirm: null });
      const taskId = state.taskNotesDraftId || state.drawerTaskId;
      if (taskId) clearTaskDraftRecovery(taskDraftStorage(), taskId);
      const live = taskId ? taskById(taskId) : null;
      if (live) {
        seedTaskDrawerDraft(live);
        setTaskDraftStatusInPlace('Draft discarded');
      } else {
        setState({
          drawerTaskId: null, taskNotesDraftId: null, taskDraftBaseline: null,
          taskTitleDraft: '', taskDescriptionDraft: '', taskNotesDraft: '',
          isTaskNotesDirty: false, taskDraftRecoveryReason: null,
          taskDraftSaveStatus: 'Saved', isTaskDraftStored: true,
          taskLabelDraftId: null, taskLabelDraft: '',
        });
      }
      renderApp();
      break;
    }
    // Missing-task fallback: keep the device copy (it re-offers if the task
    // is ever restored) but release the in-memory drawer state so the app is
    // navigable again.
    case 'keep-task-draft-close': {
      setState({
        drawerTaskId: null, taskNotesDraftId: null, taskDraftBaseline: null,
        isTaskNotesDirty: false, taskDraftRecoveryReason: null,
        taskDraftSaveStatus: 'Saved',
        taskLabelDraftId: null, taskLabelDraft: '',
      });
      renderApp();
      break;
    }
    case 'retry-task-draft-save': {
      const confirmed = el.dataset.confirmed === '1';
      if (confirmed) {
        setState({ confirm: null });
        renderApp();
      }
      await requestTaskDraftSave({ confirmed });
      break;
    }
    case 'set-task-status': {
      const before = taskById(state.drawerTaskId);
      const saved = await patchTask(state.drawerTaskId, { status: el.dataset.status });
      if (before && saved && before.status !== saved.status) {
        if (saved.status === 'completed' && saved.nextOccurrenceTaskId) {
          showToast(saved.lifecycleRefreshFailed
            ? 'Completed — next occurrence scheduled; reload to show it.'
            : 'Completed — next occurrence scheduled.');
        } else if (saved.status === 'completed' && saved.recurrence) {
          showToast('Completed — but the next occurrence could not be scheduled.');
        } else if (before.status === 'completed' && before.recurrence) {
          showToast('Reopened as one-off — future occurrences are unchanged.');
        }
      }
      break;
    }
    case 'set-task-priority': await patchTask(state.drawerTaskId, { priority: el.dataset.priority }); break;
    case 'set-task-recurrence': await patchTask(state.drawerTaskId, { recurrence: el.dataset.recurrence }); break;
    case 'remove-task-label': {
      const task = taskById(state.drawerTaskId);
      if (task) await patchTask(state.drawerTaskId, { labels: (task.labels || []).filter(l => l !== el.dataset.label) });
      break;
    }
    case 'clear-task-due': await patchTask(state.drawerTaskId, { dueDate: null, dueTime: null }); break;
    case 'snooze-task':
      await patchTask(el.dataset.taskId || state.drawerTaskId, { deferredUntil: snoozeUntil(el.dataset.snooze) }, { failure: 'snooze the task' });
      renderApp();
      break;
    case 'unsnooze-task':
      await patchTask(el.dataset.taskId || state.drawerTaskId, { deferredUntil: '' }, { failure: 'unsnooze the task' });
      renderApp();
      break;
    case 'add-checklist-item': {
      const input = appRoot.querySelector('[data-checklist-new]');
      const label = (input?.value || '').trim();
      if (!label) break;
      try {
        await addChecklistItem(state.drawerTaskId, label);
        setState({
          taskChecklist: await fetchTaskChecklist(state.drawerTaskId),
          ...clearTaskBoardExtra(state, state.drawerTaskId),
        });
      } catch { alertError('add the checklist item'); }
      renderApp();
      break;
    }
    case 'toggle-checklist-item': {
      event.stopPropagation();
      const completed = el.dataset.completed !== 'true';
      try {
        await setChecklistItem(state.drawerTaskId, el.dataset.itemId, completed);
        setState({
          taskChecklist: await fetchTaskChecklist(state.drawerTaskId),
          ...clearTaskBoardExtra(state, state.drawerTaskId),
        });
      } catch { alertError('update the checklist item'); }
      renderApp();
      break;
    }
    case 'delete-checklist-item': {
      event.stopPropagation();
      try {
        await deleteChecklistItem(state.drawerTaskId, el.dataset.itemId);
        setState({
          taskChecklist: await fetchTaskChecklist(state.drawerTaskId),
          ...clearTaskBoardExtra(state, state.drawerTaskId),
        });
      } catch { alertError('delete the checklist item'); }
      renderApp();
      break;
    }
    case 'open-linked-doc': {
      event.stopPropagation();
      if (!(await flushTaskDrawerDraft())) {
        showToast('Save this task draft before opening its linked document.');
        break;
      }
      setState({ drawerTaskId: null, taskNotesDraftId: null, taskLabelDraftId: null, taskLabelDraft: '' });
      await openDocumentInEditor(el.dataset.documentId);
      break;
    }
    case 'unlink-task-document': {
      event.stopPropagation();
      try {
        const documents = await unlinkTaskDocument(state.drawerTaskId, el.dataset.documentId);
        setState({ taskDocuments: documents, ...clearTaskBoardExtra(state, state.drawerTaskId) });
      } catch { alertError('unlink the document'); }
      renderApp();
      break;
    }
    case 'open-link-picker': {
      try {
        const documents = await fetchDocuments({ archived: false });
        setState({ isLinkPickerOpen: true, pickerMode: 'link', linkPickerDocuments: documents, linkPickerQuery: '' });
      } catch { alertError('load documents to link'); }
      renderApp();
      break;
    }
    case 'close-link-picker': setState({ isLinkPickerOpen: false }); renderApp(); break;
    case 'archive-task': archiveTaskWithUndo(state.drawerTaskId); break;

    // ---- library ----
    case 'open-doc': await openDocumentInEditor(el.dataset.documentId); break;
    case 'open-ask-prax': openAskPrax(); break;
    case 'close-ask-prax': closeAskPrax(); break;
    case 'run-ask-prax': runAskPrax(appRoot.querySelector('[data-ask-prax-input]')?.value); break;
    case 'open-ask-source': {
      const documentId = el.dataset.documentId;
      closeAskPrax();
      if (documentId) await openDocumentInEditor(documentId);
      break;
    }
    case 'copy-ask-prax': copyAskPrax(); break;
    case 'open-generate-runbook': openGenerateRunbook(); break;
    case 'close-generate-runbook': setState({ genRbOpen: false }); renderApp(); break;
    case 'run-generate-runbook': runGenerateRunbook(); break;
    case 'open-daily-brief': openDailyBrief(); break;
    case 'close-daily-brief': setState({ dailyBriefOpen: false }); renderApp(); break;
    case 'link-related-doc': {
      event.stopPropagation();
      const documentId = el.dataset.documentId;
      const taskId = state.drawerTaskId;
      if (!documentId || !taskId) break;
      try {
        const documents = await linkTaskDocument(taskId, documentId);
        setState({
          taskDocuments: documents,
          taskRelatedDocs: state.taskRelatedDocs && state.taskRelatedDocs.taskId === taskId
            ? { ...state.taskRelatedDocs, suggestions: state.taskRelatedDocs.suggestions.filter((doc) => doc.id !== documentId) }
            : state.taskRelatedDocs,
        });
        showToast('Linked.');
      } catch {
        showToast('Could not link the document.');
      }
      renderApp();
      break;
    }
    case 'dismiss-related-doc': {
      event.stopPropagation();
      const documentId = el.dataset.documentId;
      const taskId = state.drawerTaskId;
      if (!documentId || !taskId) break;
      relatedDismissed.add(`${taskId}:${documentId}`);
      if (state.taskRelatedDocs?.taskId === taskId) {
        setState({ taskRelatedDocs: { ...state.taskRelatedDocs, suggestions: state.taskRelatedDocs.suggestions.filter((doc) => doc.id !== documentId) } });
      }
      renderApp();
      break;
    }
    case 'start-working-note': {
      const taskId = state.drawerTaskId;
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) break;
      const project = projectsById()[task.projectId];
      try {
        const doc = await createDocument({
          title: `Working note — ${task.title || 'Untitled task'}`,
          project: project?.slug || project?.id || 'inbox',
          documentType: 'note',
          body: `# Working note — ${task.title || 'Untitled task'}

_Task:_ ${task.title || 'Untitled task'}`
            + `${project ? ` _(${project.name})_` : ''}

## Context


## Findings

`,
        });
        await linkTaskDocument(taskId, doc.id).catch(() => {});
        await loadDocuments();
        await openDocumentInEditor(doc.id);
        showToast('Working note created and linked.');
      } catch (err) {
        showToast(err?.message || 'Could not create the working note.');
      }
      break;
    }
    case 'apply-capture-shortcut': {
      const input = appRoot.querySelector('[data-capture-shortcut]');
      if (!input) break;
      const shortcut = input.value.trim();
      try {
        const saved = await saveCaptureShortcut(shortcut);
        let notice;
        if (window.__TAURI__?.core?.invoke) {
          try {
            await window.__TAURI__.core.invoke('set_capture_shortcut', { shortcut });
            notice = shortcut ? `Registered ${shortcut}.` : 'Shortcut off — the tray Capture item still works.';
          } catch (err) {
            // Saved but NOT registered: the shell's verdict is the truth.
            notice = `Saved, but not active: ${String(err)}`;
          }
        } else {
          notice = 'Saved. Takes effect in the desktop app.';
        }
        setState({ captureShortcut: saved, captureShortcutNotice: notice });
      } catch (err) {
        setState({ captureShortcutNotice: err?.message || 'Could not save the shortcut.' });
      }
      renderApp();
      break;
    }
    case 'generate-weekly-review': {
      if (el.dataset.busy) break;
      el.dataset.busy = '1';
      showToast('Compiling the week…');
      try {
        const result = await generateWeeklyReview();
        if (result.degraded) {
          showToast(result.message || 'Weekly review unavailable.');
          // A verified review still exists — open it so the refusal is legible.
          if (result.documentId) await openDocumentInEditor(result.documentId);
        } else {
          await loadDocuments();
          showToast(result.created ? 'Weekly review created.' : 'Weekly review updated.');
          await openDocumentInEditor(result.documentId);
        }
      } catch {
        showToast('Weekly review failed — Prax may be unreachable.');
      } finally {
        delete el.dataset.busy;
      }
      break;
    }
    case 'open-plan-mode': openPlanMode(); break;
    case 'open-shutdown': openShutdown(); break;
    case 'close-plan-mode': {
      if (el.dataset.overlay === 'planmode' && event.target !== el) break; // backdrop only
      setState({ planMode: null }); renderApp(); break;
    }
    case 'plan-mode-add': await planModeAct('add'); break;
    case 'plan-mode-today': await planModeAct('today'); break;
    case 'plan-mode-drop': await planModeAct('drop'); break;
    case 'plan-mode-skip': await planModeAct('skip'); break;
    case 'shutdown-carry': await planModeAct('carry'); break;
    case 'shutdown-reschedule': await planModeAct('reschedule'); break;
    case 'shutdown-drop': await planModeAct('drop'); break;
    case 'draft-daily-brief': draftDailyBrief(); break;
    case 'copy-daily-brief': copyDailyBrief(); break;
    case 'open-assistant': openAssistant(); break;
    case 'close-assistant': setState({ assistantOpen: false }); renderApp(); break;
    case 'assistant-send': sendAssistant(appRoot.querySelector('[data-assistant-input]')?.value); break;
    case 'assistant-suggest': sendAssistant(el.dataset.suggest); break;
    case 'assistant-approve': resolveAssistantWrites('approve'); break;
    case 'assistant-decline': resolveAssistantWrites('deny'); break;
    case 'assistant-clear': clearAssistant(); break;
    case 'toggle-semantic': setState({ librarySemantic: !state.librarySemantic, ...resetSemanticSearchPatch() }); renderApp(); break;
    case 'load-more-semantic': runSemanticSearch({ append: true }); break;
    case 'show-more-library':
      libraryCollectionWindow.limit += LIBRARY_RENDER_BATCH_SIZE;
      renderApp();
      break;
    case 'cycle-lib-sort': setState({ librarySortBy: state.librarySortBy === 'updated' ? 'title' : 'updated' }); renderApp(); break;
    case 'toggle-lib-tag': {
      const tag = el.dataset.tag;
      const active = state.activeLibraryTags.includes(tag);
      setState({
        activeLibraryTags: active
          ? state.activeLibraryTags.filter(t => t !== tag)
          : [...state.activeLibraryTags, tag],
      });
      renderApp();
      break;
    }
    case 'toggle-lib-type': {
      const key = el.dataset.facet;
      const active = state.libraryTypes.includes(key);
      setState({ libraryTypes: active ? state.libraryTypes.filter(t => t !== key) : [...state.libraryTypes, key] });
      renderApp();
      break;
    }
    case 'toggle-lib-trust': {
      const key = el.dataset.facet;
      const active = state.libraryTrust.includes(key);
      setState({ libraryTrust: active ? state.libraryTrust.filter(t => t !== key) : [...state.libraryTrust, key] });
      renderApp();
      break;
    }
    case 'toggle-lib-project': {
      const key = el.dataset.facet;
      const active = state.libraryProjects.includes(key);
      setState({ libraryProjects: active ? state.libraryProjects.filter(id => id !== key) : [...state.libraryProjects, key] });
      renderApp();
      break;
    }
    case 'toggle-lib-tags': setState({ libraryTagsExpanded: !state.libraryTagsExpanded }); renderApp(); break;
    case 'clear-lib-filters': setState({ libraryQuery: '', activeLibraryTags: [], libraryTypes: [], libraryTrust: [], libraryProjects: [], ...resetSemanticSearchPatch() }); renderApp(); break;
    case 'toggle-new-doc-menu': setState({ newDocMenuOpen: !state.newDocMenuOpen }); renderApp(); break;
    case 'toggle-library-menu': setState({ libraryMenuOpen: !state.libraryMenuOpen, newDocMenuOpen: false }); renderApp(); break;
    case 'new-document': createNewDocument(el.dataset.templateId); break;
    case 'import-documents': setState({ libraryMenuOpen: false }); openMarkdownImport(); break;
    case 'close-markdown-import': closeMarkdownImport(); break;
    case 'submit-markdown-import': await submitMarkdownImport(); break;
    case 'export-library': setState({ libraryMenuOpen: false }); openLibraryExport('all', action); break;
    case 'close-library-export': closeLibraryExport(); break;
    case 'submit-library-export': await submitLibraryExport(); break;
    case 'save-library-view': {
      if (!el.dataset.confirmed) {
        openConfirm({
          message: 'Name this view',
          okLabel: 'Save view', action: 'save-library-view',
          input: { value: state.activeLibraryTags.join(' + '), placeholder: 'View name' },
        });
        break;
      }
      const name = (appRoot.querySelector('[data-confirm-input]')?.value || '').trim();
      setState({ confirm: null });
      if (name) {
        const view = createSavedLibraryView(name, state.activeLibraryTags);
        if (view) {
          setState({ librarySavedViews: [...state.librarySavedViews.filter(v => v.id !== view.id), view] });
          persistSavedViews();
        }
      }
      renderApp();
      break;
    }
    case 'delete-library-view': {
      const index = Number(el.dataset.viewIndex);
      setState({ librarySavedViews: state.librarySavedViews.filter((_, i) => i !== index) });
      persistSavedViews();
      renderApp();
      break;
    }
    case 'toggle-library-view': {
      setState({ libraryMenuOpen: false });
      setState({ libraryView: state.libraryView === 'archive' ? 'active' : 'archive', ...resetSemanticSearchPatch() });
      await loadDocuments();
      renderApp();
      break;
    }
    case 'restore-document': {
      const id = el.dataset.documentId || state.editorDocId;
      await performDocumentLifecycleOnce(`document:${id}`, () => restoreKnowledgeDocument(id));
      break;
    }
    case 'delete-document': {
      const id = el.dataset.documentId || state.editorDocId;
      if (!el.dataset.confirmed) {
        openConfirm({
          message: 'Permanently delete this document? This cannot be undone.',
          okLabel: 'Delete', danger: true,
          action: 'delete-document', data: { 'document-id': id || '' },
        });
        break;
      }
      setState({ confirm: null });
      await performDocumentLifecycleOnce(`document:${id}`, () => deleteKnowledgeDocument(id));
      break;
    }

    // ---- editor ----
    case 'back-to-library': await goLibrary(); break;
    // Explicit exit from a failed/recovered/conflict document draft: without
    // it, a doc archived/deleted externally left the retry failing forever
    // and every navigation vetoed — only a reload escaped.
    case 'discard-document-draft': {
      const confirmed = el.dataset.confirmed === '1';
      if (!confirmed) {
        openConfirm({
          message: 'Discard the unsaved changes to this document? The draft kept on this device will be deleted.',
          okLabel: 'Discard draft',
          action: 'discard-document-draft',
        });
        break;
      }
      setState({ confirm: null });
      const docId = state.documentDraftId || state.editorDocId;
      if (docId) clearDocumentDraftRecovery(documentDraftStorage(), docId);
      const doc = (state.documents || []).find((d) => d.id === docId) || null;
      if (doc) {
        setState({
          documentDraftBase: doc,
          documentDraftTitle: doc.title || '',
          documentDraftBody: doc.body || '',
          isDocumentDirty: false,
          documentDraftRecoveryReason: null,
          documentSaveStatus: 'Draft discarded',
          isDocumentDraftStored: true,
        });
        renderApp();
      } else {
        // The document is gone — release the draft state and leave.
        setState({
          isDocumentDirty: false,
          documentDraftRecoveryReason: null,
          documentSaveStatus: 'Saved',
          isDocumentDraftStored: true,
        });
        await goLibrary();
      }
      break;
    }
    case 'retry-document-save': {
      const confirmed = el.dataset.confirmed === '1';
      if (confirmed) {
        setState({ confirm: null });
        renderApp();
      }
      await requestDocumentDraftSave({ confirmed });
      break;
    }
    case 'set-editor-mode': destroyEditorController(); setState({ editorMode: el.dataset.mode }); renderApp(); break;
    case 'toggle-outline': setState({ outlineOpen: !state.outlineOpen }); renderApp(); break;
    // ---- editor find/replace ----
    case 'close-editor-search': closeEditorSearch(); break;
    case 'search-next': runSearchCommand('next'); break;
    case 'search-previous': runSearchCommand('previous'); break;
    case 'search-replace': runSearchCommand('replace'); break;
    case 'search-replace-all': runSearchCommand('replace-all'); break;
    case 'search-toggle-case': toggleSearchOption('searchCaseSensitive', el); break;
    case 'search-toggle-word': toggleSearchOption('searchWholeWord', el); break;
    case 'search-toggle-regexp': toggleSearchOption('searchRegexp', el); break;
    case 'toggle-focus': destroyEditorController(); setState({ editorFocus: !state.editorFocus }); renderApp(); break;
    case 'export-doc': triggerLibraryDocumentDownload(state.editorDocId); break;
    case 'copy-code': {
      const code = el.closest('.code-block')?.querySelector('code')?.textContent ?? '';
      copyToClipboard(code).then((ok) => showToast(ok ? 'Copied to clipboard' : 'Could not copy'));
      break;
    }
    case 'md-format': applyEditorFormat(el.dataset.mdAction); break;
    case 'toggle-write-menu': {
      // Capture the selection NOW — renderApp() below re-mounts the editor and
      // clears it, so runWrite (fired later from the menu) can't read it live.
      const opening = !state.writeMenuOpen;
      const range = opening ? (documentEditorController?.getSelectionRange?.() || null) : null;
      const selText = opening && range ? String(documentEditorController?.getSelectionText?.() || '') : '';
      setState({ writeMenuOpen: opening, writeSelection: opening && range && selText.trim() ? { from: range.from, to: range.to, text: selText } : null });
      renderApp();
      break;
    }
    case 'write-action': await runWrite(el.dataset.write); break;
    case 'apply-write': applyWrite(); break;
    case 'copy-write': copyWrite(); break;
    case 'close-write': closeWrite(); break;
    case 'outline-jump': {
      const index = Number(el.dataset.headingIndex);
      const preview = appRoot.querySelector('[data-markdown-preview]');
      const heading = preview?.querySelectorAll('h1, h2, h3')?.[index];
      if (heading) {
        heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (documentEditorController?.scrollToLine) {
        // Edit mode has no preview pane — jump the CodeMirror cursor to the
        // heading's source line instead.
        documentEditorController.scrollToLine(Number(el.dataset.line));
      }
      break;
    }
    case 'toggle-md-check': toggleMarkdownCheck(Number(el.dataset.line)); break;
    case 'toggle-doc-menu': setState({ docMenuOpen: !state.docMenuOpen }); renderApp(); break;
    case 'edit-document-info': {
      if (state.isDocumentDirty) {
        if (['recovered', 'conflict'].includes(state.documentDraftRecoveryReason)) {
          showToast('Review and save the recovered draft before editing document info.');
          break;
        }
        if (!(await saveDocumentDraft())) break;
      }
      // Snapshot the refs the form is seeded from — save reconciles against
      // this snapshot, not live state, so a background refs load resolving
      // mid-edit can't shift what "removing a line" means. If the on-open
      // load hasn't landed (or failed), fetch now so the user edits the true
      // stored list; a null seed makes the save merge-only (no deletes).
      let seed = state.documentExternalRefs;
      if (!Array.isArray(seed)) {
        try {
          seed = await fetchExternalRefs(state.editorDocId);
          setState({ documentExternalRefs: seed });
        } catch { seed = null; }
      }
      // The form edits the record the editor is based on (the freshest
      // revision the client holds); an older cached row is refreshed first so
      // the conditional save is guarded by a real revision.
      let base = state.documentDraftBase?.id === state.editorDocId ? state.documentDraftBase : currentDocument();
      if (!base?.revision) { try { base = await fetchDocument(state.editorDocId); } catch { base = null; } }
      let documentInfoDraft;
      try {
        documentInfoDraft = openDocumentInfoDraft(base, { refs: seed });
      } catch (error) {
        showToast(error.message);
        break;
      }
      setState({ isDocumentInfoEditorOpen: true, documentInfoError: '', docMenuOpen: false, docInfoRefsSeed: seed, documentInfoDraft });
      renderApp();
      break;
    }
    case 'cancel-document-info': setState({ isDocumentInfoEditorOpen: false, documentInfoError: '', documentInfoDraft: null }); renderApp(); break;
    case 'doc-info-keep-theirs':
    case 'doc-info-keep-mine': {
      const draft = state.documentInfoDraft;
      if (!draft?.conflict) break;
      const keep = action === 'doc-info-keep-theirs' ? 'theirs' : 'mine';
      setState({
        documentInfoDraft: rebaseDocumentInfoDraft(draft, draft.conflict.remote, { keep, conflicts: draft.conflict.conflicts }),
        documentInfoError: '',
      });
      renderApp();
      break;
    }
    case 'save-document-info': {
      const opened = state.documentInfoDraft;
      const docId = state.editorDocId;
      if (!opened || opened.documentId !== docId) { setState({ documentInfoError: 'Reopen Document info before saving.' }); renderApp(); break; }
      if (opened.pending) break;
      const fields = normalizeInfoFields(opened.fields);
      if (!fields.title) { setState({ documentInfoError: 'Title is required.' }); renderApp(); break; }
      const refsSeed = state.docInfoRefsSeed;
      const inFlight = { ...opened, pending: true, conflict: null };
      setState({ documentInfoDraft: inFlight, documentInfoError: '' });
      renderApp();
      // Send only the fields that changed since the form's baseline, guarded
      // by the revision it was opened from.
      let working = inFlight;
      let patch = documentInfoPatch(working.baseline, fields);
      let outcome = Object.keys(patch).length > 1 ? await sendDocumentInfoPatch(docId, patch) : { saved: null };
      // A revision mismatch that does not contest my fields (a body edit, or a
      // tag change while I renamed) rebases onto the remote record and retries
      // once against ITS revision. A contested field stops for review instead.
      if (outcome.conflict && !mergeDocumentInfo(working.baseline, fields, outcome.conflict).conflicts.length) {
        rebaseEditorOnDocument(docId, outcome.conflict);
        working = rebaseDocumentInfoDraft(working, outcome.conflict, { keep: 'mine' });
        patch = documentInfoPatch(working.baseline, normalizeInfoFields(working.fields));
        outcome = Object.keys(patch).length > 1 ? await sendDocumentInfoPatch(docId, patch) : { saved: outcome.conflict };
      }
      const stillOpen = state.isDocumentInfoEditorOpen && state.documentInfoDraft === inFlight && state.editorDocId === docId;
      if (outcome.conflict) {
        const { conflicts } = mergeDocumentInfo(working.baseline, normalizeInfoFields(working.fields), outcome.conflict);
        rebaseEditorOnDocument(docId, outcome.conflict);
        if (stillOpen) setState({ documentInfoDraft: { ...working, pending: false, conflict: { remote: outcome.conflict, conflicts } }, documentInfoError: '' });
        else showToast('Document info was not saved: the document changed meanwhile. Reopen Document info to review.');
        renderApp();
        break;
      }
      if (outcome.error) {
        if (stillOpen) setState({ documentInfoDraft: { ...working, pending: false }, documentInfoError: 'Prax could not save document info. Your entries are kept — retry when ready.' });
        else showToast('Prax could not save document info.');
        renderApp();
        break;
      }
      if (outcome.saved) rebaseEditorOnDocument(docId, outcome.saved);
      // Metadata is acknowledged independently of reference writes and cache
      // refreshes. A later failure must not strand a committed form as pending.
      const acknowledged = outcome.saved
        ? rebaseDocumentInfoDraft(working, outcome.saved, { keep: 'mine' })
        : { ...working, pending: false };
      const refsFailed = await reconcileExternalRefs(docId, working.fields.refsText, refsSeed).catch(() => 1);
      let currentRefs = null;
      try { currentRefs = await fetchExternalRefs(docId); } catch { /* retain the known seed for retry */ }
      let refreshed = true;
      try { await loadDocuments(); } catch { refreshed = false; }
      if (state.documentInfoDraft === inFlight) {
        if (refsFailed) {
          setState({ documentInfoDraft: acknowledged, documentInfoError: `Document info saved. ${refsFailed} reference change${refsFailed === 1 ? '' : 's'} could not be confirmed; your entries are kept for retry.`, docInfoRefsSeed: currentRefs ?? refsSeed });
        } else {
          setState({ isDocumentInfoEditorOpen: false, documentInfoError: '', documentInfoDraft: null });
        }
      }
      if (state.editorDocId === docId && currentRefs) setState({ documentExternalRefs: currentRefs });
      if (!refreshed) showToast('Document info saved, but the library list could not be refreshed. Reload to reconcile it.', null, 7000);
      else if (refsFailed) showToast('Document info saved; some references still need retry.', null, 6000);
      renderApp();
      break;
    }
    case 'toggle-verify': {
      const doc = currentDocument();
      setState({ docMenuOpen: false });
      if (!doc) break;
      await performDocumentLifecycleOnce(`document:${doc.id}`, () => (
        changeDocumentVerification(doc.id, !doc.verified)
      ));
      break;
    }
    case 'supersede-document': {
      const doc = currentDocument();
      setState({ docMenuOpen: false });
      if (!doc) break;
      try {
        const documents = await fetchDocuments({ archived: false });
        setState({
          isLinkPickerOpen: true,
          pickerMode: 'supersede',
          linkPickerDocuments: documents.filter(d => d.projectId === doc.projectId && d.status === 'active' && d.id !== doc.id),
          linkPickerQuery: '',
        });
      } catch { alertError('load documents to supersede'); }
      renderApp();
      break;
    }
    case 'archive-document': {
      const doc = currentDocument();
      setState({ docMenuOpen: false });
      if (!doc) break;
      if (!(await prepareEditorNavigation())) break;
      await performDocumentLifecycleOnce(`document:${doc.id}`, () => archiveKnowledgeDocument(doc.id));
      break;
    }

    // ---- runbook execution ----
    case 'start-run': startRunForDocument(state.editorDocId); break;
    case 'open-run': openRun(el.dataset.runId, el.dataset.documentId || state.editorDocId); break;
    case 'toggle-run-step':
      event.stopPropagation();
      toggleRunStep(el.dataset.stepId, el.dataset.checked !== '1');
      break;
    case 'finish-run': endRun('completed'); break;
    case 'resume-run': endRun('running'); break;
    case 'abort-run':
      if (el.dataset.confirmed === '1') { endRun('aborted'); break; }
      openConfirm({ message: 'Abort this run? The chronicle so far is kept, but the run is marked aborted.', action: 'abort-run', okLabel: 'Abort run', danger: true });
      break;
    case 'copy-chronicle': copyRunChronicle(); break;
    case 'generate-post-mortem': generatePostMortem(el.dataset.runId); break;
    case 'back-from-run': await backFromRun(); break;

    // ---- all projects ----
    case 'open-project': await goProject(el.dataset.projectId); break;
    case 'set-project-state': {
      event.stopPropagation();
      try {
        await updateProject(el.dataset.projectId, { status: el.dataset.state });
        await loadProjects();
        showToast(`Project set to ${el.dataset.state.replace('-', ' ')}`);
      } catch { alertError('update the project'); }
      renderApp();
      break;
    }
    case 'create-project': {
      const confirmed = Boolean(el.dataset.confirmed);
      const name = (appRoot.querySelector(confirmed ? '[data-confirm-input]' : '[data-new-project-name]')?.value || '').trim();
      if (confirmed) setState({ confirm: null });
      if (!name) {
        // Empty name must never be a silent no-op: ask for one in-app.
        if (confirmed) { renderApp(); break; }
        openConfirm(newProjectDialog());
        break;
      }
      try {
        const project = await createProject(name);
        await loadProjects();
        await goProject(project.id);
        showToast(`Project "${name}" created`);
      } catch { alertError('create that project'); }
      break;
    }
    case 'delete-project': {
      event.stopPropagation();
      const target = (state.managedProjects || state.projects).find((p) => p.id === el.dataset.projectId);
      if (!el.dataset.confirmed) {
        const name = target ? `“${target.name}”` : 'this project';
        openConfirm({
          message: `Permanently delete ${name}? Every task and document filed under it is deleted with it. This cannot be undone.`,
          okLabel: 'Delete project', danger: true,
          action: 'delete-project', data: { 'project-id': el.dataset.projectId || '' },
        });
        break;
      }
      setState({ confirm: null });
      try {
        const result = await deleteProjectPermanent(el.dataset.projectId);
        await loadProjects();
        if (state.navType === 'project' && state.navId === el.dataset.projectId) setState({ navType: 'all', navId: null });
        await loadTasks({ announceReminders: false });
        showToast(deletedProjectMessage(result));
      } catch (err) {
        showToast(err?.message ? `Could not delete the project: ${err.message}` : 'Prax could not delete the project.');
      }
      renderApp();
      break;
    }

    // ---- palette / capture / toast ----
    case 'palette-run': await runPaletteItem(paletteFlat[Number(el.dataset.paletteIndex)]); break;
    case 'palette-scope': setPaletteScope(el.dataset.scope); break;
    case 'palette-task-done': {
      setState({ paletteOpen: false });
      await toggleTaskDone(el.dataset.taskId);
      break;
    }
    case 'close-palette': setState({ paletteOpen: false }); renderApp(); break;
    case 'close-capture': if (discardCapture()) renderCaptureOverlayLayer({ restoreFocus: true }); break;
    case 'submit-capture':
      if (state.captureSubmitting || state.nlCaptureLoading) break;
      if (state.nlCaptureFields) await confirmNlCapture();
      else await addQuickTask(state.captureQuery.trim());
      break;
    case 'confirm-cancel': setState({ confirm: null }); renderApp(); break;
    case 'open-shortcuts': openShortcuts(); break;
    case 'close-shortcuts': {
      // The scrim carries the action too; a click inside the dialog stays.
      if (el.dataset.overlay === 'shortcuts' && event.target !== el) break;
      setState({ shortcutsOpen: false }); renderApp(); break;
    }
    case 'toast-undo': state.toast?.undo?.(); break;

    // ---- settings ----
    case 'set-theme': case 'set-accent': case 'set-chrome': {
      const patch = action === 'set-theme'
        ? { theme: el.dataset.theme }
        : action === 'set-accent' ? { accent: el.dataset.accent } : { chromeOS: el.dataset.chrome };
      const preferences = savePreferences({ ...state.preferences, ...patch });
      setState({ preferences });
      applyPreferences(preferences);
      renderApp();
      break;
    }
    case 'toggle-line-numbers': {
      const preferences = savePreferences({ ...state.preferences, lineNumbers: !state.preferences.lineNumbers });
      setState({ preferences });
      renderApp();
      break;
    }
    case 'toggle-reminders': {
      const enabled = !state.preferences.reminders;
      const preferences = savePreferences({ ...state.preferences, reminders: enabled });
      setState({ preferences });
      if (enabled) checkDueReminders();
      renderApp();
      break;
    }
    case 'toggle-weekly-review-nudge': {
      setState({ preferences: savePreferences({ ...state.preferences, weeklyReviewNudge: !state.preferences.weeklyReviewNudge }) });
      renderApp();
      break;
    }
    case 'toggle-shutdown-nudge': {
      setState({ preferences: savePreferences({ ...state.preferences, shutdownNudge: !state.preferences.shutdownNudge }) });
      renderApp();
      break;
    }
    case 'toggle-slippage-chips': {
      setState({ preferences: savePreferences({ ...state.preferences, slippageChips: !state.preferences.slippageChips }) });
      renderApp();
      break;
    }
    case 'set-slippage-deferrals': {
      const value = Number(el.dataset.value);
      if (!SLIPPAGE_DEFERRAL_OPTIONS.includes(value)) break;
      setState({ preferences: savePreferences({ ...state.preferences, slippageDeferrals: value }) });
      renderApp();
      break;
    }
    case 'set-slippage-age': {
      const value = Number(el.dataset.value);
      if (!SLIPPAGE_AGE_OPTIONS.includes(value)) break;
      setState({ preferences: savePreferences({ ...state.preferences, slippageAgeDays: value }) });
      renderApp();
      break;
    }
    case 'set-wip-limit': {
      const value = Number(el.dataset.value);
      if (!WIP_LIMIT_OPTIONS.includes(value)) break;
      setState({ preferences: savePreferences({ ...state.preferences, wipLimit: value }) });
      renderApp();
      break;
    }
    case 'set-editor-font': {
      const preferences = savePreferences({ ...state.preferences, editorFont: el.dataset.font });
      setState({ preferences });
      applyPreferences(preferences); // flips <body data-editor-font> → --editor-font
      destroyEditorController(); // remount so CodeMirror re-measures the new font
      renderApp();
      break;
    }
    case 'set-preview-font': {
      const preferences = savePreferences({ ...state.preferences, previewFont: el.dataset.font });
      setState({ preferences });
      applyPreferences(preferences); // flips <body data-preview-font> → --prose-font (CSS-only)
      renderApp();
      break;
    }
    case 'enable-desktop-notifications': {
      // A user gesture — the only context in which the browser will show the
      // permission prompt. Once granted, checkDueReminders fires native ones.
      try { if (typeof Notification !== 'undefined') await Notification.requestPermission(); }
      catch { /* unsupported / dismissed */ }
      renderApp();
      break;
    }
    case 'reset-preferences': {
      const preferences = resetPreferences();
      setState({ preferences });
      applyPreferences(preferences);
      renderApp();
      break;
    }
    case 'set-ai-provider': {
      if (state.intelligenceSettingsPending || state.semanticStatus?.loadError) break;
      const patch = { backend: el.dataset.backend };
      setState({ intelligenceSettingsPending: true, semanticSettingsDraft: null });
      renderApp();
      try {
        const status = await putSemanticSettings(patch);
        setState({
          semanticStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          semanticSettingsDraft: null,
          librarySemantic: false,
          ...resetSemanticSearchPatch(),
        });
      } catch (err) {
        await reconcileSemanticSettingsMutation(patch, err);
        break;
      }
      renderApp();
      break;
    }
    case 'save-ai-provider': {
      if (state.intelligenceSettingsPending || state.semanticStatus?.loadError) break;
      const patch = {};
      const model = appRoot.querySelector('[data-ai-model]');
      if (model) patch.model = model.value.trim();
      const baseUrl = appRoot.querySelector('[data-ai-base-url]');
      // Only send a non-empty base URL: the server rejects '' as an invalid URL
      // (400), which would sink an otherwise model-only save. Mirrors the apiKey
      // guard below.
      if (baseUrl && baseUrl.value.trim()) patch.baseUrl = baseUrl.value.trim();
      const key = appRoot.querySelector('[data-ai-key]');
      if (key && key.value.trim()) patch.apiKey = key.value.trim();
      const draft = {
        backend: state.semanticStatus?.backend || 'none',
        model: model?.value || '',
        baseUrl: baseUrl?.value || '',
        apiKey: key?.value || '',
      };
      setState({ intelligenceSettingsPending: true, semanticSettingsDraft: draft });
      renderApp();
      try {
        const status = await putSemanticSettings(patch);
        setState({
          semanticStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          semanticSettingsDraft: null,
        });
        showToast(status.connected
          ? `Connected to ${status.backend} — embeddings ready.`
          : `Saved, but ${status.backend || 'the backend'} is not reachable yet.`);
      } catch (err) {
        await reconcileSemanticSettingsMutation(patch, err);
        break;
      }
      renderApp();
      break;
    }
    case 'toggle-semantic-search': {
      if (state.intelligenceSettingsPending || state.semanticStatus?.loadError) break;
      const patch = { enabled: !state.semanticStatus.enabled };
      setState({ intelligenceSettingsPending: true });
      renderApp();
      try {
        const status = await setSemanticEnabled(patch.enabled);
        setState({
          semanticStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          librarySemantic: false,
          ...resetSemanticSearchPatch(),
        });
      } catch (err) {
        await reconcileSemanticSettingsMutation(patch, err);
        break;
      }
      renderApp();
      break;
    }
    case 'set-ai-chat-provider': {
      if (state.intelligenceSettingsPending || state.chatStatus?.loadError) break;
      const patch = { backend: el.dataset.backend };
      setState({ intelligenceSettingsPending: true, chatSettingsDraft: null });
      renderApp();
      try {
        const status = await putChatSettings(patch);
        setState({
          chatStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          chatSettingsDraft: null,
        });
      } catch (err) {
        await reconcileChatSettingsMutation(patch, err);
        break;
      }
      renderApp();
      break;
    }
    case 'save-ai-chat': {
      if (state.intelligenceSettingsPending || state.chatStatus?.loadError) break;
      const patch = {};
      const model = appRoot.querySelector('[data-ai-chat-model]');
      if (model) patch.model = model.value.trim();
      const baseUrl = appRoot.querySelector('[data-ai-chat-base-url]');
      if (baseUrl && baseUrl.value.trim()) patch.baseUrl = baseUrl.value.trim();
      const key = appRoot.querySelector('[data-ai-chat-key]');
      if (key && key.value.trim()) patch.apiKey = key.value.trim();
      const binary = appRoot.querySelector('[data-ai-chat-binary]');
      if (binary) patch.binaryPath = binary.value.trim();
      const draft = {
        backend: state.chatStatus?.backend || 'none',
        model: model?.value || '',
        baseUrl: baseUrl?.value || '',
        apiKey: key?.value || '',
      };
      setState({ intelligenceSettingsPending: true, chatSettingsDraft: draft });
      renderApp();
      try {
        const status = await putChatSettings(patch);
        setState({
          chatStatus: { ...status, loading: false, loadError: '' },
          intelligenceSettingsPending: false,
          chatSettingsDraft: null,
        });
        showToast(status.connected
          ? `Connected to ${status.backend} — Ask Prax can write answers.`
          : `Saved, but ${status.backend || 'the model'} is not reachable yet.`);
      } catch (err) {
        await reconcileChatSettingsMutation(patch, err);
        break;
      }
      renderApp();
      break;
    }
    case 'retry-intelligence-status': {
      if (state.intelligenceSettingsPending) break;
      const semantic = loadSemanticStatus();
      const chat = loadChatStatus();
      renderApp();
      await Promise.all([semantic, chat]);
      renderApp();
      break;
    }
    // ---- Google Calendar integration ----
    // Every branch keeps failures out of the console: transport errors become
    // googleCalendarNotice text, mirroring the backend's degraded-not-crashed
    // contract.
    case 'retry-google-calendar-status': {
      if (state.googleCalendarPending) break;
      loadGoogleCalendarStatus().then(renderApp);
      renderApp();
      break;
    }
    case 'save-google-calendar': {
      if (state.googleCalendarPending) break;
      const draft = state.googleCalendarDraft || { clientId: '', clientSecret: '' };
      const patch = {};
      // Only send non-empty fields: PUT '' would wipe a saved value, and the
      // secret input is legitimately empty when '(saved)' is shown.
      if ((draft.clientId || '').trim()) patch.clientId = draft.clientId.trim();
      if ((draft.clientSecret || '').trim()) patch.clientSecret = draft.clientSecret.trim();
      if (!patch.clientId && !patch.clientSecret) {
        setState({ googleCalendarNotice: 'Enter the OAuth client id and secret before saving.' });
        renderApp();
        break;
      }
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Saving the OAuth client…' });
      renderApp();
      try {
        const status = await putGoogleCalendarSettings(patch);
        setState({
          googleCalendarStatus: { ...status, loading: false, loadError: '' },
          googleCalendarPending: false,
          // The secret is write-only: clear it from the draft once saved so a
          // later Save cannot resend a stale one — the field now shows the
          // '(saved)' placeholder instead.
          googleCalendarDraft: { clientId: draft.clientId, clientSecret: '' },
          googleCalendarNotice: status.configured
            ? 'OAuth client saved — click Connect to sign in with Google.'
            : 'Saved. Add the missing client id or secret to finish configuring.',
        });
      } catch (err) {
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: err?.message || 'Prax could not save the Google Calendar settings.',
        });
      }
      renderApp();
      break;
    }
    case 'connect-google-calendar': {
      if (state.googleCalendarPending) break;
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Starting Google sign-in…' });
      renderApp();
      try {
        const { authUrl } = await connectGoogleCalendar();
        window.open(authUrl, '_blank');
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: 'Waiting for the Google sign-in to finish in the opened tab…',
        });
        startGoogleCalendarPolling();
      } catch (err) {
        // 409 (not configured) surfaces the server's actionable message.
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: err?.message || 'Prax could not start the Google sign-in.',
        });
      }
      renderApp();
      break;
    }
    case 'sync-google-calendar': {
      if (state.googleCalendarPending) break;
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Syncing to Google Calendar…' });
      renderApp();
      let notice;
      try {
        const result = await syncGoogleCalendar();
        if (result.degraded && !result.summary) {
          // Whole-sync failure envelope { degraded, reason, message }.
          notice = `Sync failed: ${result.message || result.reason || 'Google Calendar failed'}`;
        } else {
          notice = `Synced: ${result.summary}`;
          if (result.degraded && Array.isArray(result.failures) && result.failures.length) {
            notice += `\n${result.failures
              .map((f) => `Failed: ${f.title || f.eventId || f.taskId || 'item'} — ${f.message || 'unknown error'}`)
              .join('\n')}`;
          }
        }
      } catch (err) {
        notice = err?.message || 'Google Calendar sync failed.';
      }
      // Refresh lastSyncAt/lastSyncSummary; a failed refresh keeps the old
      // status — the notice above already reports the sync outcome.
      try {
        setState({ googleCalendarStatus: { ...(await fetchGoogleCalendarStatus()), loading: false, loadError: '' } });
      } catch { /* keep the previous status */ }
      setState({ googleCalendarPending: false, googleCalendarNotice: notice });
      renderApp();
      break;
    }
    case 'disconnect-google-calendar': {
      if (!el.dataset.confirmed) {
        openConfirm({
          message: 'Disconnect Google Calendar? The “Prax” calendar stays in your Google account; Prax just stops pushing to it.',
          okLabel: 'Disconnect', danger: true,
          action: 'disconnect-google-calendar',
        });
        break;
      }
      setState({ confirm: null });
      if (state.googleCalendarPending) { renderApp(); break; }
      stopGoogleCalendarPolling();
      setState({ googleCalendarPending: true, googleCalendarNotice: 'Disconnecting…' });
      renderApp();
      try {
        const status = await disconnectGoogleCalendar();
        setState({
          googleCalendarStatus: { ...status, loading: false, loadError: '' },
          googleCalendarPending: false,
          googleCalendarNotice: 'Disconnected. The “Prax” calendar remains in Google Calendar.',
        });
      } catch {
        setState({
          googleCalendarPending: false,
          googleCalendarNotice: 'Prax could not disconnect Google Calendar. Reload the status and try again.',
        });
      }
      renderApp();
      break;
    }
    case 'reindex-embeddings': case 'force-reindex-embeddings': {
      const force = action === 'force-reindex-embeddings';
      if (force && !el.dataset.confirmed) {
        openConfirm({
          message: 'Rebuild embeddings for every document?',
          okLabel: 'Rebuild', action: 'force-reindex-embeddings',
        });
        break;
      }
      if (isReindexing) break; // ignore repeat clicks while one is running
      isReindexing = true;
      // Close the confirm dialog immediately and show progress — a rebuild can
      // take a while against a remote/large model, and leaving the dialog up (it
      // only closed after the whole run finished) read as "the button did
      // nothing". showToast re-renders, so the dialog is gone right away.
      if (state.confirm) setState({ confirm: null });
      showToast(force ? 'Rebuilding every embedding…' : 'Re-indexing…');
      try {
        const result = await reindexEmbeddings(force);
        await loadSemanticStatus();
        const embedded = Number(result?.embedded) || 0;
        const failed = Number(result?.failed) || 0;
        if (failed) {
          const reason = result?.sampleError ? ` (${result.sampleError})` : '';
          showToast(`Re-index: embedded ${embedded}, ${failed} failed${reason}`, null, 6000);
        } else if (embedded) {
          showToast(`Re-indexed ${embedded} document${embedded === 1 ? '' : 's'}.`);
        } else {
          showToast('Embeddings are already up to date.');
        }
      } catch { alertError('reindex embeddings'); }
      finally { isReindexing = false; }
      renderApp();
      break;
    }
    case 'export-project-tasks': exportTasksScoped(false); break;
    case 'export-all-tasks': exportTasksScoped(true); break;
    case 'import-tasks': importTasksFromSettings(); break;
    case 'export-library-project': {
      const slug = state.managedProjects.find(p => p.id === state.navId)?.slug || 'all';
      openLibraryExport(slug, action);
      break;
    }
    case 'export-library-all': openLibraryExport('all', action); break;
    case 'refresh-maintenance': await loadMaintenance(); renderApp(); break;
    case 'open-health': setState({ libraryMenuOpen: false }); await goHealth(); break;
    case 'refresh-health': await loadHealth(); renderApp(); break;
    case 'open-health-doc': await openDocumentInEditor(el.dataset.docId); break;
    case 'verify-health-doc': verifyHealthDoc(el.dataset.docId); break;
    case 'apply-wiki-link': await acceptLinkSuggestion(el.dataset.docId, el.dataset.title); break;
    case 'run-ai-review': await scanLibraryWithAi(); break;
    case 'open-library-doc': await openDocumentInEditor(el.dataset.libraryDocumentId); break;

    default: break;
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindEvents() {
  appRoot.addEventListener('click', (event) => {
    if ((state.docMenuOpen || state.newDocMenuOpen || state.libraryMenuOpen || state.captureMenuOpen || state.writeMenuOpen) && !event.target.closest?.('.menu')) {
      setState({ docMenuOpen: false, newDocMenuOpen: false, libraryMenuOpen: false, captureMenuOpen: false, writeMenuOpen: false, writeSelection: null });
      // A click on another control should both dismiss the open menu and
      // activate that control. Only consume clicks on otherwise inert space.
      if (!event.target.closest?.('[data-action], [data-link-picker-doc]')) {
        renderApp();
        return;
      }
    }
    const picker = event.target.closest?.('[data-link-picker-doc]');
    if (picker && appRoot.contains(picker)) {
      handleLinkPickerPick(picker.dataset.documentId);
      return;
    }
    const el = event.target.closest?.('[data-action]');
    if (el && appRoot.contains(el)) {
      // Overlay scrims (data-overlay) close only on direct clicks — clicks
      // inside the dialog bubble up here but must not dismiss it.
      if (el.dataset.overlay !== undefined && event.target !== el) return;
      handleAction(el.dataset.action, el, event);
      return;
    }
    // Clicking the blank page-sheet around the editor means "start typing" —
    // but NOT when the click lands in CodeMirror's own UI (the find/replace
    // panel lives inside .sheet), which manages its own focus. Forcing focus
    // back to the document there makes the search inputs untypable.
    if (state.navType === 'editor'
      && event.target.closest?.('.pane, .sheet')
      && !event.target.closest?.('.cm-panel')) {
      focusEditor();
    }
  });

  // Commit an inline project rename when its input loses focus (Enter blurs it;
  // Esc clears renamingProjectId first, so the commit below no-ops).
  appRoot.addEventListener('focusout', (event) => {
    const t = event.target;
    if (t?.matches?.('[data-project-rename]')) saveRenameProject(t.dataset.projectId, t.value);
  });

  appRoot.addEventListener('input', (event) => {
    const target = event.target;
    if (target.matches?.('[data-search-find]')) {
      setState({ searchQuery: target.value });
      scheduleSearchApply();
      return;
    }
    if (target.matches?.('[data-search-replace]')) {
      setState({ searchReplace: target.value });
      scheduleSearchApply();
      return;
    }
    if (target.matches?.('[data-palette-input]')) {
      setState({ paletteQuery: target.value, paletteSelection: 0 });
      renderApp();
      return;
    }
    if (target.matches?.('[data-capture-input]')) {
      // Keep the exact-once retry identity: submit compares the current
      // intent key against the stored one, so typing a character and
      // deleting it again still reuses the SAME request id — clearing here
      // minted a fresh id and made "retry unchanged" able to duplicate.
      setState({ captureQuery: target.value, captureError: null, captureRecovered: false });
      persistCaptureRecovery();
      const submit = appRoot.querySelector('[data-action="submit-capture"]');
      if (submit) submit.disabled = !target.value.trim();
      appRoot.querySelector('.capture__notice')?.remove();
      return;
    }
    if (target.matches?.('[data-assistant-input]')) {
      // Mirror to state (no re-render) so the composer survives re-renders.
      setState({ assistantInput: target.value });
      return;
    }
    if (target.matches?.('[data-ask-prax-input]')) {
      const wasLoading = state.askPraxLoading;
      if (wasLoading) askPraxToken += 1;
      setState({
        askPraxQuery: target.value,
        ...(wasLoading ? { askPraxLoading: false, askPraxError: false, askPraxResult: null } : {}),
      });
      if (wasLoading) {
        renderApp();
        return;
      }
      const submit = appRoot.querySelector('[data-action="run-ask-prax"]');
      if (submit) submit.disabled = !target.value.trim();
      return;
    }
    if (target.matches?.('[data-panel-filter]')) {
      const caret = target.selectionStart;
      setState({ panelFilter: target.value });
      renderApp();
      const next = appRoot.querySelector('[data-panel-filter]');
      if (next) {
        next.focus();
        if (caret != null) next.setSelectionRange(caret, caret);
      }
      return;
    }
    if (target.matches?.('[data-library-tag-filter]')) {
      // Library panel tag box: same re-render + focus/caret restore as the
      // browser panel's filter, on its own state key so a leftover value never
      // leaks into the Projects/Views filter.
      const caret = target.selectionStart;
      setState({ libraryTagFilter: target.value });
      renderApp();
      const next = appRoot.querySelector('[data-library-tag-filter]');
      if (next) {
        next.focus();
        if (caret != null) next.setSelectionRange(caret, caret);
      }
      return;
    }
    if (target.matches?.('[data-library-search]')) {
      // Search input changes invalidate any submitted meaning query. Re-render
      // both modes to clear an old result set, then restore focus/caret so
      // typing is uninterrupted despite replacing the input DOM.
      const caret = target.selectionStart;
      setState({
        libraryQuery: target.value,
        ...(state.librarySemantic ? resetSemanticSearchPatch() : {}),
      });
      renderApp();
      const next = appRoot.querySelector('[data-library-search]');
      if (next) {
        next.focus();
        if (caret != null) next.setSelectionRange(caret, caret);
      }
      return;
    }
    if (target.matches?.('[data-filter-input]')) {
      // Live filter: re-render (updates the list + count) and restore the caret.
      // Editing the expression detaches it from any saved smart view, and from
      // any NL provenance — the "✦ from …" hint must never misrepresent a
      // hand-edited expression. An in-flight translate is cancelled too: a late
      // response must not overwrite what the user is typing right now.
      const caret = target.selectionStart;
      setState({
        activeFilterExpr: target.value, activeSmartViewId: null,
        ...(state.nlFilterLoading ? nlFilterResetPatch() : { nlFilterSource: null, nlFilterWarnings: [], nlFilterError: null }),
      });
      renderApp();
      const next = appRoot.querySelector('[data-filter-input]');
      if (next) {
        next.focus();
        if (caret != null) next.setSelectionRange(caret, caret);
      }
      return;
    }
    if (target.matches?.('[data-project-oncall]') || target.matches?.('[data-project-handoff]') || target.matches?.('[data-project-repourl]') || target.matches?.('[data-project-area]')) {
      // Debounced save; don't re-render (would steal focus from the input the
      // user is typing in). Local state updates silently so it persists.
      const id = target.dataset.projectId;
      const field = target.matches('[data-project-oncall]') ? 'onCall'
        : target.matches('[data-project-handoff]') ? 'handoffNotes'
        : target.matches('[data-project-area]') ? 'area'
        : 'repoUrl';
      const value = target.value;
      projectDrafts.set(id, field, value);
      applyProjectPatchLocal(id, { [field]: value });
      // Keep the input on screen even if the value is now empty: a background
      // re-render must not swap it for a "+ Field" button under the caret.
      const shown = revealKey(id, field);
      if (!state.revealedOpsFields.includes(shown)) state.revealedOpsFields = [...state.revealedOpsFields, shown];
      clearTimeout(projectOpsTimers.get(id));
      projectOpsTimers.set(id, setTimeout(() => {
        projectOpsTimers.delete(id);
        void projectDrafts.flush(id);
      }, 600));
      return;
    }
    if (target.matches?.('[data-task-notes]')) {
      handleTaskDrawerDraftChange({ notes: target.value });
      return;
    }
    if (target.matches?.('[data-task-title]')) {
      handleTaskDrawerDraftChange({ title: target.value });
      return;
    }
    if (target.matches?.('[data-task-description]')) {
      handleTaskDrawerDraftChange({ description: target.value });
      return;
    }
    if (target.matches?.('[data-task-label-input]')) {
      setState({ taskLabelDraftId: state.drawerTaskId, taskLabelDraft: target.value });
      return;
    }
    if (target.matches?.('[data-document-editor]')) {
      handleDocumentDraftBodyChange(target.value);
      return;
    }
    if (target.matches?.('[data-doc-title]')) {
      handleDocumentDraftTitleChange(target.value);
      return;
    }
    if (mirrorDocumentInfoInput(target)) return;
    if (target.matches?.('[data-gcal-client-id]')) {
      // Mirror to state (no re-render) so the OAuth draft survives re-renders
      // without stealing focus — the render reads googleCalendarDraft back.
      setState({ googleCalendarDraft: { ...state.googleCalendarDraft, clientId: target.value } });
      return;
    }
    if (target.matches?.('[data-gcal-client-secret]')) {
      setState({ googleCalendarDraft: { ...state.googleCalendarDraft, clientSecret: target.value } });
      return;
    }
    if (target.matches?.('[data-link-picker-search]')) {
      setState({ linkPickerQuery: target.value });
      renderApp();
    }
  });

  appRoot.addEventListener('change', (event) => {
    const target = event.target;
    if (mirrorDocumentInfoInput(target)) return;
    if (target.matches?.('[data-task-due]')) {
      // Clearing the date clears the time too (a time with no date is meaningless).
      const dueDate = target.value || null;
      patchTask(state.drawerTaskId, dueDate ? { dueDate } : { dueDate: null, dueTime: null });
      return;
    }
    if (target.matches?.('[data-task-due-time]')) {
      patchTask(state.drawerTaskId, { dueTime: target.value || null });
      return;
    }
    if (target.matches?.('[data-task-project]')) {
      patchTask(state.drawerTaskId, { project: target.value }, { failure: 'move the task' });
      return;
    }
    if (target.matches?.('[data-reading-scale]')) {
      const preferences = savePreferences({ ...state.preferences, readingScale: Number(target.value) });
      setState({ preferences });
      applyPreferences(preferences);
      renderApp();
      return;
    }
    if (target.matches?.('[data-maintenance-project-filter]')) {
      setState({ maintenanceProjectFilter: target.value });
      loadMaintenance().then(renderApp);
      return;
    }
    if (target.matches?.('[data-markdown-import-files]')) {
      selectMarkdownImportFiles(target.files);
      return;
    }
    if (target.matches?.('[data-markdown-import-project]')) {
      if (!state.markdownImportPending && !state.markdownImportNotice) {
        setState({ markdownImportProjectId: target.value, markdownImportError: '', markdownImportNotice: '' });
        renderApp();
      }
      return;
    }
    if (target.matches?.('[data-library-export-scope]')) {
      if (!state.libraryExportPending) {
        const projects = libraryExportProjects();
        const scope = target.value === 'all' || projects.some(project => project.slug === target.value)
          ? target.value
          : 'all';
        setState({
          libraryExportScope: scope,
          libraryExportFilename: libraryArchiveFilename(scope),
          libraryExportError: '',
        });
        renderApp();
      }
      return;
    }
    if (target.matches?.('[data-import-file]')) {
      selectTaskImportFile(target.files?.[0]);
      return;
    }
    if (target.matches?.('[data-import-project]')) {
      if (!state.adminImportPending) {
        setState({ adminImportProjectId: target.value, adminImportRequest: null, adminImportError: '', adminImportResult: null });
        renderApp();
      }
      return;
    }
    if (target.matches?.('[name="import-mode"]')) {
      if (state.adminImportPending) return;
      setState({ adminImportMode: target.value, adminImportRequest: null, adminImportError: '', adminImportResult: null });
      renderApp();
    }
  });

  appRoot.addEventListener('keydown', async (event) => {
    const target = event.target;
    const modalOverlay = state.libraryExportOpen
      ? 'library-export'
      : (state.markdownImportOpen ? 'markdown-import' : (state.shortcutsOpen ? 'shortcuts' : null));
    if (modalOverlay && event.key === 'Tab') {
      const dialog = appRoot.querySelector(`[data-overlay="${modalOverlay}"] [role="dialog"]`);
      const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled])') || [])];
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    // Plan mode / shutdown: Enter = primary decision, S = skip. Inputs keep
    // their own keys (a time/date field must accept typing and its Enter).
    if (state.planMode && !target.matches?.('input, select, textarea')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        await planModeAct(state.planMode.mode === 'plan'
          ? (state.planMode.queue[state.planMode.index]?.bucket === 'stale' ? 'today' : 'add')
          : 'carry');
        return;
      }
      if (event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        await planModeAct('skip');
        return;
      }
    }
    // ⌘F / Ctrl+F opens the editor find panel from anywhere in the editor view
    // (document, panel inputs, preview) — never the browser's find-in-page.
    if (state.navType === 'editor' && (event.metaKey || event.ctrlKey)
      && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openEditorSearch();
      return;
    }
    if (target.matches?.('[data-search-find]')) {
      if (event.key === 'Enter') { event.preventDefault(); runSearchCommand(event.shiftKey ? 'previous' : 'next'); }
      else if (event.key === 'Escape') { event.preventDefault(); closeEditorSearch(); }
      return;
    }
    if (target.matches?.('[data-search-replace]')) {
      if (event.key === 'Enter') { event.preventDefault(); runSearchCommand('replace'); }
      else if (event.key === 'Escape') { event.preventDefault(); closeEditorSearch(); }
      return;
    }
    if (target.matches?.('[data-palette-input]')) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setState({ paletteSelection: Math.min(Math.max(0, paletteFlat.length - 1), state.paletteSelection + 1) });
        renderApp();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setState({ paletteSelection: Math.max(0, state.paletteSelection - 1) });
        renderApp();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = paletteFlat[Math.min(state.paletteSelection, Math.max(0, paletteFlat.length - 1))];
        await runPaletteItem(item, { done: event.metaKey || event.ctrlKey });
      } else if (event.key === 'Tab') {
        // ⇥ / ⇧⇥ walk the scope bar; the input keeps focus.
        event.preventDefault();
        setPaletteScope(cyclePaletteScope(state.paletteScope, event.shiftKey ? -1 : 1));
      }
      return;
    }
    if (target.matches?.('[data-new-project-name]') && event.key === 'Enter') {
      event.preventDefault();
      handleAction('create-project', target, event);
      return;
    }
    if (target.matches?.('[data-confirm-input]') && event.key === 'Enter') {
      event.preventDefault();
      appRoot.querySelector('[data-confirm-ok]')?.click();
      return;
    }
    if (target.matches?.('[data-capture-input]') && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (event.repeat) return; // held-down Enter must not machine-gun creates
      if (state.captureSubmitting) return;
      // ⌘/Ctrl+Enter = AI smart add (falls through to a plain add when no model
      // is configured); plain Enter confirms a preview or adds deterministically.
      if (event.metaKey || event.ctrlKey) { runNlCapture(); return; }
      if (state.nlCaptureLoading) return; // parse in flight — Esc cancels it
      if (state.nlCaptureFields) { confirmNlCapture(); return; }
      addQuickTask(state.captureQuery.trim());
      return;
    }
    if (target.matches?.('[data-filter-input]') && event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      runNlFilter();
      return;
    }
    if (target.matches?.('[data-ask-prax-input]') && event.key === 'Enter') {
      event.preventDefault();
      runAskPrax(target.value);
      return;
    }
    if (target.matches?.('[data-assistant-input]') && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendAssistant(target.value);
      return;
    }
    if (target.matches?.('[data-project-rename]')) {
      if (event.key === 'Enter') { event.preventDefault(); target.blur(); return; } // blur commits
      if (event.key === 'Escape') { event.preventDefault(); setState({ renamingProjectId: null }); renderApp(); return; }
      return;
    }
    if (target.matches?.('[data-checklist-new]') && event.key === 'Enter') {
      event.preventDefault();
      handleAction('add-checklist-item', target, event);
      return;
    }
    if (target.matches?.('[data-task-label-input]') && event.key === 'Enter') {
      event.preventDefault();
      await addTaskLabel(target.value);
      return;
    }
    if (target.matches?.('[data-library-search]') && event.key === 'Enter' && state.librarySemantic) {
      event.preventDefault();
      runSemanticSearch();
      return;
    }
    if (target.matches?.('[data-document-editor]') && (event.metaKey || event.ctrlKey)) {
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); requestDocumentDraftSave(); }
      else if (key === 'b') { event.preventDefault(); applyEditorFormat('bold'); }
      else if (key === 'i') { event.preventDefault(); applyEditorFormat('italic'); }
      else if (key === 'e') { event.preventDefault(); applyEditorFormat('code'); }
    }
  });

  bindDragEvents();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasNarrow = state.winW < 940;
      setState({ winW: window.innerWidth });
      if ((window.innerWidth < 940) !== wasNarrow) renderApp();
    }, 150);
  });
}

async function handleLinkPickerPick(documentId) {
  if (state.pickerMode === 'supersede') {
    const predecessorId = state.editorDocId;
    await performDocumentLifecycleOnce(`document:${predecessorId}`, () => (
      supersedeKnowledgeDocument(predecessorId, documentId)
    ));
    return;
  }
  try {
    const alreadyLinked = state.taskDocuments.some(d => d.id === documentId);
    const documents = alreadyLinked
      ? await unlinkTaskDocument(state.drawerTaskId, documentId)
      : await linkTaskDocument(state.drawerTaskId, documentId);
    setState({ taskDocuments: documents, ...clearTaskBoardExtra(state, state.drawerTaskId) });
  } catch { alertError('update the document link'); }
  renderApp();
}

// ---- NL capture & NL→filter (Tier-3 #8) ------------------------------------
// Generation tokens + abort controllers for the two NL calls: bumped on every
// run/cancel/close so a stale response can never resurrect a dismissed preview
// (the writeToken pattern), and aborted so a hung local model doesn't hold the
// speed-critical capture flow hostage.
let nlCaptureToken = 0;
let nlFilterToken = 0;
let nlCaptureAbort = null;
let nlFilterAbort = null;
const NL_TIMEOUT_MS = 20000;

// Everything the NL layer holds, reset in one place (capture open/close, view
// navigation, cancel).
function nlCaptureResetPatch() {
  nlCaptureToken += 1;
  nlCaptureAbort?.abort();
  nlCaptureAbort = null;
  return { nlCaptureLoading: false, nlCaptureFields: null, nlCaptureDropped: [], nlCaptureRaw: null, nlCaptureError: null };
}

function nlFilterResetPatch() {
  nlFilterToken += 1;
  nlFilterAbort?.abort();
  nlFilterAbort = null;
  return { nlFilterLoading: false, nlFilterSource: null, nlFilterWarnings: [], nlFilterError: null };
}

// Bounded grounding for the NL prompts — the client owns what the user sees.
function nlGrounding() {
  const projects = (state.projects || []).filter((p) => p.slug).map((p) => ({ slug: p.slug, name: p.name }));
  const labels = new Set();
  for (const task of state.tasks || []) {
    for (const label of task.labels || []) labels.add(label);
  }
  return { projects, labels: [...labels].slice(0, 50) };
}

// The input value we last set from a parse (the cleaned title) — lets the ⌘↵
// chord tell "re-parse the same phrase" (input unedited → resend the preserved
// raw text) from "parse what I just typed" (input edited).
let nlCaptureSetQuery = null;

// ⌘↵ in capture: parse the typed text with the AI, preview the fields as chips.
// The cleaned title replaces the input (still editable); nothing is created
// until plain Enter confirms. Falls through to the plain add when no model is
// configured — the chord must never be a dead keystroke.
async function runNlCapture() {
  const current = (state.captureQuery || '').trim();
  if (!current || state.nlCaptureLoading || state.captureSubmitting) return;
  if (!state.chatStatus?.available) { addQuickTask(current); return; }
  // Re-parse (⌘↵ with an unedited preview) resends the ORIGINAL phrase — the
  // visible title no longer carries the date/priority words the first parse
  // extracted. An edited input is a new phrase and becomes the new raw.
  const unedited = state.nlCaptureFields && nlCaptureSetQuery != null && state.captureQuery === nlCaptureSetQuery;
  const text = unedited && state.nlCaptureRaw ? state.nlCaptureRaw : current;
  const raw = text;
  const sentQuery = state.captureQuery; // input at send time (divergence guard)
  const token = (nlCaptureToken += 1);
  nlCaptureAbort?.abort();
  nlCaptureAbort = new AbortController();
  const timer = setTimeout(() => nlCaptureAbort?.abort(), NL_TIMEOUT_MS);
  setState({
    nlCaptureLoading: true,
    nlCaptureError: null,
    nlCaptureFields: null,
    nlCaptureDropped: [],
    nlCaptureRaw: raw,
    ...clearCaptureRequestPatch(),
  });
  persistCaptureRecovery();
  renderApp();
  try {
    const res = await parseNlCapture({ text, date: todayISODate(), ...nlGrounding() }, { signal: nlCaptureAbort.signal });
    // Drop a stale response: cancelled/superseded, capture closed, or the user
    // typed while it was in flight (their text wins over our parse of old text).
    if (token !== nlCaptureToken || !state.captureOpen || state.captureQuery !== sentQuery) return;
    if (res.degraded) {
      setState({
        nlCaptureLoading: false,
        nlCaptureError: res.reason === 'no-chat-model'
          ? 'No AI model configured — set one in Settings ▸ Intelligence.'
          : 'The model could not parse this — ↵ adds the task as typed.',
      });
    } else {
      // Sigiled tokens in the typed text override the model (mergeNlCapture).
      const merged = mergeNlCapture(text, res.fields || {});
      const { title, ...fields } = merged;
      // Capture-from-Today seeds a due-today default; surface it as a chip so
      // the preview shows EVERY field the created task will carry (and removal
      // works). confirmNlCapture uses the preview alone — no invisible fallback.
      if (!fields.dueDate && state.captureDueDate) fields.dueDate = state.captureDueDate;
      if (state.planMode?.mode === 'plan') fields.plannedFor = todayISODate();
      nlCaptureSetQuery = title || text;
      setState({
        nlCaptureLoading: false,
        nlCaptureFields: fields,
        nlCaptureDropped: res.dropped || [],
        captureQuery: nlCaptureSetQuery,
      });
    }
  } catch (err) {
    if (token !== nlCaptureToken || !state.captureOpen || state.captureQuery !== sentQuery) return;
    setState({
      nlCaptureLoading: false,
      nlCaptureError: err?.name === 'AbortError'
        ? 'The model took too long — ↵ adds the task as typed, or ⌘↵ retries.'
        : 'Could not reach the model — ↵ adds the task as typed.',
    });
  } finally {
    clearTimeout(timer);
  }
  if (token === nlCaptureToken) persistCaptureRecovery();
  if (token === nlCaptureToken) renderApp();
}

// First Esc with a preview (or parse in flight): abort/discard; the overlay
// stays open. The typed text is restored only when a preview replaced it —
// after a failed parse the input was never touched, so Esc must not revert
// edits the user made since (it just clears the error).
function cancelNlCapture() {
  if (state.captureSubmitting) return;
  const raw = state.nlCaptureFields ? state.nlCaptureRaw : null;
  setState({
    ...nlCaptureResetPatch(),
    ...(raw != null ? { captureQuery: raw } : {}),
    ...clearCaptureRequestPatch(),
  });
  persistCaptureRecovery();
  renderApp();
}

// One create path for both capture flows (deterministic + NL preview): resolve
// the destination, translate design-vocab status at the API boundary, create,
// close + reset, toast. A client UUID makes retry exact-once; a failed POST is
// reconciled with one canonical read before the UI calls it a failure.
async function createCapturedTaskWithReadback(payload) {
  try {
    return { task: await createTask(payload), reconciled: false };
  } catch (writeError) {
    try {
      const observed = await fetchTask(payload.id);
      if (taskMatchesCreatePayload(observed, payload)) {
        return { task: observed, reconciled: true };
      }
    } catch {
      // The original error is the useful failure; the retry identity remains
      // stored so the unchanged create can safely be attempted again.
    }
    throw writeError;
  }
}

async function submitCapturedTask(fields) {
  if (state.captureSubmitting) return;
  const title = fields.title;
  if (!title) {
    setState({ captureError: 'Add a task title.', captureRecovered: false });
    persistCaptureRecovery();
    renderApp();
    return;
  }
  let project = state.captureProjectId || defaultProjectId();
  if (fields.project) {
    const resolved = projectResolver(state.projects)(fields.project);
    if (resolved) project = resolved; // an explicit/parsed project overrides the destination
  }
  if (!project) {
    setState({ captureError: 'Create a project before adding this task.' });
    persistCaptureRecovery();
    renderApp();
    return;
  }
  const intent = captureIntentKey({
    query: state.captureQuery,
    projectId: state.captureProjectId,
    dueDate: state.captureDueDate,
    status: state.captureStatus,
    nlFields: state.nlCaptureFields,
  });
  const reusable = state.captureRequestIntent === intent && state.captureRequestPayload;
  const payload = reusable || {
    id: globalThis.crypto.randomUUID(),
    title,
    description: '',
    notes: '',
    priority: fields.priority || 'medium',
    // captureStatus is design vocab ('backlog'|'planned') — translate at the
    // API boundary ('backlog' → 'notes'); sending it raw 400s.
    status: apiStatus(state.captureStatus || 'planned'),
    project,
    dueDate: fields.dueDate || null,
    dueTime: fields.dueDate ? fields.dueTime || null : null,
    recurrence: fields.recurrence || null,
    labels: fields.labels || [],
    sortOrder: state.tasks.length,
    ...(fields.plannedFor ? { plannedFor: fields.plannedFor } : {}),
  };
  setState({
    captureSubmitting: true,
    captureError: null,
    captureRecovered: false,
    captureMenuOpen: false,
    captureRequestPayload: payload,
    captureRequestIntent: intent,
  });
  persistCaptureRecovery();
  renderApp();
  let outcome;
  try {
    outcome = await createCapturedTaskWithReadback(payload);
  } catch (writeError) {
    // A deterministic 4xx rejection is not retry-safe advice: the server
    // said no to THIS payload/identity, so repeating it unchanged can only
    // fail (or 409 forever on the same id). Drop the retry identity so the
    // next submit mints a fresh one, and say what actually happened.
    const permanent = Number.isInteger(writeError?.status)
      && writeError.status >= 400 && writeError.status < 500;
    setState({
      captureSubmitting: false,
      ...(permanent ? { captureRequestPayload: null, captureRequestIntent: null } : {}),
      captureError: permanent
        ? `The server rejected this capture: ${writeError.message}. Edit it and try again.`
        : 'Could not confirm creation. Your task is saved here; retry unchanged is safe.',
    });
    persistCaptureRecovery();
    renderApp();
    return;
  }
  // Owner-guarded (no force): the entry is this tab's own fulfilled draft —
  // typing and restore both stamp this tab as owner. A foreign stamp means
  // another tab took the slot for ITS draft, which this success says nothing
  // about, so that entry must survive.
  clearTaskCaptureRecovery(taskCaptureStorage());
  setState({
    captureOpen: false,
    captureQuery: '',
    captureMenuOpen: false,
    captureSubmitting: false,
    ...clearCaptureRequestPatch(),
    ...nlCaptureResetPatch(),
  });
  let refreshed = true;
  try { await loadTasks(); } catch { refreshed = false; }
  const name = state.projects.find(p => p.id === payload.project)?.name || 'project';
  showToast(refreshed ? `Added to ${name}` : `Added to ${name}; reload to show it.`);
  renderApp();
  return outcome.task;
}

// Plain Enter with a preview showing: create the previewed task. The input is
// the (editable) title — sigils typed into it after the parse still win via a
// re-merge (they are visible in the input, so the preview stays truthful).
async function confirmNlCapture() {
  const fields = mergeNlCapture(state.captureQuery, { ...state.nlCaptureFields, title: '' });
  // The preview is authoritative: what you see is exactly what gets created
  // (the due-today default was already surfaced as a removable chip).
  await submitCapturedTask(fields);
}

// ✦ Translate in the Filter view: the input's English becomes a grammar string
// in the same input — transparent, editable, saveable. An invalid expression is
// still landed (the existing error hint explains it) rather than discarded.
async function runNlFilter() {
  const text = (state.activeFilterExpr || '').trim();
  if (!text || state.nlFilterLoading || !state.chatStatus?.available) return;
  const token = (nlFilterToken += 1);
  nlFilterAbort?.abort();
  nlFilterAbort = new AbortController();
  const timer = setTimeout(() => nlFilterAbort?.abort(), NL_TIMEOUT_MS);
  setState({ nlFilterLoading: true, nlFilterError: null, nlFilterWarnings: [] });
  renderApp();
  try {
    const res = await parseNlFilter({ text, date: todayISODate(), ...nlGrounding() }, { signal: nlFilterAbort.signal });
    // Drop a stale response: superseded, or the user left the Filter view —
    // a late translation must not mutate the expression under another view.
    if (token !== nlFilterToken || state.navType !== 'filter') return;
    if (res.degraded) {
      setState({
        nlFilterLoading: false,
        nlFilterError: res.reason === 'no-chat-model'
          ? 'No AI model configured — set one in Settings ▸ Intelligence.'
          : 'The model could not translate this. Try rephrasing.',
      });
    } else if (res.expr) {
      setState({
        nlFilterLoading: false,
        activeFilterExpr: res.expr,
        activeSmartViewId: null,
        nlFilterSource: text,
        nlFilterWarnings: res.warnings || [],
      });
    } else {
      setState({ nlFilterLoading: false, nlFilterError: 'The model could not produce a filter. Try rephrasing.' });
    }
  } catch (err) {
    if (token !== nlFilterToken || state.navType !== 'filter') return;
    setState({
      nlFilterLoading: false,
      nlFilterError: err?.name === 'AbortError' ? 'The model took too long — try again.' : 'Could not reach the model.',
    });
  } finally {
    clearTimeout(timer);
  }
  if (token === nlFilterToken && state.navType === 'filter') {
    renderApp();
    const input = appRoot.querySelector('[data-filter-input]');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
}

async function addQuickTask(rawTitle) {
  // Shorthand (!high, tomorrow, fri, 2026-09-01, #project, @label) is parsed out
  // of the typed text; an explicit token wins over the view-derived defaults
  // (here the due-today default applies invisibly — unlike the NL preview,
  // which surfaces it as a removable chip and is authoritative on its own).
  const { title, priority, dueDate, project: projectToken, labels } = parseCaptureShorthand(rawTitle);
  await submitCapturedTask({
    title, priority, project: projectToken, labels,
    dueDate: dueDate || state.captureDueDate || null,
    // Captured mid-planning: the new task joins today's working set.
    ...(state.planMode?.mode === 'plan' ? { plannedFor: todayISODate() } : {}),
  });
}

function installShortcuts() {
  installKeyboardShortcuts({
    handlers: {
      async switchView(view) {
        if (view === 'library') { await goLibrary(); return; }
        const projectId = state.navType === 'project' ? state.navId : (state.projects[0]?.id || null);
        if (projectId) await goProject(projectId, view);
      },
      openPalette() {
        if (state.captureSubmitting) return;
        if (state.captureOpen) discardCapture();
        setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0, paletteScope: 'all' });
        renderApp();
      },
      openAssistant,
      toggleTheme,
      openShortcuts,
      openCapture() {
        openFreshCapture();
      },
      toggleDoneSelected() {
        if (state.selectedTaskId && !state.paletteOpen && !state.captureOpen && !state.drawerTaskId) {
          toggleTaskDone(state.selectedTaskId);
        }
      },
      navigate(direction) {
        const listContext = (state.navType === 'project' && (state.tab === 'list' || state.tab === 'board'))
          || state.navType === 'today' || state.navType === 'filter';
        if (!listContext || state.paletteOpen || state.captureOpen || state.drawerTaskId) return;
        if (!flatIds.length) return;
        const current = flatIds.indexOf(state.selectedTaskId);
        const next = direction > 0
          ? Math.min(flatIds.length - 1, current + 1)
          : Math.max(0, current < 0 ? 0 : current - 1);
        setState({ selectedTaskId: flatIds[next] });
        renderApp();
      },
      openSelected() {
        if (state.selectedTaskId && !state.paletteOpen && !state.captureOpen && !state.drawerTaskId) {
          openTaskDrawer(state.selectedTaskId);
        }
      },
      escape: escapeCascade,
    },
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadSavedViews() {
  try {
    return savedLibraryViewsFromJson(localStorage.getItem(SAVED_LIBRARY_VIEWS_KEY));
  } catch {
    return [];
  }
}

// Desktop-only settings surface; a failed load leaves the row on its
// placeholder default rather than inventing a value.
async function loadCaptureShortcut() {
  if (!state.desktopShell || state.captureShortcut) return;
  try {
    const loaded = await fetchCaptureShortcut();
    setState({ captureShortcut: loaded });
    if (state.navType === 'settings') renderApp();
  } catch { /* row keeps its placeholder */ }
}

function loadSmartViews() {
  try {
    return smartViewsFromJson(localStorage.getItem(SMART_VIEWS_KEY));
  } catch {
    return [];
  }
}

async function init() {
  appRoot = document.getElementById('app');
  const preferences = loadPreferences();
  // The Tauri shell serves the app with ?shell=desktop — the OS window chrome
  // is real there, so the in-app fake chrome is suppressed.
  const params = new URLSearchParams(window.location.search);
  const desktopShell = params.get('shell') === 'desktop';
  const desktopPlatform = desktopShell ? (params.get('platform') || '') : '';
  document.body.classList.toggle('is-desktop', desktopShell);
  // macOS merges the native titlebar into the app's top bar (overlay style) —
  // inset the bar so the traffic lights sit inside it.
  document.body.classList.toggle('is-desktop-mac', desktopShell && desktopPlatform === 'macos');
  setState({ preferences, librarySavedViews: loadSavedViews(), taskSmartViews: loadSmartViews(), pinned: loadPinned(), recentProjects: loadRecent(), collapsedSections: loadCollapsed(), winW: window.innerWidth, desktopShell, desktopPlatform });
  applyPreferences(preferences);
  appRoot.innerHTML = '<main class="empty" style="height:100vh"><p class="empty__sub">Loading Prax…</p></main>';
  try {
    await loadProjects();
    const persisted = loadActiveProject();
    const valid = persisted !== 'all' && state.projects.some(p => p.id === persisted);
    if (valid) {
      setState({ navType: 'project', navId: persisted });
    } else if (state.projects[0]) {
      setState({ navType: 'project', navId: state.projects[0].id });
    } else {
      setState({ navType: 'all', navId: null });
    }
    setState({ apiStatus: 'loading' });
    bindEvents();
    installShortcuts();
    // From the first request on, regaining focus, becoming visible, navigating,
    // or a capture-bar announcement refetches what other surfaces may have
    // written — including a capture made while the initial load is in flight
    // (the newest task request wins; see loadTasks).
    installWriteEpoch();
    installExternalRefreshTriggers({ refresh: externalRefresh });
    renderApp();

    // Tasks gate the primary workspace; the much larger document bodies do
    // not. Load the Library in parallel and let the task collection become
    // interactive as soon as its own request completes.
    const documentsPromise = loadDocuments().catch(() => false);
    if ((await loadTasks({ announceReminders: false })) === 'superseded' && externalRefresh.inFlight) {
      await externalRefresh.inFlight; // an early trigger's newer snapshot installs instead
    }
    restoreCaptureRecovery();
    const assistantRecovery = loadAssistantRecovery(taskDraftStorage());
    if (assistantRecovery) {
      setState({ assistantMessages: assistantRecovery.messages, assistantPending: assistantRecovery.pending, assistantApprovalAttempted: assistantRecovery.attempted, assistantError: assistantRecovery.attempted ? 'Recovered an approval whose outcome was not confirmed. Retry safely to check the same action.' : null, assistantErrorKind: assistantRecovery.attempted ? 'partial' : null });
      showToast('Recovered a pending assistant approval. Open Assistant to review it.', null, 8000);
    }
    // A browser fallback reminder renders the workspace together with its
    // toast. Otherwise render once here. This avoids two consecutive full DOM
    // builds on every startup with due tasks.
    if (!checkDueReminders()) renderApp();
    documentsPromise.then((applied) => {
      if (applied && (state.navType === 'library' || state.navType === 'settings')) renderApp();
    });
    loadSemanticStatus().then(() => {
      if (state.navType === 'library' || state.navType === 'settings') renderApp();
    });
    loadChatStatus().then(() => {
      if (state.captureOpen) renderCaptureOverlayLayer();
      else if (state.navType === 'library' || state.navType === 'settings') renderApp();
    });
    // Heartbeat so a task that ticks over to "due" while the app sits open still
    // gets a reminder (e.g. across midnight). Cheap: a filter over state.tasks.
    if (typeof setInterval === 'function') setInterval(() => { checkDueReminders(); checkShutdownNudge(); checkWeeklyReviewNudge(); }, 15 * 60 * 1000);
  } catch (err) {
    appRoot.innerHTML = `<main class="empty" style="height:100vh"><h2 class="empty__title">Prax could not load</h2><p class="empty__sub">${escapeHtml(err?.message || 'Unknown error')}</p></main>`;
    setState({ apiStatus: 'error' });
  }
}

init();
