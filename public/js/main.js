import { state, setState } from './state.js';
import {
  archiveTask,
  createTask,
  deleteArchivedTask,
  exportTasks,
  fetchTasks,
  importTasks,
  reorderTasks,
  restoreTask,
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
import { renderListHtml } from './renderList.js';
import { renderBoardHtml } from './renderBoard.js';
import { renderTaskDetailHtml } from './renderTaskDetail.js';
import { renderTaskFormHtml } from './renderTaskForm.js';
import { renderAdminPanelHtml } from './renderAdminPanel.js';
import { renderDocumentFormHtml, renderLibraryHtml } from './renderLibrary.js';
import { titleFromMarkdown } from './markdownPreview.js';
import { filterDocumentsByTags, tagsForDocuments } from './libraryFilters.js';
import {
  areSameTags,
  createSavedLibraryView,
  renameSavedLibraryView,
  savedLibraryViewsFromJson,
} from './librarySavedViews.js';

const app = document.getElementById('app');
const SAVED_LIBRARY_VIEWS_KEY = 'taskboard.librarySavedViews.v1';

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderLoading() {
  app.innerHTML = '<main class="loading">Loading TaskBoard...</main>';
}

function renderError(message) {
  const error = document.createElement('main');
  error.className = 'loading';
  error.textContent = `TaskBoard could not load: ${message}`;
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
  const contextDocuments = state.documents.filter(document => document.context === state.activeContext);
  const taggedDocuments = filterDocumentsByTags(contextDocuments, state.activeLibraryTags);
  if (!query) return taggedDocuments;
  return taggedDocuments.filter((document) => [
    document.title,
    document.body,
    document.documentType,
    document.sourceFilename,
    ...(document.tags || []),
  ].some(value => String(value || '').toLowerCase().includes(query)));
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

function activeSavedLibraryViewId() {
  const matchingView = state.librarySavedViews.find(view => areSameTags(view.tags, state.activeLibraryTags));
  return matchingView?.id || null;
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

  workspace.innerHTML = [
    renderWorkspacePrimary(visibleTasks, selectedTaskId),
    renderTaskDetailHtml(task, { readOnly, restoreAction: readOnly, deleteAction: readOnly }),
  ].join('');

  workspace.querySelectorAll('[data-task-id]').forEach((row) => {
    row.addEventListener('click', () => {
      setState({ selectedTaskId: row.dataset.taskId });
      renderWorkspace();
    });
  });

  bindBoardEvents(workspace);

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
      window.alert('TaskBoard could not archive the selected task.');
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
      window.alert('TaskBoard could not restore the selected task.');
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
      window.alert('TaskBoard could not delete the archived task.');
    }
  });
}

function renderLibraryWorkspace(workspace) {
  const contextDocuments = state.documents.filter(document => document.context === state.activeContext);
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
  });

  function resetDocumentDraft() {
    return {
      selectedDocumentId: null,
      documentDraftId: null,
      documentDraftBody: '',
      isDocumentDirty: false,
    };
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
      setState({
        selectedDocumentId: row.dataset.libraryDocumentId,
        documentDraftId: nextDocument?.id || null,
        documentDraftBody: nextDocument?.body || '',
        isDocumentDirty: false,
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
    const documentToEdit = selectedDocument();
    if (!documentToEdit) return;
    setState({
      documentDraftId: documentToEdit.id,
      documentDraftBody: event.target.value,
      isDocumentDirty: event.target.value !== (documentToEdit.body || ''),
    });
    const status = workspace.querySelector('.document-pane-header span');
    const saveButton = workspace.querySelector('[data-action="save-document-draft"]');
    if (status) status.textContent = state.isDocumentDirty ? 'Unsaved changes' : 'Saved';
    if (saveButton) saveButton.disabled = !state.isDocumentDirty;
  });

  workspace.querySelector('[data-action="save-document-draft"]')?.addEventListener('click', async () => {
    const documentToSave = selectedDocument();
    if (!documentToSave || !state.isDocumentDirty) return;

    try {
      const savedDocument = await updateDocument(documentToSave.id, { body: state.documentDraftBody });
      setState({
        documents: state.documents.map(document => document.id === savedDocument.id ? savedDocument : document),
        selectedDocumentId: savedDocument.id,
        documentDraftId: savedDocument.id,
        documentDraftBody: savedDocument.body || '',
        isDocumentDirty: false,
      });
      renderWorkspace();
    } catch {
      window.alert('TaskBoard could not save this document.');
    }
  });

  workspace.querySelector('[data-action="edit-document"]')?.addEventListener('click', () => {
    setState({ documentEditorMode: 'edit' });
    renderWorkspace();
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
      window.alert('TaskBoard could not archive the selected document.');
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
      window.alert('TaskBoard could not restore the selected document.');
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
      window.alert('TaskBoard could not delete the archived document.');
    }
  });
}

