import test from 'node:test';
import assert from 'node:assert/strict';
import { createWritingController } from '../../public/js/writingController.js';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function writingFor(state, extras = {}) {
  const applied = []; const toasts = [];
  const controller = createWritingController({
    getState: () => state, setState: patch => Object.assign(state, patch), renderApp: () => {},
    showToast: text => toasts.push(text), copyToClipboard: async () => true, getEditor: () => null,
    destroyEditorController: () => {}, handleDocumentDraftBodyChange: value => { applied.push(value); state.documentDraftBody = value; },
    ...extras,
  });
  return { controller, applied, toasts };
}

test('a rewrite of a repeated selection replaces the recorded occurrence and keeps $ sequences literal', async () => {
  const body = 'alpha beta alpha';
  const state = { navType: 'editor', editorDocId: 'd1', documents: [{ id: 'd1', title: 'Doc' }], documentDraftBody: body,
    writeSelection: { from: 11, to: 16, text: 'alpha' } };
  const { controller, applied } = writingFor(state, { runWritingAction: async () => ({ text: 'costs $1 & $&', model: 'm' }) });
  await controller.runWrite('rewrite');
  assert.equal(state.writeContext.mode, 'selection');
  assert.equal(state.writeContext.model, 'm');
  controller.applyWrite();
  assert.deepEqual(applied, ['alpha beta costs $1 & $&']);
  assert.equal(state.writeContext, null);
});

test('a writing result that lands after the preview closed is dropped', async () => {
  const state = { navType: 'editor', editorDocId: 'd1', documents: [{ id: 'd1' }], documentDraftBody: 'some text' };
  const response = deferred();
  const { controller } = writingFor(state, { runWritingAction: () => response.promise });
  const running = controller.runWrite('summarize');
  controller.closeWrite();
  response.resolve({ text: 'late summary' });
  await running;
  assert.equal(state.writeContext, null);
  assert.equal(state.writeResult, null);
  // Switching documents invalidates an in-flight action the same way.
  const again = deferred();
  const second = writingFor(state, { runWritingAction: () => again.promise });
  const pending = second.controller.runWrite('summarize');
  second.controller.invalidate();
  again.resolve({ text: 'late' });
  await pending;
  assert.equal(state.writeResult, null);
  assert.equal(state.writeLoading, true, 'the stale response installs nothing');
});

test('applying to a document the person left does nothing', () => {
  const state = { navType: 'editor', editorDocId: 'd2', documentDraftBody: 'body',
    writeContext: { mode: 'whole', docId: 'd1' }, writeResult: 'new' };
  const { controller, applied, toasts } = writingFor(state);
  controller.applyWrite();
  assert.deepEqual(applied, []);
  assert.match(toasts[0], /You left the document/);
  assert.equal(state.writeContext, null);
});

test('leaked writing state is dropped outside the editor only', () => {
  const inEditor = { navType: 'editor', writeContext: { mode: 'whole' }, writeMenuOpen: true };
  writingFor(inEditor).controller.dropOutsideEditor();
  assert.deepEqual(inEditor.writeContext, { mode: 'whole' });
  const elsewhere = { navType: 'library', writeContext: { mode: 'whole' }, writeMenuOpen: true, writeSelection: { text: 'x' }, writeResult: 'r' };
  writingFor(elsewhere).controller.dropOutsideEditor();
  assert.equal(elsewhere.writeContext, null);
  assert.equal(elsewhere.writeMenuOpen, false);
  assert.equal(elsewhere.writeSelection, null);
  assert.equal(elsewhere.writeResult, null);
});

test('with a mounted editor, apply is one editor change and the toast Undo restores the previous text', async () => {
  const calls = [];
  let value = 'alpha beta alpha';
  const editor = {
    getSelectionRange: () => ({ from: 0, to: 0 }), getSelectionText: () => '',
    replaceRange: (from, to, insert) => { calls.push(['replaceRange', from, to, insert]); value = value.slice(0, from) + insert + value.slice(to); },
    setValue: (text) => { calls.push(['setValue', text]); value = text; },
  };
  const state = { navType: 'editor', editorDocId: 'd1', documents: [{ id: 'd1', title: 'Doc', verified: true }], documentDraftBody: value, writeSelection: { from: 11, to: 16, text: 'alpha' } };
  const toasts = [];
  const destroyed = [];
  const controller = createWritingController({
    getState: () => state, setState: patch => Object.assign(state, patch), renderApp: () => {},
    showToast: (text, undo, duration, label) => toasts.push({ text, undo, label }), copyToClipboard: async () => true, getEditor: () => editor,
    destroyEditorController: () => destroyed.push(1), handleDocumentDraftBodyChange: v => { state.documentDraftBody = v; },
    runWritingAction: async () => ({ text: 'gamma', model: 'm' }),
  });
  await controller.runWrite('rewrite');
  assert.equal(state.writeContext.verified, true, 'the preview knows the document is verified');
  controller.applyWrite();
  assert.deepEqual(calls, [['replaceRange', 11, 16, 'gamma']]);
  assert.equal(destroyed.length, 0, 'the editor is not remounted, so ⌘Z still works');
  assert.match(toasts.at(-1).text, /saves like typing/);
  assert.equal(toasts.at(-1).label, 'Undo');
  toasts.at(-1).undo();
  assert.deepEqual(calls.at(-1), ['setValue', 'alpha beta alpha']);
  assert.match(toasts.at(-1).text, /Restored the previous text/);
});

test('a failed writing action can be retried with the same selection', async () => {
  let attempt = 0;
  const state = { navType: 'editor', editorDocId: 'd1', documents: [{ id: 'd1', title: 'Doc' }], documentDraftBody: 'one two', writeSelection: { from: 0, to: 3, text: 'one' } };
  const { controller } = writingFor(state, { runWritingAction: async () => { attempt += 1; if (attempt === 1) throw new Error('down'); return { text: 'uno', model: 'm' }; } });
  await controller.runWrite('rewrite');
  assert.match(state.writeError, /Could not run/);
  await controller.retryWrite();
  assert.equal(state.writeError, null);
  assert.equal(state.writeResult, 'uno');
  assert.equal(state.writeContext.mode, 'selection');
});
