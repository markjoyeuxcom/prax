// Shared pieces of the chat adapter contract.
//
// Every complete() result carries a normalised `finishReason` (the provider's
// own stop signal, verbatim) and `truncated` (true when that signal says the
// output hit the token limit). Callers must not present, apply, commit or
// propose tool calls from truncated output as though it were complete.
//
// Every HTTP request carries a deadline. Without one a stalled provider holds
// the request open for undici's default of about 300 s; with one it fails as an
// ordinary, explainable provider error.

// Hosted APIs answer well inside this; the local Ollama default is longer
// because a CPU-bound model can take minutes to produce a long rewrite.
export const DEFAULT_CHAT_TIMEOUT_MS = 180_000;
export const DEFAULT_LOCAL_CHAT_TIMEOUT_MS = 300_000;

export function resolveTimeout(configured, opts = {}) {
  const perCall = Number(opts?.timeoutMs);
  if (Number.isFinite(perCall) && perCall > 0) return perCall;
  const value = Number(configured);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CHAT_TIMEOUT_MS;
}

// fetch with a deadline. A timeout (or an aborted caller signal) becomes a
// plain Error naming the backend, never an opaque DOMException.
export async function fetchWithTimeout(fetch, url, init, { backend, timeoutMs }) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (err?.name === 'TimeoutError' || (err?.name === 'AbortError' && signal.aborted)) {
      throw new Error(`${backend} chat timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  }
}

// Provider stop signals that mean "the output was cut off by a length limit".
const TRUNCATION_SIGNALS = new Set([
  'max_tokens',                      // Anthropic stop_reason; Claude CLI envelope
  'model_context_window_exceeded',   // Anthropic stop_reason
  'length',                          // OpenAI Chat Completions / llama.cpp / Ollama done_reason
  'max_output_tokens',               // OpenAI Responses incomplete_details.reason
  'MAX_TOKENS',                      // Gemini finishReason
]);

export function isTruncationSignal(reason) {
  return typeof reason === 'string' && TRUNCATION_SIGNALS.has(reason);
}

export function finish(reason) {
  const finishReason = typeof reason === 'string' && reason ? reason : null;
  return { finishReason, truncated: isTruncationSignal(finishReason) };
}
