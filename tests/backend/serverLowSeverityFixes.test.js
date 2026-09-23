import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { fileDigest } from '../../server/sqliteBackup.js';
import { DOCUMENT_LISTING_COLUMNS, createLibraryRepository } from '../../server/libraryRepository.js';
import { IMPORT_SESSION_TTL_MS } from '../../server/tasksRepository.js';
import { createAssistantWriteReceipts, compactReceiptResult, RECEIPT_NOTES } from '../../server/assistant/writeReceipts.js';
import { clipContent, sanitizeMessages } from '../../server/assistant/agent.js';

// Regressions for the server and persistence low-severity findings of the
// 2026-09-22 review (task 59f9cd06).

const SILENT = { info() {}, error() {} };
const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });

async function testApp(t, options = {}) {
  const app = await buildApp({ config, ...options });
  t.after(() => app.close());
  return app;
}

async function call(app, method, url, payload, status) {
  const response = await app.inject({ method, url, ...(payload !== undefined ? { payload } : {}) });
  if (status !== undefined) assert.equal(response.statusCode, status, response.body);
  return response.json();
}

// ---- Backups above 2 GiB ---------------------------------------------------

test('backup hashing streams the file, so a database above 2 GiB can be hashed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prax-digest-'));
  try {
    const small = join(dir, 'small.bin');
    writeFileSync(small, 'The quick brown fox jumps over the lazy dog. '.repeat(50));
    const expected = createHash('sha256').update(readFileSync(small)).digest('hex');
    assert.equal(fileDigest(small), expected);
    assert.equal(fileDigest(small, { chunkBytes: 7 }), expected, 'chunk boundaries do not change the digest');

    // A sparse file just over 2 GiB: readFileSync throws ERR_FS_FILE_TOO_LARGE.
    const large = join(dir, 'large.sqlite');
    writeFileSync(large, '');
    truncateSync(large, 2 ** 31 + 1);
    assert.throws(() => readFileSync(large), { code: 'ERR_FS_FILE_TOO_LARGE' });
    assert.match(fileDigest(large), /^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Legacy supersession cycles (migration 0038) ---------------------------

test('0038 breaks supersession cycles made before 0031, keeping newer-replaces-older edges', async () => {
  const db = createDb(':memory:');
  try {
    await runMigrations(db, { logger: SILENT, through: '0030' });
    const project = (await db.query("select id from projects where slug = 'inbox'")).rows[0].id;
    const doc = async (title, createdAt) => {
      const id = randomUUID();
      await db.query(
        "insert into markdown_documents (id, title, body, document_type, project_id, created_at) values ($1, $2, 'body', 'note', $3, $4)",
        [id, title, project, createdAt],
      );
      return id;
    };
    const supersede = (source, target) => db.query(
      "insert into document_links (source_document_id, target_document_id, relation) values ($1, $2, 'supersedes')",
      [source, target],
    );
    // A two-cycle: A (older) and B (newer) supersede each other.
    const a = await doc('A', '2026-01-01T00:00:00.000Z');
    const b = await doc('B', '2026-02-01T00:00:00.000Z');
    await supersede(a, b);
    await supersede(b, a);
    // A three-cycle X > Y > Z > X, ages X < Y < Z.
    const x = await doc('X', '2026-03-01T00:00:00.000Z');
    const y = await doc('Y', '2026-03-02T00:00:00.000Z');
    const z = await doc('Z', '2026-03-03T00:00:00.000Z');
    await supersede(x, y);
    await supersede(y, z);
    await supersede(z, x);
    // An ordinary chain, even one pointing from older to newer, is left alone.
    const older = await doc('Older', '2026-04-01T00:00:00.000Z');
    const newer = await doc('Newer', '2026-04-02T00:00:00.000Z');
    await supersede(older, newer);
    const statuses = async () => Object.fromEntries((await db.query('select title, status from markdown_documents')).rows.map((r) => [r.title, r.status]));
    assert.equal((await statuses()).A, 'superseded');
    assert.equal((await statuses()).B, 'superseded');

    await runMigrations(db, { logger: SILENT });

    const edges = (await db.query(`
      select s.title as source, t.title as target from document_links l
      join markdown_documents s on s.id = l.source_document_id
      join markdown_documents t on t.id = l.target_document_id
      where l.relation = 'supersedes' order by source, target
    `)).rows.map((r) => `${r.source}>${r.target}`);
    assert.deepEqual(edges, ['B>A', 'Older>Newer', 'Z>X']);
    assert.deepEqual(await statuses(), {
      A: 'superseded', B: 'active', X: 'superseded', Y: 'active', Z: 'active', Older: 'active', Newer: 'superseded',
    });
  } finally {
    await db.close();
  }
});

// ---- Listings without embeddings -------------------------------------------

test('document listings name their columns and never read the embedding vector', async () => {
  const db = createDb(':memory:');
  try {
    await runMigrations(db, { logger: SILENT });
    const columns = (await db.query("select name from pragma_table_info('markdown_documents')")).rows.map((r) => r.name);
    assert.deepEqual([...DOCUMENT_LISTING_COLUMNS].sort(), columns.filter((c) => c !== 'embedding').sort(),
      'the listing column list follows the schema, minus the vector');

    const seen = [];
    const spy = { ...db, query: (text, values) => { seen.push(String(text)); return db.query(text, values); } };
    const repository = createLibraryRepository(spy);
    const project = (await db.query("select id from projects where slug = 'inbox'")).rows[0].id;
    await repository.createDocument({ title: 'Listed', body: 'text', documentType: 'note', projectId: project });
    await db.query("update markdown_documents set embedding = '[0.5, 0.5]'");
    seen.length = 0;
    const listed = await repository.listDocuments({});
    await repository.listActiveDocumentsForExport({});
    assert.equal(listed.length, 1);
    const listings = seen.filter((text) => /from markdown_documents d/.test(text));
    assert.equal(listings.length, 2);
    for (const text of listings) {
      assert.doesNotMatch(text, /d\.\*/);
      assert.doesNotMatch(text, /d\.embedding\b(?!_)/);
    }
  } finally {
    await db.close();
  }
});

// ---- Unicode task search ---------------------------------------------------

test('task search ignores case for non-ASCII text', async (t) => {
  const app = await testApp(t);
  for (const title of ['Été planning', 'Straße repair', 'ΣΟΦΙΑ notes', 'Plain task']) {
    await call(app, 'POST', '/api/tasks', { title, project: 'inbox', priority: 'medium', status: 'planned' }, 201);
  }
  const search = async (q) => (await call(app, 'GET', `/api/tasks?q=${encodeURIComponent(q)}`, undefined, 200)).map((task) => task.title);
  assert.deepEqual(await search('été'), ['Été planning']);
  assert.deepEqual(await search('ÉTÉ'), ['Été planning']);
  assert.deepEqual(await search('STRASSE'), ['Straße repair']);
  assert.deepEqual(await search('straße'), ['Straße repair']);
  assert.deepEqual(await search('σοφια'), ['ΣΟΦΙΑ notes']);
  assert.deepEqual(await search('PLAIN'), ['Plain task']);
});

// ---- 400 for invalid inputs ------------------------------------------------

test('document listing rejects an unknown status and accepts all', async (t) => {
  const app = await testApp(t);
  const old = await call(app, 'POST', '/api/library/documents', { title: 'Old', body: 'x', project: 'inbox', documentType: 'note' }, 201);
  const next = await call(app, 'POST', '/api/library/documents', { title: 'New', body: 'y', project: 'inbox', documentType: 'note' }, 201);
  await call(app, 'POST', `/api/library/documents/${old.id}/supersede`, { supersededBy: next.id }, 200);
  for (const status of ['Active', 'retired', '']) {
    const response = await app.inject({ method: 'GET', url: `/api/library/documents?status=${status}` });
    assert.equal(response.statusCode, 400, status);
  }
  const titles = async (query) => (await call(app, 'GET', `/api/library/documents${query}`, undefined, 200)).map((d) => d.title).sort();
  assert.deepEqual(await titles('?status=active'), ['New']);
  assert.deepEqual(await titles('?status=superseded'), ['Old']);
  assert.deepEqual(await titles('?status=all'), ['New', 'Old']);
  assert.deepEqual(await titles(''), ['New', 'Old']);
});

test('semantic-search settings reject a missing or non-boolean enabled', async (t) => {
  const app = await testApp(t);
  const before = await call(app, 'GET', '/api/settings/semantic-search', undefined, 200);
  for (const payload of [{}, { enabled: 'false' }, { enabled: 1 }, { enabled: null }, { backend: 'none', enabled: 'true' }]) {
    const response = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(await call(app, 'GET', '/api/settings/semantic-search', undefined, 200), before, 'nothing changed');
});

// ---- Assistant receipts and history ----------------------------------------

test('an assistant write receipt keeps the outcome, not the tool output', async () => {
  const db = createDb(':memory:');
  try {
    await runMigrations(db, { logger: SILENT });
    const receipts = createAssistantWriteReceipts(db);
    const full = { id: 'call-1', name: 'update_document', content: '{"body":"secret runbook body"}', isError: false };
    assert.deepEqual(await receipts.execute('approval-1', { name: 'update_document', input: { id: 'd' } }, async () => full), full);
    const stored = (await db.query("select result from assistant_write_receipts where operation_id = 'approval-1'")).rows[0].result;
    assert.doesNotMatch(stored, /secret runbook body/);
    assert.deepEqual(JSON.parse(stored), compactReceiptResult(full));
    assert.equal(compactReceiptResult({ id: 'c', name: 'n', content: 'boom', isError: true }).content, RECEIPT_NOTES.failed);
  } finally {
    await db.close();
  }
});

test('0038 compacts receipts written before it and keeps only task ids in import receipts', async () => {
  const db = createDb(':memory:');
  try {
    await runMigrations(db, { logger: SILENT, through: '0037' });
    const ok = { id: 'call-1', name: 'update_document', content: 'secret body', isError: false };
    const failed = { id: 'call-2', name: 'create_task', content: 'Tool said no', isError: true };
    await db.query("insert into assistant_write_receipts (operation_id, request_hash, status, result) values ('ok', 'h', 'completed', $1), ('failed', 'h', 'completed', $2), ('running', 'h', 'executing', null)",
      [JSON.stringify(ok), JSON.stringify(failed)]);
    const importResult = { mode: 'append', imported: 2, skipped: 0, tasks: [{ id: 't1', title: 'Secret one' }, { id: 't2', title: 'Secret two' }] };
    await db.query("insert into task_import_operations (id, project_id, mode, payload_hash, result_json) values ('op', 'p', 'append', 'h', $1), ('empty', 'p', 'append', 'h', $2)",
      [JSON.stringify(importResult), JSON.stringify({ mode: 'append', imported: 0, skipped: 3, tasks: [] })]);

    await runMigrations(db, { logger: SILENT });

    const receipts = Object.fromEntries((await db.query('select operation_id, result from assistant_write_receipts')).rows
      .map((r) => [r.operation_id, r.result === null ? null : JSON.parse(r.result)]));
    assert.deepEqual(receipts, { ok: compactReceiptResult(ok), failed: compactReceiptResult(failed), running: null });
    const ops = Object.fromEntries((await db.query('select id, result_json from task_import_operations')).rows
      .map((r) => [r.id, JSON.parse(r.result_json)]));
    assert.deepEqual(ops, {
      op: { mode: 'append', imported: 2, skipped: 0, taskIds: ['t1', 't2'] },
      empty: { mode: 'append', imported: 0, skipped: 3, taskIds: [] },
    });
  } finally {
    await db.close();
  }
});

test('assistant history is cut at a user turn and clipped content is marked', () => {
  const long = 'x'.repeat(25_000);
  const clipped = clipContent(long);
  assert.ok(clipped.length <= 20_000 && clipped.length > 19_900);
  assert.match(clipped, /\[… \d+ characters clipped\]$/);
  assert.equal(clipContent(clipped), clipped, 're-clipping echoed history is stable');
  assert.equal(clipContent('short'), 'short');

  // 134 turns of user, assistant tool call, tool result, assistant answer,
  // arranged so a plain last-120 cut would open on a tool result.
  const history = [];
  for (let i = 0; history.length < 134; i += 1) {
    history.push({ role: 'user', content: `question ${i}` });
    history.push({ role: 'assistant', content: '', toolCalls: [{ id: `c${i}`, name: 'search_tasks', input: {} }] });
    history.push({ role: 'tool', results: [{ id: `c${i}`, name: 'search_tasks', content: long }] });
    history.push({ role: 'assistant', content: `answer ${i}` });
  }
  const input = history.slice(0, 134);
  assert.equal(input.slice(-120)[0].role, 'tool', 'the naive window would open on an orphaned tool result');
  const out = sanitizeMessages(input);
  assert.equal(out[0].role, 'user');
  assert.ok(out.length <= 120);
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].role === 'tool') assert.ok(out[i - 1]?.toolCalls?.some((c) => c.id === out[i].results[0].id), 'every tool result follows its call');
  }
  const result = out.find((m) => m.role === 'tool').results[0].content;
  assert.match(result, /characters clipped\]$/);
});

