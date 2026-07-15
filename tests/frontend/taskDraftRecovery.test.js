import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearTaskDraftRecovery,
  loadTaskDraftRecovery,
  normalizeTaskDraftTitle,
  resolveTaskDraftRecovery,
  storeTaskDraftRecovery,
  taskDraftIsDirty,
} from '../../public/js/taskDraftRecovery.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

const task = { id: 'task-1', title: 'Saved title', description: 'Saved description', notes: 'Saved notes' };
const draft = { title: 'Local title', description: 'Local description', notes: 'Local notes' };

test('task draft comparison normalizes title but preserves exact multiline fields', () => {
  assert.equal(normalizeTaskDraftTitle('  Kept  '), 'Kept');
  assert.equal(taskDraftIsDirty(task, { ...task, title: ' Saved title ' }), false);
  assert.equal(taskDraftIsDirty(task, { ...task, notes: 'Saved notes\n' }), true);
  assert.equal(taskDraftIsDirty(task, draft), true);
});

test('stores and reloads one base plus one coherent three-field draft', () => {
  const storage = memoryStorage();
  assert.equal(storeTaskDraftRecovery(storage, { task, ...draft }), true);
  assert.deepEqual(loadTaskDraftRecovery(storage, task.id), {
    schemaVersion: 1,
    taskId: 'task-1',
    baseTitle: 'Saved title',
    baseDescription: 'Saved description',
    baseNotes: 'Saved notes',
    draftTitle: 'Local title',
    draftDescription: 'Local description',
    draftNotes: 'Local notes',
  });
});

test('resolves safe recovery, obsolete acknowledgement, and remote conflict', () => {
  const storage = memoryStorage();
  storeTaskDraftRecovery(storage, { task, ...draft });
  const recovery = loadTaskDraftRecovery(storage, task.id);
  assert.deepEqual(resolveTaskDraftRecovery(task, recovery), {
    kind: 'recovered', clear: false, ...draft, isDirty: true, status: 'Recovered draft',
  });
  assert.equal(resolveTaskDraftRecovery({ ...task, ...draft }, recovery).kind, 'obsolete');
  const conflict = resolveTaskDraftRecovery({ ...task, notes: 'Remote notes' }, recovery);
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflict.notes, 'Local notes');
});

test('conditional clear cannot remove a newer task draft', () => {
  const storage = memoryStorage();
  storeTaskDraftRecovery(storage, { task, ...draft });
  assert.equal(clearTaskDraftRecovery(storage, task.id, { ...draft, notes: 'Older notes' }), false);
  assert.ok(loadTaskDraftRecovery(storage, task.id));
  assert.equal(clearTaskDraftRecovery(storage, task.id, draft), true);
  assert.equal(loadTaskDraftRecovery(storage, task.id), null);
});

test('malformed recovery records are removed', () => {
  const storage = memoryStorage();
  storage.setItem('prax.taskDraftRecovery.v1.task-1', '{"schemaVersion":1}');
  assert.equal(loadTaskDraftRecovery(storage, task.id), null);
  assert.equal(storage.values.size, 0);
});
