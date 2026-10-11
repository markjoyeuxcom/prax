// Unreviewed harvested candidates stay out of default agent-facing retrieval
// (docs/design/session-harvesting.md): semantic
// and hybrid search, keyword recall, both context packs, Ask, similar and
// task-related documents, and the memory-changes delta. `includeHarvested=true`
// opts in, every route that hid something says how many (QINV-08), and a
// candidate a person verifies or refiles without the tag behaves normally.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import {
  hiddenHarvestedNote, includeHarvestedFrom, isUnreviewedHarvested, partitionHarvested,
} from '../../server/harvestedCandidates.js';

const SILENT = { info() {}, error() {}, warn() {} };
const AGENT = { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude', 'x-prax-query-source': 'recall' };
const HARVESTER = { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' };

// A topic embedder: texts that mention the same topic word are near-identical,
// so a query ranks every document about it and nothing else.
const TOPICS = ['tunnel', 'dns', 'backup'];
function topicEmbedder() {
  return {
    backend: 'topic',
    model: 'topic-1',
    async embed(text) {
      const lower = String(text ?? '').toLowerCase();
      const vector = [...TOPICS.map((t) => (lower.includes(t) ? 1 : 0)), 0.01];
      return { vector, model: 'topic-1', dim: vector.length };
    },
    async isAvailable() { return true; },
  };
}

async function setup({ embedder = topicEmbedder() } = {}) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const app = await buildApp({ db, embedder, librarianSweep: false });
  const create = async (payload, headers = HARVESTER) => {
    const res = await app.inject({ method: 'POST', url: '/api/library/documents', headers, payload });
    assert.equal(res.statusCode, 201, res.body);
    return res.json();
  };
  const memory = await create({
    title: 'Tunnel token rotation', body: 'Rotate the tunnel token yearly from the dashboard.', documentType: 'runbook', project: 'homelab',
  });
  const candidate = await create({
    title: 'Tunnel token lives in the vault', body: 'The tunnel token is kept in the shared vault.', documentType: 'note', project: 'inbox', tags: ['harvested'], kind: 'synthesized',
  });
  if (embedder) await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  return { app, db, memory, candidate, create };
}

const ids = (list) => (list || []).map((d) => d.id);
const packIds = (pack) => (pack.sections || []).flatMap((s) => s.items.map((i) => i.id));

test('the rule: harvested and unverified, tags parsed from rows or arrays, case-insensitive', () => {
  assert.equal(isUnreviewedHarvested({ tags: ['harvested'], verified: false }), true);
  assert.equal(isUnreviewedHarvested({ tags: '["Harvested","x"]', verified: 0 }), true);
  assert.equal(isUnreviewedHarvested({ tags: ['harvested'], verified: true }), false, 'a person verified it');
  assert.equal(isUnreviewedHarvested({ tags: '["harvested"]', verified: 1 }), false);
  assert.equal(isUnreviewedHarvested({ tags: ['draft'], verified: false }), false, 'refiled without the tag');
  assert.equal(isUnreviewedHarvested({ tags: 'not json', verified: 0 }), false);
  assert.equal(includeHarvestedFrom('true'), true);
  assert.equal(includeHarvestedFrom(true), true);
  assert.equal(includeHarvestedFrom('false'), false);
  assert.equal(includeHarvestedFrom(undefined), false);
  const { kept, hidden } = partitionHarvested([{ id: 'a', tags: ['harvested'] }, { id: 'b', tags: [] }]);
  assert.deepEqual([ids(kept), ids(hidden)], [['b'], ['a']]);
  assert.equal(partitionHarvested([{ id: 'a', tags: ['harvested'] }], { include: true }).hidden.length, 0);
  assert.equal(hiddenHarvestedNote(0), '');
  assert.equal(hiddenHarvestedNote(2), '2 unreviewed harvested candidates hidden until a person triages them; --include-harvested to show');
});

test('semantic and hybrid search hide unreviewed candidates by default, count them, and show them on opt-in', async () => {
  const { app, memory, candidate } = await setup();
  for (const mode of ['semantic', 'hybrid']) {
    const res = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=tunnel&page=true&mode=${mode}`, headers: AGENT });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(ids(body.items).includes(memory.id), mode);
    assert.ok(!ids(body.items).includes(candidate.id), `${mode}: the candidate is hidden`);
    assert.equal(body.hiddenHarvested, 1, mode);
    assert.equal(body.page.total, body.items.length, 'the page total counts only what may be shown');

    const opted = (await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=tunnel&page=true&mode=${mode}&includeHarvested=true`, headers: AGENT })).json();
    assert.ok(ids(opted.items).includes(candidate.id), `${mode}: opt-in shows it`);
    assert.equal(opted.hiddenHarvested, undefined);
  }
  // The legacy array cannot carry a field; a header says it.
  const legacy = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=tunnel', headers: AGENT });
  assert.ok(!ids(legacy.json()).includes(candidate.id));
  assert.equal(legacy.headers['x-prax-hidden-harvested'], '1');
  // A query that matches nothing harvested has nothing to disclose.
  const other = (await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=dns&page=true', headers: AGENT })).json();
  assert.equal(other.hiddenHarvested, undefined);
  await app.close();
});

