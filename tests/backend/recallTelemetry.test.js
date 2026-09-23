// Recall telemetry (librarian spec, 2026-09-23): what is recorded, that
// recording can never slow or fail a recall, the bounds, used signals,
// clearing, the gaps queue, recall counts, the opt-in review sort and prune
// candidates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createFakeEmbedder } from '../../server/embedder/fake.js';
import {
  aggregateGaps, createRecallTelemetry, normalizeQueryKey, querySourceFrom,
} from '../../server/recallTelemetry.js';

const SILENT = { info() {}, error() {}, warn() {} };
const AGENT = { 'x-prax-query-source': 'recall', 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' };
const flush = () => new Promise((resolve) => { setImmediate(() => setImmediate(resolve)); });

async function freshDb() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  return db;
}

async function seeded({ embedder = createFakeEmbedder(), config, recallTelemetry } = {}) {
  const db = await freshDb();
  const app = await buildApp({
    db, embedder, librarianSweep: false,
    ...(config ? { config } : {}),
    ...(recallTelemetry !== undefined ? { recallTelemetry } : {}),
  });
  const docs = {};
  for (const [key, title, body] of [
    ['pg', 'Postgres backup', 'Nightly pg_dump to the NAS at 02:00.'],
    ['dns', 'DNS resolver', 'Unbound on the router forwards to Quad9.'],
    ['k8s', 'K8s ingress', 'Traefik handles ingress for the homelab cluster.'],
  ]) {
    const res = await app.inject({
      method: 'POST', url: '/api/library/documents',
      headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
      payload: { title, body, documentType: 'note', project: 'homelab' },
    });
    docs[key] = res.json();
  }
  if (embedder) await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  return { app, db, docs };
}

const exactQuery = (doc) => `${doc.title}\n\n${doc.body}`;
const queries = async (db) => (await db.query('select * from recall_queries order by id')).rows;
const hitsOf = async (db, id) => (await db.query('select document_id from recall_query_hits where query_id = $1 order by rank', [id])).rows.map((r) => r.document_id);

test('a recall that names its source is recorded with its agent, mode and hits; one that does not is not', async () => {
  const { app, db, docs } = await seeded();
  const q = encodeURIComponent(exactQuery(docs.pg));
  const anonymous = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true` });
  assert.equal(anonymous.statusCode, 200);
  await flush();
  assert.equal((await queries(db)).length, 0, 'the web UI sends no source and is never recorded');

  const res = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true&mode=hybrid`, headers: AGENT });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().items[0].id, docs.pg.id);
  await flush();
  const rows = await queries(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'recall');
  assert.equal(rows[0].mode, 'hybrid');
  assert.equal(rows[0].agent, 'claude');
  assert.equal(rows[0].query_key, normalizeQueryKey(exactQuery(docs.pg)));
  assert.ok(rows[0].hit_count >= 1);
  assert.equal((await hitsOf(db, rows[0].id))[0], docs.pg.id);
  await app.close();
});

test('only the first page of a paged recall is one query', async () => {
  const { app, db, docs } = await seeded();
  const q = encodeURIComponent(exactQuery(docs.dns));
  await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true&limit=1`, headers: AGENT });
  await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true&limit=1&offset=1`, headers: AGENT });
  await flush();
  assert.equal((await queries(db)).length, 1);
  await app.close();
});