function bindBoardEvents(workspace) {
  if (state.activeView !== 'board') return;

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
  renderWorkspace();

  try {
    await reorderTasks(result.updates);
    await loadTasks({ selectedTaskId: taskId });
  } catch {
    window.alert('TaskBoard could not save the board move.');
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
      emptyDescription: 'Archived work for this context will appear here.',
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
    return renderBoardHtml(visibleTasks, selectedTaskId);
  }

  return renderListHtml(visibleTasks, selectedTaskId, listOptionsForView(state.activeView));
}

function renderApp() {
  const metrics = buildMetrics(state.tasks, today());
  app.innerHTML = renderShellHtml({
    activeContext: state.activeContext,
    activeView: state.activeView,
    apiStatus: state.apiStatus,
    searchQuery: state.searchQuery,
    metrics,
  });
  renderWorkspace();
  if (state.isTaskFormOpen) {
    app.insertAdjacentHTML('beforeend', renderTaskFormHtml({
      task: editingTask(),
      activeContext: state.activeContext,
      error: state.formError,
      isSaving: state.isSaving,
    }));
  }
  if (state.isDocumentFormOpen) {
    app.insertAdjacentHTML('beforeend', renderDocumentFormHtml({
      document: editingDocument(),
      activeContext: state.activeContext,
      error: state.documentFormError,
      isSaving: state.isSaving,
    }));
  }
  if (state.isAdminPanelOpen) {
    app.insertAdjacentHTML('beforeend', renderAdminPanelHtml({
      activeContext: state.activeContext,
      taskCount: state.tasks.length,
      importMode: state.adminImportMode,
    }));
  }
  bindShellEvents();
  bindTaskFormEvents();
  bindDocumentFormEvents();
  bindAdminPanelEvents();
}

function bindShellEvents() {
  app.querySelector('[data-action="new-task"]')?.addEventListener('click', () => {
    setState({
      isTaskFormOpen: true,
      editingTaskId: null,
      formError: '',
    });
    renderApp();
  });

  app.querySelector('[data-action="new-document"]')?.addEventListener('click', () => {
    setState({
      isDocumentFormOpen: true,
      editingDocumentId: null,
      documentFormError: '',
    });
    renderApp();
  });

  app.querySelector('[data-action="open-admin"]')?.addEventListener('click', () => {
    setState({
      isAdminPanelOpen: true,
      isTaskFormOpen: false,
      editingTaskId: null,
    });
    renderApp();
  });

  app.querySelector('[data-search-input]')?.addEventListener('input', (event) => {
    setState({ searchQuery: event.target.value });
    renderWorkspace();
  });

  app.querySelectorAll('[data-context]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextContext = button.dataset.context;
      if (!nextContext || nextContext === state.activeContext) return;
      setState({
        activeContext: nextContext,
        selectedTaskId: null,
        selectedDocumentId: null,
        activeLibraryTags: [],
        libraryTagQuery: '',
        areLibraryTagsExpanded: false,
        documentDraftId: null,
        documentDraftBody: '',
        isDocumentDirty: false,
        isTaskFormOpen: false,
        isAdminPanelOpen: false,
        isDocumentFormOpen: false,
        editingTaskId: null,
        editingDocumentId: null,
        formError: '',
      });
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

  app.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextView = button.dataset.view;
      if (!nextView || nextView === state.activeView) return;
      const archiveModeChanged = isArchiveView(nextView) !== isArchiveView(state.activeView);
      const libraryModeChanged = nextView === 'library' || state.activeView === 'library';
      setState({
        activeView: nextView,
        selectedTaskId: null,
        selectedDocumentId: null,
        activeLibraryTags: [],
        libraryTagQuery: '',
        areLibraryTagsExpanded: false,
        documentDraftId: null,
        documentDraftBody: '',
        isDocumentDirty: false,
        isTaskFormOpen: false,
        isAdminPanelOpen: false,
        isDocumentFormOpen: false,
        editingTaskId: null,
        editingDocumentId: null,
        formError: '',
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
      context: String(data.get('context') || state.activeContext),
      tags: tagsFromFormValue(data.get('tags')),
      sourceFilename: String(data.get('sourceFilename') || '').trim() || null,
    };

    setState({ isSaving: true, documentFormError: '' });
    renderApp();

    try {
      const savedDocument = state.editingDocumentId
        ? await updateDocument(state.editingDocumentId, payload)
        : await createDocument(payload);

      setState({
        activeContext: savedDocument.context || payload.context,
        selectedDocumentId: savedDocument.id,
        isDocumentFormOpen: false,
        editingDocumentId: null,
        isSaving: false,
        documentFormError: '',
      });
      await loadDocuments({ selectedDocumentId: savedDocument.id });
    } catch {
      setState({
        isSaving: false,
        documentFormError: state.editingDocumentId ? 'TaskBoard could not update this document.' : 'TaskBoard could not create this document.',
      });
      renderApp();
    }
  });
}

