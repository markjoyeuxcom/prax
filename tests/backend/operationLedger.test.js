import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import {
  GONE,
  LEDGER_KINDS,
  NOW,
  canonicalIntentHash,
  claimReceipt,
  createInFlightOperations,
  creationIntentHash,
  intentHash,
  judgeReceipt,
  readReceipt,
  recordReceipt,
  runOnceInTransaction,
  updateReceipt,
  withOperationTransaction,
} from '../../server/operationLedger.js';

const SILENT = { info() {}, error() {} };
const sha = (text) => createHash('sha256').update(text).digest('hex');

async function migrated() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  return db;
}

test('every ledger kind names an existing receipt table and its key, hash and outcome columns', async () => {
  const db = await migrated();
  try {
    for (const [kind, descriptor] of Object.entries(LEDGER_KINDS)) {
      const columns = (await db.query(`select name from pragma_table_info('${descriptor.table}')`)).rows.map((row) => row.name);
      assert.ok(columns.length, `${kind}: ${descriptor.table} exists`);
      for (const column of [...descriptor.key, descriptor.hash, ...(descriptor.mutable || []), ...(descriptor.columns || []),
        ...(descriptor.scope ? [descriptor.scope] : []), ...(descriptor.project ? [descriptor.project] : [])]) {
        assert.ok(columns.includes(column), `${kind}: ${descriptor.table}.${column}`);
      }
    }
  } finally { await db.close(); }
});

test('intent hashes keep the exact digests stored receipts were written with', () => {
  // Existing receipts across an upgrade must still match their retries.
  assert.equal(intentHash(['a', 1, null]), sha('["a",1,null]'));
  assert.equal(intentHash({ kind: 'task', id: 'x', action: 'file' }), sha('{"kind":"task","id":"x","action":"file"}'));
  assert.equal(creationIntentHash('task', 'id-1', ['Title', null]), sha('["create-task","id-1","Title",null]'));
  assert.equal(canonicalIntentHash({ name: 'n', input: { b: 1, a: [{ d: 1, c: 2 }] } }), sha('{"input":{"a":[{"c":2,"d":1}],"b":1},"name":"n"}'));
});

test('runOnce: first arrival records, same intent replays, other intent conflicts, deleted result is gone', async () => {
  const db = await migrated();
  try {
    let executions = 0;
    const spec = (hash, current = 'doc-1') => ({
      kind: 'document-update',
      key: 'op-1',
      intentHash: hash,
      conflict: (receipt) => ({ conflict: true, stored: receipt.intent_hash }),
      replay: (receipt) => (receipt.document_id === current ? { replayed: receipt.document_id } : GONE),
      async execute({ record }) { executions += 1; await record({ document_id: 'doc-1' }); return { created: true }; },
    });
    assert.deepEqual(await runOnceInTransaction(db, spec('h1')), { created: true });
    assert.deepEqual(await runOnceInTransaction(db, spec('h1')), { replayed: 'doc-1' });
    assert.deepEqual(await runOnceInTransaction(db, spec('h2')), { conflict: true, stored: 'h1' });
    assert.deepEqual(await runOnceInTransaction(db, spec('h1', 'deleted')), { gone: true });
    assert.equal(executions, 1);
    assert.equal(judgeReceipt('document-update', null, 'h1'), 'new');
  } finally { await db.close(); }
});

