import { createHash } from 'node:crypto';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
export function assistantIntentHash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
// What a completed receipt keeps: the outcome, never the tool's output. The
// output can carry a document body or task text, and a receipt outlives a
// permanent delete of that record. The first run still returns the full
// result; a replay of the same approval returns this note instead. Migration
// 0038 compacts receipts written before this rule with the same notes.
export const RECEIPT_NOTES = Object.freeze({
  completed: 'This approved action already ran and completed. Its original output is not kept; read the affected records for their current state.',
  failed: 'This approved action already ran and reported an error. Its original output is not kept; check the affected records before trying again.',
});
export function compactReceiptResult(result) {
  const isError = Boolean(result?.isError);
  return { id: result?.id, name: result?.name, content: isError ? RECEIPT_NOTES.failed : RECEIPT_NOTES.completed, isError };
}
function conflict() { return new Error('This approval identity belongs to a different action. Review a new proposal.'); }
function unknown() {
  const error = new Error('This approved action may already have completed before an interruption. Check the workspace before proposing another action; this approval will not run twice.');
  error.code = 'WRITE_OUTCOME_UNKNOWN';
  return error;
}
export function createAssistantWriteReceipts(db) {
  const active = new Map();
  return {
    async execute(id, payload, work) {
      if (!db) throw new Error('Durable approval storage is unavailable; no action was run.');
      const hash = assistantIntentHash(payload);
      if (active.has(id)) {
        const item = active.get(id);
        if (item.hash !== hash) throw conflict();
        return item.promise;
      }
      const promise = (async () => {
        const claim = await db.query("insert into assistant_write_receipts (operation_id, request_hash, status) values ($1,$2,'executing') on conflict (operation_id) do nothing returning operation_id", [id,hash]);
        if (!claim.rows.length) {
          const record = (await db.query('select * from assistant_write_receipts where operation_id=$1',[id])).rows[0];
          if (record?.request_hash !== hash) throw conflict();
          if (record.status !== 'completed') throw unknown();
          return JSON.parse(record.result);
        }
        // Do not hold a DB transaction while invoking HTTP tool handlers: those
        // handlers need the same database gate. An interrupted executing row
        // instead guards an unknown outcome explicitly across process restarts.
        let result;
        try { result = await work(); } catch { throw unknown(); }
        try {
          await db.query("update assistant_write_receipts set status='completed', result=$2 where operation_id=$1",[id,JSON.stringify(compactReceiptResult(result))]);
        } catch { throw unknown(); }
        return result;
      })();
      active.set(id,{hash,promise});
      try { return await promise; } finally { if (active.get(id)?.promise === promise) active.delete(id); }
    },
  };
}

// Opt-in for the demo, whose workspace itself only lives in this process.
// Production callers never silently fall back when durable storage is missing.
export function createMemoryAssistantWriteReceipts() {
  const records = new Map();
  return {
    async execute(id, payload, work) {
      const hash = assistantIntentHash(payload);
      const existing = records.get(id);
      if (existing) {
        if (existing.hash !== hash) throw conflict();
        return existing.promise;
      }
      const promise = Promise.resolve().then(work).catch(() => { throw unknown(); });
      records.set(id, { hash, promise });
      return promise;
    },
  };
}
