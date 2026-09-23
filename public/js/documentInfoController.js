// Document info — controller for the editor's metadata form (root-review
// finding 5): title, type, project, tags, source filename and external
// references. The form is an explicit draft in state.documentInfoDraft (what
// it was opened from, what the person typed, any unresolved conflict); inputs
// mirror into it without re-rendering, a save sends only changed fields under
// the opened revision, and a contested field stops for review. Dependencies
// are injected (inboxController.js pattern); handleAction delegates here.

import {
  updateDocument as apiUpdateDocument, fetchDocument as apiFetchDocument, fetchExternalRefs as apiFetchExternalRefs,
  addExternalRef as apiAddExternalRef, removeExternalRef as apiRemoveExternalRef,
} from './libraryApi.js';
import {
  openDocumentInfoDraft, normalizeInfoFields, documentInfoPatch, mergeDocumentInfo, documentInfoCommitted,
  rebaseDocumentInfoDraft,
} from './documentInfoDraft.js';
import { parseExternalRefLines } from './externalRefKind.js';
import { sharedAction } from './actionMap.js';

export function createDocumentInfoController({
  getState, setState, renderApp, showToast, currentDocument, cacheLifecycleDocument, destroyEditorController,
  saveDocumentDraft, loadDocuments,
  updateDocument = apiUpdateDocument, fetchDocument = apiFetchDocument, fetchExternalRefs = apiFetchExternalRefs,
  addExternalRef = apiAddExternalRef, removeExternalRef = apiRemoveExternalRef,
}) {
  // Reconcile the doc-info refs textarea (one `url` or `url | label` per line)
  // against the refs SNAPSHOT the form was seeded from (docInfoRefsSeed):
  // upsert every desired line (the POST is idempotent and also updates a
  // changed label) and delete any seeded ref whose URL is no longer listed.
  // If the seed is null the form opened before the stored refs could be
  // fetched — the user never saw them, so an absent line means "not displayed",
  // not "removed": upserts still apply but nothing is deleted. Best-effort per
  // row so one bad line doesn't abort the rest; returns the failure count so
  // the caller can tell the user about a partial save.
  async function reconcileExternalRefs(documentId, refsText, seed = getState().docInfoRefsSeed) {
    const desired = parseExternalRefLines(refsText);
    const desiredUrls = new Set(desired.map((r) => r.url));
    const seeded = Array.isArray(seed) ? seed : [];
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

  // Document-info form (root-review finding 5). The form is an explicit draft in
  // state.documentInfoDraft: what it was opened from (baseline + revision), what
  // the person typed, and any unresolved conflict. Inputs mirror into the draft
  // without re-rendering, so a rerender or a failed save never reseeds the
  // inputs from the record and throws typed metadata away.
  const DOCUMENT_INFO_INPUT_FIELDS = [
    ['data-doc-info-title', 'title'], ['data-doc-info-type', 'documentType'], ['data-doc-info-project', 'projectId'],
    ['data-doc-info-tags', 'tags'], ['data-doc-info-source', 'sourceFilename'], ['data-doc-info-refs', 'refsText'],
  ];

  function mirrorDocumentInfoInput(target) {
    const state = getState();
    const entry = DOCUMENT_INFO_INPUT_FIELDS.find(([attr]) => target.hasAttribute?.(attr));
    if (!entry) return false;
    const draft = state.documentInfoDraft;
    if (draft && !draft.pending) setState({ documentInfoDraft: { ...draft, fields: { ...draft.fields, [entry[1]]: target.value } } });
    return true;
  }

  // One metadata PATCH, classified: saved / conflict (the record the server
  // holds now) / error. A lost response is judged only on the fields SENT, so
  // an unrelated concurrent edit cannot mask a save that landed.
  async function sendDocumentInfoPatch(docId, patch) {
    try {
      return { saved: await updateDocument(docId, patch) };
    } catch (error) {
      if (error?.status === 409 && error?.document?.revision) return { conflict: error.document };
      let observed = null;
      try { observed = await fetchDocument(docId); } catch { observed = null; }
      if (observed && documentInfoCommitted(observed, patch)) return { saved: observed };
      return { error: true };
    }
  }

  // Rebase the editor on an acknowledged record so the next body edit stays
  // conditional on the saved title and body. A clean editor adopts the record
  // outright — a remote body surfaced by a 409 must never be typed over by the
  // next autosave. A dirty editor keeps its base when the body moved under it,
  // so its own autosave reconciles through the body-conflict review instead of
  // silently overwriting the remote body.
  function rebaseEditorOnDocument(docId, doc) {
    const state = getState();
    const base = state.documentDraftBase || currentDocument();
    cacheLifecycleDocument(doc);
    if (state.editorDocId !== docId || state.documentDraftId !== docId) return;
    const body = doc.body || '';
    if (!state.isDocumentDirty) {
      const bodyMoved = state.documentDraftBody !== body;
      setState({ documentDraftBase: doc, documentDraftTitle: doc.title || '', documentDraftBody: body });
      if (bodyMoved) destroyEditorController();
      return;
    }
    if (body !== (base?.body || '')) return;
    setState({
      documentDraftBase: doc,
      documentDraftTitle: state.documentDraftTitle === (base?.title || '') ? (doc.title || '') : state.documentDraftTitle,
    });
  }

  const actions = {
    'edit-document-info': async () => {
      const state = getState();
      if (state.isDocumentDirty) {
        if (['recovered', 'conflict'].includes(state.documentDraftRecoveryReason)) {
          showToast('Review and save the recovered draft before editing document info.');
          return;
        }
        if (!(await saveDocumentDraft())) return;
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
      // The form edits the record the editor is based on (the freshest
      // revision the client holds); an older cached row is refreshed first so
      // the conditional save is guarded by a real revision.
      let base = state.documentDraftBase?.id === state.editorDocId ? state.documentDraftBase : currentDocument();
      if (!base?.revision) { try { base = await fetchDocument(state.editorDocId); } catch { base = null; } }
      let documentInfoDraft;
      try {
        documentInfoDraft = openDocumentInfoDraft(base, { refs: seed });
      } catch (error) {
        showToast(error.message);
        return;
      }
      setState({ isDocumentInfoEditorOpen: true, documentInfoError: '', docMenuOpen: false, docInfoRefsSeed: seed, documentInfoDraft });
      renderApp();
    },
    'cancel-document-info': () => {
      setState({ isDocumentInfoEditorOpen: false, documentInfoError: '', documentInfoDraft: null }); renderApp();
    },
    ...sharedAction('doc-info-keep-theirs', 'doc-info-keep-mine', (el, event, action) => {
      const state = getState();
      const draft = state.documentInfoDraft;
      if (!draft?.conflict) return;
      const keep = action === 'doc-info-keep-theirs' ? 'theirs' : 'mine';
      setState({
        documentInfoDraft: rebaseDocumentInfoDraft(draft, draft.conflict.remote, { keep, conflicts: draft.conflict.conflicts }),
        documentInfoError: '',
      });
      renderApp();
    }),
    'save-document-info': async () => {
      const state = getState();
      const opened = state.documentInfoDraft;
      const docId = state.editorDocId;
      if (!opened || opened.documentId !== docId) { setState({ documentInfoError: 'Reopen Document info before saving.' }); renderApp(); return; }
      if (opened.pending) return;
      const fields = normalizeInfoFields(opened.fields);
      if (!fields.title) { setState({ documentInfoError: 'Title is required.' }); renderApp(); return; }
      const refsSeed = state.docInfoRefsSeed;
      const inFlight = { ...opened, pending: true, conflict: null };
      setState({ documentInfoDraft: inFlight, documentInfoError: '' });
      renderApp();
      // Send only the fields that changed since the form's baseline, guarded
      // by the revision it was opened from.
      let working = inFlight;
      let patch = documentInfoPatch(working.baseline, fields);
      let outcome = Object.keys(patch).length > 1 ? await sendDocumentInfoPatch(docId, patch) : { saved: null };
      // A revision mismatch that does not contest my fields (a body edit, or a
      // tag change while I renamed) rebases onto the remote record and retries
      // once against ITS revision. A contested field stops for review instead.
      if (outcome.conflict && !mergeDocumentInfo(working.baseline, fields, outcome.conflict).conflicts.length) {
        rebaseEditorOnDocument(docId, outcome.conflict);
        working = rebaseDocumentInfoDraft(working, outcome.conflict, { keep: 'mine' });
        patch = documentInfoPatch(working.baseline, normalizeInfoFields(working.fields));
        outcome = Object.keys(patch).length > 1 ? await sendDocumentInfoPatch(docId, patch) : { saved: outcome.conflict };
      }
      const stillOpen = state.isDocumentInfoEditorOpen && state.documentInfoDraft === inFlight && state.editorDocId === docId;
      if (outcome.conflict) {
        const { conflicts } = mergeDocumentInfo(working.baseline, normalizeInfoFields(working.fields), outcome.conflict);
        rebaseEditorOnDocument(docId, outcome.conflict);
        if (stillOpen) setState({ documentInfoDraft: { ...working, pending: false, conflict: { remote: outcome.conflict, conflicts } }, documentInfoError: '' });
        else showToast('Document info was not saved: the document changed meanwhile. Reopen Document info to review.');
        renderApp();
        return;
      }
      if (outcome.error) {
        if (stillOpen) setState({ documentInfoDraft: { ...working, pending: false }, documentInfoError: 'Prax could not save document info. Your entries are kept — retry when ready.' });
        else showToast('Prax could not save document info.');
        renderApp();
        return;
      }
      if (outcome.saved) rebaseEditorOnDocument(docId, outcome.saved);
      // Metadata is acknowledged independently of reference writes and cache
      // refreshes. A later failure must not strand a committed form as pending.
      const acknowledged = outcome.saved
        ? rebaseDocumentInfoDraft(working, outcome.saved, { keep: 'mine' })
        : { ...working, pending: false };
      const refsFailed = await reconcileExternalRefs(docId, working.fields.refsText, refsSeed).catch(() => 1);
      let currentRefs = null;
      try { currentRefs = await fetchExternalRefs(docId); } catch { /* retain the known seed for retry */ }
      let refreshed = true;
      try { await loadDocuments(); } catch { refreshed = false; }
      if (state.documentInfoDraft === inFlight) {
        if (refsFailed) {
          setState({ documentInfoDraft: acknowledged, documentInfoError: `Document info saved. ${refsFailed} reference change${refsFailed === 1 ? '' : 's'} could not be confirmed; your entries are kept for retry.`, docInfoRefsSeed: currentRefs ?? refsSeed });
        } else {
          setState({ isDocumentInfoEditorOpen: false, documentInfoError: '', documentInfoDraft: null });
        }
      }
      if (state.editorDocId === docId && currentRefs) setState({ documentExternalRefs: currentRefs });
      if (!refreshed) showToast('Document info saved, but the library list could not be refreshed. Reload to reconcile it.', null, 7000);
      else if (refsFailed) showToast('Document info saved; some references still need retry.', null, 6000);
      renderApp();
    },
  };

  return { actions, mirrorInput: mirrorDocumentInfoInput, reconcileExternalRefs, rebaseEditorOnDocument };
}
