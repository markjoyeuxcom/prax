import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isInteractiveShortcutTarget } from '../../public/js/keyboardShortcuts.js';
import { normalizeDocumentDraftTitle, documentDraftIsDirty } from '../../public/js/documentDraftRecovery.js';
import { documentDraftSavedPatch, canPreserveEditorAfterDraftSave } from '../../public/js/documentDraftSave.js';

// 2026-09-22 review (Medium): executes the shipped main.js slices, as
// reviewAsync.test.js does. Deferred I/O makes the interleavings exact.
const source = readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf8');
function install(context, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing source boundaries: ${start}`);
  vm.runInContext(source.slice(first, last), context);
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

// ---- fee5b02e: a task reload never installs a snapshot older than a write ----

function taskLoadContext(state, extras = {}) {
  const writes = { epoch: 0 };
  const installs = [];
  const context = vm.createContext({
    state, tasksLoadToken: 0, writeEpoch: () => writes.epoch,
    setState: (patch) => { if (patch.tasks) installs.push(patch.tasks.map(t => `${t.id}:${t.status}`).join(',')); Object.assign(state, patch); },
    normalizeTask: t => ({ ...t }), reconcileTaskDrawerAfterRefresh: () => {}, checkDueReminders: () => false,
    externalRefresh: { trigger: (reason) => { writes.triggered = reason; } },
    ...extras,
  });
  install(context, 'const TASK_LOAD_ATTEMPTS', '// After a refresh installs newer server state');
  return { context, writes, installs };
}

test('fee5b02e: complete A (recurring reload) then B: the reload read before B never shows B open', async () => {
  const before = [{ id: 'a', status: 'completed', recurrence: 'daily' }, { id: 'b', status: 'planned' }];
  const state = { tasks: before.map(t => ({ ...t })), archivedTasks: [], selectedTaskId: null };
  const fetches = [];
  const updates = [];
  let rendered = 0;
  const { context, writes, installs } = taskLoadContext(state, {
    fetchTasks: () => { const d = deferred(); fetches.push(d); return d.promise; },
    // updateTask stands in for praxFetch: the epoch moves when a write starts and settles.
    updateTask: async (id, patch) => {
      writes.epoch += 1; const d = deferred(); updates.push(d); const saved = await d.promise; writes.epoch += 1;
      return { ...saved, id, ...patch };
    },
    fetchTask: async () => { throw new Error('unused'); },
    taskMatchesPatch: () => false,
    enqueueTaskMutation: (_id, fn) => fn(),
    alertError: () => {}, renderApp: () => { rendered += 1; },
  });
  install(context, 'function taskById(', '// Update a project in both');
  install(context, 'async function updateTaskWithReadback(', '// Add a normalized label');

  // A's PATCH already committed; its lifecycle reload is in flight.
  const reloading = vm.runInContext('loadTasks()', context);
  assert.equal(fetches.length, 1);
  // B completes while that reload is out.
  const completingB = vm.runInContext("patchTask('b', { status: 'completed' })", context);
  await tick();
  updates[0].resolve({ status: 'planned' });
  const savedB = await completingB;
  assert.equal(savedB.status, 'completed');
  assert.equal(state.tasks.find(t => t.id === 'b').status, 'completed');
  // The reload lands with its pre-B snapshot, then reads again.
  fetches[0].resolve([{ id: 'a', status: 'completed' }, { id: 'a2', status: 'planned' }, { id: 'b', status: 'planned' }]);
  await tick();
  assert.equal(state.tasks.find(t => t.id === 'b').status, 'completed', 'the pre-write snapshot was not installed');
  assert.equal(fetches.length, 2, 'a snapshot that spanned the write is read again');
  fetches[1].resolve([{ id: 'a', status: 'completed' }, { id: 'a2', status: 'planned' }, { id: 'b', status: 'completed' }]);
  assert.equal(await reloading, true);
  assert.deepEqual(installs, ['a:completed,b:completed', 'a:completed,a2:planned,b:completed']);
  assert.ok(installs.every(entry => !entry.includes('b:planned')), 'B never showed as planned again');
  assert.ok(rendered >= 1);
});

test('fee5b02e: writes during every attempt drop the snapshot and ask the refresher', async () => {
  const state = { tasks: [{ id: 'b', status: 'completed' }] };
  let fetched = 0;
  const { context, writes, installs } = taskLoadContext(state, {
    fetchTasks: async () => { fetched += 1; writes.epoch += 1; return [{ id: 'b', status: 'planned' }]; },
  });
  assert.equal(await vm.runInContext('loadTasks()', context), 'stale');
  assert.equal(fetched, 3);
  assert.deepEqual(installs, []);
  assert.equal(writes.triggered, 'stale');
  assert.equal(state.tasks[0].status, 'completed');
});

test('fee5b02e: refreshFromOutside keeps its drop-at-once guard; a newer load supersedes', async () => {
  const state = { tasks: [] };
  let fetched = 0;
  const { context, writes } = taskLoadContext(state, {
    fetchTasks: async () => { fetched += 1; writes.epoch += 1; return []; },
  });
  assert.equal(await vm.runInContext('loadTasks({ guardWrites: true })', context), 'stale');
  assert.equal(fetched, 1);
  assert.equal(writes.triggered, undefined, 'the refresher re-triggers itself');
  const pending = [];
  context.fetchTasks = () => { const d = deferred(); pending.push(d); return d.promise; };
  const older = vm.runInContext('loadTasks()', context);
  const newer = vm.runInContext('loadTasks()', context);
  pending[0].resolve([{ id: 'old' }]);
  pending[1].resolve([{ id: 'new' }]);
  assert.equal(await older, 'superseded');
  assert.equal(await newer, true);
  assert.deepEqual(state.tasks.map(t => t.id), ['new']);
});

// ---- 0eec1ac9: the plan / shutdown walk ------------------------------------

function planContext(planMode, extras = {}) {
  const tasks = planMode.queue.map(entry => ({ id: entry.id, title: entry.id, status: 'planned', plannedFor: null }));
  const state = { planMode, tasks, archivedTasks: [] };
  const calls = [];
  const toasts = [];
  let renders = 0;
  const context = vm.createContext({
    state, setState: patch => Object.assign(state, patch), todayISODate: () => '2026-09-22',
    updateTask: (id, fields) => { const d = deferred(); calls.push({ id, fields, ...d }); return d.promise.then(saved => ({ id, ...fields, ...saved })); },
    renderApp: () => { renders += 1; }, showToast: text => toasts.push(text),
    document: { querySelector: () => null }, normalizeTask: t => t, isInteractiveShortcutTarget,
    ...extras,
  });
  install(context, 'function taskById(', 'function applyTaskPatchLocal(');
  install(context, 'function mergePlanTask(', '// Compile (or refresh) this week');
  return { state, context, calls, toasts, renders: () => renders };
}
const walk = (mode, ids, bucket = 'today') => ({ mode, queue: ids.map(id => ({ id, bucket })), index: 0, added: 0, carried: 0, dropped: 0, rescheduled: 0 });

test('0eec1ac9: a double activation applies one decision and shows the next item', async () => {
  const { state, context, calls } = planContext(walk('plan', ['t1', 't2', 't3']));
  const first = vm.runInContext("planModeAct('add')", context);
  const second = vm.runInContext("planModeAct('add')", context);
  await second;
  assert.equal(calls.length, 1, 'the second activation is ignored while the first is in flight');
  calls[0].resolve({});
  await first;
  assert.equal(state.planMode.index, 1, 'advanced once: t2 is shown, not skipped');
  assert.equal(state.planMode.added, 1);
  assert.equal(state.tasks.find(t => t.id === 't1').plannedFor, '2026-09-22');
  // The lock is released: the next decision acts on t2.
  const next = vm.runInContext("planModeAct('skip')", context);
  await next;
  assert.equal(state.planMode.index, 2);
});

test('0eec1ac9: closing the walk mid-flight keeps the committed write and reports no failure', async () => {
  const { state, context, calls, toasts } = planContext(walk('shutdown', ['t1', 't2'], 'planned'));
  const acting = vm.runInContext("planModeAct('carry')", context);
  vm.runInContext('setState({ planMode: null })', context);
  calls[0].resolve({ plannedFor: '2026-09-23' });
  await acting;
  assert.equal(state.planMode, null);
  assert.deepEqual(toasts, []);
  assert.equal(state.tasks.find(t => t.id === 't1').plannedFor, '2026-09-23');
});

test('0eec1ac9: a reopened walk is not advanced by the old decision', async () => {
  const { state, context, calls } = planContext(walk('plan', ['t1', 't2']));
  const acting = vm.runInContext("planModeAct('add')", context);
  const reopened = { ...walk('plan', ['t1', 't2']) };
  vm.runInContext('setState({ planMode: null })', context);
  state.planMode = reopened;
  calls[0].resolve({});
  await acting;
  assert.equal(state.planMode, reopened);
  assert.equal(state.planMode.index, 0);
});

test('0eec1ac9: a failed decision keeps the item and releases the lock', async () => {
  const { state, context, calls, toasts } = planContext(walk('plan', ['t1', 't2']));
  const acting = vm.runInContext("planModeAct('add')", context);
  calls[0].reject(new Error('offline'));
  await acting;
  assert.equal(state.planMode.index, 0);
  assert.match(toasts[0], /Could not save that decision/);
  const retry = vm.runInContext("planModeAct('add')", context);
  assert.equal(calls.length, 2);
  calls[1].resolve({});
  await retry;
  assert.equal(state.planMode.index, 1);
});

function keyEvent(key, target, extra = {}) {
  const event = { key, target, repeat: false, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false,
    prevented: 0, stopped: 0, ...extra };
  event.preventDefault = () => { event.prevented += 1; event.defaultPrevented = true; };
  event.stopPropagation = () => { event.stopped += 1; };
  return event;
}
const body = { tagName: 'BODY', matches: () => false, closest: () => null };
function button(action) {
  const el = { tagName: 'BUTTON', dataset: { action }, matches: () => false };
  el.closest = selector => (selector.includes('button') ? el : null);
  return el;
}
const timeInput = { tagName: 'INPUT', matches: selector => selector.includes('input'), closest: () => null };

for (const [mode, bucket, expected] of [['plan', 'today', 'add'], ['plan', 'stale', 'today'], ['shutdown', 'planned', 'carry']]) {
  test(`0eec1ac9: Enter with default focus runs the primary decision (${mode}, ${bucket})`, async () => {
    const { state, context, calls } = planContext(walk(mode, ['t1', 't2'], bucket));
    const event = keyEvent('Enter', body);
    context.handlePlanModeKeydown(event);
    assert.equal(event.prevented, 1);
    assert.equal(event.stopped, 1, 'the document-level Enter (open selected task) never also runs');
    assert.equal(calls.length, 1);
    assert.ok('plannedFor' in calls[0].fields);
    calls[0].resolve({});
    await tick();
    assert.equal(state.planMode.index, 1);
    assert.equal(state.planMode[expected === 'carry' ? 'carried' : 'added'], 1);
  });
}

test('0eec1ac9: S skips with default focus and from a focused button', async () => {
  const { state, context, calls } = planContext(walk('shutdown', ['t1', 't2', 't3'], 'planned'));
  const fromBody = keyEvent('s', body);
  context.handlePlanModeKeydown(fromBody);
  await tick();
  assert.equal(state.planMode.index, 1);
  assert.equal(fromBody.stopped, 1);
  context.handlePlanModeKeydown(keyEvent('S', button('shutdown-carry'), { shiftKey: true }));
  await tick();
  assert.equal(state.planMode.index, 2);
  assert.equal(calls.length, 0);
});

test('0eec1ac9: Enter on a focused plan button is left to that button', () => {
  const { state, context, calls } = planContext(walk('plan', ['t1', 't2']));
  for (const action of ['plan-mode-skip', 'shutdown-drop', 'shutdown-reschedule']) {
    const event = keyEvent('Enter', button(action));
    context.handlePlanModeKeydown(event);
    assert.equal(event.prevented, 0, `${action}: its native activation runs`);
    assert.equal(event.stopped, 0);
  }
  assert.equal(calls.length, 0);
  assert.equal(state.planMode.index, 0);
});

test('0eec1ac9: fields keep their keys, a held Enter does nothing, closed walks ignore keys', () => {
  const { state, context, calls } = planContext(walk('plan', ['t1']));
  const typing = keyEvent('Enter', timeInput);
  context.handlePlanModeKeydown(typing);
  assert.equal(typing.prevented, 0);
  const held = keyEvent('Enter', button('plan-mode-add'), { repeat: true });
  context.handlePlanModeKeydown(held);
  assert.equal(held.prevented, 1, 'a held Enter does not re-activate the button');
  assert.equal(calls.length, 0);
  state.planMode = null;
  const closed = keyEvent('Enter', body);
  context.handlePlanModeKeydown(closed);
  assert.equal(closed.prevented, 0);
});

test('0eec1ac9: Enter on the end-of-walk summary closes it', () => {
  const { state, context } = planContext({ ...walk('plan', ['t1']), index: 1 });
  context.handlePlanModeKeydown(keyEvent('Enter', body));
  assert.equal(state.planMode, null);
});

// ---- a68bd2cf: partial success and failed writes are reported truthfully ----

function outcomeContext(state, { failIds = [], extras = {} } = {}) {
  const toasts = [];
  const errors = [];
  const patched = [];
  const context = vm.createContext({
    state, setState: patch => Object.assign(state, patch),
    enqueueTaskMutation: (_id, fn) => fn(),
    updateTaskWithReadback: async (id, patch) => {
      if (failIds.includes(id)) throw new Error('lost');
      patched.push({ id, patch });
      return { id, ...patch };
    },
    loadTasks: async () => true, renderApp: () => {}, dismissToast: () => {},
    showToast: (message, undo, duration) => toasts.push({ message, undo, duration }),
    alertError: message => errors.push(message),
    taskById: id => state.tasks.find(t => t.id === id) || null,
    apiStatus: key => key, todayISODate: () => '2026-09-22', nextMondayIso: () => '2026-09-28',
    ...extras,
  });
  install(context, 'function triagePatch(', 'function overdueTaskIds(');
  install(context, 'async function bulkSetStatus(', 'async function archiveSelectedTasks(');
  return { context, toasts, errors, patched };
}

test('a68bd2cf: triage reports the tasks that committed and undoes only those', async () => {
  const state = { tasks: ['a', 'b', 'c'].map(id => ({ id, dueDate: '2026-09-01', status: 'planned' })) };
  const { context, toasts, errors, patched } = outcomeContext(state, { failIds: ['b'] });
  await vm.runInContext("triageTasks(['a', 'b', 'c'], 'today', 'today')", context);
  assert.deepEqual(errors, []);
  assert.equal(toasts[0].message, '2 tasks → today; 1 could not be changed.');
  assert.equal(typeof toasts[0].undo, 'function');
  patched.length = 0;
  await toasts[0].undo();
  assert.deepEqual(patched.map(p => p.id), ['a', 'c'], 'undo restores only the committed tasks');
  assert.deepEqual({ ...patched[0].patch }, { dueDate: '2026-09-01' });
});

test('a68bd2cf: a triage that commits nothing says so', async () => {
  const state = { tasks: [{ id: 'a', status: 'planned' }] };
  const { context, toasts, errors } = outcomeContext(state, { failIds: ['a'] });
  await vm.runInContext("triageTasks(['a'], 'backlog', 'Backlog')", context);
  assert.deepEqual(errors, ['apply the triage decision']);
  assert.deepEqual(toasts, []);
});

test('a68bd2cf: bulk status keeps unconfirmed tasks selected and reports the committed ones', async () => {
  const state = { tasks: ['a', 'b', 'c'].map(id => ({ id, status: 'planned' })), multiSelectIds: ['a', 'b', 'c'] };
  const { context, toasts, patched } = outcomeContext(state, { failIds: ['c'] });
  await vm.runInContext("bulkSetStatus('completed', 'Done')", context);
  assert.deepEqual([...state.multiSelectIds], ['c']);
  assert.equal(toasts[0].message, '2 tasks → Done; 1 could not be changed and remain selected.');
  patched.length = 0;
  await toasts[0].undo();
  assert.deepEqual(JSON.parse(JSON.stringify(patched)), [{ id: 'a', patch: { status: 'planned' } }, { id: 'b', patch: { status: 'planned' } }]);
});

test('a68bd2cf: a failed refresh after committed writes is not a failed write', async () => {
  const state = { tasks: [{ id: 'a', status: 'planned' }], multiSelectIds: ['a'] };
  const { context, toasts, errors } = outcomeContext(state, { extras: { loadTasks: async () => { throw new Error('offline'); } } });
  await vm.runInContext("bulkSetStatus('backlog', 'Backlog')", context);
  assert.deepEqual(errors, []);
  assert.equal(toasts[0].message, '1 task → Backlog. The list could not refresh; reload to reconcile it.');
});

test('a68bd2cf: plan-add reports per-task outcomes through the same helper', () => {
  const start = source.indexOf("case 'plan-add-today': {");
  const block = source.slice(start, source.indexOf("case 'open-plan-mode'", start));
  assert.match(block, /applyTaskPatches\(ids, \(\) => \(\{ plannedFor: today \}\)\)/);
  assert.match(block, /partialTaskOutcome\(/);
  assert.doesNotMatch(block, /Promise\.all\(/);
});

function workingNoteContext({ link = async () => [], open = async () => true, create } = {}) {
  const state = { tasks: [{ id: 't1', title: 'Rotate keys', projectId: 'p1' }] };
  const toasts = [];
  let created = 0;
  const context = vm.createContext({
    state, projectsById: () => ({ p1: { id: 'p1', slug: 'homelab', name: 'Homelab' } }),
    createDocument: create || (async (payload) => { created += 1; return { id: `d${created}`, ...payload }; }),
    linkTaskDocument: link, loadDocuments: async () => true, openDocumentInEditor: open,
    showToast: message => toasts.push(message),
  });
  install(context, '// A working note for the open task', 'async function handleAction(');
  return { context, toasts, created: () => created };
}

test('a68bd2cf: a failed link after a committed working note is reported as a failed link', async () => {
  const { context, toasts, created } = workingNoteContext({ link: async () => { throw new Error('link failed'); } });
  await vm.runInContext("startWorkingNote('t1')", context);
  assert.equal(created(), 1);
  assert.match(toasts[0], /^Working note created, but Prax could not link it to the task\./);
  assert.doesNotMatch(toasts[0], /created and linked/);
});

test('a68bd2cf: a failed open after the create never reads as a failed create', async () => {
  const { context, toasts } = workingNoteContext({ open: async () => { throw new Error('boom'); } });
  await vm.runInContext("startWorkingNote('t1')", context);
  assert.match(toasts[0], /^Working note created, but Prax could not open it\./);
  const ok = workingNoteContext();
  await vm.runInContext("startWorkingNote('t1')", ok.context);
  assert.deepEqual(ok.toasts, ['Working note created and linked.']);
});

test('d469a9c0: a double click on Working note creates one note', async () => {
  const gate = deferred();
  let calls = 0;
  const { context, toasts } = workingNoteContext({
    create: async (payload) => { calls += 1; await gate.promise; return { id: 'd1', ...payload }; },
  });
  const first = vm.runInContext("startWorkingNote('t1')", context);
  const second = vm.runInContext("startWorkingNote('t1')", context);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(toasts, ['Working note created and linked.']);
});

test('a68bd2cf: a failed promote keeps its error and never says Promoted', () => {
  const start = source.indexOf("case 'promote-task':");
  const block = source.slice(start, source.indexOf("case 'restore-task'", start));
  assert.match(block, /if \(await patchTask\([^)]*\)[^)]*\)\) showToast\('Promoted to board'\)/);
});

// ---- d469a9c0: repeated activation creates once ----------------------------

test('d469a9c0: a double click on New document creates one document', async () => {
  const state = { documents: [], newDocMenuOpen: true };
  const gate = deferred();
  let creates = 0;
  const toasts = [];
  const context = vm.createContext({
    state, setState: patch => Object.assign(state, patch),
    prepareEditorNavigation: async () => true, destroyEditorController: () => {}, defaultProjectId: () => 'p1',
    templateById: () => ({ title: 'Untitled', body: '', documentType: 'note' }),
    createDocument: async (payload) => { creates += 1; await gate.promise; return { id: `d${creates}`, ...payload }; },
    loadDocuments: async () => { throw new Error('library refresh failed'); },
    seedEditorDraft: doc => { state.editorDocId = doc.id; }, writeToken: 0,
    renderApp: () => {}, showToast: text => toasts.push(text), alertError: text => toasts.push(`error: ${text}`),
  });
  install(context, '// One new document at a time', 'function markdownImportProjects(');
  const first = vm.runInContext('createNewDocument()', context);
  const second = vm.runInContext('createNewDocument()', context);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.equal(creates, 1);
  assert.equal(state.editorDocId, 'd1', 'a failed Library refresh still opens the created document');
  assert.deepEqual(toasts, ['New document — rename it in the title bar']);
  assert.equal(await vm.runInContext('createNewDocument()', context), true, 'the lock is released');
});

test('d469a9c0: generate-runbook reopened mid-request shows that request, not a second one', async () => {
  const state = { genRbOpen: false };
  const gate = deferred();
  let generated = 0;
  const fields = { '[data-genrb-input]': { value: 'Postgres primary down' }, '[data-genrb-project]': { value: 'p1' } };
  const context = vm.createContext({
    state, setState: patch => Object.assign(state, patch), appRoot: { querySelector: s => fields[s] || null },
    captureProjectChoices: () => [{ id: 'p1', slug: 'homelab' }], INBOX_SLUG: 'inbox',
    generateRunbook: async () => { generated += 1; await gate.promise; return { document: { id: 'rb1' } }; },
    openDocumentInEditor: async () => true, renderApp: () => {}, showToast: () => {},
  });
  install(context, '// A generation keeps running after Esc', '// ---------------------------------------------------------------------------');
  const running = vm.runInContext('runGenerateRunbook()', context);
  vm.runInContext('setState({ genRbOpen: false })', context); // Esc
  vm.runInContext('openGenerateRunbook()', context);
  assert.equal(state.genRbLoading, true, 'the reopened dialog shows the running request');
  await vm.runInContext('runGenerateRunbook()', context);
  assert.equal(generated, 1);
  gate.resolve();
  await running;
  assert.equal(state.genRbLoading, false);
});

test('d469a9c0: held Enter never repeats a create and confirm OK runs once', () => {
  const keydown = source.slice(source.indexOf("if (target.matches?.('[data-new-project-name]') && event.key === 'Enter')"));
  for (const field of ['data-new-project-name', 'data-confirm-input', 'data-checklist-new']) {
    const at = keydown.indexOf(`[${field}]`);
    assert.ok(at >= 0, field);
    assert.match(keydown.slice(at, at + 260), /!event\.repeat/, `${field} ignores a held Enter`);
  }
  const click = source.slice(source.indexOf("appRoot.addEventListener('click'"), source.indexOf("appRoot.addEventListener('focusout'"));
  assert.match(click, /el\.matches\('\[data-confirm-ok\]'\)[\s\S]*el\.disabled = true/);
});

// ---- 40285cca: title autosave keeps a typed trailing space ------------------

function titleSaveContext(state, input) {
  const context = vm.createContext({
    state, setState: patch => Object.assign(state, patch),
    documentDraftSavedPatch, documentDraftIsDirty, normalizeDocumentDraftTitle, canPreserveEditorAfterDraftSave,
    storeDocumentDraftRecovery: () => true, clearDocumentDraftRecovery: () => {}, documentDraftStorage: () => null,
    scheduleDocumentAutosave: () => {}, setSaveStatusInPlace: () => {}, documentEditorController: null,
    updateDocumentLivePreview: () => {}, resolveWikiLink: () => null, editorTaskToggles: () => true,
    renderApp: () => { throw new Error('the title input must not be rebuilt'); },
    appRoot: { querySelector: selector => (selector === '[data-doc-title]' ? input : (selector.includes('document-editor') ? {} : null)) },
    document: { activeElement: input },
  });
  install(context, 'function applyDocumentDraftSave(', 'async function saveDocumentDraft(');
  return context;
}

test('40285cca: an autosave of "Post " leaves the typed trailing space in the input', () => {
  const base = { id: 'd1', title: 'Post', body: 'b', revision: 'r1' };
  const saved = { ...base, title: 'Post', revision: 'r2' };
  const input = { value: 'Post ' };
  const state = { editorDocId: 'd1', documentDraftId: 'd1', documents: [base], documentDraftTitle: 'Post ', documentDraftBody: 'b' };
  const context = titleSaveContext(state, input);
  context.applyDocumentDraftSave(saved, { draftId: 'd1', sentDraft: { title: 'Post ', body: 'b' } });
  assert.equal(input.value, 'Post ', 'the space under the caret survives the save');
  assert.equal(state.documentDraftTitle, 'Post ');
  assert.equal(state.isDocumentDirty, false, 'the trimmed title is what was saved');
  // Typing continues: the next save sends "Post mortem".
  input.value = 'Post mortem';
  state.documentDraftTitle = 'Post mortem';
  context.applyDocumentDraftSave({ ...saved, title: 'Post mortem', revision: 'r3' }, { draftId: 'd1', sentDraft: { title: 'Post mortem', body: 'b' } });
  assert.equal(input.value, 'Post mortem');
});

test('40285cca: a title that really changed on the server is still written to the input', () => {
  const base = { id: 'd1', title: 'Old', body: 'b', revision: 'r1' };
  const input = { value: 'Old' };
  const state = { editorDocId: 'd1', documentDraftId: 'd1', documents: [base], documentDraftTitle: 'Old', documentDraftBody: 'b2' };
  const context = titleSaveContext(state, input);
  context.applyDocumentDraftSave({ ...base, title: 'Renamed elsewhere', body: 'b2', revision: 'r2' }, { draftId: 'd1', sentDraft: { title: 'Old', body: 'b2' } });
  assert.equal(input.value, 'Renamed elsewhere');
});
