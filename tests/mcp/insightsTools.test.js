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
  const client = { ask: async () => ({ answer: null, degraded: true, reason: 'no-chat-model', retrieval: { mode: 'keyword', fallback: true, reason: 'semantic-not-configured' }, markdown: '# Context pack\n- [Doc] body', sources: [] }) };
  const res = await tool(client).handler({ query: 'x' });
  assert.match(res.content[0].text, /Prax degraded \(no-chat-model\)/);
  assert.match(res.content[0].text, /Retrieval: keyword fallback \(semantic-not-configured\)/);
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

function pmTool(client) { return createInsightTools(client).find((t) => t.name === 'generate_post_mortem'); }

test('generate_post_mortem validates the run id and returns the created doc', async () => {
  const t = pmTool({});
  assert.ok(t);
  assert.equal((await t.handler({ runId: 'nope' })).isError, true);            // bad uuid
  let received;
  const documentId = '22222222-2222-4222-8222-222222222222';
  const client = { generatePostMortem: async (id, resultId) => { received = { id, resultId }; return { document: { id: 'pm1', title: 'Post-mortem: X' }, generated: true, model: 'gemini-2.5-flash' }; } };
  const res = await pmTool(client).handler({ runId: '11111111-1111-4111-8111-111111111111', documentId });
  assert.deepEqual(received, { id: '11111111-1111-4111-8111-111111111111', resultId: documentId });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /"title": ?"Post-mortem: X"/);
  assert.match(res.content[0].text, /"generated": ?true/);
});

function rbTool(client) { return createInsightTools(client).find((t) => t.name === 'generate_runbook'); }

test('generate_runbook requires description + project and returns the created runbook', () => {
  const t = rbTool({});
  assert.ok(t);
  assert.equal(t.inputSchema.description.safeParse(undefined).success, false);
  assert.equal(t.inputSchema.project.safeParse(undefined).success, false);
});

test('generate_runbook returns the created doc; surfaces the "no model" error', async () => {
  const ok = { generateRunbook: async ({ description }) => ({ document: { id: 'rb1', title: 'Postgres failover', documentType: 'runbook' }, model: 'gemini-2.5-flash' }) };
  const res = await rbTool(ok).handler({ description: 'pg down', project: 'homelab', documentId: '22222222-2222-4222-8222-222222222222' });
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /"title": ?"Postgres failover"/);

  const { PraxApiError } = await import('../../mcp/errors.js');
  const bad = { generateRunbook: async () => { throw new PraxApiError(409, 'no AI model is configured'); } };
  const err = await rbTool(bad).handler({ description: 'x', project: 'homelab' });
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /no AI model is configured/);
});

// C10 adapter coverage: an incomplete semantic index is disclosed in prose on
// both the answer and the pack paths, and never invented when nothing is pending.
test('ask_prax discloses pending (unranked) documents next to a synthesized answer', async () => {
  const client = { ask: async () => ({ answer: 'Promote the standby.', degraded: false, sources: [{ title: 'Postgres failover', verified: true }], markdown: '# pack', retrieval: { mode: 'semantic', fallback: false, reason: null, index: { total: 7, embedded: 5, pending: 2 } } }) };
  const res = await tool(client).handler({ query: 'how do we fail over?' });
  assert.match(res.content[0].text, /^Promote the standby\./);
  assert.match(res.content[0].text, /Index incomplete: 2 of 7 documents await reindex and were not ranked\./);
  assert.ok(!res.isError);
});

test('ask_prax discloses pending documents on the degraded pack path and stays quiet when the index is complete', async () => {
  const pending = { ask: async () => ({ answer: null, degraded: true, reason: 'no-chat-model', retrieval: { mode: 'semantic', fallback: false, reason: null, index: { total: 1, embedded: 0, pending: 1 } }, markdown: '# Context pack', sources: [] }) };
  const res = await tool(pending).handler({ query: 'x' });
  assert.match(res.content[0].text, /Prax degraded \(no-chat-model\)\. Retrieval: semantic\. Index incomplete: 1 of 1 document await reindex/);
  assert.match(res.content[0].text, /# Context pack/);

  const complete = { ask: async () => ({ answer: 'Fine.', degraded: false, sources: [], markdown: '# pack', retrieval: { mode: 'semantic', fallback: false, reason: null, index: { total: 3, embedded: 3, pending: 0 } } }) };
  const quiet = await tool(complete).handler({ query: 'x' });
  assert.doesNotMatch(quiet.content[0].text, /Index incomplete/);
});
