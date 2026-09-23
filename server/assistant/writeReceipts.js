import { canonicalIntentHash, claimReceipt, createInFlightOperations, updateReceipt } from '../operationLedger.js';

// Approval identity: tool name and input, with object keys sorted.
export const assistantIntentHash = canonicalIntentHash;

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

// Approvals on the operation ledger ('assistant-write'). The receipt claims the
// intent as 'executing' before the tool runs. No transaction is held while it
// runs: the tool handlers need the same database gate. An 'executing' receipt
// left by an interruption therefore marks an unknown outcome explicitly, across
// restarts, and the approval is never blindly run again. Matching approvals
// arriving while one runs share its result through the in-flight registry.
export function createAssistantWriteReceipts(db) {
  const inFlight = createInFlightOperations();
  async function run(id, hash, work) {
    const claim = await claimReceipt(db, 'assistant-write', id, hash, { status: 'executing' });
    if (!claim.claimed) {
      if (claim.state !== 'replay') throw conflict();
      if (claim.receipt.status !== 'completed') throw unknown();
      return JSON.parse(claim.receipt.result);
    }
    let result;
    try { result = await work(); } catch { throw unknown(); }
    try {
      await updateReceipt(db, 'assistant-write', id, { status: 'completed', result: JSON.stringify(compactReceiptResult(result)) });
    } catch { throw unknown(); }
    return result;
  }
  return {
    async execute(id, payload, work) {
      if (!db) throw new Error('Durable approval storage is unavailable; no action was run.');
      const hash = assistantIntentHash(payload);
      const claim = inFlight.claim(id, hash);
      if (!claim.leader) {
        if (claim.conflict) throw conflict();
        return claim.outcome;
      }
      try {
        const result = await run(id, hash, work);
        claim.resolve(result);
        return result;
      } catch (error) {
        claim.reject(error);
        throw error;
      }
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
