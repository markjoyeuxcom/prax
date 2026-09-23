import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskDrawerController } from '../../public/js/taskDrawerController.js';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function drawerFor(state, deps = {}) {
  const toasts = []; let renders = 0;
  const drawer = createTaskDrawerController({
    getState: () => state, setState: patch => Object.assign(state, patch), renderApp: () => { renders += 1; },
    showToast: text => toasts.push(text), alertError: text => toasts.push(`error: ${text}`), getRoot: () => ({ querySelector: () => null }),
    taskById: id => (state.tasks || []).find(task => task.id === id) || null,
    ...deps,
  });
  return { drawer, toasts, renders: () => renders };
}

test('a working note starts from the task, its project and the two headings', async () => {
  const state = { tasks: [{ id: 't1', title: 'Rotate keys', projectId: 'p1' }] };
  const created = [];
  const { drawer } = drawerFor(state, {
    projectsById: () => ({ p1: { id: 'p1', slug: 'homelab', name: 'Homelab' } }),
    createDocument: async payload => { created.push(payload); return { id: 'd1', ...payload }; },
    linkTaskDocument: async () => [], loadDocuments: async () => true, openDocumentInEditor: async () => true,
  });
  await drawer.startWorkingNote('t1');
  assert.deepEqual(created, [{
    title: 'Working note — Rotate keys', project: 'homelab', documentType: 'note',
    body: '# Working note — Rotate keys\n\n_Task:_ Rotate keys _(Homelab)_\n\n## Context\n\n\n## Findings\n\n',
  }]);
});

test('a drawer context that lands after another task opened is dropped, and so are its suggestions', async () => {
  const state = { drawerTaskId: 't1' };
  const pending = deferred();
  let relatedCalls = 0;
  const { drawer } = drawerFor(state, {
    fetchTaskDocuments: () => pending.promise, fetchTaskChecklist: async () => [], fetchTaskActivity: async () => [],
    fetchRelatedDocuments: async () => { relatedCalls += 1; return { suggestions: [] }; },
  });
  const loading = drawer.loadDrawerContext('t1');
  state.drawerTaskId = 't2';
  pending.resolve([{ id: 'd1' }]);
  assert.equal(await loading, false);
  assert.equal(state.taskDocuments, undefined);
  assert.equal(relatedCalls, 0);
});

test('a dismissed related document stays dismissed for the session', async () => {
  const state = { drawerTaskId: 't1', taskRelatedDocs: null };
  const { drawer } = drawerFor(state, {
    fetchTaskDocuments: async () => [], fetchTaskChecklist: async () => [], fetchTaskActivity: async () => [],
    fetchRelatedDocuments: async () => ({ suggestions: [{ id: 'a' }, { id: 'b' }] }),
  });
  await drawer.loadDrawerContext('t1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.taskRelatedDocs.suggestions.map(doc => doc.id), ['a', 'b']);
  await drawer.actions['dismiss-related-doc']({ dataset: { documentId: 'a' } }, { stopPropagation() {} });
  assert.deepEqual(state.taskRelatedDocs.suggestions.map(doc => doc.id), ['b']);
  await drawer.loadDrawerContext('t1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.taskRelatedDocs.suggestions.map(doc => doc.id), ['b'], 'a reload keeps the dismissal');
});

test('a repeated checklist add while the first is in flight adds one item', async () => {
  const state = { drawerTaskId: 't1', taskBoardExtras: {} };
  const gate = deferred(); let adds = 0;
  const field = { value: 'Check backups' };
  const { drawer } = drawerFor(state, {
    getRoot: () => ({ querySelector: () => field }),
    addChecklistItem: async () => { adds += 1; await gate.promise; },
    fetchTaskChecklist: async () => [{ id: 'c1', label: 'Check backups' }],
  });
  const first = drawer.actions['add-checklist-item']();
  const second = drawer.actions['add-checklist-item']();
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(adds, 1);
  assert.equal(field.value, '', 'the added text is cleared from the field');
  assert.deepEqual(state.taskChecklist, [{ id: 'c1', label: 'Check backups' }]);
});

test('a label is normalized, deduplicated and cleared from the draft', async () => {
  const state = { drawerTaskId: 't1', tasks: [{ id: 't1', labels: ['ops'] }] };
  const patches = [];
  const { drawer } = drawerFor(state, { patchTask: async (id, patch) => { patches.push([id, patch]); return { id, ...patch }; } });
  await drawer.addTaskLabel(' OPS ');
  assert.deepEqual(patches, [], 'an existing label is not added twice');
  await drawer.addTaskLabel('On Call');
  assert.equal(patches.length, 1);
  assert.equal(patches[0][0], 't1');
  assert.equal(patches[0][1].labels.length, 2);
  assert.equal(state.taskLabelDraft, '');
});
