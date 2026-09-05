import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createLibraryRepository, documentRevision } from '../../server/libraryRepository.js';
import { createFakeEmbedder } from '../../server/embedder/fake.js';
import { embeddableText } from '../../server/embeddingService.js';

// EXECUTED regressions for the 2026-09-04 consolidated review: C03 (conditional
// editor writes), C08 (exact revision verification including the title), C09
// (embedding writes guarded by the full embedded input), C10 (semantic search
// ignores stale/incompatible vectors and discloses an incomplete index), C15
// (Unicode keyword search), and M2 (owner-aware, explicitly degraded child
// collections). Real migrated SQLite, production routes.

const HEX64 = /^[0-9a-f]{64}$/;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

async function bootApp() {
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'fake' }) });
  const projects = (await app.inject({ method: 'GET', url: '/api/projects' })).json();
  const homelab = projects.find((p) => p.slug === 'homelab');
  return { app, homelab };
}

async function createDoc(app, project, fields, headers = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/library/documents', headers, payload: { documentType: 'note', project: project.id, ...fields } });
  assert.equal(res.statusCode, 201, res.payload);
  return res.json();
}

test('documentRevision is an unambiguous sha256 over the stored title and body', () => {
  const rev = documentRevision({ title: 'T', body: 'B' });
  assert.match(rev, HEX64);
  assert.equal(rev, sha(JSON.stringify(['T', 'B'])));
  assert.notEqual(rev, documentRevision({ title: 'T2', body: 'B' }));
  assert.notEqual(rev, documentRevision({ title: 'T', body: 'B2' }));
  // JSON framing: moving characters between title and body always changes the token.
  assert.notEqual(documentRevision({ title: 'ab', body: 'c' }), documentRevision({ title: 'a', body: 'bc' }));
  assert.equal(documentRevision({}), sha(JSON.stringify(['', ''])));
});

test('every full document record carries a revision that follows title and body, not metadata', async () => {
  const { app, homelab } = await bootApp();
  try {
    const created = await createDoc(app, homelab, { title: 'Rev doc', body: 'first' });
    assert.equal(created.revision, documentRevision({ title: 'Rev doc', body: 'first' }));
    const fetched = (await app.inject({ method: 'GET', url: `/api/library/documents/${created.id}` })).json();
    assert.equal(fetched.revision, created.revision);
    assert.equal(fetched.contentHash, sha('first'), 'contentHash keeps its body-only meaning');

    const retagged = (await app.inject({ method: 'PATCH', url: `/api/library/documents/${created.id}`, payload: { tags: ['ops'] } })).json();
    assert.equal(retagged.revision, created.revision, 'metadata-only edits keep the revision');

    const renamed = (await app.inject({ method: 'PATCH', url: `/api/library/documents/${created.id}`, payload: { title: 'Rev doc 2' } })).json();
    assert.equal(renamed.revision, documentRevision({ title: 'Rev doc 2', body: 'first' }));
    const listed = (await app.inject({ method: 'GET', url: '/api/library/documents' })).json().find((d) => d.id === created.id);
    assert.equal(listed.revision, renamed.revision);
  } finally { await app.close(); }
});

