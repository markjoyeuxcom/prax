import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphMaintenanceTools } from '../../mcp/tools/graphMaintenance.js';

function byName(tools, name) { const t = tools.find((x) => x.name === name); assert.ok(t, name); return t; }
const D = '11111111-1111-4111-8111-111111111111';

test('exposes the two maintenance tools', () => {
  assert.deepEqual(createGraphMaintenanceTools({}).map((t) => t.name).sort(), ['list_orphan_documents', 'list_stale_documents']);
});

test('list_stale_documents passes project and returns explicit pagination', async () => {
  let seen; const many = Array.from({ length: 25 }, (_, i) => ({ documentId: `d-${i}` }));
  const client = { listStaleDocuments: async (p) => { seen = p; return many; } };
  const tool = byName(createGraphMaintenanceTools(client), 'list_stale_documents');
  const res = await tool.handler({ project: 'homelab' });
  assert.equal(seen, 'homelab');
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.items.length, 20);
  assert.equal(data.page.total, 25);
  assert.equal(data.page.hasMore, true);
});

test('list_orphan_documents returns the orphan list', async () => {
  const client = { listOrphanDocuments: async () => [{ documentId: D, title: 'Lonely' }] };
  const tool = byName(createGraphMaintenanceTools(client), 'list_orphan_documents');
  const res = await tool.handler({});
  assert.deepEqual(JSON.parse(res.content[0].text).items, [{ documentId: D, title: 'Lonely' }]);
});
