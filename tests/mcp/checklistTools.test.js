import test from 'node:test';
import assert from 'node:assert/strict';
import { createChecklistTools } from '../../mcp/tools/checklist.js';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_ITEM = { id: ITEM_ID, label: 'Restore from backup', completed: false, sortOrder: 0 };

test('exposes the four checklist tools', () => {
  const names = createChecklistTools({}).map((t) => t.name).sort();
  assert.deepEqual(names, [
    'add_checklist_item',
    'delete_checklist_item',
    'list_task_checklist',
    'set_checklist_item',
  ]);
});

test('list_task_checklist is read-only and rejects a bad UUID before calling the client', async () => {
  let called = false;
  const client = { listChecklist: async () => { called = true; return []; } };
  const tool = byName(createChecklistTools(client), 'list_task_checklist');
  assert.equal(tool.annotations.readOnlyHint, true);
  const res = await tool.handler({ taskId: 'nope' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /taskId must be a valid UUID/);
  assert.equal(called, false);
});

test('list_task_checklist calls listChecklist and returns the items', async () => {
  let received;
  const client = { listChecklist: async (taskId) => { received = taskId; return [SAMPLE_ITEM]; } };
  const tool = byName(createChecklistTools(client), 'list_task_checklist');
  const res = await tool.handler({ taskId: TASK_ID });
  assert.equal(received, TASK_ID);
  assert.deepEqual(JSON.parse(res.content[0].text), [SAMPLE_ITEM]);
});

test('add_checklist_item validates taskId and forwards label to addChecklistItem', async () => {
  let received;
  const client = {
    addChecklistItem: async (taskId, label) => { received = { taskId, label }; return SAMPLE_ITEM; },
  };
  const tool = byName(createChecklistTools(client), 'add_checklist_item');
  assert.match((await tool.handler({ taskId: 'bad', label: 'x' })).content[0].text, /taskId must be a valid UUID/);
  const res = await tool.handler({ taskId: TASK_ID, label: 'Restore from backup' });
  assert.deepEqual(received, { taskId: TASK_ID, label: 'Restore from backup' });
  assert.deepEqual(JSON.parse(res.content[0].text), SAMPLE_ITEM);
});

test('set_checklist_item validates ids and forwards completed to setChecklistItem', async () => {
  let received;
  const client = {
    setChecklistItem: async (taskId, itemId, completed) => {
      received = { taskId, itemId, completed };
      return { ...SAMPLE_ITEM, completed };
    },
  };
  const tool = byName(createChecklistTools(client), 'set_checklist_item');
  assert.match(
    (await tool.handler({ taskId: 'bad', itemId: ITEM_ID, completed: true })).content[0].text,
    /taskId must be a valid UUID/,
  );
  assert.match(
    (await tool.handler({ taskId: TASK_ID, itemId: 'bad', completed: true })).content[0].text,
    /itemId must be a valid UUID/,
  );
  const res = await tool.handler({ taskId: TASK_ID, itemId: ITEM_ID, completed: true });
  assert.deepEqual(received, { taskId: TASK_ID, itemId: ITEM_ID, completed: true });
  assert.equal(JSON.parse(res.content[0].text).completed, true);

  const resFalse = await tool.handler({ taskId: TASK_ID, itemId: ITEM_ID, completed: false });
  assert.deepEqual(received, { taskId: TASK_ID, itemId: ITEM_ID, completed: false });
  assert.equal(JSON.parse(resFalse.content[0].text).completed, false);
});

test('delete_checklist_item validates ids and forwards to deleteChecklistItem', async () => {
  let received;
  const client = {
    deleteChecklistItem: async (taskId, itemId) => { received = { taskId, itemId }; return null; },
  };
  const tool = byName(createChecklistTools(client), 'delete_checklist_item');
  assert.match(
    (await tool.handler({ taskId: 'bad', itemId: ITEM_ID })).content[0].text,
    /taskId must be a valid UUID/,
  );
  assert.match(
    (await tool.handler({ taskId: TASK_ID, itemId: 'bad' })).content[0].text,
    /itemId must be a valid UUID/,
  );
  const res = await tool.handler({ taskId: TASK_ID, itemId: ITEM_ID });
  assert.deepEqual(received, { taskId: TASK_ID, itemId: ITEM_ID });
  assert.deepEqual(JSON.parse(res.content[0].text), { deleted: true, taskId: TASK_ID, itemId: ITEM_ID });
});
