import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboardDispatcher, KEY_CONSUMED, KEY_HANDLED } from '../../public/js/keyboardDispatcher.js';
import { createGlobalShortcuts } from '../../public/js/keyboardShortcuts.js';
import { createPlanModeController } from '../../public/js/planModeController.js';

// Targets: `inApp` stands for "inside #app" (the dispatcher asks the root).
const root = { contains: target => Boolean(target?.inApp) };
const body = { tagName: 'BODY', inApp: false, matches: () => false, closest: () => null };
const appDiv = { tagName: 'DIV', inApp: true, matches: () => false, closest: () => null };
const field = { tagName: 'INPUT', inApp: true, matches: selector => selector.includes('input'), closest: () => null };
function button(action) {
  const el = { tagName: 'BUTTON', inApp: true, dataset: { action }, matches: () => false };
  el.closest = selector => (selector.includes('button') ? el : null);
  return el;
}
function key(name, target = body, extra = {}) {
  const event = { key: name, target, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, prevented: 0, ...extra };
  event.preventDefault = () => { event.prevented += 1; event.defaultPrevented = true; };
  event.stopPropagation = () => {};
  return event;
}

test('layers run in order; a consumed key reaches no later layer', () => {
  const seen = [];
  const layer = (name, result, extra = {}) => ({ name, ...extra, handle: () => { seen.push(name); return result; } });
  const dispatcher = createKeyboardDispatcher({ getRoot: () => root, layers: [
    layer('first', null), layer('owner', KEY_CONSUMED), layer('later', null), layer('global', null, { global: true }),
  ] });
  assert.equal(dispatcher.dispatch(key('x')), 'owner');
  assert.deepEqual(seen, ['first', 'owner']);
  assert.deepEqual(dispatcher.order, ['first', 'owner', 'later', 'global']);
});

test('a handled key skips the remaining surface layers but still reaches the global layer', () => {
  const seen = [];
  const layer = (name, result, extra = {}) => ({ name, ...extra, handle: () => { seen.push(name); return result; } });
  const dispatcher = createKeyboardDispatcher({ getRoot: () => root, layers: [
    layer('field', KEY_HANDLED), layer('other-field', null), layer('global', null, { global: true }),
  ] });
  assert.equal(dispatcher.dispatch(key('Escape', field)), 'field');
  assert.deepEqual(seen, ['field', 'global']);
});

test('app-scoped layers see only keys whose target is inside the app', () => {
  const seen = [];
  const dispatcher = createKeyboardDispatcher({ getRoot: () => root, layers: [
    { name: 'app-only', scope: 'app', handle: () => { seen.push('app-only'); } },
    { name: 'everywhere', handle: () => { seen.push('everywhere'); } },
  ] });
  dispatcher.dispatch(key('Tab', body));
  dispatcher.dispatch(key('Tab', appDiv));
  assert.deepEqual(seen, ['everywhere', 'app-only', 'everywhere']);
});

test('IME: a key that belongs to a composition reaches no layer', () => {
  const seen = [];
  const dispatcher = createKeyboardDispatcher({ getRoot: () => root, layers: [
    { name: 'any', handle: () => { seen.push('any'); } },
    { name: 'global', global: true, handle: () => { seen.push('global'); } },
  ] });
  dispatcher.dispatch(key('Enter', field, { isComposing: true }));
  dispatcher.dispatch(key('Enter', field, { keyCode: 229 }));
  dispatcher.dispatch(key('Escape', body, { isComposing: true }));
  assert.deepEqual(seen, []);
});

test('a throwing layer is reported and the key keeps routing', () => {
  const reported = []; const seen = [];
  const dispatcher = createKeyboardDispatcher({ getRoot: () => root, reportError: error => reported.push(error.message), layers: [
    { name: 'broken', handle: () => { throw new Error('boom'); } },
    { name: 'global', global: true, handle: () => { seen.push('global'); } },
  ] });
  dispatcher.dispatch(key('e'));
  assert.deepEqual(reported, ['boom']);
  assert.deepEqual(seen, ['global']);
});

test('install listens once on the document and can be removed', () => {
  const listeners = [];
  const doc = { addEventListener: (type, fn) => listeners.push([type, fn]), removeEventListener: (type, fn) => {
    const at = listeners.findIndex(([t, f]) => t === type && f === fn); listeners.splice(at, 1);
  } };
  const remove = createKeyboardDispatcher({ getRoot: () => root, layers: [] }).install(doc);
  assert.deepEqual(listeners.map(([type]) => type), ['keydown']);
  remove();
  assert.equal(listeners.length, 0);
});

// ---- the app's layer stack, with the shipped global and plan-walk layers ----