test('a failed operation leaves neither its work nor its receipt', async () => {
  const db = await migrated();
  try {
    await assert.rejects(() => runOnceInTransaction(db, {
      kind: 'document-upsert',
      key: 'op-fails',
      intentHash: 'h',
      conflict: () => assert.fail('no receipt yet'),
      replay: () => assert.fail('no receipt yet'),
      async execute({ q, record }) {
        await q.query("insert into app_settings (key, value) values ('ledger-probe', 'x')");
        await record({ document_id: 'doc' });
        throw new Error('work failed after recording');
      },
    }), /work failed/);
    assert.equal(await readReceipt(db, 'document-upsert', 'op-fails'), null);
    assert.equal((await db.query("select count(*) as n from app_settings where key = 'ledger-probe'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('claim, settle and composite keys', async () => {
  const db = await migrated();
  try {
    assert.deepEqual(await claimReceipt(db, 'assistant-write', 'approval', 'h', { status: 'executing' }), { claimed: true });
    const again = await claimReceipt(db, 'assistant-write', 'approval', 'h', { status: 'executing' });
    assert.equal(again.claimed, false); assert.equal(again.state, 'replay'); assert.equal(again.receipt.status, 'executing');
    assert.equal((await claimReceipt(db, 'assistant-write', 'approval', 'other', { status: 'executing' })).state, 'conflict');
    await updateReceipt(db, 'assistant-write', 'approval', { status: 'completed', result: '{}' });
    assert.equal((await readReceipt(db, 'assistant-write', 'approval')).status, 'completed');
    await assert.rejects(() => updateReceipt(db, 'assistant-write', 'approval', { request_hash: 'x' }), /no writable column request_hash/);

    await withOperationTransaction(db, (q) => recordReceipt(q, 'record-creation', ['task', 'task-1'], 'h'));
    assert.equal((await readReceipt(db, 'record-creation', ['task', 'task-1'])).intent_hash, 'h');
    assert.equal(await readReceipt(db, 'record-creation', ['checklist-item', 'task-1']), null);
    await assert.rejects(() => readReceipt(db, 'record-creation', 'task-1'), /needs record_kind, record_id/);

    await recordReceipt(db, 'inbox-action', 'inbox-op', 'h', {
      item_kind: 'task', item_id: 't', action: 'archive', before_fields: '{}', after_fingerprint: 'f',
    });
    await updateReceipt(db, 'inbox-action', 'inbox-op', { undone_at: NOW });
    assert.match((await readReceipt(db, 'inbox-action', 'inbox-op')).undone_at, /^\d{4}-\d\d-\d\dT/);
    await assert.rejects(() => recordReceipt(db, 'document-generation', 'doc', 'h'), /written by the record insert/);
    await assert.rejects(() => readReceipt(db, 'no-such-kind', 'x'), /Unknown operation ledger kind/);
  } finally { await db.close(); }
});

test('in-flight operations: one leader, followers share its outcome, a different intent conflicts', async () => {
  const registry = createInFlightOperations();
  const leader = registry.claim('op', 'h');
  assert.equal(leader.leader, true);
  const follower = registry.claim('op', 'h');
  assert.equal(follower.leader, false); assert.equal(follower.conflict, false);
  assert.equal(registry.claim('op', 'other').conflict, true);
  leader.resolve({ code: 201 });
  assert.deepEqual(await follower.outcome, { code: 201 });
  assert.equal(registry.has('op'), false, 'settling releases the key');
  assert.equal(registry.claim('op', 'h').leader, true, 'a later arrival leads again (the durable receipt answers it)');

  const failing = createInFlightOperations();
  const first = failing.claim('x', 'h');
  const waiting = failing.claim('x', 'h');
  first.reject(new Error('lost'));
  await assert.rejects(waiting.outcome, /lost/);
  const lonely = failing.claim('y', 'h');
  lonely.reject(new Error('nobody waits')); // must not be an unhandled rejection
  await new Promise((resolve) => setImmediate(resolve));
});

// Receipt tables are reached only through the ledger, so every retry path
// shares one lookup/claim/replay/conflict/gone implementation.
test('no server module other than the ledger reads or writes a receipt table directly', () => {
  const root = fileURLToPath(new URL('../../server/', import.meta.url));
  const receiptTables = Object.values(LEDGER_KINDS).map((descriptor) => descriptor.table).filter((table) => table !== 'markdown_documents');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'migrations') walk(path); } else if (name.endsWith('.js')) files.push(path);
    }
  };
  walk(root);
  const offenders = [];
  for (const file of files) {
    if (file.endsWith('operationLedger.js')) continue;
    const text = readFileSync(file, 'utf8');
    for (const table of receiptTables) {
      if (new RegExp(`\\b(from|into|update|join)\\s+${table}\\b`, 'i').test(text)) offenders.push(`${file.slice(root.length)}: ${table}`);
    }
    if (/creation_operation\s*,\s*creation_intent_hash\s+from/i.test(text)) offenders.push(`${file.slice(root.length)}: generation receipt`);
  }
  assert.deepEqual(offenders, []);
});
