// The client side of leaving unreviewed harvested candidates out of recall:
// the opt-in reaches every retrieval route only when asked, the hidden count
// is read (including from the keyword listing's header), and every recall
// surface says what it hid (QINV-08).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../../cli/lib/apiClient.js';
import { recall, formatRecall } from '../../cli/lib/recall.js';
import { searchLibrary, describeRetrieval } from '../../cli/lib/search.js';
import { memoryDelta, formatDelta } from '../../cli/lib/delta.js';
import { budgetedContext, formatBudgetedContext } from '../../cli/lib/context.js';
import { parseRecallArgs } from '../../cli/lib/skillArgs.js';
import { createSemanticSearchTools } from '../../mcp/tools/semanticSearch.js';
import { createDocumentTools } from '../../mcp/tools/documents.js';

const NOW = new Date('2026-09-23T12:00:00Z');
const HIDDEN_ONE = /1 unreviewed harvested candidate hidden until a person triages it; --include-harvested to show/;

function res(status, body, headers = {}) {
  const all = { 'content-type': 'application/json', ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => all[String(name).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('the API client sends includeHarvested only when asked and reads the hidden count', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    if (url.includes('/api/library/documents?')) return res(200, [{ id: 'k' }], { 'x-prax-hidden-harvested': '3' });
    return res(200, { items: [], page: null, hiddenHarvested: 2 });
  };
  const client = createClient({ baseUrl: 'http://x', agent: 'claude' });
  const semantic = await client.semanticSearch(undefined, 'q', {});
  assert.equal(semantic.hiddenHarvested, 2);
  assert.ok(!seen.at(-1).includes('includeHarvested'));
  await client.semanticSearch(undefined, 'q', { includeHarvested: true });
  assert.match(seen.at(-1), /includeHarvested=true/);

  assert.deepEqual(await client.keywordSearch(undefined, 'q'), [{ id: 'k' }], 'the array shape is kept');
  assert.deepEqual(await client.keywordSearch(undefined, 'q', { envelope: true }), { items: [{ id: 'k' }], hiddenHarvested: 3 });
  await client.keywordSearch(undefined, 'q', { includeHarvested: true });
  assert.match(seen.at(-1), /includeHarvested=true/);

  await client.contextPack('homelab', { query: 'q', format: 'json', includeHarvested: true });
  assert.match(seen.at(-1), /context-pack\?query=q&format=json&includeHarvested=true/);
  await client.memoryChanges({ since: '2026-09-20T00:00:00.000Z', includeHarvested: true });
  assert.match(seen.at(-1), /changes\?since=.*&includeHarvested=true/);
  await client.relatedTaskDocuments('t1', { includeHarvested: true });
  assert.equal(seen.at(-1), 'http://x/api/tasks/t1/related-documents?includeHarvested=true');
  await client.relatedTaskDocuments('t1');
  assert.equal(seen.at(-1), 'http://x/api/tasks/t1/related-documents');
});

function fakeClient({ hidden = 1, items = [{ id: 'm', title: 'Memory', documentType: 'note', verified: true }] } = {}) {
  const calls = [];
  return {
    calls,
    semanticSearch: async (project, q, opts) => {
      calls.push(opts);
      return { items, page: { returned: items.length, total: items.length, hasMore: false }, index: null, degraded: false, reason: null, hiddenHarvested: hidden };
    },
    keywordSearch: async () => [],
    getDocument: async (id) => ({ id, title: 'Memory', body: 'Body.', verified: true, status: 'active' }),
    listCodeRefs: async () => [],
    listDocuments: async () => [
      { id: 'c', title: 'Candidate', tags: ['harvested'], verified: false, status: 'active', updatedAt: '2026-09-23T10:00:00Z' },
      { id: 'v', title: 'Verified candidate', tags: ['harvested'], verified: true, status: 'active', updatedAt: '2026-09-23T09:00:00Z' },
      { id: 'n', title: 'Note', tags: [], verified: false, status: 'active', updatedAt: '2026-09-22T09:00:00Z' },
    ],
  };
}

test('recall says how many candidates it hid: a hit, a budgeted hit and a miss', async () => {
  const client = fakeClient();
  const hit = await recall(client, { query: 'tunnel', now: NOW });
  assert.equal(hit.hiddenHarvested, 1);
  assert.match(formatRecall(hit, NOW), HIDDEN_ONE);
  assert.equal(client.calls[0].includeHarvested, undefined, 'nothing sent by default');

  const budgeted = await recall(fakeClient(), { query: 'tunnel', budget: 200, now: NOW });
  assert.match(formatRecall(budgeted, NOW), HIDDEN_ONE);

  const miss = await recall(fakeClient({ items: [] }), { query: 'tunnel', now: NOW });
  assert.match(formatRecall(miss, NOW), /No relevant memory found for: "tunnel" \(1 unreviewed harvested candidate hidden/);

  const opted = fakeClient({ hidden: 0 });
  const all = await recall(opted, { query: 'tunnel', includeHarvested: true, now: NOW });
  assert.equal(opted.calls[0].includeHarvested, true);
  assert.doesNotMatch(formatRecall(all, NOW), /harvested/);
});

test('recall --recent applies the rule itself: an unreviewed candidate is left out and counted', async () => {
  const recent = await recall(fakeClient(), { recent: true, limit: 5, now: NOW });
  assert.deepEqual(recent.items.map((d) => d.id), ['v', 'n'], 'a verified harvested document is memory');
  assert.equal(recent.hiddenHarvested, 1);
  assert.match(formatRecall(recent, NOW), HIDDEN_ONE);
  const all = await recall(fakeClient(), { recent: true, limit: 5, includeHarvested: true, now: NOW });
  assert.deepEqual(all.items.map((d) => d.id), ['c', 'v', 'n']);
  assert.equal(all.hiddenHarvested, undefined);
  // Only a candidate that would have made the list counts.
  const short = await recall(fakeClient(), { recent: true, limit: 1, now: NOW });
  assert.deepEqual(short.items.map((d) => d.id), ['v']);
  assert.equal(short.hiddenHarvested, 1);
});

test('search, the delta and a budgeted context pack disclose hidden candidates', async () => {
  const envelope = await searchLibrary(fakeClient({ hidden: 2 }), { query: 'x' });
  assert.equal(envelope.retrieval.hiddenHarvested, 2);
  assert.match(describeRetrieval(envelope.retrieval), /Note: 2 unreviewed harvested candidates hidden/);
  const none = await searchLibrary(fakeClient({ hidden: 0 }), { query: 'x' });
  assert.equal('hiddenHarvested' in none.retrieval, false, 'a complete answer keeps its shape');

  const deltaCalls = [];
  const delta = await memoryDelta({
    agent: 'claude',
    memoryChanges: async (opts) => { deltaCalls.push(opts); return { baseline: 'explicit', since: 's', until: 'u', items: [], page: { returned: 0, total: 0, hasMore: false }, hiddenHarvested: 1 }; },
    listCodeRefs: async () => [],
  }, { since: '2026-09-20T00:00:00.000Z', includeHarvested: false });
  assert.equal(deltaCalls[0].includeHarvested, undefined);
  assert.match(formatDelta(delta, { now: NOW }), /\(1 unreviewed harvested candidate hidden/);

  const packClient = {
    contextPack: async (project, opts) => ({
      project: { id: 'p', name: 'Homelab' }, query: opts.query, retrieval: { mode: 'semantic' }, sections: [], omitted: { total: 0, unverified: 0 }, hiddenHarvested: 1,
    }),
    listProjects: async () => [],
  };
  const pack = await budgetedContext(packClient, { project: 'homelab', query: 'x', budget: 100 });
  assert.match(formatBudgetedContext(pack), HIDDEN_ONE);
});

test('the recall skill declares --include-harvested (strict parser)', () => {
  assert.equal(parseRecallArgs(['tunnel', '--include-harvested']).includeHarvested, true);
  assert.equal(parseRecallArgs(['tunnel']).includeHarvested, undefined);
  assert.equal(parseRecallArgs(['--recent', '--include-harvested']).includeHarvested, true);
  assert.equal(parseRecallArgs(['--since-last-session', '--include-harvested']).includeHarvested, true);
  assert.throws(() => parseRecallArgs(['tunnel', '--include-harvested=yes']), /--include-harvested takes no value/);
});

test('MCP search tools pass includeHarvested and surface the hidden count', async () => {
  const seen = [];
  const client = {
    searchDocumentsSemantic: async (q, project, opts) => { seen.push(opts); return { items: [], page: { total: 0 }, hiddenHarvested: 2 }; },
    searchDocumentsKeyword: async (filters) => { seen.push(filters); return { items: [], hiddenHarvested: 1 }; },
    listDocuments: async (filters) => { seen.push(filters); return []; },
    contextPack: async (args) => { seen.push(args); return '# Context'; },
  };
  const parse = (result) => JSON.parse(result.content[0].text);
  const [semantic] = createSemanticSearchTools(client);
  const out = parse(await semantic.handler({ query: 'tunnel' }));
  assert.equal(out.hiddenHarvested, 2);
  assert.match(out.note, /2 unreviewed harvested candidates hidden until a person triages them; includeHarvested: true to show\./);
  assert.equal(seen.at(-1).includeHarvested, undefined);
  await semantic.handler({ query: 'tunnel', includeHarvested: true });
  assert.equal(seen.at(-1).includeHarvested, true);

  const tools = Object.fromEntries(createDocumentTools(client).map((t) => [t.name, t]));
  const keyword = parse(await tools.search_documents.handler({ query: 'tunnel' }));
  assert.equal(keyword.hiddenHarvested, 1);
  const browse = parse(await tools.search_documents.handler({ project: 'inbox' }));
  assert.equal(browse.hiddenHarvested, undefined, 'a browse is not retrieval');
  await tools.ask_library.handler({ query: 'tunnel', includeHarvested: true });
  assert.equal(seen.at(-1).includeHarvested, true);
});
