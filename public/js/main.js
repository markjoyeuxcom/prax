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
  fetchTasks, createTask, updateTask, reorderTasks, archiveTask, restoreTask,
  deleteArchivedTask, exportTasks, importTasks, fetchTaskDocuments,
  linkTaskDocument, unlinkTaskDocument, fetchTaskChecklist, addChecklistItem,
  setChecklistItem, deleteChecklistItem, fetchTaskActivity, fetchTaskBoardExtras,
} from './taskApi.js';
import {
  fetchProjects, createProject, updateProject, deleteProjectPermanent,
} from './projectApi.js';
import {
  fetchDocuments, createDocument, updateDocument, archiveDocument,
  restoreDocument, deleteDocumentPermanently, fetchDocumentLinks, fetchDocumentTaskBacklinks, fetchSimilarDocuments,
  fetchStaleDocuments, fetchOrphanDocuments, fetchSemanticStatus,
  setSemanticEnabled, putSemanticSettings, reindexEmbeddings, semanticSearch,
  verifyDocument, supersedeDocument,
  startRun, fetchRuns, fetchRun, setRunStep, setRunStatus,
  fetchContextPack,
  askPrax,
} from './libraryApi.js';
import { normalizeTask } from './taskModel.js';
import { apiStatus, designStatus, isOpen } from './statusMap.js';
import { moveTaskOnBoard } from './boardWorkflow.js';
import { pendingExtraIds, batchIds, clearTaskBoardExtra } from './boardExtras.js';
import { installKeyboardShortcuts } from './keyboardShortcuts.js';
import { applyMarkdownFormat } from './markdownEditor.js';
import { renderMarkdownHtml, titleFromMarkdown } from './markdownPreview.js';
import { updateDocumentLivePreview } from './documentLivePreview.js';
import {
  canPreserveEditorAfterDraftSave, documentDraftSavedPatch,
} from './documentDraftSave.js';
import { triggerLibraryDocumentDownload } from './libraryExport.js';
import { tasksFromImportPayload, exportFilename, normalizeImportMode } from './importExport.js';
import { createSavedLibraryView, savedLibraryViewsFromJson } from './librarySavedViews.js';
import { parseCaptureShorthand } from './captureShorthand.js';
import { computeDueReminders, isOverdue } from './dueReminders.js';
import { normalizeLabel } from './labels.js';
import { mountCodeMirrorEditor } from '../vendor/codemirror-editor.js';
import { mountPlainEditor } from './plainEditor.js';

import {
  renderTitlebarHtml, renderSidebarHtml, renderRailHtml, renderStatusbarHtml,
  projectColor,
} from './renderShell.js';
import { renderListHtml, renderBulkBarHtml, buildListGroups } from './renderList.js';
import { renderTodayHtml, buildTodayGroups } from './renderToday.js';
import { renderUpcomingHtml, buildUpcomingGroups } from './renderUpcoming.js';
import { renderFilterHtml, buildFilterGroups } from './renderFilter.js';
import { parseTaskFilter, projectResolver } from './taskFilter.js';
import { createSmartView, smartViewsFromJson } from './taskSmartViews.js';
import { renderBoardHtml, buildBoardColumns } from './renderBoard.js';
import { renderBacklogHtml, renderArchiveHtml } from './renderBacklog.js';
import { renderTaskDrawerHtml } from './renderTaskDetail.js';
import { renderLinkPickerHtml } from './renderLinkPicker.js';
import { renderLibraryHtml, buildLibraryModel } from './renderLibrary.js';
import { templateById } from './documentTemplates.js';
import { renderEditorHtml, buildOutline, buildBacklinks } from './renderEditor.js';
import { renderRunHtml, buildChronicle } from './renderRun.js';
import { renderBriefHtml } from './renderBrief.js';
import { renderAskPraxHtml } from './renderAskPrax.js';
import { renderSearchPanelHtml, searchCountLabel } from './renderSearchPanel.js';
import { renderAllProjectsHtml, buildProjectGroups } from './renderAllProjects.js';
import { renderPaletteHtml, buildPaletteGroups } from './renderPalette.js';
import { renderCaptureHtml } from './renderCapture.js';
import { renderToastHtml } from './renderToast.js';
import { renderConfirmHtml } from './renderConfirm.js';
import { renderSettingsHtml } from './renderSettings.js';
import { escapeHtml } from './renderHelpers.js';

const SAVED_LIBRARY_VIEWS_KEY = 'moomora.librarySavedViews.v1';
const SMART_VIEWS_KEY = 'moomora.taskSmartViews.v1';
const DOCUMENT_AUTOSAVE_DELAY_MS = 1200;
const NOTES_AUTOSAVE_DELAY_MS = 1200;
const TITLE_SAVE_DELAY_MS = 600;

// ---- module runtime (not state: timers, controllers, transient DOM) --------
let appRoot = null;
let flatIds = [];                 // keyboard-navigation order of the visible list
let paletteFlat = [];             // flattened palette items for Enter/arrows
let documentEditorController = null;
let documentAutosaveTimer = null;
let notesAutosaveTimer = null;
let descriptionSaveTimer = null;
let titleSaveTimer = null;        // editor document title
let taskTitleSaveTimer = null;    // drawer task title
let toastTimer = null;
let isReindexing = false;         // guards the reindex/rebuild handler from double-runs
let prevViewKey = null;           // suppress the main-content fade on same-view re-renders
let projectOpsSaveTimer = null;   // debounce on-call / handoff-note edits
let dragIndicator = null;

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

async function loadTasks() {
  const tasks = await fetchTasks({});
  setState({ tasks: tasks.map(normalizeTask), apiStatus: 'connected' });
  checkDueReminders();
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
  if (!state.preferences?.reminders) return;
  const fresh = computeDueReminders(state.tasks, { now: new Date() }).filter((t) => !notifiedDueIds.has(t.id));
  if (!fresh.length) return;
  fresh.forEach((t) => notifiedDueIds.add(t.id));

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    fresh.forEach(fireNativeReminder);
    return;
  }
  const overdue = fresh.filter((t) => isOverdue(t.dueDate)).length;
  const n = fresh.length;
  const word = overdue === n ? 'overdue' : 'due';
  showToast(`⏰ ${n} task${n > 1 ? 's' : ''} ${word}`, null, 6000);
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
  const documents = await fetchDocuments(state.libraryView === 'archive' ? { archived: true } : {});
  setState({ documents });
}

