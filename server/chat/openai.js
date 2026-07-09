import { toMessages } from './messages.js';
import { openaiMessages, openaiTools, parseOpenai } from './toolProtocol.js';

// OpenAI-compatible chat completions (real OpenAI, llama.cpp, vLLM, LiteLLM, …).
// baseUrl includes /v1; the Authorization header is omitted when apiKey is empty
// so keyless local servers work. `backend`/`defaultModel` let llama.cpp reuse the
// client verbatim: with an empty model the field is omitted so llama-server falls
// back to its loaded model. Mirrors the openai embedder's shape + errors.
export function createOpenAiChat({ baseUrl, apiKey, model, backend = 'openai', defaultModel = 'gpt-4o-mini', fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const chatModel = model || defaultModel;
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  return {
    backend,
    model: chatModel,
    // Only real OpenAI is wired for tool-calling; llama.cpp (backend 'llamacpp')
    // reuses this client for plain completion and degrades to a read-only turn.
    supportsTools: backend === 'openai',
    async complete(messages, opts = {}) {
      const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
      const canonical = Array.isArray(messages) ? messages : toMessages(messages);
      const body = { messages: tools ? openaiMessages(canonical) : toMessages(messages) };
      if (chatModel) body.model = chatModel;
      if (opts.temperature != null) body.temperature = opts.temperature;
      if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
      if (tools) body.tools = openaiTools(tools);
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${backend} chat failed: ${res.status}`);
      const data = await res.json();
      const message = data?.choices?.[0]?.message;
      if (tools) {
        const { text, toolCalls } = parseOpenai(message);
        if (!text && !toolCalls.length) throw new Error(`${backend} returned no message content`);
        return { text, model: chatModel, toolCalls: toolCalls.length ? toolCalls : null, stopReason: data?.choices?.[0]?.finish_reason };
      }
      const text = message?.content;
      if (typeof text !== 'string') throw new Error(`${backend} returned no message content`);
      return { text, model: chatModel };
    },
    async isAvailable() {
      try {
        const res = await fetch(`${base}/models`, { headers: headers(), signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
