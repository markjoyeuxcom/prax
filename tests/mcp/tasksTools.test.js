import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskTools } from '../../mcp/tools/tasks.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_TASK = {
  id: TASK_ID, title: 'Backup CNPG', description: 'details',
  status: 'planned', priority: 'high', projectId: 'homelab',
  dueDate: '2026-05-12', sortOrder: 0,
};

test('exposes the four task tools', () => {
  const names = createTaskTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['create_task', 'get_task', 'search_tasks', 'update_task']);
});

test('search_tasks maps args and returns task summaries', async () => {
  let received;
  const client = { listTasks: async (f) => { received = f; return [SAMPLE_TASK]; } };
  const tool = byName(createTaskTools(client), 'search_tasks');
  const res = await tool.handler({ query: 'backup', project: 'homelab', status: 'planned' });
  assert.deepEqual(received, { q: 'backup', project: 'homelab', status: 'planned' });
  const data = JSON.parse(res.content[0].text);
  assert.equal('description' in data[0], false);
  assert.equal(data[0].priority, 'high');
});

test('get_task validates UUID and handles missing', async () => {
  const present = { getTask: async () => SAMPLE_TASK };
  const tools = createTaskTools(present);
  const tool = byName(tools, 'get_task');
  assert.match((await tool.handler({ id: 'bad' })).content[0].text, /valid UUID/);
  assert.deepEqual(JSON.parse((await tool.handler({ id: TASK_ID })).content[0].text), SAMPLE_TASK);

  const absent = createTaskTools({ getTask: async () => null });
  const res = await byName(absent, 'get_task').handler({ id: TASK_ID });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No task with id/);
});

test('create_task forwards args to the client', async () => {
  let received;
  const client = { createTask: async (p) => { received = p; return { id: 'new', ...p }; } };
  const tool = byName(createTaskTools(client), 'create_task');
  const payload = { title: 'New', project: 'work', priority: 'medium', status: 'planned' };
  await tool.handler(payload);
  assert.deepEqual(received, payload);
});

test('create_task applies priority/status defaults the API requires', async () => {
  let received;
  const client = { createTask: async (p) => { received = p; return { id: 'new', ...p }; } };
  const tool = byName(createTaskTools(client), 'create_task');
  await tool.handler({ title: 'Minimal', project: 'homelab' });
  assert.deepEqual(received, {
    priority: 'medium', status: 'planned', title: 'Minimal', project: 'homelab',
  });
});

test('create_task lets explicit priority/status override the defaults', async () => {
  let received;
  const client = { createTask: async (p) => { received = p; return { id: 'new', ...p }; } };
  const tool = byName(createTaskTools(client), 'create_task');
  await tool.handler({ title: 'X', project: 'work', priority: 'high', status: 'in-progress' });
  assert.equal(received.priority, 'high');
  assert.equal(received.status, 'in-progress');
});

test('update_task rejects empty patch and bad UUID, maps missing to error', async () => {
  const ok = { updateTask: async (id, patch) => ({ id, ...patch }) };
  const tool = byName(createTaskTools(ok), 'update_task');
  assert.match((await tool.handler({ id: 'bad', title: 'x' })).content[0].text, /valid UUID/);
  assert.match((await tool.handler({ id: TASK_ID })).content[0].text, /at least one field/);
  assert.equal(JSON.parse((await tool.handler({ id: TASK_ID, status: 'completed' })).content[0].text).status, 'completed');

  const missing = createTaskTools({ updateTask: async () => null });
  const res = await byName(missing, 'update_task').handler({ id: TASK_ID, status: 'completed' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No task with id/);
});
