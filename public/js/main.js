import { state, setState, loadActiveProject, persistActiveProject, loadBoardGrouping, persistBoardGrouping, loadListGrouping, persistListGrouping } from './state.js';
import { fetchProjects, createProject, updateProject, archiveProject, deleteProjectPermanent } from './projectApi.js';
import { renderProjectManagerHtml } from './renderProjectManager.js';
import { renderProjectArchiveHtml } from './renderProjectArchive.js';
import {
  addChecklistItem,
  archiveTask,
  createTask,
  deleteArchivedTask,
  deleteChecklistItem,
  exportTasks,
  fetchTaskActivity,
  fetchTaskBoardExtras,
  fetchTaskChecklist,
  fetchTaskDocuments,
  fetchTasks,
  importTasks,
  linkTaskDocument,
  reorderTasks,
  restoreTask,
  setChecklistItem,
  unlinkTaskDocument,
  updateTask,
} from './taskApi.js';
import {
  archiveDocument,
  createDocument,
  deleteArchivedDocument,
  fetchDocuments,
  restoreDocument,
  updateDocument,
} from './libraryApi.js';
import { moveTaskOnBoard } from './boardWorkflow.js';
import {
  exportFilename,
  normalizeImportMode,
  tasksFromImportPayload,
} from './importExport.js';
import { filterTasks } from './taskFilters.js';
import { buildMetrics, normalizeTask } from './taskModel.js';
import { isArchiveView, tasksForView } from './taskViews.js';
import { renderShellHtml } from './renderShell.js';
import { renderListHtml, renderSwimlaneListHtml, renderListToolbar } from './renderList.js';
import {
  renderBoardFilters,
  renderBoardHtml,
  renderBoardToolbar,
  renderSwimlaneBoardHtml,
} from './renderBoard.js';
import { applyBoardFilters } from './boardFilters.js';
import { renderTaskDetailHtml } from './renderTaskDetail.js';
import { renderTaskFormHtml } from './renderTaskForm.js';
import { renderAdminPanelHtml } from './renderAdminPanel.js';
import { renderSettingsPanelHtml } from './renderSettingsPanel.js';
import { renderDocumentFormHtml, renderLibraryHtml } from './renderLibrary.js';
import { renderLinkPickerHtml } from './renderLinkPicker.js';
import { titleFromMarkdown } from './markdownPreview.js';
import { applyMarkdownFormat } from './markdownEditor.js';
import { canPreserveEditorAfterDraftSave, documentDraftSavedPatch } from './documentDraftSave.js';
import { updateDocumentLivePreview } from './documentLivePreview.js';
import { mountCodeMirrorEditor } from '../vendor/codemirror-editor.js';
import { filterDocumentsByTags, filterDocumentsByType, sortDocuments, tagsForDocuments } from './libraryFilters.js';
import { applyPreferences, loadPreferences, resetPreferences, savePreferences } from './preferences.js';
import { isMobile } from './breakpoints.js';
import {
  areSameTags,
  createSavedLibraryView,
  renameSavedLibraryView,
  savedLibraryViewsFromJson,
} from './librarySavedViews.js';
import { installKeyboardShortcuts } from './keyboardShortcuts.js';
import { buildExportedMarkdown, documentFilename as libraryDocumentFilename, triggerDownload as libraryTriggerDownload } from './libraryExport.js';

const app = document.getElementById('app');
const SAVED_LIBRARY_VIEWS_KEY = 'moomora.librarySavedViews.v1';
const LIBRARY_BROWSER_WIDTH_KEY = 'moomora.libraryBrowserWidth.v1';
const LIBRARY_CONTROLS_KEY = 'moomora.libraryControls.v1';
const DOCUMENT_AUTOSAVE_DELAY_MS = 1200;
const BOARD_EXTRA_FETCH_BATCH_SIZE = 50;
let documentAutosaveTimer = null;
let isSavingDocumentDraft = false;
let boardExtraRequestSequence = 0;

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shortTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function taskNotesDraftFor(task) {
  if (!task) return '';
  return state.taskNotesDraftId === task.id ? state.taskNotesDraft : (task.notes || '');
}

function renderLoading() {
  app.innerHTML = '<main class="loading">Loading Moomora Console...</main>';
}

function renderError(message) {
  const error = document.createElement('main');
  error.className = 'loading';
  error.textContent = `Moomora Console could not load: ${message}`;
  app.replaceChildren(error);
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function selectedTask() {
  const visibleTasks = visibleTasksForCurrentView();
  if (!visibleTasks.length) return null;
  return visibleTasks.find((task) => task.id === state.selectedTaskId) || visibleTasks[0];
}

function editingTask() {
  if (!state.editingTaskId) return null;
  return state.tasks.find((task) => task.id === state.editingTaskId) || null;
}

function visibleDocumentsForCurrentView() {
  const query = state.searchQuery.trim().toLowerCase();
  const contextDocuments = state.activeProject === 'all'
    ? state.documents
    : state.documents.filter(document => document.projectId === state.activeProject);
  const taggedDocuments = filterDocumentsByTags(contextDocuments, state.activeLibraryTags);
  const typeFilteredDocuments = filterDocumentsByType(taggedDocuments, state.libraryTypeFilter);
  const searchedDocuments = query
    ? typeFilteredDocuments.filter((document) => [
        document.title,
        document.body,
        document.documentType,
        document.sourceFilename,
        ...(document.tags || []),
      ].some(value => String(value || '').toLowerCase().includes(query)))
    : typeFilteredDocuments;
  return sortDocuments(searchedDocuments, state.librarySortBy);
}

function selectedDocument() {
  const visibleDocuments = visibleDocumentsForCurrentView();
  if (!visibleDocuments.length) return null;
  return visibleDocuments.find(document => document.id === state.selectedDocumentId) || visibleDocuments[0];
}

function editingDocument() {
  if (!state.editingDocumentId) return null;
  return state.documents.find(document => document.id === state.editingDocumentId) || null;
}

function draftBodyForDocument(document) {
  if (!document) return '';
  return state.documentDraftId === document.id ? state.documentDraftBody : document.body || '';
}

function persistSavedLibraryViews() {
  try {
    window.localStorage?.setItem(SAVED_LIBRARY_VIEWS_KEY, JSON.stringify(state.librarySavedViews));
  } catch {
    // Local persistence is a convenience; the Library still works without it.
  }
}

function persistLibraryControls() {
  try {
    window.localStorage?.setItem(LIBRARY_CONTROLS_KEY, JSON.stringify({
      typeFilter: state.libraryTypeFilter,
      sortBy: state.librarySortBy,
      groupByType: state.libraryGroupByType,
    }));
  } catch {
    // Local persistence is a convenience; controls still work without it.
  }
}

function loadLibraryControls() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(LIBRARY_CONTROLS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return {};
    const patch = {};
    if (['all', 'runbook', 'note'].includes(parsed.typeFilter)) patch.libraryTypeFilter = parsed.typeFilter;
    if (['updated', 'created', 'title', 'type'].includes(parsed.sortBy)) patch.librarySortBy = parsed.sortBy;
    if (typeof parsed.groupByType === 'boolean') patch.libraryGroupByType = parsed.groupByType;
    return patch;
  } catch {
    return {};
  }
}

function activeSavedLibraryViewId() {
  const matchingView = state.librarySavedViews.find(view => areSameTags(view.tags, state.activeLibraryTags));
  return matchingView?.id || null;
}

function clearDocumentAutosave() {
  if (!documentAutosaveTimer) return;
  window.clearTimeout(documentAutosaveTimer);
  documentAutosaveTimer = null;
}

function updateDocumentSaveControls(workspace, status) {
  const statusNode = workspace.querySelector('[data-document-save-status]');
  const saveButton = workspace.querySelector('[data-action="save-document-draft"]');
  if (statusNode) statusNode.textContent = status;
  if (saveButton) saveButton.disabled = !state.isDocumentDirty || isSavingDocumentDraft;
}

