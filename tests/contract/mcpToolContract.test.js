import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskTools } from '../../mcp/tools/tasks.js';
import { createDocumentTools } from '../../mcp/tools/documents.js';
import { createLinkTools } from '../../mcp/tools/links.js';
import { createChecklistTools } from '../../mcp/tools/checklist.js';
import { createActivityTools } from '../../mcp/tools/activity.js';
import { createDocumentLinkTools } from '../../mcp/tools/documentLinks.js';
import { createGraphMaintenanceTools } from '../../mcp/tools/graphMaintenance.js';
import { createSemanticSearchTools } from '../../mcp/tools/semanticSearch.js';
import { createRunTools } from '../../mcp/tools/runs.js';
import { toTaskRef, toDocumentRef, capResults } from '../../mcp/shape.js';

// The current MCP tool surface this regression test locks: tool name -> required + optional input fields.
const FROZEN_TOOLS = {
  search_tasks: { required: [], optional: ['query', 'project', 'status', 'filter'] },
  get_task: { required: ['id'], optional: [] },
  create_task: { required: ['title', 'project'], optional: ['description', 'priority', 'status', 'dueDate', 'dueTime', 'recurrence', 'labels'] },
  update_task: { required: ['id'], optional: ['title', 'description', 'notes', 'priority', 'status', 'project', 'dueDate', 'dueTime', 'recurrence', 'labels'] },
  search_documents: { required: [], optional: ['query', 'project', 'documentType', 'tags', 'kind', 'status'] },
  get_document: { required: ['id'], optional: [] },
  create_document: { required: ['title', 'body', 'documentType', 'project'], optional: ['tags', 'kind'] },
  update_document: { required: ['id'], optional: ['title', 'body', 'documentType', 'project', 'tags', 'kind'] },
  list_task_documents: { required: ['taskId'], optional: [] },
  link_task_document: { required: ['taskId', 'documentId'], optional: [] },
  unlink_task_document: { required: ['taskId', 'documentId'], optional: [] },
  list_task_checklist: { required: ['taskId'], optional: [] },
  add_checklist_item: { required: ['taskId', 'label'], optional: [] },
  set_checklist_item: { required: ['taskId', 'itemId', 'completed'], optional: [] },
  delete_checklist_item: { required: ['taskId', 'itemId'], optional: [] },
  list_task_activity: { required: ['taskId'], optional: [] },
  list_document_links: { required: ['documentId'], optional: ['direction'] },
  link_documents: { required: ['sourceId', 'targetId', 'relation'], optional: [] },
  unlink_documents: { required: ['sourceId', 'targetId', 'relation'], optional: [] },
  supersede_document: { required: ['documentId', 'supersededBy'], optional: [] },
  list_stale_documents: { required: [], optional: ['project'] },
  list_orphan_documents: { required: [], optional: ['project'] },
  search_documents_semantic: { required: ['query'], optional: ['project'] },
  start_runbook_run: { required: ['documentId'], optional: ['title'] },
  list_runbook_runs: { required: ['documentId'], optional: [] },
  get_runbook_run: { required: ['runId'], optional: [] },
  set_run_step: { required: ['runId', 'stepId', 'checked'], optional: [] },
  set_run_status: { required: ['runId', 'status'], optional: [] },
};

function allTools(client = {}) {
  return [
    ...createTaskTools(client),
    ...createDocumentTools(client),
    ...createLinkTools(client),
    ...createChecklistTools(client),
    ...createActivityTools(client),
    ...createDocumentLinkTools(client),
    ...createGraphMaintenanceTools(client),
    ...createSemanticSearchTools(client),
    ...createRunTools(client),
  ];
}

test('SHAPE: the expected set of MCP tool names is present (no removals/renames)', () => {
  const names = allTools().map((t) => t.name);
  for (const frozen of Object.keys(FROZEN_TOOLS)) {
    assert.ok(names.includes(frozen), `MCP tool "${frozen}" is missing from the surface`);
  }
  // Additive new tools are allowed; duplicate names are not.
  assert.equal(names.length, new Set(names).size, 'duplicate tool names registered');
});

test('SHAPE: each tool has the documented input fields with documented optionality', () => {
  const tools = allTools();
  for (const [name, spec] of Object.entries(FROZEN_TOOLS)) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `tool ${name} exists`);
    const fields = Object.keys(tool.inputSchema).sort();
    assert.deepEqual(fields, [...spec.required, ...spec.optional].sort(), `${name} input field set`);
    for (const field of spec.required) {
      assert.equal(tool.inputSchema[field].safeParse(undefined).success, false, `${name}.${field} must be required`);
    }
    for (const field of spec.optional) {
      assert.equal(tool.inputSchema[field].safeParse(undefined).success, true, `${name}.${field} must be optional`);
    }
  }
});

