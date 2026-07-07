import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';

// The engine swap put every repository on ONE node:sqlite handle. connect()
// hands out a session for a BEGIN…COMMIT sequence; a single FIFO gate must keep
// any direct db.query() (e.g. a fire-and-forget embedding write) from slipping
// inside an open session transaction and being committed or rolled back with it
// — the isolation the pg Pool's dedicated client used to provide.
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a direct query is gated out of an open session transaction and survives its rollback', async () => {
  const db = createDb(':memory:');
  db.exec('create table t (id integer primary key, n integer)');
  db.exec('insert into t (id, n) values (1, 0)');

  const client = await db.connect();
  await client.query('begin immediate');
  await client.query('update t set n = 1 where id = 1');

  // Issue a direct write while the transaction is still open.
  let directDone = false;
  const direct = db.query('update t set n = 99 where id = 1').then(() => { directDone = true; });

  await tick();
  await tick();
  assert.equal(directDone, false, 'direct write ran while the session transaction was still open');

  // Roll the session back — its own update is discarded. The gated direct write
  // must NOT have been caught by that rollback.
  await client.query('rollback');
  client.release();

  await direct;
  const { rows } = await db.query('select n from t where id = 1');
  assert.equal(rows[0].n, 99, 'direct write must apply after the session releases, not inside its transaction');
  await db.close();
});

test('sessions serialize: a second connect() waits for the first to release', async () => {
  const db = createDb(':memory:');
  const order = [];

  const a = await db.connect();
  const bPromise = db.connect().then((client) => { order.push('b-acquired'); return client; });

  await tick();
  assert.deepEqual(order, [], 'second session acquired while the first was still held');

  order.push('a-release');
  a.release();
  const b = await bPromise;
  assert.deepEqual(order, ['a-release', 'b-acquired']);
  b.release();
  await db.close();
});