test('keyword recall hides candidates (header), while a plain listing still lists them', async () => {
  const { app, memory, candidate } = await setup({ embedder: null });
  const res = await app.inject({ method: 'GET', url: '/api/library/documents?q=tunnel&status=active', headers: AGENT });
  assert.deepEqual(ids(res.json()), [memory.id]);
  assert.equal(res.headers['x-prax-hidden-harvested'], '1');
  const opted = await app.inject({ method: 'GET', url: '/api/library/documents?q=tunnel&status=active&includeHarvested=true' });
  assert.ok(ids(opted.json()).includes(candidate.id));
  assert.equal(opted.headers['x-prax-hidden-harvested'], undefined);
  // Browsing (the Inbox, triage, the harvester's title dedupe) is not retrieval.
  const listing = await app.inject({ method: 'GET', url: '/api/library/documents?project=inbox' });
  assert.ok(ids(listing.json()).includes(candidate.id));
  assert.equal(listing.headers['x-prax-hidden-harvested'], undefined);
  await app.close();
});

test('both context packs and Ask leave candidates out and say so', async () => {
  for (const embedder of [topicEmbedder(), null]) {
    const { app, memory, candidate } = await setup({ embedder });
    const label = embedder ? 'semantic' : 'keyword';
    const pack = (await app.inject({ method: 'GET', url: '/api/library/context-pack?q=tunnel&format=json', headers: AGENT })).json();
    assert.ok(packIds(pack).includes(memory.id), label);
    assert.ok(!packIds(pack).includes(candidate.id), label);
    assert.equal(pack.hiddenHarvested, 1, label);
    const md = (await app.inject({ method: 'GET', url: '/api/library/context-pack?q=tunnel', headers: AGENT })).body;
    assert.match(md, /_1 unreviewed harvested candidate hidden until a person triages it; --include-harvested \(includeHarvested=true\) to show\._/);
    const opted = (await app.inject({ method: 'GET', url: '/api/library/context-pack?q=tunnel&format=json&includeHarvested=true' })).json();
    assert.ok(packIds(opted).includes(candidate.id), label);
    assert.equal(opted.hiddenHarvested, undefined);

    // The project pack: a recency pack of the Inbox and a query pack.
    const inbox = (await app.inject({ method: 'GET', url: '/api/projects/inbox/context-pack?format=json' })).json();
    assert.ok(!packIds(inbox).includes(candidate.id));
    assert.equal(inbox.hiddenHarvested, 1);
    const inboxOpted = (await app.inject({ method: 'GET', url: '/api/projects/inbox/context-pack?format=json&includeHarvested=true' })).json();
    assert.ok(packIds(inboxOpted).includes(candidate.id));

    const ask = (await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'tunnel' } })).json();
    assert.ok(!ask.sources.map((s) => s.id).includes(candidate.id), label);
    assert.ok(ask.sources.map((s) => s.id).includes(memory.id), label);
    assert.equal(ask.retrieval.hiddenHarvested, 1);
    assert.match(ask.markdown, /1 unreviewed harvested candidate hidden/);
    const askOpted = (await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'tunnel', includeHarvested: true } })).json();
    assert.ok(askOpted.sources.map((s) => s.id).includes(candidate.id));
    await app.close();
  }
});

