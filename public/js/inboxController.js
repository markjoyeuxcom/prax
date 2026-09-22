import { localDayHeaders } from './dateHelpers.js';

const STORAGE_KEY = 'prax.inboxProcessing.v1';
export async function inboxRequest(path, body) {
  // The local day: completing a recurring capture schedules its successor from it.
  const response = await fetch(`/api/inbox${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...localDayHeaders() }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || 'Inbox request failed.'), { status: response.status, reason: result.reason });
  return result;
}

export function readInboxRecovery(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (!saved || saved.version !== 1) return { version: 1 };
    const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f-]{27}$/i.test(value);
    const active = saved.active;
    if (active && (!['task', 'document'].includes(active.kind) || !uuid(active.id)
      || !active.draft || typeof active.draft !== 'object'
      || Object.values(active.draft).some(value => typeof value !== 'string')
      || (active.request && (!uuid(active.request.operationId) || !/^[a-f0-9]{64}$/.test(active.request.fingerprint)
        || !['file', 'reference', 'complete', 'archive'].includes(active.request.action))))) saved.active = null;
    if (saved.undo && (!uuid(saved.undo.operationId) || typeof saved.undo.title !== 'string')) saved.undo = null;
    return saved;
  } catch { return { version: 1 }; }
}

export function createInboxController({ getState, setState, render, toast, refresh, openDocument, openTask,
  request = inboxRequest, storage }) {
  if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch { storage = null; } }
  let loadToken = 0, sourceToken = 0, summaryToken = 0;
  let saved = readInboxRecovery(storage);
  function state() { return getState().inbox || {}; }
  function patch(update) { setState({ inbox: { ...state(), ...update } }); }
  function processPatch(update) { patch({ processing: { ...state().processing, ...update } }); }
  function persist() {
    const p = state().processing;
    saved = { version: 1, undo: state().undo || null,
      active: p ? { kind: p.kind, id: p.id, draft: p.draft, request: p.request || null } : null };
    try { if (!storage) throw new Error('Storage unavailable'); storage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
    catch { if (p) processPatch({ storageWarning: 'This browser cannot retain the decision across reloads. Keep this window open until the result is confirmed.' }); }
  }
  function draw() {
    const focused = globalThis.document?.activeElement?.dataset?.inboxField;
    render();
    if (focused) globalThis.document?.querySelector(`[data-inbox-field="${focused}"]:not([disabled])`)?.focus({ preventScroll: true });
  }
  function focusStart(id) {
    const buttons = [...(globalThis.document?.querySelectorAll('[data-action="inbox-start"]') || [])];
    (buttons.find(button => id && button.dataset.id === id) || buttons.find(button => !button.dataset.id))?.focus({ preventScroll: true });
  }
  async function summary() {
    const token = ++summaryToken;
    try {
      const result = await request('?limit=1');
      if (token !== summaryToken) return;
      patch({ summary: result.summary, inboxId: result.inboxId, reviewCount: result.reviewCount });
    } catch { /* A visible queue load reports errors; background badges retain their last known state. */ }
  }
  async function load(view = state().view || 'pending', { append = false } = {}) {
    const token = ++loadToken;
    const previous = state().data;
    const offset = append ? previous?.page?.nextOffset : 0;
    if (append && !Number.isInteger(offset)) return;
    patch({ view, loading: true, error: '', ...(view !== state().view ? { data: null } : {}) });
    try {
      const result = await request(`?view=${view}&offset=${offset}&limit=50`);
      if (token !== loadToken) return;
      const items = append ? [...(previous?.items || []), ...result.items] : result.items;
      const seen = new Set();
      result.items = items.filter(item => { const key = `${item.kind}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true; });
      patch({ data: result, summary: result.summary, inboxId: result.inboxId, reviewCount: result.reviewCount, loading: false, error: '' });
    } catch (error) { if (token === loadToken) patch({ loading: false, error: error.message }); }
    if (token === loadToken) draw();
  }
  async function open(kind, id, { queue = [{ kind, id }], index = 0, recovery = null } = {}) {
    const token = ++sourceToken;
    patch({ processing: { kind, id, queue, index, loading: true, pending: false, error: '',
      draft: recovery?.draft || { projectId: '', plannedFor: '', documentType: '' }, request: recovery?.request || null,
      recovered: Boolean(recovery), suggestion: null, suggesting: false } });
    draw();
    try {
      const source = await request(`/items/${kind}/${id}`);
      if (token !== sourceToken) return;
      processPatch({ source, loading: false, draft: { ...state().processing.draft,
        documentType: state().processing.draft.documentType || source.record.documentType || 'reference' } });
      persist();
    } catch (error) { if (token === sourceToken) processPatch({ loading: false, error: error.message }); }
    if (token === sourceToken) draw();
  }
  async function start(kind, id) {
    if (saved.active) {
      if (!state().data || !state().data.projects) await load('pending');
      if (kind && (kind !== saved.active.kind || id !== saved.active.id)) toast('Resume or skip the unfinished decision before starting another item.');
      return open(saved.active.kind, saved.active.id, { recovery: saved.active });
    }
    if (!state().data || state().view !== 'pending') await load('pending');
    const queue = state().data?.items || [];
    const index = kind ? queue.findIndex(item => item.kind === kind && item.id === id) : 0;
    const current = kind ? { kind, id } : queue[0];
    if (!current) { toast('Inbox has no pending captures.'); return; }
    await open(current.kind, current.id, { queue: index < 0 ? [current] : queue, index: Math.max(0, index) });
  }
  async function next() {
    const p = state().processing;
    const target = p.queue[p.index + 1];
    ++sourceToken;
    patch({ processing: null }); persist();
    if (target) return open(target.kind, target.id, { queue: p.queue, index: p.index + 1 });
    draw(); await load('pending');
    toast('This pass is finished. Skipped and newly captured items remain in Inbox.');
    focusStart();
  }
  function close() {
    if (state().processing?.pending) { toast('Wait for this decision to finish.'); return; }
    const id = state().processing?.id;
    persist(); ++sourceToken; patch({ processing: null }); draw(); focusStart(id);
  }
  function change(field, value) {
    if (!['projectId', 'plannedFor', 'documentType'].includes(field) || !state().processing || state().processing.request) return;
    processPatch({ draft: { ...state().processing.draft, [field]: value } }); persist();
  }
  async function apply(action) {
    const p = state().processing;
    if (!p || (!p.source && !p.request) || p.pending) return;
    let intent = p.request;
    if (!intent) {
      if (['file', 'reference'].includes(action) && !p.draft.projectId) { processPatch({ error: 'Choose the owning project before filing.' }); draw(); return; }
      intent = { operationId: crypto.randomUUID(), fingerprint: p.source.fingerprint, action,
        ...(['file', 'reference'].includes(action) ? { projectId: p.draft.projectId } : {}),
        ...(action === 'file' && p.kind === 'task' && p.draft.plannedFor ? { plannedFor: p.draft.plannedFor } : {}),
        ...(action === 'file' && p.kind === 'document' && p.draft.documentType ? { documentType: p.draft.documentType } : {}) };
    }
    processPatch({ request: intent, pending: true, error: '' }); persist(); draw();
    try {
      const result = await request(`/items/${p.kind}/${p.id}/actions`, intent);
      patch({ undo: result.undone ? null : { operationId: result.operationId, title: p.source?.record.title || 'Recovered Inbox item', action: result.action } });
      // Keep the decision locked through refresh and queue advancement.
      // Otherwise a second click can race the successful response.
      let refreshFailed = false;
      try { await refresh(); } catch { refreshFailed = true; }
      const notice = result.undone ? 'This decision was already undone.' : `Decision saved.${result.indexingDegraded ? ' Search indexing needs a retry in Settings.' : ''}${refreshFailed ? ' The workspace could not refresh; reload it.' : ''}`;
      patch({ notice });
      toast(notice);
      await next();
    } catch (error) {
      processPatch({ pending: false, error: error.status && error.status < 500 ? error.message
        : 'The result is unconfirmed. Retry this same decision to reconcile it safely.',
        ...(error.status && error.status < 500 ? { request: null } : {}) });
      persist(); draw();
    }
  }
  async function undo() {
    const entry = state().undo;
    if (!entry || state().undoPending) return;
    patch({ undoPending: true }); draw();
    try {
      await request(`/actions/${entry.operationId}/undo`, {});
      patch({ undo: null }); persist();
      await Promise.allSettled([refresh(), load(state().view)]);
      toast('Decision undone. Any generated reference or recurring task was retained in Archive.');
    } catch (error) { toast(error.status ? error.message : 'Undo is unconfirmed. Retry Undo to reconcile it safely.', null, 8000); }
    patch({ undoPending: false }); draw();
  }
  async function suggest() {
    const p = state().processing;
    if (!p?.source || p.suggesting || p.pending || p.request) return;
    const token = sourceToken;
    processPatch({ suggesting: true, suggestion: null, error: '' }); draw();
    try {
      const suggestion = await request(`/items/${p.kind}/${p.id}/suggest`, { fingerprint: p.source.fingerprint });
      if (token !== sourceToken) return;
      processPatch({ suggesting: false, suggestion });
    } catch (error) { if (token === sourceToken) processPatch({ suggesting: false, error: error.message }); }
    if (token === sourceToken) draw();
  }
  function useSuggestion() {
    const p = state().processing, suggestion = p?.suggestion;
    if (!suggestion || p.request || suggestion.fingerprint !== p.source?.fingerprint) return;
    processPatch({ draft: { ...p.draft, projectId: suggestion.projectId || p.draft.projectId,
      documentType: p.kind === 'document' ? suggestion.documentType || p.draft.documentType : p.draft.documentType } });
    persist(); draw();
  }
  async function openRecord(kind, id) { if (state().processing?.pending) return; if (state().processing) close(); if (kind === 'document') await openDocument(id); else await openTask(id); }
  function keydown(event) {
    if (!state().processing) return false;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const dialog = globalThis.document.querySelector('[data-inbox-dialog]');
      const nodes = [...dialog.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]')];
      const first = nodes[0], last = nodes.at(-1);
      if (!nodes.includes(globalThis.document.activeElement) || (!event.shiftKey && globalThis.document.activeElement === last)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last?.focus(); }
    }
    return true;
  }
  patch({ view: 'pending', data: null, undo: saved.undo || null, recoveryAvailable: Boolean(saved.active) });
  return { load, summary, start, openRecord, apply, undo, suggest, useSuggestion, close, change, keydown,
    skip: async () => { if (!state().processing?.request && !state().processing?.pending) await next(); },
    reload: async () => { const p = state().processing; if (p && !p.request && !p.pending) await open(p.kind, p.id, { queue: p.queue, index: p.index, recovery: { draft: p.draft } }); },
  };
}
