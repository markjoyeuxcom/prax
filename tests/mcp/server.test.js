import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../mcp/server.js';

const EXPECTED_TOOL_COUNT = 16; // 4 document + 4 task + 3 link + 4 checklist + 1 activity tools

test('registers all 16 tools with unique names', () => {
  const registered = [];
  const fakeServer = {
    registerTool: (name, config, handler) => {
      registered.push({ name, config, handler });
    },
  };
  buildServer({ server: fakeServer, client: {} });

  const names = registered.map((r) => r.name);
  assert.equal(names.length, EXPECTED_TOOL_COUNT);
  assert.equal(new Set(names).size, EXPECTED_TOOL_COUNT, 'tool names must be unique');
  for (const expected of [
    'search_documents', 'get_document', 'create_document', 'update_document',
    'search_tasks', 'get_task', 'create_task', 'update_task',
    'list_task_documents', 'link_task_document', 'unlink_task_document',
    'list_task_checklist', 'add_checklist_item', 'set_checklist_item', 'delete_checklist_item',
    'list_task_activity',
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
});

test('each registered tool has a title, description, inputSchema, and handler', () => {
  const registered = [];
  const fakeServer = { registerTool: (name, config, handler) => registered.push({ name, config, handler }) };
  buildServer({ server: fakeServer, client: {} });

  for (const { config, handler } of registered) {
    assert.equal(typeof config.title, 'string');
    assert.equal(typeof config.description, 'string');
    assert.ok(config.inputSchema && typeof config.inputSchema === 'object', 'inputSchema must be a non-null object');
    assert.equal(typeof handler, 'function');
  }
});

test('returns the server instance', () => {
  const fakeServer = { registerTool: () => {} };
  assert.equal(buildServer({ server: fakeServer, client: {} }), fakeServer);
});
