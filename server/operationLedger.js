import { createHash } from 'node:crypto';

// The operation ledger: one server-side API for retry identity.
//
// A caller-supplied operation id (an operationId, a requestId, an approval id,
// or the id of the record being created) names one intent. The first request
// claims the id with a hash of that intent, in the same transaction as the
// work it guards, so the work and its receipt commit together or not at all.
// Every later request with the same id is then judged by the receipt, never by
// the current content of the record:
//
//   replay    same id, same intent: return what the operation produced, as it
//             is now, without doing the work again
//   conflict  same id, different intent: refuse; an id is never reused
//   gone      same id, same intent, but the record it produced was permanently
//             deleted since: refuse rather than recreate it
//   in flight same id while the first request is still running in this
//             process: wait for its outcome (createInFlightOperations)
//
// Receipts outlive the records they describe (no foreign keys), survive
// restart and SQLite backup/restore, and are runtime metadata that portable
// export never carries.
//
// Storage: each receipt kind keeps the table it has always had (migrations
// 0014, 0015, 0025, 0027, 0031, 0033, 0034). The kinds carry different outcome
// payloads (an Inbox receipt holds undo state, an import receipt its counts, an
// approval receipt its execution status), so they stay separate tables behind
// this one module rather than one table with an untyped payload column. That
// needs no data migration: a retry in flight across an upgrade finds its
// receipt exactly where it was written, and backups keep their shape.
export const LEDGER_KINDS = Object.freeze({
  // Upsert-by-title ("remember") and receipt-backed document create
  // (POST /api/library/documents with operationId) share one id space.
  'document-upsert': { table: 'document_upsert_receipts', key: ['operation_id'], hash: 'intent_hash' },
  // Document updates carrying an operationId.
  'document-update': { table: 'document_update_receipts', key: ['operation_id'], hash: 'intent_hash' },
  // Inbox decisions; undone_at is the only field that changes after commit.
  'inbox-action': { table: 'inbox_action_receipts', key: ['operation_id'], hash: 'intent_hash', mutable: ['undone_at'] },
  // Direct and chunked-session task imports, keyed by requestId. The only
  // kind removed with its project (projectsRepository).
  'task-import': { table: 'task_import_operations', key: ['id'], hash: 'payload_hash', project: 'project_id' },
  // Assistant approvals: claimed as 'executing' before the tool runs and
  // settled to 'completed' after, outside any transaction (the tool handlers
  // need the database themselves).
  'assistant-write': { table: 'assistant_write_receipts', key: ['operation_id'], hash: 'request_hash', mutable: ['status', 'result'] },
  // Caller-identified creates of a task, checklist item or document (by ID).
  'record-creation': { table: 'record_creation_receipts', key: ['record_kind', 'record_id'], hash: 'intent_hash' },
  // Generated documents (post-mortem, runbook): the receipt is the pair of
  // creation columns the document insert itself writes, so the insert is the
  // claim and nothing is recorded separately. It does not outlive the row.
  'document-generation': {
    table: 'markdown_documents', key: ['id'], hash: 'creation_intent_hash', scope: 'creation_operation',
    columns: ['creation_operation', 'creation_intent_hash'], recordedWithRow: true,
  },
});

// Returned by a `replay` callback when the record its receipt points to no
// longer exists.
export const GONE = Symbol('operation-ledger-gone');

// A column value meaning the database's current timestamp.
export const NOW = Symbol('operation-ledger-now');
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function kindOf(kind) {
  const descriptor = LEDGER_KINDS[kind];
  if (!descriptor) throw new Error(`Unknown operation ledger kind: ${kind}`);
  return descriptor;
}

function keyValues(descriptor, key) {
  const values = Array.isArray(key) ? key : [key];
  if (values.length !== descriptor.key.length || values.some((value) => value === undefined || value === null || value === '')) {
    throw new Error(`Operation ledger key for ${descriptor.table} needs ${descriptor.key.join(', ')}`);
  }
  return values;
}

function keyClause(descriptor) {
  return descriptor.key.map((column, index) => `${column} = $${index + 1}`).join(' and ');
}

// sha256 over the JSON of `value`, as every receipt kind has always hashed its
// intent: arrays and objects keep their order. Stored receipts hold these
// digests, so the serialization must never change.
export function intentHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

// The same with object keys sorted first (assistant approvals, whose tool
// input arrives from a model in no fixed key order).
export function canonicalIntentHash(value) {
  return intentHash(canonical(value));
}

// The intent of a caller-identified create, domain-separated per record kind.
export function creationIntentHash(recordKind, id, fields) {
  return intentHash([`create-${recordKind}`, id, ...fields]);
}