// ---- Task import sessions and receipts -------------------------------------

test('an idle staged import session expires and its staged tasks are deleted', async (t) => {
  const app = await testApp(t);
  const requestId = randomUUID();
  await call(app, 'POST', '/api/tasks/import-sessions', { requestId, project: 'inbox', mode: 'append' }, 201);
  await call(app, 'PUT', `/api/tasks/import-sessions/${requestId}/chunks/0`, { tasks: [{ title: 'Staged secret' }] }, 201);
  const fresh = await call(app, 'GET', `/api/tasks/import-sessions/${requestId}`, undefined, 200);
  assert.equal(fresh.status, 'open');

  const stale = new Date(Date.now() - IMPORT_SESSION_TTL_MS - 60_000).toISOString();
  await app.db.query('update task_import_sessions set updated_at = $2 where id = $1', [requestId, stale]);
  const expired = await call(app, 'GET', `/api/tasks/import-sessions/${requestId}`, undefined, 200);
  assert.equal(expired.status, 'cancelled');
  assert.deepEqual(expired.chunks, []);
  const put = await app.inject({ method: 'PUT', url: `/api/tasks/import-sessions/${requestId}/chunks/1`, payload: { tasks: [{ title: 'Late' }] } });
  assert.equal(put.statusCode, 409);
  assert.match(put.json().message, /expired/);
  const commit = await app.inject({ method: 'POST', url: `/api/tasks/import-sessions/${requestId}/commit`, payload: { chunkCount: 1 } });
  assert.equal(commit.statusCode, 409);
  const reuse = await app.inject({ method: 'POST', url: '/api/tasks/import-sessions', payload: { requestId, project: 'inbox', mode: 'append' } });
  assert.equal(reuse.statusCode, 409, 'the requestId stays reserved');
  assert.equal((await call(app, 'GET', '/api/tasks?project=inbox', undefined, 200)).length, 0);
});

