import { MoomoraApiError, MoomoraUnavailableError } from './errors.js';

export function okResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function withErrorHandling(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof MoomoraApiError || err instanceof MoomoraUnavailableError) {
        return errorResult(err.message);
      }
      return errorResult(`Unexpected error: ${err?.message ?? String(err)}`);
    }
  };
}