test('C03: a body-only save conditioned on a stale baseline cannot restore a remotely changed title', async () => {
  const { app, homelab } = await bootApp();
  try {
    const doc = await createDoc(app, homelab, { title: 'Original title', body: 'original body' });
    const baseline = doc.revision;

    // Another client renames the document.
    const remote = await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { title: 'New remote title' } });
    assert.equal(remote.statusCode, 200);

    // The original editor saves only its body against the baseline it loaded.
    const conflict = await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { body: 'local body', ifRevision: baseline } });
    assert.equal(conflict.statusCode, 409, conflict.payload);
    const body = conflict.json();
    assert.equal(body.reason, 'revision-mismatch');
    assert.match(body.message, /changed since/);
    assert.equal(body.document.title, 'New remote title', 'the 409 carries the current record for reconciliation');
    assert.equal(body.document.body, 'original body');
    assert.equal(body.document.revision, remote.json().revision);

    // Nothing was written.
    const stored = (await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}` })).json();
    assert.equal(stored.title, 'New remote title');
    assert.equal(stored.body, 'original body');

    // Reconciled save on the current baseline merges both edits.
    const merged = await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { body: 'local body', ifRevision: body.document.revision } });
    assert.equal(merged.statusCode, 200);
    assert.equal(merged.json().title, 'New remote title');
    assert.equal(merged.json().body, 'local body');
    assert.equal(merged.json().revision, documentRevision({ title: 'New remote title', body: 'local body' }));

    // Malformed baselines are rejected; unconditional patches still work.
    const bad = await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { body: 'x', ifRevision: 'nope' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().message, 'ifRevision is invalid');
    const plain = await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { body: 'unconditional' } });
    assert.equal(plain.statusCode, 200);
    const onlyBaseline = await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { ifRevision: plain.json().revision } });
    assert.equal(onlyBaseline.statusCode, 400, 'a baseline alone is not an update');
  } finally { await app.close(); }
});

test('C08: verification is bound to the exact reviewed revision, title included', async () => {
  const { app, homelab } = await bootApp();
  try {
    const doc = await createDoc(app, homelab, { title: 'Reviewed title', body: 'reviewed body' }, { 'x-prax-origin': 'agent' });
    assert.equal(doc.verified, false);
    const reviewed = doc.revision;

    // An agent retitles after the review; the old body hash still matches.
    const retitled = (await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, headers: { 'x-prax-origin': 'agent' }, payload: { title: 'Skip the checklist' } })).json();
    assert.equal(retitled.contentHash, doc.contentHash);
    assert.notEqual(retitled.revision, reviewed);

    const stale = await app.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/verify`, payload: { verified: true, as: 'mark', revision: reviewed } });
    assert.equal(stale.statusCode, 409, stale.payload);
    assert.equal(stale.json().reason, 'revision-mismatch');
    assert.equal(stale.json().revision, retitled.revision);
    assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}` })).json().verified, false);

    // The body-only token no longer blesses anything on its own.
    const legacy = await app.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/verify`, payload: { verified: true, as: 'mark', contentHash: doc.contentHash } });
    assert.equal(legacy.statusCode, 400);
    assert.equal(legacy.json().message, 'revision is required');
    const missing = await app.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/verify`, payload: { verified: true, as: 'mark' } });
    assert.equal(missing.statusCode, 400);

    // Reviewing the current revision verifies; replay keeps the first stamp.
    const ok = await app.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/verify`, payload: { verified: true, as: 'mark', revision: retitled.revision, contentHash: retitled.contentHash } });
    assert.equal(ok.statusCode, 200, ok.payload);
    assert.equal(ok.json().verified, true);
    assert.equal(ok.json().verifiedBy, 'mark');
    const replay = await app.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/verify`, payload: { verified: true, as: 'mark', revision: retitled.revision } });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().verifiedAt, ok.json().verifiedAt);

    // Unverify needs no token.
    const off = await app.inject({ method: 'POST', url: `/api/library/documents/${doc.id}/verify`, payload: { verified: false } });
    assert.equal(off.statusCode, 200);
    assert.equal(off.json().verified, false);
  } finally { await app.close(); }
});

test('C09: an embedding computed from an older title cannot overwrite the current vector', async () => {
  const { app, homelab } = await bootApp();
  const repo = app.libraryRepository;
  try {
    const doc = await createDoc(app, homelab, { title: 'Old title', body: 'same body' });
    const reindex = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
    assert.equal(reindex.statusCode, 200);
    const before = (await app.db.query('select embedding, embedded_hash from markdown_documents where id = $1', [doc.id])).rows[0];
    assert.equal(before.embedded_hash, doc.revision, 'embedded_hash records the revision the vector was computed from');

    const renamed = (await app.inject({ method: 'PATCH', url: `/api/library/documents/${doc.id}`, payload: { title: 'New title' } })).json();
    assert.equal(renamed.contentHash, doc.contentHash, 'the body hash is unchanged by a retitle');

    // A delayed job that embedded the OLD title tries to commit after the rename.
    const staleVector = Array.from({ length: 64 }, () => 0.5);
    const saved = await repo.setDocumentEmbedding(doc.id, { vector: staleVector, backend: 'fake', model: 'fake-64', dim: 64, revision: doc.revision });
    assert.equal(saved, null, 'the stale write is rejected');
    const after = (await app.db.query('select embedding from markdown_documents where id = $1', [doc.id])).rows[0];
    assert.notDeepEqual(JSON.parse(after.embedding), staleVector);

    // The current revision can be written.
    const fresh = await repo.setDocumentEmbedding(doc.id, { vector: staleVector.map((v) => v / 2), backend: 'fake', model: 'fake-64', dim: 64, revision: renamed.revision });
    assert.equal(fresh, doc.id);
  } finally { await app.close(); }
});

test('C10: semantic search excludes stale or incompatible vectors and discloses index coverage', async () => {
  const { app, homelab } = await bootApp();
  try {
    const doc = await createDoc(app, homelab, { title: 'Quarterly drill', body: 'Restore the NAS from the offsite copy.' });
    await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
    const q = encodeURIComponent(embeddableText(doc));
    const hit = (await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true` })).json();
    assert.ok(hit.items.some((d) => d.id === doc.id));
    assert.equal(hit.degraded, false);
    assert.deepEqual(hit.index, { total: hit.index.total, embedded: hit.index.total, pending: 0 });

    // The body changes out of band (as a restore or raw import would) without a re-embed.
    const newBody = 'Completely different content about DNS.';
    await app.db.query('update markdown_documents set body = $2, content_hash = $3, revision = $4 where id = $1',
      [doc.id, newBody, sha(newBody), documentRevision({ title: doc.title, body: newBody })]);
    const stale = (await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&page=true` })).json();
    assert.ok(!stale.items.some((d) => d.id === doc.id), 'a vector from older content is not ranked');
    assert.equal(stale.degraded, true);
    assert.equal(stale.reason, 'index-incomplete');
    assert.equal(stale.index.pending, 1);
    const legacy = (await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}` })).json();
    assert.ok(Array.isArray(legacy) && !legacy.some((d) => d.id === doc.id));

    // Reindex repairs it.
    await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
    const q2 = encodeURIComponent(embeddableText({ title: doc.title, body: newBody }));
    const repaired = (await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q2}&page=true` })).json();
    assert.ok(repaired.items.some((d) => d.id === doc.id));
    assert.equal(repaired.index.pending, 0);

    // A vector from a different model in the same backend is incompatible.
    await app.db.query("update markdown_documents set embedding_model = 'other-model' where id = $1", [doc.id]);
    const other = (await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q2}&page=true` })).json();
    assert.ok(!other.items.some((d) => d.id === doc.id));
    assert.equal(other.index.pending, 1);
    const status = (await app.inject({ method: 'GET', url: '/api/settings/semantic-search' })).json();
    assert.equal(status.totalCount - status.embeddedCount, 1);
  } finally { await app.close(); }
});