async function exportAdminTasks(context) {
  try {
    const exported = await exportTasks({ context });
    downloadJsonFile(exportFilename(context), exported);
  } catch {
    window.alert(context === 'all'
      ? 'TaskBoard could not export all contexts.'
      : 'TaskBoard could not export this context.');
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

  try {
    const payload = JSON.parse(await file.text());
    const tasks = tasksFromImportPayload(payload);
    const result = await importTasks({ context: state.activeContext, mode, tasks });
    const skipped = result.skipped ? ` Skipped ${result.skipped}.` : '';
    window.alert(`Imported ${result.imported} ${result.imported === 1 ? 'task' : 'tasks'}.${skipped}`);
    setState({ isAdminPanelOpen: false });
    await loadTasks({ selectedTaskId: null });
  } catch {
    window.alert('TaskBoard could not import that file.');
  }
}

function selectedAdminMarkdownType(panel) {
  const checked = panel.querySelector('[name="admin-markdown-type"]:checked');
  return checked?.value === 'runbook' ? 'runbook' : 'note';
}

async function importAdminMarkdownFile(file, panel) {
  try {
    const body = await file.text();
    const document = await createDocument({
      title: titleFromMarkdown(body, file.name),
      body,
      documentType: selectedAdminMarkdownType(panel),
      context: state.activeContext,
      tags: [],
      sourceFilename: file.name || null,
    });
    window.alert(`Imported "${document.title}" into the Library.`);
    setState({ isAdminPanelOpen: false });
    if (state.activeView === 'library') {
      await loadDocuments({ selectedDocumentId: document.id });
    } else {
      renderApp();
    }
  } catch {
    window.alert('TaskBoard could not import that Markdown file.');
  }
}

function bindAdminPanelEvents() {
  const panel = app.querySelector('[data-admin-panel]');
  if (!panel) return;

  panel.querySelector('[data-action="close-admin"]')?.addEventListener('click', () => {
    setState({ isAdminPanelOpen: false });
    renderApp();
  });

  panel.querySelector('[data-action="export-context"]')?.addEventListener('click', () => {
    exportAdminTasks(state.activeContext);
  });

  panel.querySelector('[data-action="export-all"]')?.addEventListener('click', () => {
    exportAdminTasks('all');
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

  panel.querySelector('[data-admin-markdown-file]')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await importAdminMarkdownFile(file, panel);
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
      priority: String(data.get('priority') || 'medium'),
      status: String(data.get('status') || 'planned'),
      context: String(data.get('context') || state.activeContext),
      dueDate: String(data.get('dueDate') || '') || null,
    };

    setState({ isSaving: true, formError: '' });
    renderApp();

    try {
      const savedTask = state.editingTaskId
        ? await updateTask(state.editingTaskId, payload)
        : await createTask({ ...payload, sortOrder: state.tasks.length });

      setState({
        activeContext: savedTask.context || payload.context,
        selectedTaskId: savedTask.id,
        isTaskFormOpen: false,
        editingTaskId: null,
        isSaving: false,
        formError: '',
      });
      await loadTasks({ selectedTaskId: savedTask.id });
    } catch {
      setState({
        isSaving: false,
        formError: state.editingTaskId ? 'TaskBoard could not update this task.' : 'TaskBoard could not create this task.',
      });
      renderApp();
    }
  });
}

async function loadTasks({ selectedTaskId = state.selectedTaskId } = {}) {
  setState({ apiStatus: 'loading' });
  renderLoading();
  const tasks = await fetchTasks({
    context: state.activeContext,
    archived: isArchiveView(state.activeView) ? true : undefined,
  });
  const normalizedTasks = tasks.map(normalizeTask);
  const selectedTaskExists = normalizedTasks.some((task) => task.id === selectedTaskId);
  setState({
    tasks: normalizedTasks,
    apiStatus: 'connected',
    selectedTaskId: selectedTaskExists ? selectedTaskId : normalizedTasks[0]?.id || null,
  });
  renderApp();
}

async function loadDocuments({ selectedDocumentId = state.selectedDocumentId } = {}) {
  setState({ apiStatus: 'loading' });
  renderLoading();
  const documents = await fetchDocuments({
    context: state.activeContext,
    archived: 'all',
  });
  const selectedDocumentExists = documents.some(document => document.id === selectedDocumentId);
  setState({
    documents,
    apiStatus: 'connected',
    selectedDocumentId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftId: selectedDocumentExists ? selectedDocumentId : documents[0]?.id || null,
    documentDraftBody: (selectedDocumentExists ? documents.find(document => document.id === selectedDocumentId) : documents[0])?.body || '',
    isDocumentDirty: false,
  });
  renderApp();
}

async function init() {
  try {
    setState({
      librarySavedViews: savedLibraryViewsFromJson(window.localStorage?.getItem(SAVED_LIBRARY_VIEWS_KEY)),
    });
    await loadTasks();
  } catch (error) {
    setState({ apiStatus: 'error' });
    renderError(error.message);
  }
}

init();
