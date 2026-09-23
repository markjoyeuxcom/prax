// Review-queue walk (year-one spec item 11) — controller: open a queued
// document, read it, verify or skip, and land on the next one — one click per
// document instead of three. The walk is a snapshot of the queue as it was
// shown, so what you asked to review is what you review; documents verified
// elsewhere meanwhile are skipped at advance time. Dependencies are injected
// (inboxController.js pattern); handleAction delegates the walk's actions.

import { fetchDocument as apiFetchDocument } from './libraryApi.js';
import { isReviewQueueDoc } from './renderLibrary.js';
import { renderReviewWalkLabel } from './renderEditor.js';

export function createReviewWalkController({
  getState, setState, renderApp, showToast, getRoot, visibleLibraryDocuments, currentDocument,
  prepareEditorNavigation, openDocumentInEditor, destroyEditorController, goLibrary,
  cacheLifecycleDocument, performDocumentLifecycleOnce, changeDocumentVerification,
  fetchDocument = apiFetchDocument,
}) {
  function startReviewWalk(fromId) {
    const ids = visibleLibraryDocuments().filter(isReviewQueueDoc).map((doc) => doc.id);
    const index = Math.max(0, ids.indexOf(fromId));
    setState({ reviewWalk: ids.length ? { ids: ids.includes(fromId) ? ids : [fromId, ...ids], index, verified: 0 } : { ids: [fromId], index: 0, verified: 0 } });
  }

  // Open a queued document for review: the first one through the health-style
  // preview (with its coaching toast), later ones silently — the strip explains.
  function reviewWalkPositionIsCurrent(walk) {
    const state = getState();
    return state.reviewWalk === walk || Boolean(walk && state.reviewWalk?.ids === walk.ids
      && state.reviewWalk.index === walk.index);
  }

  async function openWalkDocument(id, { coach = false } = {}) {
    const state = getState();
    const walk = state.reviewWalk;
    const originView = state.navType;
    const originDocument = state.editorDocId;
    if (!id || !(await prepareEditorNavigation(id))) return;
    if (state.navType !== originView || state.editorDocId !== originDocument) return;
    const version = state.editorContextVersion;
    const isCurrent = () => reviewWalkPositionIsCurrent(walk) && state.editorContextVersion === version;
    if (!isCurrent()) return;
    try {
      const document = await fetchDocument(id);
      if (!isCurrent()) return;
      cacheLifecycleDocument(document);
      if (!(await openDocumentInEditor(id, { isCurrent }))) return;
      if (!reviewWalkPositionIsCurrent(walk) || state.navType !== 'editor' || state.editorDocId !== id) return;
      destroyEditorController();
      setState({ editorMode: 'preview' });
      renderApp();
      if (coach) showToast('Review this document, then use Verify to approve the content shown.', null, 7000);
    } catch { if (isCurrent()) showToast('Could not load the next document for review.'); }
  }

  async function advanceReviewWalk() {
    const state = getState();
    const walk = state.reviewWalk;
    if (!walk) return;
    const byId = new Map((state.documents || []).map((doc) => [doc.id, doc]));
    let next = walk.index + 1;
    while (next < walk.ids.length && !isReviewQueueDoc(byId.get(walk.ids[next]))) next += 1;
    if (next >= walk.ids.length) {
      const verified = walk.verified;
      setState({ reviewWalk: null });
      await goLibrary({ libraryView: 'review' }, { restore: true });
      showToast(verified ? `Queue walked — ${verified === 1 ? '1 document' : `${verified} documents`} verified.` : 'Queue walked — nothing verified.');
      return;
    }
    setState({ reviewWalk: { ...walk, index: next } });
    await openWalkDocument(walk.ids[next]);
  }

  async function reviewWalkVerify() {
    const state = getState();
    const doc = currentDocument();
    const walk = state.reviewWalk;
    const editorVersion = state.editorContextVersion;
    if (!doc || !walk || walk.ids[walk.index] !== doc.id) return;
    if (doc.verified !== true) {
      const committed = await performDocumentLifecycleOnce(`document:${doc.id}`, () => changeDocumentVerification(doc.id, true));
      // Advance only on a committed verification; a refusal (dirty draft,
      // changed revision) leaves the strip in place with its toast explaining.
      const after = (state.documents || []).find((item) => item.id === doc.id);
      if (!committed || after?.verified !== true || state.reviewWalk?.ids !== walk.ids) return;
      const advance = reviewWalkPositionIsCurrent(walk) && state.navType === 'editor' && state.editorDocId === doc.id
        && state.editorContextVersion === editorVersion;
      // A verification that finished after Skip still counts in this walk, but
      // must not advance its new position or alter another walk's summary.
      setState({ reviewWalk: { ...state.reviewWalk, verified: (state.reviewWalk?.verified || 0) + 1 } });
      if (!advance) {
        const label = getRoot()?.querySelector('.review-walk__label');
        if (label) label.innerHTML = renderReviewWalkLabel(state.reviewWalk);
        return;
      }
    }
    await advanceReviewWalk();
  }

  async function verifyHealthDoc(id) {
    return openWalkDocument(id, { coach: true });
  }

  const actions = {
    'review-doc': async (el) => {
      const state = getState();
      // From the queue, Review starts a walk through what is shown.
      if (state.libraryView === 'review') startReviewWalk(el.dataset.documentId);
      await openWalkDocument(el.dataset.documentId, { coach: true });
    },
    'review-next': async () => {
      const next = visibleLibraryDocuments().find((doc) => doc.verified !== true);
      if (!next) return;
      startReviewWalk(next.id);
      await openWalkDocument(next.id, { coach: true });
    },
    'review-walk-verify': async () => {
      await reviewWalkVerify();
    },
    'review-walk-skip': async () => {
      await advanceReviewWalk();
    },
    'verify-health-doc': (el) => {
      verifyHealthDoc(el.dataset.docId);
    },
  };

  return {
    actions, startReviewWalk, reviewWalkPositionIsCurrent, openWalkDocument, advanceReviewWalk,
    reviewWalkVerify, verifyHealthDoc,
  };
}