function applyMarkdownToolbarAction(textarea, action) {
  const result = applyMarkdownFormat(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    action,
  );
  textarea.value = result.value;
  textarea.focus();
  textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function loadTaskDocuments(taskId) {
  if (!taskId) { setState({ taskDocuments: [] }); return; }
  const requestedTaskId = taskId;
  try {
    const docs = await fetchTaskDocuments(taskId);
    if (state.selectedTaskId === requestedTaskId) setState({ taskDocuments: docs });
  } catch {
    if (state.selectedTaskId === requestedTaskId) setState({ taskDocuments: [] });
  }
}

async function loadTaskChecklist(taskId) {
  if (!taskId) { setState({ taskChecklist: [] }); return; }
  const requestedTaskId = taskId;
  try {
    const items = await fetchTaskChecklist(taskId);
    if (state.selectedTaskId === requestedTaskId) setState({ taskChecklist: items });
  } catch {
    if (state.selectedTaskId === requestedTaskId) setState({ taskChecklist: [] });
  }
}

async function loadTaskActivity(taskId) {
  if (!taskId) { setState({ taskActivity: [] }); return; }
  const requestedTaskId = taskId;
  try {
    const events = await fetchTaskActivity(taskId);
    if (state.selectedTaskId === requestedTaskId) setState({ taskActivity: events });
  } catch {
    if (state.selectedTaskId === requestedTaskId) setState({ taskActivity: [] });
  }
}

function emptyBoardExtra() {
  return {
    docsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    nextChecklistItem: '',
    latestActivity: '',
  };
}

function normalizeBoardExtra(extra) {
  return {
    ...emptyBoardExtra(),
    ...(extra || {}),
  };
}

function nextBoardExtraRequestToken(taskId) {
  boardExtraRequestSequence += 1;
  return `${taskId}:${boardExtraRequestSequence}`;
}

async function fetchTaskBoardExtraEntries(taskIds, tokens) {
  const entries = [];
  for (let index = 0; index < taskIds.length; index += BOARD_EXTRA_FETCH_BATCH_SIZE) {
    const batch = taskIds.slice(index, index + BOARD_EXTRA_FETCH_BATCH_SIZE);
    try {
      const extras = await fetchTaskBoardExtras(batch);
      const extrasByTask = new Map(extras.map(extra => [extra.taskId, normalizeBoardExtra(extra)]));
      entries.push(...batch.map(id => [id, tokens[id], extrasByTask.get(id) || emptyBoardExtra()]));
    } catch {
      entries.push(...batch.map(id => [id, tokens[id], null]));
    }
  }
  return entries;
}

function clearTaskBoardExtra(taskId) {
  if (!taskId) return;
  const nextExtras = { ...state.taskBoardExtras };
  const nextLoading = { ...state.taskBoardExtrasLoading };
  delete nextExtras[taskId];
  delete nextLoading[taskId];
  setState({ taskBoardExtras: nextExtras, taskBoardExtrasLoading: nextLoading });
}

async function ensureBoardExtras(tasks) {
  if (state.activeView !== 'board') return;
  const ids = [...new Set((Array.isArray(tasks) ? tasks : []).map(task => task.id).filter(Boolean))];
  const needed = ids.filter(id => !state.taskBoardExtras?.[id] && !state.taskBoardExtrasLoading?.[id]);
  if (!needed.length) return;
  const tokens = Object.fromEntries(needed.map(id => [id, nextBoardExtraRequestToken(id)]));

  setState({
    taskBoardExtrasLoading: {
      ...state.taskBoardExtrasLoading,
      ...tokens,
    },
  });

  const entries = await fetchTaskBoardExtraEntries(needed, tokens);
  const loading = { ...state.taskBoardExtrasLoading };
  const extras = { ...state.taskBoardExtras };
  for (const [id, token, extra] of entries) {
    if (loading[id] !== token) continue;
    if (extra) extras[id] = extra;
    delete loading[id];
  }
  setState({
    taskBoardExtras: extras,
    taskBoardExtrasLoading: loading,
  });
  if (state.activeView === 'board') renderWorkspace();
}

function renderWorkspace() {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;

  if (state.activeView === 'library') {
    renderLibraryWorkspace(workspace);
    return;
  }

  const visibleTasks = visibleTasksForCurrentView();
  const task = selectedTask();
  const selectedTaskId = task?.id || null;
  const readOnly = isArchiveView(state.activeView);
  const isBoardView = state.activeView === 'board';
  // Only render the drawer for the task the user actually selected. selectedTask()
  // falls back to visibleTasks[0] when the selected id is no longer visible (search
  // filtered it out, or it was archived/deleted) — rendering that fallback would show
  // the WRONG task in an open drawer, so gate on an exact id match.
  const shouldRenderTaskDetail = state.taskDetailOpen && Boolean(task) && task.id === state.selectedTaskId;
  const taskDetailHtml = shouldRenderTaskDetail
    ? `<div class="task-detail-drawer" data-task-detail-drawer>
         <div class="task-detail-resizer" data-task-detail-resizer role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize detail"></div>
         ${renderTaskDetailHtml(task, {
           readOnly,
           restoreAction: readOnly,
           deleteAction: readOnly,
           mobileDetailOpen: state.mobileDetailOpen,
           linkedDocuments: state.taskDocuments,
           checklistItems: state.taskChecklist,
           activityEvents: state.taskActivity,
           activeTaskDetailTab: state.activeTaskDetailTab,
           activeTaskDetailSection: state.activeTaskDetailSection,
           taskNotesDraft: taskNotesDraftFor(task),
           isTaskNotesDirty: Boolean(task && state.taskNotesDraftId === task.id && state.isTaskNotesDirty),
           taskNotesSavedAt: task && state.taskNotesDraftId === task.id ? state.taskNotesSavedAt : '',
           closeAction: 'close-task-detail',
         })}
       </div>`
    : '';

  workspace.innerHTML = [
    renderWorkspacePrimary(visibleTasks, selectedTaskId),
    taskDetailHtml,
  ].join('');

  workspace.classList.toggle('is-mobile-detail-open', Boolean(state.mobileDetailOpen));
  workspace.classList.toggle('is-task-detail-open', Boolean(state.taskDetailOpen));

  if (state.taskDetailOpen) {
    setupPaneResizer({
      resizer: workspace.querySelector('[data-task-detail-resizer]'),
      pane: workspace.querySelector('[data-task-detail-drawer]'),
      target: workspace,
      cssVar: '--task-detail-width',
      storageKey: 'moomora.taskDetailWidth.v1',
      min: 300,
      max: 640,
      edge: 'left',
    });
  }

  workspace.querySelectorAll('[data-task-id]').forEach((row) => {
    row.addEventListener('click', async () => {
      const nextTask = state.tasks.find((item) => item.id === row.dataset.taskId);
      const keepDraft = state.taskNotesDraftId === row.dataset.taskId && state.isTaskNotesDirty;
      setState({
        selectedTaskId: row.dataset.taskId,
        taskDetailOpen: true,
        mobileDetailOpen: isMobile() ? true : state.mobileDetailOpen,
        activeTaskDetailTab: isMobile() ? 'work' : state.activeTaskDetailTab,
        activeTaskDetailSection: 'docs',
        taskNotesDraftId: row.dataset.taskId,
        taskNotesDraft: keepDraft ? state.taskNotesDraft : (nextTask?.notes || ''),
        isTaskNotesDirty: keepDraft,
        taskNotesSavedAt: keepDraft ? state.taskNotesSavedAt : '',
      });
      await loadTaskDocuments(row.dataset.taskId);
      await loadTaskChecklist(row.dataset.taskId);
      await loadTaskActivity(row.dataset.taskId);
      renderWorkspace();
    });
  });

  workspace.querySelector('[data-action="close-task-detail"]')?.addEventListener('click', () => {
    setState({ taskDetailOpen: false, mobileDetailOpen: false });
    renderWorkspace();
  });

  workspace.querySelectorAll('[data-action="set-task-detail-tab"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ activeTaskDetailTab: btn.dataset.tab || 'work' });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="set-task-detail-section"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ activeTaskDetailSection: btn.dataset.section || 'docs' });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="close-mobile-detail"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ taskDetailOpen: false, mobileDetailOpen: false });
      renderWorkspace();
    });
  });

  bindBoardEvents(workspace);
  bindListGroupingEvents(workspace);
  ensureBoardExtras(visibleTasks);

  const editButton = workspace.querySelector('[data-action="edit-task"]');
  editButton?.addEventListener('click', () => {
    const taskToEdit = selectedTask();
    if (!taskToEdit) return;
    setState({
      isTaskFormOpen: true,
      editingTaskId: taskToEdit.id,
      formError: '',
    });
    renderApp();
  });

  const archiveButton = workspace.querySelector('[data-action="archive-task"]');
  archiveButton?.addEventListener('click', async () => {
    const taskToArchive = selectedTask();
    if (!taskToArchive) return;
    const confirmed = window.confirm(`Archive "${taskToArchive.title}"?`);
    if (!confirmed) return;

    try {
      await archiveTask(taskToArchive.id);
      await loadTasks({ selectedTaskId: null });
    } catch {
      window.alert('Moomora Console could not archive the selected task.');
    }
  });

  const restoreButton = workspace.querySelector('[data-action="restore-task"]');
  restoreButton?.addEventListener('click', async () => {
    const taskToRestore = selectedTask();
    if (!taskToRestore) return;
    const confirmed = window.confirm(`Restore "${taskToRestore.title}"?`);
    if (!confirmed) return;

    try {
      await restoreTask(taskToRestore.id);
      await loadTasks({ selectedTaskId: null });
    } catch {
      window.alert('Moomora Console could not restore the selected task.');
      await loadTasks({ selectedTaskId: null });
    }
  });

  const deleteArchivedButton = workspace.querySelector('[data-action="delete-archived-task"]');
  deleteArchivedButton?.addEventListener('click', async () => {
    const taskToDelete = selectedTask();
    if (!taskToDelete) return;
    const confirmed = window.confirm(`Permanently delete "${taskToDelete.title}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteArchivedTask(taskToDelete.id);
      await loadTasks({ selectedTaskId: null });
    } catch {
      window.alert('Moomora Console could not delete the archived task.');
    }
  });

  workspace.querySelector('[data-action="open-link-picker"]')?.addEventListener('click', async () => {
    try {
      const docs = await fetchDocuments({ archived: false });
      setState({ linkPickerDocuments: docs, linkPickerQuery: '', isLinkPickerOpen: true });
      renderApp();
    } catch {
      window.alert('Moomora Console could not load documents to link.');
    }
  });

  workspace.querySelectorAll('[data-action="open-linked-doc"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const docId = btn.dataset.documentId;
      // Clear Library filters so the linked document is always the one shown.
      // Otherwise an active type/tag/search filter can hide it and
      // selectedDocument() silently falls back to the first visible doc.
      const linkedDoc = state.taskDocuments.find(d => d.id === docId);
      const patch = {
        activeView: 'library',
        selectedDocumentId: docId,
        libraryTypeFilter: 'all',
        activeLibraryTags: [],
        searchQuery: '',
        mobileDetailOpen: false,
      };
      // Align the project context when the linked doc lives in another project.
      if (linkedDoc?.projectId && state.activeProject !== 'all' && state.activeProject !== linkedDoc.projectId) {
        patch.activeProject = linkedDoc.projectId;
        persistActiveProject(linkedDoc.projectId);
      }
      setState(patch);
      try {
        await loadDocuments({ selectedDocumentId: docId });
      } catch (error) {
        setState({ apiStatus: 'error' });
        renderError(error.message);
      }
    });
  });

  workspace.querySelectorAll('[data-action="unlink-document"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = state.selectedTaskId;
      if (!taskId) return;
      try {
        const updated = await unlinkTaskDocument(taskId, btn.dataset.documentId);
        setState({ taskDocuments: updated });
        clearTaskBoardExtra(taskId);
        renderWorkspace();
      } catch {
        window.alert('Moomora Console could not unlink the document.');
      }
    });
  });

  workspace.querySelector('[data-action="save-task-notes"]')?.addEventListener('click', async () => {
    const textarea = workspace.querySelector('[data-task-notes]');
    if (!textarea) return;
    const taskToSave = selectedTask();
    if (!taskToSave) return;
    try {
      const notes = state.taskNotesDraftId === taskToSave.id ? state.taskNotesDraft : textarea.value;
      const updated = normalizeTask(await updateTask(taskToSave.id, { notes }));
      setState({ tasks: state.tasks.map((t) => (t.id === updated.id ? updated : t)) });
      setState({
        taskNotesDraftId: updated.id,
        taskNotesDraft: updated.notes || '',
        isTaskNotesDirty: false,
        taskNotesSavedAt: shortTime(),
      });
      clearTaskBoardExtra(updated.id);
      renderWorkspace();
    } catch {
      window.alert('Moomora Console could not save notes.');
    }
  });

  workspace.querySelector('[data-action="discard-task-notes"]')?.addEventListener('click', () => {
    const taskToReset = selectedTask();
    if (!taskToReset) return;
    setState({
      taskNotesDraftId: taskToReset.id,
      taskNotesDraft: taskToReset.notes || '',
      isTaskNotesDirty: false,
    });
    renderWorkspace();
  });

  workspace.querySelector('[data-task-notes]')?.addEventListener('input', (event) => {
    const taskToEdit = selectedTask();
    if (!taskToEdit) return;
    const value = event.target.value;
    const isDirty = value !== (taskToEdit.notes || '');
    setState({
      taskNotesDraftId: taskToEdit.id,
      taskNotesDraft: value,
      isTaskNotesDirty: isDirty,
    });
    const status = workspace.querySelector('[data-task-notes-status]');
    const saveButton = workspace.querySelector('[data-action="save-task-notes"]');
    if (status) status.textContent = isDirty ? 'dirty · local edit' : 'saved';
    if (saveButton) saveButton.disabled = !isDirty;
  });

  async function submitNewChecklistItem(input) {
    const taskId = state.selectedTaskId;
    const label = input?.value.trim();
    if (!label || !taskId) return;
    try {
      await addChecklistItem(taskId, label);
      await loadTaskChecklist(taskId);
      clearTaskBoardExtra(taskId);
      renderWorkspace();
    } catch {
      window.alert('Moomora Console could not add the checklist item.');
    }
  }

  workspace.querySelector('[data-action="add-checklist-item"]')?.addEventListener('click', () => {
    submitNewChecklistItem(workspace.querySelector('[data-checklist-new]'));
  });

  workspace.querySelector('[data-checklist-new]')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitNewChecklistItem(event.target);
  });

  workspace.querySelectorAll('[data-action="toggle-checklist-item"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = state.selectedTaskId;
      if (!taskId) return;
      try {
        await setChecklistItem(taskId, btn.dataset.itemId, btn.dataset.completed !== 'true');
        await loadTaskChecklist(taskId);
        clearTaskBoardExtra(taskId);
        renderWorkspace();
      } catch {
        window.alert('Moomora Console could not update the checklist item.');
      }
    });
  });

  workspace.querySelectorAll('[data-action="delete-checklist-item"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = state.selectedTaskId;
      if (!taskId) return;
      try {
        await deleteChecklistItem(taskId, btn.dataset.itemId);
        await loadTaskChecklist(taskId);
        clearTaskBoardExtra(taskId);
        renderWorkspace();
      } catch {
        window.alert('Moomora Console could not delete the checklist item.');
      }
    });
  });
}

// Generic drag-to-resize for a pane. edge:'right' grows the pane as the pointer
// moves right (left-docked browser); edge:'left' grows it as the pointer moves
// left (right-docked drawer). Width is applied to `target` as `cssVar` and
// persisted under `storageKey`.
function setupPaneResizer({ resizer, pane, target, cssVar, storageKey, min, max, edge = 'right' }) {
  if (!resizer || !pane || !target) return;
  const applyWidth = (width) => {
    const clamped = Math.min(max, Math.max(min, width));
    target.style.setProperty(cssVar, `${clamped}px`);
    return clamped;
  };
  let saved = null;
  try { saved = window.localStorage?.getItem(storageKey); } catch { saved = null; }
  if (saved) applyWidth(parseInt(saved, 10) || min);

  const persist = () => {
    try {
      const current = target.style.getPropertyValue(cssVar);
      if (current) window.localStorage?.setItem(storageKey, current.trim());
    } catch { /* convenience only */ }
  };

  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;
    resizer.classList.add('is-dragging');
    resizer.setPointerCapture?.(event.pointerId);
    const sign = edge === 'left' ? -1 : 1;
    const onMove = (m) => applyWidth(startWidth + sign * (m.clientX - startX));
    const onEnd = () => {
      resizer.classList.remove('is-dragging');
      resizer.releasePointerCapture?.(event.pointerId);
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onEnd);
      resizer.removeEventListener('pointercancel', onEnd);
      persist();
    };
    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onEnd);
    resizer.addEventListener('pointercancel', onEnd);
  });

  resizer.addEventListener('keydown', (event) => {
    const step = (event.shiftKey ? 32 : 16) * (edge === 'left' ? -1 : 1);
    if (event.key === 'ArrowLeft') { event.preventDefault(); applyWidth(pane.getBoundingClientRect().width - step); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); applyWidth(pane.getBoundingClientRect().width + step); }
    else { return; }
    persist();
  });
}

function setupLibraryResizer(workspace, libraryWorkspaceElement) {
  const resizer = workspace.querySelector('[data-library-resizer]');
  const browser = workspace.querySelector('.library-browser');
  setupPaneResizer({
    resizer,
    pane: browser,
    target: libraryWorkspaceElement,
    cssVar: '--library-browser-width',
    storageKey: LIBRARY_BROWSER_WIDTH_KEY,
    min: 220,
    max: 560,
    edge: 'right',
  });
}

function renderLibraryWorkspace(workspace) {
  const contextDocuments = state.activeProject === 'all'
    ? state.documents
    : state.documents.filter(document => document.projectId === state.activeProject);
  const visibleDocuments = visibleDocumentsForCurrentView();
  const document = selectedDocument();
  workspace.innerHTML = renderLibraryHtml({
    documents: visibleDocuments,
    selectedDocumentId: document?.id || null,
    editorMode: state.documentEditorMode,
    draftBody: draftBodyForDocument(document),
    isDirty: state.isDocumentDirty && state.documentDraftId === document?.id,
    availableTags: tagsForDocuments(contextDocuments),
    activeTags: state.activeLibraryTags,
    tagQuery: state.libraryTagQuery,
    areTagsExpanded: state.areLibraryTagsExpanded,
    savedViews: state.librarySavedViews,
    activeSavedViewId: activeSavedLibraryViewId(),
    isInfoEditing: state.isDocumentInfoEditorOpen,
    infoError: state.documentInfoError,
    isSaving: state.isSaving,
    saveStatus: state.documentSaveStatus,
    isFocusMode: state.isDocumentFocusMode,
    isLibraryTagsDrawerOpen: state.isLibraryTagsDrawerOpen,
    isLibraryDocOpen: state.isLibraryDocOpen,
    typeFilter: state.libraryTypeFilter,
    sortBy: state.librarySortBy,
    groupByType: state.libraryGroupByType,
    libraryView: state.libraryView,
  });

  const libraryWorkspaceElement = workspace.querySelector('.library-workspace');
  if (libraryWorkspaceElement) {
    libraryWorkspaceElement.classList.toggle('is-library-doc-open', Boolean(state.isLibraryDocOpen));
    setupLibraryResizer(workspace, libraryWorkspaceElement);
  }

  workspace.querySelector('[data-action="toggle-library-tags-drawer"]')?.addEventListener('click', () => {
    setState({ isLibraryTagsDrawerOpen: !state.isLibraryTagsDrawerOpen });
    renderWorkspace();
  });

  workspace.querySelector('[data-action="toggle-library-view"]')?.addEventListener('click', async () => {
    clearDocumentAutosave();
    setState({
      libraryView: state.libraryView === 'archive' ? 'active' : 'archive',
      selectedDocumentId: null,
      documentDraftId: null,
      documentDraftBody: '',
      isDocumentDirty: false,
      isDocumentFocusMode: false,
    });
    try {
      await loadDocuments({ selectedDocumentId: null });
    } catch (error) {
      setState({ apiStatus: 'error' });
      renderError(error.message);
    }
  });

  workspace.querySelector('[data-action="close-library-doc"]')?.addEventListener('click', () => {
    setState({ isLibraryDocOpen: false });
    renderWorkspace();
  });

  workspace.querySelectorAll('[data-library-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ libraryTypeFilter: btn.dataset.libraryType });
      persistLibraryControls();
      renderWorkspace();
    });
  });

  workspace.querySelector('[data-library-sort]')?.addEventListener('change', (event) => {
    setState({ librarySortBy: event.target.value });
    persistLibraryControls();
    renderWorkspace();
  });

  workspace.querySelector('[data-action="toggle-library-group"]')?.addEventListener('click', () => {
    setState({ libraryGroupByType: !state.libraryGroupByType });
    persistLibraryControls();
    renderWorkspace();
  });

  function resetDocumentDraft() {
    clearDocumentAutosave();
    return {
      selectedDocumentId: null,
      documentDraftId: null,
      documentDraftBody: '',
      isDocumentDirty: false,
      documentSaveStatus: 'Saved',
      isDocumentFocusMode: false,
      isDocumentInfoEditorOpen: false,
      documentInfoError: '',
    };
  }

  let documentEditorController = null;

  async function saveDocumentDraftFromWorkspace() {
    const documentToSave = selectedDocument();
    if (!documentToSave || !state.isDocumentDirty || isSavingDocumentDraft) return;

    clearDocumentAutosave();
    isSavingDocumentDraft = true;
    const savingStatus = state.documentSaveStatus === 'Autosaving...' ? 'Autosaving...' : 'Saving...';
    setState({ documentSaveStatus: savingStatus });
    updateDocumentSaveControls(workspace, savingStatus);

    try {
      const savedDocument = await updateDocument(documentToSave.id, { body: state.documentDraftBody });
      const patch = documentDraftSavedPatch({ documents: state.documents, savedDocument });
      const shouldPreserveEditor = canPreserveEditorAfterDraftSave({
        editorExists: Boolean(documentEditorController || workspace.querySelector('[data-document-editor]')),
        savedDocumentId: savedDocument.id,
        selectedDocumentId: state.selectedDocumentId || documentToSave.id,
        documentDraftId: state.documentDraftId,
      });
      setState(patch);
      isSavingDocumentDraft = false;
      if (shouldPreserveEditor) {
        updateDocumentSaveControls(workspace, 'Saved');
      } else {
        renderWorkspace();
      }
    } catch {
      isSavingDocumentDraft = false;
      setState({ documentSaveStatus: 'Save failed' });
      updateDocumentSaveControls(workspace, 'Save failed');
      window.alert('Moomora Console could not save this document.');
    }
  }

  function handleDocumentDraftBodyChange(value) {
    const documentToEdit = selectedDocument();
    if (!documentToEdit) return;

    const nextBody = String(value ?? '');
    const isDirty = nextBody !== (documentToEdit.body || '');
    setState({
      documentDraftId: documentToEdit.id,
      documentDraftBody: nextBody,
      isDocumentDirty: isDirty,
      documentSaveStatus: isDirty ? 'Unsaved changes' : 'Saved',
    });
    updateDocumentLivePreview(workspace, nextBody);
    updateDocumentSaveControls(workspace, state.documentSaveStatus);
    if (state.isDocumentDirty) {
      scheduleDocumentAutosave();
    } else {
      clearDocumentAutosave();
    }
  }

  function scheduleDocumentAutosave() {
    clearDocumentAutosave();
    documentAutosaveTimer = window.setTimeout(() => {
      if (!state.isDocumentDirty) return;
      setState({ documentSaveStatus: 'Autosaving...' });
      updateDocumentSaveControls(workspace, 'Autosaving...');
      saveDocumentDraftFromWorkspace();
    }, DOCUMENT_AUTOSAVE_DELAY_MS);
  }

  const fallbackEditor = workspace.querySelector('[data-document-editor]');
  const codeEditorHost = workspace.querySelector('[data-code-editor]');
  if (fallbackEditor && codeEditorHost) {
    documentEditorController = mountCodeMirrorEditor({
      host: codeEditorHost,
      value: fallbackEditor.value,
      onChange(value) {
        fallbackEditor.value = value;
        handleDocumentDraftBodyChange(value);
      },
      onSave: saveDocumentDraftFromWorkspace,
    });

    if (documentEditorController) {
      fallbackEditor.hidden = true;
      codeEditorHost.hidden = false;
    }
  }

  const libraryWorkspace = workspace.querySelector('.library-workspace');
  libraryWorkspace?.addEventListener('click', (event) => {
    const tagButton = event.target.closest('[data-library-tag]');
    if (tagButton && libraryWorkspace.contains(tagButton)) {
      event.preventDefault();
      event.stopPropagation();
      const tag = String(tagButton.dataset.libraryTag || '').trim().toLowerCase();
      if (!tag) return;
      const currentTags = Array.isArray(state.activeLibraryTags) ? state.activeLibraryTags : [];
      const activeTags = currentTags.includes(tag)
        ? currentTags.filter(activeTag => activeTag !== tag)
        : [...currentTags, tag];
      setState({
        activeLibraryTags: activeTags,
        libraryTagQuery: '',
        ...resetDocumentDraft(),
      });
      renderWorkspace();
      return;
    }

    const savedViewButton = event.target.closest('[data-library-saved-view-id]');
    if (
      savedViewButton
      && libraryWorkspace.contains(savedViewButton)
      && savedViewButton.dataset.action !== 'delete-library-saved-view'
      && savedViewButton.dataset.action !== 'rename-library-saved-view'
      && savedViewButton.getAttribute('data-action') !== 'delete-library-saved-view'
      && savedViewButton.getAttribute('data-action') !== 'rename-library-saved-view'
    ) {
      event.preventDefault();
      event.stopPropagation();
      const view = state.librarySavedViews.find(item => item.id === savedViewButton.dataset.librarySavedViewId);
      if (!view) return;
      setState({
        activeLibraryTags: view.tags,
        libraryTagQuery: '',
        areLibraryTagsExpanded: false,
        ...resetDocumentDraft(),
      });
      renderWorkspace();
      return;
    }

    const activeFilterButton = event.target.closest('[data-library-active-filter]');
    if (activeFilterButton && libraryWorkspace.contains(activeFilterButton)) {
      event.preventDefault();
      event.stopPropagation();
      const tag = String(activeFilterButton.dataset.libraryActiveFilter || '').trim().toLowerCase();
      if (!tag) return;
      setState({
        activeLibraryTags: state.activeLibraryTags.filter(activeTag => activeTag !== tag),
        libraryTagQuery: '',
        ...resetDocumentDraft(),
      });
      renderWorkspace();
      return;
    }

    const renameSavedViewButton = event.target.closest('[data-action="rename-library-saved-view"]');
    if (renameSavedViewButton && libraryWorkspace.contains(renameSavedViewButton)) {
      event.preventDefault();
      event.stopPropagation();
      const view = state.librarySavedViews.find(item => item.id === renameSavedViewButton.dataset.librarySavedViewId);
      if (!view) return;
      const nextLabel = window.prompt('Rename saved view', view.label);
      if (nextLabel === null) return;
      const renamedView = renameSavedLibraryView(view, nextLabel);
      if (!renamedView) return;
      setState({
        librarySavedViews: [
          ...state.librarySavedViews.filter(item => item.id !== view.id && item.id !== renamedView.id),
          renamedView,
        ],
      });
      persistSavedLibraryViews();
      renderWorkspace();
      return;
    }

    const deleteSavedViewButton = event.target.closest('[data-action="delete-library-saved-view"]');
    if (deleteSavedViewButton && libraryWorkspace.contains(deleteSavedViewButton)) {
      event.preventDefault();
      event.stopPropagation();
      setState({
        librarySavedViews: state.librarySavedViews.filter(view => view.id !== deleteSavedViewButton.dataset.librarySavedViewId),
      });
      persistSavedLibraryViews();
      renderWorkspace();
      return;
    }

    const saveViewButton = event.target.closest('[data-action="save-library-view"]');
    if (saveViewButton && libraryWorkspace.contains(saveViewButton)) {
      event.preventDefault();
      event.stopPropagation();
      const input = workspace.querySelector('[data-library-saved-view-name]');
      const fallbackName = state.activeLibraryTags.join(' + ');
      const view = createSavedLibraryView(input?.value || fallbackName, state.activeLibraryTags);
      if (!view) return;
      setState({
        librarySavedViews: [
          ...state.librarySavedViews.filter(item => item.id !== view.id),
          view,
        ],
      });
      persistSavedLibraryViews();
      renderWorkspace();
      return;
    }

    const clearTagsButton = event.target.closest('[data-action="clear-library-tags"]');
    if (clearTagsButton && libraryWorkspace.contains(clearTagsButton)) {
      event.preventDefault();
      event.stopPropagation();
      setState({
        activeLibraryTags: [],
        libraryTagQuery: '',
        areLibraryTagsExpanded: false,
        ...resetDocumentDraft(),
      });
      renderWorkspace();
      return;
    }

    const toggleTagsButton = event.target.closest('[data-action="toggle-library-tags"]');
    if (toggleTagsButton && libraryWorkspace.contains(toggleTagsButton)) {
      event.preventDefault();
      event.stopPropagation();
      setState({ areLibraryTagsExpanded: !state.areLibraryTagsExpanded });
      renderWorkspace();
    }
  });

  workspace.querySelector('[data-library-tag-search]')?.addEventListener('input', (event) => {
    setState({
      libraryTagQuery: event.target.value,
      areLibraryTagsExpanded: false,
    });
    renderWorkspace();
    const nextInput = workspace.querySelector('[data-library-tag-search]');
    nextInput?.focus();
    nextInput?.setSelectionRange?.(nextInput.value.length, nextInput.value.length);
  });

  workspace.querySelectorAll('[data-library-document-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const nextDocument = state.documents.find(item => item.id === row.dataset.libraryDocumentId);
      clearDocumentAutosave();
      setState({
        selectedDocumentId: row.dataset.libraryDocumentId,
        documentDraftId: nextDocument?.id || null,
        documentDraftBody: nextDocument?.body || '',
        isDocumentDirty: false,
        documentSaveStatus: 'Saved',
        isDocumentFocusMode: false,
        isDocumentInfoEditorOpen: false,
        documentInfoError: '',
        isLibraryDocOpen: isMobile() ? true : state.isLibraryDocOpen,
      });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-library-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({ documentEditorMode: button.dataset.libraryMode || 'preview' });
      renderWorkspace();
    });
  });

  workspace.querySelector('[data-document-editor]')?.addEventListener('input', (event) => {
    handleDocumentDraftBodyChange(event.target.value);
  });

  workspace.querySelector('[data-document-editor]')?.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveDocumentDraftFromWorkspace();
    }
  });

  workspace.querySelectorAll('[data-markdown-action]').forEach((button) => {
    button.addEventListener('click', () => {
      if (documentEditorController) {
        documentEditorController.applyFormat(button.dataset.markdownAction);
        return;
      }

      const textarea = workspace.querySelector('[data-document-editor]');
      if (!textarea) return;
      applyMarkdownToolbarAction(textarea, button.dataset.markdownAction);
    });
  });

  workspace.querySelector('[data-action="save-document-draft"]')?.addEventListener('click', () => {
    saveDocumentDraftFromWorkspace();
  });

  workspace.querySelector('[data-action="toggle-document-focus"]')?.addEventListener('click', () => {
    setState({ isDocumentFocusMode: !state.isDocumentFocusMode });
    renderWorkspace();
  });

  workspace.querySelector('[data-action="export-document"]')?.addEventListener('click', (event) => {
    const id = event.currentTarget.getAttribute('data-document-id');
    if (id) exportLibraryDocument(id);
  });

  workspace.querySelector('[data-action="edit-document"]')?.addEventListener('click', () => {
    setState({ documentEditorMode: 'edit' });
    renderWorkspace();
  });

  workspace.querySelector('[data-action="edit-document-info"]')?.addEventListener('click', () => {
    setState({
      isDocumentInfoEditorOpen: true,
      documentInfoError: '',
      isSaving: false,
    });
    renderWorkspace();
  });

  workspace.querySelector('[data-action="cancel-document-info"]')?.addEventListener('click', () => {
    setState({
      isDocumentInfoEditorOpen: false,
      documentInfoError: '',
      isSaving: false,
    });
    renderWorkspace();
  });

  workspace.querySelector('[data-document-info-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const documentToSave = selectedDocument();
    if (!documentToSave) return;

    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') || '').trim();
    if (!title) {
      setState({ documentInfoError: 'Title is required.' });
      renderWorkspace();
      return;
    }

    const payload = {
      title,
      documentType: String(data.get('documentType') || 'note'),
      tags: tagsFromFormValue(data.get('tags')),
      sourceFilename: String(data.get('sourceFilename') || '').trim() || null,
    };

    setState({ isSaving: true, documentInfoError: '' });
    renderWorkspace();

    try {
      const savedDocument = await updateDocument(documentToSave.id, payload);
      setState({
        documents: state.documents.map(document => document.id === savedDocument.id ? savedDocument : document),
        selectedDocumentId: savedDocument.id,
        documentDraftId: savedDocument.id,
        documentDraftBody: savedDocument.body || '',
        isDocumentDirty: false,
        isDocumentInfoEditorOpen: false,
        documentInfoError: '',
        isSaving: false,
      });
      renderWorkspace();
    } catch {
      setState({
        documentInfoError: 'Moomora Console could not save document info.',
        isSaving: false,
      });
      renderWorkspace();
    }
  });

  workspace.querySelector('[data-action="archive-document"]')?.addEventListener('click', async () => {
    const documentToArchive = selectedDocument();
    if (!documentToArchive) return;
    const confirmed = window.confirm(`Archive "${documentToArchive.title}"?`);
    if (!confirmed) return;

    try {
      await archiveDocument(documentToArchive.id);
      await loadDocuments({ selectedDocumentId: null });
    } catch {
      window.alert('Moomora Console could not archive the selected document.');
    }
  });

  workspace.querySelector('[data-action="restore-document"]')?.addEventListener('click', async () => {
    const documentToRestore = selectedDocument();
    if (!documentToRestore) return;
    const confirmed = window.confirm(`Restore "${documentToRestore.title}"?`);
    if (!confirmed) return;

    try {
      await restoreDocument(documentToRestore.id);
      await loadDocuments({ selectedDocumentId: documentToRestore.id });
    } catch {
      window.alert('Moomora Console could not restore the selected document.');
    }
  });

  workspace.querySelector('[data-action="delete-archived-document"]')?.addEventListener('click', async () => {
    const documentToDelete = selectedDocument();
    if (!documentToDelete) return;
    const confirmed = window.confirm(`Permanently delete "${documentToDelete.title}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteArchivedDocument(documentToDelete.id);
      await loadDocuments({ selectedDocumentId: null });
    } catch {
      window.alert('Moomora Console could not delete the archived document.');
    }
  });
}

