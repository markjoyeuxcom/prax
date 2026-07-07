import { DatabaseSync } from 'node:sqlite';
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

  function query(text, params = []) {
    const { sql, bound } = rewritePlaceholders(text, params);
    try {
      const statement = db.prepare(sql);
      // .all() executes any statement and returns rows when the statement
      // produces them ([] for plain writes), so one path serves both.
      const rows = statement.all(...bound);
      return Promise.resolve({ rows });
    } catch (err) {
      // Reject (not throw) so both `await query(...)` and `query(...).catch(...)`
      // observe the failure — a synchronous throw slips past a `.catch` attached
      // to the returned value (the rollback swallow in replaceProjectTasks and
      // the migration runner rely on that `.catch`).
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

  // Serialized session checkout — one BEGIN…COMMIT sequence at a time.
  let sessionQueue = Promise.resolve();

  function connect() {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const acquired = sessionQueue.then(() => ({
      query,
      release: () => release(),
    }));
    sessionQueue = sessionQueue.then(() => held);
    return acquired;
  }

  return {
    query,
    connect,
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
