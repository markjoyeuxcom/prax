import { toMessages } from './messages.js';

// Ollama native chat (/api/chat, keyless, local). Like the ollama embedder, the
// native API lives at the root — strip a trailing /v1 so a base URL copied from
// an OpenAI-style config still works. Non-streaming (stream:false) so the reply
// is a single JSON object.
export function createOllamaChat({ url, model, fetch = globalThis.fetch } = {}) {
  const base = String(url || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/, '');
  const chatModel = model || 'llama3.1';
  return {
    backend: 'ollama',
    model: chatModel,
    async complete(messages, opts = {}) {
      const body = { model: chatModel, messages: toMessages(messages), stream: false };
      if (opts.temperature != null) body.options = { temperature: opts.temperature };
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const timedOut = res.status === 504 || res.status === 408 || res.status === 524;
        throw new Error(`ollama chat failed: ${res.status}${timedOut ? ' (timed out — the model is slower than the gateway/proxy request timeout; raise the timeout or use a smaller model)' : ''}`);
      }
      const data = await res.json();
      const text = data?.message?.content;
      if (typeof text !== 'string') throw new Error('ollama returned no message content');
      return { text, model: chatModel };
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
