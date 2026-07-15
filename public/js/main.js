// Prax — application orchestrator.
// Render modules are pure state → HTML string functions; this file owns data
// loading, event delegation (single delegated click/input/change listeners
// reading data-action attributes), API translation via statusMap, and the
// post-render lifecycle (CodeMirror mount, drag indicator, autosave timers).

import { state, setState, loadActiveProject, persistActiveProject } from './state.js';
import {
  applyPreferences, loadPreferences, savePreferences, resetPreferences,
} from './preferences.js';
import {
  fetchTasks, fetchTask, createTask, updateTask, reorderTasks, archiveTask, restoreTask,
  deleteArchivedTask, exportTasks, importTasks, fetchTaskDocuments,
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
  fetchStaleDocuments, fetchOrphanDocuments, fetchDeploymentStatus, fetchSemanticStatus,
  setSemanticEnabled, putSemanticSettings, reindexEmbeddings, semanticSearch,
  fetchChatStatus, putChatSettings,
  verifyDocument, supersedeDocument,
  startRun, fetchRuns, fetchRun, setRunStep, setRunStatus, createPostMortem,
  askPrax, generateRunbook, fetchHealth, narrateBrief,
  assistantChat, fetchAssistantStatus,
  fetchLinkSuggestions, applyWikiLink, runAiReview, runWritingAction,
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
import { normalizeLabel } from './labels.js';
import { parseExternalRefLines } from './externalRefKind.js';
import { mountCodeMirrorEditor } from '../vendor/codemirror-editor.js';
import { mountPlainEditor } from './plainEditor.js';

import {
  renderTitlebarHtml, renderSidebarHtml, renderRailHtml, renderStatusbarHtml,
  projectColor,
} from './renderShell.js';
import {
  TASK_RENDER_BATCH_SIZE, renderListHtml, renderBulkBarHtml, buildListGroups, limitTaskGroups,
} from './renderList.js';
import { renderTodayHtml, buildTodayGroups } from './renderToday.js';
import { renderUpcomingHtml, buildUpcomingGroups } from './renderUpcoming.js';
import { renderCalendarHtml, buildCalendarModel, monthKeyOf, shiftMonthKey } from './renderCalendar.js';
import { renderFilterHtml, buildFilterGroups } from './renderFilter.js';
import { parseTaskFilter, projectResolver } from './taskFilter.js';
import { createSmartView, smartViewsFromJson } from './taskSmartViews.js';
import { renderBoardHtml, buildBoardColumns, limitBoardColumns } from './renderBoard.js';
import { renderBacklogHtml, renderArchiveHtml } from './renderBacklog.js';
import { renderTaskDrawerHtml } from './renderTaskDetail.js';
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
import { renderPaletteHtml, buildPaletteGroups } from './renderPalette.js';
import { renderCaptureHtml } from './renderCapture.js';
import { renderToastHtml } from './renderToast.js';
import { renderConfirmHtml } from './renderConfirm.js';
import { renderMarkdownImportHtml } from './renderMarkdownImport.js';
import { renderLibraryExportHtml } from './renderLibraryExport.js';
import { renderSettingsHtml } from './renderSettings.js';
import { escapeHtml } from './renderHelpers.js';
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
let projectOpsSaveTimer = null;   // debounce on-call / handoff-note edits
let boardExtrasRenderTimer = null; // enrichment must not preempt primary task interaction
let dragIndicator = null;
let documentsLoadToken = 0;       // only the newest Active/Archive collection may install
let semanticSearchToken = 0;      // stale/superseded meaning searches never install
let askPraxToken = 0;             // stale/closed grounded-answer requests never install
let drawerContextToken = 0;       // a late task-context load cannot replace a newer drawer
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
  setState({ confirm, docMenuOpen: false, newDocMenuOpen: false, captureMenuOpen: false });
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
  const all = await fetchProjects('all');
  const sidebar = all.filter(p => p.status === 'active' || p.status === 'on-hold');
  setState({ projects: sidebar, managedProjects: all });
}

