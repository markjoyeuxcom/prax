// Templates & guides studio — controller: review a starter or a template
// document, choose a destination and title, and create a copy (a document or
// an onboarding task) under one durable creation identity kept in session
// storage, so a retry after an interrupted request checks the same creation
// instead of making another copy. Dependencies are injected
// (inboxController.js pattern); handleAction delegates the studio actions.

import {
  templateChoices, buildTemplateJob, executeTemplateJob, saveTemplateDraft, loadTemplateDraft, clearTemplateDraft,
} from './templateUse.js';
import {
  fetchDocuments as apiFetchDocuments, fetchDocument as apiFetchDocument, createDocument as apiCreateDocument,
} from './libraryApi.js';
import { importTasks as apiImportTasks, fetchTask as apiFetchTask } from './taskApi.js';
import { normalizeTask } from './taskModel.js';
import { KEY_CONSUMED } from './keyboardDispatcher.js';

export function createTemplateStudioController({
  getState, setState, renderApp, showToast, openConfirm, getRoot, prepareEditorNavigation, defaultProjectId,
  markdownImportProjects, loadDocuments, loadTasks, openDocumentInEditor, openTaskDrawer,
  fetchStarters = () => globalThis.fetch('/api/library/starters'),
  fetchDocuments = apiFetchDocuments, fetchDocument = apiFetchDocument, createDocument = apiCreateDocument,
  importTasks = apiImportTasks, fetchTask = apiFetchTask, randomUUID = () => globalThis.crypto.randomUUID(),
  storage = () => { try { return globalThis.sessionStorage; } catch { return null; } },
}) {
  let templateStudioChoices = [];
  let templateStudioOpening = false;
  let templateStudioReturnAction = 'toggle-new-doc-menu';
  let restoreTemplateStudioFocus = false;
  function templateStorage() {
    return storage();
  }
  function persistTemplateStudio(draft) {
    try { saveTemplateDraft(templateStorage(), draft); return true; }
    catch {
      draft.error = 'This tab cannot retain the creation draft. Allow browser storage before creating a copy.';
      return false;
    }
  }
  async function openTemplateStudio(sourceId = null) {
    const state = getState();
    if (templateStudioOpening || state.templateStudio) return;
    templateStudioOpening = true;
    const navigation = [state.navType, state.editorDocId, state.navId];
    const stillHere = () => navigation.every((value, index) => value === [state.navType, state.editorDocId, state.navId][index]);
    try {
      if (!(await prepareEditorNavigation())) return;
      if (!stillHere()) return;
      const response = await fetchStarters();
      if (!response.ok) throw new Error('Could not load templates and guides. Try again.');
      const catalogue = await response.json();
      let documents = await fetchDocuments();
      if (sourceId) {
        const current = await fetchDocument(sourceId);
        documents = [...documents.filter(doc => doc.id !== sourceId), current];
      }
      if (!stillHere()) return;
      templateStudioChoices = templateChoices(catalogue.items, documents);
      const recovered = loadTemplateDraft(templateStorage());
      const source = templateStudioChoices.find(item => item.sourceId === sourceId) || templateStudioChoices[0];
      if (sourceId && !templateStudioChoices.some(item => item.sourceId === sourceId)) throw new Error('That template is no longer active.');
      // A pending identity must be resolved before starting another copy in this tab.
      const draft = recovered?.job || (!sourceId && recovered) ? recovered : {
        source, title: source.title, project: defaultProjectId() || '', documentType: source.documentType || 'note',
        job: null, pending: false, error: '',
      };
      if (!templateStudioChoices.some(item => item.id === draft.source.id)) templateStudioChoices.unshift(draft.source);
      templateStudioReturnAction = sourceId ? 'use-document-template' : 'toggle-new-doc-menu';
      persistTemplateStudio(draft);
      setState({ templateStudio: draft, newDocMenuOpen: false, docMenuOpen: false });
      renderApp();
    } catch (error) { showToast(error.message); }
    finally { templateStudioOpening = false; }
  }
  function closeTemplateStudio() {
    const state = getState();
    if (state.templateStudio?.pending) return;
    restoreTemplateStudioFocus = true;
    setState({ templateStudio: null });
    renderApp();
  }
  function updateTemplateStudio(field, value) {
    const state = getState();
    if (!state.templateStudio || state.templateStudio.pending || state.templateStudio.job) return;
    let draft = { ...state.templateStudio, error: '' };
    if (field === 'source') {
      const source = templateStudioChoices.find(item => item.id === value);
      if (!source) return;
      draft = { ...draft, source, title: source.title, documentType: source.documentType || 'note' };
    } else if (['project', 'title', 'documentType'].includes(field)) draft[field] = value;
    persistTemplateStudio(draft);
    setState({ templateStudio: draft });
    // Text input remains mounted while typing. Other fields change the preview.
    if (field !== 'title') {
      renderApp();
      getRoot().querySelector(`[data-template-field="${field}"]`)?.focus();
    }
  }
  async function submitTemplateStudio() {
    const state = getState();
    const draft = state.templateStudio;
    if (!draft || draft.pending) return;
    draft.pending = true; draft.error = '';
    renderApp();
    let result;
    try {
      if (!draft.job) {
        if (!markdownImportProjects().some(project => project.id === draft.project)) throw new Error('Choose an active destination project.');
        if (draft.source.sourceId) {
          const source = await fetchDocument(draft.source.sourceId);
          if (source.archivedAt || source.status !== 'active' || source.documentType !== 'template') throw new Error('The original template is no longer active. Choose another starting point.');
          if (source.revision !== draft.source.sourceRevision) throw new Error('The original template changed. Close and reopen it to review the current version.');
        }
        const job = buildTemplateJob(draft, randomUUID());
        // Fail before writing if recovery storage is unavailable.
        saveTemplateDraft(templateStorage(), { ...draft, job });
        draft.job = job;
      }
      result = await executeTemplateJob(draft.job, { createDocument, fetchDocument, importTasks, fetchTask });
    } catch (error) {
      draft.pending = false;
      draft.error = `${error.message}${draft.job ? ' Retry checks the same creation; it will not make another copy.' : ''}`;
      renderApp();
      return;
    }
    // Creation has committed. Refresh/open failures are a separate outcome.
    try { clearTemplateDraft(templateStorage()); }
    catch { /* retaining the receipt is safer than creating a new identity */ }
    setState({ templateStudio: null });
    let refreshFailed = false;
    if (result.target === 'document') {
      try { await loadDocuments(); } catch { refreshFailed = true; }
      if (!state.documents.some(doc => doc.id === result.record.id)) setState({ documents: [...state.documents, result.record] });
      await openDocumentInEditor(result.record.id).catch(() => { refreshFailed = true; });
    } else {
      try { await loadTasks(); } catch { refreshFailed = true; }
      if (!state.tasks.some(task => task.id === result.record.id)) setState({ tasks: [...state.tasks, normalizeTask(result.record)] });
      await openTaskDrawer(result.record.id).catch(() => { refreshFailed = true; });
    }
    renderApp();
    showToast(`${result.target === 'task' ? 'Onboarding task' : 'Document copy'} created.${refreshFailed ? ' Some details could not refresh; reload to see them.' : ''}`);
  }

  // The template studio owns every key of #app while open; Escape closes it.
  // (A keyboard dispatcher layer.)
  function keydown(event) {
    if (!getState().templateStudio) return null;
    if (event.key === 'Escape') { event.preventDefault(); closeTemplateStudio(); }
    return KEY_CONSUMED;
  }

  // After a render: focus returns to the opener once the studio closed, and
  // an open studio keeps focus inside (a restored field stays the person's).
  // Returns true when the studio is open (afterRender stops there).
  function afterRender(renderRestoredField) {
    const state = getState();
    if (restoreTemplateStudioFocus && !state.templateStudio) {
      restoreTemplateStudioFocus = false;
      getRoot().querySelector(`[data-action="${templateStudioReturnAction}"]`)?.focus();
    }
    if (state.templateStudio) {
      if (!renderRestoredField?.matches('[data-template-field]')) {
        getRoot().querySelector('[data-template-field="source"]:not([disabled]), [data-action="submit-template-studio"]:not([disabled]), .template-studio__preview')?.focus();
      }
      return true;
    }
    return false;
  }

  // A creation draft kept in this tab survives a reload.
  function announceRecovery() {
    if (loadTemplateDraft(templateStorage())) showToast('An unfinished template copy is saved in this tab. Open Templates & guides to continue.', null, 8000);
  }

  const actions = {
    'open-template-studio': async () => {
      await openTemplateStudio();
    },
    'use-document-template': async () => {
      const state = getState();
      await openTemplateStudio(state.editorDocId);
    },
    'close-template-studio': () => {
      closeTemplateStudio();
    },
    'submit-template-studio': async () => {
      await submitTemplateStudio();
    },
    'discard-template-studio': (el, event, action) => {
      const state = getState();
      if (!state.templateStudio || state.templateStudio.pending) return;
      const attempted = Boolean(state.templateStudio.job);
      setState({ templateStudio: null });
      openConfirm({
        message: attempted
          ? 'This copy may already exist. Discard only the saved creation draft? Check the Library or Tasks before creating another copy. This does not delete any created document or task.'
          : 'Discard the saved template draft and its title and destination choices?',
        okLabel: 'Discard draft', action: 'confirm-discard-template-studio',
      });
    },
    'confirm-discard-template-studio': () => {
      try { clearTemplateDraft(templateStorage()); showToast('Template draft discarded.'); }
      catch { showToast('Could not discard the saved draft. Browser storage is unavailable.'); }
      setState({ confirm: null }); renderApp();
    },
  };

  return {
    actions, keydown, afterRender, announceRecovery, choices: () => templateStudioChoices,
    openTemplateStudio, closeTemplateStudio, updateTemplateStudio, submitTemplateStudio,
  };
}
