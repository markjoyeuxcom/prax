import { randomUUID } from 'node:crypto';
import { PraxUnavailableError } from './errors.js';

export function stableMutationId(value) {
  return value || randomUUID();
}

// A stable id makes a retry safe: the server replays a committed result, and
// a generation still running for that id is waited for rather than repeated.
// The message says which uncertainty the caller is in: Prax did not answer in
// time (it may still be working) or could not be reached at all.
export async function runStableMutation({ label, id, inputName }, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof PraxUnavailableError)) throw error;
    const retry = `Retry the same intent with ${inputName}="${id}": it returns the first attempt's result instead of repeating it.`;
    const wrapped = new PraxUnavailableError(error.timedOut
      ? `${label} may still be processing: Prax did not answer in time, so its outcome is not known yet. ${retry} (${error.message})`
      : `${label} outcome is unknown because Prax was not reachable. ${retry} (${error.message})`);
    wrapped.timedOut = Boolean(error.timedOut);
    throw wrapped;
  }
}