test('pre-revision rows are backfilled on first repository use; their legacy vectors stay pending until reindex', async () => {
  const { app, homelab } = await bootApp();
  try {
    const id = '92000000-0000-4000-8000-0000000000aa';
    const title = 'Legacy embedded note';
    const body = 'Written before revisions existed.';
    const vector = (await createFakeEmbedder({ dim: 64 }).embed(embeddableText({ title, body }))).vector;
    await app.db.query(`
      insert into markdown_documents (id, title, body, document_type, project_id, tags, content_hash, updated_by, kind, verified,
        embedding, embedding_backend, embedding_model, embedding_dim, embedded_hash, embedded_at, revision)
      values ($1, $2, $3, 'note', $4, '[]', $5, 'user', 'source', 1, $6, 'fake', 'fake-64', 64, $5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), null)
    `, [id, title, body, homelab.id, sha(body), JSON.stringify(vector)]);

    // A fresh repository instance (a new process) heals the revision before serving the row.
    const fresh = createLibraryRepository(app.db);
    const doc = await fresh.getDocument(id);
    assert.equal(doc.revision, documentRevision({ title, body }));
    const row = (await app.db.query('select revision, embedded_hash from markdown_documents where id = $1', [id])).rows[0];
    assert.equal(row.revision, doc.revision);
    assert.equal(row.embedded_hash, sha(body), 'a body-only hash cannot prove which title was embedded, so it is left as-is');

    // The legacy vector is pending, not current: excluded from ranking and disclosed.
    const before = await fresh.searchDocumentsSemantic(vector, 'fake', { model: 'fake-64', minSimilarity: 0.9, topDrop: 0.2 });
    assert.ok(!before.some((d) => d.id === id));
    const counts = await fresh.countEmbeddings('fake', 'fake-64');
    assert.ok(counts.total - counts.embedded >= 1);
    const pending = await fresh.listDocumentsNeedingEmbedding('fake', 'fake-64');
    assert.ok(pending.some((d) => d.id === id && d.revision === doc.revision));

    // Reindex repairs it through the production route.
    await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
    const after = await fresh.searchDocumentsSemantic(vector, 'fake', { model: 'fake-64', minSimilarity: 0.9, topDrop: 0.2 });
    assert.ok(after.some((d) => d.id === id));
  } finally { await app.close(); }
});

