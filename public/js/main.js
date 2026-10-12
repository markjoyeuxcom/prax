import { renderTemplateStudioHtml } from './renderTemplateStudio.js';
import { reconcileTaskArchive } from './taskArchiveOutcome.js';
import { documentDraftPatch, mergeDocumentDraft } from './documentDraftMerge.js';
import { createProjectDrafts } from './projectDrafts.js';
import { isSystemProject } from './systemProject.js';
import { captureLibraryReturn, libraryReturnPatch, libraryViewKey } from './libraryReturn.js';
import { createInboxController } from './inboxController.js';
import { createPlanModeController } from './planModeController.js';
import { createAssistantController } from './assistantController.js';
import { createSettingsController } from './settingsController.js';
import { createDocumentLifecycleController } from './documentLifecycleController.js';
import { createReviewWalkController } from './reviewWalkController.js';
import { createRunController } from './runController.js';
import { createLibraryTransferController } from './libraryTransferController.js';
import { createKnowledgeToolsController } from './knowledgeToolsController.js';
import { createWritingController } from './writingController.js';
import { createDocumentInfoController } from './documentInfoController.js';
import { createCaptureController } from './captureController.js';
import { createTemplateStudioController } from './templateStudioController.js';
import { createTaskDrawerController } from './taskDrawerController.js';
import { renderInboxView, renderInboxDialog } from './renderInbox.js';
import { INBOX_LINK } from './inboxModel.js';
// Prax — application orchestrator.
// Render modules are pure state → HTML string functions; feature controllers
// (*Controller.js, created below with injected dependencies) own cohesive
// features and their data-actions. This file owns data loading, event
// delegation (single delegated click/input/change listeners reading
// data-action attributes, and one keyboard dispatcher — keyboardDispatcher.js),
// API translation via statusMap, and the post-render lifecycle (CodeMirror
// mount, drag indicator, autosave timers, render continuity).

import { state, setState, loadActiveProject, persistActiveProject } from './state.js';
import {
  applyPreferences, loadPreferences,
} from './preferences.js';
import {
  fetchTasks, fetchTask, updateTask, reorderTasks, archiveTask, restoreTask, deleteArchivedTask,
  fetchTaskBoardExtras,
} from './taskApi.js';
import {
  fetchProjects, createProject, updateProject, deleteProjectPermanent,
} from './projectApi.js';
import {
  fetchDocuments, fetchDocument, createDocument, updateDocument, fetchDocumentLinks,
  fetchDocumentTaskBacklinks, fetchSimilarDocuments, fetchExternalRefs, semanticSearch, fetchRuns,
  fetchRecallCounts,
} from './libraryApi.js';
import { normalizeTask } from './taskModel.js';
import { apiStatus, designStatus, isOpen } from './statusMap.js';
import { moveTaskOnBoard } from './boardWorkflow.js';
import { pendingExtraIds, batchIds, clearTaskBoardExtra } from './boardExtras.js';
import { createGlobalShortcuts } from './keyboardShortcuts.js';
import { createKeyboardDispatcher, KEY_CONSUMED, KEY_HANDLED } from './keyboardDispatcher.js';
import { externalLinkUrl, openExternalUrl } from './externalLinks.js';
import { topmostModal, syncModalInert, trapModalTab } from './modalFocus.js';
import { applyMarkdownFormat } from './markdownEditor.js';
import { renderMarkdownHtml } from './markdownPreview.js';
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
import {
  libraryExportDestinationMode, triggerLibraryDocumentDownload,
} from './libraryExport.js';
import { createSavedLibraryView, savedLibraryViewsFromJson } from './librarySavedViews.js';
import { computeDueReminders, isOverdue } from './dueReminders.js';
import { mountCodeMirrorEditor } from '../vendor/codemirror-editor.js';

import {
  renderTitlebarHtml, renderPanelHtml, renderRailHtml, renderStatusbarHtml,
  projectColor,
} from './renderShell.js';
import {
  TASK_RENDER_BATCH_SIZE, renderListHtml, renderBulkBarHtml, buildListGroups, limitTaskGroups,
  applyCollapsedGroups,
} from './renderList.js';
import { renderTodayHtml, buildTodayGroups, TODAY_WEEK_SECTION, TODAY_OVERDUE_ALL, OVERDUE_PREVIEW, nextMondayIso } from './renderToday.js';
import { renderPlanModeHtml } from './renderPlanMode.js';
import {
  createExternalRefresh, installExternalRefreshTriggers, collectionFingerprint,
  installWriteEpoch, writeEpoch, captureFocus, restoreFocus,
} from './externalRefresh.js';
import { renderCalendarHtml, buildCalendarModel, monthKeyOf, shiftMonthKey } from './renderCalendar.js';
import { renderFilterHtml, buildFilterGroups } from './renderFilter.js';
import { parseTaskFilter } from './taskFilter.js';
import { createSmartView, findSmartView, smartViewsFromJson } from './taskSmartViews.js';
import { loadPinned, savePinned, togglePinned } from './pinned.js';
import { isCollapsed, loadCollapsed, saveCollapsed, toggleCollapsed } from './collapsed.js';
import { loadRecent, saveRecent, pushRecent, loadRecentDocuments, saveRecentDocuments, pushRecentDocument } from './recentProjects.js';
import { loadLayout, saveLayout } from './libraryLayout.js';
import { renderBoardHtml, buildBoardColumns, limitBoardColumns } from './renderBoard.js';
import { renderBacklogHtml, renderArchiveHtml } from './renderBacklog.js';
import { renderTaskDrawerHtml, renderMissingTaskDrawerHtml, inspectorDocked } from './renderTaskDetail.js';
import { renderLinkPickerHtml } from './renderLinkPicker.js';
import {
  LIBRARY_RENDER_BATCH_SIZE, renderLibraryHtml, buildLibraryModel, reviewQueue,
  SEMANTIC_UNAVAILABLE_HINT, nextLibrarySort,
} from './renderLibrary.js';
import { templateById } from './documentTemplates.js';
import { renderEditorHtml, buildOutline, buildBacklinks } from './renderEditor.js';
import { renderRunHtml } from './renderRun.js';
import { renderAskPraxHtml } from './renderAskPrax.js';
import { renderGenerateRunbookHtml } from './renderGenerateRunbook.js';
import { renderHealthHtml } from './renderHealth.js';
import { renderDailyBriefHtml } from './renderDailyBrief.js';
import { buildDailyBrief } from './brief.js';
import { renderAssistantHtml } from './renderAssistant.js';
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
import { revealKey, opsFieldAttr } from './renderProjectOps.js';
import { renderProjectPageHtml } from './renderProjectPage.js';
import {
  renderAppFrameHtml, renderTasksLoadingHtml, renderDocumentNotFoundHtml, renderToastRootHtml, renderBootLoadingHtml,
  renderBootErrorHtml,
} from './renderAppFrame.js';

const SAVED_LIBRARY_VIEWS_KEY = 'moomora.librarySavedViews.v1';
const SMART_VIEWS_KEY = 'moomora.taskSmartViews.v1';
const INBOX_SLUG = 'inbox';
const DOCUMENT_AUTOSAVE_DELAY_MS = 1200;
const TASK_DRAFT_AUTOSAVE_DELAY_MS = 1000;