test('an import receipt keeps task ids, and a replay shows current tasks, not deleted copies', async (t) => {
  const app = await testApp(t);
  const requestId = randomUUID();
  const payload = { project: 'inbox', mode: 'append', requestId, tasks: [{ title: 'Keep me' }, { title: 'Delete me secret' }] };
  const first = await call(app, 'POST', '/api/tasks/import', payload, 201);
  assert.equal(first.tasks.length, 2);
  const stored = (await app.db.query('select result_json from task_import_operations where id = $1', [requestId])).rows[0].result_json;
  assert.doesNotMatch(stored, /Delete me secret/);

  const doomed = first.tasks.find((task) => task.title === 'Delete me secret');
  const kept = first.tasks.find((task) => task.title === 'Keep me');
  await call(app, 'DELETE', `/api/tasks/${doomed.id}`, undefined, 200);
  await call(app, 'DELETE', `/api/tasks/${doomed.id}/permanent`, undefined, 200);
  await call(app, 'PATCH', `/api/tasks/${kept.id}`, { title: 'Kept and renamed' }, 200);

  const replay = await call(app, 'POST', '/api/tasks/import', payload, 200);
  assert.equal(replay.replayed, true);
  assert.equal(replay.imported, 2, 'the original outcome is still reported');
  assert.deepEqual(replay.tasks.map((task) => task.title), ['Kept and renamed']);
});

// ---- Request body limit ----------------------------------------------------

test('a document write above the documented 1 MiB request limit is refused with 413', async (t) => {
  const app = await testApp(t);
  const response = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 'Too big', body: 'x'.repeat(1024 * 1024), project: 'inbox', documentType: 'note' },
  });
  assert.equal(response.statusCode, 413);
  const fits = await app.inject({
    method: 'POST', url: '/api/library/documents',
    payload: { title: 'Fits', body: 'x'.repeat(1000 * 1000), project: 'inbox', documentType: 'note' },
  });
  assert.equal(fits.statusCode, 201);
});
