import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskRecord, buildTaskPatch, createTask, updateTask, completeTask, setChecklistItem,
  resolveChecklistItem, appendNotes, parseLabels, formatTask, formatTaskList,
} from '../../cli/lib/tasks.js';

const TASK_ID = '12345678-1234-4234-8234-123456789012';

const fakeClient = (overrides = {}) => ({
  ensureProject: async (p) => p,
  importTasks: async (payload) => ({ mode: payload.mode, imported: 1, skipped: 0, tasks: [{ id: TASK_ID, ...payload.tasks[0] }], replayed: false }),
  getTask: async (id) => ({ id, title: 'T', notes: 'first' }),
  patchTask: async (id, patch) => ({ id, title: 'T', status: 'planned', ...patch }),
  listChecklist: async () => [],
  setChecklistItem: async (taskId, itemId, completed) => ({ id: itemId, label: 'x', completed }),
  ...overrides,
});

test('buildTaskRecord defaults priority/status and shapes labels and checklist', () => {
  const record = buildTaskRecord({
    title: '  Ship it  ',
    flags: { label: '@Ops, ops, ci', due: '2026-10-01', description: 'd', notes: 'n' },
    checks: ['tests pass', ' ', 'docs updated'],
  });
  assert.deepEqual(record, {
    title: 'Ship it', priority: 'medium', status: 'planned', description: 'd', notes: 'n',
    dueDate: '2026-10-01', labels: ['ops', 'ci'],
    checklist: [{ label: 'tests pass', completed: false }, { label: 'docs updated', completed: false }],
  });
});

test('buildTaskRecord rejects an empty title, bad enums and bad dates', () => {
  assert.throws(() => buildTaskRecord({ title: ' ' }), /requires a title/);
  assert.throws(() => buildTaskRecord({ title: 'T', flags: { priority: 'urgent' } }), /Unknown --priority "urgent"/);
  assert.throws(() => buildTaskRecord({ title: 'T', flags: { status: 'todo' } }), /Unknown --status "todo"/);
  assert.throws(() => buildTaskRecord({ title: 'T', flags: { due: '1/10/2026' } }), /--due must be YYYY-MM-DD/);
});

