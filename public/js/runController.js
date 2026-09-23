// Runbook execution (runs) — controller. A run snapshots the runbook's
// checkbox steps; checking a step stamps a time without touching the
// document, and every write is followed by one canonical read (the chronicle's
// event ledger), serialized per run. Dependencies are injected
// (inboxController.js pattern); handleAction delegates the run data-actions.

import {
  startRun as apiStartRun, fetchRun as apiFetchRun, setRunStep as apiSetRunStep,
  setRunStatus as apiSetRunStatus, createPostMortem as apiCreatePostMortem,
} from './libraryApi.js';
import { runMatchesStartIntent, runMatchesStatusIntent, runMatchesStepIntent } from './runOutcome.js';
import { buildChronicle } from './renderRun.js';
import { createTaskMutationQueue } from './taskMutationQueue.js';

export function createRunController({
  getState, setState, renderApp, showToast, alertError, openConfirm, currentDocument,
  prepareEditorNavigation, openDocumentInEditor, goLibrary, copyToClipboard,
  startRun = apiStartRun, fetchRun = apiFetchRun, setRunStep = apiSetRunStep,
  setRunStatus = apiSetRunStatus, createPostMortem = apiCreatePostMortem,
  randomUUID = () => globalThis.crypto.randomUUID(),
}) {
  const enqueueRunMutation = createTaskMutationQueue();
  let pendingRunMutationCount = 0;

  // Snapshot the runbook's checkbox steps into a fresh run and open the run view.
  // The run is a chronicle: checking a step stamps a time without touching the doc.
  async function startRunForDocument(documentId) {
    const state = getState();
    if (state.runStartPending) return;
    const doc = state.documents.find((d) => d.id === documentId) || currentDocument();
    if (!doc) { alertError('start a run'); return; }
    const priorIntent = state.runStartIntent;
    const intent = priorIntent?.documentId === doc.id
      ? priorIntent
      : { id: randomUUID(), documentId: doc.id, title: '' };
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
    const state = getState();
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
    const state = getState();
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
    const state = getState();
    const run = state.activeRun;
    if (!run || run.status !== 'running') return Promise.resolve();
    return queueRunMutation(run.id, {
      intent: { type: 'step', stepId, checked: nowChecked },
      write: () => setRunStep(run.id, stepId, nowChecked),
    });
  }

  function endRun(status) {
    const state = getState();
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
    const state = getState();
    const run = state.activeRun;
    if (!run) return;
    const doc = (state.documents || []).find((d) => d.id === run.documentId);
    const ok = await copyToClipboard(buildChronicle(run, run.documentTitle || doc?.title || ''));
    showToast(ok ? 'Chronicle copied' : 'Could not copy chronicle');
  }

  async function generatePostMortem(runId) {
    const state = getState();
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
    const state = getState();
    const docId = state.runReturnDocId || state.activeRun?.documentId;
    setState({ activeRun: null });
    if (docId && await openDocumentInEditor(docId)) return;
    await goLibrary();
  }

  const actions = {
    // ---- runbook execution ----
    'start-run': () => {
      const state = getState();
      startRunForDocument(state.editorDocId);
    },
    'open-run': (el) => {
      const state = getState();
      openRun(el.dataset.runId, el.dataset.documentId || state.editorDocId);
    },
    'toggle-run-step': (el, event) => {
      event.stopPropagation();
      toggleRunStep(el.dataset.stepId, el.dataset.checked !== '1');
    },
    'finish-run': () => {
      endRun('completed');
    },
    'resume-run': () => {
      endRun('running');
    },
    'abort-run': (el, event, action) => {
      if (el.dataset.confirmed === '1') { endRun('aborted'); return; }
      openConfirm({ message: 'Abort this run? The chronicle so far is kept, but the run is marked aborted.', action: 'abort-run', okLabel: 'Abort run', danger: true });
    },
    'copy-chronicle': () => {
      copyRunChronicle();
    },
    'generate-post-mortem': (el) => {
      generatePostMortem(el.dataset.runId);
    },
    'back-from-run': async () => {
      await backFromRun();
    },
  };

  return {
    actions, startRunForDocument, openRun, toggleRunStep, endRun, copyRunChronicle, generatePostMortem, backFromRun,
  };
}