test('the keyword fallback and both context packs are recorded; a recency fallback records zero hits', async () => {
  const { app, db, docs } = await seeded({ embedder: null });
  const kw = await app.inject({ method: 'GET', url: '/api/library/documents?q=Traefik&status=active', headers: { ...AGENT, 'x-prax-query-source': 'search' } });
  assert.equal(kw.statusCode, 200);
  const pack = await app.inject({ method: 'GET', url: '/api/library/context-pack?q=Unbound&format=json', headers: { ...AGENT, 'x-prax-query-source': 'context' } });
  assert.equal(pack.statusCode, 200);
  const projectPack = await app.inject({ method: 'GET', url: '/api/projects/homelab/context-pack?query=zebra%20migration&format=json', headers: { ...AGENT, 'x-prax-query-source': 'context' } });
  assert.equal(projectPack.statusCode, 200);
  // A briefing without a query is not a question and is not recorded.
  await app.inject({ method: 'GET', url: '/api/projects/homelab/context-pack?format=json', headers: { ...AGENT, 'x-prax-query-source': 'context' } });
  await flush();
  const rows = await queries(db);
  assert.deepEqual(rows.map((r) => [r.source, r.mode, r.hit_count]), [
    ['search', 'keyword', 1],
    ['context', 'keyword', 1],
    ['context', 'recency', 0],
  ]);
  assert.deepEqual(await hitsOf(db, rows[0].id), [docs.k8s.id]);
  assert.deepEqual(await hitsOf(db, rows[1].id), [docs.dns.id]);
  await app.close();
});

test('recording never fails or changes a recall: a throwing or rejecting store is dropped', async () => {
  const warnings = [];
  for (const recordQuery of [
    () => { throw new Error('disk full'); },
    async () => { throw new Error('disk full'); },
  ]) {
    const store = { enabled: true, recordQuery };
    const { app, docs } = await seeded({ recallTelemetry: store });
    app.log.warn = (...args) => warnings.push(args);
    const q = encodeURIComponent(exactQuery(docs.pg));
    const plain = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true` });
    const tagged = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true`, headers: AGENT });
    assert.equal(tagged.statusCode, 200);
    assert.deepEqual(tagged.json(), plain.json());
    await flush();
    await app.close();
  }
});

test('growth is bounded by a row cap and by age', async () => {
  const db = await freshDb();
  let now = new Date('2026-01-01T00:00:00Z');
  const telemetry = createRecallTelemetry(db, { maxQueryRows: 5, maxUseRows: 3, pruneEvery: 1, clock: () => now });
  for (let i = 0; i < 12; i += 1) await telemetry.recordQuery({ source: 'recall', mode: 'semantic', query: `question ${i}` });
  const kept = (await db.query('select query from recall_queries order by id')).rows.map((r) => r.query);
  assert.deepEqual(kept, ['question 7', 'question 8', 'question 9', 'question 10', 'question 11'], 'the newest rows are kept');

  now = new Date('2026-06-01T00:00:00Z'); // > 90 days later
  await telemetry.recordQuery({ source: 'recall', mode: 'semantic', query: 'fresh' });
  const after = (await db.query('select query from recall_queries')).rows.map((r) => r.query);
  assert.deepEqual(after, ['fresh'], 'rows past the retention window are deleted');
});

