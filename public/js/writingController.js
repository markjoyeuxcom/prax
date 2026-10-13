// Editor AI writing actions (Tier-3 #7) — controller. Draft, summarize,
// rewrite or turn into a checklist the selection (captured when the ✦ menu
// opens) or the whole document, preview the result, and apply it to the
// editor buffer only when the person chooses — unsaved, like typing.
// Dependencies are injected (inboxController.js pattern); handleAction
// delegates the writing data-actions here.

import { runWritingAction as apiRunWritingAction } from './libraryApi.js';
import { WRITE_ACTIONS } from './renderEditor.js';

export function createWritingController({
  getState, setState, renderApp, showToast, copyToClipboard, getEditor, destroyEditorController,
  handleDocumentDraftBodyChange, runWritingAction = apiRunWritingAction,
}) {
  const WRITE_LABELS = Object.fromEntries(WRITE_ACTIONS);
  // Bumped on every run/close/navigation so a request that resolves after the
  // user cancelled (or started another) is dropped instead of resurrecting the
  // overlay. Mirrors aiReviewToken.
  let writeToken = 0;

  function currentEditorDoc() {
    const state = getState();
    return state.documents.find((d) => d.id === state.editorDocId) || null;
  }

  // Run a writing action over the selection (if any) or the whole document, then
  // open the preview overlay. Nothing touches the document until the human applies.
  async function runWrite(action) {
    const state = getState();
    if (!WRITE_LABELS[action] || state.navType !== 'editor') return;
    const doc = currentEditorDoc();
    const body = state.documentDraftBody || '';
    // Selection was captured when the menu opened (see toggle-write-menu); fall
    // back to a live read for any programmatic caller.
    const stash = state.writeSelection || null;
    const range = stash ? { from: stash.from, to: stash.to } : (getEditor()?.getSelectionRange?.() || null);
    const rawSel = stash ? stash.text : String(getEditor()?.getSelectionText?.() || '');
    const selText = rawSel.trim() ? rawSel : '';
    let payload;
    let mode;
    let verb;
    let selStart = null;
    let selEnd = null;
    if (action === 'draft') {
      payload = { action, title: doc?.title || '', documentType: doc?.documentType || '' };
      mode = 'whole';
      verb = body.trim() ? 'Replace document' : 'Insert draft';
    } else if (action === 'summarize') {
      const source = selText || body;
      if (!source.trim()) { showToast('Nothing to summarize — the document is empty.'); setState({ writeMenuOpen: false, writeSelection: null }); renderApp(); return; }
      payload = { action, text: source };
      mode = 'prepend';
      verb = 'Insert summary at top';
    } else { // rewrite | checklist
      const useSel = Boolean(selText);
      if (!useSel && !body.trim()) { showToast(`Nothing to ${action === 'checklist' ? 'convert' : 'rewrite'} — the document is empty.`); setState({ writeMenuOpen: false, writeSelection: null }); renderApp(); return; }
      payload = { action, text: useSel ? selText : body };
      mode = useSel ? 'selection' : 'whole';
      verb = useSel ? 'Replace selection' : 'Replace document';
      if (useSel && range) { selStart = range.from; selEnd = range.to; }
    }
    const token = (writeToken += 1);
    // The INPUT the action ran on (the captured selection, or the document),
    // kept apart from the insertion mode: Summarize reads a selection but
    // inserts at the top, and a retry must send exactly what was sent.
    const input = selText && action !== 'draft' ? { from: range?.from ?? null, to: range?.to ?? null, text: selText } : null;
    setState({
      writeMenuOpen: false, writeSelection: null,
      writeContext: { action, label: WRITE_LABELS[action], verb, mode, docId: state.editorDocId, selText: mode === 'selection' ? selText : '', selStart, selEnd, input, model: null, verified: Boolean(doc?.verified) },
      writeResult: null, writeLoading: true, writeError: null,
    });
    renderApp();
    try {
      const res = await runWritingAction(payload);
      if (token !== writeToken) return; // cancelled or superseded
      if (res.degraded) {
        setState({ writeLoading: false, writeError: res.reason === 'no-chat-model' ? 'No AI model configured — set one in Settings ▸ Intelligence.' : res.reason === 'truncated' ? 'The model’s output was cut off at its length limit, so there is no complete result to apply. Try a shorter selection.' : 'The model could not complete this. Try again.' });
      } else {
        setState({ writeLoading: false, writeResult: res.text, writeContext: { ...state.writeContext, model: res.model } });
      }
    } catch {
      if (token !== writeToken) return;
      setState({ writeLoading: false, writeError: 'Could not run the writing action.' });
    }
    if (token === writeToken) renderApp();
  }

  function closeWrite() {
    writeToken += 1; // invalidate any in-flight request
    setState({ writeContext: null, writeResult: null, writeLoading: false, writeError: null, writeSelection: null });
    renderApp();
    // Back to the control that opened the dialog (the editor keeps focus
    // otherwise, through the host's after-render rule).
    globalThis.document?.querySelector?.('[data-action="toggle-write-menu"]')?.focus?.();
  }

  // Run the same action again after a failure, with the selection it had.
  async function retryWrite() {
    const ctx = getState().writeContext;
    if (!ctx) return;
    setState({ writeSelection: ctx.input ? { from: ctx.input.from, to: ctx.input.to, text: ctx.input.text } : null });
    await runWrite(ctx.action);
  }

  // The toast's Undo: put the previous text back through the same path, so it
  // is saved like any edit (autosave has probably already stored the applied
  // text by the time the person decides). Only while the document still reads
  // exactly as Apply left it: typing done since is never thrown away — then
  // the person is pointed at ⌘Z, which steps back one change at a time.
  function restoreBefore(before, applied, docId) {
    const state = getState();
    if (docId && docId !== state.editorDocId) { showToast('You left the document — nothing was restored.'); return; }
    const editor = getEditor();
    const current = editor && typeof editor.getValue === 'function' ? editor.getValue() : (state.documentDraftBody || '');
    if (current !== applied) { showToast('The document changed since Apply, so nothing was restored — use ⌘Z to step back.'); return; }
    if (editor && typeof editor.setValue === 'function') editor.setValue(before);
    else { destroyEditorController(); handleDocumentDraftBodyChange(before); renderApp(); }
    showToast('Restored the previous text.');
  }

  // Apply the generated text to the editor buffer (dirty, not saved) per the mode.
  function applyWrite() {
    const state = getState();
    const ctx = state.writeContext;
    const text = state.writeResult;
    if (!ctx || !text) return;
    // Guard against applying to a document the user navigated away from.
    if (ctx.docId && ctx.docId !== state.editorDocId) { showToast('You left the document — nothing was applied.'); closeWrite(); return; }
    const body = state.documentDraftBody || '';
    let next;
    if (ctx.mode === 'prepend') {
      next = body.trim() ? `${text.trim()}\n\n${body}` : text.trim();
    } else if (ctx.mode === 'selection') {
      // Prefer the exact recorded offsets (correct even when the selected text
      // repeats in the body). Splice, never String.replace, so `$` sequences in
      // the AI output are inserted literally rather than expanded.
      if (Number.isInteger(ctx.selStart) && Number.isInteger(ctx.selEnd) && body.slice(ctx.selStart, ctx.selEnd) === ctx.selText) {
        next = body.slice(0, ctx.selStart) + text + body.slice(ctx.selEnd);
      } else if (ctx.selText && body.includes(ctx.selText)) {
        next = body.replace(ctx.selText, () => text); // function replacer: no $-pattern expansion
      } else {
        showToast('The selected text changed — could not apply.'); closeWrite(); return;
      }
    } else {
      next = text; // whole
    }
    writeToken += 1;
    setState({ writeContext: null, writeResult: null, writeLoading: false, writeError: null });
    const editor = getEditor();
    if (editor && typeof editor.replaceRange === 'function' && typeof editor.setValue === 'function') {
      // One change in the editor's history (⌘Z works); its onChange updates
      // the draft and schedules the autosave like typing does.
      if (ctx.mode === 'selection' && Number.isInteger(ctx.selStart) && Number.isInteger(ctx.selEnd) && body.slice(ctx.selStart, ctx.selEnd) === ctx.selText) {
        editor.replaceRange(ctx.selStart, ctx.selEnd, text);
      } else {
        editor.setValue(next);
      }
      renderApp();
    } else {
      destroyEditorController();
      handleDocumentDraftBodyChange(next);
      renderApp();
    }
    // Honest about what just happened: applying saves like typing does.
    showToast('Applied — it saves like typing; Undo (or ⌘Z) restores the previous text.', () => restoreBefore(body, next, ctx.docId), 8000, 'Undo');
  }

  async function copyWrite() {
    const state = getState();
    const ok = await copyToClipboard(state.writeResult || '');
    showToast(ok ? 'Copied' : 'Could not copy');
  }

  // Bumped whenever the editor switches documents: an in-flight action from
  // the previous document never lands.
  function invalidate() {
    writeToken += 1;
  }

  // The ✦ AI menu/overlay are editor-only; never let leaked write state (e.g. an
  // in-flight action the user navigated away from) render over another view.
  function dropOutsideEditor() {
    const state = getState();
    if (state.navType !== 'editor' && (state.writeContext || state.writeMenuOpen || state.writeSelection)) {
      writeToken += 1;
      state.writeContext = null; state.writeResult = null; state.writeLoading = false;
      state.writeError = null; state.writeMenuOpen = false; state.writeSelection = null;
    }
  }

  const actions = {
    'toggle-write-menu': (el, event) => {
      const state = getState();
      // Capture the selection NOW — renderApp() below re-mounts the editor and
      // clears it, so runWrite (fired later from the menu) can't read it live.
      const opening = !state.writeMenuOpen;
      const range = opening ? (getEditor()?.getSelectionRange?.() || null) : null;
      const selText = opening && range ? String(getEditor()?.getSelectionText?.() || '') : '';
      setState({ writeMenuOpen: opening, writeSelection: opening && range && selText.trim() ? { from: range.from, to: range.to, text: selText } : null });
      renderApp();
      // Opened from the keyboard (Enter/Space on the trigger): focus lands on
      // the first action, not back in the editor behind the menu.
      if (opening && event && event.detail === 0) {
        globalThis.document?.querySelector?.('.write-menu [role="menuitem"]:not([disabled])')?.focus?.();
      }
    },
    'retry-write': async () => {
      await retryWrite();
    },
    'write-action': async (el) => {
      await runWrite(el.dataset.write);
    },
    'apply-write': () => {
      applyWrite();
    },
    'copy-write': () => {
      copyWrite();
    },
    'close-write': () => {
      closeWrite();
    },
  };

  return { actions, runWrite, closeWrite, applyWrite, copyWrite, retryWrite, invalidate, dropOutsideEditor };
}