async function loadSemanticStatus() {
  try {
    setState({ semanticStatus: await fetchSemanticStatus() });
  } catch {
    setState({ semanticStatus: { available: false } });
  }
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

async function loadDrawerContext(taskId) {
  const guard = () => state.drawerTaskId === taskId;
  try {
    const documents = await fetchTaskDocuments(taskId);
    if (guard()) setState({ taskDocuments: documents });
    const checklist = await fetchTaskChecklist(taskId);
    if (guard()) setState({ taskChecklist: checklist });
    const activity = await fetchTaskActivity(taskId);
    if (guard()) setState({ taskActivity: activity });
  } catch {
    /* drawer sections degrade to empty */
  }
  if (guard()) renderApp();
}

async function loadDocumentTaskBacklinks(documentId) {
  try {
    const tasks = await fetchDocumentTaskBacklinks(documentId);
    if (state.editorDocId === documentId) {
      setState({ documentTaskBacklinks: tasks });
      renderApp();
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
      renderApp();
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
      renderApp();
    }
  } catch {
    /* links section stays unfetched */
  }
}

// Past runs of a runbook, shown in the editor sidebar. Notes have no runs.
async function loadDocumentRuns(doc) {
  if (!doc || doc.documentType !== 'runbook') { setState({ documentRuns: null }); return; }
  try {
    const runs = await fetchRuns(doc.id);
    if (state.editorDocId === doc.id) {
      setState({ documentRuns: runs });
      renderApp();
    }
  } catch {
    /* runs section stays hidden */
  }
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
    renderApp();
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

function showToast(message, undo = null, duration = undo ? 5000 : 2400) {
  clearTimeout(toastTimer);
  setState({ toast: { message, undo } });
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

// Snooze target for a preset: tomorrow / next week, at 9am local so the task
// reappears in the morning rather than at midnight. Returns an ISO timestamp.
function snoozeUntil(preset) {
  const d = new Date();
  d.setDate(d.getDate() + (preset === 'week' ? 7 : 1));
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

async function patchTask(id, apiPatch, { failure = 'update this task' } = {}) {
  if (!id) return null;
  try {
    const updated = await updateTask(id, apiPatch);
    const normalized = normalizeTask(updated);
    applyTaskPatchLocal(id, normalized);
    // Completing a recurring task spawns its next instance server-side; refetch
    // so the freshly scheduled task appears without a manual reload.
    if (normalized.recurrence && normalized.status === 'completed') {
      await loadTasks();
    }
    return normalized;
  } catch {
    alertError(failure);
    await loadTasks();
    return null;
  } finally {
    renderApp();
  }
}

// Add a normalized label to the open task (deduped). Shares the label
// convention with the server and the filter grammar via normalizeLabel.
function addTaskLabel(raw) {
  const label = normalizeLabel(raw);
  const task = taskById(state.drawerTaskId);
  if (!label || !task) return;
  const current = Array.isArray(task.labels) ? task.labels : [];
  if (current.includes(label)) return;
  patchTask(state.drawerTaskId, { labels: [...current, label] });
}

async function toggleTaskDone(id) {
  const task = taskById(id);
  if (!task || task.archivedAt) return;
  const prior = task.status;
  const done = designStatus(prior) === 'completed';
  const next = done ? apiStatus('planned') : apiStatus('completed');
  applyTaskPatchLocal(id, { status: next });
  renderApp();
  const saved = await patchTask(id, { status: next });
  if (saved) {
    showToast(done ? 'Reopened' : 'Completed — nice.', async () => {
      dismissToast();
      await patchTask(id, { status: prior });
    });
  }
}

async function bulkSetStatus(designKey, label) {
  const ids = [...state.multiSelectIds];
  if (!ids.length) return;
  const prior = ids.map(id => ({ id, status: taskById(id)?.status }));
  setState({ multiSelectIds: [] });
  try {
    await Promise.all(ids.map(id => updateTask(id, { status: apiStatus(designKey) })));
    await loadTasks();
    showToast(`${ids.length} task${ids.length > 1 ? 's' : ''} → ${label}`, async () => {
      dismissToast();
      await Promise.all(prior.filter(p => p.status).map(p => updateTask(p.id, { status: p.status })));
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
  setState({ drawerTaskId: null });
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

async function saveTaskNotes(taskId, notes) {
  try {
    const updated = await updateTask(taskId, { notes });
    applyTaskPatchLocal(taskId, normalizeTask(updated));
    setState({ isTaskNotesDirty: false, ...clearTaskBoardExtra(state, taskId) });
  } catch {
    alertError('save notes');
  }
}

function scheduleNotesAutosave(taskId) {
  clearTimeout(notesAutosaveTimer);
  notesAutosaveTimer = setTimeout(() => {
    if (state.taskNotesDraftId === taskId && state.isTaskNotesDirty) {
      saveTaskNotes(taskId, state.taskNotesDraft);
    }
  }, NOTES_AUTOSAVE_DELAY_MS);
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
  setState({
    editorDocId: doc.id,
    documentDraftId: doc.id,
    documentDraftBody: doc.body || '',
    isDocumentDirty: false,
    documentSaveStatus: 'Saved',
    documentLinks: null,
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
}

function handleDocumentDraftBodyChange(value) {
  const doc = currentDocument();
  const dirty = Boolean(doc) && value !== (doc.body || '');
  setState({ documentDraftBody: value, isDocumentDirty: dirty });
  setSaveStatusInPlace(dirty ? 'Unsaved changes' : 'Saved');
  const counts = appRoot?.querySelector('[data-editor-counts]');
  if (counts) {
    const words = value.split(/\s+/).filter(Boolean).length;
    counts.textContent = `${words} words · ${value.length} characters · ${Math.max(1, Math.round(words / 200))} min read`;
  }
  updateDocumentLivePreview(appRoot, value, { resolveWikiLink });
  scheduleDocumentAutosave();
}

function scheduleDocumentAutosave() {
  clearTimeout(documentAutosaveTimer);
  documentAutosaveTimer = setTimeout(() => {
    if (state.isDocumentDirty) {
      setSaveStatusInPlace('Autosaving...');
      saveDocumentDraft();
    }
  }, DOCUMENT_AUTOSAVE_DELAY_MS);
}

async function saveDocumentDraft() {
  const draftId = state.documentDraftId;
  if (!draftId || !state.isDocumentDirty) return;
  const sentBody = state.documentDraftBody;
  try {
    const saved = await updateDocument(draftId, { body: sentBody });
    const patch = documentDraftSavedPatch({ documents: state.documents, savedDocument: saved });
    if (state.documentDraftBody !== sentBody) {
      // The user kept typing while the PATCH was in flight — keep the newer
      // draft, stay dirty, and let the debounce save it next.
      patch.documentDraftBody = state.documentDraftBody;
      patch.isDocumentDirty = true;
      patch.documentSaveStatus = 'Unsaved changes';
      scheduleDocumentAutosave();
    }
    setState(patch);
    setSaveStatusInPlace(patch.documentSaveStatus);
    // The fallback textarea preserves the caret exactly like CodeMirror does —
    // either way, re-rendering mid-typing would destroy the edit surface and
    // leak keystrokes to the global shortcuts.
    const editSurface = Boolean(documentEditorController)
      || Boolean(appRoot.querySelector('[data-document-editor]:not([hidden])'));
    if (!canPreserveEditorAfterDraftSave({
      editorExists: editSurface,
      savedDocumentId: saved.id,
      selectedDocumentId: state.editorDocId,
      documentDraftId: state.documentDraftId,
    })) {
      renderApp();
    }
  } catch {
    // Never window.alert from the autosave path — it would block the page on
    // every debounce tick. The footer status plus a toast is enough.
    setSaveStatusInPlace('Save failed');
    showToast('Prax could not save this document — it will retry as you type.');
  }
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
      onSave: () => saveDocumentDraft(),
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
  } else if (fallback) {
    fallback.hidden = false;
  }
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
  clearTimeout(documentAutosaveTimer);
  destroyEditorController();
  let doc = state.documents.find(d => d.id === documentId);
  if (!doc) {
    setState({ libraryView: 'active' });
    await loadDocuments();
    doc = state.documents.find(d => d.id === documentId);
  }
  if (!doc) { alertError('open that document'); return; }
  seedEditorDraft(doc);
  setState({ navType: 'editor', editorFocus: false });
  renderApp();
  loadDocumentLinks(doc.id);
  loadDocumentTaskBacklinks(doc.id);
  loadSimilarDocuments(doc.id);
  loadDocumentRuns(doc);
}

// ---------------------------------------------------------------------------
// "Brief me" — human-facing library context pack
// ---------------------------------------------------------------------------

function openBrief() {
  // Keep the last query (handy to re-run) but clear any prior result.
  setState({ briefOpen: true, briefMarkdown: null, briefError: false, briefLoading: false, paletteOpen: false });
  renderApp();
}

async function runBrief(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return;
  setState({ briefQuery: query, briefLoading: true, briefError: false, briefMarkdown: null });
  renderApp();
  try {
    const markdown = await fetchContextPack(query, 'all');
    setState({ briefLoading: false, briefMarkdown: markdown });
  } catch {
    setState({ briefLoading: false, briefError: true });
  }
  renderApp();
}

async function copyBrief() {
  if (typeof state.briefMarkdown !== 'string') return;
  const ok = await copyToClipboard(state.briefMarkdown);
  showToast(ok ? 'Brief copied' : 'Could not copy brief');
}

function openAskPrax() {
  // Keep the last query (handy to re-run) but clear any prior answer.
  setState({ askPraxOpen: true, askPraxResult: null, askPraxError: false, askPraxLoading: false, paletteOpen: false });
  renderApp();
}

async function runAskPrax(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return;
  setState({ askPraxQuery: query, askPraxLoading: true, askPraxError: false, askPraxResult: null });
  renderApp();
  try {
    const result = await askPrax(query, 'all');
    setState({ askPraxLoading: false, askPraxResult: result });
  } catch {
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

// ---------------------------------------------------------------------------
// Runbook execution (runs)
// ---------------------------------------------------------------------------

// Snapshot the runbook's checkbox steps into a fresh run and open the run view.
// The run is a chronicle: checking a step stamps a time without touching the doc.
async function startRunForDocument(documentId) {
  const doc = state.documents.find((d) => d.id === documentId) || currentDocument();
  if (!doc) { alertError('start a run'); return; }
  try {
    const run = await startRun(doc.id, '');
    setState({ navType: 'run', activeRun: run, runReturnDocId: doc.id, docMenuOpen: false });
    renderApp();
    if (!run.steps || run.steps.length === 0) showToast('This runbook has no checkbox steps yet — add “- [ ] step” lines.');
  } catch { alertError('start a run'); }
}

async function openRun(runId, returnDocId) {
  try {
    const run = await fetchRun(runId);
    setState({ navType: 'run', activeRun: run, runReturnDocId: returnDocId || run.documentId });
    renderApp();
  } catch { alertError('open that run'); }
}

async function toggleRunStep(stepId, nowChecked) {
  const run = state.activeRun;
  if (!run || run.status !== 'running') return;
  try {
    const updated = await setRunStep(run.id, stepId, nowChecked);
    const steps = run.steps.map((s) => (s.id === stepId ? { ...s, checkedAt: updated.checkedAt, checkedBy: updated.checkedBy } : s));
    setState({ activeRun: { ...run, steps } });
    renderApp();
  } catch { alertError('update that step'); }
}

async function endRun(status) {
  const run = state.activeRun;
  if (!run) return;
  try {
    const updated = await setRunStatus(run.id, status);
    setState({ activeRun: { ...run, status: updated.status, finishedAt: updated.finishedAt }, confirm: null });
    showToast(status === 'completed' ? 'Run completed' : 'Run aborted');
    renderApp();
  } catch { alertError(status === 'completed' ? 'complete the run' : 'abort the run'); }
}

async function copyRunChronicle() {
  const run = state.activeRun;
  if (!run) return;
  const doc = (state.documents || []).find((d) => d.id === run.documentId);
  const ok = await copyToClipboard(buildChronicle(run, doc?.title || ''));
  showToast(ok ? 'Chronicle copied' : 'Could not copy chronicle');
}

function backFromRun() {
  const docId = state.runReturnDocId || state.activeRun?.documentId;
  setState({ activeRun: null });
  if (docId) openDocumentInEditor(docId);
  else goLibrary();
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
  setState({ newDocMenuOpen: false });
  const project = defaultProjectId();
  if (!project) { showToast('Create a project first.'); renderApp(); return; }
  const template = templateById(templateId);
  try {
    const doc = await createDocument({
      title: template.title, body: template.body, documentType: template.documentType, project, tags: [],
    });
    await loadDocuments();
    seedEditorDraft(state.documents.find(d => d.id === doc.id) || doc);
    setState({ navType: 'editor', editorMode: 'edit', editorFocus: false });
    renderApp();
    showToast('New document — rename it in the title bar');
  } catch {
    alertError('create a document');
  }
}

function importDocumentFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'text/markdown,.md,.markdown,.txt';
  input.multiple = true;
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    if (!files.length) return;
    const project = defaultProjectId();
    if (!project) { showToast('Create a project first.'); return; }
    let imported = 0;
    for (const file of files) {
      try {
        const body = await file.text();
        await createDocument({
          title: titleFromMarkdown(body, file.name),
          body,
          documentType: 'note',
          project,
          tags: ['imported'],
          sourceFilename: file.name || null,
        });
        imported += 1;
      } catch {
        /* keep importing the rest */
      }
    }
    await loadDocuments();
    renderApp();
    showToast(`Imported ${imported} document${imported === 1 ? '' : 's'}`);
  });
  input.click();
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
function goFilter({ expr = '', smartViewId = null } = {}) {
  setState({ navType: 'filter', activeFilterExpr: expr, activeSmartViewId: smartViewId, selectedTaskId: null, multiSelectIds: [] });
  renderApp();
}

async function runSemanticSearch() {
  const query = state.libraryQuery.trim();
  if (!query) { setState({ semanticResults: null, semanticError: false }); renderApp(); return; }
  try {
    const results = await semanticSearch(query, undefined);
    setState({ semanticResults: results, semanticError: false });
  } catch {
    // A thrown error means the request itself failed (e.g. the embedding
    // backend is unreachable — a 503) — distinct from a successful search with
    // no matches. Surface it so it doesn't look like an empty result set.
    setState({ semanticResults: [], semanticError: true });
    showToast('Semantic search failed — the embedding backend is unreachable. Check the provider in Settings ▸ Intelligence.');
  }
  renderApp();
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
  const modeInput = appRoot.querySelector('[name="import-mode"]:checked');
  let mode;
  try {
    mode = normalizeImportMode(modeInput?.value || 'skip');
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
  const fileInput = appRoot.querySelector('[data-import-file]');
  const file = fileInput?.files?.[0];
  if (!file) { showToast('Choose a JSON export file first.'); return; }
  const project = defaultProjectId();
  if (!project) { showToast('Create a project first.'); return; }
  try {
    const payload = JSON.parse(await file.text());
    const tasks = tasksFromImportPayload(payload);
    const result = await importTasks({ project, mode, tasks });
    showToast(`Imported ${result.imported} task(s). Skipped ${result.skipped ?? 0}.`);
    await loadTasks();
    renderApp();
  } catch (err) {
    showToast(`Prax could not import that file. ${err?.message || ''}`.trim());
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function resetLibraryFilters() {
  return {
    libraryQuery: '', librarySemantic: false, activeLibraryTags: [],
    semanticResults: null, libraryView: 'active',
  };
}

function goProject(projectId, tab = 'list') {
  if (!projectId) { setState({ navType: 'all' }); renderApp(); return; }
  setState({
    navType: 'project', navId: projectId, tab,
    selectedTaskId: null, multiSelectIds: [], drawerTaskId: null,
  });
  persistActiveProject(projectId);
  if (tab === 'archive') loadArchivedTasks().then(renderApp);
  renderApp();
}

function goLibrary(extra = {}) {
  destroyEditorController();
  setState({ navType: 'library', ...resetLibraryFilters(), ...extra });
  loadDocuments().then(renderApp);
  renderApp();
}

function goSettings() {
  setState({ navType: 'settings' });
  loadSemanticStatus().then(renderApp);
  loadMaintenance().then(renderApp);
  renderApp();
}

function escapeCascade() {
  if (state.editorSearchOpen) { closeEditorSearch(); return; }
  if (state.askPraxOpen) { setState({ askPraxOpen: false }); renderApp(); return; }
  if (state.briefOpen) { setState({ briefOpen: false }); renderApp(); return; }
  if (state.confirm) { setState({ confirm: null }); renderApp(); return; }
  if (state.docMenuOpen) { setState({ docMenuOpen: false }); renderApp(); return; }
  if (state.paletteOpen) { setState({ paletteOpen: false }); renderApp(); return; }
  if (state.captureOpen) { setState({ captureOpen: false }); renderApp(); return; }
  if (state.isLinkPickerOpen) { setState({ isLinkPickerOpen: false }); renderApp(); return; }
  if (state.isDocumentInfoEditorOpen) { setState({ isDocumentInfoEditorOpen: false }); renderApp(); return; }
  if (state.drawerTaskId) { setState({ drawerTaskId: null }); renderApp(); return; }
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

// Ops metadata inline in a project header: who's on call + handoff notes for
// the next shift. Both are inline-editable; input events debounce a PATCH.
function renderProjectOps(project) {
  const id = escapeHtml(project.id);
  return `<div class="proj-ops">
    <label class="proj-ops__field"><span class="proj-ops__label">On call</span>
      <input class="proj-ops__input" type="text" data-project-oncall data-project-id="${id}" value="${escapeHtml(project.onCall || '')}" placeholder="—" aria-label="On-call owner"></label>
    <label class="proj-ops__field proj-ops__field--notes"><span class="proj-ops__label">Handoff</span>
      <input class="proj-ops__input" type="text" data-project-handoff data-project-id="${id}" value="${escapeHtml(project.handoffNotes || '')}" placeholder="notes for the next shift…" aria-label="Handoff notes"></label>
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
  switch (state.navType) {
    case 'today': {
      const { groups, flatIds: ids, snoozedCount } = buildTodayGroups(state.tasks, state.projects, { now });
      flatIds = ids;
      return renderTodayHtml(state, groups, { now, snoozedCount });
    }
    case 'all': {
      const groups = buildProjectGroups(state.managedProjects, state.tasks);
      return renderAllProjectsHtml(state, groups, projectColor);
    }
    case 'library': {
      const model = buildLibraryModel(state, { now });
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
      const model = {
        outline: buildOutline(text),
        backlinks: buildBacklinks(backlinkTasks, coloredProjects, doc.id),
        previewHtml: renderMarkdownHtml(text, { resolveWikiLink }),
      };
      return renderEditorHtml(state, doc, model);
    }
    case 'run': {
      const run = state.activeRun;
      const doc = (state.documents || []).find((d) => d.id === (run?.documentId || state.runReturnDocId));
      return renderRunHtml(state, run, { docTitle: doc?.title || run?.title || 'Runbook', now });
    }
    case 'filter': {
      // Live typing → best-effort (partial) parse so the list never empties.
      const { predicate, error } = parseTaskFilter(state.activeFilterExpr || '', { partial: true });
      const built = buildFilterGroups(state.tasks, state.projects, predicate || (() => true), { now });
      flatIds = built.flatIds;
      return renderFilterHtml(state, { groups: built.groups, count: built.count, error });
    }
    case 'upcoming': {
      const { groups, flatIds: ids } = buildUpcomingGroups(state.tasks, state.projects, { now });
      flatIds = ids;
      return renderUpcomingHtml(state, groups, { now });
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
        flatIds = columns.flatMap(c => c.cards.map(card => card.id));
        body = renderBoardHtml(state, columns, projectsById());
      } else if (state.tab === 'backlog') {
        body = renderBacklogHtml(state, tasks.filter(t => designStatus(t.status) === 'backlog' && !t.archivedAt));
      } else if (state.tab === 'archive') {
        body = renderArchiveHtml(state, state.archivedTasks);
      } else {
        const built = buildListGroups(state, tasks, { now });
        flatIds = built.flatIds;
        body = renderListHtml(state, built.groups) + renderBulkBarHtml(state);
      }
      return `<div class="page">
        <header class="page-head">
          <span class="page-head__dot" style="--dot:${project ? projectColor(project) : 'var(--accent)'}"></span>
          <h1 class="page-head__title">${escapeHtml(project?.name || 'Tasks')}</h1>
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
  if (state.briefOpen) {
    html += renderBriefHtml(state, {
      bodyHtml: typeof state.briefMarkdown === 'string' ? renderMarkdownHtml(state.briefMarkdown, { resolveWikiLink }) : '',
    });
  }
  if (state.askPraxOpen) {
    const r = state.askPraxResult;
    // Render the written answer when there is one, else the retrieved pack.
    const md = r ? ((typeof r.answer === 'string' && r.answer.trim()) ? r.answer : (r.markdown || '')) : '';
    html += renderAskPraxHtml(state, { bodyHtml: md ? renderMarkdownHtml(md, { resolveWikiLink }) : '' });
  }
  if (state.confirm) html += renderConfirmHtml(state.confirm);
  html += renderToastHtml(state);
  return html;
}

function renderApp() {
  if (!appRoot) return;
  // Rebuilding innerHTML destroys any mounted CodeMirror DOM — drop the
  // controller so afterRender mounts a fresh instance instead of skipping on
  // a stale handle. (Saves that should keep the caret avoid renderApp
  // entirely via canPreserveEditorAfterDraftSave.)
  destroyEditorController();
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
    ${renderOverlaysHtml()}`;
  afterRender();
}

function afterRender() {
  mountEditorIfNeeded();
  if (state.paletteOpen) {
    const input = appRoot.querySelector('[data-palette-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  } else if (state.captureOpen) {
    appRoot.querySelector('[data-capture-input]')?.focus();
  } else if (state.briefOpen && !state.briefLoading) {
    const input = appRoot.querySelector('[data-brief-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  } else if (state.askPraxOpen && !state.askPraxLoading) {
    const input = appRoot.querySelector('[data-ask-prax-input]');
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
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
    ensureBoardExtras(projectTasks().filter(t => !t.archivedAt));
  }
}

// ---------------------------------------------------------------------------
// Palette commands
// ---------------------------------------------------------------------------

const paletteCommands = {
  'new-task': () => { setState({ paletteOpen: false, captureOpen: true, captureQuery: '', ...captureDefaults() }); renderApp(); },
  'new-document': () => { setState({ paletteOpen: false }); createNewDocument(); },
  'toggle-theme': () => { setState({ paletteOpen: false }); toggleTheme(); },
  'go-board': () => {
    setState({ paletteOpen: false });
    goProject(state.navType === 'project' ? state.navId : state.projects[0]?.id, 'board');
  },
  'go-library': () => { setState({ paletteOpen: false }); goLibrary(); },
  'go-all': () => { setState({ paletteOpen: false, navType: 'all' }); renderApp(); },
  'focus-writing': () => {
    setState({ paletteOpen: false });
    const target = state.editorDocId || state.documents[0]?.id;
    if (!target) { renderApp(); return; }
    openDocumentInEditor(target).then(() => {
      destroyEditorController();
      setState({ editorFocus: true, editorMode: 'edit' });
      renderApp();
    });
  },
  'go-settings': () => { setState({ paletteOpen: false }); goSettings(); },
};

function runPaletteItem(item) {
  if (!item) return;
  if (item.action === 'open-task') {
    const task = taskById(item.id);
    setState({ paletteOpen: false });
    if (task) {
      goProject(task.projectId, 'list');
      openTaskDrawer(task.id);
    }
    return;
  }
  if (item.action === 'open-doc') {
    setState({ paletteOpen: false });
    openDocumentInEditor(item.id);
    return;
  }
  const command = paletteCommands[item.action];
  if (command) command();
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
    return;
  }
  const task = taskById(taskId);
  setState({
    drawerTaskId: taskId,
    selectedTaskId: taskId,
    taskDocuments: [],
    taskChecklist: [],
    taskActivity: [],
    taskNotesDraftId: taskId,
    taskNotesDraft: task?.notes || '',
    isTaskNotesDirty: false,
  });
  renderApp();
  loadDrawerContext(taskId);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleAction(action, el, event) {
  switch (action) {
    // ---- navigation ----
    case 'nav-today': setState({ navType: 'today', selectedTaskId: null, multiSelectIds: [] }); renderApp(); break;
    case 'nav-all': setState({ navType: 'all' }); renderApp(); break;
    case 'manage-projects':
      setState({ navType: 'all' });
      openConfirm(newProjectDialog());
      break;
    case 'nav-library': goLibrary(); break;
    case 'nav-upcoming': setState({ navType: 'upcoming', selectedTaskId: null, multiSelectIds: [] }); renderApp(); break;
    case 'nav-filter': goFilter(); break;
    case 'nav-settings': goSettings(); break;
    case 'select-smart-view': {
      const view = (state.taskSmartViews || []).find(v => v.id === el.dataset.viewId);
      if (view) goFilter({ expr: view.expr, smartViewId: view.id });
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
    case 'set-settings-tab': setState({ settingsTab: el.dataset.tab }); renderApp(); break;
    case 'nav-project': goProject(el.dataset.projectId); break;
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
    case 'select-saved-view': {
      const view = state.librarySavedViews[Number(el.dataset.viewIndex)];
      if (view) goLibrary({ activeLibraryTags: [...view.tags] });
      break;
    }
    case 'open-palette': setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0, captureOpen: false }); renderApp(); break;
    case 'open-capture': setState({ captureOpen: true, captureQuery: '', paletteOpen: false, ...captureDefaults() }); renderApp(); break;
    case 'toggle-capture-menu': setState({ captureMenuOpen: !state.captureMenuOpen }); renderApp(); break;
    case 'set-capture-project': setState({ captureProjectId: el.dataset.projectId, captureMenuOpen: false }); renderApp(); break;
    case 'toggle-theme': toggleTheme(); break;

    // ---- tasks ----
    case 'open-task': openTaskDrawer(el.dataset.taskId, { multi: event.metaKey || event.shiftKey || event.ctrlKey }); break;
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
        setState({ drawerTaskId: null });
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
        setState({ drawerTaskId: null });
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
    case 'close-drawer': setState({ drawerTaskId: null }); renderApp(); break;
    case 'set-task-status': await patchTask(state.drawerTaskId, { status: el.dataset.status }); break;
    case 'set-task-priority': await patchTask(state.drawerTaskId, { priority: el.dataset.priority }); break;
    case 'set-task-recurrence': await patchTask(state.drawerTaskId, { recurrence: el.dataset.recurrence }); break;
    case 'remove-task-label': {
      const task = taskById(state.drawerTaskId);
      if (task) await patchTask(state.drawerTaskId, { labels: (task.labels || []).filter(l => l !== el.dataset.label) });
      break;
    }
    case 'clear-task-due': await patchTask(state.drawerTaskId, { dueDate: null }); break;
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
    case 'open-linked-doc': event.stopPropagation(); setState({ drawerTaskId: null }); openDocumentInEditor(el.dataset.documentId); break;
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
    case 'open-doc': openDocumentInEditor(el.dataset.documentId); break;
    case 'open-brief': openBrief(); break;
    case 'close-brief': setState({ briefOpen: false }); renderApp(); break;
    case 'run-brief': runBrief(appRoot.querySelector('[data-brief-input]')?.value); break;
    case 'copy-brief': copyBrief(); break;
    case 'open-ask-prax': openAskPrax(); break;
    case 'close-ask-prax': setState({ askPraxOpen: false }); renderApp(); break;
    case 'run-ask-prax': runAskPrax(appRoot.querySelector('[data-ask-prax-input]')?.value); break;
    case 'copy-ask-prax': copyAskPrax(); break;
    case 'toggle-semantic': setState({ librarySemantic: !state.librarySemantic, semanticResults: null }); renderApp(); break;
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
    case 'clear-lib-filters': setState({ libraryQuery: '', activeLibraryTags: [], libraryTypes: [], libraryTrust: [], semanticResults: null }); renderApp(); break;
    case 'toggle-new-doc-menu': setState({ newDocMenuOpen: !state.newDocMenuOpen }); renderApp(); break;
    case 'new-document': createNewDocument(el.dataset.templateId); break;
    case 'import-documents': importDocumentFiles(); break;
    case 'export-library': window.location.href = '/api/library/export?project=all'; break;
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
      setState({ libraryView: state.libraryView === 'archive' ? 'active' : 'archive', semanticResults: null });
      await loadDocuments();
      renderApp();
      break;
    }
    case 'restore-document': {
      try {
        await restoreDocument(el.dataset.documentId || state.editorDocId);
        await loadDocuments();
      } catch { alertError('restore the selected document'); }
      renderApp();
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
      try {
        await deleteDocumentPermanently(id);
        if (state.editorDocId === id) setState({ navType: 'library', editorDocId: null });
        await loadDocuments();
      } catch { alertError('delete the document'); }
      renderApp();
      break;
    }

    // ---- editor ----
    case 'back-to-library': goLibrary(); break;
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
    case 'toggle-md-check': toggleMarkdownCheck(Number(el.dataset.line)); break;
    case 'toggle-doc-menu': setState({ docMenuOpen: !state.docMenuOpen }); renderApp(); break;
    case 'edit-document-info': setState({ isDocumentInfoEditorOpen: true, documentInfoError: '', docMenuOpen: false }); renderApp(); break;
    case 'cancel-document-info': setState({ isDocumentInfoEditorOpen: false, documentInfoError: '' }); renderApp(); break;
    case 'save-document-info': {
      const title = appRoot.querySelector('[data-doc-info-title]')?.value?.trim();
      const documentType = appRoot.querySelector('[data-doc-info-type]')?.value;
      const tags = (appRoot.querySelector('[data-doc-info-tags]')?.value || '')
        .split(',').map(t => t.trim()).filter(Boolean);
      const sourceFilename = appRoot.querySelector('[data-doc-info-source]')?.value?.trim() || null;
      if (!title) { setState({ documentInfoError: 'Title is required.' }); renderApp(); break; }
      try {
        await updateDocument(state.editorDocId, { title, documentType, tags, sourceFilename });
        await loadDocuments();
        setState({ isDocumentInfoEditorOpen: false });
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
      try {
        await verifyDocument(doc.id, !doc.verified);
        await loadDocuments();
      } catch { alertError('update verification'); }
      renderApp();
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
      try {
        await archiveDocument(doc.id);
        goLibrary();
        showToast('Document archived', async () => {
          dismissToast();
          try {
            await restoreDocument(doc.id);
            await loadDocuments();
          } catch { alertError('restore the document'); }
          renderApp();
        });
      } catch { alertError('archive the selected document'); }
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
    case 'abort-run':
      if (el.dataset.confirmed === '1') { endRun('aborted'); break; }
      openConfirm({ message: 'Abort this run? The chronicle so far is kept, but the run is marked aborted.', action: 'abort-run', okLabel: 'Abort run', danger: true });
      break;
    case 'copy-chronicle': copyRunChronicle(); break;
    case 'back-from-run': backFromRun(); break;

    // ---- all projects ----
    case 'open-project': goProject(el.dataset.projectId); break;
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
        goProject(project.id);
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
    case 'palette-run': runPaletteItem(paletteFlat[Number(el.dataset.paletteIndex)]); break;
    case 'close-palette': setState({ paletteOpen: false }); renderApp(); break;
    case 'close-capture': setState({ captureOpen: false, captureMenuOpen: false }); renderApp(); break;
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
      try {
        const status = await putSemanticSettings({ backend: el.dataset.backend });
        setState({ semanticStatus: status, librarySemantic: false, semanticResults: null });
      } catch (err) {
        showToast(err?.message || 'Prax could not switch the provider.');
      }
      renderApp();
      break;
    }
    case 'save-ai-provider': {
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
      try {
        const status = await putSemanticSettings(patch);
        setState({ semanticStatus: status });
        showToast(status.connected
          ? `Connected to ${status.backend} — embeddings ready.`
          : `Saved, but ${status.backend || 'the backend'} is not reachable yet.`);
      } catch (err) {
        showToast(err?.message || 'Prax could not save the provider settings.');
      }
      renderApp();
      break;
    }
    case 'toggle-semantic-search': {
      try {
        const status = await setSemanticEnabled(!state.semanticStatus.enabled);
        setState({ semanticStatus: status, librarySemantic: false, semanticResults: null });
      } catch { alertError('update semantic search'); }
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
      window.location.href = `/api/library/export?project=${encodeURIComponent(slug)}`;
      break;
    }
    case 'export-library-all': window.location.href = '/api/library/export?project=all'; break;
    case 'refresh-maintenance': await loadMaintenance(); renderApp(); break;
    case 'open-library-doc': openDocumentInEditor(el.dataset.libraryDocumentId); break;

    default: break;
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindEvents() {
  appRoot.addEventListener('click', (event) => {
    if ((state.docMenuOpen || state.newDocMenuOpen || state.captureMenuOpen) && !event.target.closest?.('.menu')) {
      setState({ docMenuOpen: false, newDocMenuOpen: false, captureMenuOpen: false });
      renderApp();
      return;
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
      setState({ captureQuery: target.value });
      return;
    }
    if (target.matches?.('[data-library-search]')) {
      // Keyword search filters live, which re-renders and replaces this input —
      // restore focus and the caret so typing isn't interrupted after each key.
      const caret = target.selectionStart;
      setState({ libraryQuery: target.value });
      if (!state.librarySemantic) {
        renderApp();
        const next = appRoot.querySelector('[data-library-search]');
        if (next) {
          next.focus();
          if (caret != null) next.setSelectionRange(caret, caret);
        }
      }
      return;
    }
    if (target.matches?.('[data-filter-input]')) {
      // Live filter: re-render (updates the list + count) and restore the caret.
      // Editing the expression detaches it from any saved smart view.
      const caret = target.selectionStart;
      setState({ activeFilterExpr: target.value, activeSmartViewId: null });
      renderApp();
      const next = appRoot.querySelector('[data-filter-input]');
      if (next) {
        next.focus();
        if (caret != null) next.setSelectionRange(caret, caret);
      }
      return;
    }
    if (target.matches?.('[data-project-oncall]') || target.matches?.('[data-project-handoff]')) {
      // Debounced save; don't re-render (would steal focus from the input the
      // user is typing in). Local state updates silently so it persists.
      const id = target.dataset.projectId;
      const field = target.matches('[data-project-oncall]') ? 'onCall' : 'handoffNotes';
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
      setState({
        taskNotesDraftId: state.drawerTaskId,
        taskNotesDraft: target.value,
        isTaskNotesDirty: true,
      });
      scheduleNotesAutosave(state.drawerTaskId);
      return;
    }
    if (target.matches?.('[data-task-title]')) {
      // The drawer is the only task-title editor; debounce a PATCH.
      clearTimeout(taskTitleSaveTimer);
      const id = state.drawerTaskId;
      const value = target.value;
      taskTitleSaveTimer = setTimeout(async () => {
        const title = value.trim();
        if (!id || !title) return;
        try {
          const updated = await updateTask(id, { title });
          applyTaskPatchLocal(id, normalizeTask(updated));
        } catch { /* a later keystroke retries */ }
      }, TITLE_SAVE_DELAY_MS);
      return;
    }
    if (target.matches?.('[data-task-description]')) {
      clearTimeout(descriptionSaveTimer);
      const id = state.drawerTaskId;
      const value = target.value;
      descriptionSaveTimer = setTimeout(async () => {
        if (!id) return;
        try {
          const updated = await updateTask(id, { description: value });
          applyTaskPatchLocal(id, normalizeTask(updated));
        } catch { /* a later keystroke retries */ }
      }, NOTES_AUTOSAVE_DELAY_MS);
      return;
    }
    if (target.matches?.('[data-document-editor]')) {
      handleDocumentDraftBodyChange(target.value);
      return;
    }
    if (target.matches?.('[data-doc-title]')) {
      clearTimeout(titleSaveTimer);
      const value = target.value;
      titleSaveTimer = setTimeout(async () => {
        const id = state.editorDocId;
        if (!id) return;
        try {
          const saved = await updateDocument(id, { title: value.trim() || 'Untitled' });
          setState({ documents: state.documents.map(d => (d.id === id ? saved : d)) });
        } catch { /* keep typing; a later save retries */ }
      }, TITLE_SAVE_DELAY_MS);
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
      patchTask(state.drawerTaskId, { dueDate: target.value || null });
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
    if (target.matches?.('[name="import-mode"]')) {
      setState({ adminImportMode: target.value });
      renderApp();
    }
  });

  appRoot.addEventListener('keydown', (event) => {
    const target = event.target;
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
        runPaletteItem(paletteFlat[Math.min(state.paletteSelection, Math.max(0, paletteFlat.length - 1))]);
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
    if (target.matches?.('[data-capture-input]') && event.key === 'Enter') {
      event.preventDefault();
      addQuickTask(state.captureQuery.trim());
      return;
    }
    if (target.matches?.('[data-ask-prax-input]') && event.key === 'Enter') {
      event.preventDefault();
      runAskPrax(target.value);
      return;
    }
    if (target.matches?.('[data-brief-input]') && event.key === 'Enter') {
      event.preventDefault();
      runBrief(target.value);
      return;
    }
    if (target.matches?.('[data-checklist-new]') && event.key === 'Enter') {
      event.preventDefault();
      handleAction('add-checklist-item', target, event);
      return;
    }
    if (target.matches?.('[data-task-label-input]') && event.key === 'Enter') {
      event.preventDefault();
      addTaskLabel(target.value);
      target.value = '';
      return;
    }
    if (target.matches?.('[data-library-search]') && event.key === 'Enter' && state.librarySemantic) {
      event.preventDefault();
      runSemanticSearch();
      return;
    }
    if (target.matches?.('[data-document-editor]') && (event.metaKey || event.ctrlKey)) {
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); saveDocumentDraft(); }
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
    try {
      await supersedeDocument(state.editorDocId, documentId);
      setState({ isLinkPickerOpen: false });
      await loadDocuments();
      loadDocumentLinks(state.editorDocId);
    } catch { alertError('supersede the document'); }
    renderApp();
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

async function addQuickTask(rawTitle) {
  // Shorthand (!high, tomorrow, fri, 2026-09-01, #project, @label) is parsed out
  // of the typed text; an explicit token wins over the view-derived defaults.
  const { title, priority, dueDate, project: projectToken, labels } = parseCaptureShorthand(rawTitle);
  if (!title) return;
  let project = state.captureProjectId || defaultProjectId();
  if (projectToken) {
    const resolved = projectResolver(state.projects)(projectToken);
    if (resolved) project = resolved; // a valid #project overrides the default
  }
  if (!project) { showToast('Create a project first.'); return; }
  try {
    await createTask({
      title, description: '', notes: '', priority: priority || 'medium',
      status: state.captureStatus || 'planned', project,
      dueDate: dueDate || state.captureDueDate || null, labels: labels || [],
      sortOrder: state.tasks.length,
    });
    setState({ captureOpen: false, captureQuery: '', captureMenuOpen: false });
    await loadTasks();
    const name = state.projects.find(p => p.id === project)?.name || 'project';
    showToast(`Added to ${name}`);
  } catch {
    alertError('create this task');
  }
  renderApp();
}

function installShortcuts() {
  installKeyboardShortcuts({
    handlers: {
      switchView(view) {
        if (view === 'library') { goLibrary(); return; }
        const projectId = state.navType === 'project' ? state.navId : (state.projects[0]?.id || null);
        if (projectId) goProject(projectId, view);
      },
      openPalette() {
        setState({ paletteOpen: true, paletteQuery: '', paletteSelection: 0, captureOpen: false });
        renderApp();
      },
      toggleTheme,
      openCapture() {
        setState({ captureOpen: true, captureQuery: '', paletteOpen: false, ...captureDefaults() });
        renderApp();
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
    await loadTasks();
    await loadDocuments();
    loadSemanticStatus().then(renderApp);
    bindEvents();
    installShortcuts();
    // Heartbeat so a task that ticks over to "due" while the app sits open still
    // gets a reminder (e.g. across midnight). Cheap: a filter over state.tasks.
    if (typeof setInterval === 'function') setInterval(checkDueReminders, 15 * 60 * 1000);
    renderApp();
  } catch (err) {
    appRoot.innerHTML = `<main class="empty" style="height:100vh"><h2 class="empty__title">Prax could not load</h2><p class="empty__sub">${escapeHtml(err?.message || 'Unknown error')}</p></main>`;
    setState({ apiStatus: 'error' });
  }
}

init();
