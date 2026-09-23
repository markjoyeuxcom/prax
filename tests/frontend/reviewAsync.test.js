import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveDocumentDraftRecovery } from '../../public/js/documentDraftRecovery.js';
import { collectionFingerprint } from '../../public/js/externalRefresh.js';
import { createDocumentLifecycleController } from '../../public/js/documentLifecycleController.js';
import { createReviewWalkController } from '../../public/js/reviewWalkController.js';

// Execute shipped handlers, not copies of their algorithms. Deferred I/O makes
// races deterministic; browser journeys complement these small state drills.
const source = readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf8');
const stateSource = readFileSync(new URL('../../public/js/state.js', import.meta.url), 'utf8');
function install(context, start, end, text = source) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing source boundaries: ${start}`);
  vm.runInContext(text.slice(first, last).replace(/^export /, ''), context);
}
function contextFor(state, extras = {}) {
  const context = vm.createContext({ state, clearTimeout, appRoot: null, ...extras });
  install(context, 'export function setState(', 'const ACTIVE_PROJECT_KEY', stateSource);
  return context;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// The lifecycle and review-walk controllers run with the shipped setState
// (state.js) and seedEditorDraft (main.js) installed over the test's state.
function editorContext(state, extras = {}) {
  const context = contextFor(state, {
    documentAutosaveTimer: null, documentDraftStorage: () => null, loadDocumentDraftRecovery: () => null,
    resolveDocumentDraftRecovery, clearDocumentDraftRecovery: () => {}, ...extras,
  });
  install(context, 'function seedEditorDraft(', '// ---------------------------------------------------------------------------');
  return context;
}
function lifecycleFor(state, context, deps = {}) {
  return createDocumentLifecycleController({
    getState: () => state, setState: context.setState, seedEditorDraft: context.seedEditorDraft,
    pendingDocumentSave: () => null, renderApp: () => {}, showToast: () => {}, destroyEditorController: () => {},
    loadDocuments: async () => true, ...deps,
  });
}

for (const scenario of ['another document', 'same document typing', 'away and back']) {
  test(`R02: a verification conflict preserves newer context: ${scenario}`, async () => {
    const before = { id: 'a', title: 'A', body: 'baseline', revision: 'a'.repeat(64) };
    const remote = { ...before, body: 'remote edit', revision: 'b'.repeat(64) };
    const state = { navType: 'editor', editorContextVersion: 0, editorDocId: 'a', documentDraftId: 'a',
      documentDraftBase: before, documentDraftTitle: 'A', documentDraftBody: 'baseline', isDocumentDirty: false };
    const response = deferred();
    let renders = 0; let destroyed = 0; const toasts = [];
    const context = editorContext(state);
    // The verify write is lost; its canonical read shows a newer revision.
    const lifecycle = lifecycleFor(state, context, {
      verifyDocument: () => response.promise.then(() => { throw new Error('lost response'); }),
      fetchDocument: async () => remote,
      destroyEditorController: () => { destroyed++; }, renderApp: () => { renders++; },
      showToast: text => toasts.push(text),
    });
    const verifying = lifecycle.changeDocumentVerification('a', true);
    if (scenario === 'another document') vm.runInContext("setState({ editorDocId: 'b', documentDraftId: 'b', documentDraftTitle: 'B', documentDraftBody: 'new input', isDocumentDirty: true })", context);
    if (scenario === 'same document typing') vm.runInContext("setState({ documentDraftBody: 'new input', isDocumentDirty: true })", context);
    if (scenario === 'away and back') vm.runInContext("setState({ navType: 'today' }); setState({ navType: 'editor' })", context);
    const expected = structuredClone(state);
    response.resolve();
    await verifying;
    const { documents, ...rest } = state;
    assert.deepEqual(rest, expected, 'even without recovery storage the in-window draft and its owner survive');
    assert.deepEqual(documents, [remote], 'the newer saved record is cached for the next open');
    assert.equal(renders, 0);
    assert.equal(destroyed, 0);
    assert.match(toasts[0], /current draft is kept/);
  });
}

test('R02: a conflict still loads current content when the reviewed editor is untouched', async () => {
  const before = { id: 'a', title: 'A', body: 'baseline', revision: 'a'.repeat(64) };
  const remote = { ...before, body: 'remote edit', revision: 'b'.repeat(64) };
  const state = { navType: 'editor', editorContextVersion: 0, editorDocId: 'a', documentDraftId: 'a',
    documentDraftBase: before, documentDraftTitle: 'A', documentDraftBody: 'baseline', isDocumentDirty: false };
  const context = editorContext(state);
  const lifecycle = lifecycleFor(state, context, {
    verifyDocument: async () => { throw new Error('conflict'); }, fetchDocument: async () => remote,
  });
  await lifecycle.changeDocumentVerification('a', true);
  assert.equal(state.documentDraftBody, 'remote edit');
  assert.equal(state.isDocumentDirty, false);
});

function reviewWalkFor(state, context, deps = {}) {
  return createReviewWalkController({
    getState: () => state, setState: context.setState, getRoot: () => null,
    renderApp: () => {}, showToast: () => {}, destroyEditorController: () => {}, goLibrary: async () => {},
    prepareEditorNavigation: async () => true, fetchDocument: async id => ({ id }), cacheLifecycleDocument: () => {},
    ...deps,
  });
}

for (const action of ['stay', 'skip', 'leave', 'new walk']) {
  test(`R05: verification advances only its original position (${action})`, async () => {
    const state = { navType: 'editor', editorContextVersion: 0,
      documents: ['a', 'b', 'c'].map(id => ({ id, updatedBy: 'agent', verified: false, status: 'active' })),
      editorDocId: 'a', reviewWalk: { ids: ['a', 'b', 'c'], index: 0, verified: 0 } };
    const pending = deferred(); const opened = [];
    const context = contextFor(state);
    const walk = reviewWalkFor(state, context, {
      currentDocument: () => state.documents.find(d => d.id === state.editorDocId),
      performDocumentLifecycleOnce: (_key, fn) => fn(),
      changeDocumentVerification: async id => { await pending.promise; state.documents.find(d => d.id === id).verified = true; return true; },
      openDocumentInEditor: async id => { opened.push(id); state.editorDocId = id; return true; },
    });
    const verifying = walk.reviewWalkVerify();
    if (action === 'skip') await walk.advanceReviewWalk();
    if (action === 'leave') vm.runInContext("setState({ reviewWalk: null, navType: 'library' })", context);
    if (action === 'new walk') vm.runInContext("setState({ reviewWalk: { ids: ['a','b','c'], index: 0, verified: 0 } })", context);
    const expected = ['stay', 'skip'].includes(action)
      ? { walk: { ids: ['a', 'b', 'c'], index: 1, verified: 1 }, id: 'b' }
      : structuredClone({ walk: state.reviewWalk, id: state.editorDocId });
    pending.resolve(); await verifying;
    assert.deepEqual(structuredClone({ walk: state.reviewWalk, id: state.editorDocId }), expected);
    assert.equal(state.documents[1].verified, false);
    assert.deepEqual(opened, ['stay', 'skip'].includes(action) ? ['b'] : []);
  });
}

test('R05: a slow next-document fetch cannot reopen an abandoned walk', async () => {
  const state = { navType: 'editor', editorContextVersion: 0, editorDocId: 'a', reviewWalk: { ids: ['a', 'b'], index: 1 } };
  const pending = deferred(); let opened = 0; let cached = 0;
  const context = contextFor(state);
  const walk = reviewWalkFor(state, context, { fetchDocument: () => pending.promise,
    cacheLifecycleDocument: () => { cached++; }, openDocumentInEditor: async () => { opened++; return true; } });
  const loading = walk.openWalkDocument('b');
  await Promise.resolve();
  vm.runInContext("setState({ reviewWalk: null, navType: 'today' })", context);
  pending.resolve({ id: 'b' }); await loading;
  assert.equal(opened, 0); assert.equal(cached, 0); assert.equal(state.navType, 'today');
});

test('R06/R07: focus refresh after leaving the editor renders verification changes once', async () => {
  const before = { id: 'a', updatedAt: 'same content timestamp', status: 'active', verified: false };
  const state = { navType: 'today', editorDocId: 'a', tasks: [], documents: [before] };
  let fetched = 0; let rendered = 0; let verified = true;
  const context = contextFor(state, { collectionFingerprint, loadTasks: async () => true,
    loadDocuments: async () => { fetched++; state.documents = [{ ...before, verified, verifiedAt: verified ? 'reviewed now' : null, verifiedBy: verified ? 'user' : null }]; },
    renderApp: () => { rendered++; }, captureFocus: () => null, restoreFocus: () => {}, externalRefresh: { trigger: () => {} },
    inboxController: { summary: async () => {} } });
  install(context, 'async function refreshFromOutside()', 'const externalRefresh =');
  assert.equal(await vm.runInContext('refreshFromOutside()', context), true);
  assert.equal(fetched, 1); assert.equal(rendered, 1);
  assert.equal(await vm.runInContext('refreshFromOutside()', context), false);
  assert.equal(rendered, 1, 'an unchanged refresh does not remount the page');
  verified = false;
  assert.equal(await vm.runInContext('refreshFromOutside()', context), true);
  assert.equal(rendered, 2);
  state.navType = 'editor';
  await vm.runInContext('refreshFromOutside()', context);
  assert.equal(fetched, 3, 'the active editor continues owning its draft');
});
