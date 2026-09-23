// Document lifecycle — controller: verify / unverify, archive, restore,
// permanent delete and supersession, each reconciled with one canonical read
// when its response is lost, run once per document at a time, and offered
// with a truthful undo. Dependencies are injected (inboxController.js
// pattern); handleAction delegates the lifecycle data-actions here.

import {
  fetchDocument as apiFetchDocument, fetchDocuments as apiFetchDocuments, verifyDocument as apiVerifyDocument,
  restoreDocument as apiRestoreDocument, archiveDocument as apiArchiveDocument,
  deleteDocumentPermanently as apiDeleteDocumentPermanently, unlinkDocuments as apiUnlinkDocuments,
  fetchDocumentLinks as apiFetchDocumentLinks, supersedeDocument as apiSupersedeDocument,
} from './libraryApi.js';
import { documentMatchesLifecycle, lifecycleOutcomeMessage } from './documentLifecycleOutcome.js';
import { documentDraftIsDirty, clearDocumentDraftRecovery } from './documentDraftRecovery.js';

export function createDocumentLifecycleController({
  getState, setState, renderApp, showToast, dismissToast, alertError, openConfirm,
  loadDocuments, loadDocumentLinks, seedEditorDraft, destroyEditorController, prepareEditorNavigation,
  pendingDocumentSave, currentDocument, resetLibraryFilters, documentDraftStorage, verifyHealthDoc,
  fetchDocument = apiFetchDocument, fetchDocuments = apiFetchDocuments, verifyDocument = apiVerifyDocument,
  restoreDocument = apiRestoreDocument, archiveDocument = apiArchiveDocument,
  deleteDocumentPermanently = apiDeleteDocumentPermanently, unlinkDocuments = apiUnlinkDocuments,
  fetchDocumentLinks = apiFetchDocumentLinks, supersedeDocument = apiSupersedeDocument,
}) {
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
    const state = getState();
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
    const state = getState();
    const editorVersion = state.editorContextVersion;
    const editorUnchanged = () => state.editorContextVersion === editorVersion
      && state.navType === 'editor' && state.editorDocId === id && state.documentDraftId === id;
    let reviewedRevision = null;
    if (verified) {
      if (state.navType !== 'editor' || state.documentDraftId !== id) { await verifyHealthDoc(id); return false; }
      const reviewed = state.documentDraftBase;
      if (state.isDocumentDirty || pendingDocumentSave() || !reviewed?.revision
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
        if (editorUnchanged() && !state.isDocumentDirty && !pendingDocumentSave()) {
          seedEditorDraft(result.document);
          destroyEditorController(); renderApp();
          showToast('The document changed. Review the current title and body before verifying again.', null, 7000);
        } else {
          showToast('Verification was not applied because the document changed. Your current draft is kept; reopen the document to review it.', null, 7000);
        }
      } else reportUncommittedLifecycle(verified ? 'Verify this document' : 'Unverify this document', result.outcome, id);
      return false;
    }
    cacheLifecycleDocument(result.document);
    if (state.navType !== 'editor' || editorUnchanged()) renderApp();
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
    const state = getState();
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
    const state = getState();
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
    const state = getState();
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

  // Archive every selected document through the same reconcile path as the
  // single action, with one summary toast instead of one per document.
  async function bulkArchiveDocuments() {
    const state = getState();
    const ids = [...(state.librarySelectedDocIds || [])];
    if (!ids.length) return;
    let archived = 0;
    for (const id of ids) {
      const done = await performDocumentLifecycleOnce(`document:${id}`, async () => {
        const result = await reconcileDocumentLifecycle({ id, intent: { type: 'archive' }, mutate: () => archiveDocument(id) });
        if (result.committed) cacheLifecycleDocument(result.document, { remove: state.libraryView !== 'archive' });
        return result.committed;
      });
      if (done) archived += 1;
    }
    setState({ librarySelectedDocIds: [] });
    try { await loadDocuments(); } catch { /* the cache already reflects the commits */ }
    renderApp();
    showToast(archived === ids.length
      ? `${archived === 1 ? '1 document' : `${archived} documents`} archived. Restore from the Archive.`
      : `${archived} of ${ids.length} archived; the rest could not be confirmed. Reload to reconcile.`, null, 7000);
  }

  const actions = {
    'bulk-archive-docs': async () => {
      await bulkArchiveDocuments();
    },
    'restore-document': async (el) => {
      const state = getState();
      const id = el.dataset.documentId || state.editorDocId;
      await performDocumentLifecycleOnce(`document:${id}`, () => restoreKnowledgeDocument(id));
    },
    'delete-document': async (el, event, action) => {
      const state = getState();
      const id = el.dataset.documentId || state.editorDocId;
      if (!el.dataset.confirmed) {
        openConfirm({
          message: 'Permanently delete this document? This cannot be undone.',
          okLabel: 'Delete', danger: true,
          action: 'delete-document', data: { 'document-id': id || '' },
        });
        return;
      }
      setState({ confirm: null });
      await performDocumentLifecycleOnce(`document:${id}`, () => deleteKnowledgeDocument(id));
    },

    'toggle-verify': async () => {
      const doc = currentDocument();
      setState({ docMenuOpen: false });
      if (!doc) return;
      await performDocumentLifecycleOnce(`document:${doc.id}`, () => (
        changeDocumentVerification(doc.id, !doc.verified)
      ));
    },
    'supersede-document': async () => {
      const doc = currentDocument();
      setState({ docMenuOpen: false });
      if (!doc) return;
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
    },
    'archive-document': async () => {
      const doc = currentDocument();
      setState({ docMenuOpen: false });
      if (!doc) return;
      if (!(await prepareEditorNavigation())) return;
      await performDocumentLifecycleOnce(`document:${doc.id}`, () => archiveKnowledgeDocument(doc.id));
    },
  };

  return {
    actions, performDocumentLifecycleOnce, cacheLifecycleDocument, reconcileDocumentLifecycle,
    changeDocumentVerification, restoreKnowledgeDocument, archiveKnowledgeDocument, deleteKnowledgeDocument,
    supersedeKnowledgeDocument, undoDocumentSupersession, bulkArchiveDocuments,
  };
}
