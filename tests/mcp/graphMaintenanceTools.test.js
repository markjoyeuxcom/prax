import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphMaintenanceTools } from '../../mcp/tools/graphMaintenance.js';

function byName(tools, name) { const t = tools.find((x) => x.name === name); assert.ok(t, name); return t; }

test('exposes stale-document maintenance without an orphan heuristic', () => {
  assert.deepEqual(createGraphMaintenanceTools({}).map((t) => t.name), ['list_stale_documents']);
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
