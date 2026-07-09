import test from 'node:test';
import assert from 'node:assert/strict';
import { createInsightTools } from '../../mcp/tools/insights.js';

function tool(client) { return createInsightTools(client).find((t) => t.name === 'ask_prax'); }

test('ask_prax requires a query, project/limit optional, read-only', () => {
  const t = tool({});
  assert.ok(t);
  assert.equal(t.inputSchema.query.safeParse(undefined).success, false);
  assert.equal(t.inputSchema.project.safeParse(undefined).success, true);
  assert.equal(t.inputSchema.limit.safeParse(3).success, true);
  assert.equal(t.annotations.readOnlyHint, true);
});

test('ask_prax returns the synthesized answer with a cited sources footer', async () => {
  const client = { ask: async ({ q }) => ({ query: q, answer: 'Promote the standby.', degraded: false, sources: [{ title: 'Postgres failover', verified: true }, { title: 'Draft notes', verified: false }], markdown: '# pack' }) };
  const res = await tool(client).handler({ query: 'how do we fail over?' });
  assert.match(res.content[0].text, /^Promote the standby\./);
  assert.match(res.content[0].text, /Sources: \[Postgres failover\], \[Draft notes\] \(unverified\)/);
  assert.ok(!res.isError);
});

test('ask_prax falls back to the raw pack when generation degraded', async () => {
  const client = { ask: async () => ({ answer: null, degraded: true, reason: 'no-chat-model', markdown: '# Context pack\n- [Doc] body', sources: [] }) };
  const res = await tool(client).handler({ query: 'x' });
  assert.match(res.content[0].text, /# Context pack/);
  assert.ok(!res.isError);
});

test('ask_prax surfaces an API failure as an error result', async () => {
  const { PraxApiError } = await import('../../mcp/errors.js');
  const client = { ask: async () => { throw new PraxApiError(503, 'backend unavailable'); } };
  const res = await tool(client).handler({ query: 'x' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unavailable/);
});
