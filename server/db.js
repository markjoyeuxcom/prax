import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Embedded-SQLite adapter with the same public shape the pg Pool wrapper had:
// query(text, params) → { rows }, connect() → client { query, release },
// checkReady(), close(). Repositories keep their $N placeholders — they are
// rewritten to positional '?' binds here (repeats and gaps handled).
//
// node:sqlite runs in-process and synchronously; "connections" are sessions on
// the one database handle. connect() hands out a serialized session (a simple
// promise mutex) so BEGIN/COMMIT sequences never interleave across concurrent
// requests, preserving the dedicated-client semantics callers relied on.

function coerceParam(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

// '$2 … $1 … $1' → '? … ? … ?' with params reordered (and repeated) to match.
function rewritePlaceholders(text, params) {
  const ordered = [];
  const sql = String(text).replace(/\$(\d+)/g, (_match, n) => {
    ordered.push(coerceParam(params[Number(n) - 1]));
    return '?';
  });
  if (!ordered.length && params.length) {
    // '?' placeholders were used directly — bind positionally.
    return { sql, bound: params.map(coerceParam) };
  }
  return { sql, bound: ordered };
}

export function createDb(databaseFile) {
  const file = databaseFile || ':memory:';
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  // Run one statement on the raw handle. Rejects (never throws synchronously)
  // so both `await query(...)` and `query(...).catch(...)` observe failures —
  // the rollback swallow in replaceProjectTasks and the migration runner rely
  // on that `.catch`.
  function runStatement(text, params = []) {
    try {
      const { sql, bound } = rewritePlaceholders(text, params);
      const statement = db.prepare(sql);
      // .all() executes any statement and returns rows when the statement
      // produces them ([] for plain writes), so one path serves both.
      return Promise.resolve({ rows: statement.all(...bound) });
    } catch (err) {
      return Promise.reject(normalizeError(err));
    }
  }

  // Constraint errors keep the pg SQLSTATE codes the routes/repositories
  // already branch on (23505 unique_violation, 23503 foreign_key_violation),
  // so those contracts — and their tests — survive the engine swap.
  function normalizeError(err) {
    if (!err) return err;
    // node:sqlite tags every error with code 'ERR_SQLITE_ERROR' (never
    // undefined), so key the mapping off errcode/message — not err.code — and
    // stamp the pg SQLSTATE the routes/repositories already branch on. An error
    // that already carries a SQLSTATE (e.g. a test double) is left untouched.
    if (err.code === '23505' || err.code === '23503') return err;
    const message = String(err.message || '');
    if (err.errcode === 2067 || /UNIQUE constraint failed/i.test(message)) {
      err.code = '23505';
    } else if (err.errcode === 787 || /FOREIGN KEY constraint failed/i.test(message)) {
      err.code = '23503';
    }
    return err;
  }

  // A single FIFO gate serializes handle access. node:sqlite is synchronous, so
  // a lone statement is already atomic — but a checked-out session's BEGIN…COMMIT
  // awaits between statements, and without a gate a direct query() (e.g. a
  // fire-and-forget embedding write) could slip inside that transaction and be
  // committed or rolled back with it. The gate is held for a session's entire
  // lifetime, restoring the dedicated-client isolation the pg Pool provided.
  let gate = Promise.resolve();

  // Top-level query: waits behind any in-progress session (and prior queries)
  // so it can never execute inside another caller's open transaction.
  function query(text, params = []) {
    const result = gate.then(() => runStatement(text, params));
    // Keep the queue alive regardless of this query's outcome; the caller sees
    // the real result/error via `result`.
    gate = result.then(() => {}, () => {});
    return result;
  }

  function connect() {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    // Acquire the gate and hold it until release(), so the whole BEGIN…COMMIT
    // owns the handle exclusively. The session's own query() runs the statement
    // directly — it already holds the gate, and re-gating would deadlock (and is
    // why db.exec() stays an ungated passthrough: the migration runner calls it
    // on the raw handle inside its session transaction).
    const acquired = gate.then(() => ({
      query: (text, params = []) => runStatement(text, params),
      release: () => release(),
    }));
    gate = gate.then(() => held);
    return acquired;
  }

  return {
    query,
    connect,
    async snapshot(destination) {
      // Wait for a complete transaction and hold the same FIFO gate while
      // SQLite copies this handle, including :memory: databases and WAL data.
      const client = await connect();
      try { return await backup(db, destination); }
      finally { client.release(); }
    },
    async checkReady() {
      db.prepare('select 1').get();
      return true;
    },
    close: () => {
      db.close();
      return Promise.resolve();
    },
    // Escape hatch for code that benefits from the synchronous handle
    // (multi-statement exec in the migration runner).
    exec: (sql) => db.exec(sql),
  };
}
