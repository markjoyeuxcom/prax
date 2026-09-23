// Hybrid citation anchors on the server (migration 0039): the columns, the
// compare-and-set backfill, the by-path lookup `prax check` asks, and that
// anchors survive the Markdown export and the workspace backup.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createDocumentCodeRefsRepository, normalizeCodeRefRow } from '../../server/documentCodeRefsRepository.js';

const SILENT = { info() {}, error() {} };
const DOC = '11111111-1111-4111-8111-111111111111';
const H = (c) => c.repeat(64);

test('0039 adds nullable anchors: a citation pinned before it reads back as legacy', async () => {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT, through: '0038' });
  const project = (await db.query("select id from projects where slug='inbox'")).rows[0].id;
  await db.query(`insert into markdown_documents (id, title, body, document_type, project_id) values ($1, 'Doc', 'b', 'note', $2)`, [DOC, project]);
  await db.query('insert into document_code_refs (document_id, path, start_line, end_line, content_hash) values ($1, $2, 1, 2, $3)', [DOC, 'a.js', H('a')]);
  const { applied } = await runMigrations(db, { logger: SILENT });
  assert.equal(applied[0], '0039_add_citation_anchors.sql');
  const [ref] = await createDocumentCodeRefsRepository(db).listCodeRefs(DOC);
  assert.equal(ref.contentHash, H('a'));
  assert.equal(ref.normalizedHash, null);
  assert.equal(ref.symbol, null);
  const indexes = (await db.query("select name from sqlite_master where type='index' and tbl_name='document_code_refs'")).rows.map((r) => r.name);
  assert.ok(indexes.includes('idx_document_code_refs_path'));
  await db.close();
});

test('the row shape carries both anchors', () => {
  const n = normalizeCodeRefRow({
    id: 'r', document_id: DOC, path: 'a.js', start_line: 1, end_line: 2, commit_sha: null,
    content_hash: H('a'), normalized_hash: H('b'), symbol: 'loadConfig', created_at: 't',
  });
  assert.equal(n.normalizedHash, H('b'));
  assert.equal(n.symbol, 'loadConfig');
});

async function liveApp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'prax-anchor-test-'));
  const file = join(directory, 'prax.db');
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: file, EMBEDDING_BACKEND: 'none' }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (method, url, payload, status = 200) => {
    const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    assert.equal(res.statusCode, status, res.body);
    return res.json();
  };
  const doc = (title, project = 'work') => call('POST', '/api/library/documents', { title, body: 'claim', project, documentType: 'note' }, 201);
  return { app, call, doc, file, directory };
}

test('POST code-refs stores the anchors, validates them, and a re-cite without them clears them', async (t) => {
  const { call, doc } = await liveApp(t);
  const d = await doc('Anchored');
  const url = `/api/library/documents/${d.id}/code-refs`;
  let list = await call('POST', url, { path: 'src/a.js', startLine: 3, endLine: 9, contentHash: H('a'), normalizedHash: H('b'), symbol: 'loadConfig' }, 201);
  assert.equal(list[0].normalizedHash, H('b'));
  assert.equal(list[0].symbol, 'loadConfig');
  await call('POST', url, { path: 'src/a.js', startLine: 3, endLine: 9, contentHash: H('a'), normalizedHash: 'nope' }, 400);
  await call('POST', url, { path: 'src/a.js', startLine: 3, endLine: 9, contentHash: H('a'), normalizedHash: H('b'), symbol: 'a\nb' }, 400);
  await call('POST', url, { path: 'src/a.js', startLine: 3, endLine: 9, contentHash: H('a'), symbol: 'orphan' }, 400);
  // An older client re-cites: the anchors described the old pin, so they go.
  list = await call('POST', url, { path: 'src/a.js', startLine: 3, endLine: 9, contentHash: H('c') }, 201);
  assert.equal(list.length, 1);
  assert.equal(list[0].contentHash, H('c'));
  assert.equal(list[0].normalizedHash, null);
  assert.equal(list[0].symbol, null);
});

