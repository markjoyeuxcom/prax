// Knowledge tools — controller: Ask Prax (grounded, cited answers), Generate
// runbook, the daily brief, the weekly review, and Library health with its
// on-demand AI review. Each request carries a generation token so a stale or
// dismissed answer never installs. Dependencies are injected
// (inboxController.js pattern); handleAction delegates these data-actions.

import {
  askPrax as apiAskPrax, generateRunbook as apiGenerateRunbook, fetchHealth as apiFetchHealth,
  fetchLinkSuggestions as apiFetchLinkSuggestions, runAiReview as apiRunAiReview, narrateBrief as apiNarrateBrief,
  applyWikiLink as apiApplyWikiLink, generateWeeklyReview as apiGenerateWeeklyReview,
  fetchKnowledgeGaps as apiFetchKnowledgeGaps, fetchLibrarianProposals as apiFetchLibrarianProposals,
  fetchPruneCandidates as apiFetchPruneCandidates, fetchLibrarianSettings as apiFetchLibrarianSettings,
  runLibrarian as apiRunLibrarian, decideLibrarianProposal as apiDecideLibrarianProposal,
  saveLibrarianSettings as apiSaveLibrarianSettings,
} from './libraryApi.js';
import { buildDailyBrief } from './brief.js';

export function createKnowledgeToolsController({
  getState, setState, renderApp, showToast, announce, copyToClipboard, getRoot, prepareEditorNavigation,
  openDocumentInEditor, loadDocuments, captureProjectChoices, inboxSlug,
  openAskPage = null, onAskResult = null,
  askPrax = apiAskPrax, generateRunbook = apiGenerateRunbook, fetchHealth = apiFetchHealth,
  fetchLinkSuggestions = apiFetchLinkSuggestions, runAiReview = apiRunAiReview, narrateBrief = apiNarrateBrief,
  applyWikiLink = apiApplyWikiLink, generateWeeklyReview = apiGenerateWeeklyReview,
  fetchKnowledgeGaps = apiFetchKnowledgeGaps, fetchLibrarianProposals = apiFetchLibrarianProposals,
  fetchPruneCandidates = apiFetchPruneCandidates, fetchLibrarianSettings = apiFetchLibrarianSettings,
  runLibrarian = apiRunLibrarian, decideLibrarianProposal = apiDecideLibrarianProposal,
  saveLibrarianSettings = apiSaveLibrarianSettings,
}) {
  let askPraxToken = 0;             // stale/closed grounded-answer requests never install

  async function loadHealth() {
    setState({ healthLoading: true });
    const sort = getState().healthReviewSort === 'recall' ? 'recall' : undefined;
    try {
      const [healthData, healthLinkSuggestions, librarian] = await Promise.all([
        fetchHealth('', sort ? { sort } : undefined),
        fetchLinkSuggestions('').catch(() => []), // suggestions are a bonus; never fail the page
        loadLibrarian(),
      ]);
      setState({ healthData, healthLinkSuggestions, librarian, healthLoading: false });
    } catch {
      setState({ healthData: null, healthLoading: false });
    }
  }

  // The Librarian card's data. Each part degrades to null on its own (an old
  // server, telemetry off), so one failure never blanks the card or the page.
  async function loadLibrarian() {
    const [gaps, proposals, prune, settings] = await Promise.all([
      fetchKnowledgeGaps().catch(() => null),
      fetchLibrarianProposals('open').catch(() => null),
      fetchPruneCandidates().catch(() => null),
      fetchLibrarianSettings().catch(() => null),
    ]);
    return { gaps, proposals: proposals?.items ?? null, prune, settings };
  }

  async function runLibrarianPass() {
    if (getState().librarianRunning) return;
    setState({ librarianRunning: true });
    renderApp();
    try {
      const result = await runLibrarian('');
      const created = result.created?.length || 0;
      setState({ librarianRunning: false, librarianLastRun: { created, clusters: result.clusters?.length || 0, method: result.method } });
      showToast(created
        ? `Librarian filed ${created === 1 ? '1 proposal' : `${created} proposals`} for review.`
        : 'Librarian found nothing new to consolidate.');
      if (created) await loadDocuments?.();
      await loadHealth();
    } catch {
      setState({ librarianRunning: false });
      showToast('The librarian could not run. Please try again.');
    }
    renderApp();
  }

  async function decideProposal(id, decision) {
    try {
      const result = await decideLibrarianProposal(id, decision);
      if (decision === 'approve') {
        const superseded = (result.results || []).filter((r) => r.outcome === 'superseded').length;
        showToast(`Proposal approved — ${superseded === 1 ? '1 source' : `${superseded} sources`} superseded.`);
      } else {
        showToast('Proposal dismissed and archived.');
      }
      await loadDocuments?.();
      await loadHealth();
    } catch (error) {
      showToast(error?.reason === 'verify-first'
        ? 'Review and verify the proposal first, then approve it.'
        : `Could not ${decision} the proposal.`);
    }
    renderApp();
  }

  async function toggleLibrarianSchedule() {
    const current = Boolean(getState().librarian?.settings?.scheduleEnabled);
    try {
      const settings = await saveLibrarianSettings({ scheduleEnabled: !current });
      setState({ librarian: { ...(getState().librarian || {}), settings } });
    } catch {
      showToast('Could not change the librarian schedule.');
    }
    renderApp();
  }

  // Generation token so an in-flight scan whose Health view was left and re-entered
  // (or superseded by a newer scan) drops its result instead of clobbering state.
  let aiReviewToken = 0;

  async function goHealth() {
    if (!(await prepareEditorNavigation())) return false;
    // Clear any prior AI review and invalidate any in-flight scan on re-entry.
    aiReviewToken += 1;
    setState({ navType: 'health', editorFocus: false, healthAiReview: null, healthAiReviewError: null, healthAiReviewLoading: false });
    renderApp();
    loadHealth().then(renderApp);
    return true;
  }

  // On-demand AI review (contradictions + gaps). Advisory; spends model tokens.
  async function scanLibraryWithAi() {
    const state = getState();
    if (state.healthAiReviewLoading || !state.chatStatus?.available) return;
    const token = (aiReviewToken += 1);
    setState({ healthAiReviewLoading: true, healthAiReviewError: null });
    renderApp();
    try {
      const review = await runAiReview('');
      if (token !== aiReviewToken) return; // superseded by a newer scan or navigation
      if (review.reason === 'no-chat-model') {
        setState({ healthAiReviewLoading: false, healthAiReview: null, healthAiReviewError: 'No AI model configured — set one in Settings ▸ Intelligence.' });
      } else if (review.reason === 'ai-review-failed') {
        setState({ healthAiReviewLoading: false, healthAiReview: null, healthAiReviewError: 'The AI review could not complete. Please try again.' });
      } else {
        setState({ healthAiReviewLoading: false, healthAiReview: review });
      }
    } catch {
      if (token !== aiReviewToken) return;
      setState({ healthAiReviewLoading: false, healthAiReviewError: 'Could not complete the AI review.' });
    }
    if (token === aiReviewToken) renderApp();
  }

  // Compile (or refresh) this week's review and open it. One in flight at a
  // time — the button, the Today ritual row and the ⌘K command all come here.
  let weeklyReviewBusy = false;
  async function runWeeklyReview() {
    if (weeklyReviewBusy) return;
    weeklyReviewBusy = true;
    showToast('Compiling the week…');
    try {
      const result = await generateWeeklyReview();
      if (result.degraded) {
        showToast(result.message || 'Weekly review unavailable.');
        // A verified review still exists — open it so the refusal is legible.
        if (result.documentId) await openDocumentInEditor(result.documentId);
      } else {
        await loadDocuments();
        showToast(result.created ? 'Weekly review created.' : 'Weekly review updated.');
        await openDocumentInEditor(result.documentId);
      }
    } catch {
      showToast('Weekly review failed — Prax may be unreachable.');
    } finally {
      weeklyReviewBusy = false;
    }
  }

  function openDailyBrief() {
    setState({ dailyBriefOpen: true, dailyBriefNarrative: null, dailyBriefError: false, dailyBriefLoading: false });
    renderApp();
  }

  async function draftDailyBrief() {
    const state = getState();
    if (state.dailyBriefLoading) return;
    setState({ dailyBriefLoading: true, dailyBriefError: false });
    renderApp();
    try {
      const res = await narrateBrief(buildDailyBrief(state));
      if (res.narrative) setState({ dailyBriefLoading: false, dailyBriefNarrative: res.narrative });
      else setState({ dailyBriefLoading: false, dailyBriefError: res.reason === 'no-chat-model' ? 'No AI model configured — set one in Settings ▸ Intelligence. Showing the plain brief.' : 'Could not draft with AI. Showing the plain brief.' });
    } catch {
      setState({ dailyBriefLoading: false, dailyBriefError: 'Could not reach the AI model. Showing the plain brief.' });
    }
    renderApp();
  }

  async function copyDailyBrief() {
    const state = getState();
    const text = state.dailyBriefNarrative || buildDailyBrief(state);
    const ok = await copyToClipboard(text);
    showToast(ok ? 'Brief copied' : 'Could not copy');
  }

  // Accept a suggested wiki-link: link the first plain mention, then reload so the
  // suggestion (now satisfied) drops off the list.
  async function acceptLinkSuggestion(id, title) {
    if (!id || !title) return;
    try {
      await applyWikiLink(id, title);
      showToast(`Linked [[${title}]]`);
      await loadDocuments(); // the doc body changed
      await loadHealth();
    } catch (err) {
      showToast(err?.message || 'Could not add the link');
    }
    renderApp();
  }

  function openAskPrax() {
    // The Console shell asks on a page of its own (main.js); the overlay
    // remains for embedders without one.
    if (openAskPage) { openAskPage(); return; }
    // Keep the last query (handy to re-run) but clear any prior answer.
    askPraxToken += 1;
    setState({ askPraxOpen: true, askPraxResult: null, askPraxError: false, askPraxLoading: false, paletteOpen: false });
    renderApp();
  }

  function closeAskPrax() {
    askPraxToken += 1;
    setState({ askPraxOpen: false, askPraxLoading: false });
    renderApp();
  }

  async function runAskPrax(rawQuery) {
    const state = getState();
    const query = String(rawQuery || '').trim();
    if (!query) return;
    const token = (askPraxToken += 1);
    const isCurrent = () => token === askPraxToken
      && (state.askPraxOpen || state.navType === 'ask')
      && state.askPraxQuery === query;
    // On the Ask page the composer is a draft of the next question: asking
    // empties it, and the thread above shows the question being answered.
    setState({ askPraxQuery: query, askPraxLoading: true, askPraxError: false, askPraxResult: null, ...(state.navType === 'ask' ? { askDraft: '', askSuggest: null } : {}) });
    renderApp();
    try {
      const onPage = state.navType === 'ask';
      const scope = onPage ? (state.askScope || 'all') : 'all';
      const result = await askPrax(query, scope, onPage ? (state.askTrust || 'all') : 'all');
      if (!isCurrent()) return;
      // The scope travels with the answer: suggestions, notes and history read
      // it from here, not from the composer's later value.
      const scoped = { ...result, scope };
      setState({ askPraxLoading: false, askPraxResult: scoped });
      onAskResult?.(query, scoped);
    } catch {
      if (!isCurrent()) return;
      // The question comes back into the composer so a retry is one keypress.
      setState({ askPraxLoading: false, askPraxError: true, ...(onPage ? { askDraft: query } : {}) });
    }
    renderApp();
    // The result region is rebuilt with its content, so it is not announced.
    announce(state.askPraxError ? 'Ask Prax could not answer. Try again.' : 'Answer ready.');
  }

  async function copyAskPrax() {
    const state = getState();
    const r = state.askPraxResult;
    if (!r) return;
    const text = (typeof r.answer === 'string' && r.answer.trim()) ? r.answer : (r.markdown || '');
    if (!text) return;
    const ok = await copyToClipboard(text);
    showToast(ok ? 'Answer copied' : 'Could not copy');
  }

  // A generation keeps running after Esc (the server finishes it either way), so
  // reopening the dialog shows that request instead of offering a second one.
  let genRbInFlight = false;

  function openGenerateRunbook() {
    if (genRbInFlight) {
      setState({ genRbOpen: true, genRbLoading: true, genRbError: false, paletteOpen: false });
      renderApp();
      return;
    }
    const projects = captureProjectChoices().filter((p) => p.slug !== inboxSlug);
    setState({ genRbOpen: true, genRbLoading: false, genRbError: false, genRbDescription: '', genRbProject: projects[0]?.id || null, paletteOpen: false });
    renderApp();
  }

  async function runGenerateRunbook() {
    if (genRbInFlight) return;
    const description = String(getRoot().querySelector('[data-genrb-input]')?.value || '').trim();
    const project = getRoot().querySelector('[data-genrb-project]')?.value || '';
    if (!description) { setState({ genRbError: 'Describe the alert or incident first.' }); renderApp(); return; }
    if (!project) { setState({ genRbError: 'Pick a project for the runbook.' }); renderApp(); return; }
    genRbInFlight = true;
    setState({ genRbLoading: true, genRbError: false, genRbDescription: description, genRbProject: project });
    renderApp();
    let res;
    try {
      res = await generateRunbook(description, project);
    } catch (err) {
      genRbInFlight = false;
      setState({ genRbLoading: false, genRbError: err?.message || 'Could not generate the runbook.' });
      renderApp();
      return;
    }
    genRbInFlight = false;
    setState({ genRbOpen: false, genRbLoading: false });
    showToast('Runbook drafted — review, edit, and verify');
    // The draft exists; failing to open it is not a failed generation.
    try {
      if (!(await openDocumentInEditor(res.document.id))) showToast('Runbook drafted — find it in the Library to review it.', null, 7000);
    } catch { showToast('Runbook drafted — find it in the Library to review it.', null, 7000); }
  }

  // Delegated `input` of the Ask Prax field. Returns true when handled.
  function input(target) {
    const state = getState();
    if (target.matches?.('[data-ask-page-input]')) {
      // Typing a follow-up never cancels the answer being written.
      setState({ askDraft: target.value });
      target.style.height = 'auto';
      target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
      const submit = getRoot().querySelector('[data-action="run-ask-prax"]');
      if (submit) submit.disabled = !target.value.trim();
      return true;
    }
    if (target.matches?.('[data-ask-prax-input]')) {
      const wasLoading = state.askPraxLoading;
      if (wasLoading) askPraxToken += 1;
      setState({
        askPraxQuery: target.value,
        ...(wasLoading ? { askPraxLoading: false, askPraxError: false, askPraxResult: null } : {}),
      });
      if (wasLoading) {
        renderApp();
        return true;
      }
      const submit = getRoot().querySelector('[data-action="run-ask-prax"]');
      if (submit) submit.disabled = !target.value.trim();
      return true;
    }
    return false;
  }

  const actions = {
    'close-ask-prax': () => {
      closeAskPrax();
    },
    'run-ask-prax': () => {
      runAskPrax(getRoot().querySelector('[data-ask-page-input], [data-ask-prax-input]')?.value);
    },
    'open-ask-source': async (el) => {
      const documentId = el.dataset.documentId;
      closeAskPrax();
      if (documentId) await openDocumentInEditor(documentId);
    },
    'copy-ask-prax': () => {
      copyAskPrax();
    },
    'open-generate-runbook': () => {
      openGenerateRunbook();
    },
    'close-generate-runbook': () => {
      setState({ genRbOpen: false }); renderApp();
    },
    'run-generate-runbook': () => {
      runGenerateRunbook();
    },
    'open-daily-brief': () => {
      openDailyBrief();
    },
    'close-daily-brief': () => {
      setState({ dailyBriefOpen: false }); renderApp();
    },
    'generate-weekly-review': async () => {
      await runWeeklyReview();
    },
    'draft-daily-brief': () => {
      draftDailyBrief();
    },
    'copy-daily-brief': () => {
      copyDailyBrief();
    },
    'open-health': async () => {
      setState({ libraryMenuOpen: false }); await goHealth();
    },
    'refresh-health': async () => {
      await loadHealth(); renderApp();
    },
    'open-health-doc': async (el) => {
      await openDocumentInEditor(el.dataset.docId);
    },
    'apply-wiki-link': async (el) => {
      await acceptLinkSuggestion(el.dataset.docId, el.dataset.title);
    },
    'run-ai-review': async () => {
      await scanLibraryWithAi();
    },
    'run-librarian': async () => {
      await runLibrarianPass();
    },
    'decide-proposal': async (el) => {
      await decideProposal(el.dataset.proposalId, el.dataset.decision);
    },
    'toggle-librarian-schedule': async () => {
      await toggleLibrarianSchedule();
    },
    'toggle-health-review-sort': async () => {
      setState({ healthReviewSort: getState().healthReviewSort === 'recall' ? 'default' : 'recall' });
      await loadHealth(); renderApp();
    },
  };

  return {
    actions, input, loadHealth, goHealth, scanLibraryWithAi, runLibrarianPass, decideProposal, toggleLibrarianSchedule, runWeeklyReview, openDailyBrief, draftDailyBrief,
    copyDailyBrief, acceptLinkSuggestion, openAskPrax, closeAskPrax, runAskPrax, copyAskPrax,
    openGenerateRunbook, runGenerateRunbook,
  };
}
