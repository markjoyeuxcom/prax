// AI assistant (agentic tool-calling chat) — controller.
// The conversation, its pending write approvals and their recovery record.
// Dependencies are injected (inboxController.js pattern); main.js wires the
// live app and handleAction delegates the assistant's data-actions here.

import { assistantChat as apiAssistantChat, fetchAssistantStatus as apiFetchAssistantStatus } from './libraryApi.js';
import { loadAssistantRecovery, saveAssistantRecovery } from './assistantRecovery.js';
import { assistantDecisions, withCallDecision } from './renderAssistant.js';
import { assistantOutcomeNotice } from './assistantOutcome.js';

export function createAssistantController({
  getState, setState, renderApp, showToast, discardCapture, getRoot,
  loadTasks, loadProjects, loadDocuments, loadHealth, storage,
  assistantChat = apiAssistantChat, fetchAssistantStatus = apiFetchAssistantStatus,
}) {
  function openAssistant() {
    const state = getState();
    if (state.captureSubmitting) return;
    if (state.captureOpen) discardCapture();
    setState({ assistantOpen: true, assistantError: null, assistantErrorKind: null, paletteOpen: false });
    renderApp();
    loadAssistantStatus();
  }

  async function loadAssistantStatus() {
    const state = getState();
    try {
      const status = await fetchAssistantStatus();
      setState({ assistantStatus: status });
    } catch {
      setState({ assistantStatus: { available: false, toolCount: 0 } });
    }
    if (state.assistantOpen) renderApp();
  }

  // Apply one turn's response envelope to state (shared by send + confirm resume).
  // After the assistant executes an approved write, the server has mutated data
  // the human UI holds a cached copy of (tasks/projects/documents). Reload it so
  // the change shows immediately instead of only after a manual refresh/nav.
  async function refreshAfterAssistantWrite() {
    const state = getState();
    try {
      await Promise.all([loadTasks(), loadProjects(), loadDocuments()]);
      if (state.healthData) await loadHealth();
      return true;
    } catch {
      return false;
    }
  }

  async function applyAssistantResult(res) {
    const state = getState();
    const preserveApproval = Boolean(state.assistantPending?.length)
      && (res.status === 'no_model' || res.reason === 'approval-unavailable');
    if (preserveApproval) {
      setState({ assistantLoading: false, assistantError: res.status === 'no_model'
        ? 'No AI model configured — restore a tool-capable model in Settings, then retry this saved approval.'
        : 'This model cannot resume the saved approval. Restore a tool-capable model in Settings, then retry.', assistantErrorKind: 'error' });
    } else if (res.status === 'awaiting_confirmation') {
      setState({ assistantMessages: res.messages, assistantPending: res.pending || [], assistantLoading: false, assistantError: null, assistantErrorKind: null });
    } else if (res.status === 'no_model') {
      setState({ assistantLoading: false, assistantPending: null, assistantError: 'No AI model configured — set one in Settings ▸ Intelligence ▸ AI answers.', assistantErrorKind: 'error', assistantStatus: { available: false, toolCount: state.assistantStatus?.toolCount || 0 } });
    } else if (res.status === 'error') {
      setState({ assistantMessages: res.messages || state.assistantMessages, assistantLoading: false, assistantPending: null, assistantError: null, assistantErrorKind: null });
    } else {
      // done
      setState({ assistantMessages: res.messages, assistantLoading: false, assistantPending: null, assistantError: null, assistantErrorKind: null });
    }

    // A write mutated cached data. Wait for the reload so the notice can say
    // whether the committed change is already visible or requires a page reload.
    const refreshed = res.didWrite || res.outcomeUnknown ? await refreshAfterAssistantWrite() : true;
    if (!preserveApproval) setState({ assistantApprovalAttempted: false });
    saveAssistantRecovery(storage(), state.assistantPending?.length ? { messages: state.assistantMessages, pending: state.assistantPending, attempted: state.assistantApprovalAttempted } : null);
    const notice = preserveApproval || res.status === 'no_model' ? null : assistantOutcomeNotice(res, { refreshed });
    if (notice) setState({ assistantError: notice.text, assistantErrorKind: notice.kind });
  }

  async function sendAssistant(rawText) {
    const state = getState();
    const text = (rawText || '').trim();
    if (!text || state.assistantLoading || (state.assistantPending && state.assistantPending.length)) return;
    const messages = [...state.assistantMessages, { role: 'user', content: text }];
    setState({ assistantMessages: messages, assistantInput: '', assistantLoading: true, assistantError: null, assistantErrorKind: null });
    renderApp();
    try {
      const res = await assistantChat(messages);
      await applyAssistantResult(res);
    } catch (err) {
      setState({ assistantLoading: false, assistantError: err?.message || 'The assistant request failed.', assistantErrorKind: 'error' });
    }
    renderApp();
  }

  async function resolveAssistantWrites(decision) {
    const state = getState();
    if (!state.assistantPending?.length || state.assistantLoading) return;
    if (state.assistantApprovalAttempted && decision !== 'approve') return;
    // Per-call decisions (a retry resends the recorded ones unchanged).
    const decisions = assistantDecisions(state.assistantPending, decision);
    if (!decisions) { showToast('Approve or decline each change first.'); return; }
    const pending = state.assistantPending.map((p) => ({ ...p, decision: decisions[p.id] }));
    const attempted = Object.values(decisions).includes('approve');
    if (!saveAssistantRecovery(storage(), { messages: state.assistantMessages, pending, attempted })) {
      showToast('The approval could not be saved for recovery. Keep this window open and try again.');
      return;
    }
    setState({ assistantPending: pending, assistantApprovalAttempted: attempted, assistantLoading: true, assistantError: null, assistantErrorKind: null });
    renderApp();
    try {
      const res = await assistantChat(state.assistantMessages, decisions);
      await applyAssistantResult(res);
    } catch (err) {
      setState({ assistantLoading: false, assistantError: 'The connection ended before the approval outcome was known. Retry safely to recover the same action; do not start a replacement action.', assistantErrorKind: 'error' });
    }
    renderApp();
  }

  function clearAssistant() {
    const state = getState();
    if (state.assistantLoading || state.assistantApprovalAttempted) { showToast('Recover the pending approval outcome before starting a new chat.'); return; }
    saveAssistantRecovery(storage(), null);
    setState({ assistantMessages: [], assistantPending: null, assistantError: null, assistantErrorKind: null, assistantInput: '', assistantLoading: false });
    renderApp();
  }

  function closeAssistant() {
    setState({ assistantOpen: false });
    renderApp();
  }

  // A pending approval survives a reload: offer it back, flagged when its
  // outcome was never confirmed.
  function restoreRecovery() {
    const assistantRecovery = loadAssistantRecovery(storage());
    if (!assistantRecovery) return false;
    setState({ assistantMessages: assistantRecovery.messages, assistantPending: assistantRecovery.pending, assistantApprovalAttempted: assistantRecovery.attempted, assistantError: assistantRecovery.attempted ? 'Recovered an approval whose outcome was not confirmed. Retry safely to check the same action.' : null, assistantErrorKind: assistantRecovery.attempted ? 'partial' : null });
    showToast('Recovered a pending assistant approval. Open Assistant to review it.', null, 8000);
    return true;
  }

  // The composer mirrors into state (no re-render) so it survives re-renders.
  function mirrorInput(value) {
    setState({ assistantInput: value });
  }

  const actions = {
    'open-assistant': () => { openAssistant(); },
    'close-assistant': () => { closeAssistant(); },
    'assistant-send': () => { sendAssistant(getRoot().querySelector('[data-assistant-input]')?.value); },
    'assistant-suggest': (el) => { sendAssistant(el.dataset.suggest); },
    'assistant-approve': () => { resolveAssistantWrites('approve'); },
    'assistant-decline': () => { resolveAssistantWrites('deny'); },
    'assistant-call-decision': (el) => {
      const state = getState();
      if (!state.assistantLoading && !state.assistantApprovalAttempted) { setState({ assistantPending: withCallDecision(state.assistantPending, el.dataset.callId, el.dataset.decision) }); renderApp(); }
    },
    'assistant-clear': () => { clearAssistant(); },
  };

  return {
    actions, openAssistant, closeAssistant, loadAssistantStatus, sendAssistant, resolveAssistantWrites,
    clearAssistant, applyAssistantResult, restoreRecovery, mirrorInput,
  };
}
