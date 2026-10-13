// Librarian consolidation pass (spec 2026-09-23): near-duplicate clustering
// with and without embeddings, the proposal document, idempotent runs, the
// human-only decisions, the read-only report, and the proposal-only invariant:
// a run never supersedes, merges, edits or archives a source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import { createFakeEmbedder } from '../../server/embedder/fake.js';
import { createDocumentLinksRepository } from '../../server/documentLinksRepository.js';
import {
  shingleSet, jaccard, findShinglePairs, findEmbeddingPairs, clusterPairs, chooseCanonical,
  draftCanonicalBody, buildProposalDocument, classifyClusters, selectCandidates, PROPOSAL_TAG,
} from '../../server/librarian.js';
import { isReviewQueueDoc } from '../../public/js/renderLibrary.js';

const SILENT = { info() {}, error() {}, warn() {} };
const HUMAN = {};
const AGENT = { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' };

const RESTORE_A = 'To restore Postgres, stop the app, copy the latest pg_dump from the NAS, run pg_restore with --clean, then start the app and check the row counts.';
const RESTORE_B = 'To restore Postgres, stop the app, copy the latest pg_dump from the NAS, run pg_restore with --clean, then start the app and check the row counts again.\n\nIf the dump is older than a day, page the on-call.';
const UNRELATED = 'The DNS resolver runs Unbound on the router and forwards to Quad9 over TLS.';

async function makeApp({ embedder = null, spyRelations } = {}) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  let documentLinksRepository;
  if (spyRelations) {
    const real = createDocumentLinksRepository(db);
    documentLinksRepository = {
      ...real,
      linkDocuments: (source, target, relation, actor) => { spyRelations.push(relation); return real.linkDocuments(source, target, relation, actor); },
    };
  }
  const app = await buildApp({
    db, embedder, librarianSweep: false,
    ...(documentLinksRepository ? { documentLinksRepository } : {}),
  });
  return { app, db };
}