function openTouchMoveMenu(taskId, _anchorElement) {
  const STATUSES = ['high-priority', 'in-progress', 'planned', 'completed', 'notes'];
  const choice = window.prompt(`move to which column?\n${STATUSES.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (!choice) return;
  const idx = Number(choice) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= STATUSES.length) return;
  const targetStatus = STATUSES[idx];
  handleBoardDrop({ taskId, targetStatus, beforeTaskId: null });
}

function handleOpenBoardTaskDetail(event) {
  event.preventDefault();
  const taskId = state.selectedTaskId || selectedTask()?.id;
  if (!taskId) return;
  setState({
    selectedTaskId: taskId,
    taskDetailOpen: true,
    activeTaskDetailSection: 'summary',
    activeTaskDetailTab: 'summary',
  });
  renderWorkspace();
}

function bindBoardEvents(workspace) {
  if (state.activeView !== 'board') return;

  const openDetailButton = workspace.querySelector('[data-action="open-board-task-detail"]');
  openDetailButton?.removeEventListener('click', handleOpenBoardTaskDetail);
  openDetailButton?.addEventListener('click', handleOpenBoardTaskDetail);

  workspace.querySelectorAll('[data-board-card]').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/task-id', card.dataset.taskId);
        event.dataTransfer.setData('text/plain', card.dataset.taskId);
        event.dataTransfer.setDragImage?.(card, 16, 16);
        event.dataTransfer.effectAllowed = 'move';
      }
      card.classList.add('is-dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      workspace.querySelectorAll('.is-drop-target').forEach((target) => {
        target.classList.remove('is-drop-target');
      });
    });
  });

  const LONG_PRESS_MS = 480;

  workspace.querySelectorAll('[data-board-card]').forEach((card) => {
    let pressTimer = null;
    let pressed = false;

    const cancelPress = () => {
      pressed = false;
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    card.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      pressed = true;
      pressTimer = window.setTimeout(() => {
        if (!pressed) return;
        cancelPress();
        openTouchMoveMenu(card.dataset.taskId, card);
      }, LONG_PRESS_MS);
    });

    card.addEventListener('pointerup', cancelPress);
    card.addEventListener('pointercancel', cancelPress);
    card.addEventListener('pointerleave', cancelPress);
  });

  workspace.querySelectorAll('.board-cards[data-board-column]').forEach((column) => {
    column.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      column.classList.add('is-drop-target');
    });

    column.addEventListener('dragleave', (event) => {
      if (!column.contains(event.relatedTarget)) {
        column.classList.remove('is-drop-target');
      }
    });

    column.addEventListener('drop', async (event) => {
      event.preventDefault();
      column.classList.remove('is-drop-target');
      const taskId = event.dataTransfer?.getData('text/task-id') || event.dataTransfer?.getData('text/plain');
      const targetCard = event.target.closest('[data-board-card]');
      await handleBoardDrop({
        taskId,
        targetStatus: column.dataset.boardColumn,
        beforeTaskId: targetCard?.dataset.taskId === taskId ? null : targetCard?.dataset.taskId,
      });
    });
  });

  workspace.querySelectorAll('[data-action="toggle-board-section"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const section = btn.dataset.section;
      if (!section) return;
      setState({
        boardOpenSections: { ...state.boardOpenSections, [section]: state.boardOpenSections[section] === false },
      });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="toggle-board-filter"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const filter = btn.dataset.filter;
      if (!filter) return;
      const active = new Set(state.boardFilters);
      if (active.has(filter)) active.delete(filter);
      else active.add(filter);
      setState({ boardFilters: [...active] });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="board-move-selected"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      const targetStatus = btn.dataset.status;
      const taskId = state.selectedTaskId || selectedTask()?.id;
      if (!taskId || !targetStatus) return;
      const task = state.tasks.find(item => item.id === taskId);
      if (!task || (task.status || 'planned') === targetStatus) return;
      setState({
        tasks: state.tasks.map(item => (item.id === taskId ? { ...item, status: targetStatus } : item)),
      });
      clearTaskBoardExtra(taskId);
      renderWorkspace();
      try {
        await updateTask(taskId, { status: targetStatus });
        await loadTasks({ selectedTaskId: taskId });
      } catch {
        window.alert('Moomora Console could not move the selected card.');
        await loadTasks({ selectedTaskId: taskId });
      }
    });
  });

  workspace.querySelectorAll('[data-action="set-board-grouping"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const grouping = btn.dataset.grouping === 'swimlanes' ? 'swimlanes' : 'flat';
      persistBoardGrouping(grouping);
      setState({ boardGrouping: grouping });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="toggle-board-lane"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const id = btn.dataset.projectId;
      if (!id) return;
      setState({ boardLaneCollapsed: { ...state.boardLaneCollapsed, [id]: state.boardLaneCollapsed[id] !== true } });
      renderWorkspace();
    });
  });
}

function bindListGroupingEvents(workspace) {
  workspace.querySelectorAll('[data-action="set-list-grouping"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const grouping = btn.dataset.grouping === 'swimlanes' ? 'swimlanes' : 'flat';
      persistListGrouping(grouping);
      setState({ listGrouping: grouping });
      renderWorkspace();
    });
  });

  workspace.querySelectorAll('[data-action="toggle-list-lane"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const id = btn.dataset.projectId;
      if (!id) return;
      setState({ listLaneCollapsed: { ...state.listLaneCollapsed, [id]: state.listLaneCollapsed[id] !== true } });
      renderWorkspace();
    });
  });
}

async function handleBoardDrop({ taskId, targetStatus, beforeTaskId }) {
  if (!taskId || !targetStatus) return;

  const boardTasks = tasksForView(state.tasks, 'board');
  const result = moveTaskOnBoard(boardTasks, { taskId, targetStatus, beforeTaskId });
  if (!result.updates.length) return;

  const movedTaskIds = new Set(result.tasks.map(task => task.id));
  setState({
    tasks: [
      ...result.tasks,
      ...state.tasks.filter(task => !movedTaskIds.has(task.id)),
    ],
    selectedTaskId: taskId,
  });
  clearTaskBoardExtra(taskId);
  renderWorkspace();

  try {
    await reorderTasks(result.updates);
    await loadTasks({ selectedTaskId: taskId });
  } catch {
    window.alert('Moomora Console could not save the board move.');
    await loadTasks({ selectedTaskId: taskId });
  }
}

function visibleTasksForCurrentView() {
  return filterTasks(tasksForView(state.tasks, state.activeView), state.searchQuery);
}

function listOptionsForView(activeView) {
  if (activeView === 'backlog') {
    return {
      title: 'Backlog',
      countLabel: 'planned tasks',
      emptyTitle: 'No backlog tasks',
      emptyDescription: 'Planned work without a due date will appear here.',
    };
  }
  if (activeView === 'archive') {
    return {
      title: 'Archived Tasks',
      countLabel: 'archived tasks',
      emptyTitle: 'No archived tasks',
      emptyDescription: 'Archived work will appear here.',
    };
  }
  return {
    title: 'Task Queue',
    countLabel: 'active tasks',
    emptyTitle: 'No tasks in this queue',
    emptyDescription: 'New operational work will appear here when it is added.',
  };
}

function renderWorkspacePrimary(visibleTasks, selectedTaskId) {
  if (state.activeView === 'board') {
    const isAllProjects = state.activeProject === 'all';
    const useSwimlanes = state.boardGrouping === 'swimlanes' && isAllProjects;
    const boardTasks = applyBoardFilters(visibleTasks, state.boardFilters, state.taskBoardExtras, today());
    const board = useSwimlanes
      ? renderSwimlaneBoardHtml(boardTasks, selectedTaskId, {
          today: today(),
          projects: state.projects,
          boardLaneCollapsed: state.boardLaneCollapsed,
          taskBoardExtras: state.taskBoardExtras,
        })
      : renderBoardHtml(boardTasks, selectedTaskId, {
          boardOpenSections: state.boardOpenSections,
          today: today(),
          showProjectChips: isAllProjects,
          projects: state.projects,
          taskBoardExtras: state.taskBoardExtras,
        });
    const toolbar = isAllProjects ? renderBoardToolbar(state.boardGrouping) : '';
    const filters = renderBoardFilters(state.boardFilters);
    // Wrap in one element so the .workspace grid treats the board as a single
    // primary cell — otherwise the prepended toolbar becomes a second grid item
    // and the board spills into the detail column.
    return `<div class="board-view">${toolbar}${filters}${board}</div>`;
  }

  const listOptions = listOptionsForView(state.activeView);
  const showListToolbar = state.activeProject === 'all' && state.activeView === 'list';
  const useSwimlanes = showListToolbar && state.listGrouping === 'swimlanes';
  const toolbar = showListToolbar ? renderListToolbar(state.listGrouping) : '';
  return useSwimlanes
    ? renderSwimlaneListHtml(visibleTasks, selectedTaskId, {
        ...listOptions,
        toolbar,
        projects: state.projects,
        listLaneCollapsed: state.listLaneCollapsed,
        today: today(),
      })
    : renderListHtml(visibleTasks, selectedTaskId, { ...listOptions, toolbar });
}

function renderApp() {
  const metrics = buildMetrics(state.tasks, today());
  app.innerHTML = renderShellHtml({
    activeProject: state.activeProject,
    projects: state.projects,
    activeView: state.activeView,
    apiStatus: state.apiStatus,
    searchQuery: state.searchQuery,
    metrics,
    isDrawerOpen: state.isDrawerOpen,
  });
  renderWorkspace();
  if (state.isTaskFormOpen) {
    app.insertAdjacentHTML('beforeend', renderTaskFormHtml({
      task: editingTask(),
      projects: state.projects,
      values: { project: editingTask()?.projectId || defaultProjectId() },
      error: state.formError,
      isSaving: state.isSaving,
    }));
  }
  if (state.isDocumentFormOpen) {
    app.insertAdjacentHTML('beforeend', renderDocumentFormHtml({
      document: editingDocument(),
      projects: state.projects,
      values: { project: editingDocument()?.projectId || defaultProjectId() },
      error: state.documentFormError,
      isSaving: state.isSaving,
    }));
  }
  if (state.isAdminPanelOpen) {
    app.insertAdjacentHTML('beforeend', renderAdminPanelHtml({
      activeProject: state.activeProject,
      projects: state.projects,
      taskCount: state.tasks.length,
      documentCount: state.libraryActiveDocumentCount,
      importMode: state.adminImportMode,
    }));
  }
  if (state.isProjectManagerOpen) {
    const liveProjects = state.managedProjects.filter((p) => p.status !== 'archived');
    const archivedCount = state.managedProjects.length - liveProjects.length;
    app.insertAdjacentHTML('beforeend', renderProjectManagerHtml({
      projects: liveProjects,
      archivedCount,
      error: state.projectManagerError,
    }));
  }
  if (state.isProjectArchiveOpen) {
    const archivedProjects = state.managedProjects.filter((p) => p.status === 'archived');
    app.insertAdjacentHTML('beforeend', renderProjectArchiveHtml({
      projects: archivedProjects,
      error: state.projectManagerError,
    }));
  }
  if (state.isSettingsPanelOpen) {
    app.insertAdjacentHTML('beforeend', renderSettingsPanelHtml({
      activeSection: state.settingsSection,
      preferences: state.preferences,
    }));
  }
  if (state.isLinkPickerOpen) {
    app.insertAdjacentHTML('beforeend', renderLinkPickerHtml({
      documents: state.linkPickerDocuments,
      linkedIds: state.taskDocuments.map(d => d.id),
      query: state.linkPickerQuery,
    }));
  }
  bindShellEvents();
  bindTaskFormEvents();
  bindDocumentFormEvents();
  bindAdminPanelEvents();
  bindProjectManagerEvents();
  bindProjectArchiveEvents();
  bindSettingsPanelEvents();
  bindLinkPickerEvents();
}

function bindShellEvents() {
  app.querySelectorAll('[data-action="new-task"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({
        isTaskFormOpen: true,
        editingTaskId: null,
        formError: '',
        isDrawerOpen: false,
      });
      renderApp();
    });
  });

  app.querySelectorAll('[data-action="new-document"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({
        isDocumentFormOpen: true,
        editingDocumentId: null,
        documentFormError: '',
        isDrawerOpen: false,
      });
      renderApp();
    });
  });

  app.querySelectorAll('[data-action="open-admin"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({
        isAdminPanelOpen: true,
        isSettingsPanelOpen: false,
        isTaskFormOpen: false,
        isDocumentFormOpen: false,
        isDrawerOpen: false,
        editingTaskId: null,
        editingDocumentId: null,
      });
      renderApp();
    });
  });

  app.querySelectorAll('[data-action="open-settings"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({
        isSettingsPanelOpen: true,
        isAdminPanelOpen: false,
        isTaskFormOpen: false,
        isDocumentFormOpen: false,
        isDrawerOpen: false,
        editingTaskId: null,
        editingDocumentId: null,
      });
      renderApp();
    });
  });

  app.querySelectorAll('[data-action="toggle-drawer"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({ isDrawerOpen: !state.isDrawerOpen });
      renderApp();
    });
  });

  app.querySelector('[data-action="import-document"]')?.addEventListener('click', () => {
    const input = globalThis.document.createElement('input');
    input.type = 'file';
    input.accept = 'text/markdown,.md,.markdown';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) importLibraryMarkdownFile(file);
    });
    input.click();
  });

  app.querySelector('[data-search-input]')?.addEventListener('input', (event) => {
    setState({ searchQuery: event.target.value });
    renderWorkspace();
  });

  app.querySelectorAll('[data-project]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextProject = button.dataset.project;
      if (!nextProject || nextProject === state.activeProject) return;
      clearDocumentAutosave();
      setState({
        activeProject: nextProject,
        selectedTaskId: null,
        selectedDocumentId: null,
        libraryView: 'active',
        activeLibraryTags: [],
        libraryTagQuery: '',
        areLibraryTagsExpanded: false,
        documentDraftId: null,
        documentDraftBody: '',
        isDocumentDirty: false,
        documentSaveStatus: 'Saved',
        isDocumentFocusMode: false,
        isTaskFormOpen: false,
        isAdminPanelOpen: false,
        isDocumentFormOpen: false,
        isDocumentInfoEditorOpen: false,
        editingTaskId: null,
        editingDocumentId: null,
        formError: '',
        documentInfoError: '',
        isDrawerOpen: false,
        mobileDetailOpen: false,
        taskDetailOpen: false,
        isLibraryDocOpen: false,
        isLinkPickerOpen: false,
      });
      persistActiveProject(nextProject);
      try {
        if (state.activeView === 'library') {
          await loadDocuments({ selectedDocumentId: null });
        } else {
          await loadTasks({ selectedTaskId: null });
        }
      } catch (error) {
        setState({ apiStatus: 'error' });
        renderError(error.message);
      }
    });
  });

  app.querySelectorAll('[data-action="new-project"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const name = window.prompt('New project name');
      if (!name || !name.trim()) return;
      try {
        const project = await createProject(name.trim());
        await loadProjects();
        setState({ activeProject: project.id });
        persistActiveProject(project.id);
        if (state.activeView === 'library') await loadDocuments({ selectedDocumentId: null });
        else await loadTasks({ selectedTaskId: null });
      } catch {
        window.alert('Moomora Console could not create that project.');
      }
    });
  });

  app.querySelectorAll('[data-action="open-project-manager"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const managed = await fetchProjects('all');
        setState({ isProjectManagerOpen: true, managedProjects: managed, projectManagerError: '', isDrawerOpen: false });
        renderApp();
      } catch {
        window.alert('Moomora Console could not load projects.');
      }
    });
  });

  app.querySelectorAll('[data-action="open-archived-projects"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const managed = await fetchProjects('all');
        // Open the archive directly, with the manager layered underneath so the
        // dialog's [<] back returns to Manage rather than the bare app.
        setState({
          isProjectManagerOpen: true,
          isProjectArchiveOpen: true,
          managedProjects: managed,
          projectManagerError: '',
          isDrawerOpen: false,
        });
        renderApp();
      } catch {
        window.alert('Moomora Console could not load projects.');
      }
    });
  });

  app.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextView = button.dataset.view;
      if (!nextView || nextView === state.activeView) return;
      clearDocumentAutosave();
      const archiveModeChanged = isArchiveView(nextView) !== isArchiveView(state.activeView);
      const libraryModeChanged = nextView === 'library' || state.activeView === 'library';
      setState({
        activeView: nextView,
        selectedTaskId: null,
        selectedDocumentId: null,
        libraryView: 'active',
        activeLibraryTags: [],
        libraryTagQuery: '',
        areLibraryTagsExpanded: false,
        documentDraftId: null,
        documentDraftBody: '',
        isDocumentDirty: false,
        documentSaveStatus: 'Saved',
        isDocumentFocusMode: false,
        isTaskFormOpen: false,
        isAdminPanelOpen: false,
        isDocumentFormOpen: false,
        isDocumentInfoEditorOpen: false,
        editingTaskId: null,
        editingDocumentId: null,
        formError: '',
        documentInfoError: '',
        isDrawerOpen: false,
        mobileDetailOpen: false,
        taskDetailOpen: false,
        isLibraryDocOpen: false,
        isLinkPickerOpen: false,
      });
      if (nextView === 'library') {
        try {
          await loadDocuments({ selectedDocumentId: null });
        } catch (error) {
          setState({ apiStatus: 'error' });
          renderError(error.message);
        }
      } else if (archiveModeChanged || libraryModeChanged) {
        try {
          await loadTasks({ selectedTaskId: null });
        } catch (error) {
          setState({ apiStatus: 'error' });
          renderError(error.message);
        }
      } else {
        renderApp();
      }
    });
  });
}

function tagsFromFormValue(value) {
  return String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function bindDocumentFormEvents() {
  const form = app.querySelector('[data-document-form]');
  if (!form) return;

  app.querySelectorAll('[data-action="close-document-form"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({
        isDocumentFormOpen: false,
        editingDocumentId: null,
        documentFormError: '',
        isSaving: false,
      });
      renderApp();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim();
    if (!title) {
      setState({ documentFormError: 'Title is required.' });
      renderApp();
      return;
    }

    const payload = {
      title,
      body: String(data.get('body') || ''),
      documentType: String(data.get('documentType') || 'note'),
      project: String(data.get('project') || defaultProjectId()),
      tags: tagsFromFormValue(data.get('tags')),
      sourceFilename: String(data.get('sourceFilename') || '').trim() || null,
    };

    setState({ isSaving: true, documentFormError: '' });
    renderApp();

    try {
      const savedDocument = state.editingDocumentId
        ? await updateDocument(state.editingDocumentId, payload)
        : await createDocument(payload);

      const nextProject = savedDocument.projectId || state.activeProject;
      persistActiveProject(nextProject);
      setState({
        activeProject: nextProject,
        selectedDocumentId: savedDocument.id,
        libraryView: 'active',
        isDocumentFormOpen: false,
        editingDocumentId: null,
        isSaving: false,
        documentFormError: '',
      });
      await loadDocuments({ selectedDocumentId: savedDocument.id });
    } catch {
      setState({
        isSaving: false,
        documentFormError: state.editingDocumentId ? 'Moomora Console could not update this document.' : 'Moomora Console could not create this document.',
      });
      renderApp();
    }
  });
}

function exportLibraryDocument(documentId) {
  const doc = state.documents.find(d => d.id === documentId);
  if (!doc) return;
  const project = state.projects.find(p => p.id === doc.projectId);
  const slug = project?.slug || 'unknown';
  const markdown = buildExportedMarkdown(doc, slug);
  const blob = new Blob([markdown], { type: 'text/markdown' });
  libraryTriggerDownload(libraryDocumentFilename(doc), blob);
}

async function exportAdminTasks(project) {
  try {
    const exported = await exportTasks({ project });
    downloadJsonFile(exportFilename(project), exported);
  } catch {
    window.alert(project === 'all'
      ? 'Moomora Console could not export all projects.'
      : 'Moomora Console could not export this project.');
  }
}

function selectedAdminImportMode(panel) {
  const checked = panel.querySelector('[name="admin-import-mode"]:checked');
  try {
    return normalizeImportMode(checked?.value || state.adminImportMode);
  } catch {
    return 'skip';
  }
}

async function importAdminFile(file, panel) {
  const mode = selectedAdminImportMode(panel);
  const replaceConfirmation = panel.querySelector('[data-admin-replace-confirm]')?.value || '';
  if (mode === 'replace' && replaceConfirmation !== 'REPLACE') {
    window.alert('Type REPLACE before importing in replace mode.');
    return;
  }

  const importTarget = state.activeProject === 'all' ? state.projects[0]?.id : state.activeProject;
  if (!importTarget) {
    window.alert('Create a project before importing tasks.');
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    const tasks = tasksFromImportPayload(payload);
    const result = await importTasks({ project: importTarget, mode, tasks });
    const skipped = result.skipped ? ` Skipped ${result.skipped}.` : '';
    window.alert(`Imported ${result.imported} ${result.imported === 1 ? 'task' : 'tasks'}.${skipped}`);
    setState({ isAdminPanelOpen: false });
    await loadTasks({ selectedTaskId: null });
  } catch {
    window.alert('Moomora Console could not import that file.');
  }
}

async function importLibraryMarkdownFile(file) {
  const projectId = defaultProjectId();
  if (!projectId) {
    window.alert('Create a project before importing documents.');
    return;
  }
  try {
    const body = await file.text();
    const doc = await createDocument({
      title: titleFromMarkdown(body, file.name),
      body,
      documentType: 'note',
      project: projectId,
      tags: [],
      sourceFilename: file.name || null,
    });
    window.alert(`Imported "${doc.title}" into the Library.`);
    await loadDocuments({ selectedDocumentId: doc.id });
  } catch {
    window.alert('Moomora Console could not import that Markdown file.');
  }
}

function bindAdminPanelEvents() {
  const panel = app.querySelector('[data-admin-panel]');
  if (!panel) return;

  panel.querySelector('[data-action="close-admin"]')?.addEventListener('click', () => {
    setState({ isAdminPanelOpen: false });
    renderApp();
  });

  panel.querySelector('[data-action="export-project"]')?.addEventListener('click', () => {
    exportAdminTasks(state.activeProject);
  });

  panel.querySelector('[data-action="export-all"]')?.addEventListener('click', () => {
    exportAdminTasks('all');
  });

  panel.querySelector('[data-action="export-library-project"]')?.addEventListener('click', () => {
    const scope = state.activeProject === 'all'
      ? 'all'
      : (state.projects.find(p => p.id === state.activeProject)?.slug || 'all');
    window.location.href = `/api/library/export?project=${encodeURIComponent(scope)}`;
  });

  panel.querySelector('[data-action="export-library-all"]')?.addEventListener('click', () => {
    window.location.href = '/api/library/export?project=all';
  });

  panel.querySelectorAll('[data-admin-import-mode]').forEach((control) => {
    control.addEventListener('change', () => {
      setState({ adminImportMode: control.value });
    });
  });

  panel.querySelector('[data-admin-import-file]')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await importAdminFile(file, panel);
    event.target.value = '';
  });

  panel.querySelector('[data-action="open-archive"]')?.addEventListener('click', async () => {
    setState({
      activeView: 'archive',
      isAdminPanelOpen: false,
      isTaskFormOpen: false,
      selectedTaskId: null,
      editingTaskId: null,
      formError: '',
    });
    try {
      await loadTasks({ selectedTaskId: null });
    } catch (error) {
      setState({ apiStatus: 'error' });
      renderError(error.message);
    }
  });
}

async function refreshProjectManager() {
  const managed = await fetchProjects('all');
  await loadProjects();
  // The nav only shows active projects, so if the selected project is no
  // longer active (archived, on-hold, completed, or deleted) it can't be the
  // highlighted selection — reset to 'all' to keep nav and breadcrumb honest.
  if (state.activeProject !== 'all' && !state.projects.some((p) => p.id === state.activeProject)) {
    setState({ activeProject: 'all' });
    persistActiveProject('all');
  }
  setState({ managedProjects: managed });
  renderApp();
}

function bindProjectManagerEvents() {
  const panel = app.querySelector('[data-project-manager]');
  if (!panel) return;

  panel.querySelectorAll('[data-action="close-project-manager"]').forEach((button) => {
    button.addEventListener('click', async () => {
      setState({ isProjectManagerOpen: false, projectManagerError: '' });
      try {
        if (state.activeView === 'library') await loadDocuments({ selectedDocumentId: null });
        else await loadTasks({ selectedTaskId: null });
      } catch (error) {
        setState({ apiStatus: 'error' });
        renderError(error.message);
      }
    });
  });

  panel.querySelector('[data-action="manager-create"]')?.addEventListener('click', async () => {
    const name = panel.querySelector('[data-project-new-name]')?.value?.trim();
    if (!name) {
      setState({ projectManagerError: 'Project name is required.' });
      renderApp();
      return;
    }
    try {
      await createProject(name);
      await refreshProjectManager();
    } catch {
      setState({ projectManagerError: 'Could not create that project.' });
      renderApp();
    }
  });

  panel.querySelectorAll('[data-action="manager-save"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.projectId;
      const name = panel.querySelector(`[data-project-name="${id}"]`)?.value?.trim();
      const status = panel.querySelector(`[data-project-status="${id}"]`)?.value;
      if (!name) {
        setState({ projectManagerError: 'Project name is required.' });
        renderApp();
        return;
      }
      try {
        await updateProject(id, { name, status });
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not save that project.' });
        renderApp();
      }
    });
  });

  panel.querySelectorAll('[data-action="manager-delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.projectId;
      if (!window.confirm('Permanently delete this project? Only empty projects (no tasks or documents) can be deleted.')) return;
      try {
        await deleteProjectPermanent(id);
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not delete: the project still has tasks or documents.' });
        renderApp();
      }
    });
  });

  const move = async (id, direction) => {
    // Only live projects are shown in the manager, so reorder must ignore
    // archived rows — otherwise move up/down can swap with a hidden project.
    const ordered = state.managedProjects
      .filter((p) => p.status !== 'archived')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((p) => p.id === id);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return;
    const current = ordered[index];
    const neighbor = ordered[swapIndex];
    try {
      await updateProject(current.id, { sortOrder: neighbor.sortOrder });
      await updateProject(neighbor.id, { sortOrder: current.sortOrder });
      await refreshProjectManager();
    } catch {
      setState({ projectManagerError: 'Could not reorder projects.' });
      renderApp();
    }
  };
  panel.querySelectorAll('[data-action="manager-move-up"]').forEach((button) => {
    button.addEventListener('click', () => move(button.dataset.projectId, 'up'));
  });
  panel.querySelectorAll('[data-action="manager-move-down"]').forEach((button) => {
    button.addEventListener('click', () => move(button.dataset.projectId, 'down'));
  });

  panel.querySelectorAll('[data-action="manager-archive"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await archiveProject(button.dataset.projectId);
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not archive that project.' });
        renderApp();
      }
    });
  });

  panel.querySelector('[data-action="open-project-archive"]')?.addEventListener('click', () => {
    setState({ isProjectArchiveOpen: true, projectManagerError: '' });
    renderApp();
  });
}

function bindProjectArchiveEvents() {
  const panel = app.querySelector('[data-project-archive]');
  if (!panel) return;

  panel.querySelectorAll('[data-action="back-to-manager"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({ isProjectArchiveOpen: false, projectManagerError: '' });
      renderApp();
    });
  });
  panel.querySelector('[data-action="close-project-archive"]')?.addEventListener('click', () => {
    setState({ isProjectArchiveOpen: false, isProjectManagerOpen: false, projectManagerError: '' });
    renderApp();
  });

  panel.querySelectorAll('[data-action="archive-restore"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await updateProject(button.dataset.projectId, { status: 'active' });
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not restore that project.' });
        renderApp();
      }
    });
  });

  panel.querySelectorAll('[data-action="archive-delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('Permanently delete this archived project? Only empty projects can be deleted.')) return;
      try {
        await deleteProjectPermanent(button.dataset.projectId);
        await refreshProjectManager();
      } catch {
        setState({ projectManagerError: 'Could not delete: the project still has tasks or documents.' });
        renderApp();
      }
    });
  });
}

function updatePreferences(nextPreferences) {
  const preferences = savePreferences(nextPreferences);
  applyPreferences(preferences);
  setState({ preferences });
}

function bindSettingsPanelEvents() {
  const panel = app.querySelector('[data-settings-panel]');
  if (!panel) return;

  panel.querySelector('[data-action="close-settings"]')?.addEventListener('click', () => {
    setState({ isSettingsPanelOpen: false });
    renderApp();
  });

  panel.querySelectorAll('[data-settings-section]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({ settingsSection: button.dataset.settingsSection || 'appearance' });
      renderApp();
    });
  });

  panel.querySelectorAll('[data-settings-font-scale]').forEach((button) => {
    button.addEventListener('click', () => {
      updatePreferences({
        ...state.preferences,
        fontScale: button.dataset.settingsFontScale,
      });
      renderApp();
    });
  });

  panel.querySelectorAll('[data-settings-palette]').forEach((button) => {
    button.addEventListener('click', () => {
      updatePreferences({
        ...state.preferences,
        palette: button.dataset.settingsPalette,
      });
      renderApp();
    });
  });

  panel.querySelectorAll('[data-settings-board-density]').forEach((button) => {
    button.addEventListener('click', () => {
      updatePreferences({
        ...state.preferences,
        boardDensity: button.dataset.settingsBoardDensity,
      });
      renderApp();
    });
  });

  panel.querySelector('[data-action="reset-preferences"]')?.addEventListener('click', () => {
    const preferences = resetPreferences();
    applyPreferences(preferences);
    setState({ preferences, settingsSection: 'appearance' });
    renderApp();
  });
}

function bindLinkPickerEvents() {
  const backdrop = app.querySelector('[data-link-picker]');
  if (!backdrop) return;

  backdrop.querySelectorAll('[data-action="close-link-picker"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ isLinkPickerOpen: false });
      renderApp();
    });
  });

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      setState({ isLinkPickerOpen: false });
      renderApp();
    }
  });

  const searchInput = backdrop.querySelector('[data-link-picker-search]');
  searchInput?.addEventListener('input', (event) => {
    setState({ linkPickerQuery: event.target.value });
    renderApp();
    const nextInput = app.querySelector('[data-link-picker-search]');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange?.(nextInput.value.length, nextInput.value.length);
    }
  });

  backdrop.querySelectorAll('[data-link-picker-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = state.selectedTaskId;
      if (!taskId) return;
      const docId = btn.dataset.linkPickerDoc;
      const isLinked = state.taskDocuments.some(d => d.id === docId);
      try {
        const updated = isLinked
          ? await unlinkTaskDocument(taskId, docId)
          : await linkTaskDocument(taskId, docId);
        setState({ taskDocuments: updated });
        clearTaskBoardExtra(taskId);
        renderApp();
      } catch {
        window.alert('Moomora Console could not update the document link.');
      }
    });
  });
}

function bindTaskFormEvents() {
  const form = app.querySelector('[data-task-form]');
  if (!form) return;

  app.querySelectorAll('[data-action="close-task-form"]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({
        isTaskFormOpen: false,
        editingTaskId: null,
        formError: '',
        isSaving: false,
      });
      renderApp();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim();
    if (!title) {
      setState({ formError: 'Title is required.' });
      renderApp();
      return;
    }

    const payload = {
      title,
      description: String(data.get('description') || '').trim(),
      notes: String(data.get('notes') || '').trim(),
      priority: String(data.get('priority') || 'medium'),
      status: String(data.get('status') || 'planned'),
      project: String(data.get('project') || defaultProjectId()),
      dueDate: String(data.get('dueDate') || '') || null,
    };

    setState({ isSaving: true, formError: '' });
    renderApp();

    try {
      const savedTask = state.editingTaskId
        ? await updateTask(state.editingTaskId, payload)
        : await createTask({ ...payload, sortOrder: state.tasks.length });

      const nextProject = savedTask.projectId || state.activeProject;
      persistActiveProject(nextProject);
      setState({
        activeProject: nextProject,
        selectedTaskId: savedTask.id,
        isTaskFormOpen: false,
        editingTaskId: null,
        isSaving: false,
        formError: '',
      });
      await loadTasks({ selectedTaskId: savedTask.id });
      await loadTaskActivity(state.selectedTaskId);
    } catch {
      setState({
        isSaving: false,
        formError: state.editingTaskId ? 'Moomora Console could not update this task.' : 'Moomora Console could not create this task.',
      });
      renderApp();
    }
  });
}

async function loadProjects() {
  const projects = await fetchProjects('active');
  setState({ projects });
  return projects;
}

function defaultProjectId() {
  return state.activeProject !== 'all' ? state.activeProject : (state.projects[0]?.id || '');
}

async function loadTasks({ selectedTaskId = state.selectedTaskId } = {}) {
  setState({ apiStatus: 'loading' });
  renderLoading();
  const tasks = await fetchTasks({
    project: state.activeProject === 'all' ? undefined : state.activeProject,
    archived: isArchiveView(state.activeView) ? true : undefined,
  });
  const normalizedTasks = tasks.map(normalizeTask);
  const selectedTaskExists = normalizedTasks.some((task) => task.id === selectedTaskId);
  const resolvedTaskId = selectedTaskExists ? selectedTaskId : normalizedTasks[0]?.id || null;
  const resolvedTask = normalizedTasks.find((task) => task.id === resolvedTaskId) || null;
  setState({
    tasks: normalizedTasks,
    apiStatus: 'connected',
    selectedTaskId: resolvedTaskId,
    taskNotesDraftId: resolvedTaskId,
    taskNotesDraft: resolvedTask?.notes || '',
    isTaskNotesDirty: false,
    taskNotesSavedAt: '',
  });
  await loadTaskDocuments(resolvedTaskId);
  await loadTaskChecklist(resolvedTaskId);
  await loadTaskActivity(resolvedTaskId);
  renderApp();
}

async function loadDocuments({ selectedDocumentId = state.selectedDocumentId } = {}) {
  setState({ apiStatus: 'loading' });
  renderLoading();
  const documents = await fetchDocuments({
    project: state.activeProject === 'all' ? undefined : state.activeProject,
    archived: state.libraryView === 'archive' ? true : undefined,
  });
  const selectedDocumentExists = documents.some(document => document.id === selectedDocumentId);
  const patch = {
    documents,
    apiStatus: 'connected',
    selectedDocumentId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftBody: (selectedDocumentExists ? documents.find(document => document.id === selectedDocumentId) : documents[0])?.body || '',
    isDocumentDirty: false,
  };
  if (state.libraryView === 'active') {
    patch.libraryActiveDocumentCount = documents.length;
  }
  setState(patch);
  renderApp();
}

async function init() {
  try {
    const preferences = applyPreferences(loadPreferences());
    setState({
      preferences,
      boardGrouping: loadBoardGrouping(),
      listGrouping: loadListGrouping(),
      librarySavedViews: savedLibraryViewsFromJson(window.localStorage?.getItem(SAVED_LIBRARY_VIEWS_KEY)),
      ...loadLibraryControls(),
    });
    await loadProjects();
    const stored = loadActiveProject();
    const valid = stored === 'all' || state.projects.some((p) => p.id === stored);
    setState({ activeProject: valid ? stored : 'all' });
    await loadTasks();
  } catch (error) {
    setState({ apiStatus: 'error' });
    renderError(error.message);
  }

  installKeyboardShortcuts({
    getState: () => state,
    handlers: {
      focusSearch() {
        const input = app.querySelector('[data-search-input]');
        if (input) { input.focus(); input.select?.(); }
      },
      newItem() {
        app.querySelector('.topbar [data-action="new-task"], .topbar [data-action="new-document"]')?.click();
      },
      switchView(view) {
        const el = app.querySelector(`.side-nav [data-view="${view}"]`) || app.querySelector(`[data-view="${view}"]`);
        el?.click();
      },
      editSelected() {
        if (state.activeView === 'library') {
          app.querySelector('[data-library-mode="edit"]')?.click();
        } else {
          app.querySelector('[data-action="edit-task"]')?.click();
        }
      },
      archiveSelected() {
        if (state.activeView === 'library') {
          app.querySelector('[data-action="archive-document"]')?.click();
        } else {
          app.querySelector('[data-action="archive-task"]')?.click();
        }
      },
      escape() {
        // The archive dialog mounts on top of the manager, so handle it first:
        // Escape backs out of the archive before closing the manager beneath it.
        if (state.isProjectArchiveOpen) { app.querySelector('[data-action="back-to-manager"]')?.click(); return; }
        const closer = app.querySelector('[data-action="close-task-form"], [data-action="close-document-form"], [data-action="close-admin"], [data-action="close-settings"], [data-action="close-link-picker"], [data-action="close-project-manager"]');
        if (closer) { closer.click(); return; }
        if (state.isDrawerOpen) { app.querySelector('[data-action="toggle-drawer"]')?.click(); return; }
        if (state.taskDetailOpen) { setState({ taskDetailOpen: false, mobileDetailOpen: false }); renderWorkspace(); return; }
        if (state.mobileDetailOpen) { app.querySelector('[data-action="close-mobile-detail"]')?.click(); return; }
        if (state.isLibraryDocOpen) { app.querySelector('[data-action="close-library-doc"]')?.click(); return; }
      },
    },
  });
}

init();
