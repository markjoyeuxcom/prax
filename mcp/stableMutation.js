import { randomUUID } from 'node:crypto';
import { PraxUnavailableError } from './errors.js';

export function stableMutationId(value) {
  return value || randomUUID();
}

export async function runStableMutation({ label, id, inputName }, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof PraxUnavailableError)) throw error;
    throw new PraxUnavailableError(
      `${label} outcome is unknown because Prax remained unreachable. `
      + `Retry the same intent with ${inputName}="${id}". (${error.message})`,
    );
  }
}