async function createDoc(app, { title, body, project = 'homelab', headers = AGENT, documentType = 'note', tags }) {
  const res = await app.inject({ method: 'POST', url: '/api/library/documents', headers, payload: { title, body, documentType, project, ...(tags ? { tags } : {}) } });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

const getDoc = async (app, id) => (await app.inject({ method: 'GET', url: `/api/library/documents/${id}` })).json();
const run = (app, payload = {}) => app.inject({ method: 'POST', url: '/api/library/librarian/run', payload });
const supersedeLinks = async (db) => Number((await db.query("select count(*) as n from document_links where relation = 'supersedes'")).rows[0].n);

// ---- pure parts ------------------------------------------------------------

test('shingles and Jaccard find near-duplicates within a project only', () => {
  assert.ok(jaccard(shingleSet(RESTORE_A), shingleSet(RESTORE_B)) >= 0.5);
  assert.ok(jaccard(shingleSet(RESTORE_A), shingleSet(UNRELATED)) < 0.1);
  assert.equal(shingleSet('two words').size, 1, 'a short text is one shingle');
  const docs = [
    { id: 'a', projectId: 'p1', title: 'Restore', body: RESTORE_A },
    { id: 'b', projectId: 'p1', title: 'Restore', body: RESTORE_B },
    { id: 'c', projectId: 'p2', title: 'Restore', body: RESTORE_A },
    { id: 'd', projectId: 'p1', title: 'DNS', body: UNRELATED },
  ];
  const pairs = findShinglePairs(docs);
  assert.deepEqual(pairs.map((p) => [p.a, p.b].sort().join('')), ['ab']);
  assert.equal(pairs[0].method, 'shingle');
});

test('embedding pairs use cosine with a threshold, per project', () => {
  const docs = [
    { id: 'a', projectId: 'p', vector: [1, 0, 0] },
    { id: 'b', projectId: 'p', vector: [0.99, 0.05, 0] },
    { id: 'c', projectId: 'p', vector: [0, 1, 0] },
    { id: 'd', projectId: 'q', vector: [1, 0, 0] },
  ];
  const pairs = findEmbeddingPairs(docs, { threshold: 0.92 });
  assert.deepEqual(pairs.map((p) => `${p.a}${p.b}`), ['ab']);
});

test('clusters are union-find components, capped, keyed by their members', () => {
  const clusters = clusterPairs([
    { a: 'a', b: 'b', similarity: 0.9, method: 'shingle' },
    { a: 'b', b: 'c', similarity: 0.8, method: 'embedding' },
    { a: 'x', b: 'y', similarity: 0.7, method: 'shingle' },
  ]);
  assert.deepEqual(clusters.map((c) => c.ids), [['a', 'b', 'c'], ['x', 'y']]);
  assert.equal(clusters[0].method, 'mixed');
  const star = clusterPairs(Array.from({ length: 10 }, (_, i) => ({ a: 'hub', b: `n${i}`, similarity: 0.9, method: 'shingle' })), { maxSize: 4 });
  assert.equal(star[0].ids.length, 4);
  assert.ok(star[0].ids.includes('hub'));
  assert.equal(star[0].truncatedFrom, 11);
  const classified = classifyClusters(clusters, [{ clusterKey: clusters[1].key, status: 'dismissed', documentId: 'p' }, { clusterKey: 'other', status: 'open', sourceIds: ['a', 'b', 'c', 'z'] }]);
  assert.deepEqual(classified.map((c) => c.status), ['covered', 'dismissed']);
});

test('candidates skip templates, weekly reviews, proposals, retired and empty documents', () => {
  const { candidates } = selectCandidates([
    { id: '1', body: 'x', status: 'active' },
    { id: '2', body: 'x', status: 'superseded' },
    { id: '3', body: ' ', status: 'active' },
    { id: '4', body: 'x', documentType: 'template' },
    { id: '5', body: 'x', tags: ['weekly-review'] },
    { id: '6', body: 'x', tags: [PROPOSAL_TAG] },
    { id: '7', body: 'x', archivedAt: '2026-01-01' },
  ]);
  assert.deepEqual(candidates.map((d) => d.id), ['1']);
});

test('the draft prefers a verified base and appends only what it lacks', () => {
  const base = { id: 'v', title: 'Base', verified: true, body: 'Step one.\n\nStep two.' };
  const other = { id: 'u', title: 'Other', verified: false, body: 'Step one.\n\nStep two.\n\nStep three is new.\n\nA much longer paragraph that makes this body longer than the base body by far.' };
  assert.equal(chooseCanonical([other, base]).id, 'v');
  const draft = draftCanonicalBody(base, [other]);
  assert.match(draft, /^Step one\.\n\nStep two\.\n\n### Also from “Other”\n\nStep three is new\./);
  assert.equal(draft.match(/Step one/g).length, 1);
  const cluster = { ids: ['u', 'v'], edges: [{ a: 'u', b: 'v', similarity: 0.95, method: 'embedding' }], key: 'k' };
  const doc = buildProposalDocument(cluster, new Map([['v', { ...base, projectId: 'p', documentType: 'runbook' }], ['u', { ...other, projectId: 'p' }]]));
  assert.equal(doc.title, 'Proposal: consolidate “Base” (+1)');
  assert.equal(doc.documentType, 'runbook');
  assert.equal(doc.verified, false);
  assert.equal(doc.kind, 'synthesized');
  assert.deepEqual(doc.tags, [PROPOSAL_TAG]);
  assert.deepEqual(doc.sourceIds, ['v', 'u']);
  assert.match(doc.body, /Nothing has been merged or retired/);
  assert.match(doc.body, /this document `supersedes` `u`/);
  assert.match(doc.body, /cosine 0\.950/);
});

// ---- the pass over a real database ----------------------------------------------

test('without embeddings, shingles propose one unverified synthesized document in the review queue', async () => {
  const spyRelations = [];
  const { app, db } = await makeApp({ spyRelations });
  const a = await createDoc(app, { title: 'Restore Postgres', body: RESTORE_A });
  const b = await createDoc(app, { title: 'Postgres restore steps', body: RESTORE_B, headers: HUMAN });
  await createDoc(app, { title: 'DNS', body: UNRELATED });
  await createDoc(app, { title: 'Restore Postgres (other project)', body: RESTORE_A, project: 'work' });
  const before = { a: await getDoc(app, a.id), b: await getDoc(app, b.id) };

  const res = await run(app);
  assert.equal(res.statusCode, 200, res.body);
  const report = res.json();
  assert.equal(report.method, 'shingle');
  assert.equal(report.created.length, 1);
  assert.deepEqual(report.created[0].sourceIds.sort(), [a.id, b.id].sort());

  const proposal = await getDoc(app, report.created[0].id);
  assert.equal(proposal.verified, false);
  assert.equal(proposal.kind, 'synthesized');
  assert.equal(proposal.updatedBy, 'agent');
  assert.equal(proposal.updatedByAgent, 'librarian');
  assert.deepEqual(proposal.tags, [PROPOSAL_TAG]);
  assert.equal(proposal.projectId, a.projectId);
  assert.ok(isReviewQueueDoc(proposal), 'the review walk shows proposals');
  // The human-written source is verified, so it is the canonical base.
  assert.match(proposal.title, /^Proposal: consolidate “Postgres restore steps” \(\+1\)$/);
  assert.match(proposal.body, new RegExp(`\`${a.id}\``));
  assert.match(proposal.body, /shingle Jaccard/);

  // Proposal-only: derived-from provenance, never a supersedes link; the
  // sources are untouched.
  assert.deepEqual([...new Set(spyRelations)], ['derived-from']);
  assert.equal(await supersedeLinks(db), 0);
  for (const [key, doc] of Object.entries(before)) {
    const now = await getDoc(app, doc.id);
    assert.equal(now.status, 'active', key);
    assert.equal(now.revision, doc.revision, key);
    assert.equal(now.verified, doc.verified, key);
    assert.equal(now.archivedAt, null, key);
  }
  const links = (await app.inject({ method: 'GET', url: `/api/library/documents/${proposal.id}/links` })).json();
  assert.ok(JSON.stringify(links).includes('derived-from'));

  // Idempotent: a second run proposes nothing new.
  const again = (await run(app)).json();
  assert.equal(again.created.length, 0);
  assert.deepEqual(again.clusters.map((c) => c.status), ['proposed']);
  const listed = (await app.inject({ method: 'GET', url: '/api/library/librarian/proposals?status=open' })).json();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].verified, false);
  await app.close();
});