test('C15: keyword search keeps Unicode terms and never turns an unusable query into a listing', async () => {
  const { app, homelab } = await bootApp();
  try {
    await createDoc(app, homelab, { title: 'Alpha runbook', body: 'restore postgres' });
    await createDoc(app, homelab, { title: '日本語ノート', body: '日本語 本文' });
    await createDoc(app, homelab, { title: 'Überwachung Plan', body: 'Überwachung der Cluster' });
    const search = async (q) => (await app.inject({ method: 'GET', url: `/api/library/documents?q=${encodeURIComponent(q)}` })).json().map((d) => d.title);
    assert.deepEqual(await search('日本語'), ['日本語ノート']);
    assert.deepEqual(await search('Überwachung'), ['Überwachung Plan']);
    assert.deepEqual(await search('uberwachung'), ['Überwachung Plan'], 'diacritics fold both ways');
    assert.deepEqual(await search('postgres'), ['Alpha runbook']);
    assert.deepEqual(await search('$$$'), [], 'a non-empty query with no usable term matches nothing');
    assert.deepEqual(await search('!!! ???'), []);
    assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents?q=${encodeURIComponent('post"; drop table--')}` })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/library/documents' })).json().length, 3, 'no q still lists everything');
  } finally { await app.close(); }
});

test('M2: child collections 404 on a missing owner and /similar declares its degradation', async () => {
  const { app, homelab } = await bootApp();
  try {
    const missing = '11111111-1111-4111-8111-111111111111';
    const tasks = await app.inject({ method: 'GET', url: `/api/library/documents/${missing}/tasks` });
    assert.equal(tasks.statusCode, 404);
    const similarMissing = await app.inject({ method: 'GET', url: `/api/library/documents/${missing}/similar` });
    assert.equal(similarMissing.statusCode, 404);

    const doc = await createDoc(app, homelab, { title: 'Similar seed', body: 'seed body' });
    const ownTasks = await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}/tasks` });
    assert.equal(ownTasks.statusCode, 200);
    assert.deepEqual(ownTasks.json(), []);

    // The write-path embed is asynchronous; force a known unindexed state.
    await app.db.query('update markdown_documents set embedding = null, embedded_hash = null where id = $1', [doc.id]);
    const cleared = (await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}/similar` })).json();
    assert.deepEqual(cleared, { items: [], degraded: true, reason: 'not-indexed' });

    await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
    const indexed = (await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}/similar` })).json();
    assert.equal(indexed.degraded, false);
    assert.ok(Array.isArray(indexed.items));

    await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { enabled: false } });
    const off = (await app.inject({ method: 'GET', url: `/api/library/documents/${doc.id}/similar` })).json();
    assert.deepEqual(off, { items: [], degraded: true, reason: 'semantic-off' });
  } finally { await app.close(); }
});