test('prax used records a used signal; bad ids, unknown documents and disabled telemetry are refused', async () => {
  const { app, db, docs } = await seeded();
  const ok = await app.inject({ method: 'POST', url: '/api/library/telemetry/used', headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' }, payload: { documentId: docs.pg.id } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().documentId, docs.pg.id);
  assert.equal(ok.json().agent, 'codex');
  assert.equal(ok.json().title, 'Postgres backup');
  assert.equal((await db.query('select count(*) as n from recall_uses')).rows[0].n, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/telemetry/used', payload: { documentId: 'nope' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/telemetry/used', payload: { documentId: '00000000-0000-4000-8000-000000000009' } })).statusCode, 404);
  await app.close();

  const off = await seeded({ config: { ...loadConfig({}), recallTelemetry: false } });
  const refused = await off.app.inject({ method: 'POST', url: '/api/library/telemetry/used', payload: { documentId: off.docs.pg.id } });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().reason, 'telemetry-off');
  await off.app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=x&page=true`, headers: AGENT });
  await flush();
  assert.equal((await queries(off.db)).length, 0, 'PRAX_RECALL_TELEMETRY=off records nothing');
  await off.app.close();
});

test('PRAX_RECALL_TELEMETRY=off is read from the environment', () => {
  assert.equal(loadConfig({}).recallTelemetry, true);
  assert.equal(loadConfig({ PRAX_RECALL_TELEMETRY: 'off' }).recallTelemetry, false);
  assert.equal(loadConfig({ PRAX_RECALL_TELEMETRY: 'OFF ' }).recallTelemetry, false);
});

test('telemetry status and clear; deleting a document removes its telemetry', async () => {
  const { app, db, docs } = await seeded();
  await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${encodeURIComponent(exactQuery(docs.k8s))}&page=true`, headers: AGENT });
  await app.inject({ method: 'POST', url: '/api/library/telemetry/used', payload: { documentId: docs.k8s.id } });
  await flush();
  const status = (await app.inject({ method: 'GET', url: '/api/library/telemetry' })).json();
  assert.equal(status.queries, 1);
  assert.equal(status.uses, 1);
  assert.equal(status.retentionDays, 90);

  await app.inject({ method: 'DELETE', url: `/api/library/documents/${docs.k8s.id}` });
  await app.inject({ method: 'DELETE', url: `/api/library/documents/${docs.k8s.id}/permanent` });
  assert.equal((await db.query('select count(*) as n from recall_query_hits')).rows[0].n, 0);
  assert.equal((await db.query('select count(*) as n from recall_uses')).rows[0].n, 0);

  const cleared = await app.inject({ method: 'DELETE', url: '/api/library/telemetry' });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.json().cleared, { queries: 1, uses: 0 });
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/telemetry' })).json().queries, 0);
  await app.close();
});

test('the gaps queue: no-hit questions now, unused ones only with used signals and after the window', async () => {
  const db = await freshDb();
  const app = await buildApp({ db, librarianSweep: false });
  const doc = (await app.inject({ method: 'POST', url: '/api/library/documents', payload: { title: 'Restic', body: 'Backups via restic.', documentType: 'note', project: 'homelab' } })).json();
  let now = new Date('2026-09-01T10:00:00Z');
  const telemetry = createRecallTelemetry(db, { clock: () => now });
  await telemetry.recordQuery({ source: 'recall', mode: 'hybrid', query: 'How do we rotate TLS certs?', hitIds: [] });
  await telemetry.recordQuery({ source: 'recall', mode: 'hybrid', query: 'how do we rotate tls certs', hitIds: [] });
  await telemetry.recordQuery({ source: 'recall', mode: 'hybrid', query: 'backup tool', hitIds: [doc.id] });
  await telemetry.recordQuery({ source: 'recall', mode: 'hybrid', query: 'restic retention', hitIds: [doc.id] });

  let gaps = await telemetry.gaps({ now });
  assert.deepEqual(gaps.items.map((g) => [g.queryKey, g.reason, g.occurrences]), [['how do we rotate tls certs', 'no-hits', 2]]);
  assert.equal(gaps.usedSignals, 0, 'without used signals, hits are not called unused');

  now = new Date('2026-09-01T11:00:00Z');
  await telemetry.recordUse({ documentId: doc.id });
  // The use answers both earlier queries that returned the doc.
  now = new Date('2026-09-03T12:00:00Z');
  await telemetry.recordQuery({ source: 'search', mode: 'semantic', query: 'offsite copies', hitIds: [doc.id] });
  gaps = await telemetry.gaps({ now });
  assert.deepEqual(gaps.items.map((g) => g.queryKey), ['how do we rotate tls certs'], 'inside the window a hit is not yet unused');

  now = new Date('2026-09-05T12:00:00Z');
  gaps = await telemetry.gaps({ now });
  assert.deepEqual(gaps.items.map((g) => [g.queryKey, g.reason]).sort(), [
    ['how do we rotate tls certs', 'no-hits'],
    ['offsite copies', 'unused'],
  ]);
  const route = await app.inject({ method: 'GET', url: '/api/library/librarian/gaps' });
  assert.equal(route.statusCode, 200);
  assert.equal(route.json().enabled, true);
  await app.close();
});