test('with the fake embedder, current vectors decide; shingles cover documents without one', async () => {
  const embedder = createFakeEmbedder();
  const { app, db } = await makeApp({ embedder });
  // Word-for-word identical notes: identical fake vectors (cosine 1).
  const x = await createDoc(app, { title: 'Ingress', body: 'Traefik terminates TLS for every service in the homelab cluster.' });
  const y = await createDoc(app, { title: 'Ingress', body: 'Traefik terminates TLS for every service in the homelab cluster.' });
  // Different words, near-identical vectors set by hand: only embeddings see it.
  const p = await createDoc(app, { title: 'Pager rota', body: 'Mark covers weekdays; Sam covers weekends.' });
  const q = await createDoc(app, { title: 'On-call schedule', body: 'Weekday shifts go to Mark and the weekend to Sam.' });
  await createDoc(app, { title: 'DNS', body: UNRELATED });
  await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  const setVector = async (doc, vector) => {
    const current = await getDoc(app, doc.id);
    await db.query('update markdown_documents set embedding = $2 where id = $1 and embedded_hash = $3', [doc.id, JSON.stringify(vector), current.revision]);
  };
  const base = Array.from({ length: 64 }, (_, i) => Math.sin(i + 1));
  await setVector(p, base);
  await setVector(q, base.map((v, i) => v + (i === 0 ? 0.01 : 0)));

  const report = (await app.inject({ method: 'GET', url: '/api/library/librarian/report' })).json();
  assert.equal(report.clusters.method, 'embedding');
  const byMembers = new Map(report.clusters.clusters.map((c) => [c.documents.map((d) => d.id).sort().join(','), c]));
  const pq = byMembers.get([p.id, q.id].sort().join(','));
  assert.ok(pq, 'the embedding-only pair is found');
  assert.equal(pq.method, 'embedding');
  assert.ok(byMembers.get([x.id, y.id].sort().join(',')));
  assert.equal(report.clusters.created.length, 0, 'the report writes nothing');
  assert.equal(Number((await db.query(`select count(*) as n from markdown_documents where tags like '%${PROPOSAL_TAG}%'`)).rows[0].n), 0);
  const duplicates = report.checks.find((c) => c.id === 'duplicates');
  assert.equal(duplicates.level, 'warn');
  assert.equal(duplicates.count, 2);
  assert.equal(report.status, 'warn');

  const ran = (await run(app)).json();
  assert.equal(ran.created.length, 2);
  assert.equal(await supersedeLinks(db), 0);
  const after = (await app.inject({ method: 'GET', url: '/api/library/librarian/report' })).json();
  assert.equal(after.checks.find((c) => c.id === 'duplicates').level, 'ok');
  assert.equal(after.checks.find((c) => c.id === 'proposals').count, 2);
  await app.close();
});

