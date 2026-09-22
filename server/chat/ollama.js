import { toMessages } from './messages.js';
import { DEFAULT_LOCAL_CHAT_TIMEOUT_MS, fetchWithTimeout, finish, resolveTimeout } from './request.js';

// Ollama native chat (/api/chat, keyless, local). Like the ollama embedder, the
// native API lives at the root — strip a trailing /v1 so a base URL copied from
// an OpenAI-style config still works. Non-streaming (stream:false) so the reply
// is a single JSON object. done_reason 'length' marks the result truncated.
export function createOllamaChat({ url, model, fetch = globalThis.fetch, timeoutMs = DEFAULT_LOCAL_CHAT_TIMEOUT_MS } = {}) {
  const base = String(url || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/, '');
  const chatModel = model || 'llama3.1';
  return {
    backend: 'ollama',
    model: chatModel,
    async complete(messages, opts = {}) {
      const body = { model: chatModel, messages: toMessages(messages), stream: false };
      if (opts.temperature != null) body.options = { temperature: opts.temperature };
      const res = await fetchWithTimeout(fetch, `${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, { backend: 'ollama', timeoutMs: resolveTimeout(timeoutMs, opts) });
      if (!res.ok) {
        const timedOut = res.status === 504 || res.status === 408 || res.status === 524;
        throw new Error(`ollama chat failed: ${res.status}${timedOut ? ' (timed out — the model is slower than the gateway/proxy request timeout; raise the timeout or use a smaller model)' : ''}`);
      }
      const data = await res.json();
      const text = data?.message?.content;
      if (typeof text !== 'string') throw new Error('ollama returned no message content');
      return { text, model: chatModel, ...finish(data?.done_reason) };
    },
    async isAvailable() {
      try {
        // Reachable AND the configured model actually pulled (a bare name
        // resolves to :latest). If the list can't be read, fall back to
        // reachability rather than blocking.
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return false;
        let models = null;
        try {
          const data = await res.json();
          if (Array.isArray(data?.models)) models = data.models;
        } catch { models = null; }
        if (!models) return true;
        const wanted = chatModel.includes(':') ? [chatModel] : [chatModel, `${chatModel}:latest`];
        return models.some((m) => wanted.includes(String(m?.name || m?.model || '')));
      } catch {
        return false;
      }
    },
  };
}