test('similar and task-related documents hide candidates unless asked', async () => {
  const { app, memory, candidate } = await setup();
  const similar = (await app.inject({ method: 'GET', url: `/api/library/documents/${memory.id}/similar` })).json();
  assert.ok(!ids(similar.items).includes(candidate.id));
  assert.equal(similar.hiddenHarvested, 1);
  const similarOpted = (await app.inject({ method: 'GET', url: `/api/library/documents/${memory.id}/similar?includeHarvested=true` })).json();
  assert.ok(ids(similarOpted.items).includes(candidate.id));

  const task = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Rotate the tunnel token', project: 'homelab', priority: 'medium', status: 'planned' } })).json();
  const related = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/related-documents` })).json();
  assert.ok(ids(related.suggestions).includes(memory.id), JSON.stringify(related));
  assert.ok(!ids(related.suggestions).includes(candidate.id));
  assert.equal(related.hiddenHarvested, 1);
  const relatedOpted = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/related-documents?includeHarvested=true` })).json();
  assert.ok(ids(relatedOpted.suggestions).includes(candidate.id));
  await app.close();
});

test('the memory delta leaves candidates out and counts them; a verified candidate is reported', async () => {
  const { app, candidate } = await setup({ embedder: null });
  const since = '2000-01-01T00:00:00.000Z';
  const delta = (await app.inject({ method: 'GET', url: `/api/library/changes?since=${since}`, headers: AGENT })).json();
  assert.ok(!ids(delta.items).includes(candidate.id));
  assert.equal(delta.hiddenHarvested, 1);
  assert.equal(delta.page.total, delta.items.length);
  const opted = (await app.inject({ method: 'GET', url: `/api/library/changes?since=${since}&includeHarvested=true`, headers: AGENT })).json();
  assert.ok(ids(opted.items).includes(candidate.id));
  assert.equal(opted.hiddenHarvested, undefined);

  const current = (await app.inject({ method: 'GET', url: `/api/library/documents/${candidate.id}` })).json();
  const verified = await app.inject({ method: 'POST', url: `/api/library/documents/${candidate.id}/verify`, payload: { verified: true, as: 'mark', revision: current.revision } });
  assert.equal(verified.statusCode, 200, verified.body);
  const after = (await app.inject({ method: 'GET', url: `/api/library/changes?since=${since}`, headers: AGENT })).json();
  assert.ok(ids(after.items).includes(candidate.id), 'a person verified it: it is memory now');
  assert.equal(after.hiddenHarvested, undefined);
  await app.close();
});

test('a candidate a person verifies, or refiles without the tag, is retrieved like any memory', async () => {
  const { app, candidate, create } = await setup();
  const current = (await app.inject({ method: 'GET', url: `/api/library/documents/${candidate.id}` })).json();
  await app.inject({ method: 'POST', url: `/api/library/documents/${candidate.id}/verify`, payload: { verified: true, as: 'mark', revision: current.revision } });
  const second = await create({
    title: 'Tunnel runs on the edge box', body: 'The tunnel daemon runs on the edge box.', documentType: 'note', project: 'inbox', tags: ['harvested', 'network'],
  });
  const refiled = await app.inject({ method: 'PATCH', url: `/api/library/documents/${second.id}`, payload: { tags: ['network'], project: 'homelab' } });
  assert.equal(refiled.statusCode, 200, refiled.body);
  await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });

  const res = (await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=tunnel&page=true&mode=hybrid', headers: AGENT })).json();
  assert.ok(ids(res.items).includes(candidate.id), 'verified');
  assert.ok(ids(res.items).includes(second.id), 'refiled without the tag');
  assert.equal(res.hiddenHarvested, undefined);
  const kw = await app.inject({ method: 'GET', url: '/api/library/documents?q=tunnel', headers: AGENT });
  assert.ok(ids(kw.json()).includes(candidate.id));
  assert.ok(ids(kw.json()).includes(second.id));
  await app.close();
});