test('approval is a human decision on a verified proposal; only it records supersedes links', async () => {
  const { app, db } = await makeApp();
  const a = await createDoc(app, { title: 'Restore Postgres', body: RESTORE_A });
  const b = await createDoc(app, { title: 'Restore Postgres again', body: RESTORE_B });
  const { created: [{ id }] } = (await run(app)).json();
  const approve = (headers = HUMAN) => app.inject({ method: 'POST', url: `/api/library/librarian/proposals/${id}/approve`, headers });

  const byAgent = await approve(AGENT);
  assert.equal(byAgent.statusCode, 403);
  assert.equal(byAgent.json().reason, 'human-approval-required');
  const unverified = await approve();
  assert.equal(unverified.statusCode, 409);
  assert.equal(unverified.json().reason, 'verify-first');
  assert.equal(await supersedeLinks(db), 0);

  const proposal = await getDoc(app, id);
  const verified = await app.inject({ method: 'POST', url: `/api/library/documents/${id}/verify`, payload: { verified: true, as: 'Mark', revision: proposal.revision } });
  assert.equal(verified.statusCode, 200);
  const ok = await approve();
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().proposal.status, 'approved');
  assert.deepEqual(ok.json().results.map((r) => r.outcome), ['superseded', 'superseded']);
  assert.equal(await supersedeLinks(db), 2);
  assert.equal((await getDoc(app, a.id)).status, 'superseded');
  assert.equal((await getDoc(app, b.id)).status, 'superseded');
  const replay = await approve();
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replayed, true);
  await app.close();
});

test('dismissal is human-only, archives the proposal and sticks across runs', async () => {
  const { app } = await makeApp();
  await createDoc(app, { title: 'Restore Postgres', body: RESTORE_A });
  await createDoc(app, { title: 'Restore Postgres again', body: RESTORE_B });
  const { created: [{ id }] } = (await run(app)).json();
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/librarian/proposals/${id}/dismiss`, headers: AGENT })).statusCode, 403);
  const dismissed = await app.inject({ method: 'POST', url: `/api/library/librarian/proposals/${id}/dismiss` });
  assert.equal(dismissed.statusCode, 200);
  assert.equal(dismissed.json().proposal.status, 'dismissed');
  assert.ok((await getDoc(app, id)).archivedAt);
  const again = (await run(app)).json();
  assert.equal(again.created.length, 0);
  assert.deepEqual(again.clusters.map((c) => c.status), ['dismissed']);
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/librarian/proposals/${id}/approve` })).statusCode, 409);
  await app.close();
});

