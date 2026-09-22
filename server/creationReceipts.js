import { createHash } from 'node:crypto';

// Durable receipts for caller-identified creates (migration 0034). The caller's
// record ID is the operation identity; the hash covers the normalised create
// intent, domain-separated per record kind.
export function creationIntentHash(kind, id, fields) {
  return createHash('sha256').update(JSON.stringify([`create-${kind}`, id, ...fields])).digest('hex');
}

// Runs one caller-identified create in a single `begin immediate` transaction:
// the receipt lookup, the insert and the receipt write commit together, so two
// racing identical requests create once. Outcomes:
//   { row, created: true }                   first commit
//   { row, created: false, replayed: true }  receipt matches; row is the CURRENT record
//   { gone: true }                           receipt matches; the record was permanently deleted
//   { conflict: true }                       the ID was already used for a different intent
//   { row | null, created: false }           no receipt: a pre-0034 row, or an ID another path
//                                            created. The caller compares content as before.
//   { refused }                              beforeInsert declined (e.g. a capacity limit)
// `load(client)` returns the raw row for the ID or null; `insert(client)` returns
// the inserted raw row, or null when the ID already exists.
export async function createWithReceipt(db, { kind, id, intentHash, load, insert, beforeInsert }) {
  const client = await db.connect();
  try {
    await client.query('begin immediate');
    try {
      let result;
      const receipt = await client.query(
        'select intent_hash from record_creation_receipts where record_kind = $1 and record_id = $2',
        [kind, id],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].intent_hash !== intentHash) result = { conflict: true };
        else {
          const row = await load(client);
          result = row ? { row, created: false, replayed: true } : { gone: true };
        }
      } else {
        // An existing row outranks beforeInsert: replaying the create that
        // filled a capacity limit must not be refused by that limit.
        const existing = await load(client);
        const refused = existing || !beforeInsert ? null : await beforeInsert(client);
        const row = existing || refused ? null : await insert(client);
        if (existing) result = { row: existing, created: false };
        else if (refused) result = { refused };
        else if (row) {
          await client.query(
            'insert into record_creation_receipts (record_kind, record_id, intent_hash) values ($1, $2, $3)',
            [kind, id, intentHash],
          );
          result = { row, created: true };
        } else {
          result = { row: await load(client), created: false };
        }
      }
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
