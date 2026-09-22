import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderToastHtml } from '../../public/js/renderToast.js';

// Background renders (toast expiry, context loads, refresh) must not take the
// person's typing: executes the shipped main.js slices, as reviewAsync does.
const source = readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf8');
function install(context, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing source boundaries: ${start}`);
  vm.runInContext(source.slice(first, last), context);
}
function setStateFor(state) {
  return patch => Object.assign(state, patch);
}

test('a toast shows with a render but expires in place, without rebuilding the shell', () => {
  const state = { toast: null, navType: 'editor' };
  const timers = [];
  const host = { innerHTML: 'old', contains: () => false };
  let renders = 0;
  const context = vm.createContext({
    state, setState: setStateFor(state), renderToastHtml, toastTimer: null,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
    renderApp: () => { renders++; }, focusEditor: () => { throw new Error('focus was not in the toast'); },
    appRoot: { querySelector: selector => (selector === '[data-toast-root]' ? host : null) },
    document: { activeElement: null },
  });
  install(context, 'function showToast(', '// Copy text to the clipboard');
  vm.runInContext("showToast('New document — rename it in the title bar')", context);
  assert.equal(renders, 1);
  assert.equal(timers[0].ms, 2400);
  timers[0].fn();
  assert.equal(state.toast, null);
  assert.equal(renders, 1, 'expiry must not call renderApp');
  assert.equal(host.innerHTML, '');
});

for (const [mode, archived, expected] of [['edit', false, 0], ['split', false, 1], ['preview', false, 1], ['edit', true, 1]]) {
  test(`a document context load ${expected ? 'renders' : 'does not remount the editor'} in ${mode} mode${archived ? ' (archived)' : ''}`, async () => {
    const doc = { id: 'd1', documentType: 'note', archivedAt: archived ? '2026-01-01' : null };
    const state = { editorDocId: 'd1', editorMode: mode, documents: [doc], isDocumentInfoEditorOpen: false };
    let renders = 0;
    const context = vm.createContext({
      state, setState: setStateFor(state), renderApp: () => { renders++; }, Promise,
      fetchDocumentLinks: async () => [], fetchExternalRefs: async () => [], fetchDocumentTaskBacklinks: async () => [],
      fetchSimilarDocuments: async () => ({ items: [] }), fetchRuns: async () => [],
    });
    install(context, 'async function loadDocumentContext(', 'async function ensureBoardExtras(');
    assert.equal(await vm.runInContext('loadDocumentContext(state.documents[0])', context), true);
    assert.deepEqual(state.documentLinks, [], 'the context is installed either way');
    assert.equal(renders, expected);
  });
}

function editorContext(state, carried) {
  const calls = [];
  const controller = {
    setSelectionRange: (from, to) => calls.push(['select', from, to]),
    restoreScroll: snapshot => calls.push(['scroll', snapshot]),
    focus: () => calls.push(['focus']),
  };
  const host = { hidden: true };
  const context = vm.createContext({
    state, calls, documentEditorController: null, pendingEditorSelection: carried, mountedEditorDocId: null,
    appRoot: { querySelector: selector => (selector === '[data-code-editor]' ? host : null) },
    destroyEditorController: () => {}, wikiLinkDocuments: () => [], handleDocumentDraftBodyChange: () => {},
    requestDocumentDraftSave: () => {}, console,
    mountCodeMirrorEditor: options => { calls.push(['mount', options.cursorToEnd]); return controller; },
  });
  install(context, 'function mountEditorIfNeeded(', 'function focusEditor(');
  return context;
}

test('a remount of the same document puts back a collapsed caret, scroll and focus', () => {
  const state = { navType: 'editor', editorDocId: 'd1', documentDraftBody: 'alpha\nomega', preferences: {} };
  const context = editorContext(state, { from: 5, to: 5, focused: true, scroll: 'snap', docId: 'd1' });
  vm.runInContext('mountEditorIfNeeded()', context);
  assert.deepEqual(context.calls, [['mount', true], ['select', 5, 5], ['scroll', 'snap'], ['focus']]);
  assert.equal(vm.runInContext('pendingEditorSelection', context), null);
  assert.equal(vm.runInContext('mountedEditorDocId', context), 'd1');
});

test('a carried selection is clamped to a shorter buffer and is not focused when the editor was not', () => {
  const state = { navType: 'editor', editorDocId: 'd1', documentDraftBody: 'abc', preferences: {} };
  const context = editorContext(state, { from: 2, to: 40, focused: false, scroll: null, docId: 'd1' });
  vm.runInContext('mountEditorIfNeeded()', context);
  assert.deepEqual(context.calls, [['mount', true], ['select', 2, 3], ['scroll', null]]);
});

test('another document opens fresh, with the caret at the end', () => {
  const state = { navType: 'editor', editorDocId: 'd2', documentDraftBody: 'other', preferences: {} };
  const context = editorContext(state, { from: 1, to: 1, focused: true, scroll: 'snap', docId: 'd1' });
  vm.runInContext('mountEditorIfNeeded()', context);
  assert.deepEqual(context.calls, [['mount', true]]);
});

// ---- field continuity over a minimal fake DOM ------------------------------
// Supports the selector shapes the continuity code builds and uses:
// comma lists of `tag[attr]`, `tag[attr="value"]` and `:not([type="x"])`.
function matchesPart(el, part) {
  const text = part.trim();
  const tag = /^[a-z]+/.exec(text)?.[0];
  if (tag && tag !== el.tagName.toLowerCase()) return false;
  for (const [, type] of text.matchAll(/:not\(\[type="([^"]+)"\]\)/g)) if (el.getAttribute('type') === type) return false;
  const plain = text.replace(/:not\([^)]*\)/g, '');
  for (const [, name, value] of plain.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
    if (!el.hasAttribute(name)) return false;
    if (value !== undefined && el.getAttribute(name) !== value) return false;
  }
  return true;
}
function makeDom() {
  const doc = { activeElement: null, body: { tagName: 'BODY' } };
  class FakeField {
    constructor(tag, attrs, { rendered = '', value = rendered, disabled = false } = {}) {
      this.tagName = tag.toUpperCase();
      this.attrs = attrs;
      this.defaultValue = rendered;
      this.value = value;
      this.disabled = disabled;
      this.selectionStart = value.length; this.selectionEnd = value.length; this.selectionDirection = 'none';
      this.scrollTop = 0;
    }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    getAttribute(name) { return this.hasAttribute(name) ? this.attrs[name] : null; }
    matches(selector) { return selector.split(',').some(part => matchesPart(this, part)); }
    closest() { return null; }
    focus() { if (!this.disabled) doc.activeElement = this; }
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
    }
  }
  const root = {
    fields: [],
    contains: el => root.fields.includes(el),
    querySelector: () => null,
    querySelectorAll: selector => root.fields.filter(el => el.matches(selector)),
  };
  return { doc, root, FakeField };
}
function continuityContext() {
  const dom = makeDom();
  const context = vm.createContext({
    appRoot: dom.root, document: dom.doc, HTMLElement: dom.FakeField, CSS: { escape: value => value },
  });
  install(context, '// ---- render continuity', 'function renderApp() {');
  return { context, ...dom };
}
function rerender({ context, root }, fields) {
  vm.runInContext('renderContinuity = captureRenderContinuity()', context);
  root.fields = fields;
  context.document.activeElement = context.document.body; // the old node left the DOM
  vm.runInContext('restoreRenderContinuity()', context);
}

test('a DOM-only field keeps its typed text, caret and focus across a render that reset it', () => {
  const dom = continuityContext();
  const { FakeField, root, doc } = dom;
  const typed = new FakeField('input', { 'data-checklist-new': '' }, { rendered: '', value: 'Buy mi' });
  typed.setSelectionRange(3, 3);
  root.fields = [typed];
  doc.activeElement = typed;
  const fresh = new FakeField('input', { 'data-checklist-new': '' });
  rerender(dom, [fresh]);
  assert.equal(fresh.value, 'Buy mi');
  assert.equal(doc.activeElement, fresh);
  assert.deepEqual([fresh.selectionStart, fresh.selectionEnd], [3, 3]);
  assert.equal(vm.runInContext('renderRestoredField', dom.context), fresh);
});

test('a field whose rendered value changed keeps the new value; focus returns with the caret at the end', () => {
  const dom = continuityContext();
  const { FakeField, root, doc } = dom;
  const typed = new FakeField('input', { 'data-project-rename': '', 'data-project-id': 'p1' }, { rendered: 'Old', value: 'Draft' });
  root.fields = [typed];
  doc.activeElement = typed;
  const fresh = new FakeField('input', { 'data-project-rename': '', 'data-project-id': 'p1' }, { rendered: 'Renamed elsewhere' });
  rerender(dom, [fresh]);
  assert.equal(fresh.value, 'Renamed elsewhere');
  assert.equal(doc.activeElement, fresh);
  assert.deepEqual([fresh.selectionStart, fresh.selectionEnd], [17, 17]);
});

test('a state-mirrored field is focused but never rewritten from the DOM', () => {
  const dom = continuityContext();
  const { FakeField, root, doc } = dom;
  // The capture input mirrors into state on input; submit clears state without
  // a render in between, so its stale DOM text must not come back.
  const typed = new FakeField('input', { 'data-capture-input': '' }, { rendered: '', value: 'submitted task' });
  root.fields = [typed];
  doc.activeElement = typed;
  const fresh = new FakeField('input', { 'data-capture-input': '' }, { rendered: '' });
  rerender(dom, [fresh]);
  assert.equal(fresh.value, '');
  assert.equal(doc.activeElement, fresh);
  assert.equal(vm.runInContext('renderRestoredField', dom.context), fresh);
});

test('Settings form fields keep edits after focus moved on; an unfocused one-off field does not', () => {
  const dom = continuityContext();
  const { FakeField, root, doc } = dom;
  const model = new FakeField('input', { 'data-ai-model': '' }, { rendered: 'old-model', value: 'new-model' });
  const baseUrl = new FakeField('input', { 'data-ai-base-url': '' }, { rendered: 'http://a', value: 'http://b:' });
  const checklist = new FakeField('input', { 'data-checklist-new': '' }, { rendered: '', value: 'left behind' });
  root.fields = [model, baseUrl, checklist];
  doc.activeElement = baseUrl;
  const next = {
    model: new FakeField('input', { 'data-ai-model': '' }, { rendered: 'old-model' }),
    baseUrl: new FakeField('input', { 'data-ai-base-url': '' }, { rendered: 'http://a' }),
    checklist: new FakeField('input', { 'data-checklist-new': '' }),
  };
  rerender(dom, Object.values(next));
  assert.equal(next.model.value, 'new-model');
  assert.equal(next.baseUrl.value, 'http://b:');
  assert.equal(doc.activeElement, next.baseUrl);
  assert.equal(next.checklist.value, '', 'an unfocused one-off field was probably submitted by a click');
});

test('identical fields are matched by position, and a disabled field is not focused', () => {
  const dom = continuityContext();
  const { FakeField, root, doc } = dom;
  const first = new FakeField('input', { 'data-confirm-input': '' });
  const second = new FakeField('input', { 'data-confirm-input': '' }, { value: 'second' });
  root.fields = [first, second];
  doc.activeElement = second;
  const fresh = [new FakeField('input', { 'data-confirm-input': '' }), new FakeField('input', { 'data-confirm-input': '' })];
  rerender(dom, fresh);
  assert.equal(fresh[0].value, '');
  assert.equal(fresh[1].value, 'second');
  assert.equal(doc.activeElement, fresh[1]);

  const locked = new FakeField('input', { 'data-confirm-input': '' }, { disabled: true });
  root.fields = [fresh[1]];
  doc.activeElement = fresh[1];
  rerender(dom, [locked]);
  assert.equal(locked.value, 'second', 'the text survives even while the field is locked');
  assert.equal(doc.activeElement, doc.body);
  assert.equal(vm.runInContext('renderRestoredField', dom.context), null);
});

test('fields without identifying attributes and non-text controls are left alone', () => {
  const dom = continuityContext();
  const { FakeField, root, doc } = dom;
  const anonymous = new FakeField('input', { class: 'x' }, { value: 'typed' });
  root.fields = [anonymous];
  doc.activeElement = anonymous;
  rerender(dom, [new FakeField('input', { class: 'x' })]);
  assert.equal(doc.activeElement, doc.body);

  const checkbox = new FakeField('input', { type: 'checkbox', 'data-select-task': 't1' });
  root.fields = [checkbox];
  doc.activeElement = checkbox;
  rerender(dom, [new FakeField('input', { type: 'checkbox', 'data-select-task': 't1' })]);
  assert.equal(doc.activeElement, doc.body);
});

test('focusInputAtEnd leaves the caret of a field the render just gave back', () => {
  const dom = continuityContext();
  const { FakeField, root, doc } = dom;
  const typed = new FakeField('input', { 'data-palette-input': '' }, { rendered: 'abcdef', value: 'abcdef' });
  typed.setSelectionRange(2, 2);
  root.fields = [typed];
  doc.activeElement = typed;
  const fresh = new FakeField('input', { 'data-palette-input': '' }, { rendered: 'abcdef' });
  rerender(dom, [fresh]);
  vm.runInContext('focusInputAtEnd(appRoot.fields[0])', dom.context);
  assert.deepEqual([fresh.selectionStart, fresh.selectionEnd], [2, 2]);
  const other = new FakeField('input', { 'data-ask-prax-input': '' }, { rendered: 'xyz' });
  other.setSelectionRange(0, 0);
  dom.context.other = other;
  vm.runInContext('focusInputAtEnd(other)', dom.context);
  assert.equal(doc.activeElement, other);
  assert.deepEqual([other.selectionStart, other.selectionEnd], [3, 3]);
});