test('the schedule is off by default; the sweep runs the pass once a day when switched on', async () => {
  const { app } = await makeApp();
  await createDoc(app, { title: 'Restore Postgres', body: RESTORE_A });
  await createDoc(app, { title: 'Restore Postgres again', body: RESTORE_B });
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/librarian/settings' })).json().scheduleEnabled, false);
  assert.deepEqual(await app.librarianSweep(), { ran: false });
  assert.equal((await app.inject({ method: 'PUT', url: '/api/library/librarian/settings', payload: { scheduleEnabled: 'yes' } })).statusCode, 400);
  const on = await app.inject({ method: 'PUT', url: '/api/library/librarian/settings', payload: { scheduleEnabled: true } });
  assert.equal(on.json().scheduleEnabled, true);
  const now = Date.parse('2026-09-23T08:00:00Z');
  assert.deepEqual(await app.librarianSweep(now), { ran: true, created: 1 });
  assert.deepEqual(await app.librarianSweep(now + 3600000), { ran: false }, 'not again within a day');
  assert.deepEqual(await app.librarianSweep(now + 25 * 3600000), { ran: true, created: 0 });
  await app.close();
});

test('the librarian routes need the database and validate their input', async () => {
  const app = await buildApp({ skipDb: true, librarianSweep: false });
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/librarian/run', payload: {} })).statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/librarian/gaps' })).statusCode, 409);
  await app.close();
  const { app: real } = await makeApp();
  assert.equal((await run(real, { embeddingThreshold: 2 })).statusCode, 400);
  assert.equal((await run(real, { project: 'no-such-project' })).statusCode, 400);
  assert.equal((await real.inject({ method: 'POST', url: '/api/library/librarian/proposals/not-a-uuid/approve' })).statusCode, 400);
  assert.equal((await real.inject({ method: 'POST', url: '/api/library/librarian/proposals/00000000-0000-4000-8000-000000000009/approve' })).statusCode, 404);
  await real.close();
});

test('the report reuses clustering for an unchanged library and recomputes after an edit', async () => {
  const { app } = await makeApp();
  const a = await createDoc(app, { title: 'Restore Postgres', body: RESTORE_A });
  const b = await createDoc(app, { title: 'Postgres restore steps', body: RESTORE_B });
  const dns = await createDoc(app, { title: 'DNS', body: UNRELATED });
  const report = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/library/librarian/report' });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().clusters;
  };
  const members = (pass) => pass.clusters.map((c) => c.documents.map((d) => d.id).sort());
  const first = await report();
  assert.equal(first.cached, false);
  assert.deepEqual(members(first), [[a.id, b.id].sort()]);
  const second = await report();
  assert.equal(second.cached, true, 'an unchanged library reuses the last clustering');
  assert.deepEqual(second.clusters, first.clusters);

  // Filing a proposal changes no candidate: the clusters are reused, and their
  // status is still classified afresh.
  const ran = (await run(app)).json();
  assert.equal(ran.cached, true);
  assert.equal(ran.created.length, 1);
  assert.deepEqual((await report()).clusters.map((c) => c.status), ['proposed']);

  // An edit changes the document's revision, so clustering runs again.
  const edited = await app.inject({
    method: 'POST', url: `/api/library/documents/${b.id}/update`, headers: HUMAN,
    payload: { title: 'DNS notes', body: UNRELATED, operationId: crypto.randomUUID() },
  });
  assert.equal(edited.statusCode, 200, edited.body);
  const after = await report();
  assert.equal(after.cached, false);
  assert.deepEqual(members(after), [[b.id, dns.id].sort()]);
  await app.close();
});

// ---- every project has an overview document -------------------------------