async function loadTasks({ announceReminders = true } = {}) {
  const tasks = await fetchTasks({});
  setState({ tasks: tasks.map(normalizeTask), apiStatus: 'connected' });
  if (announceReminders) checkDueReminders();
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
  const [stale, orphans] = await Promise.allSettled([
    fetchStaleDocuments(project),
    fetchOrphanDocuments(project),
  ]);
  setState({
    staleDocs: stale.status === 'fulfilled' ? stale.value : [],
    orphanDocs: orphans.status === 'fulfilled' ? orphans.value : [],
  });
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
  if (res.status === 'awaiting_confirmation') {
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
  const refreshed = res.didWrite ? await refreshAfterAssistantWrite() : true;
  const notice = res.status === 'no_model' ? null : assistantOutcomeNotice(res, { refreshed });
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
  setState({ assistantPending: null, assistantLoading: true, assistantError: null, assistantErrorKind: null });
  renderApp();
  try {
    const res = await assistantChat(state.assistantMessages, decisions);
    await applyAssistantResult(res);
  } catch (err) {
    setState({ assistantLoading: false, assistantError: err?.message || 'The assistant request failed.', assistantErrorKind: 'error' });
  }
  renderApp();
}

function clearAssistant() {
  setState({ assistantMessages: [], assistantPending: null, assistantError: null, assistantErrorKind: null, assistantInput: '', assistantLoading: false });
  renderApp();
}

async function verifyHealthDoc(id) {
  if (!id) return;
  try {
    const reviewed = await fetchDocument(id);
    await verifyDocument(id, true, 'user', reviewed.contentHash);
    showToast('Verified');
    await loadHealth();
  } catch {
    showToast('Could not verify');
  }
  renderApp();
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
  return true;
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
    /* related-docs section stays hidden */
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
async function reconcileExternalRefs(documentId, refsText) {
  const desired = parseExternalRefLines(refsText);
  const desiredUrls = new Set(desired.map((r) => r.url));
  const seeded = Array.isArray(state.docInfoRefsSeed) ? state.docInfoRefsSeed : [];
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
      : (saved.recurrence
        ? `Completed — next occurrence scheduled${saved.lifecycleRefreshFailed ? '; reload to show it' : ''}.`
        : 'Completed — nice.');
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

async function bulkArchive() {
  const ids = [...state.multiSelectIds];
  if (!ids.length) return;
  setState({ multiSelectIds: [] });
  try {
    await Promise.all(ids.map(id => archiveTask(id)));
    await loadTasks();
    showToast(`${ids.length} task${ids.length > 1 ? 's' : ''} archived`, async () => {
      dismissToast();
      await Promise.all(ids.map(id => restoreTask(id)));
      await loadTasks();
      renderApp();
    });
  } catch {
    alertError('archive the selection');
    await loadTasks();
  }
  renderApp();
}

async function archiveTaskWithUndo(id) {
  const task = taskById(id);
  if (!task) return;
  if (state.drawerTaskId === id && !(await flushTaskDrawerDraft())) {
    showToast('Save this task draft before archiving it.');
    return;
  }
  setState({ drawerTaskId: null, taskNotesDraftId: null, taskLabelDraftId: null, taskLabelDraft: '' });
  try {
    await archiveTask(id);
    await loadTasks();
    if (state.tab === 'archive') await loadArchivedTasks();
    showToast('Task archived', async () => {
      dismissToast();
      await restoreTask(id);
      await loadTasks();
      if (state.tab === 'archive') await loadArchivedTasks();
      renderApp();
    });
  } catch {
    alertError('archive the selected task');
  }
  renderApp();
}

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
      && !['recovered', 'conflict'].includes(state.taskDraftRecoveryReason)) {
      setTaskDraftStatusInPlace('Autosaving...');
      saveTaskDrawerDraft({ status: null });
    }
  }, TASK_DRAFT_AUTOSAVE_DELAY_MS);
}