test('anchor backfill is compare-and-set on the pinned hash and never overwrites', async (t) => {
  const { call, doc } = await liveApp(t);
  const d = await doc('Legacy');
  const [ref] = await call('POST', `/api/library/documents/${d.id}/code-refs`, { path: 'src/a.js', startLine: 1, endLine: 2, contentHash: H('a') }, 201);
  const url = `/api/library/documents/${d.id}/code-refs/${ref.id}/anchors`;
  // Anchors computed from other content are refused by the compare.
  let res = await call('POST', url, { contentHash: H('f'), normalizedHash: H('b'), symbol: 'x' });
  assert.equal(res.updated, false);
  assert.equal(res.ref.normalizedHash, null);
  res = await call('POST', url, { contentHash: H('a'), normalizedHash: H('b'), symbol: 'loadConfig' });
  assert.equal(res.updated, true);
  assert.equal(res.ref.symbol, 'loadConfig');
  // A second (racing or retried) backfill leaves the first in place.
  res = await call('POST', url, { contentHash: H('a'), normalizedHash: H('d'), symbol: 'other' });
  assert.equal(res.updated, false);
  assert.equal(res.ref.normalizedHash, H('b'));
  await call('POST', url, { contentHash: H('a') }, 400);
  await call('POST', `/api/library/documents/${d.id}/code-refs/22222222-2222-4222-8222-222222222222/anchors`, { contentHash: H('a'), normalizedHash: H('b') }, 404);
});

test('citations by path: live active documents only, optionally one project, with repository identity', async (t) => {
  const { call, doc } = await liveApp(t);
  const projects = await call('GET', '/api/projects');
  const work = projects.find((p) => p.slug === 'work');
  await call('PATCH', `/api/projects/${work.id}`, { repoUrl: 'git@gitlab.com:org/app.git' });
  const live = await doc('Live claim');
  const retired = await doc('Retired claim');
  const replacement = await doc('Replacement');
  const archived = await doc('Archived claim');
  const elsewhere = await doc('Memory claim', 'memory');
  for (const d of [live, retired, archived, elsewhere]) {
    await call('POST', `/api/library/documents/${d.id}/code-refs`, { path: 'src/a.js', startLine: 1, endLine: 2, contentHash: H('a') }, 201);
  }
  await call('POST', `/api/library/documents/${live.id}/code-refs`, { path: 'src/other.js', contentHash: H('a') }, 201);
  await call('POST', `/api/library/documents/${retired.id}/supersede`, { supersededBy: replacement.id });
  await call('DELETE', `/api/library/documents/${archived.id}`);

  const { items } = await call('GET', '/api/library/code-refs?path=src/a.js&path=missing.js');
  assert.deepEqual(items.map((i) => i.document.title).sort(), ['Live claim', 'Memory claim']);
  const mine = items.find((i) => i.document.id === live.id);
  assert.equal(mine.path, 'src/a.js');
  assert.equal(mine.document.projectSlug, 'work');
  assert.equal(mine.document.projectRepoUrl, 'git@gitlab.com:org/app.git');
  assert.equal(mine.document.status, 'active');
  assert.equal(typeof mine.document.verified, 'boolean');

  const scoped = await call('GET', '/api/library/code-refs?path=src/a.js&path=src/other.js&project=work');
  assert.deepEqual(scoped.items.map((i) => i.path), ['src/a.js', 'src/other.js']);
  await call('GET', '/api/library/code-refs', undefined, 400);
  await call('GET', '/api/library/code-refs?path=/etc/passwd', undefined, 400);
  await call('GET', '/api/library/code-refs?path=../x.js', undefined, 400);
  await call('GET', '/api/library/code-refs?path=a.js&project=no-such-project', undefined, 400);
  const tooMany = Array.from({ length: 201 }, (_, i) => `path=f${i}.js`).join('&');
  await call('GET', `/api/library/code-refs?${tooMany}`, undefined, 400);
});

test('anchors survive the Markdown v3 export and the workspace backup', async (t) => {
  const { app, call, doc, file } = await liveApp(t);
  const d = await doc('Exported claim');
  await call('POST', `/api/library/documents/${d.id}/code-refs`, { path: 'src/a.js', startLine: 4, endLine: 6, contentHash: H('a'), normalizedHash: H('b'), symbol: 'loadConfig' }, 201);
  const single = await app.inject(`/api/library/documents/${d.id}/export`);
  assert.equal(single.statusCode, 200);
  const line = single.body.split('\n').find((l) => l.startsWith('code_refs: '));
  const [ref] = JSON.parse(line.slice('code_refs: '.length));
  assert.equal(ref.normalizedHash, H('b'));
  assert.equal(ref.symbol, 'loadConfig');
  assert.match(single.body, /prax_export_version: 3/);

  const snapshot = join(file, '..', 'snapshot.db');
  await app.db.snapshot(snapshot);
  const copy = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const row = copy.prepare('select content_hash, normalized_hash, symbol from document_code_refs where document_id = ?').get(d.id);
    assert.deepEqual({ ...row }, { content_hash: H('a'), normalized_hash: H('b'), symbol: 'loadConfig' });
  } finally { copy.close(); }
});