test('SHAPE: tool enums expose exactly the documented option sets', () => {
  const tools = allTools();
  const get = (name, field) => tools.find((t) => t.name === name).inputSchema[field];

  const STATUS = ['high-priority', 'in-progress', 'planned', 'completed', 'notes'];
  const PRIORITY = ['high', 'medium', 'low'];
  const DOCUMENT_TYPE = ['runbook', 'note'];

  const assertEnum = (schema, values) => {
    for (const v of values) assert.equal(schema.safeParse(v).success, true, `accepts ${v}`);
    assert.equal(schema.safeParse('definitely-not-valid').success, false, 'rejects out-of-enum value');
  };

  assertEnum(get('search_tasks', 'status'), STATUS);
  assertEnum(get('create_task', 'priority'), PRIORITY);
  assertEnum(get('create_task', 'status'), STATUS);
  assertEnum(get('search_documents', 'documentType'), DOCUMENT_TYPE);
  assertEnum(get('create_document', 'documentType'), DOCUMENT_TYPE);

  const KIND = ['source', 'synthesized'];
  assertEnum(get('search_documents', 'kind'), KIND);
  assertEnum(get('create_document', 'kind'), KIND);
  assertEnum(get('update_document', 'kind'), KIND);

  const DOC_STATUS = ['active', 'superseded', 'deprecated', 'all'];
  assertEnum(get('search_documents', 'status'), DOC_STATUS);

  const RELATION = ['derived-from', 'supersedes'];
  const DIRECTION = ['outbound', 'inbound', 'both'];
  assertEnum(get('link_documents', 'relation'), RELATION);
  assertEnum(get('unlink_documents', 'relation'), RELATION);
  assertEnum(get('list_document_links', 'direction'), DIRECTION);
});

test('SHAPE: MCP-owned ref shapes are locked', () => {
  const taskRef = toTaskRef({
    id: '1', title: 't', status: 'planned', priority: 'high',
    projectId: 'p', dueDate: '2026-05-12', description: 'x', notes: 'y',
  });
  assert.deepEqual(Object.keys(taskRef).sort(), ['dueDate', 'id', 'labels', 'priority', 'projectId', 'status', 'title'].sort());

  const docRef = toDocumentRef({
    id: '1', title: 't', documentType: 'note', projectId: 'p', tags: ['a'], body: 'long body',
  });
  assert.deepEqual(Object.keys(docRef).sort(), ['documentType', 'id', 'projectId', 'snippet', 'tags', 'title'].sort());
});

test('SHAPE: capResults caps lists at 20', () => {
  assert.equal(capResults(Array.from({ length: 50 }, (_, i) => i)).length, 20);
});

test('SHAPE: link/unlink/delete wrapper shapes are locked', async () => {
  const TASK = '11111111-1111-4111-8111-111111111111';
  const DOC = '55555555-5555-4555-8555-555555555555';
  const ITEM = '99999999-9999-4999-8999-999999999999';

  const linkTools = createLinkTools({ linkTaskDocument: async () => [], unlinkTaskDocument: async () => true });
  const link = linkTools.find((t) => t.name === 'link_task_document');
  const unlink = linkTools.find((t) => t.name === 'unlink_task_document');

  const linkRes = JSON.parse((await link.handler({ taskId: TASK, documentId: DOC })).content[0].text);
  assert.deepEqual(Object.keys(linkRes).sort(), ['documentId', 'documents', 'linked', 'taskId'].sort());
  assert.equal(linkRes.linked, true);

  const unlinkRes = JSON.parse((await unlink.handler({ taskId: TASK, documentId: DOC })).content[0].text);
  assert.deepEqual(Object.keys(unlinkRes).sort(), ['documentId', 'taskId', 'unlinked'].sort());

  const checklistTools = createChecklistTools({ deleteChecklistItem: async () => true });
  const del = checklistTools.find((t) => t.name === 'delete_checklist_item');
  const delRes = JSON.parse((await del.handler({ taskId: TASK, itemId: ITEM })).content[0].text);
  assert.deepEqual(Object.keys(delRes).sort(), ['deleted', 'itemId', 'taskId'].sort());
});