function handleTaskDrawerDraftChange(patch) {
  const task = taskById(state.drawerTaskId);
  if (!task) return;
  const draft = { ...taskDraftSnapshot(), ...patch };
  const dirty = taskDraftIsDirty(task, draft);
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
  const title = normalizeTaskDraftTitle(sentDraft.title);
  if (!title) {
    setState({ taskDraftRecoveryReason: 'failed' });
    setTaskDraftStatusInPlace('Title required');
    showToast('Task title is required before this draft can be saved.');
    return false;
  }
  if (status) setTaskDraftStatusInPlace(status);
  taskDraftSavePromise = (async () => {
    try {
      return await enqueueTaskMutation(taskId, async () => {
        try {
          const saved = await updateTask(taskId, {
            title,
            description: sentDraft.description,
            notes: sentDraft.notes,
          });
          return applyTaskDraftSave(saved, { taskId, sentDraft });
        } catch {
          // A response may be lost after commit. Read the canonical task once
          // while holding the task queue; never repeat the PATCH.
          try {
            const baseline = taskById(taskId);
            const observed = normalizeTask(await fetchTask(taskId));
            if (!taskDraftIsDirty(observed, sentDraft)) {
              return applyTaskDraftSave(observed, { taskId, sentDraft });
            }
            if (baseline && taskDraftIsDirty(observed, baseline)) {
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
    const baseline = taskById(taskId);
    const sentDraft = taskDraftSnapshot();
    setTaskDraftStatusInPlace('Checking saved copy...');
    try {
      const observed = normalizeTask(await fetchTask(taskId));
      if (!taskDraftIsDirty(observed, sentDraft)) {
        return applyTaskDraftSave(observed, { taskId, sentDraft });
      }
      if (baseline && taskDraftIsDirty(observed, baseline)) {
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
  let reviewedHash = null;
  if (verified) {
    const reviewed = (state.documents || []).find(document => document.id === id)
      || await fetchDocument(id);
    reviewedHash = reviewed.contentHash || null;
  }
  const result = await reconcileDocumentLifecycle({
    id,
    intent: { type: 'verify', verified },
    mutate: () => verifyDocument(id, verified, 'user', reviewedHash),
  });
  if (!result.committed) {
    reportUncommittedLifecycle(verified ? 'Verify this document' : 'Unverify this document', result.outcome, id);
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
  const doc = currentDocument();
  const draft = { title: String(title ?? ''), body: String(body ?? '') };
  const dirty = documentDraftIsDirty(doc, draft);
  const storage = documentDraftStorage();
  const stored = dirty
    ? storeDocumentDraftRecovery(storage, { document: doc, ...draft })
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
    title: state.documentDraftTitle,
    body: state.documentDraftBody,
  };
  if (stillActive && documentDraftIsDirty(
    { title: normalizeDocumentDraftTitle(sentDraft.title), body: sentDraft.body },
    liveDraft,
  )) {
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
  documentSavePromise = (async () => {
    try {
      const saved = await updateDocument(draftId, {
        title: normalizeDocumentDraftTitle(sentDraft.title),
        body: sentDraft.body,
      });
      return applyDocumentDraftSave(saved, { draftId, sentDraft });
    } catch {
      // A response can be lost after the database committed. Re-read once and
      // acknowledge the exact sent revision instead of inviting a duplicate.
      try {
        const observed = await fetchDocument(draftId);
        if (!documentDraftIsDirty(observed, sentDraft)) {
          return applyDocumentDraftSave(observed, { draftId, sentDraft });
        }
      } catch { /* the canonical outcome is still unknown/uncommitted */ }
      // Never window.alert from the autosave path — it would block the page on
      // every debounce tick. The footer status plus a toast is enough.
      if (state.editorDocId === draftId) {
        setState({ documentDraftRecoveryReason: 'failed' });
        setSaveStatusInPlace('Save failed');
        showToast(state.isDocumentDraftStored
          ? 'Save failed. Your draft is kept on this device — retry when ready.'
          : 'Save failed. Keep this tab open and retry.');
      }
      return false;
    } finally {
      documentSavePromise = null;
    }
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
  // Editor engine is user-selectable (Settings ▸ Appearance) so the plain
  // textarea spike can be A/B'd against CodeMirror in the real app.
  const mount = state.preferences.editorEngine === 'plain' ? mountPlainEditor : mountCodeMirrorEditor;
  try {
    documentEditorController = mount({
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
    // A CodeMirror failure must never break the app — the plain textarea
    // fallback keeps editing working.
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

function persistCaptureRecovery() {
  return storeTaskCaptureRecovery(taskCaptureStorage(), captureRecoveryDraft());
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
  clearTaskCaptureRecovery(taskCaptureStorage());
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
      clearTaskCaptureRecovery(taskCaptureStorage());
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
  setState({ navType: 'filter', editorFocus: false, activeFilterExpr: expr, activeSmartViewId: smartViewId, selectedTaskId: null, multiSelectIds: [], ...nlFilterResetPatch() });
  renderApp();
  return true;
}

function resetSemanticSearchPatch() {
  semanticSearchToken += 1;
  return {
    semanticResults: null,
    semanticPage: null,
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
    : { semanticResults: null, semanticPage: null, semanticError: false, semanticLoading: true, semanticLoadingMore: false, semanticMoreError: false });
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
    setState({ semanticResults: [], semanticPage: null, semanticError: true, semanticLoading: false, semanticLoadingMore: false, semanticMoreError: false });
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
  const request = state.adminImportRequest?.intent === intent
    ? state.adminImportRequest
    : { id: globalThis.crypto.randomUUID(), intent };
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
  return true;
}

async function goProject(projectId, tab = 'list') {
  if (!projectId) return navigateTopLevel({ navType: 'all' });
  if (!(await prepareEditorNavigation())) return false;
  setState({
    navType: 'project', navId: projectId, tab, editorFocus: false,
    selectedTaskId: null, multiSelectIds: [], drawerTaskId: null,
    taskLabelDraftId: null, taskLabelDraft: '',
  });
  persistActiveProject(projectId);
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
  loadMaintenance().then(renderApp);
  renderApp();
  return true;
}

function escapeCascade() {
  // The writing preview is a full-screen modal — it owns Esc over the (hidden,
  // behind-the-scrim) editor search panel.
  if (state.writeContext) { closeWrite(); return; }
  if (state.editorSearchOpen) { closeEditorSearch(); return; }
  if (state.assistantOpen) { setState({ assistantOpen: false }); renderApp(); return; }
  if (state.askPraxOpen) { closeAskPrax(); return; }
  if (state.genRbOpen) { setState({ genRbOpen: false }); renderApp(); return; }
  if (state.dailyBriefOpen) { setState({ dailyBriefOpen: false }); renderApp(); return; }
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

// Ops metadata inline in a project header: who's on call, handoff notes for
// the next shift, and the repo this project corresponds to (the prax CLI
// auto-detects the project from the local git remote via this URL). All are
// inline-editable; input events debounce a PATCH.
function renderProjectOps(project) {
  const id = escapeHtml(project.id);
  return `<div class="proj-ops">
    <label class="proj-ops__field"><span class="proj-ops__label">On call</span>
      <input class="proj-ops__input" type="text" data-project-oncall data-project-id="${id}" value="${escapeHtml(project.onCall || '')}" placeholder="—" aria-label="On-call owner"></label>
    <label class="proj-ops__field proj-ops__field--notes"><span class="proj-ops__label">Handoff</span>
      <input class="proj-ops__input" type="text" data-project-handoff data-project-id="${id}" value="${escapeHtml(project.handoffNotes || '')}" placeholder="notes for the next shift…" aria-label="Handoff notes"></label>
    <label class="proj-ops__field proj-ops__field--repo"><span class="proj-ops__label">Repo</span>
      <input class="proj-ops__input" type="text" data-project-repourl data-project-id="${id}" value="${escapeHtml(project.repoUrl || '')}" placeholder="git@github.com:org/repo.git" aria-label="Repository URL"></label>
  </div>`;
}

function sidebarCounts() {
  const projectOpen = {};
  for (const task of state.tasks) {
    if (!isOpen(task)) continue;
    projectOpen[task.projectId] = (projectOpen[task.projectId] || 0) + 1;
  }
  const now = new Date();
  const { badge } = buildTodayGroups(state.tasks, state.projects, { now });
  const { badge: upcomingBadge } = buildUpcomingGroups(state.tasks, state.projects, { now });
  return { todayBadge: badge, upcomingBadge, projectOpen };
}

function projectTasks() {
  return state.tasks.filter(t => t.projectId === state.navId);
}

function renderMainHtml() {
  const now = new Date();
  if (state.apiStatus === 'loading'
    && ['today', 'all', 'filter', 'upcoming', 'calendar', 'project'].includes(state.navType)) {
    return '<div class="page"><div class="empty" role="status" aria-live="polite">'
      + '<p class="empty__title">Loading tasks…</p>'
      + '<p class="empty__sub">Preparing your workspace.</p>'
      + '</div></div>';
  }
  switch (state.navType) {
    case 'today': {
      const { groups, snoozedCount } = buildTodayGroups(state.tasks, state.projects, { now });
      const collection = limitTaskGroups(groups, taskCollectionLimit('today'));
      flatIds = collection.flatIds;
      return renderTodayHtml(state, collection.groups, { now, snoozedCount, collection });
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
      return renderLibraryHtml(state, model);
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
    case 'upcoming': {
      const { groups } = buildUpcomingGroups(state.tasks, state.projects, { now });
      const collection = limitTaskGroups(groups, taskCollectionLimit('upcoming'));
      flatIds = collection.flatIds;
      return renderUpcomingHtml(state, collection.groups, { now, collection });
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
        const collection = limitTaskGroups(
          built.groups,
          taskCollectionLimit(`project|${state.navId}|list|${state.groupBy}`),
        );
        flatIds = collection.flatIds;
        body = renderListHtml(state, collection.groups, { collection }) + renderBulkBarHtml(state);
      }
      const canRename = project && project.slug !== INBOX_SLUG;
      const titleHtml = (canRename && state.renamingProjectId === project.id)
        ? `<input class="page-head__rename" type="text" data-project-rename data-project-id="${escapeHtml(project.id)}" value="${escapeHtml(project.name)}" aria-label="Rename project" autocomplete="off" spellcheck="false">`
        : `<h1 class="page-head__title">${escapeHtml(project?.name || 'Tasks')}</h1>`
          + (canRename ? `<button class="page-head__rename-btn" type="button" data-action="rename-project" data-project-id="${escapeHtml(project.id)}" title="Rename project" aria-label="Rename project">${icon('pencil', 13)}</button>` : '');
      return `<div class="page">
        <header class="page-head">
          <span class="page-head__dot" style="--dot:${project ? projectColor(project) : 'var(--accent)'}"></span>
          ${titleHtml}
          <span class="chip ${chipClass}">${escapeHtml((project?.status || 'active').replace('-', ' '))}</span>
          ${project && project.slug !== INBOX_SLUG ? renderProjectOps(project) : ''}
        </header>
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
  // dispatching its input event (notably when drawer context resolves). Capture
  // the live coherent draft before replacing the drawer so no keystroke is lost.
  const liveDrawer = appRoot.querySelector('.drawer[data-task-id]');
  if (liveDrawer?.dataset.taskId === state.drawerTaskId
    && state.taskNotesDraftId === state.drawerTaskId
    && !taskById(state.drawerTaskId)?.archivedAt) {
    const liveDraft = {
      title: liveDrawer.querySelector('[data-task-title]')?.value ?? state.taskTitleDraft,
      description: liveDrawer.querySelector('[data-task-description]')?.value ?? state.taskDescriptionDraft,
      notes: liveDrawer.querySelector('[data-task-notes]')?.value ?? state.taskNotesDraft,
    };
    const currentDraft = taskDraftSnapshot();
    if (liveDraft.title !== currentDraft.title
      || liveDraft.description !== currentDraft.description
      || liveDraft.notes !== currentDraft.notes) {
      handleTaskDrawerDraftChange(liveDraft);
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
    ? (narrow ? renderRailHtml(state) : renderSidebarHtml(state, counts))
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

async function runPaletteItem(item) {
  if (!item) return;
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
    case 'nav-upcoming': await navigateTopLevel({ navType: 'upcoming', selectedTaskId: null, multiSelectIds: [] }); break;
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
    case 'nav-settings': await goSettings(); break;
    case 'select-smart-view': {
      const view = (state.taskSmartViews || []).find(v => v.id === el.dataset.viewId);
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
          input: { value: '', placeholder: 'View name' },
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
    case 'set-settings-tab': setState({ settingsTab: el.dataset.tab }); renderApp(); break;
    case 'refresh-deployment-status': loadDeploymentStatus().then(renderApp); renderApp(); break;
    case 'nav-project': await goProject(el.dataset.projectId); break;
    case 'rename-project': startRenameProject(el.dataset.projectId); break;
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
      setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0 });
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
    case 'clear-selection': setState({ multiSelectIds: [], selectedTaskId: null }); renderApp(); break;

    // ---- drawer ----
    case 'close-drawer': await closeTaskDrawer(); break;
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
        if (saved.status === 'completed' && saved.recurrence) {
          showToast(saved.lifecycleRefreshFailed
            ? 'Completed — next occurrence scheduled; reload to show it.'
            : 'Completed — next occurrence scheduled.');
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
    case 'clear-lib-filters': setState({ libraryQuery: '', activeLibraryTags: [], libraryTypes: [], libraryTrust: [], libraryProjects: [], ...resetSemanticSearchPatch() }); renderApp(); break;
    case 'toggle-new-doc-menu': setState({ newDocMenuOpen: !state.newDocMenuOpen }); renderApp(); break;
    case 'new-document': createNewDocument(el.dataset.templateId); break;
    case 'import-documents': openMarkdownImport(); break;
    case 'close-markdown-import': closeMarkdownImport(); break;
    case 'submit-markdown-import': await submitMarkdownImport(); break;
    case 'export-library': openLibraryExport('all', action); break;
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
      setState({ isDocumentInfoEditorOpen: true, documentInfoError: '', docMenuOpen: false, docInfoRefsSeed: seed });
      renderApp();
      break;
    }
    case 'cancel-document-info': setState({ isDocumentInfoEditorOpen: false, documentInfoError: '' }); renderApp(); break;
    case 'save-document-info': {
      const title = appRoot.querySelector('[data-doc-info-title]')?.value?.trim();
      const documentType = appRoot.querySelector('[data-doc-info-type]')?.value;
      const project = appRoot.querySelector('[data-doc-info-project]')?.value;
      const tags = (appRoot.querySelector('[data-doc-info-tags]')?.value || '')
        .split(',').map(t => t.trim()).filter(Boolean);
      const sourceFilename = appRoot.querySelector('[data-doc-info-source]')?.value?.trim() || null;
      const refsText = appRoot.querySelector('[data-doc-info-refs]')?.value || '';
      if (!title) { setState({ documentInfoError: 'Title is required.' }); renderApp(); break; }
      const docId = state.editorDocId;
      try {
        await updateDocument(docId, { title, documentType, project, tags, sourceFilename });
        const refsFailed = await reconcileExternalRefs(docId, refsText);
        await loadDocuments();
        setState({ isDocumentInfoEditorOpen: false });
        await loadExternalRefs(docId);
        if (refsFailed) {
          showToast(`${refsFailed} external reference change${refsFailed === 1 ? '' : 's'} could not be saved.`);
        }
      } catch {
        setState({ documentInfoError: 'Prax could not save document info.' });
      }
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
      if (!el.dataset.confirmed) {
        openConfirm({
          message: 'Permanently delete this project? Only empty projects (no tasks or documents) can be deleted.',
          okLabel: 'Delete project', danger: true,
          action: 'delete-project', data: { 'project-id': el.dataset.projectId || '' },
        });
        break;
      }
      setState({ confirm: null });
      try {
        await deleteProjectPermanent(el.dataset.projectId);
        await loadProjects();
      } catch {
        showToast('Could not delete: the project still has tasks or documents.');
      }
      renderApp();
      break;
    }

    // ---- palette / capture / toast ----
    case 'palette-run': await runPaletteItem(paletteFlat[Number(el.dataset.paletteIndex)]); break;
    case 'close-palette': setState({ paletteOpen: false }); renderApp(); break;
    case 'close-capture': if (discardCapture()) renderCaptureOverlayLayer({ restoreFocus: true }); break;
    case 'submit-capture':
      if (state.captureSubmitting || state.nlCaptureLoading) break;
      if (state.nlCaptureFields) await confirmNlCapture();
      else await addQuickTask(state.captureQuery.trim());
      break;
    case 'confirm-cancel': setState({ confirm: null }); renderApp(); break;
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
    case 'set-editor-engine': {
      const preferences = savePreferences({ ...state.preferences, editorEngine: el.dataset.engine });
      setState({ preferences });
      destroyEditorController(); // remount the open editor with the chosen engine
      renderApp();
      break;
    }
    case 'set-editor-font': {
      const preferences = savePreferences({ ...state.preferences, editorFont: el.dataset.font });
      setState({ preferences });
      applyPreferences(preferences); // flips <body data-editor-font> → --pe-font
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
    case 'open-health': await goHealth(); break;
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
    if ((state.docMenuOpen || state.newDocMenuOpen || state.captureMenuOpen || state.writeMenuOpen) && !event.target.closest?.('.menu')) {
      setState({ docMenuOpen: false, newDocMenuOpen: false, captureMenuOpen: false, writeMenuOpen: false, writeSelection: null });
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
      setState({ captureQuery: target.value, ...clearCaptureRequestPatch() });
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
    if (target.matches?.('[data-project-oncall]') || target.matches?.('[data-project-handoff]') || target.matches?.('[data-project-repourl]')) {
      // Debounced save; don't re-render (would steal focus from the input the
      // user is typing in). Local state updates silently so it persists.
      const id = target.dataset.projectId;
      const field = target.matches('[data-project-oncall]') ? 'onCall'
        : target.matches('[data-project-handoff]') ? 'handoffNotes'
        : 'repoUrl';
      const value = target.value;
      clearTimeout(projectOpsSaveTimer);
      projectOpsSaveTimer = setTimeout(async () => {
        try {
          const updated = await updateProject(id, { [field]: value });
          applyProjectPatchLocal(id, { [field]: updated ? updated[field] : (value.trim() || null) });
        } catch { /* next load reconciles */ }
      }, 600);
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
    if (target.matches?.('[data-link-picker-search]')) {
      setState({ linkPickerQuery: target.value });
      renderApp();
    }
  });

  appRoot.addEventListener('change', (event) => {
    const target = event.target;
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
      : (state.markdownImportOpen ? 'markdown-import' : null);
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
        await runPaletteItem(paletteFlat[Math.min(state.paletteSelection, Math.max(0, paletteFlat.length - 1))]);
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
  } catch {
    setState({
      captureSubmitting: false,
      captureError: 'Could not confirm creation. Your task is saved here; retry unchanged is safe.',
    });
    persistCaptureRecovery();
    renderApp();
    return;
  }
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
        setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0 });
        renderApp();
      },
      openAssistant,
      toggleTheme,
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
          || state.navType === 'today' || state.navType === 'filter' || state.navType === 'upcoming';
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
  setState({ preferences, librarySavedViews: loadSavedViews(), taskSmartViews: loadSmartViews(), winW: window.innerWidth, desktopShell, desktopPlatform });
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
    renderApp();

    // Tasks gate the primary workspace; the much larger document bodies do
    // not. Load the Library in parallel and let the task collection become
    // interactive as soon as its own request completes.
    const documentsPromise = loadDocuments().catch(() => false);
    await loadTasks({ announceReminders: false });
    restoreCaptureRecovery();
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
    if (typeof setInterval === 'function') setInterval(checkDueReminders, 15 * 60 * 1000);
  } catch (err) {
    appRoot.innerHTML = `<main class="empty" style="height:100vh"><h2 class="empty__title">Prax could not load</h2><p class="empty__sub">${escapeHtml(err?.message || 'Unknown error')}</p></main>`;
    setState({ apiStatus: 'error' });
  }
}

init();
