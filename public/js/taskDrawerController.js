// Task drawer — controller for the open task's context and field actions:
// its linked documents, checklist, activity and related-knowledge
// suggestions (loaded after the drawer renders, stale loads dropped), the
// status / priority / recurrence / due / snooze / label fields, links and the
// working note. The drawer's text draft (title, description, notes) and its
// autosave stay in main.js with the render continuity they depend on.
// Dependencies are injected (inboxController.js pattern); handleAction
// delegates the drawer data-actions here.

import {
  fetchTaskDocuments as apiFetchTaskDocuments, fetchTaskChecklist as apiFetchTaskChecklist,
  fetchTaskActivity as apiFetchTaskActivity, fetchRelatedDocuments as apiFetchRelatedDocuments,
  addChecklistItem as apiAddChecklistItem, setChecklistItem as apiSetChecklistItem,
  deleteChecklistItem as apiDeleteChecklistItem, linkTaskDocument as apiLinkTaskDocument,
  unlinkTaskDocument as apiUnlinkTaskDocument,
} from './taskApi.js';
import { fetchDocuments as apiFetchDocuments, createDocument as apiCreateDocument } from './libraryApi.js';
import { clearTaskBoardExtra } from './boardExtras.js';
import { normalizeLabel } from './labels.js';

export function createTaskDrawerController({
  getState, setState, renderApp, showToast, alertError, getRoot, taskById, patchTask, projectsById,
  loadDocuments, openDocumentInEditor, flushTaskDrawerDraft, archiveTaskWithUndo,
  fetchTaskDocuments = apiFetchTaskDocuments, fetchTaskChecklist = apiFetchTaskChecklist,
  fetchTaskActivity = apiFetchTaskActivity, fetchRelatedDocuments = apiFetchRelatedDocuments,
  addChecklistItem = apiAddChecklistItem, setChecklistItem = apiSetChecklistItem,
  deleteChecklistItem = apiDeleteChecklistItem, linkTaskDocument = apiLinkTaskDocument,
  unlinkTaskDocument = apiUnlinkTaskDocument, fetchDocuments = apiFetchDocuments, createDocument = apiCreateDocument,
}) {
  let drawerContextToken = 0;       // a late task-context load cannot replace a newer drawer

  async function loadDrawerContext(taskId) {
    const state = getState();
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
    const state = getState();
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

  // Snooze target for a preset: tomorrow / next week, at 9am local so the task
  // reappears in the morning rather than at midnight. Returns an ISO timestamp.
  function snoozeUntil(preset) {
    const d = new Date();
    d.setDate(d.getDate() + (preset === 'week' ? 7 : 1));
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  // Add a normalized label to the open task (deduped). Shares the label
  // convention with the server and the filter grammar via normalizeLabel.
  async function addTaskLabel(raw) {
    const state = getState();
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

  // A working note for the open task: create, link, open. The create is the
  // commitment: once it succeeds, a failed link or open is reported as such —
  // never as a failed create, which would invite a retry and a second note.
  // One create per task at a time (a double click creates one note).
  const workingNotePending = new Set();
  // In-flight creates, so a repeated Enter or a double click creates one item.
  const checklistAddPending = new Set(); // task ids
  async function startWorkingNote(taskId) {
    const state = getState();
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task || workingNotePending.has(taskId)) return;
    const project = projectsById()[task.projectId];
    workingNotePending.add(taskId);
    try {
      let doc;
      try {
        doc = await createDocument({
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
      } catch (err) {
        showToast(err?.message || 'Could not create the working note.');
        return;
      }
      let linked = true;
      try { await linkTaskDocument(taskId, doc.id); } catch { linked = false; }
      let opened = false;
      try {
        await loadDocuments();
        opened = await openDocumentInEditor(doc.id);
      } catch { opened = false; }
      if (linked && opened) { showToast('Working note created and linked.'); return; }
      const problem = !linked && !opened ? 'could not link it to the task or open it'
        : (!linked ? 'could not link it to the task' : 'could not open it');
      showToast(`Working note created, but Prax ${problem}. It is in the Library as “${doc.title || 'Working note'}”.`, null, 8000);
    } finally {
      workingNotePending.delete(taskId);
    }
  }

  // The link picker in link mode toggles a document's link to the open task.
  async function toggleDocumentLink(documentId) {
    const state = getState();
    try {
      const alreadyLinked = state.taskDocuments.some(d => d.id === documentId);
      const documents = alreadyLinked
        ? await unlinkTaskDocument(state.drawerTaskId, documentId)
        : await linkTaskDocument(state.drawerTaskId, documentId);
      setState({ taskDocuments: documents, ...clearTaskBoardExtra(state, state.drawerTaskId) });
    } catch { alertError('update the document link'); }
    renderApp();
  }

  const actions = {
    'set-task-status': async (el) => {
      const state = getState();
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
    },
    'set-task-priority': async (el) => {
      const state = getState();
      await patchTask(state.drawerTaskId, { priority: el.dataset.priority });
    },
    'set-task-recurrence': async (el) => {
      const state = getState();
      await patchTask(state.drawerTaskId, { recurrence: el.dataset.recurrence });
    },
    'remove-task-label': async (el) => {
      const state = getState();
      const task = taskById(state.drawerTaskId);
      if (task) await patchTask(state.drawerTaskId, { labels: (task.labels || []).filter(l => l !== el.dataset.label) });
    },
    'clear-task-due': async () => {
      const state = getState();
      await patchTask(state.drawerTaskId, { dueDate: null, dueTime: null });
    },
    'snooze-task': async (el) => {
      const state = getState();
      await patchTask(el.dataset.taskId || state.drawerTaskId, { deferredUntil: snoozeUntil(el.dataset.snooze) }, { failure: 'snooze the task' });
      renderApp();
    },
    'unsnooze-task': async (el) => {
      const state = getState();
      await patchTask(el.dataset.taskId || state.drawerTaskId, { deferredUntil: '' }, { failure: 'unsnooze the task' });
      renderApp();
    },
    'add-checklist-item': async () => {
      const state = getState();
      const input = getRoot().querySelector('[data-checklist-new]');
      const label = (input?.value || '').trim();
      const taskId = state.drawerTaskId;
      // One add per task at a time: a second Enter or click while the first
      // POST is in flight would otherwise create the same item twice.
      if (!label || !taskId || checklistAddPending.has(taskId)) return;
      checklistAddPending.add(taskId);
      try {
        try {
          await addChecklistItem(taskId, label);
        } catch { alertError('add the checklist item'); renderApp(); return; }
        // The field's text lives only in the DOM; clear the added item so the
        // render does not carry it into the next one.
        const current = getRoot().querySelector('[data-checklist-new]');
        if (current && current.value.trim() === label) current.value = '';
        // The item is saved; a failed refetch is not a failed add.
        try {
          const checklist = await fetchTaskChecklist(taskId);
          if (state.drawerTaskId === taskId) setState({ taskChecklist: checklist });
          setState(clearTaskBoardExtra(state, taskId));
        } catch { showToast('Checklist item added, but the checklist could not refresh. Reopen the task to see it.', null, 7000); }
        renderApp();
      } finally {
        checklistAddPending.delete(taskId);
      }
    },
    'toggle-checklist-item': async (el, event) => {
      const state = getState();
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
    },
    'delete-checklist-item': async (el, event) => {
      const state = getState();
      event.stopPropagation();
      try {
        await deleteChecklistItem(state.drawerTaskId, el.dataset.itemId);
        setState({
          taskChecklist: await fetchTaskChecklist(state.drawerTaskId),
          ...clearTaskBoardExtra(state, state.drawerTaskId),
        });
      } catch { alertError('delete the checklist item'); }
      renderApp();
    },
    'open-linked-doc': async (el, event) => {
      event.stopPropagation();
      if (!(await flushTaskDrawerDraft())) {
        showToast('Save this task draft before opening its linked document.');
        return;
      }
      setState({ drawerTaskId: null, taskNotesDraftId: null, taskLabelDraftId: null, taskLabelDraft: '' });
      await openDocumentInEditor(el.dataset.documentId);
    },
    'unlink-task-document': async (el, event) => {
      const state = getState();
      event.stopPropagation();
      try {
        const documents = await unlinkTaskDocument(state.drawerTaskId, el.dataset.documentId);
        setState({ taskDocuments: documents, ...clearTaskBoardExtra(state, state.drawerTaskId) });
      } catch { alertError('unlink the document'); }
      renderApp();
    },
    'open-link-picker': async () => {
      try {
        const documents = await fetchDocuments({ archived: false });
        setState({ isLinkPickerOpen: true, pickerMode: 'link', linkPickerDocuments: documents, linkPickerQuery: '' });
      } catch { alertError('load documents to link'); }
      renderApp();
    },
    'close-link-picker': () => {
      setState({ isLinkPickerOpen: false }); renderApp();
    },
    'archive-task': () => {
      const state = getState();
      archiveTaskWithUndo(state.drawerTaskId);
    },
    'link-related-doc': async (el, event) => {
      const state = getState();
      event.stopPropagation();
      const documentId = el.dataset.documentId;
      const taskId = state.drawerTaskId;
      if (!documentId || !taskId) return;
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
    },
    'dismiss-related-doc': (el, event) => {
      const state = getState();
      event.stopPropagation();
      const documentId = el.dataset.documentId;
      const taskId = state.drawerTaskId;
      if (!documentId || !taskId) return;
      relatedDismissed.add(`${taskId}:${documentId}`);
      if (state.taskRelatedDocs?.taskId === taskId) {
        setState({ taskRelatedDocs: { ...state.taskRelatedDocs, suggestions: state.taskRelatedDocs.suggestions.filter((doc) => doc.id !== documentId) } });
      }
      renderApp();
    },
    'start-working-note': async () => {
      const state = getState();
      await startWorkingNote(state.drawerTaskId);
    },
  };

  return { actions, loadDrawerContext, addTaskLabel, startWorkingNote, toggleDocumentLink, snoozeUntil };
}
