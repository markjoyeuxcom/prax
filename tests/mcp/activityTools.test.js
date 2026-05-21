import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityTools } from '../../mcp/tools/activity.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_EVENTS = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    taskId: TASK_ID,
    eventType: 'status_changed',
    message: 'Status changed to done',
    createdAt: '2026-05-21T10:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    taskId: TASK_ID,
    eventType: 'created',
    message: 'Task created',
    createdAt: '2026-05-21T09:00:00.000Z',
  },
];

test('exposes the activity tool', () => {
  const names = createActivityTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, ['list_task_activity']);
});

test('list_task_activity is read-only and rejects a bad UUID before calling the client', async () => {
  let called = false;
  const client = { listTaskActivity: async () => { called = true; return []; } };
  const tool = byName(createActivityTools(client), 'list_task_activity');
  assert.equal(tool.annotations.readOnlyHint, true);
  const res = await tool.handler({ taskId: 'nope' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /taskId must be a valid UUID/);
  assert.equal(called, false);
});

test('list_task_activity calls listTaskActivity and returns the events', async () => {
  let received;
  const client = { listTaskActivity: async (taskId) => { received = taskId; return SAMPLE_EVENTS; } };
  const tool = byName(createActivityTools(client), 'list_task_activity');
  const res = await tool.handler({ taskId: TASK_ID });
  assert.equal(received, TASK_ID);
  assert.deepEqual(JSON.parse(res.content[0].text), SAMPLE_EVENTS);
});