// ---- module runtime (not state: timers, controllers, transient DOM) --------
let appRoot = null;
let flatIds = [];                 // keyboard-navigation order of the visible list
let paletteFlat = [];             // flattened palette items for Enter/arrows
let documentEditorController = null;
let pendingEditorSelection = null; // {from,to,focused,scroll,docId} to restore after a renderApp re-mount (see renderApp)
let mountedEditorDocId = null;     // the document the mounted editor was created for
let documentAutosaveTimer = null;
let documentSavePromise = null;     // coalesces navigation flushes with an in-flight autosave
let taskDraftSaveTimer = null;
let taskDraftSavePromise = null;  // coalesces close/switch with a drawer autosave
let toastTimer = null;
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
let taskCollectionWindow = { key: '', limit: TASK_RENDER_BATCH_SIZE };
let libraryCollectionWindow = { key: '', limit: LIBRARY_RENDER_BATCH_SIZE };
const enqueueTaskMutation = createTaskMutationQueue();

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
  setState({ confirm, docMenuOpen: false, newDocMenuOpen: false, libraryMenuOpen: false, newMenuOpen: false, captureMenuOpen: false });
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
// request started meanwhile (its result wins), or 'stale' when a local write
// started or settled while every snapshot was in flight. An older snapshot
// must never overwrite a newer accepted save: complete task A (a recurring
// reload starts), complete task B (its PATCH commits), and the reload read
// before B's write would show B open again. So every load compares the write
// epoch across its fetch and reads again when it moved. `guardWrites`
// (refreshFromOutside) drops such a snapshot at once and lets its refresher
// ask again; a load that runs out of attempts asks the refresher too.
const TASK_LOAD_ATTEMPTS = 3;
async function loadTasks({ announceReminders = true, guardWrites = false } = {}) {
  const token = (tasksLoadToken += 1);
  for (let attempt = 1; ; attempt += 1) {
    const epoch = writeEpoch();
    const tasks = await fetchTasks({});
    if (token !== tasksLoadToken) return 'superseded';
    if (writeEpoch() !== epoch) {
      if (guardWrites) return 'stale';
      if (attempt >= TASK_LOAD_ATTEMPTS) { externalRefresh.trigger('stale'); return 'stale'; }
      continue;
    }
    setState({ tasks: tasks.map(normalizeTask), apiStatus: 'connected' });
    reconcileTaskDrawerAfterRefresh();
    if (announceReminders) checkDueReminders();
    return true;
  }
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
  if (state.navType !== 'editor') await loadDocuments().catch(() => false);
  // A snapshot that spanned a local write was discarded; ask for a fresh one
  // once the write has settled (the refresher runs it after its interval).
  if (applied === 'stale') externalRefresh.trigger('stale');
  const after = `${collectionFingerprint(state.tasks)}#${collectionFingerprint(state.documents)}`;
  const priorInbox = JSON.stringify(state.inbox?.summary);
  await inboxController.summary();
  const changed = after !== before || priorInbox !== JSON.stringify(state.inbox?.summary);
  if (changed && state.navType === 'project' && state.navId === inboxProjectId() && ['inbox', 'reviews'].includes(state.tab)) {
    await inboxController.load(state.tab === 'reviews' ? 'reviews' : 'pending');
  }
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
const inboxController = createInboxController({
  getState: () => state, setState,
  render: () => { if ((state.navType === 'project' && state.navId === inboxProjectId()) || state.inbox?.processing) renderApp(); },
  toast: showToast,
  refresh: async () => { await Promise.all([loadTasks({ announceReminders: false }), loadDocuments()]); },
  openDocument: openDocumentInEditor,
  openTask: async id => { await loadTasks({ announceReminders: false }); await openTaskDrawer(id); },
});

// ---- feature controllers -----------------------------------------------------
// Cohesive features live in their own modules with injected dependencies
// (inboxController.js pattern). handleAction delegates their data-actions.
const planMode = createPlanModeController({
  getState: () => state, setState, renderApp, showToast, alertError, taskById, todayISODate, inboxProjectId,
  applyTaskPatches, refreshTasksAfterWrites, partialTaskOutcome, taskCountLabel,
});
const assistant = createAssistantController({
  getState: () => state, setState, renderApp, showToast, discardCapture: () => capture.discardCapture(), getRoot: () => appRoot,
  loadTasks, loadProjects, loadDocuments, loadHealth: () => knowledge.loadHealth(), storage: taskDraftStorage,
});
const settings = createSettingsController({
  getState: () => state, setState, renderApp, showToast, alertError, openConfirm, getRoot: () => appRoot,
  prepareEditorNavigation, inboxProjectId, resetSemanticSearchPatch, checkDueReminders, destroyEditorController,
});
const lifecycle = createDocumentLifecycleController({
  getState: () => state, setState, renderApp, showToast, dismissToast, alertError, openConfirm,
  loadDocuments, loadDocumentLinks, seedEditorDraft, destroyEditorController, prepareEditorNavigation,
  pendingDocumentSave: () => documentSavePromise, currentDocument, resetLibraryFilters, documentDraftStorage,
  verifyHealthDoc: id => reviewWalk.verifyHealthDoc(id),
});
const { cacheLifecycleDocument, performDocumentLifecycleOnce } = lifecycle;
const reviewWalk = createReviewWalkController({
  getState: () => state, setState, renderApp, showToast, getRoot: () => appRoot, visibleLibraryDocuments,
  currentDocument, prepareEditorNavigation, openDocumentInEditor, destroyEditorController, goLibrary,
  cacheLifecycleDocument, performDocumentLifecycleOnce, changeDocumentVerification: lifecycle.changeDocumentVerification,
});
const runs = createRunController({
  getState: () => state, setState, renderApp, showToast, alertError, openConfirm, currentDocument,
  prepareEditorNavigation, openDocumentInEditor, goLibrary, copyToClipboard,
});
const transfer = createLibraryTransferController({
  getState: () => state, setState, renderApp, showToast, alertError, getRoot: () => appRoot, loadDocuments, loadTasks,
  storage: taskDraftStorage, markdownImportProjects, libraryExportProjects, inboxSlug: INBOX_SLUG,
});
const knowledge = createKnowledgeToolsController({
  getState: () => state, setState, renderApp, showToast, announce, copyToClipboard, getRoot: () => appRoot,
  prepareEditorNavigation, openDocumentInEditor, loadDocuments, captureProjectChoices, inboxSlug: INBOX_SLUG,
});
const writing = createWritingController({
  getState: () => state, setState, renderApp, showToast, copyToClipboard, getEditor: () => documentEditorController,
  destroyEditorController, handleDocumentDraftBodyChange,
});
const documentInfo = createDocumentInfoController({
  getState: () => state, setState, renderApp, showToast, currentDocument, cacheLifecycleDocument,
  destroyEditorController, saveDocumentDraft, loadDocuments,
});
const capture = createCaptureController({
  getState: () => state, setState, renderApp, showToast, getRoot: () => appRoot, loadTasks, defaultProjectId,
  inboxProjectId, todayISODate, renderOverlaysHtml,
});
const templateStudio = createTemplateStudioController({
  getState: () => state, setState, renderApp, showToast, openConfirm, getRoot: () => appRoot, prepareEditorNavigation,
  defaultProjectId, markdownImportProjects, loadDocuments, loadTasks, openDocumentInEditor, openTaskDrawer,
});
const drawer = createTaskDrawerController({
  getState: () => state, setState, renderApp, showToast, alertError, getRoot: () => appRoot, taskById, patchTask,
  projectsById, loadDocuments, openDocumentInEditor, flushTaskDrawerDraft, archiveTaskWithUndo,
});
// Merged data-action handlers of the controllers above; each action has one
// owner (tests/frontend/featureControllers.test.js).
const featureActions = {
  ...planMode.actions,
  ...assistant.actions,
  ...settings.actions,
  ...lifecycle.actions,
  ...reviewWalk.actions,
  ...runs.actions,
  ...transfer.actions,
  ...knowledge.actions,
  ...writing.actions,
  ...documentInfo.actions,
  ...capture.actions,
  ...templateStudio.actions,
  ...drawer.actions,
};

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

// Opening an editor needs five independent context reads. Installing each one
// separately rebuilt the entire shell and remounted CodeMirror five times.
// Fetch them concurrently, reject stale results, then install one coherent
// patch and render once. loadDocumentLinks remains for the targeted refresh
// after a supersession.
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
  // Links, related notes, backlinks and runs show only beside a preview. In
  // plain Edit mode nothing visible changed, so do not remount the editor
  // under the person's caret; the next render shows the installed context.
  const current = state.documents.find(d => d.id === documentId) || doc;
  const previewShown = Boolean(current.archivedAt) || state.editorMode !== 'edit';
  if (!state.isDocumentInfoEditorOpen && previewShown) renderApp();
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

// Showing a toast still renders the app: many callers change state and rely
// on this render to show it. Expiry is background work that lands while the
// person types, so it swaps only the toast layer and leaves the shell alone.
function showToast(message, undo = null, duration = undo ? 5000 : 2400, undoLabel = 'Undo') {
  clearTimeout(toastTimer);
  announce(message);
  setState({ toast: { message, undo, undoLabel } });
  toastTimer = setTimeout(() => {
    setState({ toast: null });
    renderToastLayer();
  }, duration);
  renderApp();
}

function dismissToast() {
  clearTimeout(toastTimer);
  setState({ toast: null });
}

function renderToastLayer() {
  const host = appRoot?.querySelector('[data-toast-root]');
  if (!host) { renderApp(); return; }
  const hadFocus = host.contains(document.activeElement);
  host.innerHTML = renderToastHtml(state);
  // Focus on an expiring Undo button would otherwise fall to <body>, where
  // plain letters reach the global shortcuts.
  if (hadFocus && state.navType === 'editor' && !host.contains(document.activeElement)) focusEditor();
}

// Screen-reader announcements go through one persistent polite live region
// outside #app (index.html). renderApp rebuilds #app wholesale, and a live
// region inserted together with its text is usually not announced, so the
// toast itself carries no role. Status regions that stay inside rendered views
// (dialog notices, the editor's save state, Library loading lines) are read
// with their view or when the person reaches them; outcomes that must be
// heard as they happen are announced here.
let announceTimer = null;
function announce(message) {
  const region = document.getElementById?.('app-announcer');
  if (!region) return;
  clearTimeout(announceTimer);
  region.textContent = '';
  // Set after a beat so a repeated message is announced again.
  announceTimer = setTimeout(() => { region.textContent = String(message || ''); }, 60);
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
  if (isSystemProject(projectsById()[id])) return;
  setState({ renamingProjectId: id });
  renderApp();
}

async function saveRenameProject(id, rawValue) {
  if (state.renamingProjectId !== id) return; // already committed/cancelled
  const value = (rawValue || '').trim();
  const project = projectsById()[id];
  setState({ renamingProjectId: null });
  if (!value || !project || isSystemProject(project) || value === project.name) { renderApp(); return; }
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

// Today triage (spec item 8): one decision applied to a set of tasks — a new
// due date (today / next Monday) or the backlog — through the same per-task
// mutation queue as the bulk bar, with one undo that restores what each task
// had before.
function triagePatch(decision) {
  if (decision === 'today') return { dueDate: todayISODate() };
  if (decision === 'monday') return { dueDate: nextMondayIso(new Date()) };
  if (decision === 'backlog') return { status: apiStatus('backlog') };
  return null;
}

// One patch per task through the per-task queue (with lost-response
// readback). Every task settles on its own, so a partial failure reports the
// tasks that did commit — and offers their undo — instead of a single
// "could not apply" over writes that happened.
async function applyTaskPatches(ids, patchFor) {
  const results = await Promise.allSettled(ids.map((id) => enqueueTaskMutation(id, () => updateTaskWithReadback(id, patchFor(id)))));
  const committed = ids.filter((_id, index) => results[index].status === 'fulfilled');
  return { committed, failed: ids.filter((id) => !committed.includes(id)) };
}

async function refreshTasksAfterWrites() {
  try { await loadTasks(); return true; } catch { return false; }
}

function taskCountLabel(count) {
  return count === 1 ? '1 task' : `${count} tasks`;
}

// "3 tasks → Backlog; 1 could not be changed." plus a refresh note. `failedNote`
// describes where the unconfirmed tasks are left.
function partialTaskOutcome(success, failed, refreshed, failedNote = 'could not be changed') {
  let message = success;
  if (failed.length) message += `; ${failed.length} ${failedNote}.`;
  if (!refreshed) message += `${failed.length ? '' : '.'} The list could not refresh; reload to reconcile it.`;
  return message;
}

async function undoTaskPatches(entries, patchFor, restoredLabel) {
  dismissToast();
  const { committed, failed } = await applyTaskPatches(entries.map((entry) => entry.id),
    (id) => patchFor(entries.find((entry) => entry.id === id)));
  const refreshed = await refreshTasksAfterWrites();
  if (failed.length || !refreshed) {
    showToast(committed.length
      ? partialTaskOutcome(`${taskCountLabel(committed.length)} ${restoredLabel}`, failed, refreshed, 'could not be restored')
      : 'Prax could not undo that change.', null, 7000);
  }
  renderApp();
}

async function triageTasks(ids, decision, label) {
  const patch = triagePatch(decision);
  if (!patch || !ids.length) return;
  const prior = ids.map((id) => {
    const task = taskById(id);
    return task ? { id, dueDate: task.dueDate ?? null, status: task.status } : null;
  }).filter(Boolean);
  setState({ selectedTaskId: null });
  const { committed, failed } = await applyTaskPatches(ids, () => patch);
  const refreshed = await refreshTasksAfterWrites();
  if (!committed.length) {
    alertError('apply the triage decision');
  } else {
    const undoable = prior.filter((entry) => committed.includes(entry.id));
    showToast(partialTaskOutcome(`${taskCountLabel(committed.length)} → ${label}`, failed, refreshed),
      () => undoTaskPatches(undoable, (entry) => (decision === 'backlog' ? { status: entry.status } : { dueDate: entry.dueDate }), 'restored'),
      failed.length || !refreshed ? 7000 : undefined);
  }
  renderApp();
}

function overdueTaskIds() {
  return (buildTodayGroups(state.tasks, state.projects, { now: new Date() }).groups
    .find((group) => group.key === 'overdue')?.tasks || []).map((task) => task.id);
}

function triageLabel(decision) {
  if (decision === 'monday') return new Date(`${nextMondayIso(new Date())}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  if (decision === 'today') return 'today';
  return 'Backlog';
}

async function bulkSetStatus(designKey, label) {
  const ids = [...state.multiSelectIds];
  if (!ids.length) return;
  const prior = ids.map(id => ({ id, status: taskById(id)?.status }));
  setState({ multiSelectIds: [] });
  const { committed, failed } = await applyTaskPatches(ids, () => ({ status: apiStatus(designKey) }));
  // Tasks whose change could not be confirmed stay selected for a retry.
  setState({ multiSelectIds: failed });
  const refreshed = await refreshTasksAfterWrites();
  if (!committed.length) {
    alertError('apply the bulk change');
  } else {
    const undoable = prior.filter(p => p.status && committed.includes(p.id));
    showToast(partialTaskOutcome(`${taskCountLabel(committed.length)} → ${label}`, failed, refreshed, 'could not be changed and remain selected'),
      () => undoTaskPatches(undoable, p => ({ status: p.status }), 'restored'),
      failed.length || !refreshed ? 7000 : undefined);
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
function syncSearchPanelDom({ fromRender = false } = {}) {
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
  if (fromRender) {
    // Re-attached under a full render: put back a find/replace field the
    // person was typing in, and never take focus from the document itself.
    const missing = renderMissingField;
    renderMissingField = null;
    if (missing && restoreRenderField(missing)) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== appRoot) return;
  }
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
  updateDocumentLivePreview(appRoot, value, { mode: 'document', editable: editorTaskToggles(), resolveWikiLink });
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
  // The server stores the trimmed title. A live title that normalises to the
  // saved one (a trailing space typed before the pause) is kept verbatim:
  // writing the trimmed value back would delete the space under the caret.
  if (stillActive && normalizeDocumentDraftTitle(state.documentDraftTitle) === normalizeDocumentDraftTitle(patch.documentDraftTitle)) {
    patch.documentDraftTitle = state.documentDraftTitle;
  }
  setState(patch);
  if (stillActive) {
    setSaveStatusInPlace(patch.documentSaveStatus);
    const title = appRoot?.querySelector('[data-doc-title]');
    if (title && normalizeDocumentDraftTitle(title.value) !== normalizeDocumentDraftTitle(patch.documentDraftTitle)) {
      title.value = patch.documentDraftTitle;
    }
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
    updateDocumentLivePreview(appRoot, patch.documentDraftBody, { mode: 'document', editable: editorTaskToggles(), resolveWikiLink });
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
    mountedEditorDocId = state.editorDocId;
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
    // Restore the caret or selection carried over a re-mount of the same
    // document (keeps the ✦ AI menu's target highlighted and live-readable, and
    // mid-document typing where it was), plus scroll and keyboard focus. Guard
    // the offsets against a shorter buffer.
    const carried = pendingEditorSelection;
    if (carried && carried.docId === state.editorDocId && documentEditorController.setSelectionRange) {
      const len = (state.documentDraftBody || '').length;
      documentEditorController.setSelectionRange(Math.min(carried.from, len), Math.min(carried.to, len));
      documentEditorController.restoreScroll?.(carried.scroll);
      if (carried.focused) documentEditorController.focus();
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

// Preview task items are checkboxes only in the open, editable document.
function editorTaskToggles() {
  const doc = currentDocument();
  return Boolean(doc) && !doc.archivedAt;
}

function toggleMarkdownCheck(line) {
  if (state.navType !== 'editor' || !editorTaskToggles() || !Number.isInteger(line) || line < 0) return;
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

async function openDocumentInEditor(documentId, { isCurrent = () => true } = {}) {
  if (!isCurrent()) return false;
  if (state.navType === 'editor' && state.editorDocId === documentId) return true;
  if (!(await prepareEditorNavigation(documentId))) return false;
  if (!isCurrent()) return false;
  const returnView = state.navType === 'library'
    ? { ...captureLibraryReturn(state, { documentId, scrollTop: appRoot.querySelector('.main__scroll')?.scrollTop }), collectionWindow: { ...libraryCollectionWindow }, documentsFingerprint: collectionFingerprint(state.documents) }
    : (state.navType === 'editor' ? state.editorReturnView
      : (state.navType === 'project' && state.navId === inboxProjectId()
        ? { kind: 'inbox', projectId: state.navId, tab: state.tab } : null));
  destroyEditorController();
  let doc = state.documents.find(d => d.id === documentId);
  if (!doc) {
    setState({ libraryView: 'active' });
    await loadDocuments();
    if (!isCurrent()) return false;
    doc = state.documents.find(d => d.id === documentId);
  }
  if (!doc) { alertError('open that document'); return false; }
  seedEditorDraft(doc);
  writing.invalidate(); // drop any in-flight writing action from a previous doc
  setState({
    navType: 'editor', editorReturnView: returnView, editorFocus: false, writeMenuOpen: false, writeSelection: null, writeContext: null, writeResult: null, writeLoading: false, writeError: null,
    recentDocuments: saveRecentDocuments(pushRecentDocument(state.recentDocuments, documentId)),
  });
  renderApp();
  loadDocumentContext(doc);
  return true;
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

// Projects offered in the capture picker: Inbox first, then active/on-hold user
// projects, each carrying its dot color for the menu.
function captureProjectChoices() {
  const inbox = inboxProject();
  const rest = (state.projects || []).filter(
    (p) => p.slug !== INBOX_SLUG && (p.status === 'active' || p.status === 'on-hold'),
  );
  return (inbox ? [inbox, ...rest] : rest).map((p) => ({ ...p, color: projectColor(p) }));
}

// One new document at a time: a double click on New document (or a repeated
// palette command) while the first create is in flight creates one.
let documentCreatePending = false;
async function createNewDocument(templateId) {
  if (documentCreatePending) return false;
  documentCreatePending = true;
  try {
    if (!(await prepareEditorNavigation())) return false;
    setState({ newDocMenuOpen: false });
    destroyEditorController(); // fresh mount (cursorToEnd), no selection carried in
    const project = defaultProjectId();
    if (!project) { showToast('Create a project first.'); renderApp(); return false; }
    const template = templateById(templateId);
    let doc;
    try {
      doc = await createDocument({
        title: template.title, body: template.body, documentType: template.documentType, project, tags: [],
      });
    } catch {
      alertError('create a document');
      return false;
    }
    // The document exists: a failed Library refresh still opens it, rather
    // than reporting a failed create that invites a second one.
    try { await loadDocuments(); } catch { /* the created record below stands in */ }
    if (!state.documents.some(d => d.id === doc.id)) setState({ documents: [doc, ...state.documents] });
    seedEditorDraft(state.documents.find(d => d.id === doc.id) || doc);
    writing.invalidate(); // drop any writing state carried from the previous doc
    setState({ navType: 'editor', editorMode: 'edit', editorFocus: false, writeMenuOpen: false, writeSelection: null, writeContext: null, writeResult: null, writeLoading: false, writeError: null });
    renderApp();
    showToast('New document — rename it in the title bar');
    return true;
  } finally {
    documentCreatePending = false;
  }
}

function markdownImportProjects() {
  return (state.projects || []).filter(project => project.status === 'active' || project.status === 'on-hold');
}

function libraryExportProjects() {
  const projects = state.managedProjects?.length ? state.managedProjects : state.projects;
  return (projects || []).filter(project => project.slug);
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
  setState({ navType: 'filter', editorFocus: false, activeFilterExpr: expr, activeSmartViewId: smartViewId, selectedTaskId: null, multiSelectIds: [], panelTab: 'views', ...capture.nlFilterResetPatch() });
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
// Navigation
// ---------------------------------------------------------------------------

function resetLibraryFilters() {
  return {
    libraryQuery: '', librarySemantic: false, activeLibraryTags: [], libraryProjects: [],
    ...resetSemanticSearchPatch(), libraryView: 'active', librarySelectedDocIds: [],
  };
}

// The library model exactly as renderMainHtml builds it, for handlers that
// need the VISIBLE documents (select all shown, review next).
function visibleLibraryDocuments() {
  const collectionKey = JSON.stringify([
    state.libraryView, state.libraryQuery, state.librarySemantic, state.librarySortBy,
    state.activeLibraryTags, state.libraryTypes, state.libraryTrust, state.libraryProjects,
  ]);
  const model = buildLibraryModel(state, { limit: libraryCollectionLimit(collectionKey) });
  return model.groups.flatMap((group) => group.docs);
}

// Enter (or leave) the review queue. From anywhere else, go to the library
// first; inside the library, toggle without losing facets.
async function toggleReviewQueue() {
  if (state.navType !== 'library') { await goLibrary({ libraryView: 'review' }); return; }
  const wasArchive = state.libraryView === 'archive';
  setState({
    libraryView: state.libraryView === 'review' ? 'active' : 'review',
    librarySelectedDocIds: [], libraryMenuOpen: false, ...resetSemanticSearchPatch(),
  });
  if (wasArchive) await loadDocuments();
  renderApp();
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
  if (projectId === inboxProjectId()) {
    if (['inbox', 'reviews'].includes(tab)) void inboxController.load(tab === 'reviews' ? 'reviews' : 'pending');
    else void inboxController.summary().then(() => { if (state.navType === 'project' && state.navId === projectId) renderApp(); });
  }
  externalRefresh.trigger('navigate');
  if (tab === 'archive') loadArchivedTasks().then(renderApp);
  renderApp();
  return true;
}

let pendingLibraryScroll = null;
let lastLibraryRenderKey = null;

async function goLibrary(extra = {}, { restore = false } = {}) {
  if (!(await prepareEditorNavigation())) return false;
  destroyEditorController();
  const snapshot = restore && state.editorReturnView?.kind === 'library' ? state.editorReturnView : null;
  setState({ navType: 'library', editorFocus: false, ...resetLibraryFilters(),
    ...libraryReturnPatch(snapshot), ...extra, editorReturnView: null, reviewWalk: null });
  if (snapshot?.collectionWindow) libraryCollectionWindow = { ...snapshot.collectionWindow };
  if (snapshot) pendingLibraryScroll = { key: libraryViewKey(state), top: snapshot.scrollTop, documentId: snapshot.documentId };
  renderApp();
  const semanticReturn = snapshot && state.librarySemantic && state.libraryQuery.trim();
  let refreshedSearch = false;
  function refreshChangedSearch() {
    if (!semanticReturn || refreshedSearch || state.navType !== 'library' || libraryViewKey(state) !== snapshot.key) return;
    if (snapshot.pendingSearch || snapshot.documentsFingerprint !== collectionFingerprint(state.documents)) {
      refreshedSearch = true;
      void runSemanticSearch();
    }
  }
  refreshChangedSearch();
  loadDocuments()
    .then((applied) => { if (applied && state.navType === 'library') { refreshChangedSearch(); renderApp(); } })
    .catch(() => { if (state.navType === 'library') alertError('load the library'); });
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
  if (state.writeContext) { writing.closeWrite(); return; }
  if (state.editorSearchOpen) { closeEditorSearch(); return; }
  if (state.assistantOpen) { setState({ assistantOpen: false }); renderApp(); return; }
  if (state.askPraxOpen) { knowledge.closeAskPrax(); return; }
  if (state.genRbOpen) { setState({ genRbOpen: false }); renderApp(); return; }
  if (state.dailyBriefOpen) { setState({ dailyBriefOpen: false }); renderApp(); return; }
  if (state.planMode) { setState({ planMode: null }); renderApp(); return; }
  if (state.templateStudio) { templateStudio.closeTemplateStudio(); return; }
  if (state.libraryExportOpen) { transfer.closeLibraryExport(); return; }
  if (state.markdownImportOpen) { transfer.closeMarkdownImport(); return; }
  if (state.confirm) { setState({ confirm: null }); renderApp(); return; }
  if (state.docMenuOpen) { setState({ docMenuOpen: false }); renderApp(); return; }
  if (state.paletteOpen) { setState({ paletteOpen: false }); renderApp(); return; }
  // Inside capture, the NL layer peels first: Esc aborts a parse / discards the
  // preview and restores the typed text; only the next Esc closes the overlay.
  if (state.captureOpen && (state.nlCaptureLoading || state.nlCaptureFields || state.nlCaptureError)) { capture.cancelNlCapture(); return; }
  if (state.captureOpen) {
    if (state.captureSubmitting) return;
    capture.discardCapture();
    capture.renderCaptureOverlayLayer({ restoreFocus: true });
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
  if (state.navType === 'run') runs.backFromRun();
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
  // The archive collection swaps state.documents; no queue count from it.
  const reviewCount = state.libraryView === 'archive' ? 0 : reviewQueue(state.documents).length;
  if (state.inbox?.summary && inboxProjectId()) projectOpen[inboxProjectId()] = state.inbox.summary.total;
  return { todayBadge: badge, projectOpen, reviewQueue: reviewCount };
}

function projectTasks() {
  return state.tasks.filter(t => t.projectId === state.navId);
}

function renderMainHtml() {
  const now = new Date();
  if (state.apiStatus === 'loading'
    && ['today', 'all', 'filter', 'calendar', 'project'].includes(state.navType)) {
    return renderTasksLoadingHtml();
  }
  switch (state.navType) {
    case 'today': {
      const built = buildTodayGroups(state.tasks, state.projects, { now });
      // A collapsed week ahead leaves the collection so arrow keys and the
      // "load more" progress only ever address rows that are on screen.
      const weekCollapsed = isCollapsed(state.collapsedSections, TODAY_WEEK_SECTION);
      // The triage band previews the oldest OVERDUE_PREVIEW rows unless the
      // user asked for all of them; hidden rows leave the collection so ↑↓
      // only ever reach what is on screen.
      const overdueExpanded = isCollapsed(state.collapsedSections, TODAY_OVERDUE_ALL);
      const groups = (weekCollapsed ? built.groups.filter((group) => !group.week) : built.groups)
        .map((group) => (group.key === 'overdue' && !overdueExpanded && group.tasks.length > OVERDUE_PREVIEW
          ? { ...group, tasks: group.tasks.slice(0, OVERDUE_PREVIEW), totalCount: group.tasks.length }
          : group));
      const collection = limitTaskGroups(groups, taskCollectionLimit(`today|${weekCollapsed ? 'folded' : 'week'}|${overdueExpanded ? 'all' : 'preview'}`));
      flatIds = collection.flatIds;
      return renderTodayHtml(state, collection.groups, {
        now, snoozedCount: built.snoozedCount, collection,
        plannedCount: built.plannedCount, plannedDone: built.plannedDone,
        stalePlannedCount: built.stalePlannedCount,
        weekCount: built.weekCount, weekCollapsed,
        overdueTotal: built.overdueCount, overdueExpanded, slippedCount: built.slippedCount,
        queueCount: reviewQueue(state.documents).length,
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
      if (!doc) return renderDocumentNotFoundHtml();
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
        previewHtml: renderMarkdownHtml(text, { mode: 'document', editable: !doc.archivedAt, resolveWikiLink }),
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
      const backlogCount = tasks.filter(t => designStatus(t.status) === 'backlog' && !t.archivedAt).length;
      const archiveCount = state.tab === 'archive' ? state.archivedTasks.length : 0;
      const inboxView = project?.slug === 'inbox';
      let body = '';
      if (inboxView && ['inbox', 'reviews'].includes(state.tab)) {
        body = renderInboxView(state.inbox);
        flatIds = [];
      } else if (state.tab === 'board') {
        const columns = buildBoardColumns(state, tasks, { now });
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
      return renderProjectPageHtml(state, project, { backlogCount, archiveCount, bodyHtml: body });
    }
  }
}

function renderOverlaysHtml() {
  let html = '';
  html += renderInboxDialog(state.inbox);
  if (state.templateStudio) html += renderTemplateStudioHtml(state.templateStudio, templateStudio.choices(), markdownImportProjects(), renderMarkdownHtml(state.templateStudio.source.body, { mode: 'untrusted' }));
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
    html += renderAskPraxHtml(state, { bodyHtml: md ? renderMarkdownHtml(md, { mode: 'untrusted', resolveWikiLink }) : '' });
  }
  if (state.genRbOpen) {
    html += renderGenerateRunbookHtml(state, { projects: captureProjectChoices().filter((p) => p.slug !== INBOX_SLUG) });
  }
  if (state.dailyBriefOpen) {
    html += renderDailyBriefHtml(state, {
      briefHtml: renderMarkdownHtml(buildDailyBrief(state), { mode: 'untrusted', resolveWikiLink }),
      narrativeHtml: state.dailyBriefNarrative ? renderMarkdownHtml(state.dailyBriefNarrative, { mode: 'untrusted', resolveWikiLink }) : '',
    });
  }
  if (state.assistantOpen) {
    html += renderAssistantHtml(state, { renderMarkdown: (md) => renderMarkdownHtml(md, { mode: 'untrusted', resolveWikiLink }) });
  }
  if (state.writeContext && state.navType === 'editor') {
    html += renderWritingPreviewHtml(state, { resultHtml: state.writeResult ? renderMarkdownHtml(state.writeResult, { mode: 'untrusted', resolveWikiLink }) : '' });
  }
  if (state.planMode) html += renderPlanModeHtml(state);
  if (state.shortcutsOpen) html += renderShortcutsHtml(state);
  if (state.confirm) html += renderConfirmHtml(state.confirm);
  html += renderToastRootHtml(renderToastHtml(state));
  return html;
}

// ---- render continuity -------------------------------------------------------
// renderApp rebuilds the shell with innerHTML, and background work — context
// and enrichment loads, reminders, external refresh, a toast shown by a
// finished request — renders while the person types. A same-view render puts
// back what they were typing into: the focused field and its caret, text that
// lives only in the DOM (below), and the editor's caret and scroll (see
// mountEditorIfNeeded). A navigation starts fresh.

// Fields whose text lives only in the DOM until an explicit submit — nothing
// mirrors it into state, so a render would reset it to its last rendered value.
const DOM_ONLY_FIELDS = [
  '[data-checklist-new]', '[data-confirm-input]', '[data-new-project-name]', '[data-project-rename]',
  '[data-plan-time]', '[data-shutdown-date]', '[data-replace-confirm]',
].join(', ');
// Forms saved as a whole: an edited field keeps its text after focus moves on.
const DOM_ONLY_FORM_FIELDS = [
  '[data-capture-shortcut]', '[data-ai-chat-binary]', '[data-ai-chat-model]', '[data-ai-chat-base-url]',
  '[data-ai-chat-key]', '[data-ai-base-url]', '[data-ai-model]', '[data-ai-key]',
  '[data-genrb-input]', '[data-genrb-project]',
].join(', ');
const TEXT_ENTRY_FIELDS = 'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"])'
  + ':not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"])';
let renderingApp = false;        // focusout while the old DOM is torn down is not the person leaving a field
let renderContinuity = null;     // captured by renderApp, consumed by afterRender
let renderRestoredField = null;  // the field put back this render: its caret is the person's
let renderMissingField = null;   // a focused field the render has not re-inserted yet (find/replace panel)
let renderedPlanMode = null;       // the plan-walk step (state.planMode object) the DOM shows
let retainedPlanModeFocus = null; // the plan-walk button focused before a render: { planMode, action }

function renderedFieldValue(el) {
  if (el.tagName !== 'SELECT') return el.defaultValue;
  const options = [...el.options];
  return (options.find(option => option.defaultSelected) || options[0])?.value ?? '';
}

// A field's identity across renders: its tag, id/name and data-* attributes,
// plus its position among identical matches. Unidentifiable fields are skipped.
function renderFieldKey(el) {
  const attrs = [...el.attributes].filter(attr => attr.name === 'id' || attr.name === 'name' || attr.name.startsWith('data-'));
  if (!attrs.length) return null;
  const selector = el.tagName.toLowerCase() + attrs.map(attr => `[${attr.name}="${CSS.escape(attr.value)}"]`).join('');
  return { selector, index: [...appRoot.querySelectorAll(selector)].indexOf(el) };
}

function findRenderField(key) {
  return key ? appRoot.querySelectorAll(key.selector)[key.index] || null : null;
}

function captureRenderContinuity() {
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && appRoot.contains(active) && active.matches(TEXT_ENTRY_FIELDS)
    ? active : null;
  const edits = [];
  for (const el of appRoot.querySelectorAll(`${DOM_ONLY_FIELDS}, ${DOM_ONLY_FORM_FIELDS}`)) {
    const rendered = renderedFieldValue(el);
    if (el.value === rendered || (el !== focused && !el.matches(DOM_ONLY_FORM_FIELDS))) continue;
    const key = renderFieldKey(el);
    if (key) edits.push({ key, value: el.value, rendered });
  }
  const key = focused && renderFieldKey(focused);
  const field = key ? {
    key,
    value: focused.value,
    selection: typeof focused.selectionStart === 'number'
      ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection || 'none'] : null,
    scrollTop: focused.scrollTop,
    pageScrollTop: appRoot.querySelector('.main__scroll')?.scrollTop ?? null,
  } : null;
  return { edits, field };
}

// Runs inside afterRender, before its per-surface focus policy: a dialog the
// render just opened still takes focus from the field restored here.
function restoreRenderContinuity() {
  const snapshot = renderContinuity;
  renderContinuity = null;
  renderRestoredField = null;
  renderMissingField = null;
  if (!snapshot) return;
  for (const edit of snapshot.edits) {
    const el = findRenderField(edit.key);
    // Only where the render reset the field; a value state changed on purpose
    // (a save that re-rendered it, a reconcile) stands.
    if (el && renderedFieldValue(el) === edit.rendered && el.value === edit.rendered) el.value = edit.value;
  }
  if (snapshot.field && !restoreRenderField(snapshot.field)) renderMissingField = snapshot.field;
}

function restoreRenderField(field) {
  const el = findRenderField(field.key);
  if (!el || el.disabled) return false;
  const scroll = appRoot.querySelector('.main__scroll');
  if (scroll && field.pageScrollTop != null) scroll.scrollTop = field.pageScrollTop;
  el.focus();
  if (document.activeElement !== el) return false;
  try {
    if (el.value === field.value && field.selection) el.setSelectionRange(...field.selection);
    else if (typeof el.selectionStart === 'number') el.setSelectionRange(el.value.length, el.value.length);
  } catch { /* not a text control (date, time, select) */ }
  if (el.value === field.value) el.scrollTop = field.scrollTop;
  renderRestoredField = el;
  return true;
}

// Focus a surface's text input with the caret at the end — unless this render
// just gave the person back that field, caret and all.
function focusInputAtEnd(input) {
  if (!input || input === renderRestoredField) return;
  input.focus();
  input.setSelectionRange?.(input.value.length, input.value.length);
}

function renderApp() {
  if (!appRoot) return;
  const currentLibraryKey = state.navType === 'library' ? libraryViewKey(state) : null;
  const retainedLibraryScroll = currentLibraryKey && currentLibraryKey === lastLibraryRenderKey
    ? appRoot.querySelector('.main__scroll')?.scrollTop : null;
  const retainedLibraryFocus = retainedLibraryScroll != null && document.activeElement?.dataset.action === 'open-doc'
    ? document.activeElement.dataset.documentId : null;
  const planModeButton = state.planMode ? document.activeElement?.closest?.('[data-overlay="planmode"] button[data-action]') : null;
  retainedPlanModeFocus = planModeButton ? { planMode: renderedPlanMode, action: planModeButton.dataset.action } : null;
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
  // Carry the editor's selection, focus and scroll across the re-mount below
  // when it stays on the same document. Without this, opening the ✦ AI menu
  // would drop the selection a writing action needs, and a background render
  // moved later keystrokes to the end of the document. A fresh open (the
  // caller destroyed the controller first) still starts at the end.
  pendingEditorSelection = state.navType === 'editor' && documentEditorController?.getSelectionRange
    ? {
      ...documentEditorController.getSelectionRange(),
      focused: Boolean(appRoot.querySelector('[data-code-editor]')?.contains(document.activeElement)),
      scroll: documentEditorController.scrollSnapshot?.() || null,
      docId: mountedEditorDocId,
    }
    : null;
  destroyEditorController();
  writing.dropOutsideEditor();
  const narrow = state.winW < 940;
  const chrome = !state.editorFocus;
  const counts = sidebarCounts();
  const nav = chrome
    // Console shell: wide windows get the one labelled sidebar (places +
    // the current context); narrow windows keep the icon rail alone.
    ? (narrow ? renderRailHtml(state, counts, { showProjects: true }) : renderPanelHtml(state, counts))
    : '';
  // The main-content fade-in is a *view-transition* cue. renderApp rebuilds the
  // DOM on every state change, so without this the fade replays on same-view
  // re-renders too — a strobe while typing in the library search / filtering.
  // Only animate when the view identity actually changes.
  const viewKey = `${state.navType}|${state.navId}|${state.tab}|${state.libraryView}|${state.editorDocId}|${state.settingsTab}`;
  const flatMain = viewKey === prevViewKey;
  prevViewKey = viewKey;
  renderContinuity = flatMain ? captureRenderContinuity() : null;
  renderingApp = true;
  try {
    appRoot.innerHTML = renderAppFrameHtml({
      titlebarHtml: chrome ? renderTitlebarHtml(state) : '',
      navHtml: nav,
      mainHtml: renderMainHtml(),
      flatMain,
      statusbarHtml: chrome ? renderStatusbarHtml(state) : '',
      overlaysHtml: renderOverlaysHtml(),
      // The docked inspector takes the right of the window; the body makes
      // room so the list never runs underneath it.
      inspector: Boolean(state.drawerTaskId && taskById(state.drawerTaskId) && inspectorDocked(state)),
    });
  } finally {
    renderingApp = false;
  }
  afterRender();
  const returning = pendingLibraryScroll?.key === currentLibraryKey ? pendingLibraryScroll : null;
  if (returning?.documentId || retainedLibraryFocus) {
    [...appRoot.querySelectorAll('[data-action="open-doc"], [data-action="open-library-doc"]')]
      .find(el => (el.dataset.documentId || el.dataset.libraryDocumentId) === (returning?.documentId || retainedLibraryFocus))?.focus({ preventScroll: true });
  }
  const scroll = appRoot.querySelector('.main__scroll');
  if (scroll && (returning || retainedLibraryScroll != null)) scroll.scrollTop = returning ? returning.top : retainedLibraryScroll;
  pendingLibraryScroll = null;
  lastLibraryRenderKey = currentLibraryKey;
}

function afterRender() {
  // Before any focus restore: nothing beneath an open modal may take focus.
  syncModalInert(appRoot);
  mountEditorIfNeeded();
  restoreRenderContinuity();
  renderedPlanMode = state.planMode;
  if (state.inbox?.processing) {
    const dialog = appRoot.querySelector('[data-inbox-dialog]');
    if (dialog && !dialog.contains(document.activeElement)) {
      (dialog.querySelector('[data-inbox-field]:not([disabled])') || dialog)?.focus({ preventScroll: true });
    }
    return;
  }
  if (templateStudio.afterRender(renderRestoredField)) return;
  transfer.restoreFocus();
  if (state.renamingProjectId) {
    const input = appRoot.querySelector('[data-project-rename]');
    if (input && document.activeElement !== input) { input.focus(); input.select(); }
  }
  if (state.paletteOpen) {
    focusInputAtEnd(appRoot.querySelector('[data-palette-input]'));
  } else if (state.captureOpen) {
    // The DOM is fresh after every render — put the caret at the end so typing
    // continues the title (matters after the parse swaps the input's value;
    // a swapped value is not restored as the person's, so it still gets here).
    focusInputAtEnd(appRoot.querySelector('[data-capture-input]'));
  } else if (state.assistantOpen) {
    // Keep the transcript pinned to the latest turn, and (when idle) the caret
    // in the composer.
    const scroll = appRoot.querySelector('[data-assistant-scroll]');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    if (!state.assistantLoading && !(state.assistantPending && state.assistantPending.length)) {
      focusInputAtEnd(appRoot.querySelector('[data-assistant-input]'));
    }
  } else if (state.askPraxOpen && !state.askPraxLoading) {
    focusInputAtEnd(appRoot.querySelector('[data-ask-prax-input]'));
  } else if (state.genRbOpen && !state.genRbLoading) {
    const input = appRoot.querySelector('[data-genrb-input]');
    // The project picker keeps its focus too; only a fresh dialog starts in the text.
    if (!renderRestoredField?.matches('[data-genrb-project]')) focusInputAtEnd(input);
  } else if (state.markdownImportOpen && !state.markdownImportPending) {
    if (!renderRestoredField?.closest('[data-overlay-root]')) {
      (state.markdownImportFiles.length
        ? appRoot.querySelector('[data-action="submit-markdown-import"]')
        : appRoot.querySelector('[data-markdown-import-project]'))?.focus();
    }
  } else if (state.libraryExportOpen && !state.libraryExportPending) {
    if (!renderRestoredField?.closest('[data-overlay-root]')) {
      appRoot.querySelector(state.libraryExportFormat === 'workspace' ? '[data-library-export-format]' : '[data-library-export-scope]')?.focus();
    }
  } else if (state.confirm) {
    // Focus the text field when there is one; otherwise Cancel — never the
    // destructive action, so a stray Enter can't confirm a delete.
    (appRoot.querySelector('[data-confirm-input]')
      || appRoot.querySelector('.confirm button[data-action="confirm-cancel"]'))?.focus();
  } else if (state.planMode) {
    // Each item starts on its primary decision, so Enter runs it and Tab
    // reaches the others; a field the person was using keeps its focus.
    // A background render on the same item keeps the button they tabbed to.
    const dialog = appRoot.querySelector('[data-overlay="planmode"] [role="dialog"]');
    const kept = retainedPlanModeFocus?.planMode === state.planMode ? retainedPlanModeFocus.action : null;
    if (dialog && !dialog.contains(document.activeElement)) {
      ((kept && dialog.querySelector(`.planmode__actions button[data-action="${kept}"]`))
        || dialog.querySelector('.planmode__actions .btn-primary'))?.focus({ preventScroll: true });
    }
  } else if (state.navType === 'editor' && !state.drawerTaskId
    && !state.isDocumentInfoEditorOpen && !state.editorSearchOpen) {
    // Keep the caret in the document: an unfocused editor screen would let
    // plain letters fall through to the global shortcuts (n = capture…).
    const active = document.activeElement;
    if (!active || active === document.body || active === appRoot) focusEditor();
  }
  // Re-attach the find/replace panel if a full render wiped it (it lives
  // outside renderApp so CodeMirror is never remounted mid-search).
  syncSearchPanelDom({ fromRender: true });
  if (state.navType === 'project' && (state.tab === 'board' || state.tab === 'list')) {
    const visibleIds = new Set(flatIds);
    ensureBoardExtras(projectTasks().filter(t => !t.archivedAt && visibleIds.has(t.id)));
  }
}

// ---------------------------------------------------------------------------
// Palette commands
// ---------------------------------------------------------------------------

const paletteCommands = {
  'new-task': () => { capture.openFreshCapture(); },
  'new-document': () => { setState({ paletteOpen: false }); createNewDocument(); },
  'toggle-theme': () => { setState({ paletteOpen: false }); settings.toggleTheme(); },
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
  'go-settings': async () => { setState({ paletteOpen: false }); await settings.goSettings(); },
  // The Library's occasional actions live behind its ⋯ menu; these give each
  // a keyboard route. The dialogs are overlays, so they open from any view.
  'go-ask-prax': () => { knowledge.openAskPrax(); },
  'go-health': async () => { setState({ paletteOpen: false }); await knowledge.goHealth(); },
  'go-weekly-review': async () => { setState({ paletteOpen: false }); renderApp(); await knowledge.runWeeklyReview(); },
  'go-review-queue': async () => {
    setState({ paletteOpen: false });
    if (state.navType === 'library' && state.libraryView === 'review') { renderApp(); return; }
    await toggleReviewQueue();
  },
  'go-import': () => { setState({ paletteOpen: false }); transfer.openMarkdownImport(); },
  'go-export': () => { setState({ paletteOpen: false }); transfer.openLibraryExport('all', 'export-library'); },
  'go-shortcuts': () => { setState({ paletteOpen: false }); openShortcuts(); },
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
  drawer.loadDrawerContext(taskId);
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
// Actions: feature controllers own their data-actions (featureActions);
// the workspace's own actions stay in the switch below.
// ---------------------------------------------------------------------------

// One project create at a time: a repeated Enter or a double click while the
// first POST is in flight would otherwise create two projects.
let projectCreatePending = false;
async function handleAction(action, el, event) {
  if (action.startsWith('inbox-')) {
    const handlers = {
      'inbox-start': () => inboxController.start(el.dataset.kind, el.dataset.id),
      'inbox-open': () => inboxController.openRecord(el.dataset.kind, el.dataset.id),
      'inbox-close': () => inboxController.close(),
      'inbox-skip': () => inboxController.skip(),
      'inbox-item-reload': () => inboxController.reload(),
      'inbox-reload': () => inboxController.load(),
      'inbox-more': () => inboxController.load(undefined, { append: true }),
      'inbox-file': () => inboxController.apply('file'),
      'inbox-reference': () => inboxController.apply('reference'),
      'inbox-complete': () => inboxController.apply('complete'),
      'inbox-archive': () => inboxController.apply('archive'),
      'inbox-retry': () => inboxController.apply(),
      'inbox-undo': () => inboxController.undo(),
      'inbox-suggest': () => inboxController.suggest(),
      'inbox-use-suggestion': () => inboxController.useSuggestion(),
    };
    try { await handlers[action]?.(); } catch { showToast('Prax could not open this Inbox item. Your decision is retained.'); }
    return;
  }
  const featureAction = featureActions[action];
  if (featureAction) { await featureAction(el, event, action); return; }
  switch (action) {
    // ---- navigation ----
    case 'nav-today': await navigateTopLevel({ navType: 'today', selectedTaskId: null, multiSelectIds: [] }); break;
    case 'nav-all': await navigateTopLevel({ navType: 'all' }); break;
    case 'manage-projects':
      if (await navigateTopLevel({ navType: 'all' })) openConfirm(newProjectDialog());
      break;
    case 'nav-library': await goLibrary(); break;
    case 'nav-review': await goLibrary({ libraryView: 'review' }); break;
    // Today's agent card shows a few rows; the rest are the Library's
    // agent-written facet, newest first.
    case 'open-agent-memory': await goLibrary({ libraryTrust: ['agent'], librarySortBy: 'updated' }); break;
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
    case 'nav-settings': await settings.goSettings(); settings.loadCaptureShortcut(); break;
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
      const view = name ? createSmartView(name, state.activeFilterExpr, state.taskSmartViews) : null;
      if (view) {
        // Only a view with this exact name is replaced, and the toast says so.
        const replaced = state.taskSmartViews.some(v => v.id === view.id);
        setState({ taskSmartViews: [...state.taskSmartViews.filter(v => v.id !== view.id), view], activeSmartViewId: view.id });
        persistSmartViews();
        if (replaced) { showToast(`Updated the smart view “${view.label}”.`); break; }
      }
      renderApp();
      break;
    }
    case 'nav-project': await goProject(el.dataset.projectId); break;
    case 'rename-project': startRenameProject(el.dataset.projectId); break;
    case 'breadcrumb': await handleAction(el.dataset.target, el, event); break;
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
      if (state.navId === inboxProjectId() && ['inbox', 'reviews'].includes(tab)) {
        await inboxController.load(tab === 'reviews' ? 'reviews' : 'pending');
      }
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
      if (state.captureOpen) capture.discardCapture();
      setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0, paletteScope: 'all' });
      renderApp();
      break;
    case 'toggle-theme': settings.toggleTheme(); break;

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
      // patchTask has already reported a failed write; never replace that.
      if (await patchTask(el.dataset.taskId, { status: apiStatus('planned') }, { failure: 'promote this task' })) showToast('Promoted to board');
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

    // ---- library ----
    case 'open-doc': await openDocumentInEditor(el.dataset.documentId); break;
    case 'triage-all': {
      // From a project list the set is that project's overdue group; from
      // Today it is every project's.
      const ids = el.dataset.projectId
        ? (buildListGroups(state, state.tasks.filter((task) => task.projectId === el.dataset.projectId), { now: new Date() }).groups
          .find((group) => group.key === 'overdue')?.tasks || []).map((task) => task.id)
        : overdueTaskIds();
      await triageTasks(ids, el.dataset.decision, triageLabel(el.dataset.decision));
      break;
    }
    case 'triage-task': await triageTasks([el.dataset.taskId], el.dataset.decision, triageLabel(el.dataset.decision)); break;
    case 'toggle-semantic': setState({ librarySemantic: !state.librarySemantic, ...resetSemanticSearchPatch() }); renderApp(); break;
    case 'load-more-semantic': runSemanticSearch({ append: true }); break;
    case 'show-more-library':
      libraryCollectionWindow.limit += LIBRARY_RENDER_BATCH_SIZE;
      renderApp();
      break;
    case 'cycle-lib-sort': {
      const next = nextLibrarySort(state.librarySortBy, { review: state.libraryView === 'review' });
      setState({ librarySortBy: next });
      renderApp();
      // Most recalled needs the counts; refresh them each time it is chosen.
      if (next === 'recalled') {
        fetchRecallCounts()
          .then((recallCounts) => { setState({ recallCounts }); if (state.librarySortBy === 'recalled') renderApp(); })
          .catch(() => { showToast('Recall counts are unavailable; the queue keeps its order.'); });
      }
      break;
    }
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
    case 'toggle-new-menu': setState({ newMenuOpen: !state.newMenuOpen, libraryMenuOpen: false, newDocMenuOpen: false }); renderApp(); break;
    case 'new-project': {
      // All projects owns project creation; land there with the name field ready.
      setState({ newMenuOpen: false });
      if (await navigateTopLevel({ navType: 'all' })) appRoot.querySelector('[data-new-project-name]')?.focus();
      break;
    }
    case 'set-search-mode': {
      const semantic = el.dataset.mode === 'semantic';
      if (semantic && !(state.semanticStatus?.available && state.semanticStatus?.enabled)) {
        // The segment is always drawn; without an embedding backend the
        // Semantic half leads to the Settings card that provides one.
        if (await settings.goSettings()) {
          settings.loadCaptureShortcut();
          setState({ settingsTab: 'intelligence' });
          showToast(SEMANTIC_UNAVAILABLE_HINT);
          renderApp();
          requestAnimationFrame(() => appRoot.querySelector('[data-settings-card="intelligence"]')?.scrollIntoView({ block: 'start' }));
        }
        break;
      }
      if (semantic !== Boolean(state.librarySemantic)) setState({ librarySemantic: semantic, ...resetSemanticSearchPatch() });
      renderApp();
      break;
    }
    case 'cycle-lib-group': setState({ libraryGroupBy: state.libraryGroupBy === 'none' ? 'type' : 'none' }); renderApp(); break;
    case 'new-document': setState({ newMenuOpen: false }); createNewDocument(el.dataset.templateId); break;
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
    case 'open-review-queue': await toggleReviewQueue(); break;
    case 'set-library-layout': setState({ libraryLayout: saveLayout(el.dataset.layout) }); renderApp(); break;
    case 'toggle-doc-selection': {
      const id = el.dataset.documentId;
      const current = state.librarySelectedDocIds || [];
      setState({ librarySelectedDocIds: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
      renderApp();
      break;
    }
    case 'select-visible-docs': {
      const visible = visibleLibraryDocuments().map((doc) => doc.id);
      const allSelected = visible.length > 0 && visible.every((id) => (state.librarySelectedDocIds || []).includes(id));
      setState({ librarySelectedDocIds: allSelected ? [] : visible });
      renderApp();
      break;
    }
    case 'clear-doc-selection': setState({ librarySelectedDocIds: [] }); renderApp(); break;
    case 'toggle-library-view': {
      setState({ libraryMenuOpen: false });
      setState({ libraryView: state.libraryView === 'archive' ? 'active' : 'archive', librarySelectedDocIds: [], ...resetSemanticSearchPatch() });
      await loadDocuments();
      renderApp();
      break;
    }
    // ---- editor ----
    // Leaving a document opened from the review queue returns to the queue.
    case 'back-to-library': {
      const origin = state.editorReturnView;
      if (origin?.kind === 'inbox') {
        if (await goProject(origin.projectId, origin.tab)) setState({ editorReturnView: null, reviewWalk: null });
      } else await goLibrary({}, { restore: true });
      break;
    }
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
    case 'toggle-md-check':
      // A link inside the item's text follows the link; it is not a toggle.
      if (!event?.target?.closest?.('a[href]')) toggleMarkdownCheck(Number(el.dataset.line));
      break;
    case 'toggle-doc-menu': setState({ docMenuOpen: !state.docMenuOpen }); renderApp(); break;
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
      // One create at a time: a repeated Enter or a double click while the
      // first POST is in flight would otherwise create two projects.
      if (projectCreatePending) break;
      projectCreatePending = true;
      try {
        let project;
        try { project = await createProject(name); } catch { alertError('create that project'); renderApp(); break; }
        // The project exists; a failed refresh or navigation is not a failed
        // create (a retry would make a second one).
        try {
          await loadProjects();
          await goProject(project.id);
          showToast(`Project "${name}" created`);
        } catch {
          showToast(`Project "${name}" created, but the project list could not refresh. Reload to see it.`, null, 7000);
        }
      } finally {
        projectCreatePending = false;
      }
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
    case 'palette-task-today': {
      setState({ paletteOpen: false });
      await triageTasks([el.dataset.taskId], 'today', 'today');
      break;
    }
    case 'close-palette': setState({ paletteOpen: false }); renderApp(); break;
    case 'confirm-cancel': setState({ confirm: null }); renderApp(); break;
    case 'open-shortcuts': openShortcuts(); break;
    case 'close-shortcuts': {
      // The scrim carries the action too; a click inside the dialog stays.
      if (el.dataset.overlay === 'shortcuts' && event.target !== el) break;
      setState({ shortcutsOpen: false }); renderApp(); break;
    }
    case 'toast-undo': state.toast?.undo?.(); break;

    case 'open-library-doc': await openDocumentInEditor(el.dataset.libraryDocumentId); break;

    default: break;
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindEvents() {
  appRoot.addEventListener('click', (event) => {
    if (event.target.closest?.(`a[href="${INBOX_LINK}"]`)) {
      event.preventDefault(); void goProject(inboxProjectId(), 'inbox'); return;
    }
    // A web link never replaces the workspace: a new tab in the browser (a
    // modified click keeps the browser's own behavior), the system browser
    // on the desktop, whose window only admits the sidecar origin.
    const anchor = event.target.closest?.('a[href]');
    const externalUrl = anchor && appRoot.contains(anchor) ? externalLinkUrl(anchor, window.location.href) : null;
    if (externalUrl && (state.desktopShell || !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button))) {
      event.preventDefault();
      openExternalUrl(externalUrl, { desktopShell: state.desktopShell })
        .then((opened) => { if (!opened) showToast('Prax could not open this link.'); })
        .catch(() => showToast('Prax could not open this link in your browser.'));
      return;
    }
    if ((state.docMenuOpen || state.newDocMenuOpen || state.libraryMenuOpen || state.newMenuOpen || state.captureMenuOpen || state.writeMenuOpen) && !event.target.closest?.('.menu')) {
      setState({ docMenuOpen: false, newDocMenuOpen: false, libraryMenuOpen: false, newMenuOpen: false, captureMenuOpen: false, writeMenuOpen: false, writeSelection: null });
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
      // An action link (a wiki link's href="#") runs its action, not a navigation.
      if (el.tagName === 'A') event.preventDefault();
      // A confirm dialog's OK runs once: it stays on screen until its action
      // renders, and a second Enter or click there would repeat the action (a
      // second project). Disabled, it ignores both; re-enabled if it survives.
      if (el.matches('[data-confirm-ok]')) {
        if (el.disabled) return;
        el.disabled = true;
        Promise.resolve(handleAction(el.dataset.action, el, event))
          .finally(() => { if (el.isConnected) el.disabled = false; });
        return;
      }
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
  // Esc clears renamingProjectId first, so the commit below no-ops). A render
  // removing the focused input is not the person leaving it: the draft carries
  // into the rebuilt field (render continuity) and stays uncommitted.
  appRoot.addEventListener('focusout', (event) => {
    const t = event.target;
    if (renderingApp || !t?.isConnected) return;
    if (t.matches?.('[data-project-rename]')) saveRenameProject(t.dataset.projectId, t.value);
  });

  appRoot.addEventListener('input', (event) => {
    const target = event.target;
    if (target.matches?.('[data-inbox-field]')) { inboxController.change(target.dataset.inboxField, target.value); return; }
    if (target.matches?.('[data-template-field="title"]')) { templateStudio.updateTemplateStudio('title', target.value); return; }
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
    if (capture.input(target)) return;
    if (target.matches?.('[data-assistant-input]')) {
      assistant.mirrorInput(target.value);
      return;
    }
    if (knowledge.input(target)) return;
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
        ...(state.nlFilterLoading ? capture.nlFilterResetPatch() : { nlFilterSource: null, nlFilterWarnings: [], nlFilterError: null }),
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
    if (documentInfo.mirrorInput(target)) return;
    if (settings.input(target)) return;
    if (target.matches?.('[data-link-picker-search]')) {
      setState({ linkPickerQuery: target.value });
      renderApp();
    }
  });

  appRoot.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches?.('[data-inbox-field]')) { inboxController.change(target.dataset.inboxField, target.value); return; }
    if (target.matches?.('[data-template-field]')) { templateStudio.updateTemplateStudio(target.dataset.templateField, target.value); return; }
    if (documentInfo.mirrorInput(target)) return;
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
    if (settings.change(target)) return;
    transfer.change(target);
  });

  bindDragEvents();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasNarrow = state.winW < 940;
      const wasDocked = inspectorDocked(state);
      setState({ winW: window.innerWidth });
      if ((window.innerWidth < 940) !== wasNarrow || inspectorDocked(state) !== wasDocked) renderApp();
    }, 150);
  });
}

async function handleLinkPickerPick(documentId) {
  if (state.pickerMode === 'supersede') {
    const predecessorId = state.editorDocId;
    await performDocumentLifecycleOnce(`document:${predecessorId}`, () => (
      lifecycle.supersedeKnowledgeDocument(predecessorId, documentId)
    ));
    return;
  }
  await drawer.toggleDocumentLink(documentId);
}

// ---------------------------------------------------------------------------
// Keyboard: one dispatcher (keyboardDispatcher.js documents the priority order)
// ---------------------------------------------------------------------------

// Keys of focused workspace fields (and ⌘F in the editor). A matched field
// ends the workspace layers; the global shortcuts still see the key, and they
// ignore typing targets except for Escape and ⌘ commands.
function workspaceKeydown(event) {
  const target = event.target;
  // ⌘F / Ctrl+F opens the editor find panel from anywhere in the editor view
  // (document, panel inputs, preview) — never the browser's find-in-page.
  if (state.navType === 'editor' && (event.metaKey || event.ctrlKey)
    && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    openEditorSearch();
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-search-find]')) {
    if (event.key === 'Enter') { event.preventDefault(); runSearchCommand(event.shiftKey ? 'previous' : 'next'); }
    else if (event.key === 'Escape') { event.preventDefault(); closeEditorSearch(); }
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-search-replace]')) {
    if (event.key === 'Enter') { event.preventDefault(); runSearchCommand('replace'); }
    else if (event.key === 'Escape') { event.preventDefault(); closeEditorSearch(); }
    return KEY_HANDLED;
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
      void runPaletteItem(item, { done: event.metaKey || event.ctrlKey });
    } else if (event.key === 'Tab') {
      // ⇥ / ⇧⇥ walk the scope bar; the input keeps focus.
      event.preventDefault();
      setPaletteScope(cyclePaletteScope(state.paletteScope, event.shiftKey ? -1 : 1));
    }
    return KEY_HANDLED;
  }
  // A held-down Enter must not repeat a create (see the pending locks too).
  if (target.matches?.('[data-new-project-name]') && event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat && !event.isComposing) handleAction('create-project', target, event);
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-confirm-input]') && event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat && !event.isComposing) appRoot.querySelector('[data-confirm-ok]')?.click();
    return KEY_HANDLED;
  }
  if (capture.keydown(event)) return KEY_HANDLED;
  if (target.matches?.('[data-ask-prax-input]') && event.key === 'Enter') {
    event.preventDefault();
    knowledge.runAskPrax(target.value);
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-assistant-input]') && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void assistant.sendAssistant(target.value);
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-project-rename]')) {
    if (event.key === 'Enter') { event.preventDefault(); target.blur(); return KEY_HANDLED; } // blur commits
    if (event.key === 'Escape') { event.preventDefault(); setState({ renamingProjectId: null }); renderApp(); return KEY_HANDLED; }
    return KEY_HANDLED;
  }
  // A preview checkbox (role=checkbox) toggles with Space, like a native one,
  // and with Enter; neither reaches the global shortcuts.
  if (target.matches?.('[data-action="toggle-md-check"]') && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    if (event.repeat) return KEY_CONSUMED;
    const line = Number(target.dataset.line);
    toggleMarkdownCheck(line);
    appRoot.querySelector(`[data-action="toggle-md-check"][data-line="${line}"]`)?.focus();
    return KEY_CONSUMED;
  }
  if (target.matches?.('[data-checklist-new]') && event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat && !event.isComposing) handleAction('add-checklist-item', target, event);
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-task-label-input]') && event.key === 'Enter') {
    event.preventDefault();
    void drawer.addTaskLabel(target.value);
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-library-search]') && event.key === 'Enter' && state.librarySemantic) {
    event.preventDefault();
    runSemanticSearch();
    return KEY_HANDLED;
  }
  if (target.matches?.('[data-document-editor]') && (event.metaKey || event.ctrlKey)) {
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); requestDocumentDraftSave(); }
    else if (key === 'b') { event.preventDefault(); applyEditorFormat('bold'); }
    else if (key === 'i') { event.preventDefault(); applyEditorFormat('italic'); }
    else if (key === 'e') { event.preventDefault(); applyEditorFormat('code'); }
    return KEY_HANDLED;
  }
  return null;
}

function installKeyboard() {
  function openPaletteShortcut() {
    if (state.captureSubmitting) return;
    if (state.captureOpen) capture.discardCapture();
    setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0, paletteScope: 'all' });
    renderApp();
  }
  const globalShortcuts = createGlobalShortcuts({
    handlers: {
      async switchView(view) {
        if (view === 'library') { await goLibrary(); return; }
        const projectId = state.navType === 'project' ? state.navId : (state.projects[0]?.id || null);
        if (projectId) await goProject(projectId, view);
      },
      openPalette: openPaletteShortcut,
      // '/' is the key cap drawn in the Library's search bar: there it focuses
      // the bar; anywhere else it is the palette, as before.
      search() {
        if (state.navType === 'library' && !state.paletteOpen && !state.captureOpen && !state.drawerTaskId) {
          const input = appRoot.querySelector('[data-library-search]');
          if (input) { input.focus(); input.select?.(); return; }
        }
        openPaletteShortcut();
      },
      openAssistant: assistant.openAssistant,
      toggleTheme: settings.toggleTheme,
      openShortcuts,
      openCapture() {
        // A pending confirm owns the keyboard; capture would stack above it.
        if (state.confirm) return;
        capture.openFreshCapture();
      },
      toggleDoneSelected() {
        const drawerBlocks = state.drawerTaskId && !inspectorDocked(state);
        if (state.selectedTaskId && !state.paletteOpen && !state.captureOpen && !drawerBlocks) {
          toggleTaskDone(state.selectedTaskId);
        }
      },
      navigate(direction) {
        const listContext = (state.navType === 'project' && (state.tab === 'list' || state.tab === 'board'))
          || state.navType === 'today' || state.navType === 'filter';
        const docked = Boolean(state.drawerTaskId) && inspectorDocked(state);
        if (!listContext || state.paletteOpen || state.captureOpen || (state.drawerTaskId && !docked)) return;
        if (!flatIds.length) return;
        const current = flatIds.indexOf(state.selectedTaskId);
        const next = direction > 0
          ? Math.min(flatIds.length - 1, current + 1)
          : Math.max(0, current < 0 ? 0 : current - 1);
        // The docked inspector follows the selection (openTaskDrawer flushes
        // the current draft first and refuses to switch if that fails).
        if (docked && flatIds[next] !== state.drawerTaskId) { openTaskDrawer(flatIds[next]); return; }
        setState({ selectedTaskId: flatIds[next] });
        renderApp();
      },
      openSelected() {
        const drawerBlocks = state.drawerTaskId && !inspectorDocked(state);
        if (state.selectedTaskId && !state.paletteOpen && !state.captureOpen && !drawerBlocks) {
          openTaskDrawer(state.selectedTaskId);
        }
      },
      escape: escapeCascade,
      modalOpen: () => Boolean(topmostModal(appRoot)),
    },
  });
  createKeyboardDispatcher({
    getRoot: () => appRoot,
    layers: [
      { name: 'plan-walk', handle: event => (planMode.keydown(event) ? KEY_CONSUMED : null) },
      { name: 'inbox-dialog', scope: 'app', handle: event => (inboxController.keydown(event) ? KEY_CONSUMED : null) },
      { name: 'modal-tab-trap', handle: event => (trapModalTab(event, appRoot) ? KEY_HANDLED : null) },
      { name: 'template-studio', scope: 'app', handle: event => templateStudio.keydown(event) },
      { name: 'workspace-fields', scope: 'app', handle: workspaceKeydown },
      { name: 'global-shortcuts', global: true, handle: globalShortcuts },
    ],
  }).install(document);
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
  setState({ preferences, librarySavedViews: loadSavedViews(), taskSmartViews: loadSmartViews(), pinned: loadPinned(), recentProjects: loadRecent(), recentDocuments: loadRecentDocuments(), libraryLayout: loadLayout(), collapsedSections: loadCollapsed(), winW: window.innerWidth, desktopShell, desktopPlatform });
  applyPreferences(preferences);
  appRoot.innerHTML = renderBootLoadingHtml();
  try {
    await loadProjects();
    const persisted = loadActiveProject();
    const valid = persisted !== 'all' && state.projects.some(p => p.id === persisted);
    // The restored project counts as visited, so Recent is right from launch.
    if (valid) {
      setState({ navType: 'project', navId: persisted, recentProjects: saveRecent(pushRecent(state.recentProjects, persisted)) });
    } else if (state.projects[0]) {
      setState({ navType: 'project', navId: state.projects[0].id, recentProjects: saveRecent(pushRecent(state.recentProjects, state.projects[0].id)) });
    } else {
      setState({ navType: 'all', navId: null });
    }
    setState({ apiStatus: 'loading' });
    bindEvents();
    installKeyboard();
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
    const initialTasks = await loadTasks({ announceReminders: false });
    if ((initialTasks === 'superseded' || initialTasks === 'stale') && externalRefresh.inFlight) {
      await externalRefresh.inFlight; // an early trigger's (or the retry's) newer snapshot installs instead
    }
    capture.restoreCaptureRecovery();
    templateStudio.announceRecovery();
    assistant.restoreRecovery();
    // A browser fallback reminder renders the workspace together with its
    // toast. Otherwise render once here. This avoids two consecutive full DOM
    // builds on every startup with due tasks.
    if (!checkDueReminders()) renderApp();
    inboxController.summary().then(() => { if (state.navType !== 'editor') renderApp(); });
    if (state.navId === inboxProjectId() && ['inbox', 'reviews'].includes(state.tab)) void inboxController.load(state.tab === 'reviews' ? 'reviews' : 'pending');
    documentsPromise.then((applied) => {
      if (applied && (state.navType === 'library' || state.navType === 'settings')) renderApp();
    });
    settings.loadSemanticStatus().then(() => {
      if (state.navType === 'library' || state.navType === 'settings') renderApp();
    });
    settings.loadChatStatus().then(() => {
      if (state.captureOpen) capture.renderCaptureOverlayLayer();
      else if (state.navType === 'library' || state.navType === 'settings') renderApp();
    });
    // Heartbeat so a task that ticks over to "due" while the app sits open still
    // gets a reminder (e.g. across midnight). Cheap: a filter over state.tasks.
    if (typeof setInterval === 'function') setInterval(() => { checkDueReminders(); planMode.checkShutdownNudge(); checkWeeklyReviewNudge(); }, 15 * 60 * 1000);
  } catch (err) {
    appRoot.innerHTML = renderBootErrorHtml(err?.message);
    setState({ apiStatus: 'error' });
  }
}

init();