test('the report lists active projects without an overview; a seeded or added card clears them', async () => {
  const { app } = await makeApp();
  const before = (await app.inject({ method: 'GET', url: '/api/library/librarian/report' })).json();
  const overview = before.checks.find((c) => c.id === 'overview');
  assert.equal(overview.level, 'info', 'a missing card is reported, never a CI failure');
  assert.ok(before.overview.missing.some((p) => p.slug === 'homelab'), 'the migration-seeded project has no card');
  assert.ok(!before.overview.missing.some((p) => p.slug === 'inbox' || p.slug === 'memory'), 'system projects are exempt');

  // A project created through the API starts with its card, filed unverified in it.
  const created = (await app.inject({ method: 'POST', url: '/api/projects', headers: AGENT, payload: { name: 'Klyx' } })).json();
  assert.ok(created.overviewDocumentId);
  const card = await getDoc(app, created.overviewDocumentId);
  assert.equal(card.title, 'Klyx project overview');
  assert.equal(card.projectId, created.id);
  assert.deepEqual(card.tags, ['project-card']);
  assert.equal(card.verified, false);
  assert.equal(card.updatedBy, 'agent');
  assert.equal(card.updatedByAgent, 'claude');
  assert.match(card.body, /- Prax project: Klyx \(klyx\)/);

  // An older project gets its card from the overview route, once.
  const homelab = (await app.inject({ method: 'GET', url: '/api/projects' })).json().find((p) => p.slug === 'homelab');
  const added = await app.inject({ method: 'POST', url: `/api/projects/${homelab.id}/overview` });
  assert.equal(added.statusCode, 201);
  assert.equal(added.json().document.title, 'Homelab project overview');
  const again = await app.inject({ method: 'POST', url: `/api/projects/${homelab.id}/overview` });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().document.id, added.json().document.id);

  const after = (await app.inject({ method: 'GET', url: '/api/library/librarian/report' })).json();
  assert.ok(!after.overview.missing.some((p) => p.slug === 'homelab' || p.slug === 'klyx'));
  const scoped = (await app.inject({ method: 'GET', url: `/api/library/librarian/report?project=${homelab.id}` })).json();
  assert.equal(scoped.checks.find((c) => c.id === 'overview').count, 0);
  await app.close();
});

test('concurrent overview requests resolve to one card; a doctor that cannot inspect projects says so', async () => {
  const { app } = await makeApp();
  const bare = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Racy', overview: false } })).json();
  const responses = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: 'POST', url: `/api/projects/${bare.id}/overview` })));
  const ids = new Set(responses.map((r) => r.json().document.id));
  assert.equal(ids.size, 1, 'eight simultaneous requests share one card');
  assert.equal(responses.filter((r) => r.statusCode === 201).length, 1, 'exactly one of them created it');
  assert.ok(responses.every((r) => [200, 201].includes(r.statusCode)));
  const cards = (await app.inject({ method: 'GET', url: `/api/library/documents?project=${bare.slug}` })).json().filter((d) => d.tags.includes('project-card'));
  assert.equal(cards.length, 1);
  await app.close();

  // An archived card is a decision the route respects.
  const { app: app2 } = await makeApp();
  const project = (await app2.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Archived card' } })).json();
  assert.equal((await app2.inject({ method: 'DELETE', url: `/api/library/documents/${project.overviewDocumentId}` })).statusCode, 200);
  const refused = await app2.inject({ method: 'POST', url: `/api/projects/${project.id}/overview` });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().document.id, project.overviewDocumentId);
  await app2.close();

  // The projects repository fails: the overview check must not read as "none missing".
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const { createProjectsRepository } = await import('../../server/projectsRepository.js');
  const real = createProjectsRepository(db);
  const broken = { ...real, async listProjects() { throw new Error('projects down'); } };
  const app3 = await buildApp({ db, librarianSweep: false, projectsRepository: broken });
  const report = (await app3.inject({ method: 'GET', url: '/api/library/librarian/report' })).json();
  assert.equal(report.overview.unavailable, true);
  assert.equal(report.overview.missing, null);
  assert.match(report.checks.find((c) => c.id === 'overview').message, /could not be inspected/);
  await app3.close();
});