test('aggregateGaps is pure: any answered occurrence closes the group', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  const rows = [
    { occurredAt: '2026-09-01T00:00:00.000Z', query: 'A?', queryKey: 'a', hitCount: 0, used: false, agent: 'claude', source: 'recall' },
    { occurredAt: '2026-09-02T00:00:00.000Z', query: 'a', queryKey: 'a', hitCount: 2, used: true, agent: 'codex', source: 'mcp' },
    { occurredAt: '2026-09-03T00:00:00.000Z', query: 'B', queryKey: 'b', hitCount: 0, used: false, agent: 'codex', source: 'recall' },
  ];
  assert.deepEqual(aggregateGaps(rows, { now }).map((g) => g.queryKey), ['b']);
  assert.equal(querySourceFrom({ 'x-prax-query-source': 'Recall' }), 'recall');
  assert.equal(querySourceFrom({ 'x-prax-query-source': 'ui' }), null);
  assert.equal(normalizeQueryKey('  Postgres, backup?! '), 'postgres backup');
});

test('health ?sort=recall orders the review list by recall frequency; the default order is unchanged', async () => {
  const { app, docs } = await seeded();
  const before = (await app.inject({ method: 'GET', url: '/api/library/health' })).json();
  for (let i = 0; i < 3; i += 1) {
    await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${encodeURIComponent(exactQuery(docs.k8s))}&page=true`, headers: AGENT });
  }
  await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${encodeURIComponent(exactQuery(docs.dns))}&page=true`, headers: AGENT });
  await flush();
  const plain = (await app.inject({ method: 'GET', url: '/api/library/health' })).json();
  assert.deepEqual(plain, before, 'without sort the response is byte-for-byte the same');
  assert.ok(plain.needsReview.every((row) => !('recallHits' in row)));

  const sorted = await app.inject({ method: 'GET', url: '/api/library/health?sort=recall' });
  assert.equal(sorted.statusCode, 200);
  const rows = sorted.json().needsReview;
  assert.deepEqual(rows.map((r) => r.id).slice(0, 2), [docs.k8s.id, docs.dns.id]);
  assert.equal(rows[0].recallHits, 3);
  assert.equal(rows.at(-1).recallHits, 0);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/health?sort=title' })).statusCode, 400);

  const counts = (await app.inject({ method: 'GET', url: '/api/library/librarian/recall-counts' })).json();
  assert.equal(counts.counts[docs.k8s.id].hits, 3);
  await app.close();
});

test('never-recalled agent memories are prune candidates only once telemetry covers 30 days', async () => {
  const db = await freshDb();
  const app = await buildApp({ db, librarianSweep: false });
  const make = async (title) => (await app.inject({
    method: 'POST', url: '/api/library/documents', headers: { 'x-prax-origin': 'agent' },
    payload: { title, body: `${title} body`, documentType: 'note', project: 'homelab' },
  })).json();
  const recalled = await make('Recalled memory');
  const idle = await make('Idle memory');
  await db.query("update markdown_documents set created_at = '2026-01-01T00:00:00.000Z'");
  let now = new Date('2026-02-01T00:00:00Z');
  const telemetry = createRecallTelemetry(db, { clock: () => now });
  await telemetry.recordQuery({ source: 'recall', mode: 'semantic', query: 'recalled', hitIds: [recalled.id] });

  now = new Date('2026-02-10T00:00:00Z');
  let result = await telemetry.neverRecalled({ now });
  assert.equal(result.ready, false);
  assert.equal(result.coverageDays, 9);
  assert.deepEqual(result.items, []);

  now = new Date('2026-03-05T00:00:00Z');
  result = await telemetry.neverRecalled({ now });
  assert.equal(result.ready, true);
  assert.deepEqual(result.items.map((d) => d.id), [idle.id]);
  await app.close();
});
