import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createClient } from '../../cli/lib/apiClient.js';
import { createTask, updateTask, completeTask, setChecklistItem } from '../../cli/lib/tasks.js';

// `prax task` writes are attributable (QINV-11): a real app over in-memory
// SQLite on a random loopback port, driven by the CLI's own client with a
// known agent id. The chronicle must say that an agent — and which one —
// created the task and changed its title, notes and checklist.

const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
const app = await buildApp({ config });
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;
test.after(() => app.close());

const agentClient = createClient({ bases: [base], agent: 'codex', env: {} });
const activity = async (id) => (await app.inject({ method: 'GET', url: `/api/tasks/${id}/activity` })).json();

test('task add records a created event with the actor and agent id', async () => {
  const { task } = await createTask(agentClient, {
    project: 'homelab',
    record: { title: 'Rotate the token', priority: 'medium', status: 'planned', checklist: [{ label: 'Issued', completed: false }] },
  });
  const events = await activity(task.id);
  assert.deepEqual(events.map((e) => [e.eventType, e.message, e.actor, e.actorAgent]), [
    ['created', 'Task created', 'agent', 'codex'],
  ]);
});

test('title, notes and checklist changes appear in the activity, attributed', async () => {
  const { task } = await createTask(agentClient, {
    project: 'homelab', record: { title: 'Draft', priority: 'medium', status: 'planned', checklist: [{ label: 'One', completed: false }] },
  });
  await updateTask(agentClient, task.id, { patch: { title: 'Final title' } });
  await updateTask(agentClient, task.id, { patch: {}, appendNotes: 'Branch feat/x, tests green' });
  await setChecklistItem(agentClient, task.id, '1', true);
  await setChecklistItem(agentClient, task.id, '1', true); // an idempotent repeat is not news
  await completeTask(agentClient, task.id);
  const events = (await activity(task.id)).reverse(); // oldest first
  assert.deepEqual(events.map((e) => e.message), [
    'Task created',
    'Renamed to "Final title"',
    'Notes updated',
    'Checked: One',
    'Status → completed',
  ]);
  assert.ok(events.every((e) => e.actor === 'agent' && e.actorAgent === 'codex'));
});

test('a person\'s edits carry no agent id, and a burst of notes autosaves logs once', async () => {
  const created = await app.inject({
    method: 'POST', url: '/api/tasks', payload: { title: 'Human task', priority: 'low', status: 'planned', project: 'homelab' },
  });
  const id = created.json().id;
  for (const notes of ['a', 'ab', 'abc']) {
    await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { notes } });
  }
  const added = await app.inject({ method: 'POST', url: `/api/tasks/${id}/checklist`, payload: { label: 'Step' } });
  await app.inject({ method: 'DELETE', url: `/api/tasks/${id}/checklist/${added.json().id}` });
  const events = (await activity(id)).reverse();
  assert.deepEqual(events.map((e) => e.message), [
    'Task created', 'Notes updated', 'Checklist item added: Step', 'Checklist item removed: Step',
  ]);
  assert.ok(events.every((e) => e.actor === 'user' && e.actorAgent === null));
});

test('an agent id without an agent origin is ignored, and a person\'s import stays unlogged', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/tasks/import',
    headers: { 'x-prax-agent': 'codex' },
    payload: { project: 'homelab', mode: 'append', tasks: [{ title: 'Restored task' }] },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(await activity(res.json().tasks[0].id), []);
});
