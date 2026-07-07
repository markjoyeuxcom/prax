import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';

// A real constraint violation must surface the pg SQLSTATE the routes and
// repositories branch on (23505 unique_violation, 23503 foreign_key_violation).
// node:sqlite tags every error with code 'ERR_SQLITE_ERROR', so db.js has to
// remap from errcode/message — the earlier `err.code === undefined` guard never
// fired and left those contracts (e.g. DELETE project → 409) broken.
function freshDb() {
  const db = createDb(':memory:');
  db.exec(`
    create table parent (id integer primary key, name text unique);
    create table child (id integer primary key, parent_id integer references parent(id));
    insert into parent (id, name) values (1, 'a');
  `);
  return db;
}

test('query() rejects a UNIQUE violation with SQLSTATE 23505', async () => {
  const db = freshDb();
  await assert.rejects(
    () => db.query('insert into parent (id, name) values ($1, $2)', [2, 'a']),
    (err) => err.code === '23505',
  );
  await db.close();
});

test('query() rejects a FOREIGN KEY violation with SQLSTATE 23503', async () => {
  const db = freshDb();
  await assert.rejects(
    () => db.query('insert into child (id, parent_id) values ($1, $2)', [1, 999]),
    (err) => err.code === '23503',
  );
  await db.close();
});

test('query() returns a rejected promise (not a synchronous throw) on failure', async () => {
  const db = freshDb();
  // If query() threw synchronously, .catch() would never attach — the two
  // rollback-swallow sites (replaceProjectTasks, migration runner) rely on it.
  let caught = null;
  const result = db
    .query('insert into parent (id, name) values ($1, $2)', [3, 'a'])
    .catch((err) => { caught = err; return 'handled'; });
  assert.ok(result instanceof Promise);
  assert.equal(await result, 'handled');
  assert.equal(caught.code, '23505');
  await db.close();
});

test('normalizeError leaves an error that already carries a SQLSTATE untouched', async () => {
  // A non-constraint failure keeps whatever code it had (no accidental remap).
  const db = freshDb();
  await assert.rejects(
    () => db.query('select * from no_such_table'),
    (err) => err.code !== '23505' && err.code !== '23503',
  );
  await db.close();
});
