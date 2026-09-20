import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { restoreWorkspaceDatabase, parseRestoreArgs } from '../../scripts/restore-database.js';
import { formatFrontMatter } from '../../server/libraryExport.js';
import { buildExportedMarkdown } from '../../public/js/libraryExport.js';
import Fastify from 'fastify';
import { registerWorkspaceBackupRoutes } from '../../server/workspaceBackup.js';

function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0);
  const result = new Map(); let p = buffer.readUInt32LE(end + 16);
  const limit = p + buffer.readUInt32LE(end + 12);
  while (p < limit) {
    assert.equal(buffer.readUInt32LE(p), 0x02014b50);
    const method = buffer.readUInt16LE(p + 10), size = buffer.readUInt32LE(p + 20), names = buffer.readUInt16LE(p + 28);
    const local = buffer.readUInt32LE(p + 42), start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    result.set(buffer.subarray(p + 46, p + 46 + names).toString(), method === 0 ? data : inflateRawSync(data));
    p += 46 + names + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  return result;
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'prax-full-backup-test-'));
  const sourceFile = join(directory, 'source.db');
  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: sourceFile, EMBEDDING_BACKEND: 'none' }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (method, url, payload, status = 200, headers) => {
    const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers });
    assert.equal(response.statusCode, status, response.body); return response.json();
  };
  const create = (title, extra = {}) => call('POST', '/api/library/documents', { title, body: 'Exact content', project: 'memory', documentType: 'template', tags: ['001', 'null'], ...extra }, 201, { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' });
  return { app, call, create, directory, sourceFile };
}

test('Markdown preserves lifecycle, verification, agent, citations, task links and optional Archive', async t => {
  const { app, call, create } = await setup(t);
  const doc = await create('Current template'), old = await create('Retired template'), archived = await create('Archived template');
  await call('POST', `/api/library/documents/${doc.id}/code-refs`, { path: 'server/a.js', contentHash: 'f'.repeat(64) }, 201);
  await call('POST', `/api/library/documents/${doc.id}/external-refs`, { url: 'https://example.com/evidence', label: 'Proof' }, 201);
  await call('POST', `/api/library/documents/${doc.id}/links`, { targetId: old.id, relation: 'supersedes' }, 201);
  await call('POST', `/api/library/documents/${doc.id}/links`, { targetId: archived.id, relation: 'derived-from' }, 201);
  const task = await call('POST', '/api/tasks', { title: 'Linked task', project: 'work', priority: 'medium', status: 'planned' }, 201);
  await call('POST', `/api/tasks/${task.id}/documents`, { documentId: doc.id }, 201);
  await call('POST', `/api/library/documents/${doc.id}/verify`, { verified: true, revision: doc.revision, as: 'fixture-reviewer' });
  await call('DELETE', `/api/library/documents/${archived.id}`);
  const response = await app.inject('/api/library/export?project=all');
  const entries = zipEntries(response.rawPayload); const text = entries.get('memory/current-template.md').toString();
  assert.match(text, /prax_export_version: 3/); assert.match(text, new RegExp(doc.id));
  assert.match(text, /verified: true/); assert.match(text, /verified_by: "fixture-reviewer"/); assert.match(text, /updated_by_agent: "codex"/);
  assert.match(text, /server\/a.js/); assert.match(text, /https:\/\/example.com\/evidence/);
  assert.match(text, new RegExp(`task_ids: \\["${task.id}"\\]`));
  assert.match(text, new RegExp(`target_hash: "${archived.contentHash}"`));
  assert.match(text, /ref: memory\/archived-template.md/);
  assert.match(entries.get('memory/retired-template.md').toString(), /status: "superseded"/);
  assert.equal(entries.has('memory/archived-template.md'), false);
  const all = zipEntries((await app.inject('/api/library/export?project=all&includeArchived=true')).rawPayload);
  assert.match(all.get('memory/archived-template.md').toString(), /archived_at: "\d/);
  assert.equal((await app.inject('/api/library/export?includeArchived=maybe')).statusCode, 400);
  const single = await app.inject(`/api/library/documents/${doc.id}/export`);
  assert.match(single.body, /server\/a.js/);
});

test('workspace ZIP restores every SQLite table, starts normally, and retains Inbox replay and undo', async t => {
  const { app, call, create, directory, sourceFile } = await setup(t);
  const projects = await call('GET', '/api/projects'), work = projects.find(p => p.slug === 'work');
  await create('Preserved template');
  const retired = await create('Preserved archive'); await call('DELETE', `/api/library/documents/${retired.id}`);
  const task = await call('POST', '/api/tasks', { title: 'Inbox conversion', notes: 'Keep me', priority: 'medium', status: 'planned', project: 'inbox' }, 201);
  await call('POST', `/api/tasks/${task.id}/checklist`, { label: 'Retained check' }, 201);
  const source = await call('GET', `/api/inbox/items/task/${task.id}`);
  const payload = { operationId: randomUUID(), fingerprint: source.fingerprint, action: 'reference', projectId: work.id };
  const result = await call('POST', `/api/inbox/items/task/${task.id}/actions`, payload);
  const runbook = await create('Preserved runbook', { documentType: 'runbook', body: '- [ ] A real step' });
  await call('POST', `/api/library/documents/${runbook.id}/runs`, { id: randomUUID() }, 201);
  await app.appSettingsRepository.putSetting('backup-test-sentinel', 'saved setting');
  const response = await app.inject('/api/workspace/backup'); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  const files = zipEntries(response.rawPayload), manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.format, 'prax.workspace-backup');
  assert.equal(manifest.database.sha256, createHash('sha256').update(files.get('prax.db')).digest('hex'));
  assert.ok(files.has('RESTORE.md')); assert.ok(files.has('starter-content/agent-memory.md'));
  const backupFile = join(directory, 'extracted.db'), target = join(directory, 'restored.db');
  await writeFile(backupFile, files.get('prax.db'));
  const proof = restoreWorkspaceDatabase({ from: backupFile, to: target, sha256: manifest.database.sha256 });
  assert.equal(proof.integrityCheck, 'ok'); assert.equal((await stat(target)).mode & 0o777, 0o600);
  const a = new DatabaseSync(sourceFile, { readOnly: true }), b = new DatabaseSync(target, { readOnly: true });
  try {
    const tables = a.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all();
    for (const { name } of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      assert.deepEqual(b.prepare(`select * from ${quoted}`).all(), a.prepare(`select * from ${quoted}`).all(), `${name} preserved`);
    }
  } finally { a.close(); b.close(); }
  assert.throws(() => restoreWorkspaceDatabase({ from: backupFile, to: target, sha256: manifest.database.sha256 }), /overwrite/);
  assert.throws(() => restoreWorkspaceDatabase({ from: backupFile, to: join(directory, 'wrong.db'), sha256: '0'.repeat(64) }), /checksum/);
  await writeFile(`${backupFile}-wal`, 'unchecked data');
  assert.throws(() => restoreWorkspaceDatabase({ from: backupFile, to: join(directory, 'sidecar.db'), sha256: manifest.database.sha256 }), /sidecars/);
  await rm(`${backupFile}-wal`);
  const restored = await buildApp({ config: loadConfig({ PRAX_DB_FILE: target, EMBEDDING_BACKEND: 'none' }) });
  try {
    assert.equal((await restored.inject('/readyz')).statusCode, 200);
    const replay = await restored.inject({ method: 'POST', url: `/api/inbox/items/task/${task.id}/actions`, payload });
    assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.equal(replay.json().created[0].id, result.created[0].id);
    const undo = await restored.inject({ method: 'POST', url: `/api/inbox/actions/${payload.operationId}/undo`, payload: {} });
    assert.equal(undo.statusCode, 200); assert.equal(undo.json().record.archivedAt, null);
  } finally { await restored.close(); }
});

test('database snapshot waits for transaction completion and blocks interleaved writes', async t => {
  const { app, directory } = await setup(t);
  const client = await app.db.connect(); await client.query('begin immediate');
  await client.query("update projects set name = 'Committed together' where slug = 'work'");
  let finished = false;
  const snapshot = app.db.snapshot(join(directory, 'coherent.db')).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(finished, false);
  await client.query('commit'); client.release(); await snapshot;
  const db = new DatabaseSync(join(directory, 'coherent.db'));
  try { assert.equal(db.prepare("select name from projects where slug='work'").get().name, 'Committed together'); }
  finally { db.close(); }
});

test('backup and restore CLIs invoked through symlinks perform the operation and report its result', async t => {
  const { directory, sourceFile, create } = await setup(t);
  const doc = await create('Symlink command sentinel');
  const backupCli = join(directory, 'backup-alias.js'), restoreCli = join(directory, 'restore-alias.js');
  await symlink(fileURLToPath(new URL('../../scripts/backup-database.js', import.meta.url)), backupCli);
  await symlink(fileURLToPath(new URL('../../scripts/restore-database.js', import.meta.url)), restoreCli);
  const backupFile = join(directory, 'command-backup.db'), target = join(directory, 'command-restored.db');
  const report = JSON.parse(execFileSync(process.execPath, [backupCli, '--output', backupFile], { encoding: 'utf8', env: { ...process.env, PRAX_DB_FILE: sourceFile } }));
  assert.equal(report.integrityCheck, 'ok');
  const restored = JSON.parse(execFileSync(process.execPath, [restoreCli, '--from', backupFile, '--to', target, '--sha256', report.sha256], { encoding: 'utf8' }));
  assert.equal(restored.integrityCheck, 'ok');
  const db = new DatabaseSync(target);
  try { assert.equal(db.prepare('select title from markdown_documents where id = ?').get(doc.id).title, doc.title); }
  finally { db.close(); }
});

test('backup rejects overlap, reports failure honestly and releases its slot for retry', async t => {
  const app = Fastify(); t.after(() => app.close());
  registerWorkspaceBackupRoutes(app);
  assert.equal((await app.inject('/api/workspace/backup')).statusCode, 503);
  let enter, rejectSnapshot;
  const entered = new Promise(resolve => { enter = resolve; });
  app.db = { snapshot: () => { enter(); return new Promise((resolve, reject) => { rejectSnapshot = reject; }); } };
  const first = app.inject('/api/workspace/backup'); await entered;
  assert.equal((await app.inject('/api/workspace/backup')).statusCode, 409);
  rejectSnapshot(new Error('fixture disk full'));
  const failed = await first; assert.equal(failed.statusCode, 500);
  assert.match(failed.json().message, /Nothing was changed/);
  app.db.snapshot = async () => { throw new Error('still full'); };
  assert.equal((await app.inject('/api/workspace/backup')).statusCode, 500, 'retry reaches snapshot rather than remaining busy');
});

test('disconnect during snapshot waits for the writer then removes its temporary files', async t => {
  const { app } = await setup(t);
  let handler, releaseWriter, reachedWriter, snapshotDirectory;
  const started = new Promise(resolve => { reachedWriter = resolve; });
  const proceed = new Promise(resolve => { releaseWriter = resolve; });
  registerWorkspaceBackupRoutes({
    get(path, fn) { handler = fn; },
    db: { async snapshot(path) {
      snapshotDirectory = dirname(path); reachedWriter(); await proceed; return app.db.snapshot(path);
    } },
  });
  let hijacked = false;
  const reply = { raw: new EventEmitter(), hijack() { hijacked = true; return this; } };
  const operation = handler({ log: { error() {} } }, reply);
  await started; reply.raw.emit('close');
  assert.ok((await stat(snapshotDirectory)).isDirectory(), 'writer retains its directory until settled');
  releaseWriter(); await operation;
  assert.equal(hijacked, true);
  await assert.rejects(stat(snapshotDirectory), { code: 'ENOENT' });
});

test('shared Markdown serializer quotes YAML typed scalars; restore rejects malformed arguments and corrupt input', async t => {
  const doc = { id: randomUUID(), title: '[unsafe scalar]', tags: ['001', 'null', '@alias'], body: 'Body' };
  assert.match(formatFrontMatter(doc, 'work'), /title: "\[unsafe scalar\]"/);
  assert.match(formatFrontMatter(doc, 'work'), /- "001"/);
  assert.equal(buildExportedMarkdown(doc, 'work'), formatFrontMatter(doc, 'work') + '\nBody\n');
  assert.throws(() => parseRestoreArgs(['--to']), /Usage/);
  assert.throws(() => restoreWorkspaceDatabase({ from: 'a', to: 'b' }), /sha256/);
  const directory = await mkdtemp(join(tmpdir(), 'prax-corrupt-backup-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'bad.db'); await writeFile(file, 'invalid SQLite');
  assert.throws(() => restoreWorkspaceDatabase({ from: file, to: join(directory, 'target.db'), sha256: 'f'.repeat(64) }), /Invalid SQLite backup/);
});