test('createTask sends one append-mode import with a stable requestId and returns the created task', async () => {
  let sent;
  const client = fakeClient({ importTasks: async (payload) => { sent = payload; return { tasks: [{ id: TASK_ID, title: 'T' }], replayed: false }; } });
  const record = buildTaskRecord({ title: 'T' });
  const { task, replayed, requestId, project } = await createTask(client, { project: 'prax', record });
  assert.equal(sent.mode, 'append');
  assert.equal(sent.project, 'prax');
  assert.equal(sent.format, 'moomora.tasks');
  assert.equal(sent.version, 1);
  assert.match(sent.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(sent.requestId, requestId);
  assert.deepEqual(sent.tasks, [record]);
  assert.equal(task.id, TASK_ID);
  assert.equal(replayed, false);
  assert.equal(project, 'prax');
});

test('createTask reports a replayed import instead of a second task', async () => {
  const client = fakeClient({ importTasks: async () => ({ tasks: [{ id: TASK_ID, title: 'T' }], replayed: true }) });
  const { replayed } = await createTask(client, { project: 'prax', record: buildTaskRecord({ title: 'T' }), requestId: TASK_ID });
  assert.equal(replayed, true);
});

test('createTask surfaces an import that created nothing', async () => {
  const client = fakeClient({ importTasks: async () => ({ tasks: [], imported: 0 }) });
  await assert.rejects(createTask(client, { project: 'prax', record: buildTaskRecord({ title: 'T' }) }), /reported no created task/);
});

test('buildTaskPatch includes only the given fields and clears a date on empty', () => {
  assert.deepEqual(buildTaskPatch({ status: 'in-progress', due: '' }), { status: 'in-progress', dueDate: null });
  assert.deepEqual(buildTaskPatch({ label: 'a,b', planned: '2026-09-22' }), { labels: ['a', 'b'], plannedFor: '2026-09-22' });
  assert.throws(() => buildTaskPatch({ title: '  ' }), /--title cannot be empty/);
});

test('updateTask refuses an empty patch and a non-uuid id', async () => {
  await assert.rejects(updateTask(fakeClient(), TASK_ID, { patch: {} }), /at least one field/);
  await assert.rejects(updateTask(fakeClient(), 'nope', { patch: { status: 'planned' } }), /task uuid/);
});

test('updateTask --append-notes reads the current notes and sends the concatenation', async () => {
  let patched;
  const client = fakeClient({ patchTask: async (id, patch) => { patched = patch; return { id, ...patch }; } });
  await updateTask(client, TASK_ID, { patch: {}, appendNotes: 'second' });
  assert.deepEqual(patched, { notes: 'first\n\nsecond' });
  await assert.rejects(updateTask(client, TASK_ID, { patch: { notes: 'x' }, appendNotes: 'y' }), /either --notes or --append-notes/);
});

test('appendNotes handles empty and trailing whitespace', () => {
  assert.equal(appendNotes('', 'a'), 'a');
  assert.equal(appendNotes('a\n\n', 'b'), 'a\n\nb');
  assert.equal(appendNotes('a', '  '), 'a');
});

test('completeTask sets status completed with a connect-only retry', async () => {
  let seen;
  const client = fakeClient({ patchTask: async (id, patch, opts) => { seen = { id, patch, opts }; return { id, ...patch }; } });
  await completeTask(client, TASK_ID);
  assert.deepEqual(seen.patch, { status: 'completed' });
  assert.equal(seen.opts.retryUnavailable, 'connect-only');
});

test('resolveChecklistItem accepts a 1-based number or an exact case-insensitive label', () => {
  const items = [{ id: 'a', label: 'Write spec' }, { id: 'b', label: 'Tests pass' }, { id: 'c', label: 'tests pass' }];
  assert.equal(resolveChecklistItem(items, '2').id, 'b');
  assert.equal(resolveChecklistItem(items, 'write SPEC').id, 'a');
  assert.throws(() => resolveChecklistItem(items, '4'), /does not exist \(the task has 3\)/);
  assert.throws(() => resolveChecklistItem(items, 'tests pass'), /matches 2 checklist items/);
  assert.throws(() => resolveChecklistItem(items, 'nope'), /no checklist item labelled/);
});

test('setChecklistItem resolves then patches the chosen item', async () => {
  let seen;
  const client = fakeClient({
    listChecklist: async () => [{ id: 'i1', label: 'one' }, { id: 'i2', label: 'two' }],
    setChecklistItem: async (taskId, itemId, completed) => { seen = { taskId, itemId, completed }; return { id: itemId, label: 'two', completed }; },
  });
  const { item, index } = await setChecklistItem(client, TASK_ID, 'two', true);
  assert.deepEqual(seen, { taskId: TASK_ID, itemId: 'i2', completed: true });
  assert.equal(index, 2);
  assert.equal(item.completed, true);
});

test('parseLabels normalises like the app', () => {
  assert.deepEqual(parseLabels('@A, a ,b'), ['a', 'b']);
  assert.equal(parseLabels(undefined), undefined);
});

test('formatters render a list line and a task with numbered checklist', () => {
  const task = { id: TASK_ID, title: 'T', status: 'planned', priority: 'high', dueDate: '2026-10-01', labels: ['ops'], notes: 'n' };
  const list = formatTaskList([task]);
  assert.match(list, /\[planned\] T {2}\(12345678-/);
  assert.match(list, /high · due 2026-10-01 · @ops/);
  const shown = formatTask(task, [{ label: 'a', completed: true }, { label: 'b', completed: false }]);
  assert.match(shown, /1\. \[x\] a\n {2}2\. \[ \] b/);
  assert.match(shown, /Notes:\nn/);
  assert.equal(formatTaskList([]), 'No tasks.');
});
