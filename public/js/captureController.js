// Quick capture — controller, with the NL layer of Tier-3 #8 (⌘↵ AI parse in
// capture and the ✦ Translate of the Filter view). Capture is a modal layer
// over an unchanged workspace; a create carries a client id so an unchanged
// retry is exact-once, and the unfinished capture survives a reload.
// Dependencies are injected (inboxController.js pattern); handleAction
// delegates the capture and NL data-actions here.

import { createTask as apiCreateTask, fetchTask as apiFetchTask, parseNlCapture as apiParseNlCapture, parseNlFilter as apiParseNlFilter } from './taskApi.js';
import { apiStatus } from './statusMap.js';
import { projectResolver } from './taskFilter.js';
import { taskMatchesCreatePayload } from './taskCreateOutcome.js';
import {
  captureIntentKey, clearTaskCaptureRecovery, loadTaskCaptureRecovery, storeTaskCaptureRecovery,
} from './taskCaptureRecovery.js';
import { parseCaptureShorthand, mergeNlCapture } from './captureShorthand.js';
import { syncModalInert } from './modalFocus.js';

export function createCaptureController({
  getState, setState, renderApp, showToast, getRoot, loadTasks, defaultProjectId, inboxProjectId, todayISODate,
  renderOverlaysHtml, doc = globalThis.document,
  createTask = apiCreateTask, fetchTask = apiFetchTask, parseNlCapture = apiParseNlCapture, parseNlFilter = apiParseNlFilter,
  randomUUID = () => globalThis.crypto.randomUUID(),
}) {
  let captureReturnElement = null;

  // Context-derived capture defaults: destination + due/status reflect the view
  // you're in, so a new task lands where you'd expect — a project view targets
  // that project; Today targets Inbox and pre-sets a due-today; a Backlog tab
  // pre-sets backlog status; everything else falls to Inbox.
  function captureDefaults() {
    const state = getState();
    const fromProject = state.navType === 'project' ? state.navId : null;
    const onBacklog = state.navType === 'project' && state.tab === 'backlog';
    return {
      captureProjectId: fromProject || inboxProjectId() || state.projects[0]?.id || null,
      captureDueDate: state.navType === 'today' ? todayISODate() : null,
      captureStatus: onBacklog ? 'backlog' : 'planned',
      captureMenuOpen: false,
    };
  }

  function taskCaptureStorage() {
    try { return window.localStorage; } catch { return null; }
  }

  function captureRecoveryDraft() {
    const state = getState();
    return {
      query: state.captureQuery,
      projectId: state.captureProjectId,
      dueDate: state.captureDueDate,
      status: state.captureStatus,
      nlFields: state.nlCaptureFields,
      nlDropped: state.nlCaptureDropped,
      nlRaw: state.nlCaptureRaw,
      requestPayload: state.captureRequestPayload,
      requestIntent: state.captureRequestIntent,
    };
  }

  function persistCaptureRecovery(options) {
    return storeTaskCaptureRecovery(taskCaptureStorage(), captureRecoveryDraft(), options);
  }

  function clearCaptureRequestPatch() {
    return {
      captureRequestPayload: null,
      captureRequestIntent: null,
      captureError: null,
      captureRecovered: false,
    };
  }

  function openFreshCapture() {
    const state = getState();
    if (state.captureSubmitting) return false;
    captureReturnElement = globalThis.HTMLElement && doc.activeElement instanceof globalThis.HTMLElement ? doc.activeElement : null;
    // Owner-guarded (no force): starting fresh HERE is not a verdict on a draft
    // another tab is still typing — only this tab's own leftover is dropped.
    clearTaskCaptureRecovery(taskCaptureStorage());
    setState({
      captureOpen: true,
      captureQuery: '',
      captureSubmitting: false,
      paletteOpen: false,
      ...captureDefaults(),
      ...clearCaptureRequestPatch(),
      ...nlCaptureResetPatch(),
    });
    renderCaptureOverlayLayer();
    return true;
  }

  function discardCapture() {
    const state = getState();
    if (state.captureSubmitting) return false;
    // force only when THIS tab displays capture content the user is throwing
    // away (typed text, a parsed preview, a restored recovery, or a pending
    // retry identity) — a restored draft may still carry a stale owner stamp
    // that an owner-guarded clear would resurrect. Closing an EMPTY capture
    // (Esc, palette, assistant) expresses no verdict on another tab's stored
    // draft, so that clear stays owner-guarded.
    const displaysDraft = Boolean(state.captureQuery
      || state.nlCaptureFields || state.captureRecovered || state.captureRequestPayload);
    clearTaskCaptureRecovery(taskCaptureStorage(), { force: displaysDraft });
    setState({
      captureOpen: false,
      captureQuery: '',
      captureMenuOpen: false,
      captureSubmitting: false,
      ...clearCaptureRequestPatch(),
      ...nlCaptureResetPatch(),
    });
    return true;
  }

  function restoreCaptureRecovery() {
    const state = getState();
    const recovery = loadTaskCaptureRecovery(taskCaptureStorage());
    if (!recovery) return false;
    if (recovery.requestPayload) {
      const observed = state.tasks.find(task => task.id === recovery.requestPayload.id);
      if (taskMatchesCreatePayload(observed, recovery.requestPayload)) {
        // force: the stored payload was confirmed created — it is stale for
        // every tab, and its owner token predates this reload anyway.
        clearTaskCaptureRecovery(taskCaptureStorage(), { force: true });
        showToast('Task was added before reload.');
        return false;
      }
    }
    const knownProjects = new Set((state.projects || []).map(project => project.id));
    const projectId = knownProjects.has(recovery.projectId)
      ? recovery.projectId
      : (inboxProjectId() || state.projects[0]?.id || null);
    const requestProject = recovery.requestPayload?.project;
    const keepRequest = !requestProject || knownProjects.has(requestProject);
    setState({
      captureOpen: true,
      captureQuery: recovery.query,
      captureProjectId: projectId,
      captureDueDate: recovery.dueDate,
      captureStatus: recovery.status === 'backlog' ? 'backlog' : 'planned',
      captureMenuOpen: false,
      captureSubmitting: false,
      captureError: 'Recovered unfinished task.',
      captureRecovered: true,
      captureRequestPayload: keepRequest ? recovery.requestPayload : null,
      captureRequestIntent: keepRequest ? recovery.requestIntent : null,
      nlCaptureLoading: false,
      nlCaptureFields: recovery.nlFields,
      nlCaptureDropped: recovery.nlDropped,
      nlCaptureRaw: recovery.nlRaw,
      nlCaptureError: null,
    });
    // Adopt the draft into THIS tab: the stored stamp predates this load, and
    // without a re-stamp the tab could never clear or empty its own restored
    // draft (owner-guarded paths would refuse forever). Single-slot trade-off:
    // if two tabs restore the same draft, the later adoption wins the slot.
    persistCaptureRecovery({ force: true });
    return true;
  }

  // Capture is a modal layer over an otherwise unchanged workspace. Opening or
  // closing it must not rebuild thousands of task objects, the sidebar, or an
  // editor. Internal capture mutations may still choose a full render when the
  // underlying collection genuinely changed (for example after task creation).
  function renderCaptureOverlayLayer({ restoreFocus = false } = {}) {
    const state = getState();
    const root = getRoot()?.querySelector('[data-overlay-root]');
    if (!root) {
      renderApp();
      return;
    }
    root.innerHTML = renderOverlaysHtml();
    syncModalInert(getRoot());
    if (state.captureOpen) {
      const input = root.querySelector('[data-capture-input]');
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    } else if (restoreFocus && captureReturnElement?.isConnected) {
      captureReturnElement.focus();
      captureReturnElement = null;
    }
  }

  // ---- NL capture & NL→filter (Tier-3 #8) ------------------------------------
  // Generation tokens + abort controllers for the two NL calls: bumped on every
  // run/cancel/close so a stale response can never resurrect a dismissed preview
  // (the writeToken pattern), and aborted so a hung local model doesn't hold the
  // speed-critical capture flow hostage.
  let nlCaptureToken = 0;
  let nlFilterToken = 0;
  let nlCaptureAbort = null;
  let nlFilterAbort = null;
  const NL_TIMEOUT_MS = 20000;

  // Everything the NL layer holds, reset in one place (capture open/close, view
  // navigation, cancel).
  function nlCaptureResetPatch() {
    nlCaptureToken += 1;
    nlCaptureAbort?.abort();
    nlCaptureAbort = null;
    return { nlCaptureLoading: false, nlCaptureFields: null, nlCaptureDropped: [], nlCaptureRaw: null, nlCaptureError: null };
  }

  function nlFilterResetPatch() {
    nlFilterToken += 1;
    nlFilterAbort?.abort();
    nlFilterAbort = null;
    return { nlFilterLoading: false, nlFilterSource: null, nlFilterWarnings: [], nlFilterError: null };
  }

  // Bounded grounding for the NL prompts — the client owns what the user sees.
  function nlGrounding() {
    const state = getState();
    const projects = (state.projects || []).filter((p) => p.slug).map((p) => ({ slug: p.slug, name: p.name }));
    const labels = new Set();
    for (const task of state.tasks || []) {
      for (const label of task.labels || []) labels.add(label);
    }
    return { projects, labels: [...labels].slice(0, 50) };
  }

  // The input value we last set from a parse (the cleaned title) — lets the ⌘↵
  // chord tell "re-parse the same phrase" (input unedited → resend the preserved
  // raw text) from "parse what I just typed" (input edited).
  let nlCaptureSetQuery = null;

  // ⌘↵ in capture: parse the typed text with the AI, preview the fields as chips.
  // The cleaned title replaces the input (still editable); nothing is created
  // until plain Enter confirms. Falls through to the plain add when no model is
  // configured — the chord must never be a dead keystroke.
  async function runNlCapture() {
    const state = getState();
    const current = (state.captureQuery || '').trim();
    if (!current || state.nlCaptureLoading || state.captureSubmitting) return;
    if (!state.chatStatus?.available) { addQuickTask(current); return; }
    // Re-parse (⌘↵ with an unedited preview) resends the ORIGINAL phrase — the
    // visible title no longer carries the date/priority words the first parse
    // extracted. An edited input is a new phrase and becomes the new raw.
    const unedited = state.nlCaptureFields && nlCaptureSetQuery != null && state.captureQuery === nlCaptureSetQuery;
    const text = unedited && state.nlCaptureRaw ? state.nlCaptureRaw : current;
    const raw = text;
    const sentQuery = state.captureQuery; // input at send time (divergence guard)
    const token = (nlCaptureToken += 1);
    nlCaptureAbort?.abort();
    nlCaptureAbort = new AbortController();
    const timer = setTimeout(() => nlCaptureAbort?.abort(), NL_TIMEOUT_MS);
    setState({
      nlCaptureLoading: true,
      nlCaptureError: null,
      nlCaptureFields: null,
      nlCaptureDropped: [],
      nlCaptureRaw: raw,
      ...clearCaptureRequestPatch(),
    });
    persistCaptureRecovery();
    renderApp();
    try {
      const res = await parseNlCapture({ text, date: todayISODate(), ...nlGrounding() }, { signal: nlCaptureAbort.signal });
      // Drop a stale response: cancelled/superseded, capture closed, or the user
      // typed while it was in flight (their text wins over our parse of old text).
      if (token !== nlCaptureToken || !state.captureOpen || state.captureQuery !== sentQuery) return;
      if (res.degraded) {
        setState({
          nlCaptureLoading: false,
          nlCaptureError: res.reason === 'no-chat-model'
            ? 'No AI model configured — set one in Settings ▸ Intelligence.'
            : 'The model could not parse this — ↵ adds the task as typed.',
        });
      } else {
        // Sigiled tokens in the typed text override the model (mergeNlCapture).
        const merged = mergeNlCapture(text, res.fields || {});
        const { title, ...fields } = merged;
        // Capture-from-Today seeds a due-today default; surface it as a chip so
        // the preview shows EVERY field the created task will carry (and removal
        // works). confirmNlCapture uses the preview alone — no invisible fallback.
        if (!fields.dueDate && state.captureDueDate) fields.dueDate = state.captureDueDate;
        if (state.planMode?.mode === 'plan') fields.plannedFor = todayISODate();
        nlCaptureSetQuery = title || text;
        setState({
          nlCaptureLoading: false,
          nlCaptureFields: fields,
          nlCaptureDropped: res.dropped || [],
          captureQuery: nlCaptureSetQuery,
        });
      }
    } catch (err) {
      if (token !== nlCaptureToken || !state.captureOpen || state.captureQuery !== sentQuery) return;
      setState({
        nlCaptureLoading: false,
        nlCaptureError: err?.name === 'AbortError'
          ? 'The model took too long — ↵ adds the task as typed, or ⌘↵ retries.'
          : 'Could not reach the model — ↵ adds the task as typed.',
      });
    } finally {
      clearTimeout(timer);
    }
    if (token === nlCaptureToken) persistCaptureRecovery();
    if (token === nlCaptureToken) renderApp();
  }

  // First Esc with a preview (or parse in flight): abort/discard; the overlay
  // stays open. The typed text is restored only when a preview replaced it —
  // after a failed parse the input was never touched, so Esc must not revert
  // edits the user made since (it just clears the error).
  function cancelNlCapture() {
    const state = getState();
    if (state.captureSubmitting) return;
    const raw = state.nlCaptureFields ? state.nlCaptureRaw : null;
    setState({
      ...nlCaptureResetPatch(),
      ...(raw != null ? { captureQuery: raw } : {}),
      ...clearCaptureRequestPatch(),
    });
    persistCaptureRecovery();
    renderApp();
  }

  // One create path for both capture flows (deterministic + NL preview): resolve
  // the destination, translate design-vocab status at the API boundary, create,
  // close + reset, toast. A client UUID makes retry exact-once; a failed POST is
  // reconciled with one canonical read before the UI calls it a failure.
  async function createCapturedTaskWithReadback(payload) {
    try {
      return { task: await createTask(payload), reconciled: false };
    } catch (writeError) {
      try {
        const observed = await fetchTask(payload.id);
        if (taskMatchesCreatePayload(observed, payload)) {
          return { task: observed, reconciled: true };
        }
      } catch {
        // The original error is the useful failure; the retry identity remains
        // stored so the unchanged create can safely be attempted again.
      }
      throw writeError;
    }
  }

  async function submitCapturedTask(fields) {
    const state = getState();
    if (state.captureSubmitting) return;
    const title = fields.title;
    if (!title) {
      setState({ captureError: 'Add a task title.', captureRecovered: false });
      persistCaptureRecovery();
      renderApp();
      return;
    }
    let project = state.captureProjectId || defaultProjectId();
    if (fields.project) {
      const resolved = projectResolver(state.projects)(fields.project);
      if (resolved) project = resolved; // an explicit/parsed project overrides the destination
    }
    if (!project) {
      setState({ captureError: 'Create a project before adding this task.' });
      persistCaptureRecovery();
      renderApp();
      return;
    }
    const intent = captureIntentKey({
      query: state.captureQuery,
      projectId: state.captureProjectId,
      dueDate: state.captureDueDate,
      status: state.captureStatus,
      nlFields: state.nlCaptureFields,
    });
    const reusable = state.captureRequestIntent === intent && state.captureRequestPayload;
    const payload = reusable || {
      id: randomUUID(),
      title,
      description: '',
      notes: '',
      priority: fields.priority || 'medium',
      // captureStatus is design vocab ('backlog'|'planned') — translate at the
      // API boundary ('backlog' → 'notes'); sending it raw 400s.
      status: apiStatus(state.captureStatus || 'planned'),
      project,
      dueDate: fields.dueDate || null,
      dueTime: fields.dueDate ? fields.dueTime || null : null,
      recurrence: fields.recurrence || null,
      labels: fields.labels || [],
      sortOrder: state.tasks.length,
      ...(fields.plannedFor ? { plannedFor: fields.plannedFor } : {}),
    };
    setState({
      captureSubmitting: true,
      captureError: null,
      captureRecovered: false,
      captureMenuOpen: false,
      captureRequestPayload: payload,
      captureRequestIntent: intent,
    });
    persistCaptureRecovery();
    renderApp();
    let outcome;
    try {
      outcome = await createCapturedTaskWithReadback(payload);
    } catch (writeError) {
      // A deterministic 4xx rejection is not retry-safe advice: the server
      // said no to THIS payload/identity, so repeating it unchanged can only
      // fail (or 409 forever on the same id). Drop the retry identity so the
      // next submit mints a fresh one, and say what actually happened.
      const permanent = Number.isInteger(writeError?.status)
        && writeError.status >= 400 && writeError.status < 500;
      setState({
        captureSubmitting: false,
        ...(permanent ? { captureRequestPayload: null, captureRequestIntent: null } : {}),
        captureError: permanent
          ? `The server rejected this capture: ${writeError.message}. Edit it and try again.`
          : 'Could not confirm creation. Your task is saved here; retry unchanged is safe.',
      });
      persistCaptureRecovery();
      renderApp();
      return;
    }
    // Owner-guarded (no force): the entry is this tab's own fulfilled draft —
    // typing and restore both stamp this tab as owner. A foreign stamp means
    // another tab took the slot for ITS draft, which this success says nothing
    // about, so that entry must survive.
    clearTaskCaptureRecovery(taskCaptureStorage());
    setState({
      captureOpen: false,
      captureQuery: '',
      captureMenuOpen: false,
      captureSubmitting: false,
      ...clearCaptureRequestPatch(),
      ...nlCaptureResetPatch(),
    });
    let refreshed = true;
    try { await loadTasks(); } catch { refreshed = false; }
    const name = state.projects.find(p => p.id === payload.project)?.name || 'project';
    showToast(refreshed ? `Added to ${name}` : `Added to ${name}; reload to show it.`);
    renderApp();
    return outcome.task;
  }

  // Plain Enter with a preview showing: create the previewed task. The input is
  // the (editable) title — sigils typed into it after the parse still win via a
  // re-merge (they are visible in the input, so the preview stays truthful).
  async function confirmNlCapture() {
    const state = getState();
    const fields = mergeNlCapture(state.captureQuery, { ...state.nlCaptureFields, title: '' });
    // The preview is authoritative: what you see is exactly what gets created
    // (the due-today default was already surfaced as a removable chip).
    await submitCapturedTask(fields);
  }

  // ✦ Translate in the Filter view: the input's English becomes a grammar string
  // in the same input — transparent, editable, saveable. An invalid expression is
  // still landed (the existing error hint explains it) rather than discarded.
  async function runNlFilter() {
    const state = getState();
    const text = (state.activeFilterExpr || '').trim();
    if (!text || state.nlFilterLoading || !state.chatStatus?.available) return;
    const token = (nlFilterToken += 1);
    nlFilterAbort?.abort();
    nlFilterAbort = new AbortController();
    const timer = setTimeout(() => nlFilterAbort?.abort(), NL_TIMEOUT_MS);
    setState({ nlFilterLoading: true, nlFilterError: null, nlFilterWarnings: [] });
    renderApp();
    try {
      const res = await parseNlFilter({ text, date: todayISODate(), ...nlGrounding() }, { signal: nlFilterAbort.signal });
      // Drop a stale response: superseded, or the user left the Filter view —
      // a late translation must not mutate the expression under another view.
      if (token !== nlFilterToken || state.navType !== 'filter') return;
      if (res.degraded) {
        setState({
          nlFilterLoading: false,
          nlFilterError: res.reason === 'no-chat-model'
            ? 'No AI model configured — set one in Settings ▸ Intelligence.'
            : 'The model could not translate this. Try rephrasing.',
        });
      } else if (res.expr) {
        setState({
          nlFilterLoading: false,
          activeFilterExpr: res.expr,
          activeSmartViewId: null,
          nlFilterSource: text,
          nlFilterWarnings: res.warnings || [],
        });
      } else {
        setState({ nlFilterLoading: false, nlFilterError: 'The model could not produce a filter. Try rephrasing.' });
      }
    } catch (err) {
      if (token !== nlFilterToken || state.navType !== 'filter') return;
      setState({
        nlFilterLoading: false,
        nlFilterError: err?.name === 'AbortError' ? 'The model took too long — try again.' : 'Could not reach the model.',
      });
    } finally {
      clearTimeout(timer);
    }
    if (token === nlFilterToken && state.navType === 'filter') {
      renderApp();
      const input = getRoot().querySelector('[data-filter-input]');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  }

  async function addQuickTask(rawTitle) {
    const state = getState();
    // Shorthand (!high, tomorrow, fri, 2026-09-01, #project, @label) is parsed out
    // of the typed text; an explicit token wins over the view-derived defaults
    // (here the due-today default applies invisibly — unlike the NL preview,
    // which surfaces it as a removable chip and is authoritative on its own).
    const { title, priority, dueDate, project: projectToken, labels } = parseCaptureShorthand(rawTitle);
    await submitCapturedTask({
      title, priority, project: projectToken, labels,
      dueDate: dueDate || state.captureDueDate || null,
      // Captured mid-planning: the new task joins today's working set.
      ...(state.planMode?.mode === 'plan' ? { plannedFor: todayISODate() } : {}),
    });
  }

  // Delegated `input` of the capture field. Returns true when handled.
  function input(target) {
    const state = getState();
    if (target.matches?.('[data-capture-input]')) {
      // Keep the exact-once retry identity: submit compares the current
      // intent key against the stored one, so typing a character and
      // deleting it again still reuses the SAME request id — clearing here
      // minted a fresh id and made "retry unchanged" able to duplicate.
      setState({ captureQuery: target.value, captureError: null, captureRecovered: false });
      persistCaptureRecovery();
      const submit = getRoot().querySelector('[data-action="submit-capture"]');
      if (submit) submit.disabled = !target.value.trim();
      getRoot().querySelector('.capture__notice')?.remove();
      return true;
    }
    return false;
  }

  // Enter in the capture field and ⌘↵ in the filter field. Returns true when
  // the key was one of theirs (the keyboard dispatcher's workspace layer).
  function keydown(event) {
    const state = getState();
    const target = event.target;
    if (target.matches?.('[data-capture-input]') && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (event.repeat) return true; // held-down Enter must not machine-gun creates
      if (state.captureSubmitting) return true;
      // ⌘/Ctrl+Enter = AI smart add (falls through to a plain add when no model
      // is configured); plain Enter confirms a preview or adds deterministically.
      if (event.metaKey || event.ctrlKey) { runNlCapture(); return true; }
      if (state.nlCaptureLoading) return true; // parse in flight — Esc cancels it
      if (state.nlCaptureFields) { confirmNlCapture(); return true; }
      addQuickTask(state.captureQuery.trim());
      return true;
    }
    if (target.matches?.('[data-filter-input]') && event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      runNlFilter();
      return true;
    }
    return false;
  }

  const actions = {
    'nl-filter': async () => {
      await runNlFilter();
    },
    'restore-nl-query': () => {
      const state = getState();
      const source = state.nlFilterSource;
      if (source != null) {
        setState({ activeFilterExpr: source, activeSmartViewId: null, ...nlFilterResetPatch() });
        renderApp();
        const input = getRoot().querySelector('[data-filter-input]');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      }
    },
    'drop-nl-field': (el) => {
      const state = getState();
      if (!state.nlCaptureFields || state.captureSubmitting) return;
      const fields = { ...state.nlCaptureFields };
      delete fields[el.dataset.field];
      if (el.dataset.field === 'dueDate') delete fields.dueTime; // a time needs its date
      setState({ nlCaptureFields: fields, ...clearCaptureRequestPatch() });
      persistCaptureRecovery();
      renderApp();
    },
    'drop-nl-label': (el) => {
      const state = getState();
      if (!state.nlCaptureFields || state.captureSubmitting) return;
      const labels = (state.nlCaptureFields.labels || []).filter((l) => l !== el.dataset.value);
      const fields = { ...state.nlCaptureFields };
      if (labels.length) fields.labels = labels;
      else delete fields.labels;
      setState({ nlCaptureFields: fields, ...clearCaptureRequestPatch() });
      persistCaptureRecovery();
      renderApp();
    },
    'open-capture': () => {
      openFreshCapture();
    },
    'toggle-capture-menu': () => {
      const state = getState();
      if (!state.captureSubmitting) { setState({ captureMenuOpen: !state.captureMenuOpen }); renderApp(); }
    },
    'set-capture-project': (el) => {
      const state = getState();
      if (!state.captureSubmitting) {
        setState({ captureProjectId: el.dataset.projectId, captureMenuOpen: false, ...clearCaptureRequestPatch() });
        persistCaptureRecovery();
        renderApp();
      }
    },
    'close-capture': () => {
      if (discardCapture()) renderCaptureOverlayLayer({ restoreFocus: true });
    },
    'submit-capture': async () => {
      const state = getState();
      if (state.captureSubmitting || state.nlCaptureLoading) return;
      if (state.nlCaptureFields) await confirmNlCapture();
      else await addQuickTask(state.captureQuery.trim());
    },
  };

  return {
    actions, input, keydown, openFreshCapture, discardCapture, restoreCaptureRecovery, renderCaptureOverlayLayer,
    cancelNlCapture, nlFilterResetPatch, runNlCapture, confirmNlCapture, runNlFilter, addQuickTask, submitCapturedTask,
  };
}