function appKeyboard({ planMode = null, modalOpen = false, inboxOpen = false, templateStudio = false, fieldResult = null } = {}) {
  const calls = [];
  const spy = name => (...args) => calls.push([name, ...args]);
  const state = { planMode, tasks: (planMode?.queue || []).map(entry => ({ id: entry.id, status: 'planned' })), archivedTasks: [] };
  const updates = [];
  const plan = createPlanModeController({
    getState: () => state, setState: patch => Object.assign(state, patch), renderApp: () => {}, showToast: spy('toast'),
    todayISODate: () => '2026-09-23', doc: { querySelector: () => null }, normalizeTask: t => t,
    taskById: id => state.tasks.find(t => t.id === id) || null,
    updateTask: async (id, fields) => { updates.push([id, fields]); return { id, ...fields }; },
  });
  const globalShortcuts = createGlobalShortcuts({ handlers: {
    switchView: spy('switchView'), openPalette: spy('openPalette'), toggleTheme: spy('toggleTheme'),
    openCapture: spy('openCapture'), toggleDoneSelected: spy('toggleDoneSelected'), navigate: spy('navigate'),
    openSelected: spy('openSelected'), escape: spy('escape'), modalOpen: () => modalOpen,
  } });
  const dispatcher = createKeyboardDispatcher({ getRoot: () => root, layers: [
    { name: 'plan-walk', handle: event => (plan.keydown(event) ? KEY_CONSUMED : null) },
    { name: 'inbox-dialog', scope: 'app', handle: event => (inboxOpen && event.key === 'Escape' ? (calls.push(['inboxClose']), KEY_CONSUMED) : null) },
    { name: 'template-studio', scope: 'app', handle: event => (templateStudio ? (event.key === 'Escape' && calls.push(['studioClose']), KEY_CONSUMED) : null) },
    { name: 'workspace-fields', scope: 'app', handle: event => (event.target === field ? (calls.push(['field', event.key]), fieldResult) : null) },
    { name: 'global-shortcuts', global: true, handle: globalShortcuts },
  ] });
  return { dispatch: event => dispatcher.dispatch(event), calls, updates, state };
}
const walk = (mode, ids, bucket = 'today') => ({ mode, queue: ids.map(id => ({ id, bucket })), index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0 });

test('plan walk: Enter with default focus decides the item and never also opens the selected task', async () => {
  const app = appKeyboard({ planMode: walk('plan', ['t1', 't2']) });
  const event = key('Enter', body);
  assert.equal(app.dispatch(event), 'plan-walk');
  assert.equal(event.prevented, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.updates.map(([id]) => id), ['t1']);
  assert.deepEqual(app.calls, [], 'the global Enter (open selected) never ran behind the overlay');
  app.dispatch(key('s', body));
  assert.equal(app.state.planMode.index, 2, 'S skipped the next item');
});

test('Enter on a focused button stays that button\'s: no plan decision, no global shortcut', () => {
  const app = appKeyboard({ planMode: walk('plan', ['t1']) });
  const event = key('Enter', button('plan-mode-skip'));
  app.dispatch(event);
  assert.equal(event.prevented, 0, 'the native button activation runs');
  assert.deepEqual(app.updates, []);
  assert.deepEqual(app.calls, []);
});

test('IME keys never reach the plan walk or the global shortcuts', () => {
  const app = appKeyboard({ planMode: walk('plan', ['t1']) });
  app.dispatch(key('Enter', body, { keyCode: 229 }));
  app.dispatch(key('s', body, { isComposing: true }));
  app.dispatch(key('Escape', body, { isComposing: true }));
  assert.deepEqual(app.updates, []);
  assert.equal(app.state.planMode.index, 0);
  assert.deepEqual(app.calls, []);
});

test('under a modal, one-key commands are blocked, N opens capture and Escape runs the cascade', () => {
  const app = appKeyboard({ modalOpen: true });
  for (const name of ['e', 'Enter', 'ArrowDown', '/', 'g', 't']) app.dispatch(key(name, body));
  assert.deepEqual(app.calls, []);
  app.dispatch(key('n', body));
  app.dispatch(key('Escape', body));
  app.dispatch(key('k', body, { metaKey: true }));
  assert.deepEqual(app.calls, [['openCapture'], ['escape'], ['openPalette']]);
});

test('a field that handled a key keeps one-key commands out but Escape still reaches the cascade', () => {
  const app = appKeyboard({ fieldResult: KEY_HANDLED });
  app.dispatch(key('Enter', field));
  app.dispatch(key('e', field));
  app.dispatch(key('Escape', field));
  assert.deepEqual(app.calls, [['field', 'Enter'], ['field', 'e'], ['field', 'Escape'], ['escape']]);
});

test('the Inbox dialog and the template studio own their keys inside the app', () => {
  const inbox = appKeyboard({ inboxOpen: true });
  inbox.dispatch(key('Escape', appDiv));
  assert.deepEqual(inbox.calls, [['inboxClose']], 'the cascade does not also run');
  const studio = appKeyboard({ templateStudio: true });
  studio.dispatch(key('Escape', appDiv));
  studio.dispatch(key('e', appDiv));
  assert.deepEqual(studio.calls, [['studioClose']]);
  studio.dispatch(key('Escape', body));
  assert.deepEqual(studio.calls, [['studioClose'], ['escape']], 'a key from <body> reaches the Escape cascade');
});
