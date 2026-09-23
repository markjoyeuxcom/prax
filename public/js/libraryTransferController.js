// Library transfer — controller: the Markdown import and Library/workspace
// export dialogs, and the Settings ▸ Data task JSON export/import. Each keeps
// its dialog open with a truthful status until the outcome is known, and
// returns focus to the control that opened it. Dependencies are injected
// (inboxController.js pattern); handleAction delegates the transfer actions.

import { createDocument as apiCreateDocument } from './libraryApi.js';
import { exportTasks as apiExportTasks, importTasks as apiImportTasks } from './taskApi.js';
import {
  libraryArchiveFilename, workspaceArchiveFilename, libraryExportDestinationMode, libraryExportFailureMessage,
  saveLibraryArchive as defaultSaveLibraryArchive,
} from './libraryExport.js';
import { tasksFromImportPayload, exportFilename, normalizeImportMode } from './importExport.js';
import { importRequestFor, completeImportRequest } from './importRecovery.js';
import { titleFromMarkdown } from './markdownPreview.js';

export function createLibraryTransferController({
  getState, setState, renderApp, showToast, alertError, getRoot, loadDocuments, loadTasks, storage,
  markdownImportProjects, libraryExportProjects, inboxSlug,
  createDocument = apiCreateDocument, exportTasks = apiExportTasks, importTasks = apiImportTasks,
  saveLibraryArchive = defaultSaveLibraryArchive, doc = globalThis.document,
}) {
  let restoreMarkdownImportFocus = false;
  let restoreLibraryExportFocus = false;
  let libraryExportReturnAction = 'export-library';

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
      libraryExportFormat: 'markdown',
      libraryExportIncludeArchived: false,
      libraryExportFilename: libraryArchiveFilename(selectedScope),
      libraryExportPending: false,
      libraryExportError: '',
      newDocMenuOpen: false,
    });
    renderApp();
  }

  function closeLibraryExport() {
    const state = getState();
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
    const state = getState();
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
        format: state.libraryExportFormat,
        includeArchived: state.libraryExportIncludeArchived,
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
    const state = getState();
    const projects = markdownImportProjects();
    const retained = projects.find(project => project.id === state.markdownImportProjectId);
    const destination = retained || projects.find(project => project.slug === inboxSlug) || projects[0] || null;
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
    const state = getState();
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
    const state = getState();
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
    const state = getState();
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

  function downloadJsonFile(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const anchor = doc.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 3000);
  }

  async function exportTasksScoped(all) {
    const state = getState();
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
    const state = getState();
    if (state.adminImportPending) return;
    let mode;
    try {
      mode = normalizeImportMode(state.adminImportMode || 'skip');
    } catch {
      mode = 'skip';
    }
    if (mode === 'replace') {
      const confirmBox = getRoot().querySelector('[data-replace-confirm]');
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
    try { request = await importRequestFor(storage(), intent); }
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
      completeImportRequest(storage(), request);
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
    const state = getState();
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

  // After a render: a closed dialog hands focus back to what opened it.
  function restoreFocus() {
    const state = getState();
    // The Import / Export triggers live in the Library's ⋯ overflow, which is
    // closed by the time the dialog goes; focus then returns to the overflow
    // button rather than nowhere.
    if (restoreMarkdownImportFocus && !state.markdownImportOpen) {
      restoreMarkdownImportFocus = false;
      (getRoot().querySelector('[data-action="import-documents"]') || getRoot().querySelector('[data-action="toggle-library-menu"]'))?.focus();
    }
    if (restoreLibraryExportFocus && !state.libraryExportOpen) {
      restoreLibraryExportFocus = false;
      (getRoot().querySelector(`[data-action="${libraryExportReturnAction}"]`) || getRoot().querySelector('[data-action="toggle-library-menu"]'))?.focus();
    }
  }

  // Delegated `change` events of the transfer dialogs' fields.
  function change(target) {
    const state = getState();
    if (target.matches?.('[data-markdown-import-files]')) {
      selectMarkdownImportFiles(target.files);
      return true;
    }
    if (target.matches?.('[data-markdown-import-project]')) {
      if (!state.markdownImportPending && !state.markdownImportNotice) {
        setState({ markdownImportProjectId: target.value, markdownImportError: '', markdownImportNotice: '' });
        renderApp();
      }
      return true;
    }
    if (target.matches?.('[data-library-export-format], [data-library-export-archived]')) {
      if (!state.libraryExportPending) {
        const format = target.matches('[data-library-export-format]') ? (target.value === 'workspace' ? 'workspace' : 'markdown') : state.libraryExportFormat;
        setState({ libraryExportFormat: format,
          libraryExportIncludeArchived: target.matches('[data-library-export-archived]') ? target.checked : state.libraryExportIncludeArchived,
          libraryExportFilename: format === 'workspace' ? workspaceArchiveFilename() : libraryArchiveFilename(state.libraryExportScope), libraryExportError: '' });
        renderApp();
        getRoot().querySelector(target.matches('[data-library-export-format]') ? '[data-library-export-format]' : '[data-library-export-archived]')?.focus();
      }
      return true;
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
      return true;
    }
    if (target.matches?.('[data-import-file]')) {
      selectTaskImportFile(target.files?.[0]);
      return true;
    }
    if (target.matches?.('[data-import-project]')) {
      if (!state.adminImportPending) {
        setState({ adminImportProjectId: target.value, adminImportRequest: null, adminImportError: '', adminImportResult: null });
        renderApp();
      }
      return true;
    }
    if (target.matches?.('[name="import-mode"]')) {
      if (state.adminImportPending) return true;
      setState({ adminImportMode: target.value, adminImportRequest: null, adminImportError: '', adminImportResult: null });
      renderApp();
      return true;
    }
    return false;
  }

  const actions = {
    'import-documents': () => {
      setState({ libraryMenuOpen: false }); openMarkdownImport();
    },
    'close-markdown-import': () => {
      closeMarkdownImport();
    },
    'submit-markdown-import': async () => {
      await submitMarkdownImport();
    },
    'export-library': (el, event, action) => {
      setState({ libraryMenuOpen: false }); openLibraryExport('all', action);
    },
    'close-library-export': () => {
      closeLibraryExport();
    },
    'submit-library-export': async () => {
      await submitLibraryExport();
    },
    'export-project-tasks': () => {
      exportTasksScoped(false);
    },
    'export-all-tasks': () => {
      exportTasksScoped(true);
    },
    'import-tasks': () => {
      importTasksFromSettings();
    },
    'export-library-project': (el, event, action) => {
      const state = getState();
      const slug = state.managedProjects.find(p => p.id === state.navId)?.slug || 'all';
      openLibraryExport(slug, action);
    },
    'export-library-all': (el, event, action) => {
      openLibraryExport('all', action);
    },
  };

  return {
    actions, change, restoreFocus, openLibraryExport, closeLibraryExport, submitLibraryExport,
    openMarkdownImport, closeMarkdownImport, submitMarkdownImport, selectMarkdownImportFiles,
    exportTasksScoped, importTasksFromSettings, selectTaskImportFile,
  };
}