// Run `work(q)` in one `begin immediate` session, so a receipt lookup, the
// work and the receipt write commit together; two racing requests with the
// same id serialize on the write lock and the second sees the first's receipt.
// A connectionless test double runs the work directly.
export async function withOperationTransaction(db, work) {
  if (typeof db.connect !== 'function') return work(db);
  const client = await db.connect();
  try {
    await client.query('begin immediate');
    try {
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
}

// The statement reading the stored receipt for `key`.
export function buildReadReceipt(kind, key) {
  const descriptor = kindOf(kind);
  const columns = descriptor.columns ? descriptor.columns.join(', ') : '*';
  return {
    text: `select ${columns} from ${descriptor.table} where ${keyClause(descriptor)} limit 1`,
    values: keyValues(descriptor, key),
  };
}

// The stored receipt row for `key`, or null.
export async function readReceipt(q, kind, key) {
  const statement = buildReadReceipt(kind, key);
  const result = await q.query(statement.text, statement.values);
  return result.rows[0] || null;
}

// How a stored receipt answers a request with `hash` (and, for a kind scoped
// by operation name, `scope`): 'new' when there is no receipt, 'replay' when
// the intent matches, otherwise 'conflict'.
export function judgeReceipt(kind, receipt, hash, scope) {
  const descriptor = kindOf(kind);
  if (!receipt) return 'new';
  if (receipt[descriptor.hash] !== hash) return 'conflict';
  if (descriptor.scope && receipt[descriptor.scope] !== scope) return 'conflict';
  return 'replay';
}

// Column assignments for `fields`, restricted to `allowed`. NOW becomes the
// database clock; every other value is bound after the first `offset` params.
function assignments(descriptor, fields, allowed, offset) {
  const columns = [];
  const expressions = [];
  const values = [];
  for (const [column, value] of Object.entries(fields)) {
    if (!allowed.includes(column)) throw new Error(`Operation ledger ${descriptor.table} has no writable column ${column}`);
    columns.push(column);
    if (value === NOW) expressions.push(NOW_SQL);
    else { values.push(value); expressions.push(`$${offset + values.length}`); }
  }
  return { columns, expressions, values };
}

function insertStatement(descriptor, key, hash, fields, { claim = false } = {}) {
  if (descriptor.recordedWithRow) throw new Error(`${descriptor.table} receipts are written by the record insert itself`);
  const base = [...keyValues(descriptor, key), hash];
  const extra = assignments(descriptor, fields, Object.keys(fields), base.length);
  const columns = [...descriptor.key, descriptor.hash, ...extra.columns];
  const placeholders = [...base.map((_, index) => `$${index + 1}`), ...extra.expressions];
  return {
    text: `insert into ${descriptor.table} (${columns.join(', ')}) values (${placeholders.join(', ')})`
      + (claim ? ` on conflict (${descriptor.key.join(', ')}) do nothing returning ${descriptor.key[0]}` : ''),
    values: [...base, ...extra.values],
  };
}

// Write the receipt of a committed operation, inside its transaction.
// `fields` holds the kind's outcome columns.
export async function recordReceipt(q, kind, key, hash, fields = {}) {
  const statement = insertStatement(kindOf(kind), key, hash, fields);
  await q.query(statement.text, statement.values);
}

// Claim `key` before doing the work, for operations that cannot hold a
// transaction open while they run. Returns { claimed: true } for the first
// caller, otherwise { claimed: false, state: 'replay' | 'conflict', receipt }.
export async function claimReceipt(q, kind, key, hash, fields = {}) {
  const statement = insertStatement(kindOf(kind), key, hash, fields, { claim: true });
  const inserted = await q.query(statement.text, statement.values);
  if (inserted.rows.length) return { claimed: true };
  const receipt = await readReceipt(q, kind, key);
  return { claimed: false, state: judgeReceipt(kind, receipt, hash), receipt };
}

// Change the columns a kind allows to change after commit (an Inbox undo, an
// approval's completion).
export async function updateReceipt(q, kind, key, fields) {
  const descriptor = kindOf(kind);
  const keys = keyValues(descriptor, key);
  const { columns, expressions, values } = assignments(descriptor, fields, descriptor.mutable || [], keys.length);
  if (!columns.length) throw new Error('updateReceipt needs at least one column');
  const set = columns.map((column, index) => `${column} = ${expressions[index]}`).join(', ');
  await q.query(`update ${descriptor.table} set ${set} where ${keyClause(descriptor)}`, [...keys, ...values]);
}

// The statement removing a kind's receipts that belong to a deleted project.
export function buildForgetProjectReceipts(kind, projectId) {
  const descriptor = kindOf(kind);
  if (!descriptor.project) throw new Error(`${descriptor.table} receipts do not belong to a project`);
  return { text: `delete from ${descriptor.table} where ${descriptor.project} = $1`, values: [projectId] };
}

// The exact-once flow on `q`, which is already inside the caller's
// transaction (withOperationTransaction):
//
//   conflict(receipt, q)     the id belongs to another intent
//   replay(receipt, q)       the same intent committed before: return its
//                            current result, or GONE when its record is gone
//   gone(receipt, q)         called for GONE; defaults to { gone: true }
//   execute({ q, record })   first arrival: do the work on `q`, and call
//                            record(fields) to write the receipt once the work
//                            produced something to replay
//
// Each callback returns the operation's result or throws.
export async function runOnce(q, { kind, key, intentHash: hash, scope, conflict, replay, gone, execute }) {
  const receipt = await readReceipt(q, kind, key);
  const state = judgeReceipt(kind, receipt, hash, scope);
  if (state === 'conflict') return conflict(receipt, q);
  if (state === 'replay') {
    const result = await replay(receipt, q);
    if (result !== GONE) return result;
    return gone ? gone(receipt, q) : { gone: true };
  }
  let recorded = false;
  return execute({
    q,
    async record(fields = {}) {
      if (recorded) throw new Error('An operation receipt is recorded once');
      recorded = true;
      await recordReceipt(q, kind, key, hash, fields);
    },
  });
}

// runOnce in its own `begin immediate` transaction.
export function runOnceInTransaction(db, spec) {
  return withOperationTransaction(db, (q) => runOnce(q, spec));
}

// A caller-identified create judged by its record-creation receipt. The lookup,
// the insert and the receipt commit together, so two racing identical requests
// create once. Outcomes:
//   { row, created: true }                   first commit
//   { row, created: false, replayed: true }  receipt matches; row is the CURRENT record
//   { gone: true }                           receipt matches; the record was permanently deleted
//   { conflict: true }                       the ID was already used for a different intent
//   { row | null, created: false }           no receipt: a pre-0034 row, or an ID another path
//                                            created. The caller compares content as before.
//   { refused }                              beforeInsert declined (e.g. a capacity limit)
// `load(q)` returns the raw row for the ID or null; `insert(q)` returns the
// inserted raw row, or null when the ID already exists.
export function createRecordOnce(db, { recordKind, id, intentHash: hash, load, insert, beforeInsert }) {
  return runOnceInTransaction(db, {
    kind: 'record-creation',
    key: [recordKind, id],
    intentHash: hash,
    conflict: () => ({ conflict: true }),
    replay: async (_receipt, q) => {
      const row = await load(q);
      return row ? { row, created: false, replayed: true } : GONE;
    },
    execute: async ({ q, record }) => {
      // An existing row outranks beforeInsert: replaying the create that
      // filled a capacity limit must not be refused by that limit.
      const existing = await load(q);
      if (existing) return { row: existing, created: false };
      const refused = beforeInsert ? await beforeInsert(q) : null;
      if (refused) return { refused };
      const row = await insert(q);
      if (!row) return { row: await load(q), created: false };
      await record();
      return { row, created: true };
    },
  });
}

// Per-process registry of operations still running. A durable receipt is only
// written when an operation commits, and some operations run for a long time
// outside any transaction (a model generating a document, an approved tool).
// A retry arriving meanwhile must wait for that run instead of finding no
// receipt and starting a second one. SQLite is embedded and one process owns
// it, so this registry is the whole server's view. A claim is synchronous, so
// two arrivals can never both lead.
export function createInFlightOperations() {
  const entries = new Map();
  return {
    // { leader: true, resolve, reject } for the first caller; while it runs,
    // { leader: false, conflict, outcome } for everyone else. The leader must
    // settle its claim exactly once, which also releases the key.
    claim(key, hash) {
      const existing = entries.get(key);
      if (existing) return { leader: false, conflict: existing.hash !== hash, outcome: existing.outcome };
      let settle;
      let fail;
      const outcome = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
      // A leader that fails with no follower waiting is not an unhandled
      // rejection; a follower still observes the failure.
      outcome.catch(() => {});
      const entry = { hash, outcome };
      entries.set(key, entry);
      const release = () => { if (entries.get(key) === entry) entries.delete(key); };
      return {
        leader: true,
        resolve(value) { release(); settle(value); },
        reject(error) { release(); fail(error); },
      };
    },
    has(key) { return entries.has(key); },
  };
}
